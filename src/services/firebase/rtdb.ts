import {
  getDatabase,
  onDisconnect,
  onValue,
  ref,
  serverTimestamp,
  set,
  update,
} from '@react-native-firebase/database';
import { EMULATOR_HOST, EMULATOR_PORTS, USE_EMULATORS, firebaseApp } from './app';
import type {
  MatchmakingEntry,
  Presence,
  PresenceState,
  ProgressionResult,
  Room,
  SessionMeta,
} from '@/domain/model/types';
import type { SeatView } from '@/domain/game';

const RTDB_URL = 'https://truco-mineiro-wjf-default-rtdb.firebaseio.com';
const RTDB_NAMESPACE = 'truco-mineiro-wjf-default-rtdb';

/**
 * In emulator mode the instance is created straight from the emulator URL (with the namespace):
 * calling connectDatabaseEmulator on an instance built from a custom production URL is ignored by
 * the native SDK, which left the client permanently disconnected.
 */
export const rtdb = USE_EMULATORS
  ? getDatabase(
      firebaseApp,
      `http://${EMULATOR_HOST}:${EMULATOR_PORTS.database}?ns=${RTDB_NAMESPACE}`,
    )
  : getDatabase(firebaseApp, RTDB_URL);

type Unsub = () => void;

function subscribe<T>(
  path: string,
  cb: (v: T | null) => void,
  onError?: (e: Error) => void,
): Unsub {
  return onValue(
    ref(rtdb, path),
    (snap) => cb(snap.exists() ? (snap.val() as T) : null),
    (e) => onError?.(e as Error),
  );
}

// --- Presence ----------------------------------------------------------------

/** Publishes presence with an onDisconnect hook; returns a cleanup that marks the user offline. */
export function connectPresence(uid: string): Unsub {
  const presenceRef = ref(rtdb, `presence/${uid}`);
  const infoRef = ref(rtdb, '.info/connected');
  const unsub = onValue(infoRef, (snap) => {
    if (!snap.val()) return;
    onDisconnect(presenceRef)
      .set({ state: 'offline', lastChanged: serverTimestamp() } satisfies Omit<
        Presence,
        'lastChanged'
      > & { lastChanged: object })
      .then(() => set(presenceRef, { state: 'online', lastChanged: serverTimestamp() }))
      .catch(() => undefined);
  });
  return () => {
    unsub();
    set(presenceRef, { state: 'offline', lastChanged: serverTimestamp() }).catch(() => undefined);
  };
}

export function setPresenceState(
  uid: string,
  state: PresenceState,
  sessionId: string | null = null,
) {
  return update(ref(rtdb, `presence/${uid}`), { state, sessionId, lastChanged: serverTimestamp() });
}

export const subscribePresence = (uid: string, cb: (p: Presence | null) => void) =>
  subscribe<Presence>(`presence/${uid}`, cb);

/** Connection state of this client (used for the "Reconectando..." banner). */
export const subscribeConnection = (cb: (connected: boolean) => void): Unsub =>
  onValue(ref(rtdb, '.info/connected'), (snap) => cb(Boolean(snap.val())));

// --- Rooms / matchmaking / sessions ------------------------------------------

export const subscribeRoom = (
  code: string,
  cb: (r: Room | null) => void,
  onError?: (e: Error) => void,
) => subscribe<Room>(`rooms/${code}`, cb, onError);

export const subscribeMatchmaking = (
  uid: string,
  cb: (m: MatchmakingEntry | null) => void,
  onError?: (e: Error) => void,
) => subscribe<MatchmakingEntry>(`matchmaking/queue/${uid}`, cb, onError);

export const subscribeOnlineCount = (cb: (n: number) => void) =>
  subscribe<number>('stats/onlineCount', (v) => cb(v ?? 0));

export const subscribeSessionMeta = (
  sessionId: string,
  cb: (m: SessionMeta | null) => void,
  onError?: (e: Error) => void,
) => subscribe<SessionMeta>(`gameSessions/${sessionId}/meta`, cb, onError);

export const subscribeSeatView = (
  sessionId: string,
  seat: number,
  cb: (v: SeatView | null) => void,
  onError?: (e: Error) => void,
) => subscribe<SeatView>(`gameSessions/${sessionId}/views/${seat}`, cb, onError);

/** Marks this player connected inside a session and flips to false on disconnect. */
export function connectSessionPresence(sessionId: string, seat: number): Unsub {
  const r = ref(rtdb, `gameSessions/${sessionId}/meta/players/${seat}/connected`);
  onDisconnect(r)
    .set(false)
    .catch(() => undefined);
  set(r, true).catch(() => undefined);
  return () => {
    set(r, false).catch(() => undefined);
  };
}

export const subscribeSessionResult = (
  sessionId: string,
  seat: number,
  cb: (r: ProgressionResult | null) => void,
) => subscribe<ProgressionResult>(`gameSessions/${sessionId}/results/${seat}`, cb);

/** Index of the session a user is currently in (written by Functions), used to restore after a restart. */
export const subscribeActiveSession = (uid: string, cb: (sessionId: string | null) => void) =>
  subscribe<string>(`userSessions/${uid}/active`, cb);
