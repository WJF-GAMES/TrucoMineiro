import { Card, Rank, cardId } from '../cards/card';

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
