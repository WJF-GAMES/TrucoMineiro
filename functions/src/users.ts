import { FieldValue } from 'firebase-admin/firestore';
import { authedCallable, HttpsError, obj, oneOf, str } from './lib/callable';
import { auth, db, now, rtdb } from './lib/admin';
import { AVATAR_IDS, AvatarId, PlayerStats, Profile, xpForLevel } from './domain/model/types';
import { indexUserPhone, removePhoneIndex } from './contacts';
import { ensureAssignment, leaveCurrentLeagueGroup } from './leagues';

export function defaultProfile(uid: string): Profile {
  return {
    id: uid,
    nickname: '',
    nicknameLower: '',
    avatarId: 'joao',
    countryCode: 'BR',
    level: 1,
    xp: 0,
    xpToNext: xpForLevel(1),
    leagueId: 'bronze',
    leaguePoints: 0,
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

/**
 * País do jogador a partir do DDI do telefone verificado (o cliente nunca informa isso).
 * Só decora o ranking; um número desconhecido cai em BR, que é o público do jogo.
 */
const DIAL_TO_COUNTRY: [string, string][] = [
  ['+55', 'BR'],
  ['+351', 'PT'],
  ['+54', 'AR'],
  ['+598', 'UY'],
  ['+595', 'PY'],
  ['+1', 'US'],
];

export async function countryFromPhone(uid: string): Promise<string> {
  const user = await auth.getUser(uid).catch(() => null);
  const phone = user?.phoneNumber ?? '';
  // Mais específico primeiro: "+595" não pode ser confundido com "+5".
  const match = [...DIAL_TO_COUNTRY]
    .sort((a, b) => b[0].length - a[0].length)
    .find(([dial]) => phone.startsWith(dial));
  return match?.[1] ?? 'BR';
}

/** Creates the user's documents on first login. Idempotent. */
export const bootstrapUser = authedCallable<Record<string, never>, { onboarded: boolean }>(
  async ({ uid }) => {
    const countryCode = await countryFromPhone(uid);
    const userRef = db.doc(`users/${uid}`);
    const profileRef = db.doc(`profiles/${uid}`);
    const statsRef = db.doc(`playerStats/${uid}`);
    const result = await db.runTransaction(async (tx) => {
      const [user, profile, stats] = await Promise.all([
        tx.get(userRef),
        tx.get(profileRef),
        tx.get(statsRef),
      ]);
      if (!user.exists) tx.set(userRef, { createdAt: now(), lastSeenAt: now(), fcmTokens: {} });
      else tx.update(userRef, { lastSeenAt: now() });
      const { id: _pid, ...profileData } = defaultProfile(uid);
      const { id: _sid, ...statsData } = defaultStats(uid);
      if (!profile.exists) tx.set(profileRef, { ...profileData, countryCode });
      else tx.set(profileRef, { countryCode }, { merge: true });
      if (!stats.exists) tx.set(statsRef, statsData);
      const nickname = profile.exists ? (profile.data() as Profile).nickname : '';
      return { onboarded: Boolean(nickname) };
    });
    // Diretório de telefones: o número vem do Firebase Auth, nunca do cliente.
    // Uma falha aqui não pode impedir o login — o índice é refeito no próximo bootstrap.
    await indexUserPhone(uid).catch(() => undefined);
    // Liga inicial + grupo da semana. Nenhum usuário pode chegar à tela sem liga; se falhar aqui,
    // `getLeagueScreenSnapshot` conserta na primeira abertura.
    await ensureAssignment(uid).catch(() => undefined);
    return result;
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
      `playerProgress/${uid}`,
    ])
      batch.delete(db.doc(p));
    // Sai do grupo da semana (senão o ranking continuaria mostrando um fantasma) e apaga o histórico.
    await leaveCurrentLeagueGroup(uid);
    const weeks = await db.collection(`leagueHistory/${uid}/weeks`).get();
    weeks.forEach((w) => batch.delete(w.ref));
    const friends = await db.collection(`friendships/${uid}/friends`).get();
    friends.forEach((f) => {
      batch.delete(f.ref);
      batch.delete(db.doc(`friendships/${f.id}/friends/${uid}`));
    });
    const reqs = await db.collection('friendRequests').where('from', '==', uid).get();
    reqs.forEach((r) => batch.delete(r.ref));
    const reqs2 = await db.collection('friendRequests').where('to', '==', uid).get();
    reqs2.forEach((r) => batch.delete(r.ref));
    const blocked = await db.collection(`blocks/${uid}/blocked`).get();
    blocked.forEach((b) => {
      batch.delete(b.ref);
      batch.delete(db.doc(`blockedBy/${b.id}/users/${uid}`));
    });
    const blockedBy = await db.collection(`blockedBy/${uid}/users`).get();
    blockedBy.forEach((b) => {
      batch.delete(b.ref);
      batch.delete(db.doc(`blocks/${b.id}/blocked/${uid}`));
    });
    const user = (await db.doc(`users/${uid}`).get()).data() as
      { inviteToken?: string } | undefined;
    if (user?.inviteToken) batch.delete(db.doc(`friendInviteTokens/${user.inviteToken}`));
    batch.delete(db.doc(`contactSync/${uid}`));
    // Sai do diretório de telefones ANTES de apagar users/{uid}, que guarda o hash.
    await removePhoneIndex(uid);
    await batch.commit();
    await rtdb.ref(`presence/${uid}`).remove();
    await rtdb.ref(`matchmaking/queue/${uid}`).remove();
    await rtdb.ref(`userSessions/${uid}`).remove();
    await auth.deleteUser(uid).catch(() => undefined);
    return { ok: true };
  },
);

export const touchIncrement = FieldValue.increment;
