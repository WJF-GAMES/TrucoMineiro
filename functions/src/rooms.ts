import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { arr, authedCallable, HttpsError, bool, obj, str } from './lib/callable';
import { db, now, REGION, rtdb } from './lib/admin';
import { roomCode } from './lib/ids';
import { pushTo } from './lib/push';
import { hitRateLimit, takeCooldown } from './lib/rateLimit';
import {
  acceptInvite,
  canStart,
  closeRoom,
  declineInvite,
  fillWithAi,
  freeSeat,
  INVITE_MESSAGES,
  openSeatForInvite,
  playersOf,
} from './lib/roomLogic';
import {
  AvatarId,
  Profile,
  Room,
  RoomInvite,
  RoomPlayer,
  RoomSeatInvite,
  SessionMeta,
} from './domain/model/types';
import { createSession, requestSeatReclaim } from './sessions';
import {
  INVITE_TTL_MS,
  inviteIdOf,
  LOBBY_WAIT_MS,
  MAX_ROOM_FRIENDS,
  PUSH_COOLDOWN_MS,
  STALE_LOBBY_MS,
} from './friendRoomConfig';

export { botPlayers } from './lib/roomLogic';

export async function loadProfile(uid: string): Promise<{ nickname: string; avatarId: AvatarId }> {
  const p = (await db.doc(`profiles/${uid}`).get()).data() as Profile | undefined;
  if (!p || !p.nickname)
    throw new HttpsError('failed-precondition', 'Complete seu cadastro antes de jogar.');
  return { nickname: p.nickname, avatarId: p.avatarId };
}

const codeOf = (d: unknown) => {
  const code = str(obj(d, 'payload').code, 'code', 6, 6).toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(code)) throw new Error('Código inválido.');
  return code;
};

export async function createRoomFor(
  hostUid: string,
  source: Room['source'],
  extra: (code: string, t: number) => Partial<Room> = () => ({}),
): Promise<Room> {
  const profile = await loadProfile(hostUid);
  // Retry a few times in case of code collision.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = roomCode();
    const t = now();
    const ref = rtdb.ref(`rooms/${code}`);
    const base: Room = {
      code,
      hostUid,
      status: 'waiting',
      maxPlayers: 4,
      players: {
        [hostUid]: {
          uid: hostUid,
          seat: 0,
          ...profile,
          ready: source === 'matchmaking',
          bot: false,
          joinedAt: t,
          connected: true,
        },
      },
      sessionId: null,
      createdAt: t,
      updatedAt: t,
      source,
    };
    const room: Room = { ...base, ...extra(code, t) };
    const res = await ref.transaction((current) => (current === null ? room : undefined));
    if (res.committed) {
      await rtdb.ref(`userRooms/${hostUid}`).set(code);
      return room;
    }
  }
  throw new HttpsError('internal', 'Não foi possível gerar um código de sala.');
}

/** Está numa partida online ainda em andamento (fora desta sala)? */
async function busyInAnotherMatch(uid: string, code: string | null): Promise<boolean> {
  const active = (await rtdb.ref(`userSessions/${uid}/active`).get()).val() as string | null;
  if (!active) return false;
  const meta = (await rtdb.ref(`gameSessions/${active}/meta`).get()).val() as SessionMeta | null;
  if (!meta || meta.status !== 'playing') return false;
  return meta.roomCode !== code;
}

/**
 * Só amigos entram por este fluxo, e nunca com bloqueio em qualquer sentido (mesma mensagem nos
 * dois casos: quem bloqueou não fica exposto).
 */
async function friendProfile(uid: string, friendUid: string): Promise<Profile> {
  if (friendUid === uid)
    throw new HttpsError('invalid-argument', 'Você não pode convidar a si mesmo.');
  const [friendship, iBlocked, blockedMe, profile] = await Promise.all([
    db.doc(`friendships/${uid}/friends/${friendUid}`).get(),
    db.doc(`blocks/${uid}/blocked/${friendUid}`).get(),
    db.doc(`blockedBy/${uid}/users/${friendUid}`).get(),
    db.doc(`profiles/${friendUid}`).get(),
  ]);
  const p = profile.data() as Profile | undefined;
  if (!friendship.exists || iBlocked.exists || blockedMe.exists || !p?.nickname)
    throw new HttpsError('permission-denied', 'Só é possível chamar seus amigos para a sala.');
  return { ...p, id: friendUid };
}

/** Caixa de entrada do convidado + push. Só roda depois de a sala estar gravada. */
async function deliverInvite(room: Room, hostNickname: string, friendUid: string): Promise<void> {
  const inviteId = inviteIdOf(room.code, friendUid);
  const invite: RoomInvite = {
    code: room.code,
    from: room.hostUid,
    fromNickname: hostNickname,
    createdAt: now(),
    inviteId,
    expiresAt: room.lateJoinUntil ?? now() + INVITE_TTL_MS,
  };
  await rtdb.ref(`invites/${friendUid}/${room.code}`).set(invite);
  if (!(await takeCooldown(room.hostUid, `push_${inviteId}`, PUSH_COOLDOWN_MS))) return;
  await pushTo(
    friendUid,
    `${hostNickname} te chamou para uma partida de Truco!`,
    'Toque para entrar na sala.',
    { type: 'room_invite', code: room.code, inviteId },
    { collapseKey: inviteId, ttlMs: INVITE_TTL_MS },
  );
}

/** Tira o convite da caixa de entrada de quem ainda não respondeu. */
async function withdrawInvites(room: Room, uids?: string[]): Promise<void> {
  const targets = uids ?? Object.keys(room.invites ?? {});
  if (targets.length === 0) return;
  const updates: Record<string, null> = {};
  for (const u of targets) updates[`invites/${u}/${room.code}`] = null;
  await rtdb.ref().update(updates);
}

/** Roda `fn` numa transação da sala; `fn` devolve a sala nova, `undefined` (nada) ou um erro. */
async function mutateRoom(
  code: string,
  fn: (room: Room) => Room | undefined | HttpsError,
): Promise<Room> {
  let error: HttpsError | null = null;
  const res = await rtdb.ref(`rooms/${code}`).transaction((room: Room | null) => {
    if (room === null) return room;
    error = null;
    const out = fn(room);
    if (out instanceof HttpsError) {
      error = out;
      return;
    }
    return out ?? room;
  });
  if (error) throw error;
  if (!res.snapshot.exists()) throw new HttpsError('not-found', INVITE_MESSAGES.unavailable);
  return res.snapshot.val() as Room;
}

export const createRoom = authedCallable<Record<string, never>, { code: string }>(
  async ({ uid }) => {
    await hitRateLimit(uid, 'room_create', 10, 60_000);
    const room = await createRoomFor(uid, 'private');
    return { code: room.code };
  },
);

/**
 * Sala a partir da lista de amigos: grava a sala com as vagas reservadas **e só então** manda os
 * convites (caixa de entrada + push). Dono no assento 0; amigos nos assentos 1, 2 e 3, na ordem
 * da seleção. Ao fim da espera, as vagas que sobrarem viram IA e a partida começa.
 */
export const createFriendRoom = authedCallable<
  { friendUids: string[] },
  { code: string; inviteExpiresAt: number }
>(
  async ({ uid, data }) => {
    const friendUids = [...new Set(data.friendUids)];
    if (friendUids.length === 0 || friendUids.length > MAX_ROOM_FRIENDS)
      throw new HttpsError('invalid-argument', `Escolha de 1 a ${MAX_ROOM_FRIENDS} amigos.`);
    await hitRateLimit(uid, 'friend_room', 6, 60_000, 'Muitas salas seguidas. Aguarde um pouco.');
    if (await busyInAnotherMatch(uid, null))
      throw new HttpsError('failed-precondition', INVITE_MESSAGES.busy);
    const friends = await Promise.all(friendUids.map((f) => friendProfile(uid, f)));
    const room = await createRoomFor(uid, 'private', (_code, t) => {
      const invites: Record<string, RoomSeatInvite> = {};
      friends.forEach((f, i) => {
        invites[f.id] = {
          uid: f.id,
          seat: i + 1,
          nickname: f.nickname,
          avatarId: f.avatarId,
          status: 'PENDING',
          invitedAt: t,
          respondedAt: null,
        };
      });
      return {
        invites,
        inviteExpiresAt: t + LOBBY_WAIT_MS,
        lateJoinUntil: t + INVITE_TTL_MS,
        fillWithAi: 'on_timeout',
        closedReason: null,
      };
    });
    // O dono já está pronto: quando todos entrarem, a partida pode começar na hora.
    await rtdb.ref(`rooms/${room.code}/players/${uid}/ready`).set(true);
    const host = room.players[uid]!;
    await Promise.all(friends.map((f) => deliverInvite(room, host.nickname, f.id)));
    return { code: room.code, inviteExpiresAt: room.inviteExpiresAt! };
  },
  (d) => {
    const o = obj(d, 'payload');
    return {
      friendUids: arr(o.friendUids, 'friendUids', MAX_ROOM_FRIENDS, (x) =>
        str(x, 'friendUid', 4, 128),
      ),
    };
  },
);

export interface JoinResult {
  code: string;
  /** Partida já em andamento: o convidado assume a vaga da IA no próximo ponto seguro. */
  sessionId?: string | null;
  pending?: boolean;
}

async function acceptInto(uid: string, code: string): Promise<JoinResult> {
  if (await busyInAnotherMatch(uid, code))
    throw new HttpsError('failed-precondition', INVITE_MESSAGES.busy);
  const profile = await loadProfile(uid);
  let late: number | null = null;
  const room = await mutateRoom(code, (r) => {
    late = null;
    const out = acceptInvite(r, uid, profile, now());
    if (out.kind === 'joined') return out.room;
    if (out.kind === 'already_inside') return undefined;
    if (out.kind === 'late') {
      late = out.seat;
      return undefined;
    }
    return new HttpsError(out.code, out.message);
  });
  await rtdb.ref(`invites/${uid}/${code}`).remove();
  if (late !== null && room.sessionId) {
    const ok = await requestSeatReclaim(room.sessionId, late, uid);
    if (!ok) throw new HttpsError('failed-precondition', INVITE_MESSAGES.started);
    return { code, sessionId: room.sessionId, pending: true };
  }
  await rtdb.ref(`userRooms/${uid}`).set(code);
  return { code, sessionId: room.status === 'in_match' ? room.sessionId : null };
}

export const joinRoom = authedCallable<{ code: string }, JoinResult>(
  async ({ uid, data }) => {
    const code = data.code;
    const snap = await rtdb.ref(`rooms/${code}`).get();
    if (!snap.exists()) throw new HttpsError('not-found', 'Sala não encontrada. Confira o código.');
    // Convidado entrando pelo código também usa a vaga reservada para ele.
    if ((snap.val() as Room).invites?.[uid]) return acceptInto(uid, code);
    const profile = await loadProfile(uid);
    await mutateRoom(code, (room) => {
      if (room.players?.[uid]) return undefined; // already inside: idempotent
      if (room.status !== 'waiting')
        return new HttpsError('failed-precondition', 'A partida dessa sala já começou.');
      const seat = freeSeat(room);
      if (seat === null) return new HttpsError('resource-exhausted', 'Essa sala já está cheia.');
      const player: RoomPlayer = {
        uid,
        seat,
        ...profile,
        ready: false,
        bot: false,
        joinedAt: now(),
        connected: true,
      };
      return { ...room, players: { ...room.players, [uid]: player }, updatedAt: now() };
    });
    await rtdb.ref(`userRooms/${uid}`).set(code);
    return { code };
  },
  (d) => ({ code: codeOf(d) }),
);

/** Resposta ao convite (push, banner ou lista). Aceitar é idempotente; recusar libera a vaga. */
export const respondRoomInvite = authedCallable<{ code: string; accept: boolean }, JoinResult>(
  async ({ uid, data }) => {
    if (data.accept) return acceptInto(uid, data.code);
    const snap = await rtdb.ref(`rooms/${data.code}`).get();
    if (snap.exists()) {
      await mutateRoom(data.code, (room) => declineInvite(room, uid, now()) ?? undefined);
    }
    await rtdb.ref(`invites/${uid}/${data.code}`).remove();
    return { code: data.code };
  },
  (d) => ({ code: codeOf(d), accept: bool(obj(d, 'payload').accept, 'accept') }),
);

export const leaveRoom = authedCallable<{ code: string }, { ok: true }>(
  async ({ uid, data }) => {
    const snap = await rtdb.ref(`rooms/${data.code}`).get();
    if (!snap.exists()) {
      await rtdb.ref(`userRooms/${uid}`).remove();
      return { ok: true };
    }
    const room = await mutateRoom(data.code, (r) => {
      // Depois de começar, sair da sala não mexe na partida (isso é `abandonMatch`).
      if (r.status === 'in_match' || r.status === 'starting') return undefined;
      if (r.status === 'closed') return undefined;
      // Dono saindo antes de começar: a sala é cancelada e os convites deixam de valer.
      if (r.hostUid === uid) return closeRoom(r, 'cancelled', now());
      const players = { ...r.players };
      delete players[uid];
      const invite = r.invites?.[uid];
      const invites = invite
        ? { ...r.invites, [uid]: { ...invite, status: 'DECLINED' as const, respondedAt: now() } }
        : r.invites;
      return { ...r, players, ...(invites ? { invites } : {}), updatedAt: now() };
    });
    await rtdb.ref(`userRooms/${uid}`).remove();
    if (room.status === 'closed' && room.hostUid === uid) {
      const humans = playersOf(room)
        .filter((p) => !p.bot)
        .map((p) => p.uid);
      const updates: Record<string, null> = {};
      for (const h of humans) updates[`userRooms/${h}`] = null;
      await rtdb.ref().update(updates);
      await withdrawInvites(room);
    }
    return { ok: true };
  },
  (d) => ({ code: codeOf(d) }),
);

export const setReady = authedCallable<{ code: string; ready: boolean }, { ok: true }>(
  async ({ uid, data }) => {
    const ref = rtdb.ref(`rooms/${data.code}/players/${uid}`);
    const snap = await ref.get();
    if (!snap.exists()) throw new HttpsError('not-found', 'Você não está nessa sala.');
    await ref.update({ ready: data.ready });
    await rtdb.ref(`rooms/${data.code}/updatedAt`).set(now());
    return { ok: true };
  },
  (d) => ({ code: codeOf(d), ready: bool(obj(d, 'payload').ready, 'ready') }),
);

/** Completa as vagas com IA. As reservas dos convidados pendentes ficam guardadas na IA. */
export const fillRoomWithBots = authedCallable<{ code: string }, { ok: true }>(
  async ({ uid, data }) => {
    await mutateRoom(data.code, (room) => {
      if (room.hostUid !== uid)
        return new HttpsError('permission-denied', 'Só o anfitrião pode completar com IA.');
      if (room.status !== 'waiting') return undefined;
      return fillWithAi(room, now());
    });
    return { ok: true };
  },
  (d) => ({ code: codeOf(d) }),
);

/** Passa a sala de `waiting` para a partida. Idempotente. */
async function startRoom(code: string, guard: (room: Room) => HttpsError | null) {
  const room = await mutateRoom(code, (r) => {
    if (r.status === 'in_match' && r.sessionId) return undefined; // idempotent
    const denied = guard(r);
    if (denied) return denied;
    if (r.status !== 'waiting')
      return new HttpsError('failed-precondition', 'A sala não está aguardando.');
    const ready = canStart(r);
    if (!ready.ok) return new HttpsError('failed-precondition', ready.reason);
    return { ...r, status: 'starting', updatedAt: now() } as Room;
  });
  if (room.status === 'in_match' && room.sessionId) return { sessionId: room.sessionId };
  let sessionId: string;
  try {
    sessionId = await createSession(room);
  } catch (e) {
    // Sem isto a sala ficava presa em "starting" para sempre.
    await rtdb.ref(`rooms/${code}`).update({ status: 'waiting', updatedAt: now() });
    throw e;
  }
  const updates: Record<string, unknown> = {
    [`rooms/${code}/status`]: 'in_match',
    [`rooms/${code}/sessionId`]: sessionId,
    [`rooms/${code}/updatedAt`]: now(),
  };
  // Quem ainda estava convidado e não tem vaga na mesa já não pode entrar.
  for (const inv of Object.values(room.invites ?? {})) {
    if (inv.status !== 'PENDING') continue;
    updates[`rooms/${code}/invites/${inv.uid}/status`] = 'EXPIRED';
    updates[`invites/${inv.uid}/${code}`] = null;
  }
  await rtdb.ref().update(updates);
  return { sessionId };
}

export const startMatch = authedCallable<{ code: string }, { sessionId: string }>(
  async ({ uid, data }) =>
    startRoom(data.code, (room) =>
      room.hostUid === uid
        ? null
        : new HttpsError('permission-denied', 'Só o anfitrião pode iniciar.'),
    ),
  (d) => ({ code: codeOf(d) }),
);

/**
 * Fim da espera do lobby: qualquer pessoa na sala pode pedir, mas o servidor só aceita depois do
 * prazo. Completa com IA e começa — a partida nunca fica parada esperando convidado.
 */
export const resolveLobbyTimeout = authedCallable<{ code: string }, { sessionId: string | null }>(
  async ({ uid, data }) => {
    const snap = await rtdb.ref(`rooms/${data.code}`).get();
    const current = snap.val() as Room | null;
    if (!current) throw new HttpsError('not-found', INVITE_MESSAGES.unavailable);
    if (!current.players?.[uid])
      throw new HttpsError('permission-denied', 'Você não está nessa sala.');
    if (current.status === 'in_match') return { sessionId: current.sessionId };
    if (current.fillWithAi !== 'on_timeout' || current.status !== 'waiting')
      return { sessionId: null };
    if (now() < (current.inviteExpiresAt ?? 0))
      throw new HttpsError('failed-precondition', 'Ainda estamos aguardando os convidados.');
    await mutateRoom(data.code, (room) =>
      room.status === 'waiting' ? fillWithAi(room, now()) : undefined,
    );
    const started = await startRoom(data.code, () => null);
    logger.info('lobby: tempo esgotado, IA completou a mesa', { code: data.code });
    return { sessionId: started.sessionId };
  },
  (d) => ({ code: codeOf(d) }),
);

/** Dono chama mais um amigo (ou troca quem recusou) antes de a partida começar. */
export const inviteToRoom = authedCallable<{ code: string; friendUid: string }, { ok: true }>(
  async ({ uid, data }) => {
    await hitRateLimit(
      uid,
      'room_invite',
      20,
      60_000,
      'Muitos convites seguidos. Aguarde um pouco.',
    );
    const friend = await friendProfile(uid, data.friendUid);
    const room = await mutateRoom(data.code, (r) => {
      if (r.hostUid !== uid)
        return new HttpsError('permission-denied', 'Só o anfitrião pode convidar.');
      if (r.status !== 'waiting')
        return new HttpsError('failed-precondition', 'A partida já começou.');
      if (r.players?.[data.friendUid]) return undefined;
      const existing = r.invites?.[data.friendUid];
      if (existing?.status === 'PENDING') return undefined; // só reenvia o push
      const pending = Object.values(r.invites ?? {}).filter((i) => i.status === 'PENDING');
      if (pending.length + playersOf(r).length >= 4)
        return new HttpsError('resource-exhausted', INVITE_MESSAGES.full);
      const seat = openSeatForInvite(r);
      if (seat === null) return new HttpsError('resource-exhausted', INVITE_MESSAGES.full);
      const t = now();
      return {
        ...r,
        invites: {
          ...r.invites,
          [data.friendUid]: {
            uid: data.friendUid,
            seat,
            nickname: friend.nickname,
            avatarId: friend.avatarId,
            status: 'PENDING',
            invitedAt: t,
            respondedAt: null,
          },
        },
        // O convidado novo ganha a espera inteira.
        inviteExpiresAt: Math.max(r.inviteExpiresAt ?? 0, t + LOBBY_WAIT_MS),
        lateJoinUntil: Math.max(r.lateJoinUntil ?? 0, t + INVITE_TTL_MS),
        fillWithAi: r.fillWithAi ?? 'on_timeout',
        updatedAt: t,
      };
    });
    await deliverInvite(room, room.players[uid]!.nickname, data.friendUid);
    return { ok: true };
  },
  (d) => {
    const o = obj(d, 'payload');
    return { code: codeOf(d), friendUid: str(o.friendUid, 'friendUid', 4, 128) };
  },
);

/** Dono tira um convidado que ainda não entrou (para chamar outra pessoa no lugar). */
export const removeRoomInvite = authedCallable<{ code: string; friendUid: string }, { ok: true }>(
  async ({ uid, data }) => {
    const room = await mutateRoom(data.code, (r) => {
      if (r.hostUid !== uid)
        return new HttpsError('permission-denied', 'Só o anfitrião pode mudar os convites.');
      if (r.status !== 'waiting')
        return new HttpsError('failed-precondition', 'A partida já começou.');
      const invite = r.invites?.[data.friendUid];
      if (!invite || invite.status === 'ACCEPTED') return undefined;
      const invites = { ...r.invites };
      delete invites[data.friendUid];
      return { ...r, invites, updatedAt: now() };
    });
    await withdrawInvites(room, [data.friendUid]);
    return { ok: true };
  },
  (d) => {
    const o = obj(d, 'payload');
    return { code: codeOf(d), friendUid: str(o.friendUid, 'friendUid', 4, 128) };
  },
);

/**
 * Limpeza: sala de amigos esquecida no lobby é fechada (convites expiram) e sala fechada há muito
 * tempo é apagada, liberando o código.
 */
export const sweepRooms = onSchedule(
  { region: REGION, schedule: 'every 5 minutes', timeZone: 'America/Sao_Paulo' },
  async () => {
    const t = now();
    const waiting = await rtdb.ref('rooms').orderByChild('status').equalTo('waiting').get();
    const stale: Room[] = [];
    waiting.forEach((c) => {
      const room = c.val() as Room;
      if (t - (room.updatedAt ?? room.createdAt) > STALE_LOBBY_MS) stale.push(room);
    });
    for (const room of stale) {
      const closed = await mutateRoom(room.code, (r) =>
        r.status === 'waiting' ? closeRoom(r, 'expired', now()) : undefined,
      ).catch(() => null);
      if (!closed) continue;
      await withdrawInvites(closed);
      const updates: Record<string, null> = {};
      for (const p of playersOf(closed)) if (!p.bot) updates[`userRooms/${p.uid}`] = null;
      await rtdb.ref().update(updates);
    }
    const closed = await rtdb.ref('rooms').orderByChild('status').equalTo('closed').get();
    const old: string[] = [];
    closed.forEach((c) => {
      const room = c.val() as Room;
      if (t - (room.updatedAt ?? room.createdAt) > 60 * 60_000) old.push(room.code);
    });
    if (old.length)
      await rtdb.ref().update(Object.fromEntries(old.map((c) => [`rooms/${c}`, null])));
    logger.info('sweepRooms', { expired: stale.length, removed: old.length });
  },
);
