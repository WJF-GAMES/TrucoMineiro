import { Card } from '../cards/card';
import type { HandDecision } from '../rules/hand';

export type Seat = 0 | 1 | 2 | 3;
export type Team = 0 | 1;
export const SEATS: readonly Seat[] = [0, 1, 2, 3];

export function teamOf(seat: Seat): Team {
  return (seat % 2) as Team;
}
export function partnerOf(seat: Seat): Seat {
  return ((seat + 2) % 4) as Seat;
}
export function nextSeat(seat: Seat): Seat {
  return ((seat + 1) % 4) as Seat;
}
export function otherTeam(team: Team): Team {
  return team === 0 ? 1 : 0;
}

export type HandPhase =
  | 'SHUFFLING' // the dealer shuffles (as many times as they like) and then finishes
  | 'CUTTING' // the seat after the dealer cuts the deck; the hand is dealt right after
  | 'MAO_DE_ONZE' // team at 11 decides whether to play the hand (worth 3) or concede 1 point
  | 'PLAY' // waiting for turnSeat to play a card (or call truco)
  | 'TRUCO_RESPONSE' // waiting for the responding team to accept / raise / run
  | 'FINISHED';

/** Jogada no estado autoritativo: a carta real é sempre conhecida pelo motor. */
export interface PlayedCard {
  seat: Seat;
  card: Card;
  /** Jogada virada ("no escuro"): vale `COVERED_CARD_STRENGTH`. A chave só existe quando `true`. */
  covered?: true;
}

/**
 * Jogada como um assento a enxerga (views e eventos). `card` é `null` quando a carta foi jogada
 * virada por outro assento — a identidade nunca sai do motor/servidor para quem não a jogou.
 */
export interface TablePlay {
  seat: Seat;
  card: Card | null;
  covered?: boolean;
}

/**
 * Uma vaza **já resolvida** (vaza em andamento fica em `currentRound`, nunca aqui). Por isso
 * `winner: null` só significa cango — e o formato continua compatível com o RTDB, que apaga nulls.
 * Para a regra use `trickOutcome()`, que devolve o resultado explícito (`Team | 'TIE'`).
 */
export interface RoundResult {
  /** Winning team, or null when the trick "cangou" (tied between opposing teams). */
  winner: Team | null;
  /** Seat that played the winning card; on a cango, the seat that caused it (it leads next). */
  winnerSeat: Seat;
  plays: PlayedCard[];
}

/**
 * Desempate por cango em andamento: a vaza atual é aberta por quem cangou, e todos são obrigados a
 * jogar a maior carta. `null` fora do desempate; zera a cada mão nova.
 */
export interface TieBreakState {
  /** Quem provocou o cango mais recente — é quem abre a vaza de desempate. */
  causedBySeat: Seat;
  /** Vaza (0-based) que está sendo jogada em desempate. */
  round: number;
}

export interface TrucoState {
  /** Team that made the pending proposal. */
  requesterTeam: Team;
  /** Value the hand will have if accepted. */
  proposedValue: number;
  /** Seat whose turn was interrupted by the call (play resumes there). */
  resumeSeat: Seat;
}

/** Where the cutter splits the deck: a few cards from the top, the middle, or most of it. */
export type CutDepth = 'high' | 'middle' | 'low';

export type HandEndReason = 'ROUNDS' | 'RUN' | 'MAO_DE_ONZE_DECLINED' | 'ALL_TIED';

export interface HandResult {
  winner: Team | null;
  points: number;
  reason: HandEndReason;
  /** Só em `reason: 'ROUNDS'`: como as vazas decidiram a mão (a chave não existe nos outros). */
  decidedBy?: HandDecision;
}

export interface HandState {
  number: number;
  dealerSeat: Seat;
  /** Current hand value (points awarded to the winner). */
  value: number;
  /** Team that made the last accepted raise (they cannot raise again). */
  lastRaiserTeam: Team | null;
  phase: HandPhase;
  /**
   * The deck as it stands before dealing (top first). Starts shuffled by the engine; every
   * `SHUFFLE` reshuffles this exact deck (never the original order) and the `CUT` rotates it.
   */
  deck: Card[];
  /** Bumps on every shuffle and on every cut: the deal consumes exactly the last version. */
  deckVersion: number;
  /** How many times the dealer shuffled this hand (feedback for the table). */
  shuffleCount: number;
  /** How many times the cutter cut this hand. Like the shuffle, the cut can be repeated. */
  cutCount: number;
  hands: Card[][]; // index = seat
  currentRound: PlayedCard[];
  roundLeader: Seat;
  rounds: RoundResult[];
  turnSeat: Seat;
  truco: TrucoState | null;
  /** Desempate por cango ativo (maior carta obrigatória); `null` no jogo normal. */
  tieBreak: TieBreakState | null;
  maoDeOnzeTeam: Team | null;
  result: HandResult | null;
}

export interface MatchConfig {
  targetScore: number;
  seed: number;
}

export type MatchStatus = 'PLAYING' | 'FINISHED';

export interface MatchState {
  config: MatchConfig;
  status: MatchStatus;
  scores: [number, number];
  hand: HandState;
  handsPlayed: number;
  rngState: number;
  winner: Team | null;
  /** Monotonic action counter; used for idempotency/versioning in multiplayer. */
  version: number;
  events: GameEvent[];
}

export type ActionType =
  | 'SHUFFLE'
  | 'FINISH_SHUFFLE'
  | 'CUT'
  | 'FINISH_CUT'
  | 'PLAY_CARD'
  | 'PLAY_CARD_COVERED'
  | 'REQUEST_TRUCO'
  | 'ACCEPT_TRUCO'
  | 'RAISE'
  | 'RUN'
  | 'ACCEPT_MAO_DE_ONZE'
  | 'DECLINE_MAO_DE_ONZE';

export type GameAction =
  | { type: 'SHUFFLE'; seat: Seat }
  | { type: 'FINISH_SHUFFLE'; seat: Seat }
  | { type: 'CUT'; seat: Seat; depth?: CutDepth }
  | { type: 'FINISH_CUT'; seat: Seat }
  | { type: 'PLAY_CARD'; seat: Seat; cardId: string }
  | { type: 'PLAY_CARD_COVERED'; seat: Seat; cardId: string }
  | { type: 'REQUEST_TRUCO'; seat: Seat }
  | { type: 'ACCEPT_TRUCO'; seat: Seat }
  | { type: 'RAISE'; seat: Seat }
  | { type: 'RUN'; seat: Seat }
  | { type: 'ACCEPT_MAO_DE_ONZE'; seat: Seat }
  | { type: 'DECLINE_MAO_DE_ONZE'; seat: Seat };

export type GameEvent =
  | { type: 'HAND_STARTED'; number: number; dealerSeat: Seat; firstSeat: Seat }
  | { type: 'SHUFFLE_PERFORMED'; seat: Seat; deckVersion: number; shuffleCount: number }
  | { type: 'SHUFFLE_FINALIZED'; seat: Seat; deckVersion: number; shuffleCount: number }
  | { type: 'CUT_DONE'; seat: Seat; depth: CutDepth; deckVersion: number; cutCount: number }
  | { type: 'CUT_FINALIZED'; seat: Seat; deckVersion: number; cutCount: number }
  | { type: 'HAND_DEALT'; number: number; firstSeat: Seat }
  /** `card` só é `null` na cópia redigida para quem não jogou a carta virada (`eventsForSeat`). */
  | { type: 'CARD_PLAYED'; seat: Seat; card: Card | null; covered?: boolean }
  | { type: 'ROUND_ENDED'; round: number; winner: Team | null; winnerSeat: Seat }
  /**
   * A vaza `round` será de desempate e `leadSeat` (quem cangou) abre. `continued` = o desempate já
   * vinha da vaza anterior (cangou de novo).
   */
  | { type: 'TIE_BREAK_STARTED'; round: number; leadSeat: Seat; continued: boolean }
  | { type: 'TRUCO_REQUESTED'; seat: Seat; value: number }
  | { type: 'TRUCO_ACCEPTED'; seat: Seat; value: number }
  | { type: 'TRUCO_RAISED'; seat: Seat; value: number }
  | { type: 'RAN'; seat: Seat; points: number; winner: Team }
  | { type: 'MAO_DE_ONZE_ACCEPTED'; team: Team }
  | { type: 'MAO_DE_ONZE_DECLINED'; team: Team; winner: Team }
  /**
   * A mão acabou e as cartas que estavam nas mãos são mostradas a todos (hoje: mão de onze
   * recusada). Só visual: o resultado já está decidido. `hands[seat]` = cartas daquele assento.
   */
  | { type: 'HAND_REVEALED'; reason: 'MAO_DE_ONZE_DECLINED'; hands: Card[][] }
  | { type: 'HAND_ENDED'; result: HandResult; scores: [number, number] }
  | { type: 'MATCH_ENDED'; winner: Team; scores: [number, number] };
