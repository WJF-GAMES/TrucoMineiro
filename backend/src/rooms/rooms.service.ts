import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { NotificationType, Prisma, RoomClosedReason, RoomInviteStatus, RoomSource, RoomStatus } from '@prisma/client';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { AppConfig, CONFIG } from '../config/env';
import { AppError, MESSAGES } from '../common/errors';
import { moduleLogger } from '../common/logger';
import { now } from '../common/clock';
import { roomCode } from '../common/ids';
import { RateLimitService } from '../common/rate-limit.service';
import { RealtimeService } from '../realtime/realtime.service';
import { S2C } from '../realtime/events';
import { PushService } from '../notifications/push.service';
import { FriendshipRepository } from '../friends/friendship.repository';
import { PhoneDirectoryService } from '../contacts/phone-directory.service';
import { UserLookupService, PublicIdentity } from '../users/user-lookup.service';
import { GameService, SeatOccupant } from '../game/game.service';
import { MetricsService } from '../metrics/metrics.service';
import type { Room, RoomInvite } from '../domain/model/types';
import { LoadedRoom, RoomRepository } from './room.repository';
import {
  acceptInvite,
  canStart,
  closeRoom,
  declineInvite,
  fillWithAi,
  freeSeat,
  openSeatForInvite,
  playersOf,
} from './room-logic';

const log = moduleLogger('rooms');

/** Intervalo mínimo entre dois pushes do mesmo convite. */
export const PUSH_COOLDOWN_MS = 15_000;
/** Sala parada no lobby por mais que isto é fechada pela limpeza. */
export const STALE_LOBBY_MS = 10 * 60_000;
/** Sala fechada há mais que isto é apagada (libera o código). */
export const CLOSED_ROOM_RETENTION_MS = 60 * 60_000;
/** Máximo de amigos por convite (a mesa 2x2 tem 3 vagas além do dono). */
export const MAX_ROOM_FRIENDS = 3;

export interface JoinResult {
  code: string;
  /** Partida já em andamento: o convidado assume a vaga da IA no próximo ponto seguro. */
  sessionId?: string | null;
  pending?: boolean;
}

interface PendingDelivery {
  roomCode: string;
  hostNickname: string;
  inviteeId: string;
  inviterId: string;
}

/**
 * Salas, assentos e convites. Toda mudança acontece sob trava da linha da sala; efeitos externos
 * (WebSocket, push) só depois do commit — um FCM fora do ar nunca corrompe a sala.
 */
@Injectable()
export class RoomsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: RoomRepository,
    private readonly rateLimit: RateLimitService,
    private readonly realtime: RealtimeService,
    private readonly push: PushService,
    private readonly friendships: FriendshipRepository,
    private readonly phones: PhoneDirectoryService,
    private readonly users: UserLookupService,
    private readonly game: GameService,
    private readonly metrics: MetricsService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit() {
    this.game.roomChanged = (code) => this.publishRoom(code);
  }

  // --- Leitura / publicação -----------------------------------------------------------------

  async getRoom(code: string): Promise<Room> {
    const room = await this.findRoom(code);
    if (!room) throw new AppError('ROOM_NOT_FOUND', 'Sala não encontrada. Confira o código.');
    return room;
  }

  async findRoom(code: string): Promise<Room | null> {
    const row = await this.prisma.room.findUnique({ where: { code }, select: { id: true } });
    if (!row) return null;
    return this.prisma.$transaction((tx) => this.repo.load(tx, row.id)).then((l) => l.room);
  }

  async publishRoom(code: string) {
    try {
      const room = await this.findRoom(code);
      if (room) this.realtime.toRoom(code, S2C.roomUpdated, { code, room });
      else this.realtime.toRoom(code, S2C.roomUpdated, { code, room: null });
    } catch (e) {
      log.warn('publish_room_failed', { code, error: (e as Error).message });
    }
  }

  /** Caixa de entrada do convidado (convites válidos, do mais recente para o mais antigo). */
  async inbox(userId: string): Promise<RoomInvite[]> {
    const t = new Date(now());
    const rows = await this.prisma.roomInvite.findMany({
      where: {
        inviteeUserId: userId,
        dismissedAt: null,
        expiresAt: { gt: t },
        status: { in: [RoomInviteStatus.PENDING, RoomInviteStatus.AI_FILLED] },
        room: { status: { not: RoomStatus.CLOSED } },
      },
      orderBy: { invitedAt: 'desc' },
      take: 20,
      include: {
        room: { select: { code: true } },
        invitee: { select: { firebaseUid: true } },
        inviter: { select: { firebaseUid: true, profile: { select: { nickname: true } } } },
      },
    });
    return rows.map((r) => ({
      code: r.room.code,
      from: r.inviter.firebaseUid,
      fromNickname: r.inviter.profile?.nickname ?? '',
      createdAt: r.invitedAt.getTime(),
      inviteId: `${r.room.code}_${r.invitee.firebaseUid}`,
      expiresAt: r.expiresAt.getTime(),
    }));
  }

  private async publishInbox(userIds: string[]) {
    for (const id of new Set(userIds)) {
      try {
        this.realtime.toUser(id, S2C.invitesUpdated, { invites: await this.inbox(id) });
      } catch (e) {
        log.warn('publish_inbox_failed', { error: (e as Error).message });
      }
    }
  }

  /** Some da caixa de entrada (ignorar/limpar convite vencido). */
  async dismissInvite(userId: string, code: string) {
    await this.prisma.roomInvite.updateMany({
      where: { inviteeUserId: userId, room: { code } },
      data: { dismissedAt: new Date(now()) },
    });
    await this.publishInbox([userId]);
    return { ok: true as const };
  }

  // --- Mutação com trava --------------------------------------------------------------------

  private async mutate<T>(
    code: string,
    fn: (loaded: LoadedRoom, tx: Tx) => Promise<T>,
  ): Promise<T> {
    return this.prisma.tx(async (tx) => {
      const loaded = await this.repo.require(tx, code, MESSAGES.unavailable);
      return fn(loaded, tx);
    });
  }

  private async afterRoomChange(code: string, inboxUsers: string[] = [], deliveries: PendingDelivery[] = []) {
    await this.publishRoom(code);
    await this.publishInbox(inboxUsers);
    for (const d of deliveries) await this.deliverPush(d);
  }

  /** Push do convite, com intervalo mínimo por convite. Nunca lança. */
  private async deliverPush(d: PendingDelivery) {
    try {
      const inviteeUid = (await this.users.uidsOf([d.inviteeId])).get(d.inviteeId) ?? d.inviteeId;
      const inviteId = `${d.roomCode}_${inviteeUid}`;
      if (!(await this.rateLimit.cooldown(d.inviterId, `push_${inviteId}`, PUSH_COOLDOWN_MS))) return;
      await this.push.notify(d.inviteeId, {
        type: NotificationType.ROOM_INVITE,
        title: `${d.hostNickname} te chamou para uma partida de Truco!`,
        body: 'Toque para entrar na sala.',
        data: { type: 'room_invite', code: d.roomCode, inviteId },
        collapseKey: inviteId,
        ttlMs: this.config.inviteTtlMs,
      });
      await this.prisma.roomInvite.updateMany({
        where: { inviteeUserId: d.inviteeId, room: { code: d.roomCode } },
        data: { pushSentAt: new Date(now()) },
      });
    } catch (e) {
      log.warn('invite_push_failed', { error: (e as Error).message });
    }
  }

  // --- Criação ------------------------------------------------------------------------------

  private async createRoomFor(
    tx: Tx,
    host: PublicIdentity,
    source: RoomSource,
    ready: boolean,
    extra: Partial<Prisma.RoomUncheckedCreateInput> = {},
  ) {
    for (let attempt = 0; attempt < 6; attempt++) {
      const code = roomCode();
      const taken = await tx.room.findUnique({ where: { code }, select: { id: true } });
      if (taken) continue;
      const room = await tx.room.create({
        data: {
          code,
          hostUserId: host.id,
          source,
          ...extra,
          seats: {
            create: {
              seat: 0,
              userId: host.id,
              nickname: host.nickname,
              avatarId: host.avatarId,
              ready,
              isBot: false,
            },
          },
        },
      });
      return room;
    }
    throw new AppError('ROOM_CODE_EXHAUSTED', 'Não foi possível gerar um código de sala.');
  }

  async createRoom(userId: string): Promise<{ code: string }> {
    await this.rateLimit.hit(userId, 'room_create', 10, 60_000);
    const host = await this.users.requirePlayable(userId);
    const room = await this.retryOnCodeConflict(() =>
      this.prisma.tx((tx) => this.createRoomFor(tx, host, RoomSource.PRIVATE, false)),
    );
    this.metrics.inc('rooms_created_total', { kind: 'private' });
    return { code: room.code };
  }

  private async retryOnCodeConflict<T>(fn: () => Promise<T>): Promise<T> {
    for (let i = 0; ; i++) {
      try {
        return await fn();
      } catch (e) {
        if (i < 3 && e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') continue;
        throw e;
      }
    }
  }

  /** Só amigos, e nunca com bloqueio em qualquer sentido (mesma mensagem nos dois casos). */
  private async friendIdentity(userId: string, friendUid: string, db: Tx | PrismaService): Promise<PublicIdentity> {
    const friendId = await this.users.idOf(friendUid, db);
    if (friendId === userId) throw new AppError('FRIEND_SELF', 'Você não pode convidar a si mesmo.');
    const denied = new AppError('NOT_FRIENDS', 'Só é possível chamar seus amigos para a sala.');
    if (!friendId) throw denied;
    const [friends, blocked, identity] = await Promise.all([
      this.friendships.areFriends(userId, friendId, db),
      this.friendships.blockedEitherWay(userId, friendId, db),
      this.users.identities([friendId], db).then((m) => m.get(friendId)),
    ]);
    if (!friends || blocked || !identity?.nickname) throw denied;
    return identity;
  }

  /**
   * Sala a partir da lista de amigos: grava a sala com as vagas reservadas e só então convida.
   * Dono no assento 0; amigos nos assentos 1, 2 e 3, na ordem da seleção.
   */
  async createFriendRoom(userId: string, friendUids: string[]): Promise<{ code: string; inviteExpiresAt: number }> {
    const unique = [...new Set(friendUids)];
    if (unique.length === 0 || unique.length > MAX_ROOM_FRIENDS)
      throw new AppError('ROOM_FRIENDS_INVALID', `Escolha de 1 a ${MAX_ROOM_FRIENDS} amigos.`);
    await this.rateLimit.hit(userId, 'friend_room', 6, 60_000, 'Muitas salas seguidas. Aguarde um pouco.');
    if (await this.game.busyElsewhere(userId, null)) throw new AppError('ALREADY_IN_MATCH', MESSAGES.busy);
    const host = await this.users.requirePlayable(userId);
    const friends = await Promise.all(unique.map((f) => this.friendIdentity(userId, f, this.prisma)));
    const t = now();
    const inviteExpiresAt = t + this.config.lobbyWaitMs;
    const lateJoinUntil = t + this.config.inviteTtlMs;
    const room = await this.retryOnCodeConflict(() =>
      this.prisma.tx(async (tx) => {
        const created = await this.createRoomFor(tx, host, RoomSource.PRIVATE, true, {
          inviteExpiresAt: new Date(inviteExpiresAt),
          lateJoinUntil: new Date(lateJoinUntil),
          fillPolicy: 'ON_TIMEOUT',
        });
        await tx.roomInvite.createMany({
          data: friends.map((f, i) => ({
            roomId: created.id,
            inviteeUserId: f.id,
            inviterUserId: userId,
            seat: i + 1,
            status: RoomInviteStatus.PENDING,
            invitedAt: new Date(t),
            expiresAt: new Date(lateJoinUntil),
          })),
        });
        return created;
      }),
    );
    this.metrics.inc('rooms_created_total', { kind: 'friends' });
    await this.afterRoomChange(
      room.code,
      friends.map((f) => f.id),
      friends.map((f) => ({ roomCode: room.code, hostNickname: host.nickname, inviteeId: f.id, inviterId: userId })),
    );
    return { code: room.code, inviteExpiresAt };
  }

  // --- Entrar / convite ---------------------------------------------------------------------

  private async acceptInto(userId: string, uid: string, code: string): Promise<JoinResult> {
    if (await this.game.busyElsewhere(userId, code)) throw new AppError('ALREADY_IN_MATCH', MESSAGES.busy);
    const profile = await this.users.requirePlayable(userId);
    const out = await this.mutate(code, async (loaded, tx) => {
      const result = acceptInvite(loaded.room, uid, profile, now());
      if (result.kind === 'error') throw new AppError(result.code, result.message);
      await tx.roomInvite.updateMany({
        where: { roomId: loaded.row.id, inviteeUserId: userId },
        data: { dismissedAt: new Date(now()) },
      });
      if (result.kind === 'joined') {
        await this.repo.save(tx, loaded, result.room);
        return { room: result.room, late: null as number | null };
      }
      if (result.kind === 'late') {
        const ok = loaded.row.currentMatchId
          ? await this.game.requestSeatReclaim(tx, loaded.row.currentMatchId, result.seat, userId)
          : false;
        if (!ok) throw new AppError('ROOM_STARTED', MESSAGES.started);
        return { room: loaded.room, late: result.seat };
      }
      return { room: loaded.room, late: null };
    });
    await this.afterRoomChange(code, [userId]);
    if (out.late !== null && out.room.sessionId) {
      this.metrics.inc('late_joins_total');
      return { code, sessionId: out.room.sessionId, pending: true };
    }
    return { code, sessionId: out.room.status === 'in_match' ? out.room.sessionId : null };
  }

  async joinRoom(userId: string, uid: string, code: string): Promise<JoinResult> {
    const room = await this.prisma.room.findUnique({ where: { code }, select: { id: true } });
    if (!room) throw new AppError('ROOM_NOT_FOUND', 'Sala não encontrada. Confira o código.');
    const invited = await this.prisma.roomInvite.count({ where: { roomId: room.id, inviteeUserId: userId } });
    // Convidado entrando pelo código também usa a vaga reservada para ele.
    if (invited > 0) return this.acceptInto(userId, uid, code);
    const profile = await this.users.requirePlayable(userId);
    await this.mutate(code, async (loaded, tx) => {
      const r = loaded.room;
      if (r.players[uid]) return; // já dentro: idempotente
      if (r.status !== 'waiting') throw new AppError('ROOM_STARTED', 'A partida dessa sala já começou.');
      const seat = freeSeat(r);
      if (seat === null) throw new AppError('ROOM_FULL', 'Essa sala já está cheia.');
      await this.repo.save(tx, loaded, {
        ...r,
        players: {
          ...r.players,
          [uid]: {
            uid,
            seat,
            nickname: profile.nickname,
            avatarId: profile.avatarId,
            ready: false,
            bot: false,
            joinedAt: now(),
            connected: true,
          },
        },
      });
    });
    await this.afterRoomChange(code);
    return { code };
  }

  /** Resposta ao convite (push, banner ou lista). Aceitar é idempotente; recusar libera a vaga. */
  async respondInvite(userId: string, uid: string, code: string, accept: boolean): Promise<JoinResult> {
    if (accept) return this.acceptInto(userId, uid, code);
    const exists = await this.prisma.room.findUnique({ where: { code }, select: { id: true } });
    if (exists) {
      await this.mutate(code, async (loaded, tx) => {
        const next = declineInvite(loaded.room, uid, now());
        if (next) await this.repo.save(tx, loaded, next);
        await tx.roomInvite.updateMany({
          where: { roomId: loaded.row.id, inviteeUserId: userId },
          data: { dismissedAt: new Date(now()) },
        });
      });
      await this.afterRoomChange(code, [userId]);
    }
    return { code };
  }

  async leaveRoom(userId: string, uid: string, code: string): Promise<{ ok: true }> {
    const exists = await this.prisma.room.findUnique({ where: { code }, select: { id: true } });
    if (!exists) return { ok: true };
    const result = await this.mutate(code, async (loaded, tx) => {
      const r = loaded.room;
      // Depois de começar, sair da sala não mexe na partida (isso é `abandon`).
      if (r.status === 'in_match' || r.status === 'starting' || r.status === 'closed') return null;
      if (r.hostUid === uid) {
        const closed = closeRoom(r, 'cancelled', now());
        await this.repo.save(tx, loaded, closed);
        await tx.roomInvite.updateMany({
          where: { roomId: loaded.row.id },
          data: { dismissedAt: new Date(now()) },
        });
        return { cancelled: true, invitees: [...loaded.inviterOf.keys()].map((u) => loaded.idOf.get(u)!).filter(Boolean) };
      }
      const players = { ...r.players };
      delete players[uid];
      const invite = r.invites?.[uid];
      const invites = invite
        ? { ...r.invites, [uid]: { ...invite, status: 'DECLINED' as const, respondedAt: now() } }
        : r.invites;
      await this.repo.save(tx, loaded, { ...r, players, ...(invites ? { invites } : {}) });
      return { cancelled: false, invitees: [] as string[] };
    });
    await this.afterRoomChange(code, result?.invitees ?? []);
    return { ok: true };
  }

  async setReady(uid: string, code: string, ready: boolean): Promise<{ ok: true }> {
    await this.mutate(code, async (loaded, tx) => {
      const me = loaded.room.players[uid];
      if (!me) throw new AppError('ROOM_NOT_MEMBER', 'Você não está nessa sala.');
      if (me.ready === ready) return;
      await this.repo.save(tx, loaded, {
        ...loaded.room,
        players: { ...loaded.room.players, [uid]: { ...me, ready } },
      });
    });
    await this.afterRoomChange(code);
    return { ok: true };
  }

  /** Completa as vagas com IA. As reservas dos convidados pendentes ficam guardadas na IA. */
  async fillWithBots(uid: string, code: string): Promise<{ ok: true }> {
    await this.mutate(code, async (loaded, tx) => {
      if (loaded.room.hostUid !== uid)
        throw new AppError('ROOM_NOT_HOST', 'Só o anfitrião pode completar com IA.');
      if (loaded.room.status !== 'waiting') return;
      await this.repo.save(tx, loaded, fillWithAi(loaded.room, now()));
    });
    await this.afterRoomChange(code);
    return { ok: true };
  }

  /** Sala → partida, numa transação só (não existe sala presa em "começando"). Idempotente. */
  private async startRoom(code: string, guard: (room: Room) => AppError | null, fill = false) {
    const out = await this.mutate(code, async (loaded, tx) => {
      let r = loaded.room;
      if (r.status === 'in_match' && r.sessionId) return { sessionId: r.sessionId, humans: [] as string[], invitees: [] as string[], started: false };
      const denied = guard(r);
      if (denied) throw denied;
      if (r.status !== 'waiting') throw new AppError('ROOM_NOT_WAITING', 'A sala não está aguardando.');
      if (fill) r = fillWithAi(r, now());
      const ready = canStart(r);
      if (!ready.ok) throw new AppError('ROOM_NOT_READY', ready.reason);
      if (fill) {
        await this.repo.save(tx, loaded, r);
        loaded = await this.repo.load(tx, loaded.row.id);
        r = loaded.room;
      }
      const seats: SeatOccupant[] = playersOf(r).map((p) => ({
        seat: p.seat,
        userId: p.bot ? null : (loaded.idOf.get(p.uid) ?? null),
        botKey: p.bot ? p.uid : null,
        nickname: p.nickname,
        avatarId: p.avatarId,
        isBot: p.bot,
        connected: p.connected !== false,
        reservedForUserId: p.bot && p.reservedFor ? (loaded.idOf.get(p.reservedFor) ?? null) : null,
      }));
      const { matchId, humans } = await this.game.createOnlineMatch(tx, loaded.row.id, seats);
      // Quem ainda estava convidado e não tem vaga na mesa já não pode entrar.
      const invites = { ...(r.invites ?? {}) };
      const expired: string[] = [];
      for (const inv of Object.values(invites)) {
        if (inv.status !== 'PENDING') continue;
        invites[inv.uid] = { ...inv, status: 'EXPIRED', respondedAt: now() };
        expired.push(loaded.idOf.get(inv.uid)!);
      }
      await this.repo.save(tx, loaded, { ...r, status: 'in_match', sessionId: matchId, invites });
      return { sessionId: matchId, humans, invitees: expired.filter(Boolean), started: true };
    });
    if (out.started) this.game.announceStarted(out.sessionId, out.humans);
    await this.afterRoomChange(code, out.invitees);
    return { sessionId: out.sessionId };
  }

  async startMatch(uid: string, code: string) {
    return this.startRoom(code, (room) =>
      room.hostUid === uid ? null : new AppError('ROOM_NOT_HOST', 'Só o anfitrião pode iniciar.'),
    );
  }

  /**
   * Fim da espera do lobby: completa com IA e começa. Qualquer pessoa na sala pode pedir (o
   * agendador do servidor também faz isso sozinho), mas só vale depois do prazo.
   */
  async resolveLobbyTimeout(uid: string | null, code: string): Promise<{ sessionId: string | null }> {
    const current = await this.findRoom(code);
    if (!current) throw new AppError('ROOM_NOT_FOUND', MESSAGES.unavailable);
    if (uid !== null && !current.players[uid])
      throw new AppError('ROOM_NOT_MEMBER', 'Você não está nessa sala.');
    if (current.status === 'in_match') return { sessionId: current.sessionId };
    if (current.fillWithAi !== 'on_timeout' || current.status !== 'waiting') return { sessionId: null };
    if (now() < (current.inviteExpiresAt ?? 0))
      throw new AppError('ROOM_WAITING_INVITES', 'Ainda estamos aguardando os convidados.');
    const started = await this.startRoom(code, () => null, true);
    log.info('lobby_timeout_ai_filled', { code });
    return { sessionId: started.sessionId };
  }

  /** Dono chama mais um amigo (ou troca quem recusou) antes de a partida começar. */
  async inviteToRoom(userId: string, uid: string, code: string, friendUid: string): Promise<{ ok: true }> {
    await this.rateLimit.hit(userId, 'room_invite', 20, 60_000, 'Muitos convites seguidos. Aguarde um pouco.');
    const friend = await this.friendIdentity(userId, friendUid, this.prisma);
    const host = await this.users.requirePlayable(userId);
    const changed = await this.mutate(code, async (loaded, tx) => {
      const r = loaded.room;
      if (r.hostUid !== uid) throw new AppError('ROOM_NOT_HOST', 'Só o anfitrião pode convidar.');
      if (r.status !== 'waiting') throw new AppError('ROOM_STARTED', MESSAGES.started);
      if (r.players[friendUid]) return false;
      const existing = r.invites?.[friendUid];
      if (existing?.status === 'PENDING' && existing.seat >= 0) {
        // Só reenvia o push (e devolve o convite à caixa de entrada).
        await tx.roomInvite.updateMany({
          where: { roomId: loaded.row.id, inviteeUserId: friend.id },
          data: { dismissedAt: null },
        });
        return true;
      }
      const pending = Object.values(r.invites ?? {}).filter((i) => i.status === 'PENDING' && i.seat >= 0);
      if (pending.length + playersOf(r).length >= 4) throw new AppError('ROOM_FULL', MESSAGES.full);
      const seat = openSeatForInvite(r);
      if (seat === null) throw new AppError('ROOM_FULL', MESSAGES.full);
      const t = now();
      loaded.idOf.set(friendUid, friend.id);
      await this.repo.save(
        tx,
        loaded,
        {
          ...r,
          invites: {
            ...r.invites,
            [friendUid]: {
              uid: friendUid,
              seat,
              nickname: friend.nickname,
              avatarId: friend.avatarId,
              status: 'PENDING',
              invitedAt: t,
              respondedAt: null,
            },
          },
          // O convidado novo ganha a espera inteira.
          inviteExpiresAt: Math.max(r.inviteExpiresAt ?? 0, t + this.config.lobbyWaitMs),
          lateJoinUntil: Math.max(r.lateJoinUntil ?? 0, t + this.config.inviteTtlMs),
          fillWithAi: r.fillWithAi ?? 'on_timeout',
        },
        { inviterId: userId },
      );
      await tx.roomInvite.updateMany({
        where: { roomId: loaded.row.id, inviteeUserId: friend.id },
        data: { dismissedAt: null },
      });
      return true;
    });
    if (changed)
      await this.afterRoomChange(code, [friend.id], [
        { roomCode: code, hostNickname: host.nickname, inviteeId: friend.id, inviterId: userId },
      ]);
    return { ok: true };
  }

  /**
   * Convite simples para uma sala (tela Amigos): vale para amigos e para contatos da agenda que já
   * jogam. Para quem ainda não é amigo, o app manda os números desse contato e o servidor confere
   * no diretório que um deles é mesmo desse jogador. Nada disso é gravado.
   */
  async inviteDirect(userId: string, code: string, friendUid: string, phones?: string[]): Promise<{ ok: true }> {
    const friendId = await this.users.idOf(friendUid);
    if (friendId === userId) throw new AppError('FRIEND_SELF', 'Você não pode convidar a si mesmo.');
    const denied = new AppError('NOT_FRIENDS', 'Só é possível chamar amigos ou contatos da sua agenda.');
    if (!friendId) throw denied;
    if (!(await this.friendships.areFriends(userId, friendId))) {
      if (!phones?.length) throw denied;
      if (await this.friendships.blockedEitherWay(userId, friendId)) throw denied;
      const owners = await this.phones.owners(phones.map((p) => this.phones.hash(p)));
      if (![...owners.values()].includes(friendId)) throw denied;
    }
    const me = await this.users.requirePlayable(userId);
    await this.rateLimit.hit(userId, 'room_invite', 20, 60_000, 'Muitos convites seguidos. Aguarde um pouco.');
    const t = now();
    await this.mutate(code, async (loaded, tx) => {
      if (loaded.row.status === RoomStatus.CLOSED) throw new AppError('INVITE_EXPIRED', MESSAGES.unavailable);
      const expiresAt = new Date(t + this.config.inviteTtlMs);
      await tx.roomInvite.upsert({
        where: { roomId_inviteeUserId: { roomId: loaded.row.id, inviteeUserId: friendId } },
        create: {
          roomId: loaded.row.id,
          inviteeUserId: friendId,
          inviterUserId: userId,
          seat: null,
          status: RoomInviteStatus.PENDING,
          invitedAt: new Date(t),
          expiresAt,
        },
        update: { dismissedAt: null, expiresAt, inviterUserId: userId },
      });
    });
    await this.afterRoomChange(code, [friendId], [
      { roomCode: code, hostNickname: me.nickname, inviteeId: friendId, inviterId: userId },
    ]);
    return { ok: true };
  }

  /** Dono tira um convidado que ainda não entrou (para chamar outra pessoa no lugar). */
  async removeInvite(uid: string, code: string, friendUid: string): Promise<{ ok: true }> {
    const removed = await this.mutate(code, async (loaded, tx) => {
      const r = loaded.room;
      if (r.hostUid !== uid) throw new AppError('ROOM_NOT_HOST', 'Só o anfitrião pode mudar os convites.');
      if (r.status !== 'waiting') throw new AppError('ROOM_STARTED', MESSAGES.started);
      const invite = r.invites?.[friendUid];
      if (!invite || invite.status === 'ACCEPTED') return null;
      const invites = { ...r.invites };
      delete invites[friendUid];
      await this.repo.save(tx, loaded, { ...r, invites });
      return loaded.idOf.get(friendUid) ?? null;
    });
    await this.afterRoomChange(code, removed ? [removed] : []);
    return { ok: true };
  }

  // --- Agendador / limpeza ------------------------------------------------------------------

  /** Salas de amigos cujo prazo do lobby venceu: completa com IA e começa. */
  async resolveExpiredLobbies(limit = 20): Promise<number> {
    const due = await this.prisma.room.findMany({
      where: {
        status: RoomStatus.WAITING,
        fillPolicy: 'ON_TIMEOUT',
        inviteExpiresAt: { lte: new Date(now()) },
      },
      select: { code: true },
      take: limit,
    });
    let started = 0;
    for (const r of due) {
      try {
        const res = await this.resolveLobbyTimeout(null, r.code);
        if (res.sessionId) started++;
      } catch (e) {
        log.warn('lobby_timeout_failed', { code: r.code, error: (e as Error).message });
      }
    }
    return started;
  }

  /**
   * Limpeza: sala esquecida no lobby é fechada (convites expiram) e sala fechada há muito tempo é
   * apagada, liberando o código.
   */
  async sweep(): Promise<{ expired: number; removed: number }> {
    const t = now();
    const stale = await this.prisma.room.findMany({
      where: { status: RoomStatus.WAITING, updatedAt: { lt: new Date(t - STALE_LOBBY_MS) } },
      select: { code: true },
      take: 500,
    });
    let expired = 0;
    for (const r of stale) {
      const invitees = await this.mutate(r.code, async (loaded, tx) => {
        if (loaded.room.status !== 'waiting') return [] as string[];
        await this.repo.save(tx, loaded, closeRoom(loaded.room, 'expired', now()));
        return [...loaded.inviterOf.keys()].map((u) => loaded.idOf.get(u)!).filter(Boolean);
      }).catch(() => null);
      if (invitees === null) continue;
      expired++;
      await this.afterRoomChange(r.code, invitees);
    }
    const removed = await this.prisma.room.deleteMany({
      where: {
        status: RoomStatus.CLOSED,
        updatedAt: { lt: new Date(t - CLOSED_ROOM_RETENTION_MS) },
      },
    });
    if (expired || removed.count) log.info('rooms_swept', { expired, removed: removed.count });
    return { expired, removed: removed.count };
  }

  /** Motivo público para quem olha uma sala fechada. */
  static closedReasonOf(reason: RoomClosedReason | null) {
    return reason?.toLowerCase() ?? null;
  }
}
