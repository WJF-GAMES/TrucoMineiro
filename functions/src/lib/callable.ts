import { CallableRequest, HttpsError, onCall } from 'firebase-functions/v2/https';
import { ENFORCE_APP_CHECK, REGION } from './admin';

export interface AuthedRequest<T> {
  uid: string;
  data: T;
  raw: CallableRequest<T>;
}

/**
 * Wraps a callable with the checks every critical function needs:
 * Authentication, App Check (enforced outside the emulator) and a typed payload.
 */
export function authedCallable<T, R>(
  handler: (req: AuthedRequest<T>) => Promise<R>,
  validate?: (data: unknown) => T,
) {
  return onCall<T, Promise<R>>(
    { region: REGION, enforceAppCheck: ENFORCE_APP_CHECK, consumeAppCheckToken: false },
    async (request) => {
      if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Faça login para continuar.');
      let data = request.data;
      if (validate) {
        try {
          data = validate(request.data);
        } catch (e) {
          throw new HttpsError('invalid-argument', (e as Error).message);
        }
      }
      return handler({ uid: request.auth.uid, data, raw: request });
    },
  );
}

export { HttpsError };

// --- Tiny validators (no external deps inside Functions) ---------------------

export function str(v: unknown, name: string, min = 1, max = 200): string {
  if (typeof v !== 'string' || v.length < min || v.length > max)
    throw new Error(`${name} inválido.`);
  return v;
}

export function bool(v: unknown, name: string): boolean {
  if (typeof v !== 'boolean') throw new Error(`${name} inválido.`);
  return v;
}

export function num(v: unknown, name: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${name} inválido.`);
  return v;
}

export function oneOf<T extends string>(v: unknown, values: readonly T[], name: string): T {
  if (typeof v !== 'string' || !values.includes(v as T)) throw new Error(`${name} inválido.`);
  return v as T;
}

export function obj(v: unknown, name: string): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(`${name} inválido.`);
  return v as Record<string, unknown>;
}
