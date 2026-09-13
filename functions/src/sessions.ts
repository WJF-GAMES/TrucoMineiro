import { authedCallable, HttpsError, obj, oneOf, str } from './lib/callable';
import { now, rtdb } from './lib/admin';
import { seed, sessionId as newSessionId } from './lib/ids';
import {
  GameAction,
  GameEvent,
  MatchState,
  Seat,
  aiForDifficulty,
  applyAction,
  createMatch,
  createRng,
  getAvailableActions,
  nextAIAction,
  seatsToAct,
  viewForSeat,
} from './domain/game';
import { Room, SessionMeta, SessionPlayer } from './domain/model/types';
import { normalizeStoredState, StoredState } from './lib/rtdbState';
import { parseAction } from './matches';
import { processProgression } from './progression';

const MAX_STORED_EVENTS = 30;

interface SeatViewPayload extends ReturnType<typeof viewForSeat> {
  recentEvents: GameEvent[];
}

function trim(state: StoredState): StoredState {
  const ids = Object.entries(state.appliedActionIds)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 50);
  return {
    ...state,
    events: state.events.slice(-MAX_STORED_EVENTS),
    appliedActionIds: Object.fromEntries(ids),
  };
}

function buildViews(state: StoredState, recent: GameEvent[]): Record<string, SeatViewPayload> {
  const views: Record<string, SeatViewPayload> = {};
  for (const seat of [0, 1, 2, 3] as Seat[])
    views[String(seat)] = { ...viewForSeat(state, seat), recentEvents: recent };
  return views;
}

export async function createSession(room: Room): Promise<string> {
  const id = newSessionId();
  const players: Record<string, SessionPlayer> = {};
  for (const p of Object.values(room.players)) {
    players[String(p.seat)] = {
      uid: p.uid,
      seat: p.seat,
      nickname: p.nickname,
      avatarId: p.avatarId,
      bot: p.bot,
      connected: p.bot ? true : Boolean(p.connected),
    };
  }
  const base = createMatch(seed());
  const state: StoredState = { ...base, appliedActionIds: {}, aiRngState: seed(), trucos: {} };
  const meta: SessionMeta = {
    id,
    roomCode: room.code,
    mode: 'online',
    status: 'playing',
    players,
    createdAt: now(),
    updatedAt: now(),
    winnerTeam: null,
    abandonedBy: null,
  };
  const updates: Record<string, unknown> = {
    [`gameSessions/${id}/meta`]: meta,
    [`gameSessions/${id}/state`]: trim(state),
    [`gameSessions/${id}/views`]: buildViews(state, state.events),
  };
  for (const p of Object.values(players)) if (!p.bot) updates[`userSessions/${p.uid}/active`] = id;
  await rtdb.ref().update(updates);
  return id;
}

async function loadMeta(id: string): Promise<SessionMeta> {
  const snap = await rtdb.ref(`gameSessions/${id}/meta`).get();
  if (!snap.exists()) throw new HttpsError('not-found', 'Partida não encontrada.');
  return snap.val() as SessionMeta;
}

function seatOf(meta: SessionMeta, uid: string): Seat {
  const p = Object.values(meta.players).find((x) => x.uid === uid);
  if (!p) throw new HttpsError('permission-denied', 'Você não está nessa partida.');
  return p.seat as Seat;
}

/**
 * Applies one action atomically (RTDB transaction on the private state), then rewrites the four
 * seat views. Returns the new version. Duplicate clientActionIds are ignored (idempotent).
 */
async function applyToSession(
  id: string,
  meta: SessionMeta,
  action: GameAction,
  clientActionId: string,
): Promise<{ version: number; status: MatchState['status']; state: StoredState }> {
  const stateRef = rtdb.ref(`gameSessions/${id}/state`);
  let error: HttpsError | null = null;
  let produced: StoredState | null = null;
  let recent: GameEvent[] = [];
  const res = await stateRef.transaction((raw: StoredState | null) => {
    if (!raw) return raw;
    const current = normalizeStoredState(raw);
    if (!current) return raw;
    if (current.appliedActionIds[clientActionId]) {
      produced = current;
      return current;
    }
    if (current.status !== 'PLAYING') {
      error = new HttpsError('failed-precondition', 'A partida já terminou.');
      return;
    }
    if (!getAvailableActions(current, action.seat).includes(action.type)) {
      error = new HttpsError('failed-precondition', 'Essa jogada não é permitida agora.');
      return;
    }
    let next: StoredState;
    try {
      const before = current.events.length;
      const applied = applyAction(current, action);
      recent = applied.events.slice(before);
      next = {
        ...(applied as StoredState),
        appliedActionIds: { ...current.appliedActionIds, [clientActionId]: now() },
        aiRngState: current.aiRngState,
        trucos: { ...current.trucos },
      };
    } catch (e) {
      error = new HttpsError('failed-precondition', (e as Error).message);
      return;
    }
    const actor = meta.players[String(action.seat)];
    if (actor && !actor.bot) {
      const t = next.trucos[actor.uid] ?? { called: 0, accepted: 0 };
      if (action.type === 'REQUEST_TRUCO' || action.type === 'RAISE') t.called++;
      if (action.type === 'ACCEPT_TRUCO') t.accepted++;
      next.trucos[actor.uid] = t;
    }
    produced = trim(next);
    return produced;
  });
  if (error) throw error;
  if (!res.snapshot.exists() || !produced)
    throw new HttpsError('not-found', 'Partida não encontrada.');
  const state = produced as StoredState;
  await rtdb.ref(`gameSessions/${id}/views`).set(buildViews(state, recent));
  return { version: state.version, status: state.status, state };
}

async function finishIfNeeded(id: string, meta: SessionMeta, state: StoredState) {
  if (state.status !== 'FINISHED' || state.winner === null) return;
  const players = Object.values(meta.players).map((p) => ({
    uid: p.uid,
    seat: p.seat,
    nickname: p.nickname,
    avatarId: p.avatarId,
    bot: p.bot,
  }));
  const progression = await processProgression({
    matchId: id,
    mode: 'online',
    players,
    scores: state.scores,
    winnerTeam: state.winner,
    handsPlayed: state.handsPlayed,
    trucosByUid: state.trucos,
  });
  const updates: Record<string, unknown> = {
    [`gameSessions/${id}/meta/status`]: 'finished',
    [`gameSessions/${id}/meta/winnerTeam`]: state.winner,
    [`gameSessions/${id}/meta/updatedAt`]: now(),
  };
  for (const p of players) {
    if (p.bot) continue;
    updates[`userSessions/${p.uid}/active`] = null;
    // Each player reads their own rewards on the result screen (rules restrict it to the seat owner).
    const earned = progression.byUid[p.uid];
    if (earned) updates[`gameSessions/${id}/results/${p.seat}`] = earned;
  }
  if (meta.roomCode) updates[`rooms/${meta.roomCode}/status`] = 'closed';
  await rtdb.ref().update(updates);
}

/** Lets bots act one step at a time. Called by clients after a short delay so humans see pacing. */
async function stepBots(
  id: string,
  meta: SessionMeta,
  state: StoredState,
  maxSteps = 1,
): Promise<StoredState> {
  let current = state;
  const botSeats = new Map<Seat, ReturnType<typeof aiForDifficulty>>();
  for (const p of Object.values(meta.players))
    if (p.bot) botSeats.set(p.seat as Seat, aiForDifficulty('normal'));
  for (let i = 0; i < maxSteps; i++) {
    if (current.status !== 'PLAYING') break;
    const rng = createRng(current.aiRngState);
    const action = nextAIAction(current, botSeats, rng);
    if (!action) break;
    const applied = await applyToSession(id, meta, action, `bot_${current.version}_${action.seat}`);
    current = { ...applied.state, aiRngState: rng.state() };
    await rtdb.ref(`gameSessions/${id}/state/aiRngState`).set(current.aiRngState);
  }
  return current;
}

export const submitGameAction = authedCallable<
  { sessionId: string; action: GameAction; clientActionId: string },
  { version: number; status: MatchState['status'] }
>(
  async ({ uid, data }) => {
    const meta = await loadMeta(data.sessionId);
    if (meta.status !== 'playing')
      throw new HttpsError('failed-precondition', 'A partida já terminou.');
    const seat = seatOf(meta, uid);
    if (data.action.seat !== seat)
      throw new HttpsError('permission-denied', 'Você só pode jogar pelo seu assento.');
    const result = await applyToSession(data.sessionId, meta, data.action, data.clientActionId);
    await finishIfNeeded(data.sessionId, meta, result.state);
    return { version: result.version, status: result.status };
  },
  (d) => {
    const o = obj(d, 'payload');
    return {
      sessionId: str(o.sessionId, 'sessionId', 4, 80),
      action: parseAction(o.action),
      clientActionId: str(o.clientActionId, 'clientActionId', 4, 120),
    };
  },
);

/** Thin wrappers required by the product API. */
export const requestTruco = authedCallable<
  { sessionId: string; clientActionId: string },
  { version: number; status: MatchState['status'] }
>(
  async ({ uid, data }) => {
    const meta = await loadMeta(data.sessionId);
    const seat = seatOf(meta, uid);
    const result = await applyToSession(
      data.sessionId,
      meta,
      { type: 'REQUEST_TRUCO', seat },
      data.clientActionId,
    );
    return { version: result.version, status: result.status };
  },
  (d) => {
    const o = obj(d, 'payload');
    return {
      sessionId: str(o.sessionId, 'sessionId', 4, 80),
      clientActionId: str(o.clientActionId, 'clientActionId', 4, 120),
    };
  },
);

export const respondTruco = authedCallable<
  { sessionId: string; response: 'ACCEPT_TRUCO' | 'RAISE' | 'RUN'; clientActionId: string },
  { version: number; status: MatchState['status'] }
>(
  async ({ uid, data }) => {
    const meta = await loadMeta(data.sessionId);
    const seat = seatOf(meta, uid);
    const result = await applyToSession(
      data.sessionId,
      meta,
      { type: data.response, seat } as GameAction,
      data.clientActionId,
    );
    await finishIfNeeded(data.sessionId, meta, result.state);
    return { version: result.version, status: result.status };
  },
  (d) => {
    const o = obj(d, 'payload');
    return {
      sessionId: str(o.sessionId, 'sessionId', 4, 80),
      response: oneOf(o.response, ['ACCEPT_TRUCO', 'RAISE', 'RUN'] as const, 'response'),
      clientActionId: str(o.clientActionId, 'clientActionId', 4, 120),
    };
  },
);

/** Any human at the table may ask the server to let the next bot act (one step per call). */
export const advanceBots = authedCallable<
  { sessionId: string },
  { version: number; status: MatchState['status'] }
>(
  async ({ uid, data }) => {
    const meta = await loadMeta(data.sessionId);
    seatOf(meta, uid);
    if (meta.status !== 'playing') return { version: 0, status: 'FINISHED' };
    const snap = await rtdb.ref(`gameSessions/${data.sessionId}/state`).get();
    const state = normalizeStoredState(snap.val());
    if (!state) throw new HttpsError('not-found', 'Partida não encontrada.');
    const actors = seatsToAct(state);
    const botActs = actors.some((s) => meta.players[String(s)]?.bot);
    if (!botActs) return { version: state.version, status: state.status };
    const next = await stepBots(data.sessionId, meta, state, 1);
    await finishIfNeeded(data.sessionId, meta, next);
    return { version: next.version, status: next.status };
  },
  (d) => ({ sessionId: str(obj(d, 'payload').sessionId, 'sessionId', 4, 80) }),
);

export const abandonMatch = authedCallable<{ sessionId: string }, { ok: true }>(
  async ({ uid, data }) => {
    const meta = await loadMeta(data.sessionId);
    const seat = seatOf(meta, uid);
    if (meta.status !== 'playing') return { ok: true };
    const stateSnap = await rtdb.ref(`gameSessions/${data.sessionId}/state`).get();
    const state = normalizeStoredState(stateSnap.val());
    if (!state) throw new HttpsError('not-found', 'Partida não encontrada.');
    // The abandoning team forfeits: the opponents win with the target score.
    const winner = (seat % 2 === 0 ? 1 : 0) as 0 | 1;
    const scores: [number, number] = [state.scores[0], state.scores[1]];
    scores[winner] = state.config.targetScore;
    const players = Object.values(meta.players).map((p) => ({
      uid: p.uid,
      seat: p.seat,
      nickname: p.nickname,
      avatarId: p.avatarId,
      bot: p.bot,
    }));
    await processProgression({
      matchId: data.sessionId,
      mode: 'online',
      players,
      scores,
      winnerTeam: winner,
      handsPlayed: state.handsPlayed,
      trucosByUid: state.trucos,
    });
    const updates: Record<string, unknown> = {
      [`gameSessions/${data.sessionId}/meta/status`]: 'abandoned',
      [`gameSessions/${data.sessionId}/meta/abandonedBy`]: uid,
      [`gameSessions/${data.sessionId}/meta/winnerTeam`]: winner,
      [`gameSessions/${data.sessionId}/meta/updatedAt`]: now(),
      [`gameSessions/${data.sessionId}/state/status`]: 'FINISHED',
      [`gameSessions/${data.sessionId}/state/winner`]: winner,
    };
    for (const p of players) if (!p.bot) updates[`userSessions/${p.uid}/active`] = null;
    if (meta.roomCode) updates[`rooms/${meta.roomCode}/status`] = 'closed';
    await rtdb.ref().update(updates);
    return { ok: true };
  },
  (d) => ({ sessionId: str(obj(d, 'payload').sessionId, 'sessionId', 4, 80) }),
);

/** Marks the player as connected again and re-publishes the view (used after reconnection). */
export const rejoinMatch = authedCallable<{ sessionId: string }, { ok: true }>(
  async ({ uid, data }) => {
    const meta = await loadMeta(data.sessionId);
    const seat = seatOf(meta, uid);
    await rtdb.ref(`gameSessions/${data.sessionId}/meta/players/${seat}/connected`).set(true);
    return { ok: true };
  },
  (d) => ({ sessionId: str(obj(d, 'payload').sessionId, 'sessionId', 4, 80) }),
);
