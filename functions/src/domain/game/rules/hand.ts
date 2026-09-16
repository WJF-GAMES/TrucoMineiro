import { Card } from '../cards/card';
import type { PlayedCard, Seat, Team } from '../state/types';
import { cardStrength, leadingPlay } from './strength';

/**
 * Resolução de vaza e de mão — a única fonte da regra de CANGO (empate) do Truco Mineiro.
 * Motor, IA, servidor e mesa consomem estas funções; ninguém recalcula a regra por conta própria.
 *
 * Regra adotada:
 * - 1ª cangada → desempate: quem cangou abre a 2ª, todos jogam a maior carta, e quem vencer a 2ª
 *   leva a mão. Se a 2ª também cangar, a 3ª continua no desempate (quem cangou de novo abre).
 * - 1ª com vencedor + 2ª cangada → vence quem ganhou a 1ª, sem 3ª vaza.
 * - 1ª e 2ª com vencedores diferentes + 3ª cangada → vence quem ganhou a 1ª.
 * - As três cangadas → `ALL_THREE_TRICKS_TIED_POLICY`.
 */

/** Resultado explícito de uma vaza já jogada: um time ou `'TIE'` (cangou). */
export type TrickOutcome = Team | 'TIE';

export interface TrickResolution {
  outcome: TrickOutcome;
  /** Quem jogou a carta vencedora; `null` quando cangou. */
  winnerSeat: Seat | null;
  /**
   * Quem provocou o cango: o primeiro jogador cuja carta igualou a maior carta do time adversário
   * (a jogada que deixou a vaza empatada). Um igual posterior mantém o cango, não troca o autor;
   * uma carta maior depois desfaz o cango e o próximo empate tem autor novo. `null` sem cango.
   */
  tieCausedBySeat: Seat | null;
}

/** Resolve uma vaza completa pela hierarquia real das cartas (manilhas incluídas). */
export function resolveTrick(plays: readonly PlayedCard[]): TrickResolution {
  const lead = leadingPlay(plays);
  if (!lead) throw new Error('resolveTrick: vaza vazia');
  if (lead.tied) return { outcome: 'TIE', winnerSeat: null, tieCausedBySeat: lead.tieCausedBySeat };
  return { outcome: (lead.seat % 2) as Team, winnerSeat: lead.seat, tieCausedBySeat: null };
}

/** Converte o `winner` guardado numa vaza (`null` = cangou) para o resultado explícito. */
export function trickOutcome(round: { winner: Team | null }): TrickOutcome {
  return round.winner === null ? 'TIE' : round.winner;
}

/** Como a mão foi decidida quando houve vencedor pelas vazas. */
export type HandDecision =
  /** Venceu duas vazas (A/A, A/B/A...). */
  | 'TWO_TRICKS'
  /** Cangou depois de a 1ª ter vencedor: vale a primeira (A/TIE, A/B/TIE). */
  | 'FIRST_TRICK_ADVANTAGE'
  /** Venceu a vaza de desempate depois de a 1ª cangar (TIE/A, TIE/TIE/A). */
  | 'CANGO_TIE_BREAK';

export type HandResolution =
  /** A mão continua; `tieBreak` = a próxima vaza é de desempate (maior carta obrigatória). */
  | { status: 'CONTINUE'; tieBreak: boolean }
  | { status: 'WINNER'; winner: Team; decidedBy: HandDecision }
  /** As três vazas cangaram: ver `ALL_THREE_TRICKS_TIED_POLICY`. */
  | { status: 'ALL_TIED' };

/**
 * Três vazas cangadas: não há vencedor da primeira para desempatar. É o único caso dependente de
 * variante local. O projeto já documentava (docs/game-engine.md) que ninguém pontua e a mão
 * seguinte começa normalmente — a decisão fica isolada aqui.
 */
export const ALL_THREE_TRICKS_TIED_POLICY = 'NO_POINTS' as const;

/**
 * Decide a mão a partir dos resultados das vazas **na ordem em que foram jogadas**.
 * Não é "melhor de três": A/TIE encerra com uma vaza só, e a ordem dos resultados importa.
 */
export function resolveHand(outcomes: readonly TrickOutcome[]): HandResolution {
  if (outcomes.length > 3) throw new Error(`resolveHand: ${outcomes.length} vazas`);
  const [first, second, third] = outcomes;
  if (first === undefined) return { status: 'CONTINUE', tieBreak: false };

  if (first === 'TIE') {
    // Cango na primeira: a vaza seguinte decide, sempre em desempate.
    if (second === undefined) return { status: 'CONTINUE', tieBreak: true };
    if (second !== 'TIE') return { status: 'WINNER', winner: second, decidedBy: 'CANGO_TIE_BREAK' };
    if (third === undefined) return { status: 'CONTINUE', tieBreak: true };
    if (third !== 'TIE') return { status: 'WINNER', winner: third, decidedBy: 'CANGO_TIE_BREAK' };
    return { status: 'ALL_TIED' };
  }

  if (second === undefined) return { status: 'CONTINUE', tieBreak: false };
  if (second === first) return { status: 'WINNER', winner: first, decidedBy: 'TWO_TRICKS' };
  if (second === 'TIE')
    return { status: 'WINNER', winner: first, decidedBy: 'FIRST_TRICK_ADVANTAGE' };

  // Um a um: a terceira decide; se ela cangar, vale a primeira.
  if (third === undefined) return { status: 'CONTINUE', tieBreak: false };
  if (third === 'TIE')
    return { status: 'WINNER', winner: first, decidedBy: 'FIRST_TRICK_ADVANTAGE' };
  return { status: 'WINNER', winner: third, decidedBy: 'TWO_TRICKS' };
}

/**
 * Cartas que valem como "a maior" de uma mão: todas as de força máxima (duas cartas comuns do
 * mesmo valor são igualmente maiores; manilhas nunca empatam entre si). Vazio para mão vazia.
 */
export function highestCards(cards: readonly Card[]): Card[] {
  if (cards.length === 0) return [];
  const max = Math.max(...cards.map(cardStrength));
  return cards.filter((c) => cardStrength(c) === max);
}

/** A maior carta da mão (a primeira na ordem da mão quando há duas de mesma força). */
export function highestCard(cards: readonly Card[]): Card | null {
  return highestCards(cards)[0] ?? null;
}
