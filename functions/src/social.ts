import { onValueWritten } from 'firebase-functions/v2/database';
import { arr, authedCallable, HttpsError, bool, obj, str } from './lib/callable';
import { db, DB_TRIGGER_REGION, messaging, now, rtdb } from './lib/admin';
import { FriendRequest, Presence, Profile } from './domain/model/types';
import { phoneHash } from './contacts';

async function pushTo(uid: string, title: string, body: string, data: Record<string, string>) {
  const user = (await db.doc(`users/${uid}`).get()).data() as
    { fcmTokens?: Record<string, unknown> } | undefined;
  const tokens = Object.keys(user?.fcmTokens ?? {});
  if (tokens.length === 0) return;
  await messaging
    .sendEachForMulticast({
      tokens,
      notification: { title, body },
      data,
      android: { priority: 'high' },
    })
    .catch(() => undefined);
}

/**
 * Id determinístico da solicitação A→B. Duas chamadas simultâneas gravam o MESMO documento,
 * então nunca aparecem duas solicitações pendentes do mesmo par (teste de concorrência).
 */
export const requestId = (from: string, to: string) => `${from}_${to}`;

export const sendFriendRequest = authedCallable<{ toUid: string }, { ok: true }>(
  async ({ uid, data }) => {
    if (data.toUid === uid)
      throw new HttpsError('invalid-argument', 'Você não pode adicionar a si mesmo.');
    const [me, target, friendship, iBlocked, blockedMe] = await Promise.all([
      db.doc(`profiles/${uid}`).get(),
      db.doc(`profiles/${data.toUid}`).get(),
      db.doc(`friendships/${uid}/friends/${data.toUid}`).get(),
      db.doc(`blocks/${uid}/blocked/${data.toUid}`).get(),
      db.doc(`blockedBy/${uid}/users/${data.toUid}`).get(),
    ]);
    if (!target.exists) throw new HttpsError('not-found', 'Jogador não encontrado.');
    if (friendship.exists) throw new HttpsError('already-exists', 'Vocês já são amigos.');
    // Mesma mensagem nos dois sentidos: quem bloqueou não fica exposto para quem foi bloqueado.
    if (iBlocked.exists || blockedMe.exists)
      throw new HttpsError('permission-denied', 'Não é possível adicionar esse jogador.');
    // Uma solicitação já recebida vira amizade direto, em vez de criar o par duplicado A→B/B→A.
    const incomingRef = db.doc(`friendRequests/${requestId(data.toUid, uid)}`);
    const incoming = await incomingRef.get();
    if ((incoming.data() as FriendRequest | undefined)?.status === 'pending') {
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(incomingRef);
        if ((snap.data() as FriendRequest | undefined)?.status !== 'pending') return;
        tx.update(incomingRef, { status: 'accepted' });
        tx.set(db.doc(`friendships/${uid}/friends/${data.toUid}`), { since: now() });
        tx.set(db.doc(`friendships/${data.toUid}/friends/${uid}`), { since: now() });
      });
      return { ok: true };
    }
    const outgoing = await db.doc(`friendRequests/${requestId(uid, data.toUid)}`).get();
    if ((outgoing.data() as FriendRequest | undefined)?.status === 'pending')
      throw new HttpsError('already-exists', 'Solicitação já enviada.');
    // O perfil de quem chama alimenta a solicitação. Sem ele, `p.nickname` estourava um
    // TypeError e o cliente recebia "internal" — sem mensagem e sem caminho de volta.
    const p = me.data() as Profile | undefined;
    const t = target.data() as Profile;
    if (!p) throw new HttpsError('failed-precondition', 'Complete seu cadastro para continuar.');
    const req: Omit<FriendRequest, 'id'> = {
      from: uid,
      to: data.toUid,
      fromNickname: p.nickname,
      fromAvatarId: p.avatarId,
      toNickname: t.nickname,
      toAvatarId: t.avatarId,
      status: 'pending',
      createdAt: now(),
    };
    await db.doc(`friendRequests/${requestId(uid, data.toUid)}`).set(req);
    await pushTo(
      data.toUid,
      'Nova solicitação de amizade',
      `${p.nickname} quer jogar truco com você.`,
      { type: 'friend_invite', from: uid },
    );
    return { ok: true };
  },
  (d) => ({ toUid: str(obj(d, 'payload').toUid, 'toUid', 4, 128) }),
);

export const respondFriendRequest = authedCallable<
  { requestId: string; accept: boolean },
  { ok: true }
>(
  async ({ uid, data }) => {
    const ref = db.doc(`friendRequests/${data.requestId}`);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new HttpsError('not-found', 'Solicitação não encontrada.');
      const req = snap.data() as FriendRequest;
      if (req.to !== uid) throw new HttpsError('permission-denied', 'Essa solicitação não é sua.');
      if (req.status !== 'pending') return;
      tx.update(ref, { status: data.accept ? 'accepted' : 'declined' });
      if (data.accept) {
        tx.set(db.doc(`friendships/${uid}/friends/${req.from}`), { since: now() });
        tx.set(db.doc(`friendships/${req.from}/friends/${uid}`), { since: now() });
      }
    });
    return { ok: true };
  },
  (d) => {
    const o = obj(d, 'payload');
    return { requestId: str(o.requestId, 'requestId', 4, 128), accept: bool(o.accept, 'accept') };
  },
);

/** Cancela uma solicitação que o próprio usuário enviou. */
export const cancelFriendRequest = authedCallable<{ toUid: string }, { ok: true }>(
  async ({ uid, data }) => {
    const ref = db.doc(`friendRequests/${requestId(uid, data.toUid)}`);
    const snap = await ref.get();
    if (!snap.exists) return { ok: true };
    const req = snap.data() as FriendRequest;
    if (req.from !== uid) throw new HttpsError('permission-denied', 'Essa solicitação não é sua.');
    await ref.delete();
    return { ok: true };
  },
  (d) => ({ toUid: str(obj(d, 'payload').toUid, 'toUid', 4, 128) }),
);

/**
 * Bloqueia um jogador: desfaz a amizade, apaga solicitações pendentes nos dois sentidos e
 * grava o espelho em `blockedBy/{alvo}` para que o match de contatos resolva "quem me bloqueou"
 * com uma leitura só, em vez de uma por contato.
 */
export const blockUser = authedCallable<{ targetUid: string }, { ok: true }>(
  async ({ uid, data }) => {
    if (data.targetUid === uid)
      throw new HttpsError('invalid-argument', 'Você não pode bloquear a si mesmo.');
    const batch = db.batch();
    batch.set(db.doc(`blocks/${uid}/blocked/${data.targetUid}`), { since: now() });
    batch.set(db.doc(`blockedBy/${data.targetUid}/users/${uid}`), { since: now() });
    batch.delete(db.doc(`friendships/${uid}/friends/${data.targetUid}`));
    batch.delete(db.doc(`friendships/${data.targetUid}/friends/${uid}`));
    batch.delete(db.doc(`friendRequests/${requestId(uid, data.targetUid)}`));
    batch.delete(db.doc(`friendRequests/${requestId(data.targetUid, uid)}`));
    await batch.commit();
    return { ok: true };
  },
  (d) => ({ targetUid: str(obj(d, 'payload').targetUid, 'targetUid', 4, 128) }),
);

export const unblockUser = authedCallable<{ targetUid: string }, { ok: true }>(
  async ({ uid, data }) => {
    const batch = db.batch();
    batch.delete(db.doc(`blocks/${uid}/blocked/${data.targetUid}`));
    batch.delete(db.doc(`blockedBy/${data.targetUid}/users/${uid}`));
    await batch.commit();
    return { ok: true };
  },
  (d) => ({ targetUid: str(obj(d, 'payload').targetUid, 'targetUid', 4, 128) }),
);

export const removeFriend = authedCallable<{ friendUid: string }, { ok: true }>(
  async ({ uid, data }) => {
    const batch = db.batch();
    batch.delete(db.doc(`friendships/${uid}/friends/${data.friendUid}`));
    batch.delete(db.doc(`friendships/${data.friendUid}/friends/${uid}`));
    await batch.commit();
    return { ok: true };
  },
  (d) => ({ friendUid: str(obj(d, 'payload').friendUid, 'friendUid', 4, 128) }),
);

/**
 * Convite para a sala: vale para amigos e para contatos da agenda que já jogam.
 *
 * Para quem ainda não é amigo, o app manda os números desse contato (lidos da agenda na hora) e
 * o servidor confere no índice de telefones que um deles é mesmo desse jogador — a mesma prova que
 * o "encontrar pela agenda" usa. Nada disso é gravado. Bloqueio em qualquer sentido barra o convite, com a mesma mensagem (quem bloqueou
 * não fica exposto).
 */
export const inviteFriendToRoom = authedCallable<
  { friendUid: string; code: string; phones?: string[] },
  { ok: true }
>(
  async ({ uid, data }) => {
    if (data.friendUid === uid)
      throw new HttpsError('invalid-argument', 'Você não pode convidar a si mesmo.');
    const friendship = await db.doc(`friendships/${uid}/friends/${data.friendUid}`).get();
    if (!friendship.exists) {
      const denied = new HttpsError(
        'permission-denied',
        'Só é possível chamar amigos ou contatos da sua agenda.',
      );
      if (!data.phones?.length) throw denied;
      const [iBlocked, blockedMe, ...indexes] = await Promise.all([
        db.doc(`blocks/${uid}/blocked/${data.friendUid}`).get(),
        db.doc(`blockedBy/${uid}/users/${data.friendUid}`).get(),
        ...data.phones.map((p) => db.doc(`phoneIndex/${phoneHash(p)}`).get()),
      ]);
      if (iBlocked.exists || blockedMe.exists) throw denied;
      const owns = indexes.some(
        (i) => (i.data() as { uid?: string } | undefined)?.uid === data.friendUid,
      );
      if (!owns) throw denied;
    }
    const me = (await db.doc(`profiles/${uid}`).get()).data() as Profile | undefined;
    if (!me) throw new HttpsError('failed-precondition', 'Complete seu cadastro para continuar.');
    await rtdb
      .ref(`invites/${data.friendUid}/${data.code}`)
      .set({ from: uid, fromNickname: me.nickname, code: data.code, createdAt: now() });
    await pushTo(
      data.friendUid,
      'Convite para jogar',
      `${me.nickname} te chamou para a sala ${data.code}.`,
      { type: 'room_invite', code: data.code },
    );
    return { ok: true };
  },
  (d) => {
    const o = obj(d, 'payload');
    // Um contato tem poucos números: o teto evita usar o convite para testar números em massa.
    const phones =
      o.phones === undefined
        ? undefined
        : arr(o.phones, 'phones', 5, (p) => {
            const phone = str(p, 'phone', 8, 16);
            if (!/^\+[1-9]\d{6,14}$/.test(phone)) throw new Error('phone inválido.');
            return phone;
          });
    return {
      friendUid: str(o.friendUid, 'friendUid', 4, 128),
      code: str(o.code, 'code', 6, 6).toUpperCase(),
      ...(phones ? { phones } : {}),
    };
  },
);

/** Keeps stats/onlineCount in sync with presence writes. */
export const onPresenceWritten = onValueWritten(
  { ref: '/presence/{uid}', region: DB_TRIGGER_REGION, instance: 'truco-mineiro-wjf-default-rtdb' },
  async (event) => {
    const before = event.data.before.val() as Presence | null;
    const after = event.data.after.val() as Presence | null;
    const wasOnline = before?.state === 'online' || before?.state === 'in_match';
    const isOnline = after?.state === 'online' || after?.state === 'in_match';
    if (wasOnline === isOnline) return;
    await rtdb
      .ref('stats/onlineCount')
      .transaction((n: number | null) => Math.max(0, (n ?? 0) + (isOnline ? 1 : -1)));
  },
);
