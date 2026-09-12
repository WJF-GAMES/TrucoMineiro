import { Card, RANKS, SUITS } from './card';
import { Rng } from '../engine/rng';

/** Truco Mineiro uses the 40-card deck (no 8, 9, 10, no jokers). */
export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) for (const rank of RANKS) deck.push({ rank, suit });
  return deck;
}

/** Fisher-Yates shuffle driven by the injected RNG (deterministic with a seed). */
export function shuffle(deck: readonly Card[], rng: Rng): Card[] {
  const out = deck.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

/** Deals cardsPerPlayer cards to each player from the top of the deck. */
export function deal(deck: readonly Card[], players: number, cardsPerPlayer: number): Card[][] {
  if (deck.length < players * cardsPerPlayer) throw new Error('Not enough cards to deal');
  const hands: Card[][] = Array.from({ length: players }, () => []);
  let idx = 0;
  for (let c = 0; c < cardsPerPlayer; c++) {
    for (let p = 0; p < players; p++) hands[p]!.push(deck[idx++]!);
  }
  return hands;
}
