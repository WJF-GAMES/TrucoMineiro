import { Inject, Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { PresenceState } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AppConfig, CONFIG } from '../config/env';
import { RealtimeService } from '../realtime/realtime.service';
import { S2C, SERVER_EVENTS } from '../realtime/events';
import { moduleLogger } from '../common/logger';
import { MetricsService } from '../metrics/metrics.service';
import { FriendshipRepository } from '../friends/friendship.repository';
import { UserLookupService } from '../users/user-lookup.service';
import type { Presence, PresenceState as DomainPresenceState } from '../domain/model/types';

const log = moduleLogger('presence');
const HEARTBEAT_MS = 30_000;
const INSTANCE_DEAD_MS = 95_000;
const ONLINE_COUNT_CACHE_MS = 5_000;
const ONLINE_BROADCAST_MS = 10_000;

export const CLIENT_STATES = [
  'ONLINE',
  'IN_ROOM',
  'IN_MATCH',
  'BACKGROUND',
  'RECONNECTING',
] as const;
export type ClientPresenceState = (typeof CLIENT_STATES)[number];

/** O app conhece três estados: online, na partida, offline. O detalhe vai junto. */
export function toDomainPresence(
  state: PresenceState | null | undefined,
  updatedAt: Date | null | undefined,
  matchId: string | null | undefined,
): Presence & { detail: PresenceState } {
  const s = state ?? PresenceState.OFFLINE;
  const simple: DomainPresenceState =
    s === PresenceState.OFFLINE ? 'offline' : s === PresenceState.IN_MATCH ? 'in_match' : 'online';
  return {
    state: simple,
    lastChanged: updatedAt?.getTime() ?? 0,
    sessionId: matchId ?? null,
    detail: s,
  };
}

/**
 * Presença em tempo real. Estado efêmero: fica em memória por instância (quantos sockets cada
 * usuário tem aqui) e só vai ao PostgreSQL quando MUDA (conectou, caiu, entrou em partida) —
 * nunca em heartbeat por segundo. Cada instância grava um heartbeat próprio a cada 30 s; a
 * presença de uma instância morta é limpa pelas outras.
 */
@Injectable()
export class PresenceService implements OnModuleInit, OnApplicationShutdown {
  private readonly local = new Map<
    string,
    { sockets: number; state: PresenceState; uid: string }
  >();
  private heartbeat: NodeJS.Timeout | null = null;
  private onlineBroadcast: NodeJS.Timeout | null = null;
  private onlineCache = { value: 0, at: 0 };
  private lastBroadcast = -1;

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly metrics: MetricsService,
    private readonly friendships: FriendshipRepository,
    private readonly users: UserLookupService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  async onModuleInit() {
    this.metrics.gauge('ws_presence_users_local', () => this.local.size);
    this.metrics.gauge('presence_online_users', () => this.onlineCache.value);
    if (this.config.nodeEnv === 'test') return;
    await this.beat().catch((e: Error) => log.warn('heartbeat_failed', { error: e.message }));
    this.heartbeat = setInterval(() => {
      void this.beat().catch((e: Error) => log.warn('heartbeat_failed', { error: e.message }));
    }, HEARTBEAT_MS);
    this.heartbeat.unref();
    this.onlineBroadcast = setInterval(() => void this.broadcastOnlineCount(), ONLINE_BROADCAST_MS);
    this.onlineBroadcast.unref();
  }

  async onApplicationShutdown() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.onlineBroadcast) clearInterval(this.onlineBroadcast);
    await this.releaseInstance().catch(() => undefined);
  }

  get instanceId() {
    return this.config.instanceId;
  }

  private async beat() {
    await this.prisma.backendInstance.upsert({
      where: { id: this.instanceId },
      create: { id: this.instanceId },
      update: { heartbeatAt: new Date() },
    });
    await this.reapDeadInstances();
  }

  /** Presença de instâncias que pararam de bater vira OFFLINE. */
  async reapDeadInstances(): Promise<number> {
    const dead = await this.prisma.backendInstance.findMany({
      where: { heartbeatAt: { lt: new Date(Date.now() - INSTANCE_DEAD_MS) } },
      select: { id: true },
    });
    if (dead.length === 0) return 0;
    const ids = dead.map((d) => d.id);
    const orphaned = await this.prisma.userPresence.findMany({
      where: { instanceId: { in: ids }, state: { not: PresenceState.OFFLINE } },
      select: { userId: true, user: { select: { firebaseUid: true } } },
    });
    await this.prisma.userPresence.updateMany({
      where: { instanceId: { in: ids } },
      data: { state: PresenceState.OFFLINE, sockets: 0, instanceId: null },
    });
    await this.prisma.backendInstance.deleteMany({ where: { id: { in: ids } } });
    for (const o of orphaned) this.emitChange(o.user.firebaseUid, PresenceState.OFFLINE, null);
    log.info('dead_instances_reaped', { instances: ids.length, users: orphaned.length });
    return orphaned.length;
  }

  /** Desligamento ordenado: tudo o que esta instância segurava fica offline. */
  async releaseInstance() {
    const mine = [...this.local.entries()];
    this.local.clear();
    await this.prisma.userPresence.updateMany({
      where: { instanceId: this.instanceId },
      data: { state: PresenceState.OFFLINE, sockets: 0, instanceId: null },
    });
    await this.prisma.backendInstance.deleteMany({ where: { id: this.instanceId } });
    for (const [, v] of mine) this.emitChange(v.uid, PresenceState.OFFLINE, null);
  }

  private emitChange(uid: string, state: PresenceState, _matchId: string | null) {
    // A sala de presença pode ter quem não é amigo: o evento não leva em qual partida o jogador está.
    this.realtime.toPresenceWatchers(uid, S2C.presenceChanged, {
      uid,
      presence: toDomainPresence(state, new Date(), null),
    });
  }

  /**
   * Presença que `viewerId` pode ver: bloqueio (em qualquer sentido) esconde o jogador; só amigos
   * veem em qual partida ele está. Devolve também os uids liberados (para assinar a sala).
   */
  async visibleFor(
    viewerId: string,
    uids: string[],
  ): Promise<{ presence: Record<string, Presence>; allowed: string[] }> {
    const ids = await this.users.idsOf(uids.slice(0, 200));
    const [blocked, friends] = await Promise.all([
      this.friendships.blockedSet(viewerId),
      this.friendships.friendIds(viewerId),
    ]);
    const friendSet = new Set(friends);
    const visible = [...ids].filter(([, id]) => id !== viewerId && !blocked.has(id));
    const states = await this.statesOf(visible.map(([, id]) => id));
    const presence: Record<string, Presence> = {};
    for (const [uid, id] of visible) {
      const p = states.get(id);
      if (!p) continue;
      presence[uid] = {
        state: p.state,
        lastChanged: p.lastChanged,
        sessionId: friendSet.has(id) ? p.sessionId : null,
      };
    }
    return { presence, allowed: visible.map(([uid]) => uid) };
  }

  private async write(userId: string, uid: string, state: PresenceState, matchId: string | null) {
    await this.prisma.userPresence.upsert({
      where: { userId },
      create: { userId, state, matchId, instanceId: this.instanceId },
      update: {
        state,
        matchId,
        instanceId: state === PresenceState.OFFLINE ? null : this.instanceId,
      },
    });
    this.metrics.inc('presence_writes_total');
    this.emitChange(uid, state, matchId);
    this.onlineCache.at = 0;
  }

  async connected(userId: string, uid: string) {
    const entry = this.local.get(userId);
    if (entry) {
      entry.sockets++;
      return;
    }
    this.local.set(userId, { sockets: 1, state: PresenceState.ONLINE, uid });
    await this.write(userId, uid, PresenceState.ONLINE, null);
  }

  /**
   * `connectedElsewhere`: o usuário ainda tem socket em outra instância. Nesse caso não fica
   * offline; a instância que ainda o atende assume a presença (`reclaim`), senão a desconexão
   * dela depois não acharia a linha (dona errada) e o usuário ficaria "online" para sempre.
   */
  async disconnected(userId: string, uid: string, connectedElsewhere = false) {
    const entry = this.local.get(userId);
    if (!entry) return;
    entry.sockets--;
    if (entry.sockets > 0) return;
    this.local.delete(userId);
    if (connectedElsewhere) {
      this.realtime.serverSideEmit(SERVER_EVENTS.presenceReclaim, { userId });
      return;
    }
    // Só derruba se a presença ainda pertence a esta instância (o usuário pode ter reconectado em outra).
    const res = await this.prisma.userPresence.updateMany({
      where: { userId, instanceId: this.instanceId },
      data: { state: PresenceState.OFFLINE, instanceId: null, matchId: null },
    });
    if (res.count > 0) {
      this.emitChange(uid, PresenceState.OFFLINE, null);
      this.onlineCache.at = 0;
    }
  }

  /** Pedido de outra instância: se o usuário tem socket aqui, esta instância vira a dona. */
  async reclaim(userId: string) {
    const entry = this.local.get(userId);
    if (!entry) return;
    await this.prisma.userPresence.updateMany({
      where: { userId },
      data: { instanceId: this.instanceId, state: entry.state },
    });
  }

  /** O app informa o que está fazendo (na partida, na sala, em segundo plano). */
  async set(userId: string, uid: string, state: ClientPresenceState, matchId: string | null) {
    const entry = this.local.get(userId);
    const next = PresenceState[state];
    if (entry && entry.state === next && next !== PresenceState.IN_MATCH) return;
    if (entry) entry.state = next;
    await this.write(userId, uid, next, next === PresenceState.IN_MATCH ? matchId : null);
  }

  async statesOf(userIds: string[]): Promise<Map<string, Presence & { detail: PresenceState }>> {
    if (userIds.length === 0) return new Map();
    const rows = await this.prisma.userPresence.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true, state: true, updatedAt: true, matchId: true },
    });
    const byId = new Map(rows.map((r) => [r.userId, r]));
    return new Map(
      userIds.map((id) => {
        const r = byId.get(id);
        return [id, toDomainPresence(r?.state, r?.updatedAt, r?.matchId)];
      }),
    );
  }

  async onlineCount(): Promise<number> {
    if (Date.now() - this.onlineCache.at < ONLINE_COUNT_CACHE_MS) return this.onlineCache.value;
    const value = await this.prisma.userPresence.count({
      where: { state: { not: PresenceState.OFFLINE } },
    });
    this.onlineCache = { value, at: Date.now() };
    return value;
  }

  private async broadcastOnlineCount() {
    try {
      const count = await this.onlineCount();
      if (count === this.lastBroadcast) return;
      this.lastBroadcast = count;
      this.realtime.broadcast(S2C.onlineCount, { count });
    } catch {
      // banco fora: tenta no próximo ciclo
    }
  }
}
