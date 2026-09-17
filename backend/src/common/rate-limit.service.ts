import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppError, MESSAGES } from './errors';
import { now } from './clock';

/**
 * Limites por usuário e ação, compartilhados entre instâncias (tabela `RateLimitBucket`).
 * Complementa o throttler HTTP global (por sessão, em memória por instância).
 */
@Injectable()
export class RateLimitService {
  constructor(private readonly prisma: PrismaService) {}

  /** Janela fixa: lança RATE_LIMITED quando o teto da janela já foi atingido. */
  async hit(userId: string, key: string, max: number, windowMs: number, message: string = MESSAGES.rateLimited) {
    const t = new Date(now());
    const cutoff = new Date(now() - windowMs);
    // Um único UPSERT atômico: reinicia a janela vencida, senão incrementa.
    const rows = await this.prisma.$queryRaw<{ count: number }[]>`
      INSERT INTO "RateLimitBucket" ("userId", "key", "count", "windowStart")
      VALUES (${userId}::uuid, ${key}, 1, ${t})
      ON CONFLICT ("userId", "key") DO UPDATE SET
        "count" = CASE WHEN "RateLimitBucket"."windowStart" < ${cutoff} THEN 1 ELSE "RateLimitBucket"."count" + 1 END,
        "windowStart" = CASE WHEN "RateLimitBucket"."windowStart" < ${cutoff} THEN ${t} ELSE "RateLimitBucket"."windowStart" END
      RETURNING "count"`;
    if ((rows[0]?.count ?? 0) > max) throw new AppError('RATE_LIMITED', message);
  }

  /**
   * Intervalo mínimo entre dois envios da mesma coisa (ex.: push do mesmo convite).
   * Devolve `false` quando ainda está no intervalo — quem chama só pula o envio.
   */
  async cooldown(userId: string, key: string, intervalMs: number): Promise<boolean> {
    const t = new Date(now());
    const cutoff = new Date(now() - intervalMs);
    const rows = await this.prisma.$queryRaw<{ ok: boolean }[]>`
      INSERT INTO "RateLimitBucket" ("userId", "key", "count", "windowStart")
      VALUES (${userId}::uuid, ${key}, 1, ${t})
      ON CONFLICT ("userId", "key") DO UPDATE SET "windowStart" = ${t}, "count" = 1
        WHERE "RateLimitBucket"."windowStart" < ${cutoff}
      RETURNING true AS ok`;
    return rows.length > 0;
  }
}
