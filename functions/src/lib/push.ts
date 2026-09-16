import { FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import { db, messaging } from './admin';

/** Tokens que o FCM declarou mortos: saem de `users/{uid}.fcmTokens` para não acumular. */
const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

export interface PushOptions {
  /**
   * Agrupa notificações da mesma coisa: reenviar o mesmo convite substitui a notificação anterior
   * no aparelho em vez de empilhar duas (Android `tag`, iOS `apns-collapse-id`).
   */
  collapseKey?: string;
  /** Validade da mensagem no FCM: um convite vencido não chega a quem liga o celular depois. */
  ttlMs?: number;
}

/**
 * Único ponto de envio de push. Sempre do servidor — o cliente só manda a intenção.
 * Vai para todos os aparelhos do usuário; os tokens recusados pelo FCM são apagados.
 * Falha de envio nunca derruba a operação que pediu o push.
 */
export async function pushTo(
  uid: string,
  title: string,
  body: string,
  data: Record<string, string>,
  options: PushOptions = {},
): Promise<void> {
  const user = (await db.doc(`users/${uid}`).get()).data() as
    { fcmTokens?: Record<string, unknown> } | undefined;
  const tokens = Object.keys(user?.fcmTokens ?? {});
  if (tokens.length === 0) return;
  const ttlSeconds = options.ttlMs ? Math.max(1, Math.round(options.ttlMs / 1000)) : undefined;
  try {
    const res = await messaging.sendEachForMulticast({
      tokens,
      notification: { title, body },
      data,
      android: {
        priority: 'high',
        ...(options.ttlMs ? { ttl: options.ttlMs } : {}),
        ...(options.collapseKey
          ? { collapseKey: options.collapseKey, notification: { tag: options.collapseKey } }
          : {}),
      },
      apns: {
        headers: {
          ...(options.collapseKey ? { 'apns-collapse-id': options.collapseKey.slice(0, 64) } : {}),
          ...(ttlSeconds
            ? { 'apns-expiration': String(Math.floor(Date.now() / 1000) + ttlSeconds) }
            : {}),
        },
        payload: { aps: { sound: 'default' } },
      },
    });
    const dead = res.responses
      .map((r, i) => (!r.success && DEAD_TOKEN_CODES.has(r.error?.code ?? '') ? tokens[i]! : null))
      .filter((t): t is string => t !== null);
    if (dead.length > 0) {
      await db
        .doc(`users/${uid}`)
        .update(Object.fromEntries(dead.map((t) => [`fcmTokens.${t}`, FieldValue.delete()])))
        .catch(() => undefined);
    }
  } catch (e) {
    logger.warn('push falhou', { uid, type: data.type, error: (e as Error).message });
  }
}
