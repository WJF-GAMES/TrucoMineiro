import { Card, HandState, MatchState, PlayedCard, RoundResult, Seat, Team } from '../domain/game';

/** Match state as persisted under `gameSessions/{id}/state`. */
export interface StoredState extends MatchState {
  /** Client action ids already applied (idempotency). */
  appliedActionIds: Record<string, number>;
  aiRngState: number;
  trucos: Record<string, { called: number; accepted: number }>;
}

/**
 * Realtime Database does not store empty arrays, empty objects or nulls — it removes the key.
 * A state written as `{ currentRound: [], rounds: [], truco: null, appliedActionIds: {} }` therefore
 * reads back without them, and the engine would crash on `[...undefined]` inside the transaction.
 * Every container the engine touches is restored here before the state is used.
 */
export function normalizeStoredState(raw: unknown): StoredState | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Partial<StoredState> & Record<string, unknown>;
  const rawHand = (s.hand ?? {}) as Partial<HandState> & Record<string, unknown>;

  const cards = (list: unknown): Card[] =>
    Array.isArray(list) ? list.filter((c): c is Card => Boolean(c && (c as Card).rank)) : [];
  const plays = (list: unknown): PlayedCard[] =>
    Array.isArray(list)
      ? list.filter((p): p is PlayedCard => Boolean(p && (p as PlayedCard).card))
      : [];

  const hand: HandState = {
    number: rawHand.number ?? 1,
    dealerSeat: (rawHand.dealerSeat ?? 3) as Seat,
    value: rawHand.value ?? 1,
    lastRaiserTeam: (rawHand.lastRaiserTeam ?? null) as Team | null,
    phase: (rawHand.phase ?? 'PLAY') as HandState['phase'],
    hands: [0, 1, 2, 3].map((i) => cards((rawHand.hands as unknown[] | undefined)?.[i])),
    currentRound: plays(rawHand.currentRound),
    roundLeader: (rawHand.roundLeader ?? 0) as Seat,
    rounds: Array.isArray(rawHand.rounds)
      ? rawHand.rounds.filter(Boolean).map(
          (r): RoundResult => ({
            winner: (r?.winner ?? null) as Team | null,
            winnerSeat: (r?.winnerSeat ?? 0) as Seat,
            plays: plays(r?.plays),
          }),
        )
      : [],
    turnSeat: (rawHand.turnSeat ?? 0) as Seat,
    truco: rawHand.truco ?? null,
    maoDeOnzeTeam: (rawHand.maoDeOnzeTeam ?? null) as Team | null,
    result: rawHand.result ?? null,
  };

  return {
    config: {
      targetScore: s.config?.targetScore ?? 12,
      seed: s.config?.seed ?? 0,
    },
    status: s.status ?? 'PLAYING',
    scores: Array.isArray(s.scores) ? [s.scores[0] ?? 0, s.scores[1] ?? 0] : [0, 0],
    hand,
    handsPlayed: s.handsPlayed ?? 0,
    rngState: s.rngState ?? 0,
    winner: (s.winner ?? null) as Team | null,
    version: s.version ?? 0,
    events: Array.isArray(s.events) ? s.events.filter(Boolean) : [],
    appliedActionIds: (s.appliedActionIds as Record<string, number>) ?? {},
    aiRngState: s.aiRngState ?? 0,
    trucos: (s.trucos as StoredState['trucos']) ?? {},
  };
}
