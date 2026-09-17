import { Platform } from 'react-native';
import {
  AuthorizationStatus,
  deleteToken,
  getInitialNotification,
  getMessaging,
  getToken,
  onMessage,
  onNotificationOpenedApp,
  onTokenRefresh,
  requestPermission,
  setBackgroundMessageHandler,
} from '@react-native-firebase/messaging';
import { firebaseApp } from './app';
import { registerDevice, unregisterDevice } from '@/services/api/backend';

const messaging = getMessaging(firebaseApp);

export type PushKind =
  'friend_invite' | 'room_invite' | 'reward' | 'league' | 'season' | 'news' | 'social';

/** Pede permissão (iOS / Android 13+) e registra o token no backend. */
export async function setupPushNotifications(): Promise<() => void> {
  try {
    const status = await requestPermission(messaging);
    const granted =
      status === AuthorizationStatus.AUTHORIZED || status === AuthorizationStatus.PROVISIONAL;
    if (!granted) return () => undefined;
    const token = await getToken(messaging);
    if (token) await registerDevice(token, Platform.OS).catch(() => undefined);
  } catch {
    // Push is optional: failures never block the flow.
  }
  const unsubRefresh = onTokenRefresh(messaging, (t) => {
    registerDevice(t, Platform.OS).catch(() => undefined);
  });
  return unsubRefresh;
}

/**
 * Logout: o aparelho sai da lista de push da conta e o token local é descartado (o próximo login
 * gera outro). Nunca impede o logout.
 */
export async function releasePushToken(): Promise<void> {
  try {
    const token = await getToken(messaging);
    if (token) await unregisterDevice(token);
    await deleteToken(messaging);
  } catch {
    // Sem rede ou sem permissão: o servidor limpa tokens mortos no próximo envio.
  }
}

/**
 * Obrigatório no Android para mensagens com o app fechado. A notificação em si é exibida pelo
 * sistema; o que importa (abrir a sala) acontece quando o usuário toca nela.
 */
export function registerBackgroundPushHandler(): void {
  setBackgroundMessageHandler(messaging, async () => undefined);
}

export type PushData = Record<string, string>;

/**
 * Toque numa notificação: com o app fechado (`getInitialNotification`) ou em segundo plano
 * (`onNotificationOpenedApp`). Com o app aberto o FCM não mostra a notificação do sistema — o
 * convite aparece dentro do app — então não há banner duplicado.
 */
export function subscribePushOpens(cb: (data: PushData) => void): () => void {
  let active = true;
  getInitialNotification(messaging)
    .then((msg) => {
      if (active && msg?.data) cb(msg.data as PushData);
    })
    .catch(() => undefined);
  const unsub = onNotificationOpenedApp(messaging, (msg) => {
    if (msg?.data) cb(msg.data as PushData);
  });
  return () => {
    active = false;
    unsub();
  };
}

export function onForegroundMessage(
  cb: (title: string, body: string, data: Record<string, string>) => void,
) {
  return onMessage(messaging, async (msg) => {
    cb(
      msg.notification?.title ?? 'Truco Mineiro',
      msg.notification?.body ?? '',
      (msg.data ?? {}) as Record<string, string>,
    );
  });
}
