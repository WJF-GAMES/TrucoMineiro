import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { sha256 } from './ids';

/**
 * Rate limit HTTP por sessão (hash do token), não por IP: vários jogadores atrás do mesmo NAT de
 * operadora não se atrapalham. Sem token (webhooks, health) vale o IP.
 */
@Injectable()
export class SessionThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const headers = (req.headers ?? {}) as Record<string, string | undefined>;
    const auth = headers.authorization;
    if (auth) return `auth:${sha256(auth).slice(0, 24)}`;
    return `ip:${String(req.ip ?? 'unknown')}`;
  }
}
