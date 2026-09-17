import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import type { Request } from 'express';
import { AppConfig, CONFIG } from '../config/env';
import { AppError } from '../common/errors';

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Operações administrativas (seed, ligas, métricas): header `x-admin-secret`. */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(@Inject(CONFIG) private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const given = req.header('x-admin-secret') ?? '';
    if (!given || !safeEqual(given, this.config.adminSecret))
      throw new AppError('ADMIN_FORBIDDEN', 'forbidden');
    return true;
  }
}
