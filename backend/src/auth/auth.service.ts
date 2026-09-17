import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FirebaseAdminService } from '../firebase/firebase-admin.service';
import { AppError } from '../common/errors';
import type { AuthUser, PendingIdentity } from './auth.decorators';

const USER_CACHE_TTL_MS = 10 * 60_000;
const USER_CACHE_MAX = 20_000;

/**
 * Resolve o token do Firebase no usuário interno. O mapa firebaseUid → id é imutável (só some
 * quando a conta é apagada), então fica em cache por instância.
 */
@Injectable()
export class AuthService {
  private readonly cache = new Map<string, { id: string; at: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly firebase: FirebaseAdminService,
  ) {}

  extractBearer(header: string | undefined): string {
    if (!header) throw new AppError('AUTH_TOKEN_MISSING', 'Faça login para continuar.');
    const m = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (!m) throw new AppError('AUTH_TOKEN_MISSING', 'Faça login para continuar.');
    return m[1]!.trim();
  }

  async verify(token: string): Promise<PendingIdentity> {
    const identity = await this.firebase.verifyIdToken(token);
    return { firebaseUid: identity.firebaseUid, phoneNumber: identity.phoneNumber };
  }

  /** `null` quando o usuário ainda não passou pelo bootstrap. */
  async resolve(identity: PendingIdentity): Promise<AuthUser | null> {
    const hit = this.cache.get(identity.firebaseUid);
    if (hit && Date.now() - hit.at < USER_CACHE_TTL_MS) {
      return { id: hit.id, uid: identity.firebaseUid, phoneNumber: identity.phoneNumber };
    }
    const user = await this.prisma.user.findUnique({
      where: { firebaseUid: identity.firebaseUid },
      select: { id: true },
    });
    if (!user) return null;
    this.remember(identity.firebaseUid, user.id);
    return { id: user.id, uid: identity.firebaseUid, phoneNumber: identity.phoneNumber };
  }

  async authenticate(token: string): Promise<AuthUser> {
    const identity = await this.verify(token);
    const user = await this.resolve(identity);
    if (!user) throw new AppError('USER_NOT_FOUND', 'Conta não encontrada. Entre novamente.');
    return user;
  }

  remember(firebaseUid: string, id: string) {
    if (this.cache.size >= USER_CACHE_MAX) {
      const oldest = this.cache.keys().next().value;
      if (oldest) this.cache.delete(oldest);
    }
    this.cache.set(firebaseUid, { id, at: Date.now() });
  }

  forget(firebaseUid: string) {
    this.cache.delete(firebaseUid);
  }
}
