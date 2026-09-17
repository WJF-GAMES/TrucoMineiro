import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { map, Observable } from 'rxjs';

export const RAW_RESPONSE = 'raw_response';
/** Rotas que respondem sem o envelope `{ data }` (health, métricas, webhooks). */
export const RawResponse = () => SetMetadata(RAW_RESPONSE, true);

/** Resposta de sucesso padronizada: `{ data: ... }`. */
@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const raw = this.reflector.getAllAndOverride<boolean>(RAW_RESPONSE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (raw) return next.handle();
    return next.handle().pipe(map((data: unknown) => ({ data: data ?? null })));
  }
}
