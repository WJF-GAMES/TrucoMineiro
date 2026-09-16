import { authedCallable, HttpsError, obj, oneOf, str } from './lib/callable';
import { logger } from 'firebase-functions/v2';
import { db, now, rtdb } from './lib/admin';
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
  eventsForSeat,
  getAvailableActions,
  nextAIAction,
  seatsToAct,
  viewForSeat,
} from './domain/game';
import { Room, RoomPlayer, SessionMeta, SessionPlayer } from './domain/model/types';
import { DISCONNECT_AI_GRACE_MS } from './friendRoomConfig';
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

export function buildViews(
  state: StoredState,
  recent: GameEvent[],
): Record<string, SeatViewPayload> {
  const views: Record<string, SeatViewPayload> = {};
  for (const seat of [0, 1, 2, 3] as Seat[])
    // Cada assento recebe o próprio lote: carta virada dos outros sai sem identidade.
    views[String(seat)] = {
      ...viewForSeat(state, seat),
      recentEvents: eventsForSeat(recent, seat),
    };
  return views;
}

/**
 * Publica as views, **nunca para trás**.
 *
 * O estado é serializado pela transação, mas a publicação das views é uma escrita separada: duas
 * ações aplicadas quase juntas podem chegar aqui fora de ordem e a mais velha sobrescrever a mais
 * nova. Não é hipótese — `advanceBots` é chamado por *qualquer* jogador da sessão, num timer, e
 * corre contra a carta que um humano acabou de jogar. O estado seguiria certo e a mesa de todo
 * mundo ficaria parada numa versão anterior até a ação seguinte.
 *
 * A transação compara com o que já está publicado e desiste (retorna `undefined`) se for mais
 * novo. Escrever a mesma versão de novo é inofensivo e mantém o caminho idempotente funcionando.
 */
async function publishViews(id: string, state: StoredState, recent: GameEvent[]) {
  const ref = rtdb.ref(`gameSessions/${id}/views`);
  await ref.transaction((current: Record<string, SeatViewPayload> | null) => {
    if (!shouldPublishViews(current?.['0']?.version, state.version)) return undefined;
    return buildViews(state, recent);
  });
}

/** A decisão de `publishViews`, isolada para o teste: só publica o que não é mais velho. */
export function shouldPublishViews(publishedVersion: unknown, nextVersion: number): boolean {
  return typeof publishedVersion !== 'number' || publishedVersion <= nextVersion;
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
      disconnectedAt: null,
      reservedFor: p.bot ? (p.reservedFor ?? null) : null,
      pendingUid: null,
      replacedUid: null,
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

/**
 * Quem joga por este assento agora. IA: bot de verdade, ou humano que caiu e está fora há mais que
 * a tolerância — a partida nunca fica parada na vez de quem desconectou. Quando ele volta
 * (`connected` de novo), a vez é dele outra vez; cada ação é atômica, então não há troca no meio.
 */
export function isAiControlled(p: SessionPlayer | undefined, t: number): boolean {
  if (!p) return false;
  if (p.bot) return true;
  return (
    p.connected === false &&
    p.disconnectedAt != null &&
    t - p.disconnectedAt >= DISCONNECT_AI_GRACE_MS
  );
}

/**
 * Ponto seguro para trocar a IA por um humano: começo de mão, antes de qualquer carta, truco ou
 * decisão pendente. Nunca no meio de vaza, resposta de truco ou resolução.
 */
export function isSafeSwapPoint(state: MatchState): boolean {
  if (state.status !== 'PLAYING') return false;
  const hand = state.hand;
  if (hand.phase === 'SHUFFLING') return true;
  return (
    hand.phase === 'PLAY' &&
    hand.rounds.length === 0 &&
    hand.currentRound.length === 0 &&
    hand.truco === null &&
    hand.tieBreak === null
  );
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
    // Truco feito pela IA no lugar de quem caiu não conta para as estatísticas dele.
    if (actor && !actor.bot && !clientActionId.startsWith('bot_')) {
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
  await publishViews(id, state, recent);
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
  if (meta.roomCode) {
    updates[`rooms/${meta.roomCode}/status`] = 'closed';
    updates[`rooms/${meta.roomCode}/closedReason`] = 'finished';
  }
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
  const t = now();
  for (const p of Object.values(meta.players))
    if (isAiControlled(p, t)) botSeats.set(p.seat as Seat, aiForDifficulty('normal'));
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
    // Troca pendente (convidado que chegou atrasado) entra antes de a IA jogar de novo.
    const swapped = await trySeatSwaps(data.sessionId, state);
    const current = swapped ? await loadMeta(data.sessionId) : meta;
    const actors = seatsToAct(state);
    const t = now();
    const botActs = actors.some((s) => isAiControlled(current.players[String(s)], t));
    if (!botActs) return { version: state.version, status: state.status };
    const next = await stepBots(data.sessionId, current, state, 1);
    await finishIfNeeded(data.sessionId, current, next);
    return { version: next.version, status: next.status };
  },
  (d) => ({ sessionId: str(obj(d, 'payload').sessionId, 'sessionId', 4, 80) }),
);

/**
 * Humano saindo no meio da partida. Com outro humano na mesa, a vaga passa para a IA e a partida
 * continua — quem saiu leva a derrota só para si. Se era o último humano, a dupla dele entrega a
 * partida como antes. Tudo numa transação: duas saídas simultâneas não deixam assento sem dono.
 */
export const abandonMatch = authedCallable<{ sessionId: string }, { ok: true }>(
  async ({ uid, data }) => {
    const meta = await loadMeta(data.sessionId);
    const seat = seatOf(meta, uid);
    if (meta.status !== 'playing') return { ok: true };
    const stateSnap = await rtdb.ref(`gameSessions/${data.sessionId}/state`).get();
    const state = normalizeStoredState(stateSnap.val());
    if (!state) throw new HttpsError('not-found', 'Partida não encontrada.');
    const leaver = meta.players[String(seat)]!;
    const winner = (seat % 2 === 0 ? 1 : 0) as 0 | 1;
    const forfeitScores: [number, number] = [state.scores[0], state.scores[1]];
    forfeitScores[winner] = state.config.targetScore;

    let handedToAi = false;
    await rtdb
      .ref(`gameSessions/${data.sessionId}/meta/players`)
      .transaction((players: SessionMeta['players'] | null) => {
        handedToAi = false;
        if (!players) return players;
        const mine = players[String(seat)];
        if (!mine || mine.uid !== uid || mine.bot) return undefined;
        const others = Object.values(players).filter((p) => !p.bot && p.uid !== uid);
        if (others.length === 0) return undefined;
        handedToAi = true;
        return {
          ...players,
          [String(seat)]: {
            ...mine,
            uid: `bot_left_${seat}_${Math.random().toString(36).slice(2, 8)}`,
            nickname: `${mine.nickname.slice(0, 16)} (IA)`,
            bot: true,
            connected: true,
            disconnectedAt: null,
            reservedFor: null,
            pendingUid: null,
            replacedUid: uid,
          },
        };
      });

    if (handedToAi) {
      // Derrota só para quem saiu; a mesa segue com a IA no lugar dele.
      await processProgression({
        matchId: `${data.sessionId}_left_${uid}`,
        mode: 'online',
        players: [{ uid, seat, nickname: leaver.nickname, avatarId: leaver.avatarId, bot: false }],
        scores: forfeitScores,
        winnerTeam: winner,
        handsPlayed: state.handsPlayed,
        trucosByUid: state.trucos,
      });
      await rtdb.ref().update({
        [`userSessions/${uid}/active`]: null,
        [`gameSessions/${data.sessionId}/meta/updatedAt`]: now(),
        ...(meta.roomCode ? { [`userRooms/${uid}`]: null } : {}),
      });
      return { ok: true };
    }

    // Último humano: a dupla dele entrega a partida.
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
      scores: forfeitScores,
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
    if (meta.roomCode) {
      updates[`rooms/${meta.roomCode}/status`] = 'closed';
      updates[`rooms/${meta.roomCode}/closedReason`] = 'abandoned';
    }
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
    await rtdb
      .ref(`gameSessions/${data.sessionId}/meta/players/${seat}`)
      .update({ connected: true, disconnectedAt: null });
    return { ok: true };
  },
  (d) => ({ sessionId: str(obj(d, 'payload').sessionId, 'sessionId', 4, 80) }),
);

/**
 * Convidado que aceitou depois de a IA ocupar a vaga dele: marca a troca. Só vale para o dono da
 * reserva e nunca cria um segundo controlador — a troca acontece em `trySeatSwaps`.
 */
export async function requestSeatReclaim(
  sessionId: string,
  seat: number,
  uid: string,
): Promise<boolean> {
  let ok = false;
  await rtdb
    .ref(`gameSessions/${sessionId}/meta/players/${seat}`)
    .transaction((p: SessionPlayer | null) => {
      ok = false;
      if (!p) return p;
      if (!p.bot) {
        ok = p.uid === uid;
        return undefined;
      }
      if (p.reservedFor !== uid) return undefined;
      ok = true;
      return p.pendingUid === uid ? undefined : { ...p, pendingUid: uid };
    });
  const status = (await rtdb.ref(`gameSessions/${sessionId}/meta/status`).get()).val();
  return ok && status === 'playing';
}

/**
 * Aplica as trocas IA → humano pendentes, se a partida estiver num ponto seguro. Cada assento
 * troca numa transação própria: ou continua a IA, ou passa a ser o humano — nunca os dois.
 * Devolve se alguma troca aconteceu.
 */
export async function trySeatSwaps(sessionId: string, known?: StoredState): Promise<boolean> {
  const meta = await loadMeta(sessionId);
  const pending = Object.values(meta.players).filter((p) => p.bot && p.pendingUid);
  if (pending.length === 0 || meta.status !== 'playing') return false;
  const state =
    known ?? normalizeStoredState((await rtdb.ref(`gameSessions/${sessionId}/state`).get()).val());
  if (!state || !isSafeSwapPoint(state)) return false;
  let any = false;
  for (const seatPlayer of pending) {
    const human = seatPlayer.pendingUid!;
    const profile = (await db.doc(`profiles/${human}`).get()).data() as
      { nickname?: string; avatarId?: SessionPlayer['avatarId'] } | undefined;
    let swapped = false;
    let botUid = '';
    await rtdb
      .ref(`gameSessions/${sessionId}/meta/players/${seatPlayer.seat}`)
      .transaction((p: SessionPlayer | null) => {
        swapped = false;
        if (!p) return p;
        if (!p.bot || p.pendingUid !== human) return undefined;
        swapped = true;
        botUid = p.uid;
        return {
          ...p,
          uid: human,
          nickname: profile?.nickname ?? p.nickname,
          avatarId: profile?.avatarId ?? p.avatarId,
          bot: false,
          connected: true,
          disconnectedAt: null,
          reservedFor: null,
          pendingUid: null,
        };
      });
    if (!swapped) continue;
    any = true;
    const t = now();
    const updates: Record<string, unknown> = {
      [`userSessions/${human}/active`]: sessionId,
      [`gameSessions/${sessionId}/meta/updatedAt`]: t,
    };
    if (meta.roomCode) {
      const player: RoomPlayer = {
        uid: human,
        seat: seatPlayer.seat,
        nickname: profile?.nickname ?? seatPlayer.nickname,
        avatarId: profile?.avatarId ?? seatPlayer.avatarId,
        ready: true,
        bot: false,
        joinedAt: t,
        connected: true,
      };
      updates[`rooms/${meta.roomCode}/players/${botUid}`] = null;
      updates[`rooms/${meta.roomCode}/players/${human}`] = player;
      updates[`rooms/${meta.roomCode}/invites/${human}/status`] = 'ACCEPTED';
      updates[`rooms/${meta.roomCode}/invites/${human}/respondedAt`] = t;
      updates[`userRooms/${human}`] = meta.roomCode;
    }
    await rtdb.ref().update(updates);
    logger.info('late_human_reclaimed_seat', { sessionId, seat: seatPlayer.seat });
  }
  return any;
}

/**
 * Convidado atrasado aguardando a vaga: o cliente pergunta a cada poucos segundos.
 * `seated` → já é dono do assento; `pending` → esperando o começo da próxima mão.
 */
export const claimReservedSeat = authedCallable<
  { sessionId: string },
  { status: 'seated' | 'pending' | 'unavailable' }
>(
  async ({ uid, data }) => {
    const meta = await loadMeta(data.sessionId);
    const players = Object.values(meta.players);
    if (players.some((p) => p.uid === uid && !p.bot)) return { status: 'seated' };
    if (meta.status !== 'playing' || !players.some((p) => p.bot && p.pendingUid === uid))
      return { status: 'unavailable' };
    await trySeatSwaps(data.sessionId);
    const after = await loadMeta(data.sessionId);
    return {
      status: Object.values(after.players).some((p) => p.uid === uid && !p.bot)
        ? 'seated'
        : 'pending',
    };
  },
  (d) => ({ sessionId: str(obj(d, 'payload').sessionId, 'sessionId', 4, 80) }),
);
