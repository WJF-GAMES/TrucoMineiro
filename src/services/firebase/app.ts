import { Platform } from 'react-native';
import { getApp } from '@react-native-firebase/app';

/**
 * Firebase app bootstrap. The native SDKs read google-services.json / GoogleService-Info.plist,
 * so no config object lives in JS (and never a service account).
 *
 * O Firebase ficou só com Auth (telefone), FCM, Analytics, Crashlytics, Performance, Remote Config
 * e App Check. Dados e regras vivem no backend NestJS (`src/services/api`).
 */
export const firebaseApp = getApp();

/** When EXPO_PUBLIC_USE_EMULATORS=1 the app targets the local Auth emulator. */
export const USE_EMULATORS = __DEV__ && process.env.EXPO_PUBLIC_USE_EMULATORS === '1';

/** Android emulator reaches the host machine at 10.0.2.2; iOS simulator uses localhost. */
export const EMULATOR_HOST =
  process.env.EXPO_PUBLIC_EMULATOR_HOST ?? (Platform.OS === 'android' ? '10.0.2.2' : 'localhost');

export const EMULATOR_PORTS = {
  auth: 9099,
} as const;
