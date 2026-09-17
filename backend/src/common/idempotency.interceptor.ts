import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { catchError, from, mergeMap, Observable, of, switchMap } from 'rxjs';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthedRequest } from '../auth/auth.decorators';
import { AppError } from './errors';
import { now } from './clock';

const TTL_MS = 24 * 60 * 60_000;
/** Reserva sem resposta há mais que isso = requisição que morreu no meio; pode ser refeita. */
const PENDING_STALE_MS = 60_000;
/** `statusCode` da linha enquanto a requisição original ainda está executando. */
const PENDING = 0;
const KEY_RE = /^[\w:.-]{8,120}$/;

type Reservation = { replay: false } | { replay: true; statusCode: number; data: unknown };

/**
 * `Idempotency-Key` em requisições mutáveis (POST/PATCH/DELETE): a mesma chave do mesmo usuário
 * devolve a mesma resposta por 24 h, sem executar de novo (retry do app, clique duplo).
 *
 * A chave é RESERVADA antes de executar (insert com a PK `userId + key`): duas requisições
 * simultâneas com a mesma chave nunca executam as duas — a segunda recebe `CONFLICT` enquanto a
 * primeira não termina. Erro não fica gravado (a reserva é liberada e o app pode tentar de novo).
 * A resposta é guardada sem envelope; o ResponseInterceptor reembrulha.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const key = req.header('idempotency-key');
    if (!key || req.method === 'GET' || !req.user) return next.handle();
    if (!KEY_RE.test(key)) throw new AppError('VALIDATION_FAILED', 'Idempotency-Key inválida.');
    const userId = req.user.id;
    const route = `${req.method} ${(req.route?.path as string | undefined) ?? req.path}`.slice(
      0,
      160,
    );
    const res = context.switchToHttp().getResponse<Response>();
    const where = { userId_key: { userId, key } };

    return from(this.reserve(userId, key, route)).pipe(
      switchMap((r) => {
        if (r.replay) {
          res.status(r.statusCode);
          res.setHeader('idempotent-replay', 'true');
          return of(r.data);
        }
        return next.handle().pipe(
          mergeMap(async (data) => {
            await this.prisma.idempotencyKey
              .update({
                where,
                data: {
                  statusCode: res.statusCode,
                  response: { data: data ?? null } as Prisma.InputJsonValue,
                  expiresAt: new Date(now() + TTL_MS),
                },
              })
              .catch(() => undefined);
            return data;
          }),
          catchError(async (e: unknown) => {
            await this.prisma.idempotencyKey
              .deleteMany({ where: { userId, key, statusCode: PENDING } })
              .catch(() => undefined);
            throw e;
          }),
        );
      }),
    );
  }

  private async reserve(userId: string, key: string, route: string): Promise<Reservation> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const t = now();
      const inserted = await this.prisma.idempotencyKey.createMany({
        data: [
          {
            userId,
            key,
            route,
            statusCode: PENDING,
            expiresAt: new Date(t + TTL_MS),
            createdAt: new Date(t),
          },
        ],
        skipDuplicates: true,
      });
      if (inserted.count === 1) return { replay: false };

      const hit = await this.prisma.idempotencyKey.findUnique({
        where: { userId_key: { userId, key } },
      });
      if (!hit) continue; // apagada entre as duas consultas: tenta reservar de novo
      const expired = hit.expiresAt.getTime() <= t;
      const stalePending =
        hit.statusCode === PENDING && hit.createdAt.getTime() < t - PENDING_STALE_MS;
      if (expired || stalePending) {
        // Só um dos concorrentes consegue apagar a linha velha; o outro cai na checagem acima.
        await this.prisma.idempotencyKey.deleteMany({
          where: { userId, key, createdAt: hit.createdAt, statusCode: hit.statusCode },
        });
        continue;
      }
      if (hit.route !== route)
        throw new AppError('VALIDATION_FAILED', 'Idempotency-Key reutilizada em outra rota.');
      if (hit.statusCode === PENDING)
        throw new AppError(
          'CONFLICT',
          'Essa ação ainda está sendo processada. Tente de novo em instantes.',
        );
      return {
        replay: true,
        statusCode: hit.statusCode,
        data: (hit.response as { data?: unknown } | null)?.data ?? null,
      };
    }
    throw new AppError(
      'CONFLICT',
      'Essa ação ainda está sendo processada. Tente de novo em instantes.',
    );
  }
}
