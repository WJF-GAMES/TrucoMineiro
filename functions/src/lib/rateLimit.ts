import { db, now } from './admin';
import { HttpsError } from './callable';

interface Bucket {
  count: number;
  windowStart: number;
}

/**
 * Janela fixa por usuário e ação, guardada em `rateLimits/{uid}` (fora do alcance do cliente).
 * `hit` lança `resource-exhausted` quando o teto da janela já foi atingido.
 */
export async function hitRateLimit(
  uid: string,
  key: string,
  max: number,
  windowMs: number,
  message = 'Muitas tentativas seguidas. Aguarde um pouco e tente de novo.',
): Promise<void> {
  const ref = db.doc(`rateLimits/${uid}`);
  const allowed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const buckets = ((snap.data() ?? {}) as Record<string, Bucket>) ?? {};
    const t = now();
    const current = buckets[key];
    const bucket: Bucket =
      current && t - current.windowStart < windowMs ? current : { count: 0, windowStart: t };
    if (bucket.count >= max) return false;
    tx.set(
      ref,
      { [key]: { count: bucket.count + 1, windowStart: bucket.windowStart } },
      { merge: true },
    );
    return true;
  });
  if (!allowed) throw new HttpsError('resource-exhausted', message);
}

/**
 * Intervalo mínimo entre dois envios da mesma coisa (ex.: push para o mesmo amigo).
 * Devolve `false` quando ainda está no intervalo — quem chama só pula o envio, sem erro.
 */
export async function takeCooldown(uid: string, key: string, intervalMs: number): Promise<boolean> {
  const ref = db.doc(`rateLimits/${uid}`);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const last = ((snap.data() ?? {}) as Record<string, number>)[key];
    const t = now();
    if (typeof last === 'number' && t - last < intervalMs) return false;
    tx.set(ref, { [key]: t }, { merge: true });
    return true;
  });
}
