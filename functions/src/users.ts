import { FieldValue } from 'firebase-admin/firestore';
import { authedCallable, HttpsError, obj, oneOf, str } from './lib/callable';
import { auth, db, now, rtdb } from './lib/admin';
import { AVATAR_IDS, AvatarId, PlayerStats, Profile, xpForLevel } from './domain/model/types';

export const DEFAULT_COINS = 500;
export const DEFAULT_GEMS = 20;

export function defaultProfile(uid: string): Profile {
  return {
    id: uid,
    nickname: '',
    nicknameLower: '',
    avatarId: 'joao',
    level: 1,
    xp: 0,
    xpToNext: xpForLevel(1),
    leagueId: 'bronze',
    leaguePoints: 0,
    coins: DEFAULT_COINS,
    gems: DEFAULT_GEMS,
    ownedItems: ['avatar_joao', 'avatar_maria', 'deck_classico', 'theme_classico'],
    createdAt: now(),
    updatedAt: now(),
  };
}

export function defaultStats(uid: string): PlayerStats {
  return {
    id: uid,
    matches: 0,
    wins: 0,
    losses: 0,
    winRate: 0,
    aiMatches: 0,
    onlineMatches: 0,
    trucosCalled: 0,
    trucosAccepted: 0,
    bestStreak: 0,
    currentStreak: 0,
    hardWins: 0,
    updatedAt: now(),
  };
}

/** Creates the user's documents on first login. Idempotent. */
export const bootstrapUser = authedCallable<Record<string, never>, { onboarded: boolean }>(
  async ({ uid }) => {
    const userRef = db.doc(`users/${uid}`);
    const profileRef = db.doc(`profiles/${uid}`);
    const statsRef = db.doc(`playerStats/${uid}`);
    return db.runTransaction(async (tx) => {
      const [user, profile, stats] = await Promise.all([
        tx.get(userRef),
        tx.get(profileRef),
        tx.get(statsRef),
      ]);
      if (!user.exists) tx.set(userRef, { createdAt: now(), lastSeenAt: now(), fcmTokens: {} });
      else tx.update(userRef, { lastSeenAt: now() });
      const { id: _pid, ...profileData } = defaultProfile(uid);
      const { id: _sid, ...statsData } = defaultStats(uid);
      if (!profile.exists) tx.set(profileRef, profileData);
      if (!stats.exists) tx.set(statsRef, statsData);
      const nickname = profile.exists ? (profile.data() as Profile).nickname : '';
      return { onboarded: Boolean(nickname) };
    });
  },
);

const NICK_RE = /^[\p{L}\p{N} _.-]{3,16}$/u;

export const updateProfile = authedCallable<{ nickname: string; avatarId: AvatarId }, { ok: true }>(
  async ({ uid, data }) => {
    const nickname = data.nickname.trim();
    if (!NICK_RE.test(nickname))
      throw new HttpsError('invalid-argument', 'Apelido deve ter de 3 a 16 caracteres.');
    const ref = db.doc(`profiles/${uid}`);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const { id: _id, ...base } = defaultProfile(uid);
      const current = (snap.exists ? snap.data() : base) as Profile;
      const owned = current.ownedItems ?? [];
      if (
        !owned.includes(`avatar_${data.avatarId}`) &&
        !['joao', 'maria'].includes(data.avatarId)
      ) {
        throw new HttpsError('failed-precondition', 'Você ainda não tem esse avatar.');
      }
      tx.set(ref, {
        ...current,
        nickname,
        nicknameLower: nickname.toLowerCase(),
        avatarId: data.avatarId,
        updatedAt: now(),
      });
    });
    return { ok: true };
  },
  (d) => {
    const o = obj(d, 'payload');
    return {
      nickname: str(o.nickname, 'nickname', 1, 40),
      avatarId: oneOf(o.avatarId, AVATAR_IDS, 'avatarId'),
    };
  },
);

export const registerDevice = authedCallable<{ token: string; platform: string }, { ok: true }>(
  async ({ uid, data }) => {
    await db
      .doc(`users/${uid}`)
      .set(
        { fcmTokens: { [data.token]: { platform: data.platform, updatedAt: now() } } },
        { merge: true },
      );
    return { ok: true };
  },
  (d) => {
    const o = obj(d, 'payload');
    return { token: str(o.token, 'token', 10, 4096), platform: str(o.platform, 'platform', 1, 20) };
  },
);

/** Deletes every document owned by the user, presence and the Auth account. */
export const deleteAccount = authedCallable<Record<string, never>, { ok: true }>(
  async ({ uid }) => {
    const batch = db.batch();
    for (const p of [
      `users/${uid}`,
      `profiles/${uid}`,
      `playerStats/${uid}`,
      `userAchievements/${uid}`,
    ])
      batch.delete(db.doc(p));
    const friends = await db.collection(`friendships/${uid}/friends`).get();
    friends.forEach((f) => {
      batch.delete(f.ref);
      batch.delete(db.doc(`friendships/${f.id}/friends/${uid}`));
    });
    const reqs = await db.collection('friendRequests').where('from', '==', uid).get();
    reqs.forEach((r) => batch.delete(r.ref));
    const reqs2 = await db.collection('friendRequests').where('to', '==', uid).get();
    reqs2.forEach((r) => batch.delete(r.ref));
    await batch.commit();
    await rtdb.ref(`presence/${uid}`).remove();
    await rtdb.ref(`matchmaking/queue/${uid}`).remove();
    await rtdb.ref(`userSessions/${uid}`).remove();
    await auth.deleteUser(uid).catch(() => undefined);
    return { ok: true };
  },
);

export const touchIncrement = FieldValue.increment;
