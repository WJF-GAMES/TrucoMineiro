import type { GameEvent, PlayedCard, SeatView, Team } from '@/domain/game';
import type { SessionMeta, SessionPlayer } from '@/domain/model/types';

export interface RemoteSeatView extends SeatView {
  recentEvents: GameEvent[];
}

/**
 * Realtime Database drops empty arrays and null values, so a seat view written as
 * `{ currentRound: [], rounds: [], myCards: [] }` comes back with those keys missing — and the
 * table would crash reading them. Everything the UI iterates over is restored here.
 */
export function normalizeSeatView(raw: unknown): RemoteSeatView | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as Partial<RemoteSeatView> & Record<string, unknown>;
  if (typeof v.seat !== 'number' || typeof v.phase !== 'string') return null;

  const plays = (list: unknown): PlayedCard[] =>
    Array.isArray(list) ? list.filter((p): p is PlayedCard => Boolean(p && (p as PlayedCard).card)) : [];

  return {
    seat: v.seat,
    team: (v.team ?? ((v.seat % 2) as Team)) as Team,
    scores: Array.isArray(v.scores) ? [v.scores[0] ?? 0, v.scores[1] ?? 0] : [0, 0],
    status: v.status ?? 'PLAYING',
    winner: v.winner ?? null,
    handNumber: v.handNumber ?? 1,
    // Servidores antigos não enviavam `dealerSeat`. No início da mão — o único momento em que a
    // cerimônia usa isso — o líder da rodada é o assento seguinte ao de quem dá as cartas.
    dealerSeat: (v.dealerSeat ?? (((v.roundLeader ?? 0) + 3) % 4)) as SeatView['dealerSeat'],
    handValue: v.handValue ?? 1,
    proposedValue: v.proposedValue ?? null,
    phase: v.phase as SeatView['phase'],
    turnSeat: v.turnSeat ?? 0,
    roundLeader: v.roundLeader ?? 0,
    myCards: Array.isArray(v.myCards) ? v.myCards.filter(Boolean) : [],
    cardCounts: Array.isArray(v.cardCounts)
      ? [0, 1, 2, 3].map((i) => v.cardCounts?.[i] ?? 0)
      : [0, 0, 0, 0],
    currentRound: plays(v.currentRound),
    rounds: Array.isArray(v.rounds)
      ? v.rounds.filter(Boolean).map((r) => ({
          winner: r?.winner ?? null,
          winnerSeat: r?.winnerSeat ?? 0,
          plays: plays(r?.plays),
        }))
      : [],
    availableActions: Array.isArray(v.availableActions) ? v.availableActions.filter(Boolean) : [],
    maoDeOnzeTeam: v.maoDeOnzeTeam ?? null,
    trucoRequesterTeam: v.trucoRequesterTeam ?? null,
    lastRaiserTeam: v.lastRaiserTeam ?? null,
    lastResult: v.lastResult ?? null,
    version: v.version ?? 0,
    recentEvents: Array.isArray(v.recentEvents) ? v.recentEvents.filter(Boolean) : [],
  };
}

/** Same treatment for the session metadata: `players` is a map and may arrive sparse. */
export function normalizeSessionMeta(raw: unknown): SessionMeta | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Partial<SessionMeta> & Record<string, unknown>;
  if (typeof m.status !== 'string') return null;
  const players: Record<string, SessionPlayer> = {};
  const source = (m.players ?? {}) as Record<string, Partial<SessionPlayer> | undefined>;
  for (const [key, p] of Object.entries(source)) {
    if (!p || typeof p.uid !== 'string') continue;
    players[key] = {
      uid: p.uid,
      seat: p.seat ?? Number(key) ?? 0,
      nickname: p.nickname ?? 'Jogador',
      avatarId: p.avatarId ?? 'joao',
      bot: Boolean(p.bot),
      connected: p.connected !== false,
    };
  }
  return {
    id: m.id ?? '',
    roomCode: m.roomCode ?? null,
    mode: 'online',
    status: m.status as SessionMeta['status'],
    players,
    createdAt: m.createdAt ?? 0,
    updatedAt: m.updatedAt ?? 0,
    winnerTeam: m.winnerTeam ?? null,
    abandonedBy: m.abandonedBy ?? null,
  };
}
