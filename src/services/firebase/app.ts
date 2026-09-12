import { Platform } from 'react-native';
import { getApp } from '@react-native-firebase/app';

/**
 * Firebase app bootstrap. The native SDKs read google-services.json / GoogleService-Info.plist,
 * so no config object lives in JS (and never a service account).
 */
export const firebaseApp = getApp();

export const FUNCTIONS_REGION = 'southamerica-east1';

/** When EXPO_PUBLIC_USE_EMULATORS=1 the app targets the local Emulator Suite. */
export const USE_EMULATORS = __DEV__ && process.env.EXPO_PUBLIC_USE_EMULATORS === '1';

/** Android emulator reaches the host machine at 10.0.2.2; iOS simulator uses localhost. */
export const EMULATOR_HOST =
  process.env.EXPO_PUBLIC_EMULATOR_HOST ?? (Platform.OS === 'android' ? '10.0.2.2' : 'localhost');

export const EMULATOR_PORTS = {
  auth: 9099,
  firestore: 8080,
  database: 9000,
  functions: 5001,
  storage: 9199,
} as const;
