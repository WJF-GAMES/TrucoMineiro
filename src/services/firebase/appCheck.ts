import {
  initializeAppCheck,
  ReactNativeFirebaseAppCheckProvider,
} from '@react-native-firebase/app-check';
import { firebaseApp } from './app';

/**
 * App Check: Play Integrity (Android) / App Attest (iOS) in production, debug provider in dev.
 * The debug token is printed in the native logs and must be registered in the Firebase console.
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
    await initializeAppCheck(firebaseApp, { provider, isTokenAutoRefreshEnabled: true });
  } catch {
    // App Check failures must not block the app; backend enforcement decides.
  }
}
