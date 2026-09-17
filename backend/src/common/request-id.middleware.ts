import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { moduleLogger } from './logger';
import { requestContext } from './request-context';
import type { MetricsService } from '../metrics/metrics.service';

const log = moduleLogger('http');
const QUIET = new Set(['/health', '/health/ready', '/metrics']);

/** Request id + log de acesso (sem query string: pode carregar token de convite). */
export function requestIdMiddleware(metrics: MetricsService) {
  return (req: Request, res: Response, next: NextFunction) => {
    const incoming = req.header('x-request-id');
    const requestId = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
    res.setHeader('x-request-id', requestId);
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
      const route = (req.route?.path as string | undefined) ?? 'unmatched';
      metrics.observeHttp(req.method, route, res.statusCode, durationMs);
      if (QUIET.has(req.path)) return;
      log.info('http_request', {
        requestId,
        method: req.method,
        route,
        status: res.statusCode,
        durationMs: Math.round(durationMs * 10) / 10,
      });
    });
    requestContext.run({ requestId }, next);
  };
}
