import {
  getCrashlytics,
  log,
  recordError,
  setAttributes,
  setUserId,
} from '@react-native-firebase/crashlytics';
import { firebaseApp } from './app';

const crashlytics = getCrashlytics(firebaseApp);

/** Allowed context keys. Phone numbers, OTPs, tokens and credentials must never be attached. */
export type CrashContext = Partial<{
  matchId: string;
  screen: string;
  gameMode: string;
  appVersion: string;
  state: string;
}>;

export function setCrashContext(ctx: CrashContext) {
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(ctx)) if (v !== undefined) clean[k] = String(v);
  setAttributes(crashlytics, clean).catch(() => undefined);
}

export function setCrashUser(uid: string | null) {
  setUserId(crashlytics, uid ?? '').catch(() => undefined);
}

export function crashLog(message: string) {
  log(crashlytics, message);
}

export function reportError(error: unknown, jsErrorName?: string) {
  const err = error instanceof Error ? error : new Error(String(error));
  recordError(crashlytics, err, jsErrorName);
}
