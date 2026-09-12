import { Platform } from 'react-native';
import {
  AuthorizationStatus,
  getMessaging,
  getToken,
  onMessage,
  onTokenRefresh,
  requestPermission,
} from '@react-native-firebase/messaging';
import { firebaseApp } from './app';
import { registerDevice } from './functions';

const messaging = getMessaging(firebaseApp);

export type PushKind =
  'friend_invite' | 'room_invite' | 'reward' | 'league' | 'season' | 'news' | 'social';

/** Requests permission (iOS / Android 13+) and registers the token via Cloud Function. */
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
