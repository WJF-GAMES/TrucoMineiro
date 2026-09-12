import { onValueCreated } from 'firebase-functions/v2/database';
import { authedCallable, HttpsError, obj } from './lib/callable';
import { DB_TRIGGER_REGION, now, rtdb } from './lib/admin';
import { MatchmakingEntry, Room } from './domain/model/types';
import { botPlayers, createRoomFor, loadProfile } from './rooms';
import { createSession } from './sessions';

const QUEUE = 'matchmaking/queue';

export const startMatchmaking = authedCallable<{ allowBots?: boolean }, { ok: true }>(
  async ({ uid, data }) => {
    const profile = await loadProfile(uid);
    const entry: MatchmakingEntry = {
      uid,
      ...profile,
      joinedAt: now(),
      status: 'searching',
      sessionId: null,
      roomCode: null,
    };
    const ref = rtdb.ref(`${QUEUE}/${uid}`);
    const existing = (await ref.get()).val() as MatchmakingEntry | null;
    if (existing?.status === 'found' || existing?.status === 'ready') return { ok: true };
    await ref.set({
      ...entry,
      joinedAt: existing?.status === 'searching' ? existing.joinedAt : now(),
    });
    if (data.allowBots) await tryFormTable(true);
    return { ok: true };
  },
  (d) => {
    const o = d ? obj(d, 'payload') : {};
    return { allowBots: o.allowBots === true };
  },
);

export const cancelMatchmaking = authedCallable<Record<string, never>, { ok: true }>(
  async ({ uid }) => {
    const ref = rtdb.ref(`${QUEUE}/${uid}`);
    await ref.transaction((entry: MatchmakingEntry | null) => {
      if (!entry) return entry;
      if (entry.status === 'found' || entry.status === 'ready' || entry.status === 'preparing')
        return entry; // too late
      return { ...entry, status: 'cancelled' };
    });
    setTimeout(() => ref.remove().catch(() => undefined), 3000);
    return { ok: true };
  },
);

/**
 * Groups searching players into tables of 4. With `allowBots` the oldest waiting player gets a
 * table completed with AI (used after the Remote Config bot-fill timeout).
 */
export async function tryFormTable(allowBots: boolean): Promise<void> {
  const queueRef = rtdb.ref(QUEUE);
  let picked: MatchmakingEntry[] = [];
  await queueRef.transaction((queue: Record<string, MatchmakingEntry> | null) => {
    picked = [];
    if (!queue) return queue;
    const searching = Object.values(queue)
      .filter((e) => e.status === 'searching')
      .sort((a, b) => a.joinedAt - b.joinedAt);
    if (searching.length < 4 && !allowBots) return queue;
    if (searching.length === 0) return queue;
    picked = searching.slice(0, 4);
    const next = { ...queue };
    for (const e of picked) next[e.uid] = { ...e, status: 'found' };
    return next;
  });
  if (picked.length === 0) return;
  if (picked.length < 4 && !allowBots) return;

  try {
    const host = picked[0]!;
    const room = await createRoomFor(host.uid, 'matchmaking');
    const players: Room['players'] = { ...room.players };
    picked.slice(1).forEach((e, i) => {
      players[e.uid] = {
        uid: e.uid,
        seat: i + 1,
        nickname: e.nickname,
        avatarId: e.avatarId,
        ready: true,
        bot: false,
        joinedAt: now(),
        connected: true,
      };
    });
    const missing = 4 - Object.keys(players).length;
    if (missing > 0) Object.assign(players, botPlayers(players, missing));
    const full: Room = { ...room, players, status: 'starting', updatedAt: now() };
    await rtdb.ref(`rooms/${room.code}`).set(full);
    const updates: Record<string, unknown> = {};
    for (const e of picked) updates[`${QUEUE}/${e.uid}/status`] = 'preparing';
    await rtdb.ref().update(updates);
    const sessionId = await createSession(full);
    await rtdb
      .ref(`rooms/${room.code}`)
      .update({ status: 'in_match', sessionId, updatedAt: now() });
    const done: Record<string, unknown> = {};
    for (const e of picked) {
      done[`${QUEUE}/${e.uid}/status`] = 'ready';
      done[`${QUEUE}/${e.uid}/sessionId`] = sessionId;
      done[`${QUEUE}/${e.uid}/roomCode`] = room.code;
    }
    await rtdb.ref().update(done);
    setTimeout(() => {
      const cleanup: Record<string, unknown> = {};
      for (const e of picked) cleanup[`${QUEUE}/${e.uid}`] = null;
      rtdb
        .ref()
        .update(cleanup)
        .catch(() => undefined);
    }, 15000);
  } catch (e) {
    const updates: Record<string, unknown> = {};
    for (const p of picked) updates[`${QUEUE}/${p.uid}/status`] = 'error';
    await rtdb.ref().update(updates);
    throw e instanceof HttpsError ? e : new HttpsError('internal', (e as Error).message);
  }
}

export const onMatchmakingJoin = onValueCreated(
  { ref: `/${QUEUE}/{uid}`, region: DB_TRIGGER_REGION, instance: 'truco-mineiro-wjf-default-rtdb' },
  async () => {
    await tryFormTable(false);
  },
);
