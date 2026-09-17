import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { App, cert, getApps, initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth, Auth, UserRecord } from 'firebase-admin/auth';
import { getMessaging, Messaging, MulticastMessage, BatchResponse } from 'firebase-admin/messaging';
import { getAppCheck } from 'firebase-admin/app-check';
import { AppConfig, CONFIG } from '../config/env';
import { AppError } from '../common/errors';
import { moduleLogger } from '../common/logger';
import { sha256 } from '../common/ids';

const log = moduleLogger('firebase');

/** Identidade extraída do ID Token (Firebase Auth por telefone). */
export interface VerifiedIdentity {
  firebaseUid: string;
  phoneNumber: string | null;
  expiresAt: number;
}

const TOKEN_CACHE_MAX = 5_000;

/**
 * Único ponto de contato com o Firebase no backend: verificação do ID Token (Admin SDK),
 * consulta de contas no Auth, App Check e envio de push (FCM).
 * Firestore, Realtime Database e Cloud Functions não são usados.
 */
@Injectable()
export class FirebaseAdminService implements OnModuleInit {
  private app: App | null = null;
  private readonly tokenCache = new Map<string, VerifiedIdentity>();

  constructor(@Inject(CONFIG) private readonly config: AppConfig) {}

  onModuleInit() {
    if (this.config.authMode === 'test') return;
    this.ensureApp();
  }

  private ensureApp(): App {
    if (this.app) return this.app;
    const existing = getApps()[0];
    if (existing) {
      this.app = existing;
      return existing;
    }
    const json = this.config.firebaseServiceAccountJson;
    const credential = json
      ? cert(JSON.parse(json.startsWith('{') ? json : Buffer.from(json, 'base64').toString('utf8')))
      : process.env.FIREBASE_AUTH_EMULATOR_HOST
        ? undefined
        : applicationDefault();
    this.app = initializeApp({
      projectId: this.config.firebaseProjectId,
      ...(credential ? { credential } : {}),
    });
    log.info('firebase_admin_ready', {
      projectId: this.config.firebaseProjectId,
      emulator: Boolean(process.env.FIREBASE_AUTH_EMULATOR_HOST),
    });
    return this.app;
  }

  private get auth(): Auth {
    return getAuth(this.ensureApp());
  }

  private get messaging(): Messaging {
    return getMessaging(this.ensureApp());
  }

  /** Verifica o ID Token. Resultados válidos ficam em cache até expirarem (a verificação é local). */
  async verifyIdToken(token: string): Promise<VerifiedIdentity> {
    if (!token || token.length > 4096) throw new AppError('AUTH_TOKEN_INVALID', 'Sessão inválida.');
    const cacheKey = sha256(token);
    const cached = this.tokenCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now() + 5_000) return cached;
    if (cached) this.tokenCache.delete(cacheKey);

    const identity =
      this.config.authMode === 'test' ? this.verifyTestToken(token) : await this.verifyFirebaseToken(token);
    if (this.tokenCache.size >= TOKEN_CACHE_MAX) {
      const oldest = this.tokenCache.keys().next().value;
      if (oldest) this.tokenCache.delete(oldest);
    }
    this.tokenCache.set(cacheKey, identity);
    return identity;
  }

  private async verifyFirebaseToken(token: string): Promise<VerifiedIdentity> {
    try {
      const decoded = await this.auth.verifyIdToken(token);
      return {
        firebaseUid: decoded.uid,
        phoneNumber: typeof decoded.phone_number === 'string' ? decoded.phone_number : null,
        expiresAt: decoded.exp * 1000,
      };
    } catch (e) {
      const code = (e as { code?: string }).code ?? '';
      if (code === 'auth/id-token-expired')
        throw new AppError('AUTH_TOKEN_EXPIRED', 'Sua sessão expirou. Entre novamente.');
      if (code === 'auth/id-token-revoked' || code === 'auth/user-disabled')
        throw new AppError('AUTH_TOKEN_REVOKED', 'Sua sessão foi encerrada. Entre novamente.');
      if (code.startsWith('auth/'))
        throw new AppError('AUTH_TOKEN_INVALID', 'Sessão inválida. Entre novamente.');
      log.error('verify_id_token_failed', { error: (e as Error).message });
      throw new AppError('SERVICE_UNAVAILABLE', 'Não foi possível validar a sessão agora.');
    }
  }

  /**
   * Tokens de teste: `test:<firebaseUid>:<telefone E.164 ou vazio>`. `loadConfig` impede
   * AUTH_MODE=test fora de desenvolvimento/testes.
   */
  private verifyTestToken(token: string): VerifiedIdentity {
    const m = /^test:([\w-]{4,128}):(\+[1-9]\d{6,14})?$/.exec(token);
    if (!m) throw new AppError('AUTH_TOKEN_INVALID', 'Sessão inválida.');
    return { firebaseUid: m[1]!, phoneNumber: m[2] ?? null, expiresAt: Date.now() + 3_600_000 };
  }

  async verifyAppCheck(token: string | undefined): Promise<void> {
    if (!this.config.enforceAppCheck) return;
    if (!token) throw new AppError('APP_CHECK_INVALID', 'Aplicativo não verificado.');
    try {
      await getAppCheck(this.ensureApp()).verifyToken(token);
    } catch {
      throw new AppError('APP_CHECK_INVALID', 'Aplicativo não verificado.');
    }
  }

  /** Contas no Auth (até 100 por chamada). Em modo teste, toda conta existe com o telefone do token. */
  async getUsers(uids: string[]): Promise<{ users: Pick<UserRecord, 'uid' | 'phoneNumber' | 'disabled'>[]; notFound: string[] }> {
    if (uids.length === 0) return { users: [], notFound: [] };
    if (this.config.authMode === 'test') {
      return { users: uids.map((uid) => ({ uid, phoneNumber: testPhones.get(uid), disabled: false })), notFound: [] };
    }
    const res = await this.auth.getUsers(uids.map((uid) => ({ uid })));
    return {
      users: res.users,
      notFound: res.notFound.map((n) => ('uid' in n ? n.uid : '')).filter(Boolean),
    };
  }

  async deleteUser(uid: string): Promise<void> {
    if (this.config.authMode === 'test') {
      testPhones.delete(uid);
      return;
    }
    await this.auth.deleteUser(uid).catch((e: { code?: string }) => {
      if (e.code !== 'auth/user-not-found') throw e;
    });
  }

  async sendMulticast(message: MulticastMessage): Promise<BatchResponse> {
    return this.messaging.sendEachForMulticast(message);
  }

  /** Modo teste: registra o telefone "verificado" de uma conta (vem do token no bootstrap). */
  rememberTestPhone(uid: string, phone: string | null) {
    if (this.config.authMode !== 'test') return;
    if (phone) testPhones.set(uid, phone);
    else testPhones.delete(uid);
  }
}

const testPhones = new Map<string, string | undefined>();
