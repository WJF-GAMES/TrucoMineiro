import {
  Card,
  HandState,
  MatchState,
  PlayedCard,
  RoundResult,
  Seat,
  Team,
  TieBreakState,
} from '../domain/game';

/** Match state as persisted under `gameSessions/{id}/state`. */
export interface StoredState extends MatchState {
  /** Client action ids already applied (idempotency). */
  appliedActionIds: Record<string, number>;
  aiRngState: number;
  trucos: Record<string, { called: number; accepted: number }>;
}

function normalizeTieBreak(raw: unknown): TieBreakState | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as Partial<TieBreakState>;
  if (typeof t.causedBySeat !== 'number' || typeof t.round !== 'number') return null;
  return { causedBySeat: t.causedBySeat as Seat, round: t.round };
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
  // A carta real está sempre no estado; `covered` só existe (como `true`) na jogada virada.
  const plays = (list: unknown): PlayedCard[] =>
    Array.isArray(list)
      ? list
          .filter((p): p is PlayedCard => Boolean(p && (p as PlayedCard).card))
          .map((p) =>
            p.covered
              ? { seat: p.seat, card: p.card, covered: true }
              : { seat: p.seat, card: p.card },
          )
      : [];

  const hand: HandState = {
    number: rawHand.number ?? 1,
    dealerSeat: (rawHand.dealerSeat ?? 3) as Seat,
    value: rawHand.value ?? 1,
    lastRaiserTeam: (rawHand.lastRaiserTeam ?? null) as Team | null,
    phase: (rawHand.phase ?? 'PLAY') as HandState['phase'],
    // Cerimônia: o baralho vive no estado até a distribuição (nunca sai para as views).
    deck: cards(rawHand.deck),
    deckVersion: rawHand.deckVersion ?? 0,
    shuffleCount: rawHand.shuffleCount ?? 0,
    // O RTDB apaga o zero? Não — apaga null/vazio; mas uma sessão gravada antes de o corte virar
    // repetível simplesmente não tem a chave, e ela precisa voltar como 0.
    cutCount: rawHand.cutCount ?? 0,
    hands: [0, 1, 2, 3].map((i) => cards((rawHand.hands as unknown[] | undefined)?.[i])),
    currentRound: plays(rawHand.currentRound),
    roundLeader: (rawHand.roundLeader ?? 0) as Seat,
    rounds: Array.isArray(rawHand.rounds)
      ? rawHand.rounds.filter(Boolean).map((r): RoundResult => ({
          winner: (r?.winner ?? null) as Team | null,
          winnerSeat: (r?.winnerSeat ?? 0) as Seat,
          plays: plays(r?.plays),
        }))
      : [],
    turnSeat: (rawHand.turnSeat ?? 0) as Seat,
    truco: rawHand.truco ?? null,
    // Desempate por cango: `null` some no RTDB (e sessões antigas nem têm a chave).
    tieBreak: normalizeTieBreak(rawHand.tieBreak),
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
