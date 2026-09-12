import { Card } from '../cards/card';

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
  | 'MAO_DE_ONZE' // team at 11 decides whether to play the hand (worth 3) or concede 1 point
  | 'PLAY' // waiting for turnSeat to play a card (or call truco)
  | 'TRUCO_RESPONSE' // waiting for the responding team to accept / raise / run
  | 'FINISHED';

export interface PlayedCard {
  seat: Seat;
  card: Card;
}

export interface RoundResult {
  /** Winning team or null when tied. */
  winner: Team | null;
  /** Seat that played the winning card (or the round leader on a tie). */
  winnerSeat: Seat;
  plays: PlayedCard[];
}

export interface TrucoState {
  /** Team that made the pending proposal. */
  requesterTeam: Team;
  /** Value the hand will have if accepted. */
  proposedValue: number;
  /** Seat whose turn was interrupted by the call (play resumes there). */
  resumeSeat: Seat;
}

export type HandEndReason = 'ROUNDS' | 'RUN' | 'MAO_DE_ONZE_DECLINED' | 'ALL_TIED';

export interface HandResult {
  winner: Team | null;
  points: number;
  reason: HandEndReason;
}

export interface HandState {
  number: number;
  dealerSeat: Seat;
  /** Current hand value (points awarded to the winner). */
  value: number;
  /** Team that made the last accepted raise (they cannot raise again). */
  lastRaiserTeam: Team | null;
  phase: HandPhase;
  hands: Card[][]; // index = seat
  currentRound: PlayedCard[];
  roundLeader: Seat;
  rounds: RoundResult[];
  turnSeat: Seat;
  truco: TrucoState | null;
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
  | 'PLAY_CARD'
  | 'REQUEST_TRUCO'
  | 'ACCEPT_TRUCO'
  | 'RAISE'
  | 'RUN'
  | 'ACCEPT_MAO_DE_ONZE'
  | 'DECLINE_MAO_DE_ONZE';

export type GameAction =
  | { type: 'PLAY_CARD'; seat: Seat; cardId: string }
  | { type: 'REQUEST_TRUCO'; seat: Seat }
  | { type: 'ACCEPT_TRUCO'; seat: Seat }
  | { type: 'RAISE'; seat: Seat }
  | { type: 'RUN'; seat: Seat }
  | { type: 'ACCEPT_MAO_DE_ONZE'; seat: Seat }
  | { type: 'DECLINE_MAO_DE_ONZE'; seat: Seat };

export type GameEvent =
  | { type: 'HAND_STARTED'; number: number; dealerSeat: Seat; firstSeat: Seat }
  | { type: 'CARD_PLAYED'; seat: Seat; card: Card }
  | { type: 'ROUND_ENDED'; round: number; winner: Team | null; winnerSeat: Seat }
  | { type: 'TRUCO_REQUESTED'; seat: Seat; value: number }
  | { type: 'TRUCO_ACCEPTED'; seat: Seat; value: number }
  | { type: 'TRUCO_RAISED'; seat: Seat; value: number }
  | { type: 'RAN'; seat: Seat; points: number; winner: Team }
  | { type: 'MAO_DE_ONZE_ACCEPTED'; team: Team }
  | { type: 'MAO_DE_ONZE_DECLINED'; team: Team; winner: Team }
  | { type: 'HAND_ENDED'; result: HandResult; scores: [number, number] }
  | { type: 'MATCH_ENDED'; winner: Team; scores: [number, number] };
