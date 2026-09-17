import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';

/** Usuário autenticado anexado à requisição pelo `FirebaseAuthGuard`. */
export interface AuthUser {
  /** UUID interno. */
  id: string;
  /** Identificador público (Firebase UID). */
  uid: string;
  phoneNumber: string | null;
}

/** Identidade verificada que ainda não tem usuário interno (só a rota de bootstrap aceita). */
export interface PendingIdentity {
  firebaseUid: string;
  phoneNumber: string | null;
}

export interface AuthedRequest extends Request {
  user?: AuthUser;
  identity?: PendingIdentity;
}

export const IS_PUBLIC = 'is_public';
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const ALLOW_UNREGISTERED = 'allow_unregistered';
/** A rota aceita um token válido cujo usuário interno ainda não existe (bootstrap). */
export const AllowUnregistered = () => SetMetadata(ALLOW_UNREGISTERED, true);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  const req = ctx.switchToHttp().getRequest<AuthedRequest>();
  return req.user!;
});

export const CurrentIdentity = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): PendingIdentity => {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    return req.identity!;
  },
);
