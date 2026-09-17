import { Inject, Injectable } from '@nestjs/common';
import {
  ActorKind,
  AiDifficulty,
  Match,
  MatchMode,
  MatchParticipant,
  MatchStatus,
  Prisma,
  RoomClosedReason,
  RoomInviteStatus,
  RoomStatus,
  SeatController,
} from '@prisma/client';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { ProgressionService, MatchOutcomeInput, OutcomeResult } from '../progression/progression.service';
import { RealtimeService } from '../realtime/realtime.service';
import { rooms as wsRooms, S2C } from '../realtime/events';
import { AppConfig, CONFIG } from '../config/env';
import { AppError, MESSAGES } from '../common/errors';
import { moduleLogger } from '../common/logger';
import { now } from '../common/clock';
import { botKey, seed } from '../common/ids';
import { MetricsService } from '../metrics/metrics.service';
import {
  AIDifficulty,
  GameAction,
  GameEvent,
  InvalidActionError,
  MatchState,
  Seat,
  aiForDifficulty,
  applyAction,
  createRng,
  getAvailableActions,
  nextAIAction,
  seatsToAct,
  timeoutAction,
  viewForSeat,
} from '../domain/game';
import type { AvatarId, MatchHistoryEntry, ProgressionResult } from '../domain/model/types';
import {
  StoredState,
  newStoredState,
  readStoredState,
  timerDurationOf,
  timerKeyOf,
  trimState,
} from './stored-state';
import { buildMeta, buildView, MatchMeta, SERVER_TIMEOUT_GRACE_MS, SeatViewPayload } from './game-views';
import { MAX_AI_ACTIONS, replayAiMatch } from './action-parser';

const log = moduleLogger('game');

/** Intervalo mínimo entre duas jogadas da IA pedidas pelo cliente (anti-spam). */
const MIN_CLIENT_BOT_GAP_MS = 250;

export interface SeatOccupant {
  seat: number;
  userId: string | null;
  botKey: string | null;
  nickname: string;
  avatarId: string;
  isBot: boolean;
  connected: boolean;
  reservedForUserId: string | null;
}

interface Locked {
  tx: Tx;
  match: Match;
  roomCode: string | null;
  participants: MatchParticipant[];
  state: StoredState;
  dirty: boolean;
  metaChanged: boolean;
  recent: GameEvent[] | null;
  effects: (() => Promise<void> | void)[];
  now: number;
}

export interface ActionResult {
  version: number;
  status: MatchState['status'];
  duplicate?: boolean;
}

/** Ponto seguro para trocar IA ↔ humano: começo de mão, antes de qualquer carta/truco. */
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function assertMatchId(matchId: string) {
  if (!UUID_RE.test(matchId)) throw new AppError('MATCH_NOT_FOUND', 'Partida não encontrada.');
}

const isAi = (p: MatchParticipant) => p.controller !== SeatController.HUMAN;
const isHumanOwned = (p: MatchParticipant) =>
  p.userId !== null && p.controller !== SeatController.AI_PERMANENT;

const DIFFICULTY: Record<AIDifficulty, AiDifficulty> = {
  easy: AiDifficulty.EASY,
  normal: AiDifficulty.NORMAL,
  hard: AiDifficulty.HARD,
};

/**
 * Partida online autoritativa. O estado privado vive em `Match.state` e toda mudança acontece
 * dentro de uma transação com `SELECT ... FOR UPDATE` na linha da partida — ações humanas, jogadas
 * da IA, timeouts e trocas de controlador são serializadas entre instâncias. Depois do commit,
 * cada assento recebe a sua projeção pelo WebSocket.
 */
@Injectable()
export class GameService {
  private tickHook: ((matchId: string, at: Date | null) => void) | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly progression: ProgressionService,
    private readonly realtime: RealtimeService,
    private readonly metrics: MetricsService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  /** O agendador registra aqui o aviso de "próximo tick" (timer local de baixa latência). */
  onTickScheduled(hook: (matchId: string, at: Date | null) => void) {
    this.tickHook = hook;
  }

  // --- Criação --------------------------------------------------------------------------------

  /** Cria a partida a partir dos 4 assentos da sala (dentro da transação da sala). */
  async createOnlineMatch(tx: Tx, roomId: string, seats: SeatOccupant[]): Promise<{ matchId: string; humans: string[] }> {
    if (seats.length !== 4) throw new AppError('ROOM_NOT_READY', 'A mesa precisa de 4 jogadores.');
    const t = now();
    const s = seed();
    const aiSeed = seed();
    const state = newStoredState(s, aiSeed, t);
    const firstDeadline = new Date(t + timerDurationOf(state));
    const match = await tx.match.create({
      data: {
        mode: MatchMode.ONLINE,
        status: MatchStatus.PLAYING,
        roomId,
        state: trimState(state) as unknown as Prisma.InputJsonValue,
        stateVersion: state.version,
        seed: BigInt(s),
        aiSeed: BigInt(aiSeed),
        turnStartedAt: new Date(t),
        turnDeadlineAt: firstDeadline,
        nextTickAt: new Date(t),
      },
    });
    await tx.matchParticipant.createMany({
      data: seats.map((p) => ({
        matchId: match.id,
        seat: p.seat,
        team: p.seat % 2,
        userId: p.isBot ? null : p.userId,
        botKey: p.isBot ? (p.botKey ?? botKey(p.seat)) : null,
        nickname: p.nickname,
        avatarId: p.avatarId,
        controller: p.isBot ? SeatController.AI_PERMANENT : SeatController.HUMAN,
        connected: p.isBot ? true : p.connected,
        reservedForUserId: p.isBot ? p.reservedForUserId : null,
      })),
    });
    await tx.gameHand.create({
      data: { matchId: match.id, number: state.hand.number, dealerSeat: state.hand.dealerSeat, value: state.hand.value },
    });
    const humans = seats.filter((p) => !p.isBot && p.userId).map((p) => p.userId!);
    this.metrics.inc('matches_started_total', { mode: 'online' });
    return { matchId: match.id, humans };
  }

  /** Depois do commit da sala: avisa os humanos e agenda o primeiro tick. */
  announceStarted(matchId: string, humans: string[]) {
    for (const userId of humans) this.realtime.toUser(userId, S2C.activeMatch, { matchId });
    this.tickHook?.(matchId, new Date(now()));
  }

  // --- Transação com trava ------------------------------------------------------------------

  private async withMatch<T>(matchId: string, fn: (ctx: Locked) => Promise<T>): Promise<T> {
    assertMatchId(matchId);
    const effects: Locked['effects'] = [];
    const value = await this.prisma.tx(async (tx) => {
      effects.length = 0;
      const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Match" WHERE id = ${matchId}::uuid FOR UPDATE`;
      if (rows.length === 0) throw new AppError('MATCH_NOT_FOUND', 'Partida não encontrada.');
      const match = await tx.match.findUniqueOrThrow({
        where: { id: matchId },
        include: { room: { select: { code: true } } },
      });
      const participants = await tx.matchParticipant.findMany({
        where: { matchId },
        orderBy: { seat: 'asc' },
      });
      const state = readStoredState(match.state);
      if (!state && match.mode === MatchMode.ONLINE)
        throw new AppError('MATCH_NOT_FOUND', 'Partida não encontrada.');
      const ctx: Locked = {
        tx,
        match,
        roomCode: match.room?.code ?? null,
        participants,
        state: state!,
        dirty: false,
        metaChanged: false,
        recent: null,
        effects,
        now: now(),
      };
      const out = await fn(ctx);
      await this.persist(ctx);
      return out;
    });
    for (const effect of effects) {
      try {
        await effect();
      } catch (e) {
        log.warn('effect_failed', { matchId, error: (e as Error).message });
      }
    }
    return value;
  }

  private participant(ctx: Locked, seat: number): MatchParticipant {
    return ctx.participants.find((p) => p.seat === seat)!;
  }

  private seatOfUser(ctx: Locked, userId: string): MatchParticipant {
    const p = ctx.participants.find((x) => x.userId === userId && isHumanOwned(x));
    if (!p) throw new AppError('NOT_IN_MATCH', 'Você não está nessa partida.');
    return p;
  }

  private async updateParticipant(ctx: Locked, seat: number, data: Prisma.MatchParticipantUncheckedUpdateInput) {
    const updated = await ctx.tx.matchParticipant.update({
      where: { matchId_seat: { matchId: ctx.match.id, seat } },
      data,
    });
    ctx.participants = ctx.participants.map((p) => (p.seat === seat ? updated : p));
    ctx.metaChanged = true;
    return updated;
  }

  /** Grava estado, relógio e próximo tick; enfileira as publicações para depois do commit. */
  private async persist(ctx: Locked) {
    if (ctx.match.mode !== MatchMode.ONLINE) return;
    const data: Prisma.MatchUpdateInput = {};
    if (ctx.dirty) {
      const key = timerKeyOf(ctx.state);
      let turnStartedAt = ctx.match.turnStartedAt;
      let turnDeadlineAt = ctx.match.turnDeadlineAt;
      if (key !== ctx.state.timerKey) {
        turnStartedAt = new Date(ctx.now);
        turnDeadlineAt = new Date(ctx.now + timerDurationOf(ctx.state));
        ctx.state = { ...ctx.state, timerKey: key };
      }
      ctx.match = { ...ctx.match, turnStartedAt, turnDeadlineAt };
      Object.assign(data, {
        state: trimState(ctx.state) as unknown as Prisma.InputJsonValue,
        stateVersion: ctx.state.version,
        scoreTeam0: ctx.state.scores[0],
        scoreTeam1: ctx.state.scores[1],
        handsPlayed: ctx.state.handsPlayed,
        turnStartedAt,
        turnDeadlineAt,
      });
    }
    if (ctx.match.status === MatchStatus.PLAYING && ctx.state.status === 'FINISHED') {
      await this.finishInTx(ctx);
    }
    const next = this.computeNextTick(ctx);
    Object.assign(data, { nextTickAt: next });
    if (ctx.match.status !== MatchStatus.PLAYING) {
      Object.assign(data, {
        status: ctx.match.status,
        winnerTeam: ctx.match.winnerTeam,
        finishedAt: ctx.match.finishedAt,
        abandonedByUserId: ctx.match.abandonedByUserId,
        nextTickAt: null,
      });
    }
    const updated = await ctx.tx.match.update({ where: { id: ctx.match.id }, data });
    ctx.match = { ...ctx.match, updatedAt: updated.updatedAt };

    const matchId = ctx.match.id;
    const snapshot = { match: ctx.match, roomCode: ctx.roomCode, participants: ctx.participants, state: ctx.state };
    if (ctx.dirty) {
      const recent = ctx.recent ?? [];
      ctx.effects.unshift(() => this.publishViews(matchId, snapshot.state, recent, snapshot.match));
    }
    if (ctx.metaChanged || ctx.dirty) {
      ctx.effects.unshift(() => this.publishMeta(snapshot.match, snapshot.roomCode, snapshot.participants));
    }
    const at = ctx.match.status === MatchStatus.PLAYING ? next : null;
    ctx.effects.push(() => this.tickHook?.(matchId, at));
  }

  // --- Aplicação de ações -------------------------------------------------------------------

  /** Aplica uma ação validada pelo motor. Idempotente por `clientActionId`. */
  private async applyLocked(
    ctx: Locked,
    action: GameAction,
    clientActionId: string,
    actor: ActorKind,
    userId: string | null,
  ): Promise<ActionResult> {
    const dup = await ctx.tx.gameAction.findUnique({
      where: { matchId_clientActionId: { matchId: ctx.match.id, clientActionId } },
      select: { id: true },
    });
    if (dup) return { version: ctx.state.version, status: ctx.state.status, duplicate: true };
    if (ctx.match.status !== MatchStatus.PLAYING || ctx.state.status !== 'PLAYING')
      throw new AppError('MATCH_FINISHED', 'A partida já terminou.');

    const available = getAvailableActions(ctx.state, action.seat);
    if (!available.includes(action.type)) {
      if (available.length === 0) throw new AppError('NOT_YOUR_TURN', 'Não é a sua vez.');
      throw new AppError('INVALID_ACTION', 'Essa jogada não é permitida agora.');
    }
    const before = ctx.state.events.length;
    let applied: MatchState;
    try {
      applied = applyAction(ctx.state, action);
    } catch (e) {
      if (e instanceof InvalidActionError) {
        const code = action.type === 'PLAY_CARD' || action.type === 'PLAY_CARD_COVERED' ? 'INVALID_CARD' : 'INVALID_ACTION';
        throw new AppError(code, e.message);
      }
      throw e;
    }
    const recent = applied.events.slice(before);
    const seq = ctx.state.seq + 1;
    ctx.state = {
      ...(applied as StoredState),
      aiRngState: ctx.state.aiRngState,
      recent,
      timerKey: ctx.state.timerKey,
      seq,
      lastActionAt: ctx.now,
    };
    ctx.recent = recent;
    ctx.dirty = true;

    const payload =
      action.type === 'PLAY_CARD' || action.type === 'PLAY_CARD_COVERED'
        ? { cardId: action.cardId }
        : action.type === 'CUT' && action.depth
          ? { depth: action.depth }
          : undefined;
    await ctx.tx.gameAction.create({
      data: {
        matchId: ctx.match.id,
        sequence: seq,
        clientActionId,
        seat: action.seat,
        actor,
        userId,
        type: action.type,
        payload: payload as Prisma.InputJsonValue | undefined,
        stateVersion: ctx.state.version,
      },
    });
    await this.recordEvents(ctx, recent);

    // Truco pedido pela IA no lugar de quem caiu não conta para as estatísticas dele.
    const p = this.participant(ctx, action.seat);
    if (actor === ActorKind.HUMAN && p.controller === SeatController.HUMAN) {
      if (action.type === 'REQUEST_TRUCO' || action.type === 'RAISE')
        await this.updateParticipant(ctx, action.seat, { trucosCalled: { increment: 1 } });
      if (action.type === 'ACCEPT_TRUCO')
        await this.updateParticipant(ctx, action.seat, { trucosAccepted: { increment: 1 } });
    }
    this.metrics.inc('game_actions_total', { actor });
    return { version: ctx.state.version, status: ctx.state.status };
  }

  /** Mãos, vazas e eventos públicos relevantes (sem animação, sem carta secreta). */
  private async recordEvents(ctx: Locked, events: GameEvent[]) {
    const matchId = ctx.match.id;
    const handNumber = ctx.state.hand.number;
    const rows: Prisma.MatchEventCreateManyInput[] = [];
    let seqBase = (await ctx.tx.matchEvent.count({ where: { matchId } })) + 1;
    // Eventos antes de um HAND_STARTED no mesmo lote pertencem à mão que acabou de terminar.
    const startedAt = events.findIndex((e) => e.type === 'HAND_STARTED');
    const started = startedAt >= 0 ? events[startedAt] : undefined;
    const handOf = (i: number) =>
      started && started.type === 'HAND_STARTED' && i < startedAt ? started.number - 1 : handNumber;
    for (const [i, e] of events.entries()) {
      switch (e.type) {
        case 'HAND_STARTED':
          await ctx.tx.gameHand.upsert({
            where: { matchId_number: { matchId, number: e.number } },
            create: { matchId, number: e.number, dealerSeat: e.dealerSeat, value: 1 },
            update: {},
          });
          break;
        case 'ROUND_ENDED': {
          const number = handOf(i);
          await ctx.tx.gameTrick.upsert({
            where: { matchId_handNumber_round: { matchId, handNumber: number, round: e.round } },
            create: { matchId, handNumber: number, round: e.round, winnerTeam: e.winner, winnerSeat: e.winnerSeat },
            update: {},
          });
          break;
        }
        case 'HAND_ENDED':
          await ctx.tx.gameHand.updateMany({
            where: { matchId, number: handOf(i) },
            data: {
              winnerTeam: e.result.winner,
              points: e.result.points,
              reason: e.result.reason,
              scoreTeam0: e.scores[0],
              scoreTeam1: e.scores[1],
              endedAt: new Date(ctx.now),
            },
          });
          break;
        default:
          break;
      }
      if (
        e.type === 'HAND_ENDED' ||
        e.type === 'MATCH_ENDED' ||
        e.type === 'TRUCO_REQUESTED' ||
        e.type === 'TRUCO_ACCEPTED' ||
        e.type === 'TRUCO_RAISED' ||
        e.type === 'RAN' ||
        e.type === 'MAO_DE_ONZE_ACCEPTED' ||
        e.type === 'MAO_DE_ONZE_DECLINED' ||
        e.type === 'TIE_BREAK_STARTED' ||
        e.type === 'ROUND_ENDED'
      ) {
        rows.push({ matchId, sequence: seqBase++, type: e.type, payload: e as unknown as Prisma.InputJsonValue });
      }
    }
    if (rows.length > 0) await ctx.tx.matchEvent.createMany({ data: rows });
  }


  // --- IA e relógio -------------------------------------------------------------------------

  private aiSeats(ctx: Locked) {
    const map = new Map<Seat, ReturnType<typeof aiForDifficulty>>();
    for (const p of ctx.participants) if (isAi(p)) map.set(p.seat as Seat, aiForDifficulty('normal'));
    return map;
  }

  /** A IA tem uma jogada a fazer agora? (humano na dupla que responde tem prioridade) */
  private aiMustAct(ctx: Locked): boolean {
    if (ctx.state.status !== 'PLAYING') return false;
    const rng = createRng(ctx.state.aiRngState);
    return nextAIAction(ctx.state, this.aiSeats(ctx), rng) !== null;
  }

  private async stepAi(ctx: Locked): Promise<boolean> {
    const rng = createRng(ctx.state.aiRngState);
    const action = nextAIAction(ctx.state, this.aiSeats(ctx), rng);
    if (!action) return false;
    const p = this.participant(ctx, action.seat);
    await this.applyLocked(
      ctx,
      action,
      `bot_${ctx.state.version}_${action.seat}_${p.controllerVersion}`,
      ActorKind.AI,
      null,
    );
    ctx.state = { ...ctx.state, aiRngState: rng.state() };
    return true;
  }

  /**
   * Ritmo da IA pelo servidor. Mesmo sem ninguém olhando (todos caíram) o ritmo é o de mesa:
   * quem está só reabrindo o app encontra a partida viva, não terminada em segundos.
   */
  private botDelay(_ctx: Locked): number {
    return this.config.botFallbackMs;
  }

  private computeNextTick(ctx: Locked): Date | null {
    if (ctx.match.status !== MatchStatus.PLAYING || ctx.state.status !== 'PLAYING') return null;
    const t = ctx.now;
    if (ctx.participants.some((p) => p.pendingUserId) && isSafeSwapPoint(ctx.state)) return new Date(t);
    const candidates: number[] = [];
    // Humano desconectado vira IA temporária depois da tolerância.
    for (const p of ctx.participants) {
      if (p.controller === SeatController.HUMAN && !p.connected && p.disconnectedAt)
        candidates.push(p.disconnectedAt.getTime() + this.config.disconnectAiGraceMs);
    }
    if (this.aiMustAct(ctx)) {
      candidates.push(ctx.state.lastActionAt + this.botDelay(ctx));
    } else {
      const actors = seatsToAct(ctx.state);
      const humanActs = actors.some((s) => !isAi(this.participant(ctx, s)));
      if (humanActs && ctx.match.turnDeadlineAt)
        candidates.push(ctx.match.turnDeadlineAt.getTime() + SERVER_TIMEOUT_GRACE_MS);
    }
    if (candidates.length === 0) return null;
    return new Date(Math.max(t, Math.min(...candidates)));
  }

  /** Converte humanos fora há mais que a tolerância em IA temporária. */
  private async takeOverDisconnected(ctx: Locked) {
    for (const p of ctx.participants) {
      if (p.controller !== SeatController.HUMAN || p.connected || !p.disconnectedAt) continue;
      if (ctx.now - p.disconnectedAt.getTime() < this.config.disconnectAiGraceMs) continue;
      await this.updateParticipant(ctx, p.seat, {
        controller: SeatController.AI_TEMPORARY,
        controllerVersion: { increment: 1 },
      });
      this.metrics.inc('ai_takeovers_total', { reason: 'disconnect' });
      log.info('ai_temporary_takeover', { matchId: ctx.match.id, seat: p.seat });
    }
  }

  /** Humano de volta: reassume já — cada ação é atômica sob a trava da partida. */
  private async reclaimIfNeeded(ctx: Locked, p: MatchParticipant) {
    if (p.controller === SeatController.AI_TEMPORARY) {
      await this.updateParticipant(ctx, p.seat, {
        controller: SeatController.HUMAN,
        controllerVersion: { increment: 1 },
        connected: true,
        disconnectedAt: null,
      });
      this.metrics.inc('ai_takeovers_total', { reason: 'returned' });
    } else if (!p.connected) {
      await this.updateParticipant(ctx, p.seat, { connected: true, disconnectedAt: null });
    }
  }

  /** Um passo do agendador: trocas pendentes, IA temporária, jogada da IA ou timeout. */
  async processTick(matchId: string): Promise<void> {
    await this.withMatch(matchId, async (ctx) => {
      if (ctx.match.status !== MatchStatus.PLAYING) return;
      await this.trySeatSwaps(ctx);
      await this.takeOverDisconnected(ctx);
      if (this.aiMustAct(ctx)) {
        if (ctx.now - ctx.state.lastActionAt >= this.botDelay(ctx) - 50) await this.stepAi(ctx);
        return;
      }
      const deadline = ctx.match.turnDeadlineAt?.getTime();
      if (deadline === undefined || ctx.now < deadline + SERVER_TIMEOUT_GRACE_MS) return;
      for (const seat of seatsToAct(ctx.state)) {
        const p = this.participant(ctx, seat);
        if (isAi(p)) continue;
        const action = timeoutAction(viewForSeat(ctx.state, seat), seat);
        if (!action) continue;
        await this.applyLocked(ctx, action, `timeout_${ctx.state.version}_${seat}`, ActorKind.TIMEOUT, p.userId);
        this.metrics.inc('turn_timeouts_total');
        break;
      }
    });
  }

  // --- Comandos dos jogadores ---------------------------------------------------------------

  async submitAction(userId: string, matchId: string, action: GameAction, clientActionId: string): Promise<ActionResult> {
    const started = Date.now();
    try {
      return await this.withMatch(matchId, async (ctx) => {
        const mine = this.seatOfUser(ctx, userId);
        if (action.seat !== mine.seat)
          throw new AppError('NOT_YOUR_SEAT', 'Você só pode jogar pelo seu assento.');
        // Quem manda jogada está conectado: se a IA segurava a vaga, ele reassume agora.
        await this.reclaimIfNeeded(ctx, mine);
        return this.applyLocked(ctx, action, `${userId}:${clientActionId}`, ActorKind.HUMAN, userId);
      });
    } finally {
      this.metrics.observe('game_action_duration_ms', Date.now() - started);
    }
  }

  /** O cliente pede o próximo passo da IA (ritmo da mesa). O servidor decide se cabe. */
  async requestBotStep(userId: string, matchId: string): Promise<ActionResult> {
    return this.withMatch(matchId, async (ctx) => {
      this.seatOfUser(ctx, userId);
      if (ctx.match.status !== MatchStatus.PLAYING) return { version: ctx.state.version, status: 'FINISHED' as const };
      await this.trySeatSwaps(ctx);
      if (this.aiMustAct(ctx) && ctx.now - ctx.state.lastActionAt >= MIN_CLIENT_BOT_GAP_MS) await this.stepAi(ctx);
      return { version: ctx.state.version, status: ctx.state.status };
    });
  }

  async setConnected(userId: string, matchId: string, connected: boolean): Promise<void> {
    await this.withMatch(matchId, async (ctx) => {
      const p = ctx.participants.find((x) => x.userId === userId && isHumanOwned(x));
      if (!p || ctx.match.status !== MatchStatus.PLAYING) return;
      if (connected) await this.reclaimIfNeeded(ctx, p);
      else if (p.connected)
        await this.updateParticipant(ctx, p.seat, { connected: false, disconnectedAt: new Date(ctx.now) });
    });
  }

  /** Reconexão: marca conectado e devolve o retrato da partida para este assento. */
  async join(userId: string, matchId: string) {
    return this.withMatch(matchId, async (ctx) => {
      const mine = ctx.participants.find((x) => x.userId === userId && isHumanOwned(x));
      const pending = ctx.participants.find((x) => x.pendingUserId === userId);
      if (!mine && !pending) throw new AppError('NOT_IN_MATCH', 'Você não está nessa partida.');
      if (mine && ctx.match.status === MatchStatus.PLAYING) await this.reclaimIfNeeded(ctx, mine);
      return this.snapshotOf(ctx, mine?.seat ?? null, userId);
    });
  }

  async snapshot(userId: string, matchId: string) {
    assertMatchId(matchId);
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      include: { participants: { orderBy: { seat: 'asc' } }, room: { select: { code: true } } },
    });
    if (!match || match.mode !== MatchMode.ONLINE) throw new AppError('MATCH_NOT_FOUND', 'Partida não encontrada.');
    const mine = match.participants.find((x) => x.userId === userId && isHumanOwned(x));
    const pending = match.participants.find((x) => x.pendingUserId === userId);
    const replaced = match.participants.find((x) => x.replacedUserId === userId);
    if (!mine && !pending && !replaced) throw new AppError('NOT_IN_MATCH', 'Você não está nessa partida.');
    const state = readStoredState(match.state)!;
    const ctx = {
      match,
      roomCode: match.room?.code ?? null,
      participants: match.participants,
      state,
    } as unknown as Locked;
    return this.snapshotOf(ctx, mine?.seat ?? null, userId, this.prisma);
  }

  private async snapshotOf(ctx: Locked, seat: number | null, userId: string, db: Tx | PrismaService = ctx.tx) {
    const uidOf = await this.uidResolver(ctx.participants, db, [ctx.match.abandonedByUserId]);
    const t = now();
    const meta = buildMeta(ctx.match, ctx.roomCode, ctx.participants, uidOf, t);
    const view =
      seat === null
        ? null
        : buildView(ctx.match.id, ctx.state, seat as Seat, ctx.state.recent ?? [], {
            startedAt: ctx.match.turnStartedAt,
            deadlineAt: ctx.match.turnDeadlineAt,
          }, t);
    const result = await db.matchResult.findFirst({
      where: { matchId: ctx.match.id, userId },
      orderBy: { createdAt: 'desc' },
    });
    return {
      meta,
      view,
      seat,
      result: result
        ? ({
            xpGained: result.xpGained,
            leaguePointsDelta: result.leaguePointsDelta,
            leveledUp: result.leveledUp,
            newLevel: result.newLevel,
            newLeagueId: result.newLeagueId,
          } as ProgressionResult)
        : null,
    };
  }

  private async uidResolver(participants: MatchParticipant[], db: Tx | PrismaService, extra: (string | null)[] = []) {
    const ids = new Set<string>();
    for (const p of participants)
      for (const id of [p.userId, p.reservedForUserId, p.pendingUserId, p.replacedUserId]) if (id) ids.add(id);
    for (const id of extra) if (id) ids.add(id);
    const rows = ids.size
      ? await db.user.findMany({ where: { id: { in: [...ids] } }, select: { id: true, firebaseUid: true } })
      : [];
    const map = new Map(rows.map((r) => [r.id, r.firebaseUid]));
    return (id: string | null | undefined) => (id ? (map.get(id) ?? null) : null);
  }

  private async publishMeta(match: Match, roomCode: string | null, participants: MatchParticipant[]) {
    const uidOf = await this.uidResolver(participants, this.prisma, [match.abandonedByUserId]);
    this.realtime.toMatch(match.id, S2C.gameMeta, buildMeta(match, roomCode, participants, uidOf, now()));
  }

  private publishViews(matchId: string, state: StoredState, recent: GameEvent[], match: Match) {
    const t = now();
    for (const seat of [0, 1, 2, 3] as Seat[]) {
      const view: SeatViewPayload = buildView(matchId, state, seat, recent, {
        startedAt: match.turnStartedAt,
        deadlineAt: match.turnDeadlineAt,
      }, t);
      this.realtime.toMatchSeat(matchId, seat, S2C.gameView, view);
    }
  }

  /** Assento de quem pode assistir a esta partida (o gateway usa para entrar nas salas certas). */
  async seatFor(userId: string, matchId: string): Promise<number | null> {
    const p = await this.prisma.matchParticipant.findFirst({
      where: { matchId, userId, controller: { not: SeatController.AI_PERMANENT } },
      select: { seat: true },
    });
    return p?.seat ?? null;
  }

  async isPendingFor(userId: string, matchId: string): Promise<boolean> {
    const n = await this.prisma.matchParticipant.count({ where: { matchId, pendingUserId: userId } });
    return n > 0;
  }

  // --- Fim da partida -----------------------------------------------------------------------

  private humansForOutcome(ctx: Locked): { userId: string; seat: number; trucosCalled: number; trucosAccepted: number }[] {
    return ctx.participants
      .filter(isHumanOwned)
      .map((p) => ({
        userId: p.userId!,
        seat: p.seat,
        trucosCalled: p.trucosCalled,
        trucosAccepted: p.trucosAccepted,
      }));
  }

  private async finishInTx(ctx: Locked) {
    const winner = ctx.state.winner;
    if (winner === null) return;
    ctx.match = {
      ...ctx.match,
      status: MatchStatus.FINISHED,
      winnerTeam: winner,
      finishedAt: new Date(ctx.now),
    };
    const humans = this.humansForOutcome(ctx);
    const input: MatchOutcomeInput = {
      matchId: ctx.match.id,
      key: ctx.match.id,
      mode: 'online',
      humans,
      scores: ctx.state.scores,
      winnerTeam: winner,
      handsPlayed: ctx.state.handsPlayed,
    };
    const result = await this.progression.applyInTx(ctx.tx, input);
    await this.closeRoom(ctx, RoomClosedReason.FINISHED);
    ctx.metaChanged = true;
    this.enqueueOutcomeEffects(ctx, input, result);
    this.metrics.inc('matches_finished_total', { mode: 'online' });
  }

  private enqueueOutcomeEffects(ctx: Locked, input: MatchOutcomeInput, result: OutcomeResult) {
    const matchId = ctx.match.id;
    ctx.effects.push(async () => {
      for (const h of input.humans) {
        const reward = result.byUserId[h.userId];
        if (reward) this.realtime.toMatchSeat(matchId, h.seat, S2C.gameResult, { matchId, seat: h.seat, result: reward });
        this.realtime.toUser(h.userId, S2C.activeMatch, { matchId: null });
      }
      await this.progression.afterCommit(input, result);
    });
  }

  private async closeRoom(ctx: Locked, reason: RoomClosedReason) {
    if (!ctx.match.roomId) return;
    await ctx.tx.room.updateMany({
      where: { id: ctx.match.roomId, status: { not: RoomStatus.CLOSED } },
      data: { status: RoomStatus.CLOSED, closedReason: reason, version: { increment: 1 } },
    });
    await ctx.tx.roomInvite.updateMany({
      where: { roomId: ctx.match.roomId, status: { in: [RoomInviteStatus.PENDING, RoomInviteStatus.AI_FILLED] } },
      data: { status: RoomInviteStatus.EXPIRED, respondedAt: new Date(ctx.now) },
    });
    const code = ctx.roomCode;
    if (code) ctx.effects.push(() => this.roomChanged?.(code));
  }

  /** Aviso para o módulo de salas republicar a sala (injetado para evitar ciclo). */
  roomChanged: ((code: string) => Promise<void> | void) | null = null;

  /**
   * Humano saindo no meio. Com outro humano na mesa, a vaga passa para a IA e só quem saiu leva
   * a derrota. Se era o último humano, a dupla dele entrega a partida.
   */
  async abandon(userId: string, matchId: string): Promise<{ ok: true }> {
    return this.withMatch(matchId, async (ctx) => {
      const mine = ctx.participants.find((x) => x.userId === userId && isHumanOwned(x));
      if (!mine) {
        if (ctx.participants.some((x) => x.replacedUserId === userId)) return { ok: true as const };
        throw new AppError('NOT_IN_MATCH', 'Você não está nessa partida.');
      }
      if (ctx.match.status !== MatchStatus.PLAYING) return { ok: true as const };
      const winner = (mine.seat % 2 === 0 ? 1 : 0) as 0 | 1;
      const forfeit: [number, number] = [ctx.state.scores[0], ctx.state.scores[1]];
      forfeit[winner] = ctx.state.config.targetScore;
      const others = ctx.participants.filter((p) => isHumanOwned(p) && p.userId !== userId);

      if (others.length > 0) {
        const nickname = `${mine.nickname.replace(/ \(IA\)$/, '').slice(0, 16)} (IA)`;
        await this.updateParticipant(ctx, mine.seat, {
          userId: null,
          botKey: `bot_left_${mine.seat}_${Math.random().toString(36).slice(2, 8)}`,
          nickname,
          controller: SeatController.AI_PERMANENT,
          controllerVersion: { increment: 1 },
          connected: true,
          disconnectedAt: null,
          reservedForUserId: null,
          pendingUserId: null,
          replacedUserId: userId,
        });
        const input: MatchOutcomeInput = {
          matchId,
          key: `${matchId}_left_${userId}`,
          mode: 'online',
          humans: [{ userId, seat: mine.seat, trucosCalled: mine.trucosCalled, trucosAccepted: mine.trucosAccepted }],
          scores: forfeit,
          winnerTeam: winner,
          handsPlayed: ctx.state.handsPlayed,
          forfeit: true,
        };
        const result = await this.progression.applyInTx(ctx.tx, input);
        if (ctx.match.roomId) {
          await ctx.tx.roomSeat.updateMany({
            where: { roomId: ctx.match.roomId, userId },
            data: { userId: null, isBot: true, botKey: `bot_left_${mine.seat}`, nickname, ready: true },
          });
          const code = ctx.roomCode;
          if (code) ctx.effects.push(() => this.roomChanged?.(code));
        }
        const seatRoom = wsRooms.matchSeat(matchId, mine.seat);
        ctx.effects.push(() => {
          this.realtime.leaveUser(userId, seatRoom);
          this.realtime.leaveUser(userId, wsRooms.match(matchId));
          this.realtime.toUser(userId, S2C.activeMatch, { matchId: null });
        });
        ctx.effects.push(() => this.progression.afterCommit(input, result));
        this.metrics.inc('ai_takeovers_total', { reason: 'left' });
        return { ok: true as const };
      }

      // Último humano: a dupla dele entrega a partida.
      ctx.state = { ...ctx.state, status: 'FINISHED', winner };
      ctx.dirty = true;
      ctx.recent = [];
      ctx.match = {
        ...ctx.match,
        status: MatchStatus.ABANDONED,
        winnerTeam: winner,
        abandonedByUserId: userId,
        finishedAt: new Date(ctx.now),
      };
      const input: MatchOutcomeInput = {
        matchId,
        key: matchId,
        mode: 'online',
        humans: this.humansForOutcome(ctx),
        scores: forfeit,
        winnerTeam: winner,
        handsPlayed: ctx.state.handsPlayed,
        forfeit: true,
      };
      const result = await this.progression.applyInTx(ctx.tx, input);
      await this.closeRoom(ctx, RoomClosedReason.ABANDONED);
      ctx.metaChanged = true;
      this.enqueueOutcomeEffects(ctx, input, result);
      this.metrics.inc('matches_abandoned_total');
      return { ok: true as const };
    });
  }

  // --- Convidado atrasado (troca IA → humano) -----------------------------------------------

  /** Marca a troca: só o dono da reserva, e nunca cria um segundo controlador. */
  async requestSeatReclaim(tx: Tx, matchId: string, seat: number, userId: string): Promise<boolean> {
    const p = await tx.matchParticipant.findUnique({ where: { matchId_seat: { matchId, seat } } });
    const match = await tx.match.findUnique({ where: { id: matchId }, select: { status: true } });
    if (!p || match?.status !== MatchStatus.PLAYING) return false;
    if (p.controller !== SeatController.AI_PERMANENT) return p.userId === userId;
    if (p.reservedForUserId !== userId) return false;
    if (p.pendingUserId !== userId) {
      await tx.matchParticipant.update({
        where: { matchId_seat: { matchId, seat } },
        data: { pendingUserId: userId },
      });
      await tx.match.update({ where: { id: matchId }, data: { nextTickAt: new Date(now()) } });
    }
    return true;
  }

  private async trySeatSwaps(ctx: Locked): Promise<boolean> {
    const pending = ctx.participants.filter((p) => p.controller === SeatController.AI_PERMANENT && p.pendingUserId);
    if (pending.length === 0 || !isSafeSwapPoint(ctx.state)) return false;
    for (const seatPlayer of pending) {
      const human = seatPlayer.pendingUserId!;
      const profile = await ctx.tx.userProfile.findUnique({ where: { userId: human } });
      await this.updateParticipant(ctx, seatPlayer.seat, {
        userId: human,
        botKey: null,
        nickname: profile?.nickname || seatPlayer.nickname,
        avatarId: profile?.avatarId ?? seatPlayer.avatarId,
        controller: SeatController.HUMAN,
        controllerVersion: { increment: 1 },
        connected: true,
        disconnectedAt: null,
        reservedForUserId: null,
        pendingUserId: null,
      });
      if (ctx.match.roomId) {
        await ctx.tx.roomSeat.update({
          where: { roomId_seat: { roomId: ctx.match.roomId, seat: seatPlayer.seat } },
          data: {
            userId: human,
            botKey: null,
            isBot: false,
            ready: true,
            connected: true,
            nickname: profile?.nickname || seatPlayer.nickname,
            avatarId: profile?.avatarId ?? seatPlayer.avatarId,
            reservedForUserId: null,
            joinedAt: new Date(ctx.now),
          },
        });
        await ctx.tx.roomInvite.updateMany({
          where: { roomId: ctx.match.roomId, inviteeUserId: human },
          data: { status: RoomInviteStatus.ACCEPTED, respondedAt: new Date(ctx.now), dismissedAt: new Date(ctx.now) },
        });
        const code = ctx.roomCode;
        if (code) ctx.effects.push(() => this.roomChanged?.(code));
      }
      const matchId = ctx.match.id;
      const seatRoom = wsRooms.matchSeat(matchId, seatPlayer.seat);
      ctx.effects.push(() => {
        this.realtime.clearRoom(seatRoom);
        this.realtime.joinUser(human, seatRoom);
        this.realtime.joinUser(human, wsRooms.match(matchId));
        this.realtime.toUser(human, S2C.activeMatch, { matchId });
      });
      log.info('late_human_reclaimed_seat', { matchId, seat: seatPlayer.seat });
    }
    return true;
  }

  /** Convidado atrasado perguntando pela vaga: `seated`, `pending` ou `unavailable`. */
  async claimSeat(userId: string, matchId: string): Promise<{ status: 'seated' | 'pending' | 'unavailable' }> {
    return this.withMatch(matchId, async (ctx) => {
      if (ctx.participants.some((p) => p.userId === userId && isHumanOwned(p))) return { status: 'seated' as const };
      if (ctx.match.status !== MatchStatus.PLAYING || !ctx.participants.some((p) => p.pendingUserId === userId))
        return { status: 'unavailable' as const };
      await this.trySeatSwaps(ctx);
      return {
        status: ctx.participants.some((p) => p.userId === userId && isHumanOwned(p))
          ? ('seated' as const)
          : ('pending' as const),
      };
    });
  }

  // --- Consultas ----------------------------------------------------------------------------

  /** Partida online em andamento do usuário (restauração depois de reiniciar o app). */
  async activeMatchOf(userId: string): Promise<{ matchId: string; roomCode: string | null } | null> {
    const p = await this.prisma.matchParticipant.findFirst({
      where: {
        userId,
        controller: { not: SeatController.AI_PERMANENT },
        match: { status: MatchStatus.PLAYING, mode: MatchMode.ONLINE },
      },
      orderBy: { match: { createdAt: 'desc' } },
      select: { matchId: true, match: { select: { room: { select: { code: true } } } } },
    });
    return p ? { matchId: p.matchId, roomCode: p.match.room?.code ?? null } : null;
  }

  /** Em outra partida online (fora da sala `roomCode`)? */
  async busyElsewhere(userId: string, roomCode: string | null, db: Tx | PrismaService = this.prisma): Promise<boolean> {
    const p = await db.matchParticipant.findFirst({
      where: {
        userId,
        controller: { not: SeatController.AI_PERMANENT },
        match: { status: MatchStatus.PLAYING, mode: MatchMode.ONLINE },
      },
      select: { match: { select: { room: { select: { code: true } } } } },
    });
    if (!p) return false;
    return (p.match.room?.code ?? null) !== roomCode;
  }

  async history(
    userId: string,
    limit = 30,
    cursor?: string,
  ): Promise<{ items: MatchHistoryEntry[]; nextCursor: string | null }> {
    const take = Math.min(Math.max(limit, 1), 50);
    const rows = await this.prisma.matchResult.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        match: {
          select: {
            id: true,
            mode: true,
            difficulty: true,
            handsPlayed: true,
            participants: {
              orderBy: { seat: 'asc' },
              select: {
                seat: true,
                nickname: true,
                avatarId: true,
                controller: true,
                botKey: true,
                userId: true,
                replacedUserId: true,
                user: { select: { firebaseUid: true } },
              },
            },
          },
        },
        user: { select: { firebaseUid: true } },
      },
    });
    const items: MatchHistoryEntry[] = rows.slice(0, take).map((r) => {
      const players = r.match.participants.map((p) => {
        const mineReplaced = p.replacedUserId === userId && p.seat === r.seat;
        if (mineReplaced)
          return {
            uid: r.user.firebaseUid,
            seat: p.seat,
            nickname: p.nickname.replace(/ \(IA\)$/, ''),
            avatarId: p.avatarId as AvatarId,
            bot: false,
          };
        const bot = p.controller === SeatController.AI_PERMANENT || !p.user;
        return {
          uid: bot ? (p.botKey ?? `bot${p.seat}`) : p.user!.firebaseUid,
          seat: p.seat,
          nickname: p.nickname,
          avatarId: p.avatarId as AvatarId,
          bot,
        };
      });
      return {
        id: r.id,
        mode: r.match.mode === MatchMode.AI ? 'ai' : 'online',
        ...(r.match.difficulty ? { difficulty: r.match.difficulty.toLowerCase() as 'easy' | 'normal' | 'hard' } : {}),
        playerIds: players.filter((p) => !p.bot).map((p) => p.uid),
        players,
        scores: [r.scoreTeam0, r.scoreTeam1],
        winnerTeam: r.winnerTeam as 0 | 1,
        handsPlayed: r.match.handsPlayed,
        finishedAt: r.createdAt.getTime(),
      };
    });
    return { items, nextCursor: rows.length > take ? items[items.length - 1]!.id : null };
  }

  // --- Partida contra a IA (local, validada por replay) --------------------------------------

  async finalizeAiMatch(
    user: { id: string; uid: string },
    req: { matchId: string; seed: number; aiSeed: number; difficulty: AIDifficulty; actions: GameAction[] },
  ): Promise<{ alreadyProcessed: boolean; winnerTeam: 0 | 1; progression: ProgressionResult | null }> {
    if (req.actions.length > MAX_AI_ACTIONS) throw new AppError('MATCH_TOO_LONG', 'Partida grande demais.');
    const externalKey = `${user.uid}_${req.matchId}`.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 160);
    const existing = await this.previousAiResult(externalKey, user.id);
    if (existing) return existing;

    const state = replayAiMatch(req);
    const winnerTeam = state.winner as 0 | 1;
    const profile = await this.prisma.userProfile.findUnique({ where: { userId: user.id } });
    const trucos = req.actions.reduce(
      (acc, a) => {
        if (a.seat !== 0) return acc;
        if (a.type === 'REQUEST_TRUCO' || a.type === 'RAISE') acc.called++;
        if (a.type === 'ACCEPT_TRUCO') acc.accepted++;
        return acc;
      },
      { called: 0, accepted: 0 },
    );
    let outcome: { input: MatchOutcomeInput; result: OutcomeResult };
    try {
      outcome = await this.prisma.tx(
        async (tx) => {
          const match = await tx.match.create({
            data: {
              mode: MatchMode.AI,
              status: MatchStatus.FINISHED,
              difficulty: DIFFICULTY[req.difficulty],
              externalKey,
              seed: BigInt(Math.trunc(req.seed)),
              aiSeed: BigInt(Math.trunc(req.aiSeed)),
              stateVersion: state.version,
              scoreTeam0: state.scores[0],
              scoreTeam1: state.scores[1],
              winnerTeam,
              handsPlayed: state.handsPlayed,
              finishedAt: new Date(now()),
            },
          });
          await tx.matchParticipant.createMany({
            data: [
              {
                matchId: match.id,
                seat: 0,
                team: 0,
                userId: user.id,
                nickname: profile?.nickname || 'Você',
                avatarId: profile?.avatarId ?? 'joao',
                controller: SeatController.HUMAN,
                trucosCalled: trucos.called,
                trucosAccepted: trucos.accepted,
              },
              ...([
                [1, 'seu_ze'],
                [2, 'maria'],
                [3, 'tiao'],
              ] as const).map(([seat, avatarId]) => ({
                matchId: match.id,
                seat,
                team: seat % 2,
                botKey: `bot${seat}`,
                nickname: 'IA',
                avatarId,
                controller: SeatController.AI_PERMANENT,
              })),
            ],
          });
          await tx.gameAction.createMany({
            data: req.actions.map((a, i) => ({
              matchId: match.id,
              sequence: i + 1,
              clientActionId: `replay_${i + 1}`,
              seat: a.seat,
              actor: a.seat === 0 ? ActorKind.HUMAN : ActorKind.AI,
              userId: a.seat === 0 ? user.id : null,
              type: a.type,
              payload:
                a.type === 'PLAY_CARD' || a.type === 'PLAY_CARD_COVERED'
                  ? { cardId: a.cardId }
                  : a.type === 'CUT' && a.depth
                    ? { depth: a.depth }
                    : undefined,
              stateVersion: i + 1,
            })),
          });
          const input: MatchOutcomeInput = {
            matchId: match.id,
            key: externalKey,
            mode: 'ai',
            difficulty: req.difficulty,
            humans: [{ userId: user.id, seat: 0, trucosCalled: trucos.called, trucosAccepted: trucos.accepted }],
            scores: state.scores,
            winnerTeam,
            handsPlayed: state.handsPlayed,
          };
          const result = await this.progression.applyInTx(tx, input);
          return { input, result };
        },
        { timeoutMs: 30_000 },
      );
    } catch (e) {
      // Duas finalizações simultâneas da mesma partida: a segunda devolve o resultado da primeira.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const again = await this.previousAiResult(externalKey, user.id);
        if (again) return again;
      }
      throw e;
    }
    await this.progression.afterCommit(outcome.input, outcome.result);
    this.metrics.inc('matches_finished_total', { mode: 'ai' });
    return {
      alreadyProcessed: outcome.result.alreadyProcessed,
      winnerTeam,
      progression: outcome.result.byUserId[user.id] ?? null,
    };
  }

  private async previousAiResult(key: string, userId: string) {
    const r = await this.prisma.matchResult.findUnique({ where: { key_userId: { key, userId } } });
    if (!r) return null;
    return {
      alreadyProcessed: true,
      winnerTeam: r.winnerTeam as 0 | 1,
      progression: {
        xpGained: r.xpGained,
        leaguePointsDelta: r.leaguePointsDelta,
        leveledUp: r.leveledUp,
        newLevel: r.newLevel,
        newLeagueId: r.newLeagueId as ProgressionResult['newLeagueId'],
      },
    };
  }

  /** Metadados para o gateway (sem trava). */
  async metaFor(matchId: string): Promise<MatchMeta | null> {
    if (!UUID_RE.test(matchId)) return null;
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      include: { participants: { orderBy: { seat: 'asc' } }, room: { select: { code: true } } },
    });
    if (!match) return null;
    const uidOf = await this.uidResolver(match.participants, this.prisma, [match.abandonedByUserId]);
    return buildMeta(match, match.room?.code ?? null, match.participants, uidOf, now());
  }

  /** Mensagem padrão para ocupado em outra partida (salas e matchmaking). */
  static readonly BUSY = MESSAGES.busy;
}
