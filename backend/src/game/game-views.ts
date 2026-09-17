import type { Match, MatchParticipant } from '@prisma/client';
import { SeatController } from '@prisma/client';
import {
  GameEvent,
  Seat,
  SeatView,
  TURN_TIMING,
  eventsForSeat,
  viewForSeat,
} from '../domain/game';
import type { AvatarId, SessionMeta, SessionPlayer } from '../domain/model/types';
import type { StoredState } from './stored-state';

/** O que cada assento recebe: a projeção do motor + os eventos da última ação + o relógio. */
export interface SeatViewPayload extends SeatView {
  matchId: string;
  recentEvents: GameEvent[];
  turnStartedAt: number | null;
  turnDeadlineAt: number | null;
  serverTime: number;
}

export interface MetaPlayer extends SessionPlayer {
  controller: 'HUMAN' | 'AI_TEMPORARY' | 'AI_PERMANENT';
  controllerVersion: number;
}

export interface MatchMeta extends Omit<SessionMeta, 'players'> {
  players: Record<string, MetaPlayer>;
  turnStartedAt: number | null;
  turnDeadlineAt: number | null;
  serverTime: number;
}

export function buildView(
  matchId: string,
  state: StoredState,
  seat: Seat,
  recent: GameEvent[],
  timer: { startedAt: Date | null; deadlineAt: Date | null },
  now: number,
): SeatViewPayload {
  return {
    ...viewForSeat(state, seat),
    matchId,
    // Cada assento recebe o próprio lote: carta virada dos outros sai sem identidade.
    recentEvents: eventsForSeat(recent, seat),
    turnStartedAt: timer.startedAt?.getTime() ?? null,
    turnDeadlineAt: timer.deadlineAt?.getTime() ?? null,
    serverTime: now,
  };
}

const STATUS: Record<Match['status'], SessionMeta['status']> = {
  PREPARING: 'preparing',
  PLAYING: 'playing',
  FINISHED: 'finished',
  ABANDONED: 'abandoned',
};

/**
 * Metadados públicos da partida. Humanos aparecem pelo uid público (Firebase UID); IA pelo
 * `botKey`. `uidOf` traduz ids internos.
 */
export function buildMeta(
  match: Pick<Match, 'id' | 'status' | 'winnerTeam' | 'createdAt' | 'updatedAt' | 'abandonedByUserId' | 'turnStartedAt' | 'turnDeadlineAt'>,
  roomCode: string | null,
  participants: MatchParticipant[],
  uidOf: (id: string | null | undefined) => string | null,
  now: number,
): MatchMeta {
  const players: Record<string, MetaPlayer> = {};
  for (const p of participants) {
    const bot = p.controller === SeatController.AI_PERMANENT;
    players[String(p.seat)] = {
      uid: bot ? (p.botKey ?? `bot_${p.seat}`) : (uidOf(p.userId) ?? `unknown_${p.seat}`),
      seat: p.seat,
      nickname: p.nickname,
      avatarId: p.avatarId as AvatarId,
      bot,
      connected: bot ? true : p.connected,
      disconnectedAt: p.disconnectedAt?.getTime() ?? null,
      reservedFor: uidOf(p.reservedForUserId),
      pendingUid: uidOf(p.pendingUserId),
      replacedUid: uidOf(p.replacedUserId),
      controller: p.controller,
      controllerVersion: p.controllerVersion,
    };
  }
  return {
    id: match.id,
    roomCode,
    mode: 'online',
    status: STATUS[match.status],
    players,
    createdAt: match.createdAt.getTime(),
    updatedAt: match.updatedAt.getTime(),
    winnerTeam: (match.winnerTeam as 0 | 1 | null) ?? null,
    abandonedBy: uidOf(match.abandonedByUserId),
    turnStartedAt: match.turnStartedAt?.getTime() ?? null,
    turnDeadlineAt: match.turnDeadlineAt?.getTime() ?? null,
    serverTime: now,
  };
}

export const SERVER_TIMEOUT_GRACE_MS = TURN_TIMING.serverGraceMs;
