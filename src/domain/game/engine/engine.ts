import { Card, cardId, parseCardId, sameCard } from '../cards/card';
import { createDeck, deal, shuffle } from '../cards/deck';
import { compareCards } from '../rules/strength';
import { MAO_DE_ONZE_SCORE, STAKE_LADDER, TARGET_SCORE, nextStake } from '../rules/stakes';
import {
  ActionType,
  GameAction,
  GameEvent,
  HandResult,
  HandState,
  MatchState,
  PlayedCard,
  Seat,
  Team,
  nextSeat,
  otherTeam,
  teamOf,
} from '../state/types';
import { createRng } from './rng';

export class InvalidActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidActionError';
  }
}

const CARDS_PER_PLAYER = 3;
const PLAYERS = 4;

// ---------------------------------------------------------------------------
// Match creation & dealing
// ---------------------------------------------------------------------------

export function createMatch(seed: number, targetScore = TARGET_SCORE): MatchState {
  const base: MatchState = {
    config: { targetScore, seed },
    status: 'PLAYING',
    scores: [0, 0],
    hand: null as unknown as HandState,
    handsPlayed: 0,
    rngState: seed >>> 0,
    winner: null,
    version: 0,
    events: [],
  };
  // First dealer is seat 3 so seat 0 (the local player) leads hand 1.
  return startHand(base, 3);
}

function startHand(state: MatchState, dealerSeat: Seat): MatchState {
  const rng = createRng(state.rngState);
  const deck = shuffle(createDeck(), rng);
  const hands = deal(deck, PLAYERS, CARDS_PER_PLAYER);
  const firstSeat = nextSeat(dealerSeat);
  const number = state.handsPlayed + 1;

  const bothAtEleven = state.scores[0] >= MAO_DE_ONZE_SCORE && state.scores[1] >= MAO_DE_ONZE_SCORE;
  // "Mão de ferro": both at 11 is played normally with no truco allowed.
  const teamAtEleven: Team | null = bothAtEleven
    ? null
    : state.scores[0] >= MAO_DE_ONZE_SCORE
      ? 0
      : state.scores[1] >= MAO_DE_ONZE_SCORE
        ? 1
        : null;

  const hand: HandState = {
    number,
    dealerSeat,
    value: STAKE_LADDER[0]!,
    lastRaiserTeam: null,
    phase: teamAtEleven === null ? 'PLAY' : 'MAO_DE_ONZE',
    hands,
    currentRound: [],
    roundLeader: firstSeat,
    rounds: [],
    turnSeat: firstSeat,
    truco: null,
    maoDeOnzeTeam: teamAtEleven,
    result: null,
  };

  return {
    ...state,
    hand,
    rngState: rng.state(),
    events: [...state.events, { type: 'HAND_STARTED', number, dealerSeat, firstSeat }],
  };
}

// ---------------------------------------------------------------------------
// Available actions (the UI never decides validity itself)
// ---------------------------------------------------------------------------

export function getAvailableActions(state: MatchState, seat: Seat): ActionType[] {
  if (state.status !== 'PLAYING') return [];
  const hand = state.hand;
  const team = teamOf(seat);
  const bothAtEleven = state.scores[0] >= MAO_DE_ONZE_SCORE && state.scores[1] >= MAO_DE_ONZE_SCORE;

  switch (hand.phase) {
    case 'MAO_DE_ONZE':
      return hand.maoDeOnzeTeam === team ? ['ACCEPT_MAO_DE_ONZE', 'DECLINE_MAO_DE_ONZE'] : [];
    case 'PLAY': {
      if (hand.turnSeat !== seat) return [];
      const actions: ActionType[] = ['PLAY_CARD'];
      const canRaise =
        !bothAtEleven &&
        hand.maoDeOnzeTeam === null &&
        hand.lastRaiserTeam !== team &&
        nextStake(hand.value) !== null;
      if (canRaise) actions.push('REQUEST_TRUCO');
      return actions;
    }
    case 'TRUCO_RESPONSE': {
      const truco = hand.truco!;
      if (truco.requesterTeam === team) return [];
      const actions: ActionType[] = ['ACCEPT_TRUCO', 'RUN'];
      if (nextStake(truco.proposedValue) !== null) actions.push('RAISE');
      return actions;
    }
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export function applyAction(state: MatchState, action: GameAction): MatchState {
  const allowed = getAvailableActions(state, action.seat);
  if (!allowed.includes(action.type)) {
    throw new InvalidActionError(
      `Action ${action.type} not allowed for seat ${action.seat} (phase ${state.hand.phase}, turn ${state.hand.turnSeat})`,
    );
  }

  let next: MatchState;
  switch (action.type) {
    case 'PLAY_CARD':
      next = playCard(state, action.seat, parseCardId(action.cardId));
      break;
    case 'REQUEST_TRUCO':
      next = requestTruco(state, action.seat);
      break;
    case 'ACCEPT_TRUCO':
      next = acceptTruco(state, action.seat);
      break;
    case 'RAISE':
      next = raise(state, action.seat);
      break;
    case 'RUN':
      next = run(state, action.seat);
      break;
    case 'ACCEPT_MAO_DE_ONZE':
      next = acceptMaoDeOnze(state);
      break;
    case 'DECLINE_MAO_DE_ONZE':
      next = declineMaoDeOnze(state);
      break;
  }
  return { ...next, version: state.version + 1 };
}

function emit(state: MatchState, event: GameEvent): MatchState {
  return { ...state, events: [...state.events, event] };
}

function withHand(state: MatchState, hand: Partial<HandState>): MatchState {
  return { ...state, hand: { ...state.hand, ...hand } };
}

// --- Playing cards ---------------------------------------------------------

function playCard(state: MatchState, seat: Seat, card: Card): MatchState {
  const hand = state.hand;
  const owned = hand.hands[seat]!;
  if (!owned.some((c) => sameCard(c, card))) {
    throw new InvalidActionError(`Seat ${seat} does not hold ${cardId(card)}`);
  }
  const hands = hand.hands.map((h, i) => (i === seat ? h.filter((c) => !sameCard(c, card)) : h));
  const currentRound: PlayedCard[] = [...hand.currentRound, { seat, card }];

  const next = emit(withHand(state, { hands, currentRound }), { type: 'CARD_PLAYED', seat, card });

  if (currentRound.length < PLAYERS) {
    return withHand(next, { turnSeat: nextSeat(seat) });
  }
  return resolveRound(next);
}

function resolveRound(state: MatchState): MatchState {
  const hand = state.hand;
  const plays = hand.currentRound;

  // Highest card wins; if the two highest belong to different teams and tie, the round ties.
  let best: PlayedCard = plays[0]!;
  let tied = false;
  for (const p of plays.slice(1)) {
    const cmp = compareCards(p.card, best.card);
    if (cmp > 0) {
      best = p;
      tied = false;
    } else if (cmp === 0 && teamOf(p.seat) !== teamOf(best.seat)) {
      tied = true;
    }
  }
  const winner: Team | null = tied ? null : teamOf(best.seat);
  const winnerSeat: Seat = tied ? hand.roundLeader : best.seat;
  const roundIndex = hand.rounds.length;
  const rounds = [...hand.rounds, { winner, winnerSeat, plays }];

  const next = emit(withHand(state, { rounds, currentRound: [] }), {
    type: 'ROUND_ENDED',
    round: roundIndex,
    winner,
    winnerSeat,
  });

  const outcome = decideHand(rounds.map((r) => r.winner));
  if (outcome !== undefined) {
    if (outcome === null) return finishHand(next, { winner: null, points: 0, reason: 'ALL_TIED' });
    return finishHand(next, { winner: outcome, points: next.hand.value, reason: 'ROUNDS' });
  }

  // Next round: the winner leads (on a tie, the previous leader leads again).
  return withHand(next, { roundLeader: winnerSeat, turnSeat: winnerSeat });
}

/**
 * Best-of-three with Truco tie rules.
 * Returns the winning team, null when the hand is void (all tied), or undefined if it continues.
 */
export function decideHand(results: readonly (Team | null)[]): Team | null | undefined {
  const [r1, r2, r3] = results;
  if (results.length < 2) return undefined;
  if (results.length === 2) {
    if (r1 !== null && r2 === null) return r1; // won first, tied second
    if (r1 === null && r2 !== null) return r2; // tied first, won second
    if (r1 !== null && r1 === r2) return r1; // won both
    return undefined; // 1-1 or both tied: third round decides
  }
  if (r3 !== null && r3 !== undefined) return r3;
  if (r1 !== null && r1 !== undefined) return r1; // third tied: first round winner
  return null; // everything tied: no points
}

// --- Truco -----------------------------------------------------------------

function requestTruco(state: MatchState, seat: Seat): MatchState {
  const value = nextStake(state.hand.value)!;
  const next = withHand(state, {
    phase: 'TRUCO_RESPONSE',
    truco: { requesterTeam: teamOf(seat), proposedValue: value, resumeSeat: seat },
  });
  return emit(next, { type: 'TRUCO_REQUESTED', seat, value });
}

function acceptTruco(state: MatchState, seat: Seat): MatchState {
  const truco = state.hand.truco!;
  const next = withHand(state, {
    phase: 'PLAY',
    value: truco.proposedValue,
    lastRaiserTeam: truco.requesterTeam,
    truco: null,
    turnSeat: truco.resumeSeat,
  });
  return emit(next, { type: 'TRUCO_ACCEPTED', seat, value: truco.proposedValue });
}

function raise(state: MatchState, seat: Seat): MatchState {
  const truco = state.hand.truco!;
  const value = nextStake(truco.proposedValue)!;
  // The previous proposal is implicitly accepted; the ball goes back to the other team.
  const next = withHand(state, {
    value: truco.proposedValue,
    lastRaiserTeam: truco.requesterTeam,
    truco: { requesterTeam: teamOf(seat), proposedValue: value, resumeSeat: truco.resumeSeat },
  });
  return emit(next, { type: 'TRUCO_RAISED', seat, value });
}

function run(state: MatchState, seat: Seat): MatchState {
  const truco = state.hand.truco!;
  const winner = truco.requesterTeam;
  const points = state.hand.value; // running concedes the current (pre-raise) value
  const next = emit(state, { type: 'RAN', seat, points, winner });
  return finishHand(next, { winner, points, reason: 'RUN' });
}

// --- Mão de onze -----------------------------------------------------------

function acceptMaoDeOnze(state: MatchState): MatchState {
  const team = state.hand.maoDeOnzeTeam!;
  const next = withHand(state, {
    phase: 'PLAY',
    value: STAKE_LADDER[1]!, // playing the mão de onze is worth a Truco (3)
    lastRaiserTeam: team,
  });
  return emit(next, { type: 'MAO_DE_ONZE_ACCEPTED', team });
}

function declineMaoDeOnze(state: MatchState): MatchState {
  const team = state.hand.maoDeOnzeTeam!;
  const winner = otherTeam(team);
  const next = emit(state, { type: 'MAO_DE_ONZE_DECLINED', team, winner });
  return finishHand(next, { winner, points: 1, reason: 'MAO_DE_ONZE_DECLINED' });
}

// --- Hand / match end ------------------------------------------------------

function finishHand(state: MatchState, result: HandResult): MatchState {
  const scores: [number, number] = [state.scores[0], state.scores[1]];
  if (result.winner !== null) {
    scores[result.winner] = Math.min(
      state.config.targetScore,
      scores[result.winner] + result.points,
    );
  }
  let next: MatchState = {
    ...withHand(state, { phase: 'FINISHED', result, truco: null }),
    scores,
    handsPlayed: state.handsPlayed + 1,
  };
  next = emit(next, { type: 'HAND_ENDED', result, scores });

  const winnerTeam: Team | null =
    scores[0] >= state.config.targetScore ? 0 : scores[1] >= state.config.targetScore ? 1 : null;
  if (winnerTeam !== null) {
    next = { ...next, status: 'FINISHED', winner: winnerTeam };
    return emit(next, { type: 'MATCH_ENDED', winner: winnerTeam, scores });
  }
  return startHand(next, nextSeat(state.hand.dealerSeat));
}

// ---------------------------------------------------------------------------
// Views (what a given seat is allowed to know)
// ---------------------------------------------------------------------------

export interface SeatView {
  seat: Seat;
  team: Team;
  scores: [number, number];
  status: MatchState['status'];
  winner: Team | null;
  handNumber: number;
  handValue: number;
  proposedValue: number | null;
  phase: HandState['phase'];
  turnSeat: Seat;
  roundLeader: Seat;
  myCards: Card[];
  /** Number of cards still held by each seat (never the cards themselves). */
  cardCounts: number[];
  currentRound: PlayedCard[];
  rounds: { winner: Team | null; winnerSeat: Seat; plays: PlayedCard[] }[];
  availableActions: ActionType[];
  maoDeOnzeTeam: Team | null;
  trucoRequesterTeam: Team | null;
  lastRaiserTeam: Team | null;
  lastResult: HandResult | null;
  version: number;
}

/** Projection of the state that hides every other player's hand. */
export function viewForSeat(state: MatchState, seat: Seat): SeatView {
  const h = state.hand;
  return {
    seat,
    team: teamOf(seat),
    scores: state.scores,
    status: state.status,
    winner: state.winner,
    handNumber: h.number,
    handValue: h.value,
    proposedValue: h.truco?.proposedValue ?? null,
    phase: h.phase,
    turnSeat: h.turnSeat,
    roundLeader: h.roundLeader,
    myCards: h.hands[seat]!.slice(),
    cardCounts: h.hands.map((c) => c.length),
    currentRound: h.currentRound.slice(),
    rounds: h.rounds.map((r) => ({ winner: r.winner, winnerSeat: r.winnerSeat, plays: r.plays })),
    availableActions: getAvailableActions(state, seat),
    maoDeOnzeTeam: h.maoDeOnzeTeam,
    trucoRequesterTeam: h.truco?.requesterTeam ?? null,
    lastRaiserTeam: h.lastRaiserTeam,
    lastResult: h.result,
    version: state.version,
  };
}

/** Seats that may act right now (used by the AI driver and the multiplayer server). */
export function seatsToAct(state: MatchState): Seat[] {
  return ([0, 1, 2, 3] as Seat[]).filter((s) => getAvailableActions(state, s).length > 0);
}
