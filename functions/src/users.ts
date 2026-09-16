import { FieldValue } from 'firebase-admin/firestore';
import { authedCallable, HttpsError, obj, oneOf, str } from './lib/callable';
import { auth, db, now, rtdb } from './lib/admin';
import { BatchWriter } from './lib/batchWriter';
import { AVATAR_IDS, AvatarId, PlayerStats, Profile, xpForLevel } from './domain/model/types';
import { indexUserPhone, removePhoneIndex } from './contacts';
import { ensureAssignment, leaveCurrentLeagueGroup, refreshIdentity } from './leagues';
import { logger } from 'firebase-functions/v2';

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

/**
 * Garante `users`, `profiles` e `playerStats` do jogador. Idempotente — o cadastro também passa
 * por aqui, então um primeiro login que falhou no meio não deixa conta pela metade.
 * Devolve se o perfil já está completo (tem apelido).
 */
export async function ensureUserDocuments(uid: string): Promise<{ onboarded: boolean }> {
  const countryCode = await countryFromPhone(uid);
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
    if (!profile.exists) tx.set(profileRef, { ...profileData, countryCode });
    else tx.set(profileRef, { countryCode }, { merge: true });
    if (!stats.exists) tx.set(statsRef, statsData);
    const nickname = profile.exists ? (profile.data() as Profile).nickname : '';
    return { onboarded: Boolean(nickname) };
  });
}

/** Creates the user's documents on first login. Idempotent. */
export const bootstrapUser = authedCallable<Record<string, never>, { onboarded: boolean }>(
  async ({ uid }) => {
    const result = await ensureUserDocuments(uid);
    // Diretório de telefones: o número vem do Firebase Auth, nunca do cliente.
    // Uma falha aqui não pode impedir o login — o índice é refeito no próximo bootstrap.
    await indexUserPhone(uid).catch(() => undefined);
    // Liga + grupo da semana a cada abertura (auto-repair). Quem ainda não tem apelido entra na
    // liga no cadastro (`updateProfile`): assim ninguém aparece sem nome no ranking.
    if (result.onboarded) {
      await ensureAssignment(uid).catch((e) => logger.warn('ensureAssignment falhou', { uid, e }));
    }
    return result;
  },
);

const NICK_RE = /^[\p{L}\p{N} _.-]{3,16}$/u;

export const updateProfile = authedCallable<{ nickname: string; avatarId: AvatarId }, { ok: true }>(
  async ({ uid, data }) => {
    const nickname = data.nickname.trim();
    if (!NICK_RE.test(nickname))
      throw new HttpsError('invalid-argument', 'Apelido deve ter de 3 a 16 caracteres.');
    // Cadastro consistente: documentos base → liga → apelido. O apelido é gravado por último
    // porque é ele que libera o app (`onboarded`); se a liga falhar, o cadastro não "termina" e o
    // cliente pode tentar de novo com segurança (tudo aqui é idempotente).
    const { onboarded: wasOnboarded } = await ensureUserDocuments(uid);
    let groupId: string | null = null;
    try {
      groupId = (await ensureAssignment(uid)).group.groupId;
    } catch (e) {
      logger.error('updateProfile: liga indisponível', { uid, e });
      if (!wasOnboarded)
        throw new HttpsError('unavailable', 'Não foi possível entrar na liga. Tente de novo.');
    }
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
    // O ranking da semana mostra apelido e avatar novos já na próxima abertura da Liga.
    if (groupId) await refreshIdentity(uid, groupId).catch(() => undefined);
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

/**
 * Deletes every document owned by the user, presence and the Auth account.
 *
 * As escritas vão num `BatchWriter`, não num `db.batch()` único: o lote do Firestore estoura em
 * 500 operações e aqui o total depende do jogador — cada amizade são dois documentos, e ainda
 * entram solicitações, bloqueios (também dois cada) e uma linha por semana de histórico. Passando
 * do limite o `commit()` falhava inteiro, e como a saída da liga e o índice de telefone já tinham
 * sido feitos antes, a conta ficava pela metade e sem como concluir a exclusão.
 */
export const deleteAccount = authedCallable<Record<string, never>, { ok: true }>(
  async ({ uid }) => {
    const batch = new BatchWriter();
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
    await batch.flush();
    await rtdb.ref(`presence/${uid}`).remove();
    await rtdb.ref(`matchmaking/queue/${uid}`).remove();
    await rtdb.ref(`userSessions/${uid}`).remove();
    await auth.deleteUser(uid).catch(() => undefined);
    return { ok: true };
  },
);

export const touchIncrement = FieldValue.increment;
