import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { moduleLogger } from '../common/logger';
import { now } from '../common/clock';

const log = moduleLogger('jobs');

/**
 * Trava lógica entre instâncias para operações longas (virada semanal, rebalanceamento).
 * Trava vencida é reaproveitada: uma instância que morreu no meio não trava o sistema.
 */
@Injectable()
export class JobLockService {
  constructor(private readonly prisma: PrismaService) {}

  async withLock<T>(id: string, ttlMs: number, run: () => Promise<T>): Promise<T | null> {
    const token = randomUUID();
    const t = new Date(now());
    const expires = new Date(now() + ttlMs);
    const acquired = await this.prisma.$executeRaw`
      INSERT INTO "JobLock" ("id", "token", "acquiredAt", "expiresAt")
      VALUES (${id}, ${token}, ${t}, ${expires})
      ON CONFLICT ("id") DO UPDATE SET "token" = ${token}, "acquiredAt" = ${t}, "expiresAt" = ${expires}
        WHERE "JobLock"."expiresAt" < ${t}`;
    if (acquired === 0) {
      log.info('lock_busy', { lockId: id });
      return null;
    }
    try {
      return await run();
    } finally {
      await this.prisma.jobLock.deleteMany({ where: { id, token } }).catch(() => undefined);
    }
  }
}
