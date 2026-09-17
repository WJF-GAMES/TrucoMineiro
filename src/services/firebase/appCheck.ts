import {
  getToken,
  initializeAppCheck,
  ReactNativeFirebaseAppCheckProvider,
} from '@react-native-firebase/app-check';
import { firebaseApp } from './app';

type AppCheckInstance = Awaited<ReturnType<typeof initializeAppCheck>>;
let instance: AppCheckInstance | null = null;

/**
 * App Check: Play Integrity (Android) / App Attest (iOS) in production, debug provider in dev.
 * The debug token is printed in the native logs and must be registered in the Firebase console.
 * O token vai no header `X-Firebase-AppCheck` das chamadas ao backend, que decide se exige.
 */
export async function initAppCheck(): Promise<void> {
  const provider = new ReactNativeFirebaseAppCheckProvider();
  provider.configure({
    android: {
      provider: __DEV__ ? 'debug' : 'playIntegrity',
      debugToken: process.env.EXPO_PUBLIC_APPCHECK_DEBUG_TOKEN,
    },
    apple: {
      provider: __DEV__ ? 'debug' : 'appAttestWithDeviceCheckFallback',
      debugToken: process.env.EXPO_PUBLIC_APPCHECK_DEBUG_TOKEN,
    },
  });
  try {
    instance = await initializeAppCheck(firebaseApp, { provider, isTokenAutoRefreshEnabled: true });
  } catch {
    // App Check failures must not block the app; backend enforcement decides.
  }
}

/** Token atual do App Check (ou `null` — o backend só exige quando ENFORCE_APP_CHECK=true). */
export async function getAppCheckToken(): Promise<string | null> {
  if (!instance) return null;
  try {
    const res = (await getToken(instance, false)) as { token?: string } | string | undefined;
    const token = typeof res === 'string' ? res : res?.token;
    return token || null;
  } catch {
    return null;
  }
}
