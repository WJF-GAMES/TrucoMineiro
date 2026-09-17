import { Inject, Injectable, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppConfig, CONFIG } from '../config/env';
import { GameService } from './game.service';
import { RoomsService } from '../rooms/rooms.service';
import { MatchmakingService } from '../matchmaking/matchmaking.service';
import { moduleLogger } from '../common/logger';
import { MetricsService } from '../metrics/metrics.service';
import { now } from '../common/clock';

const log = moduleLogger('scheduler');

/** Enquanto uma instância processa um tick, as outras não pegam a mesma partida. */
const LEASE_MS = 15_000;
const BATCH = 25;
const LOBBY_EVERY_TICKS = 2;
const MATCHMAKING_EVERY_TICKS = 3;

/**
 * Relógio do servidor para as partidas: IA, timeout de jogada, tolerância de desconexão e troca
 * de controlador. Cada partida guarda `nextTickAt`; esta instância:
 *  - agenda um timer local quando ela mesma calculou o próximo tick (baixa latência);
 *  - varre o banco a cada `SCHEDULER_POLL_MS` e "aluga" os ticks vencidos com
 *    `FOR UPDATE SKIP LOCKED` — nenhum tick fica órfão se uma instância cair ou reiniciar, e duas
 *    instâncias nunca processam o mesmo tick.
 */
@Injectable()
export class GameSchedulerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private poller: NodeJS.Timeout | null = null;
  private stopped = false;
  private polling = false;
  private tickCount = 0;
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly game: GameService,
    private readonly rooms: RoomsService,
    private readonly matchmaking: MatchmakingService,
    private readonly metrics: MetricsService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap() {
    this.game.onTickScheduled((matchId, at) => this.schedule(matchId, at));
    this.metrics.gauge('scheduler_local_timers', () => this.timers.size);
    if (this.config.nodeEnv === 'test' && process.env.SCHEDULER_ENABLED !== 'true') return;
    this.poller = setInterval(() => void this.poll(), this.config.schedulerPollMs);
    this.poller.unref();
  }

  async onApplicationShutdown() {
    this.stopped = true;
    if (this.poller) clearInterval(this.poller);
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    // Espera os ticks em andamento terminarem (desligamento ordenado).
    const deadline = Date.now() + 5_000;
    while (this.inFlight.size > 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
  }

  schedule(matchId: string, at: Date | null) {
    const existing = this.timers.get(matchId);
    if (existing) clearTimeout(existing);
    this.timers.delete(matchId);
    if (!at || this.stopped) return;
    const delay = Math.max(0, at.getTime() - Date.now());
    if (delay > 60_000) return; // o poller cuida de prazos longos
    const timer = setTimeout(() => {
      this.timers.delete(matchId);
      void this.claimAndRun([matchId]);
    }, delay + 5);
    timer.unref();
    this.timers.set(matchId, timer);
  }

  /** Aluga os ticks vencidos (entre instâncias) e processa. */
  private async claimAndRun(only?: string[]) {
    if (this.stopped) return;
    let ids: string[];
    const t = new Date(now());
    const lease = new Date(now() + LEASE_MS);
    try {
      const rows = only
        ? await this.prisma.$queryRaw<{ id: string }[]>`
            UPDATE "Match" SET "nextTickAt" = ${lease}
            WHERE id IN (
              SELECT id FROM "Match"
              WHERE id = ${only[0]}::uuid AND status = 'PLAYING' AND "nextTickAt" <= ${t}
              FOR UPDATE SKIP LOCKED
            )
            RETURNING id`
        : await this.prisma.$queryRaw<{ id: string }[]>`
            UPDATE "Match" SET "nextTickAt" = ${lease}
            WHERE id IN (
              SELECT id FROM "Match"
              WHERE status = 'PLAYING' AND "nextTickAt" <= ${t}
              ORDER BY "nextTickAt" ASC
              LIMIT ${BATCH}
              FOR UPDATE SKIP LOCKED
            )
            RETURNING id`;
      ids = rows.map((r) => r.id);
    } catch (e) {
      log.warn('claim_failed', { error: (e as Error).message });
      return;
    }
    await Promise.all(
      ids.map(async (id) => {
        if (this.inFlight.has(id)) return;
        this.inFlight.add(id);
        const started = Date.now();
        try {
          await this.game.processTick(id);
          this.metrics.inc('scheduler_ticks_total');
        } catch (e) {
          this.metrics.inc('scheduler_tick_failures_total');
          log.warn('tick_failed', { matchId: id, error: (e as Error).message });
        } finally {
          this.inFlight.delete(id);
          this.metrics.observe('scheduler_tick_duration_ms', Date.now() - started);
        }
      }),
    );
  }

  async poll() {
    if (this.polling || this.stopped) return;
    this.polling = true;
    try {
      await this.claimAndRun();
      this.tickCount++;
      if (this.tickCount % LOBBY_EVERY_TICKS === 0) await this.rooms.resolveExpiredLobbies();
      if (this.tickCount % MATCHMAKING_EVERY_TICKS === 0) await this.matchmaking.tryFormTable(null);
    } catch (e) {
      log.warn('poll_failed', { error: (e as Error).message });
    } finally {
      this.polling = false;
    }
  }

  /** Para os timers locais e espera os ticks em andamento (testes e manutenção). */
  async quiesce() {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    const deadline = Date.now() + 5_000;
    while (this.inFlight.size > 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
  }

  /** Testes: roda um ciclo completo imediatamente. */
  async runOnce() {
    await this.claimAndRun();
    await this.rooms.resolveExpiredLobbies();
    await this.matchmaking.tryFormTable(null);
  }
}
