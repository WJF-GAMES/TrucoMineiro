import { Card, Rank, cardId } from '../cards/card';
import type { Seat, TablePlay } from '../state/types';

/**
 * Truco Mineiro uses fixed manilhas ("manilhas velhas"):
 * 4 de paus (Zap) > 7 de copas (Copeta) > As de espadas (Espadilha) > 7 de ouros (Pica-fumo).
 * Below them: 3 > 2 > A > K > J > Q > 7 > 6 > 5 > 4.
 */
const BASE_STRENGTH: Record<Rank, number> = {
  '4': 1,
  '5': 2,
  '6': 3,
  '7': 4,
  Q: 5,
  J: 6,
  K: 7,
  A: 8,
  '2': 9,
  '3': 10,
};

const MANILHA_STRENGTH: Record<string, number> = {
  '7O': 11, // Pica-fumo
  AE: 12, // Espadilha
  '7C': 13, // Copeta
  '4P': 14, // Zap
};

export const MANILHA_NAMES: Record<string, string> = {
  '4P': 'Zap',
  '7C': 'Sete de Copas',
  AE: 'Espadilha',
  '7O': 'Sete de Ouros',
};

export const MAX_STRENGTH = 14;

/**
 * Força de uma carta jogada virada ("no escuro"): abaixo de qualquer carta aberta, inclusive do 4
 * comum. A identidade real da carta nunca entra na comparação.
 */
export const COVERED_CARD_STRENGTH = 0;

/** Força efetiva de uma jogada na vaza: carta virada vale `COVERED_CARD_STRENGTH`. */
export function playStrength(play: Pick<TablePlay, 'card' | 'covered'>): number {
  if (play.covered || !play.card) return COVERED_CARD_STRENGTH;
  return cardStrength(play.card);
}

export function isManilha(card: Card): boolean {
  return cardId(card) in MANILHA_STRENGTH;
}

export function cardStrength(card: Card): number {
  return MANILHA_STRENGTH[cardId(card)] ?? BASE_STRENGTH[card.rank];
}

/** Positive when a beats b, negative when b beats a, zero on a tie (same strength, non-manilha). */
export function compareCards(a: Card, b: Card): number {
  return cardStrength(a) - cardStrength(b);
}

/**
 * Carta que está ganhando numa vaza (parcial ou completa). É a comparação única da vaza: o motor
 * (`resolveTrick`) e a mesa ("Ganhando") usam esta mesma função.
 */
export interface LeadingPlay {
  seat: Seat;
  card: Card | null;
  covered: boolean;
  /** A melhor carta está empatada com uma do time adversário (cango): ninguém "ganha". */
  tied: boolean;
  /** Quem igualou a maior carta do time adversário e deixou a vaza cangada; `null` sem cango. */
  tieCausedBySeat: Seat | null;
}

export function leadingPlay(plays: readonly TablePlay[]): LeadingPlay | null {
  if (plays.length === 0) return null;
  let best: TablePlay = plays[0]!;
  let tieCausedBySeat: Seat | null = null;
  for (const p of plays.slice(1)) {
    // Força efetiva: carta virada vale o mínimo, antes de rank ou manilha.
    const cmp = playStrength(p) - playStrength(best);
    if (cmp > 0) {
      // Carta maior desfaz qualquer cango anterior.
      best = p;
      tieCausedBySeat = null;
    } else if (cmp === 0 && p.seat % 2 !== best.seat % 2 && tieCausedBySeat === null) {
      // Igualou a maior carta do adversário: cangou. Um igual depois não troca o autor.
      tieCausedBySeat = p.seat;
    }
  }
  return {
    seat: best.seat,
    card: best.card,
    covered: Boolean(best.covered),
    tied: tieCausedBySeat !== null,
    tieCausedBySeat,
  };
}
