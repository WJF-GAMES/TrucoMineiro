import { authedCallable, HttpsError, bool, obj, str } from './lib/callable';
import { db, now, rtdb } from './lib/admin';
import { roomCode } from './lib/ids';
import { AvatarId, Profile, Room, RoomPlayer } from './domain/model/types';
import { createSession } from './sessions';

const BOT_POOL: { nickname: string; avatarId: AvatarId }[] = [
  { nickname: 'Seu Zé (IA)', avatarId: 'seu_ze' },
  { nickname: 'Maria (IA)', avatarId: 'maria' },
  { nickname: 'Tião (IA)', avatarId: 'tiao' },
  { nickname: 'Galo (IA)', avatarId: 'galo' },
];

export async function loadProfile(uid: string): Promise<{ nickname: string; avatarId: AvatarId }> {
  const p = (await db.doc(`profiles/${uid}`).get()).data() as Profile | undefined;
  if (!p || !p.nickname)
    throw new HttpsError('failed-precondition', 'Complete seu cadastro antes de jogar.');
  return { nickname: p.nickname, avatarId: p.avatarId };
}

function freeSeat(room: Room): number | null {
  const taken = new Set(Object.values(room.players).map((p) => p.seat));
  for (let s = 0; s < 4; s++) if (!taken.has(s)) return s;
  return null;
}

export async function createRoomFor(hostUid: string, source: Room['source']): Promise<Room> {
  const profile = await loadProfile(hostUid);
  // Retry a few times in case of code collision.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = roomCode();
    const ref = rtdb.ref(`rooms/${code}`);
    const room: Room = {
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
          joinedAt: now(),
          connected: true,
        },
      },
      sessionId: null,
      createdAt: now(),
      updatedAt: now(),
      source,
    };
    const res = await ref.transaction((current) => (current === null ? room : undefined));
    if (res.committed) {
      await rtdb.ref(`userRooms/${hostUid}`).set(code);
      return room;
    }
  }
  throw new HttpsError('internal', 'Não foi possível gerar um código de sala.');
}

export const createRoom = authedCallable<Record<string, never>, { code: string }>(
  async ({ uid }) => {
    const room = await createRoomFor(uid, 'private');
    return { code: room.code };
  },
);

export const joinRoom = authedCallable<{ code: string }, { code: string }>(
  async ({ uid, data }) => {
    const code = data.code.toUpperCase();
    const profile = await loadProfile(uid);
    const ref = rtdb.ref(`rooms/${code}`);
    let error: HttpsError | null = null;
    const res = await ref.transaction((room: Room | null) => {
      if (room === null) return room; // abort with "not found" below
      if (room.players[uid]) return room; // already inside: idempotent
      if (room.status !== 'waiting') {
        error = new HttpsError('failed-precondition', 'A partida dessa sala já começou.');
        return;
      }
      const seat = freeSeat(room);
      if (seat === null) {
        error = new HttpsError('resource-exhausted', 'Essa sala já está cheia.');
        return;
      }
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
    if (error) throw error;
    if (!res.snapshot.exists())
      throw new HttpsError('not-found', 'Sala não encontrada. Confira o código.');
    await rtdb.ref(`userRooms/${uid}`).set(code);
    return { code };
  },
  (d) => {
    const o = obj(d, 'payload');
    const code = str(o.code, 'code', 6, 6).toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(code)) throw new Error('Código inválido.');
    return { code };
  },
);

export const leaveRoom = authedCallable<{ code: string }, { ok: true }>(
  async ({ uid, data }) => {
    const ref = rtdb.ref(`rooms/${data.code}`);
    await ref.transaction((room: Room | null) => {
      if (!room) return room;
      if (room.hostUid === uid) return { ...room, status: 'closed', updatedAt: now() } as Room;
      const players = { ...room.players };
      delete players[uid];
      return { ...room, players, updatedAt: now() };
    });
    await rtdb.ref(`userRooms/${uid}`).remove();
    // Closed rooms are removed shortly after so codes can be reused.
    const snap = await ref.get();
    if (snap.exists() && (snap.val() as Room).status === 'closed')
      setTimeout(() => ref.remove().catch(() => undefined), 5000);
    return { ok: true };
  },
  (d) => ({ code: str(obj(d, 'payload').code, 'code', 6, 6).toUpperCase() }),
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
  (d) => {
    const o = obj(d, 'payload');
    return { code: str(o.code, 'code', 6, 6).toUpperCase(), ready: bool(o.ready, 'ready') };
  },
);

export function botPlayers(existing: Room['players'], count: number): Room['players'] {
  const usedNames = new Set(Object.values(existing).map((p) => p.nickname));
  const taken = new Set(Object.values(existing).map((p) => p.seat));
  const out: Room['players'] = {};
  let poolIdx = 0;
  for (let s = 0; s < 4 && Object.keys(out).length < count; s++) {
    if (taken.has(s)) continue;
    while (usedNames.has(BOT_POOL[poolIdx % BOT_POOL.length]!.nickname)) poolIdx++;
    const bot = BOT_POOL[poolIdx % BOT_POOL.length]!;
    poolIdx++;
    const uid = `bot_${s}_${Math.random().toString(36).slice(2, 8)}`;
    out[uid] = {
      uid,
      seat: s,
      nickname: bot.nickname,
      avatarId: bot.avatarId,
      ready: true,
      bot: true,
      joinedAt: now(),
      connected: true,
    };
    usedNames.add(bot.nickname);
  }
  return out;
}

export const fillRoomWithBots = authedCallable<{ code: string }, { ok: true }>(
  async ({ uid, data }) => {
    const ref = rtdb.ref(`rooms/${data.code}`);
    let error: HttpsError | null = null;
    await ref.transaction((room: Room | null) => {
      if (!room) return room;
      if (room.hostUid !== uid) {
        error = new HttpsError('permission-denied', 'Só o anfitrião pode completar com IA.');
        return;
      }
      if (room.status !== 'waiting') return room;
      const missing = 4 - Object.keys(room.players).length;
      if (missing <= 0) return room;
      return {
        ...room,
        players: { ...room.players, ...botPlayers(room.players, missing) },
        updatedAt: now(),
      };
    });
    if (error) throw error;
    return { ok: true };
  },
  (d) => ({ code: str(obj(d, 'payload').code, 'code', 6, 6).toUpperCase() }),
);

export const startMatch = authedCallable<{ code: string }, { sessionId: string }>(
  async ({ uid, data }) => {
    const ref = rtdb.ref(`rooms/${data.code}`);
    let error: HttpsError | null = null;
    const res = await ref.transaction((room: Room | null) => {
      if (!room) return room;
      if (room.hostUid !== uid) {
        error = new HttpsError('permission-denied', 'Só o anfitrião pode iniciar.');
        return;
      }
      if (room.status === 'in_match' && room.sessionId) return room; // idempotent
      if (room.status !== 'waiting') {
        error = new HttpsError('failed-precondition', 'A sala não está aguardando.');
        return;
      }
      const players = Object.values(room.players);
      if (players.length !== 4) {
        error = new HttpsError('failed-precondition', 'A mesa precisa de 4 jogadores.');
        return;
      }
      if (!players.every((p) => p.ready || p.bot)) {
        error = new HttpsError('failed-precondition', 'Todos precisam estar prontos.');
        return;
      }
      return { ...room, status: 'starting', updatedAt: now() } as Room;
    });
    if (error) throw error;
    if (!res.snapshot.exists()) throw new HttpsError('not-found', 'Sala não encontrada.');
    const room = res.snapshot.val() as Room;
    if (room.status === 'in_match' && room.sessionId) return { sessionId: room.sessionId };
    const sessionId = await createSession(room);
    await ref.update({ status: 'in_match', sessionId, updatedAt: now() });
    return { sessionId };
  },
  (d) => ({ code: str(obj(d, 'payload').code, 'code', 6, 6).toUpperCase() }),
);
