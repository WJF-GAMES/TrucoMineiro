import {
  getAuth,
  onAuthStateChanged as rnOnAuthStateChanged,
  signInWithPhoneNumber as rnSignInWithPhoneNumber,
  signOut as rnSignOut,
  connectAuthEmulator,
} from '@react-native-firebase/auth';
import type { ConfirmationResult, User } from '@react-native-firebase/auth';
import { EMULATOR_HOST, EMULATOR_PORTS, USE_EMULATORS, firebaseApp } from './app';

const auth = getAuth(firebaseApp);

if (USE_EMULATORS) {
  connectAuthEmulator(auth, `http://${EMULATOR_HOST}:${EMULATOR_PORTS.auth}`);
}

export type AuthUser = User;
export type PhoneConfirmation = ConfirmationResult;

export type AuthErrorCode =
  | 'provider-disabled'
  | 'app-not-authorized'
  | 'invalid-phone'
  | 'invalid-code'
  | 'code-expired'
  | 'too-many-requests'
  | 'network'
  | 'quota'
  | 'unknown';

export class AuthError extends Error {
  constructor(
    public code: AuthErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

function mapAuthError(e: unknown): AuthError {
  const err = e as { code?: string; message?: string };
  const code = err?.code ?? '';
  if (__DEV__) console.warn('[auth] firebase error', code, err?.message);
  if (code.includes('operation-not-allowed')) {
    return new AuthError(
      'provider-disabled',
      'Login por telefone não está habilitado neste projeto Firebase. Ative Authentication > Sign-in method > Phone.',
    );
  }
  if (code.includes('app-not-authorized') || code.includes('missing-client-identifier')) {
    return new AuthError(
      'app-not-authorized',
      'Este app não está autorizado no projeto Firebase (registre o pacote e o SHA-1 e baixe o google-services.json).',
    );
  }
  if (code.includes('invalid-phone-number'))
    return new AuthError('invalid-phone', 'Número de telefone inválido.');
  if (code.includes('invalid-verification-code'))
    return new AuthError('invalid-code', 'Código inválido. Confira e tente de novo.');
  if (code.includes('session-expired') || code.includes('code-expired'))
    return new AuthError('code-expired', 'Esse código expirou. Peça um novo.');
  if (code.includes('too-many-requests'))
    return new AuthError(
      'too-many-requests',
      'Muitas tentativas. Aguarde um pouco antes de tentar de novo.',
    );
  if (code.includes('network-request-failed'))
    return new AuthError('network', 'Sem conexão. Verifique sua internet.');
  if (code.includes('quota-exceeded'))
    return new AuthError('quota', 'Limite de envios atingido. Tente mais tarde.');
  return new AuthError('unknown', 'Não foi possível continuar. Tente novamente.');
}

/** Starts phone verification; Firebase sends the SMS (or uses the configured test number). */
export async function signInWithPhoneNumber(e164: string): Promise<PhoneConfirmation> {
  try {
    return await rnSignInWithPhoneNumber(auth, e164);
  } catch (e) {
    throw mapAuthError(e);
  }
}

export async function confirmCode(
  confirmation: PhoneConfirmation,
  code: string,
): Promise<AuthUser> {
  try {
    const cred = await confirmation.confirm(code);
    if (!cred?.user) throw new AuthError('unknown', 'Falha ao confirmar o código.');
    return cred.user;
  } catch (e) {
    if (e instanceof AuthError) throw e;
    throw mapAuthError(e);
  }
}

export function onAuthStateChanged(cb: (user: AuthUser | null) => void): () => void {
  return rnOnAuthStateChanged(auth, cb);
}

export function currentUser(): AuthUser | null {
  return auth.currentUser;
}

export async function signOut(): Promise<void> {
  await rnSignOut(auth);
}

export async function getIdToken(): Promise<string | null> {
  return auth.currentUser ? auth.currentUser.getIdToken() : null;
}
