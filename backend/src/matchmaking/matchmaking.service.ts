import { Inject, Injectable } from '@nestjs/common';
import { MatchmakingStatus, MatchmakingTicket, RoomSource, RoomStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UserLookupService } from '../users/user-lookup.service';
import { GameService, SeatOccupant } from '../game/game.service';
import { RealtimeService } from '../realtime/realtime.service';
import { S2C } from '../realtime/events';
import { AppError, MESSAGES } from '../common/errors';
import { moduleLogger } from '../common/logger';
import { now } from '../common/clock';
import { roomCode } from '../common/ids';
import { MetricsService } from '../metrics/metrics.service';
import { AppConfig, CONFIG } from '../config/env';
import { botPlayers } from '../rooms/room-logic';
import type {
  AvatarId,
  MatchmakingEntry,
  MatchmakingStatus as DomainStatus,
  Room,
} from '../domain/model/types';

const log = moduleLogger('matchmaking');
const LOCKED_STATUSES: MatchmakingStatus[] = [
  MatchmakingStatus.FOUND,
  MatchmakingStatus.PREPARING,
  MatchmakingStatus.READY,
];
/** Tickets encerrados ficam visíveis por pouco tempo (o app lê o resultado) e somem. */
const TICKET_RETENTION_MS = 60_000;

/**
 * Fila de partida rápida. A formação da mesa acontece numa transação só: os tickets escolhidos são
 * travados com `FOR UPDATE SKIP LOCKED` (duas instâncias nunca pegam o mesmo jogador), a sala e a
 * partida são criadas e os tickets viram READY juntos.
 */
@Injectable()
export class MatchmakingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UserLookupService,
    private readonly game: GameService,
    private readonly realtime: RealtimeService,
    private readonly metrics: MetricsService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  private async entryOf(ticket: MatchmakingTicket): Promise<MatchmakingEntry> {
    const identity = (await this.users.identities([ticket.userId])).get(ticket.userId);
    return {
      uid: identity?.uid ?? '',
      nickname: identity?.nickname ?? '',
      avatarId: (identity?.avatarId ?? 'joao') as AvatarId,
      joinedAt: ticket.joinedAt.getTime(),
      status: ticket.status.toLowerCase() as DomainStatus,
      sessionId: ticket.matchId,
      roomCode: ticket.roomCode,
    };
  }

  async get(userId: string): Promise<MatchmakingEntry | null> {
    const ticket = await this.prisma.matchmakingTicket.findUnique({ where: { userId } });
    return ticket ? this.entryOf(ticket) : null;
  }

  private async publish(userIds: string[]) {
    for (const userId of userIds) {
      try {
        this.realtime.toUser(userId, S2C.matchmakingUpdated, { entry: await this.get(userId) });
      } catch (e) {
        log.warn('publish_failed', { error: (e as Error).message });
      }
    }
  }

  async start(userId: string, allowBots: boolean): Promise<{ ok: true }> {
    await this.users.requirePlayable(userId);
    if (await this.game.busyElsewhere(userId, null))
      throw new AppError('ALREADY_IN_MATCH', MESSAGES.busy);
    const existing = await this.prisma.matchmakingTicket.findUnique({ where: { userId } });
    if (existing && LOCKED_STATUSES.includes(existing.status) && existing.matchId) {
      const stillPlaying = await this.prisma.match.count({
        where: { id: existing.matchId, status: 'PLAYING' },
      });
      if (stillPlaying) return { ok: true };
    }
    const t = new Date(now());
    await this.prisma.matchmakingTicket.upsert({
      where: { userId },
      // `updatedAt` explícito: a expiração da busca compara com o mesmo relógio (`now()`).
      create: { userId, status: MatchmakingStatus.SEARCHING, joinedAt: t, updatedAt: t },
      update: {
        status: MatchmakingStatus.SEARCHING,
        updatedAt: t,
        matchId: null,
        roomCode: null,
        ...(existing?.status === MatchmakingStatus.SEARCHING ? {} : { joinedAt: t }),
      },
    });
    await this.publish([userId]);
    await this.tryFormTable(allowBots ? userId : null);
    return { ok: true };
  }

  async cancel(userId: string): Promise<{ ok: true }> {
    await this.prisma.matchmakingTicket.updateMany({
      where: { userId, status: MatchmakingStatus.SEARCHING },
      data: { status: MatchmakingStatus.CANCELLED },
    });
    await this.publish([userId]);
    return { ok: true };
  }

  /** Usuário sem nenhum socket (app fechado): a busca não pode sentar alguém ausente numa mesa. */
  async cancelForDisconnectedUser(userId: string): Promise<boolean> {
    const res = await this.prisma.matchmakingTicket.updateMany({
      where: { userId, status: MatchmakingStatus.SEARCHING },
      data: { status: MatchmakingStatus.CANCELLED },
    });
    if (res.count > 0) {
      this.metrics.inc('matchmaking_cancelled_disconnected_total');
      log.info('ticket_cancelled_disconnected', { userId });
    }
    return res.count > 0;
  }

  private searchCutoff(): Date {
    return new Date(now() - this.config.matchmakingMaxSearchMs);
  }

  /**
   * Agrupa quem está procurando em mesas de 4. Com `botsFor`, o jogador que pediu (depois da
   * espera do Remote Config) recebe uma mesa completada com IA junto dos mais antigos da fila.
   */
  async tryFormTable(botsFor: string | null): Promise<string | null> {
    const formed = await this.prisma.tx(async (tx) => {
      const picked = await tx.$queryRaw<{ userId: string }[]>`
        SELECT "userId" FROM "MatchmakingTicket"
        WHERE status = 'SEARCHING' AND "updatedAt" > ${this.searchCutoff()}
        ORDER BY "joinedAt" ASC
        LIMIT 4
        FOR UPDATE SKIP LOCKED`;
      if (picked.length === 0) return null;
      if (picked.length < 4) {
        if (!botsFor || !picked.some((p) => p.userId === botsFor)) return null;
      }
      const ids = picked.map((p) => p.userId);
      const identities = await this.users.identities(ids, tx);
      const playable = ids.filter((id) => identities.get(id)?.nickname);
      if (playable.length !== ids.length) {
        await tx.matchmakingTicket.updateMany({
          where: { userId: { in: ids.filter((id) => !playable.includes(id)) } },
          data: { status: MatchmakingStatus.ERROR },
        });
        if (playable.length === 0) return null;
      }
      const t = now();
      const host = identities.get(playable[0]!)!;
      let code = roomCode();
      for (
        let i = 0;
        i < 5 && (await tx.room.findUnique({ where: { code }, select: { id: true } }));
        i++
      )
        code = roomCode();
      const room = await tx.room.create({
        data: {
          code,
          hostUserId: host.id,
          source: RoomSource.MATCHMAKING,
          status: RoomStatus.IN_MATCH,
        },
      });
      const players: Room['players'] = {};
      playable.forEach((id, seat) => {
        const who = identities.get(id)!;
        players[who.uid] = {
          uid: who.uid,
          seat,
          nickname: who.nickname,
          avatarId: who.avatarId,
          ready: true,
          bot: false,
          joinedAt: t,
          connected: true,
        };
      });
      Object.assign(players, botPlayers(players, 4 - playable.length, t));
      const idByUid = new Map(playable.map((id) => [identities.get(id)!.uid, id]));
      const seats: SeatOccupant[] = Object.values(players).map((p) => ({
        seat: p.seat,
        userId: p.bot ? null : idByUid.get(p.uid)!,
        botKey: p.bot ? p.uid : null,
        nickname: p.nickname,
        avatarId: p.avatarId,
        isBot: p.bot,
        connected: true,
        reservedForUserId: null,
      }));
      await tx.roomSeat.createMany({
        data: seats.map((s) => ({
          roomId: room.id,
          seat: s.seat,
          userId: s.userId,
          botKey: s.botKey,
          nickname: s.nickname,
          avatarId: s.avatarId,
          ready: true,
          isBot: s.isBot,
        })),
      });
      const { matchId, humans } = await this.game.createOnlineMatch(tx, room.id, seats);
      await tx.room.update({ where: { id: room.id }, data: { currentMatchId: matchId } });
      await tx.matchmakingTicket.updateMany({
        where: { userId: { in: playable } },
        data: { status: MatchmakingStatus.READY, matchId, roomCode: code },
      });
      return { matchId, humans, code, all: ids };
    });
    if (!formed) return null;
    this.metrics.inc('matchmaking_tables_total', { withBots: String(formed.humans.length < 4) });
    this.game.announceStarted(formed.matchId, formed.humans);
    await this.publish(formed.all);
    log.info('table_formed', { matchId: formed.matchId, humans: formed.humans.length });
    return formed.matchId;
  }

  /** Limpeza periódica: tickets encerrados somem depois de lidos. */
  async cleanup(): Promise<number> {
    // Primeiro some com os encerrados antigos; depois expira as buscas paradas (que ficam visíveis
    // por TICKET_RETENTION_MS para o app ler o resultado).
    const res = await this.prisma.matchmakingTicket.deleteMany({
      where: {
        status: { not: MatchmakingStatus.SEARCHING },
        updatedAt: { lt: new Date(now() - TICKET_RETENTION_MS) },
      },
    });
    // Busca parada há muito tempo (app morto sem cancelar): expira e avisa quem ainda estiver ouvindo.
    const cutoff = this.searchCutoff();
    const stale = await this.prisma.matchmakingTicket.findMany({
      where: { status: MatchmakingStatus.SEARCHING, updatedAt: { lt: cutoff } },
      select: { userId: true },
      take: 500,
    });
    if (stale.length > 0) {
      const ids = stale.map((t) => t.userId);
      await this.prisma.matchmakingTicket.updateMany({
        where: {
          userId: { in: ids },
          status: MatchmakingStatus.SEARCHING,
          updatedAt: { lt: cutoff },
        },
        data: { status: MatchmakingStatus.TIMEOUT },
      });
      this.metrics.inc('matchmaking_expired_total', {}, ids.length);
      await this.publish(ids);
    }
    return res.count;
  }

  async searchingCount(): Promise<number> {
    return this.prisma.matchmakingTicket.count({ where: { status: MatchmakingStatus.SEARCHING } });
  }
}
