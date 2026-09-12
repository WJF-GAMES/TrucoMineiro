import {
  collection,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from '@react-native-firebase/firestore';
import { EMULATOR_HOST, EMULATOR_PORTS, USE_EMULATORS, firebaseApp } from './app';
import type {
  Achievement,
  FriendRequest,
  Friendship,
  League,
  MatchHistoryEntry,
  PlayerStats,
  Profile,
  Season,
  UserAchievements,
} from '@/domain/model/types';

export const db = getFirestore(firebaseApp);

if (USE_EMULATORS) {
  connectFirestoreEmulator(db, EMULATOR_HOST, EMULATOR_PORTS.firestore);
}

type Unsub = () => void;

function subscribeDoc<T>(
  path: string,
  cb: (data: T | null) => void,
  onError?: (e: Error) => void,
): Unsub {
  return onSnapshot(
    doc(db, path),
    (snap) => cb(snap.exists() ? ({ id: snap.id, ...snap.data() } as T) : null),
    (e) => onError?.(e as Error),
  );
}

// --- Profiles / stats --------------------------------------------------------

export const subscribeProfile = (
  uid: string,
  cb: (p: Profile | null) => void,
  onError?: (e: Error) => void,
) => subscribeDoc<Profile>(`profiles/${uid}`, cb, onError);

export const subscribeStats = (
  uid: string,
  cb: (s: PlayerStats | null) => void,
  onError?: (e: Error) => void,
) => subscribeDoc<PlayerStats>(`playerStats/${uid}`, cb, onError);

export async function getProfile(uid: string): Promise<Profile | null> {
  const snap = await getDoc(doc(db, 'profiles', uid));
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as Profile) : null;
}

export async function searchProfiles(term: string): Promise<Profile[]> {
  const normalized = term.trim().toLowerCase();
  if (normalized.length < 2) return [];
  const q = query(
    collection(db, 'profiles'),
    where('nicknameLower', '>=', normalized),
    where('nicknameLower', '<=', normalized + ''),
    limit(20),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Profile);
}

// --- Leagues / seasons -------------------------------------------------------

export async function getLeagues(): Promise<League[]> {
  const snap = await getDocs(query(collection(db, 'leagues'), orderBy('order', 'asc')));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as League);
}

export const subscribeCurrentSeason = (
  cb: (s: Season | null) => void,
  onError?: (e: Error) => void,
) => subscribeDoc<Season>('seasons/current', cb, onError);

export async function getGlobalRanking(max = 50): Promise<Profile[]> {
  const snap = await getDocs(
    query(collection(db, 'profiles'), orderBy('leaguePoints', 'desc'), limit(max)),
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Profile);
}

// --- Friends -----------------------------------------------------------------

export function subscribeFriends(
  uid: string,
  cb: (f: Friendship[]) => void,
  onError?: (e: Error) => void,
): Unsub {
  return onSnapshot(
    collection(db, 'friendships', uid, 'friends'),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Friendship)),
    (e) => onError?.(e as Error),
  );
}

export function subscribeIncomingRequests(
  uid: string,
  cb: (r: FriendRequest[]) => void,
  onError?: (e: Error) => void,
): Unsub {
  const q = query(
    collection(db, 'friendRequests'),
    where('to', '==', uid),
    where('status', '==', 'pending'),
  );
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as FriendRequest)),
    (e) => onError?.(e as Error),
  );
}

// --- History / achievements --------------------------------------------------

export async function getMatchHistory(uid: string, max = 30): Promise<MatchHistoryEntry[]> {
  const q = query(
    collection(db, 'matchHistory'),
    where('playerIds', 'array-contains', uid),
    orderBy('finishedAt', 'desc'),
    limit(max),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as MatchHistoryEntry);
}

export async function getAchievements(): Promise<Achievement[]> {
  const snap = await getDocs(query(collection(db, 'achievements'), orderBy('order', 'asc')));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Achievement);
}

export const subscribeUserAchievements = (uid: string, cb: (a: UserAchievements | null) => void) =>
  subscribeDoc<UserAchievements>(`userAchievements/${uid}`, cb);
