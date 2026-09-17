import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { AppConfig, CONFIG } from '../config/env';
import { moduleLogger } from '../common/logger';
import { MetricsService } from '../metrics/metrics.service';
import { lockKey } from '../common/ids';

const log = moduleLogger('prisma');

export type Tx = Prisma.TransactionClient;

/**
 * Cliente Prisma único por processo. O pool é configurado pela própria `DATABASE_URL`
 * (`connection_limit`, `pool_timeout`) — ver docs/database.md.
 * Em desenvolvimento, queries lentas (> SLOW_QUERY_MS) são registradas.
 */
@Injectable()
export class PrismaService
  extends PrismaClient<Prisma.PrismaClientOptions, 'query' | 'warn' | 'error'>
  implements OnModuleInit, OnModuleDestroy
{
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly metrics: MetricsService,
  ) {
    super({
      datasourceUrl: config.databaseUrl,
      log: [
        { emit: 'event', level: 'query' },
        { emit: 'event', level: 'warn' },
        { emit: 'event', level: 'error' },
      ],
    });
    this.$on('query', (e) => {
      this.metrics.observe('db_query_duration_ms', e.duration);
      if (e.duration >= this.config.slowQueryMs) {
        this.metrics.inc('db_slow_queries_total');
        if (this.config.nodeEnv !== 'production')
          log.warn('slow_query', { durationMs: e.duration, query: e.query.slice(0, 300) });
      }
    });
    this.$on('warn', (e) => log.warn('prisma_warn', { message: e.message }));
    this.$on('error', (e) => log.error('prisma_error', { message: e.message }));
  }

  async onModuleInit() {
    try {
      await this.$connect();
    } catch (e) {
      // Sobe mesmo sem banco: o readiness responde 503 e as rotas devolvem SERVICE_UNAVAILABLE
      // até o banco voltar (o Prisma reconecta sozinho na próxima query).
      log.error('db_connect_failed', { error: (e as Error).message });
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * Transação interativa com repetição em conflito de serialização/deadlock.
   * Toda operação crítica (partida, amizade, liga, sala) passa por aqui.
   */
  async tx<T>(fn: (tx: Tx) => Promise<T>, opts: { timeoutMs?: number; retries?: number } = {}): Promise<T> {
    const retries = opts.retries ?? 3;
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.$transaction(fn, {
          maxWait: 5_000,
          timeout: opts.timeoutMs ?? 15_000,
          isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        });
      } catch (e) {
        const retryable =
          e instanceof Prisma.PrismaClientKnownRequestError &&
          (e.code === 'P2034' || /deadlock|could not serialize/i.test(e.message));
        if (!retryable || attempt >= retries) throw e;
        this.metrics.inc('db_tx_retries_total');
        await new Promise((r) => setTimeout(r, 20 * (attempt + 1) + Math.random() * 30));
      }
    }
  }

  /** Trava exclusiva até o fim da transação (entre instâncias). */
  async advisoryLock(tx: Tx, name: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey(name)})`;
  }

  async ping(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
