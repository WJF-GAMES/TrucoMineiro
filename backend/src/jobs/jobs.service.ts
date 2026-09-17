import { Inject, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { PrismaService } from '../prisma/prisma.service';
import { AppConfig, CONFIG } from '../config/env';
import { LeaguesService } from '../leagues/leagues.service';
import { RoomsService } from '../rooms/rooms.service';
import { MatchmakingService } from '../matchmaking/matchmaking.service';
import { UsersService } from '../users/users.service';
import { PresenceService } from '../presence/presence.service';
import { JobLockService } from './job-lock.service';
import { moduleLogger } from '../common/logger';
import { now } from '../common/clock';
import { MetricsService } from '../metrics/metrics.service';
import { AppError } from '../common/errors';

const log = moduleLogger('jobs');

export const JOB_NAMES = [
  'league.weekly-rollover',
  'league.refresh-rankings',
  'league.repair',
  'rooms.sweep',
  'matchmaking.cleanup',
  'maintenance.prune',
  'accounts.reconcile',
  'presence.reap',
] as const;
export type JobName = (typeof JOB_NAMES)[number];

interface JobSpec {
  cron: string;
  lockMs: number;
}

/** Agenda (fuso America/Sao_Paulo). Com JOBS_MODE=external o Cloud Scheduler chama o webhook. */
const SPECS: Record<JobName, JobSpec> = {
  'league.weekly-rollover': { cron: '5 0 * * 1', lockMs: 30 * 60_000 },
  'league.refresh-rankings': { cron: '0 3 * * *', lockMs: 20 * 60_000 },
  'league.repair': { cron: '30 4 * * *', lockMs: 20 * 60_000 },
  'rooms.sweep': { cron: '*/5 * * * *', lockMs: 4 * 60_000 },
  'matchmaking.cleanup': { cron: '* * * * *', lockMs: 50_000 },
  'maintenance.prune': { cron: '17 * * * *', lockMs: 10 * 60_000 },
  'accounts.reconcile': { cron: '0 4 * * *', lockMs: 50 * 60_000 },
  'presence.reap': { cron: '*/2 * * * *', lockMs: 100_000 },
};

/**
 * Jobs de manutenção (substituem as Cloud Functions agendadas). Cada execução pega uma trava
 * entre instâncias (`JobLock`) e cada job é idempotente — rodar duas vezes não estraga nada.
 */
@Injectable()
export class JobsService implements OnApplicationBootstrap {
  constructor(
    private readonly prisma: PrismaService,
    private readonly locks: JobLockService,
    private readonly leagues: LeaguesService,
    private readonly rooms: RoomsService,
    private readonly matchmaking: MatchmakingService,
    private readonly users: UsersService,
    private readonly presence: PresenceService,
    private readonly registry: SchedulerRegistry,
    private readonly metrics: MetricsService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap() {
    if (this.config.jobsMode !== 'cron' || this.config.nodeEnv === 'test') return;
    for (const name of JOB_NAMES) {
      const job = CronJob.from({
        cronTime: SPECS[name].cron,
        timeZone: 'America/Sao_Paulo',
        onTick: () => void this.run(name).catch(() => undefined),
        start: true,
      });
      this.registry.addCronJob(name, job);
    }
    log.info('cron_jobs_started', { jobs: JOB_NAMES.length });
  }

  isJob(name: string): name is JobName {
    return (JOB_NAMES as readonly string[]).includes(name);
  }

  async run(name: JobName, payload: Record<string, unknown> = {}): Promise<unknown> {
    if (!this.isJob(name)) throw new AppError('NOT_FOUND', 'Job desconhecido.');
    const started = Date.now();
    try {
      const result = await this.locks.withLock(`job:${name}`, SPECS[name].lockMs, () => this.execute(name, payload));
      this.metrics.inc('jobs_total', { job: name, status: result === null ? 'skipped' : 'ok' });
      log.info('job_done', { job: name, durationMs: Date.now() - started, skipped: result === null });
      return result ?? { skipped: true };
    } catch (e) {
      this.metrics.inc('jobs_total', { job: name, status: 'failed' });
      log.error('job_failed', { job: name, error: (e as Error).message });
      throw e;
    }
  }

  private async execute(name: JobName, payload: Record<string, unknown>): Promise<unknown> {
    switch (name) {
      case 'league.weekly-rollover':
        return this.leagues.weeklyRollover(typeof payload.atMs === 'number' ? payload.atMs : now());
      case 'league.refresh-rankings':
        return { groups: await this.leagues.refreshRankings() };
      case 'league.repair':
        return this.leagues.repair();
      case 'rooms.sweep':
        return this.rooms.sweep();
      case 'matchmaking.cleanup':
        return { removed: await this.matchmaking.cleanup() };
      case 'accounts.reconcile':
        return { removed: await this.users.reconcileDeletedAccounts() };
      case 'presence.reap':
        return { users: await this.presence.reapDeadInstances() };
      case 'maintenance.prune':
        return this.prune();
    }
  }

  /** Limpeza de dados transitórios (idempotência, rate limit, notificações e webhooks antigos). */
  async prune() {
    const t = now();
    const [keys, buckets, notifications, webhooks, locks] = await Promise.all([
      this.prisma.idempotencyKey.deleteMany({ where: { expiresAt: { lt: new Date(t) } } }),
      this.prisma.rateLimitBucket.deleteMany({ where: { windowStart: { lt: new Date(t - 2 * 86_400_000) } } }),
      this.prisma.notification.deleteMany({ where: { createdAt: { lt: new Date(t - 90 * 86_400_000) } } }),
      this.prisma.webhookEvent.deleteMany({ where: { receivedAt: { lt: new Date(t - 30 * 86_400_000) } } }),
      this.prisma.jobLock.deleteMany({ where: { expiresAt: { lt: new Date(t - 86_400_000) } } }),
    ]);
    return {
      idempotencyKeys: keys.count,
      rateLimitBuckets: buckets.count,
      notifications: notifications.count,
      webhookEvents: webhooks.count,
      jobLocks: locks.count,
    };
  }
}
