import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { AppError, ErrorKind, KIND_STATUS } from './errors';
import { moduleLogger } from './logger';
import { currentRequestId } from './request-context';
import { MetricsService } from '../metrics/metrics.service';

const log = moduleLogger('http');

export interface ErrorBody {
  error: { code: string; kind: ErrorKind; message: string; requestId?: string; details?: unknown };
}

const DB_UNAVAILABLE = new Set(['P1001', 'P1002', 'P1008', 'P1017', 'P2024']);

export function isDatabaseUnavailable(e: unknown): boolean {
  return (
    e instanceof Prisma.PrismaClientInitializationError ||
    e instanceof Prisma.PrismaClientRustPanicError ||
    (e instanceof Prisma.PrismaClientKnownRequestError && DB_UNAVAILABLE.has(e.code)) ||
    (e instanceof Prisma.PrismaClientUnknownRequestError &&
      /connect|connection|terminat/i.test(e.message))
  );
}

function kindForStatus(status: number): ErrorKind {
  if (status === 400 || status === 413 || status === 415 || status === 422)
    return 'invalid-argument';
  if (status === 401) return 'unauthenticated';
  if (status === 403) return 'permission-denied';
  if (status === 404) return 'not-found';
  if (status === 409) return 'already-exists';
  if (status === 429) return 'resource-exhausted';
  if (status === 503) return 'unavailable';
  if (status >= 500) return 'internal';
  return 'failed-precondition';
}

/** Converte qualquer exceção no formato padrão. Nunca vaza stack nem SQL para o cliente. */
export function toErrorBody(exception: unknown): { status: number; body: ErrorBody } {
  const requestId = currentRequestId();
  if (exception instanceof AppError) {
    return {
      status: exception.status,
      body: {
        error: {
          code: exception.code,
          kind: exception.kind,
          message: exception.message,
          requestId,
          ...(exception.details ? { details: exception.details } : {}),
        },
      },
    };
  }
  if (exception instanceof ThrottlerException) {
    return {
      status: 429,
      body: {
        error: {
          code: 'RATE_LIMITED',
          kind: 'resource-exhausted',
          message: 'Muitas requisições. Aguarde um pouco.',
          requestId,
        },
      },
    };
  }
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const res = exception.getResponse() as { message?: string | string[] } | string;
    const raw = typeof res === 'string' ? res : res.message;
    const message = Array.isArray(raw) ? raw.join('; ') : (raw ?? exception.message);
    const kind = kindForStatus(status);
    // Códigos genéricos por família (erros do framework: corpo grande, rota inexistente, etc.).
    const code =
      kind === 'invalid-argument'
        ? 'VALIDATION_FAILED'
        : kind === 'not-found' || status === 405
          ? 'NOT_FOUND'
          : kind === 'resource-exhausted'
            ? 'RATE_LIMITED'
            : kind === 'permission-denied'
              ? 'FORBIDDEN'
              : 'INTERNAL_ERROR';
    return { status, body: { error: { code, kind, message, requestId } } };
  }
  if (isDatabaseUnavailable(exception)) {
    return {
      status: KIND_STATUS.unavailable,
      body: {
        error: {
          code: 'SERVICE_UNAVAILABLE',
          kind: 'unavailable',
          message: 'Serviço temporariamente indisponível. Tente novamente.',
          requestId,
        },
      },
    };
  }
  if (
    exception instanceof Prisma.PrismaClientKnownRequestError &&
    ['P2034', 'P2002'].includes(exception.code)
  ) {
    return {
      status: 409,
      body: {
        error: {
          code: 'CONFLICT',
          kind: 'aborted',
          message: 'Conflito de escrita. Tente de novo.',
          requestId,
        },
      },
    };
  }
  return {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    body: {
      error: {
        code: 'INTERNAL_ERROR',
        kind: 'internal',
        message: 'Algo deu errado. Tente novamente.',
        requestId,
      },
    },
  };
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly metrics: MetricsService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    if (host.getType() !== 'http') throw exception;
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const { status, body } = toErrorBody(exception);
    if (status >= 400 && status < 500) {
      // Sem isso, uma recusa em produção vira só um número no log de acesso.
      log.warn('request_rejected', {
        requestId: body.error.requestId,
        method: req.method,
        route: (req.route?.path as string | undefined) ?? 'unmatched',
        status,
        code: body.error.code,
        detail: body.error.message.slice(0, 200),
      });
    }
    if (status >= 500) {
      log.error('request_failed', {
        requestId: body.error.requestId,
        method: req.method,
        route: (req.route?.path as string | undefined) ?? 'unmatched',
        status,
        error:
          exception instanceof Error
            ? { name: exception.name, message: exception.message }
            : String(exception),
        stack:
          exception instanceof Error
            ? exception.stack?.split('\n').slice(0, 8).join(' | ')
            : undefined,
      });
    }
    if (!res.headersSent) res.status(status).json(body);
  }
}
