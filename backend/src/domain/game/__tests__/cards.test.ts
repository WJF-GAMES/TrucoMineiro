import { cardId, parseCardId, RANKS, SUITS } from '../cards/card';
import { createDeck, deal, shuffle } from '../cards/deck';
import { createRng } from '../engine/rng';
import { cardStrength, compareCards, isManilha } from '../rules/strength';
import { nextStake, STAKE_LADDER, stakeName } from '../rules/stakes';

describe('deck', () => {
  it('has 40 unique cards (no 8, 9, 10)', () => {
    const deck = createDeck();
    expect(deck).toHaveLength(40);
    expect(new Set(deck.map(cardId)).size).toBe(40);
    expect(RANKS).not.toContain('8');
  });

  it('shuffles deterministically with the same seed', () => {
    const a = shuffle(createDeck(), createRng(42)).map(cardId);
    const b = shuffle(createDeck(), createRng(42)).map(cardId);
    const c = shuffle(createDeck(), createRng(43)).map(cardId);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    expect(a.slice().sort()).toEqual(createDeck().map(cardId).sort());
  });

  it('deals 3 cards to 4 players without duplicates', () => {
    const hands = deal(shuffle(createDeck(), createRng(1)), 4, 3);
    expect(hands).toHaveLength(4);
    hands.forEach((h) => expect(h).toHaveLength(3));
    expect(new Set(hands.flat().map(cardId)).size).toBe(12);
  });

  it('round-trips card ids', () => {
    for (const suit of SUITS)
      for (const rank of RANKS) {
        expect(parseCardId(cardId({ rank, suit }))).toEqual({ rank, suit });
      }
    expect(() => parseCardId('8P')).toThrow();
  });
});

describe('card strength (Truco Mineiro manilhas)', () => {
  it('orders manilhas Zap > 7 copas > Espadilha > 7 ouros', () => {
    const zap = parseCardId('4P');
    const copeta = parseCardId('7C');
    const espadilha = parseCardId('AE');
    const picaFumo = parseCardId('7O');
    expect(compareCards(zap, copeta)).toBeGreaterThan(0);
    expect(compareCards(copeta, espadilha)).toBeGreaterThan(0);
    expect(compareCards(espadilha, picaFumo)).toBeGreaterThan(0);
    expect(compareCards(picaFumo, parseCardId('3P'))).toBeGreaterThan(0);
    [zap, copeta, espadilha, picaFumo].forEach((c) => expect(isManilha(c)).toBe(true));
  });

  it('orders common cards 3 > 2 > A > K > J > Q > 7 > 6 > 5 > 4', () => {
    const order = ['3P', '2P', 'AP', 'KP', 'JP', 'QP', '7P', '6P', '5P', '4O'];
    for (let i = 0; i < order.length - 1; i++) {
      expect(compareCards(parseCardId(order[i]!), parseCardId(order[i + 1]!))).toBeGreaterThan(0);
    }
  });

  it('ties equal non-manilha cards regardless of suit', () => {
    expect(compareCards(parseCardId('3P'), parseCardId('3C'))).toBe(0);
    expect(cardStrength(parseCardId('4O'))).toBe(cardStrength(parseCardId('4E')));
    // A non-manilha A or 7 is weaker than its manilha sibling
    expect(compareCards(parseCardId('AP'), parseCardId('AE'))).toBeLessThan(0);
  });
});

describe('stakes', () => {
  it('follows the ladder 1 -> 3 -> 6 -> 9 -> 12', () => {
    expect(STAKE_LADDER).toEqual([1, 3, 6, 9, 12]);
    expect(nextStake(1)).toBe(3);
    expect(nextStake(9)).toBe(12);
    expect(nextStake(12)).toBeNull();
    expect(stakeName(3)).toBe('Truco');
    expect(stakeName(6)).toBe('Seis');
    expect(stakeName(9)).toBe('Nove');
    expect(stakeName(12)).toBe('Doze');
  });
});
