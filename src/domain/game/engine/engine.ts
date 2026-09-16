import { Card, cardId, parseCardId, sameCard } from '../cards/card';
import { createDeck, deal, shuffle } from '../cards/deck';
import {
  ALL_THREE_TRICKS_TIED_POLICY,
  highestCards,
  resolveHand,
  resolveTrick,
  trickOutcome,
} from '../rules/hand';
import { MAO_DE_ONZE_SCORE, STAKE_LADDER, TARGET_SCORE, nextStake } from '../rules/stakes';
import {
  ActionType,
  CutDepth,
  GameAction,
  GameEvent,
  HandResult,
  HandState,
  MatchState,
  PlayedCard,
  Seat,
  TablePlay,
  Team,
  TieBreakState,
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
/** Cards moved from the top to the bottom by each kind of cut (40-card deck). */
const CUT_SIZE: Record<CutDepth, number> = { high: 10, middle: 20, low: 30 };

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

/**
 * A hand starts with the dealer shuffling. The engine already shuffles the deck once (so a hand
 * that is finished by timeout without any shuffle is still random); every `SHUFFLE` reshuffles
 * the current deck, `FINISH_SHUFFLE` hands it to the cutter, and `CUT` rotates it and deals.
 */
function startHand(state: MatchState, dealerSeat: Seat): MatchState {
  const rng = createRng(state.rngState);
  const deck = shuffle(createDeck(), rng);
  const firstSeat = nextSeat(dealerSeat);
  const number = state.handsPlayed + 1;

  const hand: HandState = {
    number,
    dealerSeat,
    value: STAKE_LADDER[0]!,
    lastRaiserTeam: null,
    phase: 'SHUFFLING',
    deck,
    deckVersion: 0,
    shuffleCount: 0,
    cutCount: 0,
    hands: Array.from({ length: PLAYERS }, () => []),
    currentRound: [],
    roundLeader: firstSeat,
    rounds: [],
    // Who must act now: the dealer shuffles, then the next seat cuts, then `firstSeat` leads.
    turnSeat: dealerSeat,
    truco: null,
    // Mão nova sempre começa no jogo normal: nenhum desempate herdado da anterior.
    tieBreak: null,
    maoDeOnzeTeam: teamAtEleven(state),
    result: null,
  };

  return {
    ...state,
    hand,
    rngState: rng.state(),
    events: [...state.events, { type: 'HAND_STARTED', number, dealerSeat, firstSeat }],
  };
}

function teamAtEleven(state: MatchState): Team | null {
  const bothAtEleven = state.scores[0] >= MAO_DE_ONZE_SCORE && state.scores[1] >= MAO_DE_ONZE_SCORE;
  // "Mão de ferro": both at 11 is played normally with no truco allowed.
  if (bothAtEleven) return null;
  if (state.scores[0] >= MAO_DE_ONZE_SCORE) return 0;
  if (state.scores[1] >= MAO_DE_ONZE_SCORE) return 1;
  return null;
}

/** Seat that cuts: always the one after the dealer (an opponent, and the first to play). */
export function cutterSeatOf(dealerSeat: Seat): Seat {
  return nextSeat(dealerSeat);
}

// --- Ceremony: shuffle / cut / deal --------------------------------------

function performShuffle(state: MatchState, seat: Seat): MatchState {
  const rng = createRng(state.rngState);
  const hand = state.hand;
  const deck = shuffle(hand.deck, rng);
  const deckVersion = hand.deckVersion + 1;
  const shuffleCount = hand.shuffleCount + 1;
  const next: MatchState = {
    ...withHand(state, { deck, deckVersion, shuffleCount }),
    rngState: rng.state(),
  };
  return emit(next, { type: 'SHUFFLE_PERFORMED', seat, deckVersion, shuffleCount });
}

function finishShuffle(state: MatchState, seat: Seat): MatchState {
  const hand = state.hand;
  const next = withHand(state, { phase: 'CUTTING', turnSeat: cutterSeatOf(hand.dealerSeat) });
  return emit(next, {
    type: 'SHUFFLE_FINALIZED',
    seat,
    deckVersion: hand.deckVersion,
    shuffleCount: hand.shuffleCount,
  });
}

/**
 * Um corte. Repetível dentro do prazo, como o embaralhamento: cada `CUT` roda o baralho que
 * ficou do corte anterior (nunca a ordem original) e a mão só é distribuída no `FINISH_CUT`.
 */
function cutDeck(state: MatchState, seat: Seat, depth: CutDepth): MatchState {
  const hand = state.hand;
  const n = CUT_SIZE[depth];
  // The top `n` cards go under the rest: a real cut, on the exact deck the dealer left.
  const deck = [...hand.deck.slice(n), ...hand.deck.slice(0, n)];
  const deckVersion = hand.deckVersion + 1;
  const cutCount = hand.cutCount + 1;
  return emit(withHand(state, { deck, deckVersion, cutCount }), {
    type: 'CUT_DONE',
    seat,
    depth,
    deckVersion,
    cutCount,
  });
}

/**
 * Fecha o corte e distribui. O corte é obrigatório na mesa: se o prazo estourou sem nenhum
 * corte, o baralho é cortado no meio antes de distribuir.
 */
function finishCut(state: MatchState, seat: Seat): MatchState {
  const cut = state.hand.cutCount === 0 ? cutDeck(state, seat, 'middle') : state;
  const hand = cut.hand;
  const next = emit(cut, {
    type: 'CUT_FINALIZED',
    seat,
    deckVersion: hand.deckVersion,
    cutCount: hand.cutCount,
  });
  return dealHand(next);
}

function dealHand(state: MatchState): MatchState {
  const hand = state.hand;
  const hands = deal(hand.deck, PLAYERS, CARDS_PER_PLAYER);
  const firstSeat = nextSeat(hand.dealerSeat);
  const next = withHand(state, {
    hands,
    phase: hand.maoDeOnzeTeam === null ? 'PLAY' : 'MAO_DE_ONZE',
    turnSeat: firstSeat,
    roundLeader: firstSeat,
  });
  return emit(next, { type: 'HAND_DEALT', number: hand.number, firstSeat });
}

/**
 * Test/tooling helper: runs the ceremony with no extra shuffle and a middle cut, leaving the hand
 * dealt and ready to play. Production code never calls this — the players do it action by action.
 */
export function skipCeremony(state: MatchState): MatchState {
  let s = state;
  if (s.hand.phase === 'SHUFFLING')
    s = applyAction(s, { type: 'FINISH_SHUFFLE', seat: s.hand.dealerSeat });
  // `FINISH_CUT` sem nenhum corte corta no meio sozinho: mesmo baralho de antes.
  if (s.hand.phase === 'CUTTING')
    s = applyAction(s, { type: 'FINISH_CUT', seat: cutterSeatOf(s.hand.dealerSeat) });
  return s;
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
    case 'SHUFFLING':
      return hand.dealerSeat === seat ? ['SHUFFLE', 'FINISH_SHUFFLE'] : [];
    case 'CUTTING':
      return cutterSeatOf(hand.dealerSeat) === seat ? ['CUT', 'FINISH_CUT'] : [];
    case 'MAO_DE_ONZE':
      return hand.maoDeOnzeTeam === team ? ['ACCEPT_MAO_DE_ONZE', 'DECLINE_MAO_DE_ONZE'] : [];
    case 'PLAY': {
      if (hand.turnSeat !== seat) return [];
      const actions: ActionType[] = ['PLAY_CARD'];
      if (canPlayCovered(state)) actions.push('PLAY_CARD_COVERED');
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
    case 'SHUFFLE':
      next = performShuffle(state, action.seat);
      break;
    case 'FINISH_SHUFFLE':
      next = finishShuffle(state, action.seat);
      break;
    case 'CUT':
      next = cutDeck(state, action.seat, action.depth ?? 'middle');
      break;
    case 'FINISH_CUT':
      next = finishCut(state, action.seat);
      break;
    case 'PLAY_CARD':
      next = playCard(state, action.seat, parseCardId(action.cardId), false);
      break;
    case 'PLAY_CARD_COVERED':
      next = playCard(state, action.seat, parseCardId(action.cardId), true);
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

/**
 * Carta virada ("no escuro") só pode ser jogada a partir da segunda rodada da mão: na primeira
 * rodada todos jogam aberto. No desempate por cango também é proibida: ali todos jogam a maior
 * carta, aberta.
 */
export function canPlayCovered(state: MatchState): boolean {
  const hand = state.hand;
  return hand.phase === 'PLAY' && hand.tieBreak === null && hand.rounds.length > 0;
}

function playCard(state: MatchState, seat: Seat, card: Card, covered: boolean): MatchState {
  const hand = state.hand;
  const owned = hand.hands[seat]!;
  if (!owned.some((c) => sameCard(c, card))) {
    throw new InvalidActionError(`Seat ${seat} does not hold ${cardId(card)}`);
  }
  if (!playableCards(state, seat).some((c) => sameCard(c, card))) {
    // Desempate por cango: só a maior carta vale. A UI já esconde as outras; aqui é a autoridade.
    throw new InvalidActionError(
      `MUST_PLAY_HIGHEST_CARD: seat ${seat} must play its highest card in the tie-break, not ${cardId(card)}`,
    );
  }
  if (covered && !canPlayCovered(state)) {
    throw new InvalidActionError(`COVERED_NOT_ALLOWED: seat ${seat} cannot play covered now`);
  }
  const hands = hand.hands.map((h, i) => (i === seat ? h.filter((c) => !sameCard(c, card)) : h));
  // A carta real fica no estado (é ela que sai da mão); `covered` só existe quando é virada.
  const play: PlayedCard = covered ? { seat, card, covered: true } : { seat, card };
  const currentRound: PlayedCard[] = [...hand.currentRound, play];

  const next = emit(
    withHand(state, { hands, currentRound }),
    covered
      ? { type: 'CARD_PLAYED', seat, card, covered: true }
      : { type: 'CARD_PLAYED', seat, card },
  );

  if (currentRound.length < PLAYERS) {
    return withHand(next, { turnSeat: nextSeat(seat) });
  }
  return resolveRound(next);
}

/**
 * Cartas que `seat` pode jogar agora pela regra da vaza (sem olhar de quem é a vez).
 * No desempate por cango só a maior carta (ou as de mesma força máxima); fora dele, a mão toda.
 */
export function playableCards(state: MatchState, seat: Seat): Card[] {
  const owned = state.hand.hands[seat] ?? [];
  return state.hand.tieBreak ? highestCards(owned) : owned.slice();
}

/** Aplica `ALL_THREE_TRICKS_TIED_POLICY` (hoje só existe `NO_POINTS`: ninguém pontua). */
function allTiedResult(): HandResult {
  const policy: typeof ALL_THREE_TRICKS_TIED_POLICY = ALL_THREE_TRICKS_TIED_POLICY;
  switch (policy) {
    case 'NO_POINTS':
      return { winner: null, points: 0, reason: 'ALL_TIED' };
  }
}

function resolveRound(state: MatchState): MatchState {
  const hand = state.hand;
  const plays = hand.currentRound;
  const trick = resolveTrick(plays);
  const tied = trick.outcome === 'TIE';
  const winner: Team | null = tied ? null : (trick.outcome as Team);
  // Em cango quem "fica com a vaza" para abrir a próxima é quem cangou.
  const winnerSeat: Seat = (tied ? trick.tieCausedBySeat : trick.winnerSeat) ?? hand.roundLeader;
  const roundIndex = hand.rounds.length;
  const rounds = [...hand.rounds, { winner, winnerSeat, plays }];

  const next = emit(withHand(state, { rounds, currentRound: [] }), {
    type: 'ROUND_ENDED',
    round: roundIndex,
    winner,
    winnerSeat,
  });

  const resolution = resolveHand(rounds.map(trickOutcome));
  switch (resolution.status) {
    case 'ALL_TIED':
      return finishHand(next, allTiedResult());
    case 'WINNER':
      return finishHand(next, {
        winner: resolution.winner,
        points: next.hand.value,
        reason: 'ROUNDS',
        decidedBy: resolution.decidedBy,
      });
    case 'CONTINUE': {
      // Quem venceu abre a próxima; em cango, quem cangou abre o desempate.
      const tieBreak: TieBreakState | null = resolution.tieBreak
        ? { causedBySeat: winnerSeat, round: roundIndex + 1 }
        : null;
      const moved = withHand(next, { roundLeader: winnerSeat, turnSeat: winnerSeat, tieBreak });
      if (!tieBreak) return moved;
      return emit(moved, {
        type: 'TIE_BREAK_STARTED',
        round: tieBreak.round,
        leadSeat: winnerSeat,
        continued: hand.tieBreak !== null,
      });
    }
  }
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
  let next = emit(state, { type: 'MAO_DE_ONZE_DECLINED', team, winner });
  // Correu da mão de onze: a mão já está decidida, e as cartas de todos são mostradas na mesa.
  // Nenhuma carta foi jogada ainda (a decisão vem logo depois da distribuição).
  next = emit(next, {
    type: 'HAND_REVEALED',
    reason: 'MAO_DE_ONZE_DECLINED',
    hands: state.hand.hands.map((h) => h.slice()),
  });
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
    ...withHand(state, { phase: 'FINISHED', result, truco: null, tieBreak: null }),
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
  /** Quem dá as cartas nesta mão — informação pública na mesa (dirige a cerimônia de início). */
  dealerSeat: Seat;
  handValue: number;
  /** Ceremony state (the deck itself never leaves the engine). */
  deckVersion: number;
  shuffleCount: number;
  /** Quantos cortes já foram dados nesta mão (o corte é repetível dentro do prazo). */
  cutCount: number;
  proposedValue: number | null;
  phase: HandState['phase'];
  turnSeat: Seat;
  roundLeader: Seat;
  myCards: Card[];
  /**
   * Ids das minhas cartas que o motor aceita agora pela regra da vaza (no desempate, só a maior).
   * A mesa habilita/destaca por aqui — nunca calcula a regra.
   */
  playableCardIds: string[];
  /** Desempate por cango em andamento (público: todos veem quem abre). */
  tieBreak: TieBreakState | null;
  /** Number of cards still held by each seat (never the cards themselves). */
  cardCounts: number[];
  /** Cartas na mesa; carta virada de outro assento chega com `card: null`. */
  currentRound: TablePlay[];
  rounds: { winner: Team | null; winnerSeat: Seat; plays: TablePlay[] }[];
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
    dealerSeat: h.dealerSeat,
    handValue: h.value,
    deckVersion: h.deckVersion,
    shuffleCount: h.shuffleCount,
    cutCount: h.cutCount,
    proposedValue: h.truco?.proposedValue ?? null,
    phase: h.phase,
    turnSeat: h.turnSeat,
    roundLeader: h.roundLeader,
    myCards: h.hands[seat]!.slice(),
    playableCardIds: playableCards(state, seat).map(cardId),
    tieBreak: h.tieBreak ? { ...h.tieBreak } : null,
    cardCounts: h.hands.map((c) => c.length),
    currentRound: h.currentRound.map((p) => playForSeat(p, seat)),
    rounds: h.rounds.map((r) => ({
      winner: r.winner,
      winnerSeat: r.winnerSeat,
      plays: r.plays.map((p) => playForSeat(p, seat)),
    })),
    availableActions: getAvailableActions(state, seat),
    maoDeOnzeTeam: h.maoDeOnzeTeam,
    trucoRequesterTeam: h.truco?.requesterTeam ?? null,
    lastRaiserTeam: h.lastRaiserTeam,
    lastResult: h.result,
    version: state.version,
  };
}

/**
 * Uma jogada como `seat` a enxerga: carta virada só mostra a identidade para quem a jogou.
 * O formato é sempre o mesmo (`covered` presente), o que também serve ao RTDB.
 */
export function playForSeat(play: PlayedCard, seat: Seat): TablePlay {
  if (!play.covered) return { seat: play.seat, card: play.card, covered: false };
  return { seat: play.seat, card: play.seat === seat ? play.card : null, covered: true };
}

/**
 * Eventos como `seat` pode vê-los. Toda saída de eventos para um assento (view online, mesa local)
 * passa por aqui: o `CARD_PLAYED` de uma carta virada perde a identidade para os outros assentos.
 */
export function eventsForSeat(events: readonly GameEvent[], seat: Seat): GameEvent[] {
  return events.map((e) =>
    e.type === 'CARD_PLAYED' && e.covered && e.seat !== seat ? { ...e, card: null } : e,
  );
}

/** Seats that may act right now (used by the AI driver and the multiplayer server). */
export function seatsToAct(state: MatchState): Seat[] {
  return ([0, 1, 2, 3] as Seat[]).filter((s) => getAvailableActions(state, s).length > 0);
}
