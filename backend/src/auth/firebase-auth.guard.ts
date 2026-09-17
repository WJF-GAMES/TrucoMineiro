import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService } from './auth.service';
import { FirebaseAdminService } from '../firebase/firebase-admin.service';
import { ALLOW_UNREGISTERED, AuthedRequest, IS_PUBLIC } from './auth.decorators';
import { AppError } from '../common/errors';

/**
 * Guard global: toda rota exige `Authorization: Bearer <Firebase ID Token>` (exceto `@Public()`).
 * Valida o token com o Admin SDK, confere o App Check (quando ligado), localiza o usuário interno
 * e o anexa à requisição.
 */
@Injectable()
export class FirebaseAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
    private readonly firebase: FirebaseAdminService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const token = this.auth.extractBearer(req.header('authorization'));
    const identity = await this.auth.verify(token);
    await this.firebase.verifyAppCheck(req.header('x-firebase-appcheck'));
    req.identity = identity;
    const user = await this.auth.resolve(identity);
    if (user) {
      req.user = user;
      return true;
    }
    if (this.reflector.getAllAndOverride<boolean>(ALLOW_UNREGISTERED, targets)) return true;
    throw new AppError('USER_NOT_FOUND', 'Conta não encontrada. Entre novamente.');
  }
}
