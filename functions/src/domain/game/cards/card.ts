export type Suit = 'paus' | 'copas' | 'espadas' | 'ouros';
export type Rank = '4' | '5' | '6' | '7' | 'Q' | 'J' | 'K' | 'A' | '2' | '3';

export interface Card {
  readonly rank: Rank;
  readonly suit: Suit;
}

export const SUITS: readonly Suit[] = ['paus', 'copas', 'espadas', 'ouros'];
export const RANKS: readonly Rank[] = ['4', '5', '6', '7', 'Q', 'J', 'K', 'A', '2', '3'];

const SUIT_LETTER: Record<Suit, string> = { paus: 'P', copas: 'C', espadas: 'E', ouros: 'O' };
const LETTER_SUIT: Record<string, Suit> = { P: 'paus', C: 'copas', E: 'espadas', O: 'ouros' };

/** Stable id like "7C" (7 de copas). */
export function cardId(card: Card): string {
  return `${card.rank}${SUIT_LETTER[card.suit]}`;
}

export function parseCardId(id: string): Card {
  const rank = id.slice(0, -1) as Rank;
  const suit = LETTER_SUIT[id.slice(-1)];
  if (!RANKS.includes(rank) || !suit) throw new Error(`Invalid card id: ${id}`);
  return { rank, suit };
}

export function sameCard(a: Card, b: Card): boolean {
  return a.rank === b.rank && a.suit === b.suit;
}
