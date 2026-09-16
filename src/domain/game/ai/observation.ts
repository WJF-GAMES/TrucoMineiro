import { Card, cardId } from '../cards/card';
import { SeatView } from '../engine/engine';
import { ActionType, Seat, TablePlay, Team, partnerOf, teamOf } from '../state/types';

/**
 * Everything an AI player is allowed to know: exactly what a human in that seat would see.
 * It is built from the seat view, never from the raw MatchState, so hidden hands cannot leak.
 */
export interface AIObservation {
  seat: Seat;
  team: Team;
  partnerSeat: Seat;
  myCards: Card[];
  /** Cartas que o motor aceita agora (no desempate por cango, só a maior). */
  playableCards: Card[];
  /** Desempate por cango em andamento: a vaza é jogada obrigatoriamente com a maior carta. */
  tieBreak: boolean;
  cardCounts: number[];
  /** Cartas viradas dos outros chegam sem identidade (`card: null`), como para um humano. */
  currentRound: TablePlay[];
  rounds: { winner: Team | null; plays: TablePlay[] }[];
  scores: [number, number];
  handValue: number;
  proposedValue: number | null;
  phase: SeatView['phase'];
  /** Quantas vezes o baralho já foi misturado nesta mão (a IA decide quando "está bom"). */
  shuffleCount: number;
  /** Quantas vezes o baralho já foi cortado nesta mão (a IA decide quando para de cortar). */
  cutCount: number;
  availableActions: ActionType[];
  roundLeader: Seat;
  trucoRequesterTeam: Team | null;
  lastRaiserTeam: Team | null;
}

export function observe(view: SeatView): AIObservation {
  return {
    seat: view.seat,
    team: teamOf(view.seat),
    partnerSeat: partnerOf(view.seat),
    myCards: view.myCards,
    playableCards: view.myCards.filter((c) => view.playableCardIds.includes(cardId(c))),
    tieBreak: view.tieBreak !== null,
    cardCounts: view.cardCounts,
    currentRound: view.currentRound,
    rounds: view.rounds.map((r) => ({ winner: r.winner, plays: r.plays })),
    scores: view.scores,
    handValue: view.handValue,
    proposedValue: view.proposedValue,
    phase: view.phase,
    shuffleCount: view.shuffleCount,
    cutCount: view.cutCount,
    availableActions: view.availableActions,
    roundLeader: view.roundLeader,
    trucoRequesterTeam: view.trucoRequesterTeam,
    lastRaiserTeam: view.lastRaiserTeam,
  };
}
