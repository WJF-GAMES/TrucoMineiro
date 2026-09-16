import { cardId, parseCardId } from '../cards/card';
import { cardStrength, leadingPlay } from '../rules/strength';
import {
  ALL_THREE_TRICKS_TIED_POLICY,
  highestCard,
  highestCards,
  resolveHand,
  resolveTrick,
  type TrickOutcome,
} from '../rules/hand';
import {
  applyAction,
  createMatch,
  getAvailableActions,
  InvalidActionError,
  playableCards,
  skipCeremony,
  viewForSeat,
} from '../engine/engine';
import { createRng } from '../engine/rng';
import { aiForDifficulty, type AIDifficulty, type AIPlayer } from '../ai/ai';
import { nextAIAction } from '../ai/driver';
import type { GameEvent, HandState, MatchState, PlayedCard, Seat } from '../state/types';

/**
 * Regra de CANGO (empate de vaza). Times: A = assentos 0 e 2, B = assentos 1 e 3.
 * Na mão 1 quem dá é o assento 3, então o assento 0 abre a primeira vaza.
 */

type Play = readonly [Seat, string];
type Trick = readonly Play[];

const A = 0 as const;
const B = 1 as const;
const TIE = 'TIE' as const;

/** Placar alvo alto: nenhum valor de mão encerra a partida no meio do teste. */
const dealt = () => skipCeremony(createMatch(3, 99));

/** Monta as mãos a partir das vazas: cada assento recebe as cartas que joga, na ordem. */
function handsFrom(tricks: readonly Trick[]): string[][] {
  const hands: string[][] = [[], [], [], []];
  for (const t of tricks) for (const [seat, c] of t) hands[seat]!.push(c);
  return hands;
}

function rig(tricks: readonly Trick[], extra: Partial<HandState> = {}): MatchState {
  const s = dealt();
  return {
    ...s,
    hand: {
      ...s.hand,
      hands: handsFrom(tricks).map((h) => h.map(parseCardId)),
      ...extra,
    },
  };
}

/** Joga uma vaza conferindo, carta a carta, que é mesmo a vez de quem joga. */
function playTrick(state: MatchState, trick: Trick): MatchState {
  let s = state;
  for (const [seat, c] of trick) {
    expect({ seat, turn: s.hand.turnSeat }).toEqual({ seat, turn: seat });
    s = applyAction(s, { type: 'PLAY_CARD', seat, cardId: c });
  }
  return s;
}

function run(tricks: readonly Trick[], extra: Partial<HandState> = {}): MatchState {
  return tricks.reduce(playTrick, rig(tricks, extra));
}

function handEnded(s: MatchState) {
  const e = s.events.filter((x) => x.type === 'HAND_ENDED');
  expect(e).toHaveLength(1);
  return (e[0] as Extract<GameEvent, { type: 'HAND_ENDED' }>).result;
}

const roundsEnded = (s: MatchState) => s.events.filter((e) => e.type === 'ROUND_ENDED').length;

// ---------------------------------------------------------------------------
// Cenários (cartas escolhidas para respeitar a maior carta nas vazas de desempate)
// ---------------------------------------------------------------------------

/** 1ª cangada: K de A (assento 0) e K de B (assento 1) — quem cangou foi o assento 1. */
const T1_TIE: Trick = [
  [0, 'KO'],
  [1, 'KP'],
  [2, '4O'],
  [3, '4C'],
];
/** 1ª para A (3 do assento 0). */
const T1_A: Trick = [
  [0, '3O'],
  [1, '2P'],
  [2, '4O'],
  [3, '4C'],
];
/** 1ª para B (3 do assento 1). */
const T1_B: Trick = [
  [0, '2O'],
  [1, '3P'],
  [2, '4O'],
  [3, '4C'],
];

const SCENARIOS: Record<string, readonly Trick[]> = {
  // --- normais -------------------------------------------------------------
  'A/A': [
    T1_A,
    [
      [0, '3E'],
      [1, '5C'],
      [2, '5O'],
      [3, '6C'],
    ],
  ],
  'B/B': [
    T1_B,
    [
      [1, '3C'],
      [2, '5O'],
      [3, '6C'],
      [0, '5E'],
    ],
  ],
  'A/B/A': [
    T1_A,
    [
      [0, '5O'],
      [1, '3P'],
      [2, '6O'],
      [3, '5C'],
    ],
    [
      [1, 'KP'],
      [2, '3E'],
      [3, '6C'],
      [0, '5E'],
    ],
  ],
  'A/B/B': [
    T1_A,
    [
      [0, '5O'],
      [1, '3P'],
      [2, '6O'],
      [3, '5C'],
    ],
    [
      [1, '3C'],
      [2, 'KO'],
      [3, '6C'],
      [0, '5E'],
    ],
  ],
  'B/A/A': [
    T1_B,
    [
      [1, '5P'],
      [2, '3O'],
      [3, '5C'],
      [0, '6O'],
    ],
    [
      [2, '3E'],
      [3, 'KP'],
      [0, '5E'],
      [1, '6C'],
    ],
  ],
  'B/A/B': [
    T1_B,
    [
      [1, '5P'],
      [2, '3O'],
      [3, '5C'],
      [0, '6O'],
    ],
    [
      [2, 'KO'],
      [3, '3C'],
      [0, '5E'],
      [1, '6C'],
    ],
  ],
  // --- cango depois de a 1ª ter vencedor -----------------------------------
  'A/TIE': [
    T1_A,
    [
      [0, 'KO'],
      [1, 'KP'],
      [2, '5E'],
      [3, '6C'],
    ],
  ],
  'B/TIE': [
    T1_B,
    [
      [1, 'KP'],
      [2, 'KO'],
      [3, '6C'],
      [0, '5E'],
    ],
  ],
  'A/B/TIE': [
    T1_A,
    [
      [0, '5O'],
      [1, '3P'],
      [2, '6O'],
      [3, '5C'],
    ],
    [
      [1, 'KP'],
      [2, 'KO'],
      [3, '6C'],
      [0, '5E'],
    ],
  ],
  'B/A/TIE': [
    T1_B,
    [
      [1, '5P'],
      [2, '3O'],
      [3, '5C'],
      [0, '6O'],
    ],
    [
      [2, 'KO'],
      [3, 'KP'],
      [0, '5E'],
      [1, '6C'],
    ],
  ],
  // --- 1ª cangada: desempate ------------------------------------------------
  'TIE/A': [
    T1_TIE,
    [
      [1, '2P'],
      [2, '3O'],
      [3, '6C'],
      [0, '5O'],
    ],
  ],
  'TIE/B': [
    T1_TIE,
    [
      [1, '3P'],
      [2, '2O'],
      [3, '6C'],
      [0, '5O'],
    ],
  ],
  'TIE/TIE/A': [
    T1_TIE,
    // Desempate: o assento 2 iguala o 2 do assento 1 → cangou de novo, o assento 2 abre a 3ª.
    [
      [1, '2P'],
      [2, '2O'],
      [3, '6C'],
      [0, '5O'],
    ],
    [
      [2, 'JO'],
      [3, '5C'],
      [0, '4E'],
      [1, 'QP'],
    ],
  ],
  'TIE/TIE/B': [
    T1_TIE,
    [
      [1, '2P'],
      [2, '2O'],
      [3, '6C'],
      [0, '5O'],
    ],
    [
      [2, 'JO'],
      [3, '5C'],
      [0, '4E'],
      [1, 'KC'],
    ],
  ],
  'TIE/TIE/TIE': [
    T1_TIE,
    [
      [1, '2P'],
      [2, '2O'],
      [3, 'KE'],
      [0, '5O'],
    ],
    [
      [2, 'JO'],
      [3, 'JC'],
      [0, '4E'],
      [1, 'QP'],
    ],
  ],
};

// ---------------------------------------------------------------------------
// resolveHand: matrizes obrigatórias
// ---------------------------------------------------------------------------

describe('resolveHand — matriz normal', () => {
  it.each<[TrickOutcome[], 0 | 1]>([
    [[A, A], A],
    [[B, B], B],
    [[A, B, A], A],
    [[A, B, B], B],
    [[B, A, A], A],
    [[B, A, B], B],
  ])('%j → %s', (outcomes, winner) => {
    expect(resolveHand(outcomes)).toEqual({ status: 'WINNER', winner, decidedBy: 'TWO_TRICKS' });
  });

  it('continua enquanto não há decisão', () => {
    expect(resolveHand([])).toEqual({ status: 'CONTINUE', tieBreak: false });
    expect(resolveHand([A])).toEqual({ status: 'CONTINUE', tieBreak: false });
    expect(resolveHand([B])).toEqual({ status: 'CONTINUE', tieBreak: false });
    expect(resolveHand([A, B])).toEqual({ status: 'CONTINUE', tieBreak: false });
    expect(resolveHand([B, A])).toEqual({ status: 'CONTINUE', tieBreak: false });
  });
});

describe('resolveHand — matriz de cango', () => {
  it.each<[TrickOutcome[], 0 | 1, string]>([
    [[A, TIE], A, 'FIRST_TRICK_ADVANTAGE'],
    [[B, TIE], B, 'FIRST_TRICK_ADVANTAGE'],
    [[A, B, TIE], A, 'FIRST_TRICK_ADVANTAGE'],
    [[B, A, TIE], B, 'FIRST_TRICK_ADVANTAGE'],
    [[TIE, A], A, 'CANGO_TIE_BREAK'],
    [[TIE, B], B, 'CANGO_TIE_BREAK'],
    [[TIE, TIE, A], A, 'CANGO_TIE_BREAK'],
    [[TIE, TIE, B], B, 'CANGO_TIE_BREAK'],
  ])('%j → %s (%s)', (outcomes, winner, decidedBy) => {
    expect(resolveHand(outcomes)).toEqual({ status: 'WINNER', winner, decidedBy });
  });

  it('TIE/TIE/TIE → política explícita (ninguém pontua)', () => {
    expect(resolveHand([TIE, TIE, TIE])).toEqual({ status: 'ALL_TIED' });
    expect(ALL_THREE_TRICKS_TIED_POLICY).toBe('NO_POINTS');
  });

  it('1ª cangada abre desempate; 2ª cangada no desempate leva à 3ª ainda em desempate', () => {
    expect(resolveHand([TIE])).toEqual({ status: 'CONTINUE', tieBreak: true });
    expect(resolveHand([TIE, TIE])).toEqual({ status: 'CONTINUE', tieBreak: true });
  });

  it('não é "melhor de três": A/TIE e TIE/A encerram com uma vaza vencida só', () => {
    expect(resolveHand([A, TIE]).status).toBe('WINNER');
    expect(resolveHand([TIE, A]).status).toBe('WINNER');
    expect(() => resolveHand([A, B, A, B])).toThrow();
  });
});

// ---------------------------------------------------------------------------
// resolveTrick: quem cangou
// ---------------------------------------------------------------------------

describe('resolveTrick', () => {
  const p = (seat: Seat, id: string): PlayedCard => ({ seat, card: parseCardId(id) });

  it('cango entre adversários, com quem cangou identificado', () => {
    expect(resolveTrick([p(0, '3O'), p(1, '3P'), p(2, '4E'), p(3, 'QP')])).toEqual({
      outcome: TIE,
      winnerSeat: null,
      tieCausedBySeat: 1,
    });
  });

  it('um igual depois do cango não troca o autor', () => {
    expect(resolveTrick([p(0, '3O'), p(1, '3P'), p(2, '3E'), p(3, '3C')]).tieCausedBySeat).toBe(1);
  });

  it('cartas iguais da mesma dupla não são cango', () => {
    // A1 e A2 com força 10, B com 8 e 7: A vence.
    expect(resolveTrick([p(0, '3O'), p(1, 'AO'), p(2, '3E'), p(3, 'KC')])).toEqual({
      outcome: A,
      winnerSeat: 0,
      tieCausedBySeat: null,
    });
  });

  it('uma carta maior desfaz o cango, e um novo cango tem novo autor', () => {
    expect(resolveTrick([p(0, 'KO'), p(1, 'KP'), p(2, '3E'), p(3, '5C')])).toMatchObject({
      outcome: A,
      winnerSeat: 2,
    });
    expect(resolveTrick([p(0, 'KO'), p(1, 'KP'), p(2, '3E'), p(3, '3C')])).toEqual({
      outcome: TIE,
      winnerSeat: null,
      tieCausedBySeat: 3,
    });
  });

  it('manilhas nunca cangam: a hierarquia decide (7 de ouros < Espadilha < 7 de copas < Zap)', () => {
    expect(resolveTrick([p(0, '7O'), p(1, 'AE'), p(2, '4E'), p(3, '5C')])).toMatchObject({
      outcome: B,
      winnerSeat: 1,
    });
    // 7 de paus (comum) empata com 7 de espadas; 7 de ouros (manilha) não empata com eles.
    expect(resolveTrick([p(0, '7P'), p(1, '7E'), p(2, '4E'), p(3, '5C')]).outcome).toBe(TIE);
    expect(resolveTrick([p(0, '7P'), p(1, '7O'), p(2, '4E'), p(3, '5C')]).outcome).toBe(B);
  });

  it('é a mesma comparação que a mesa usa para "Ganhando"', () => {
    const plays = [p(0, '3O'), p(1, '3P')];
    expect(leadingPlay(plays)).toMatchObject({ tied: true, tieCausedBySeat: 1 });
  });
});

// ---------------------------------------------------------------------------
// Maior carta obrigatória
// ---------------------------------------------------------------------------

describe('maior carta', () => {
  const ids = (list: string[]) => highestCards(list.map(parseCardId)).map(cardId);

  it('usa a hierarquia real do Truco Mineiro, não a ordem nominal', () => {
    expect(ids(['AO', '7P', '3C'])).toEqual(['3C']); // 3 > A > 7
    expect(ids(['3O', '7O', 'KP'])).toEqual(['7O']); // Pica-fumo é manilha
    expect(ids(['AE', '3P', '2C'])).toEqual(['AE']); // Espadilha é manilha
    expect(ids(['AO', 'AP', 'KC'])).toEqual(['AO', 'AP']); // dois Ás comuns valem igual
    expect(ids(['4P', '7C', '3O'])).toEqual(['4P']); // Zap
    expect(ids(['QO', 'JO', 'KO'])).toEqual(['KO']); // K > J > Q
    expect(ids([])).toEqual([]);
    expect(highestCard([])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Motor: fluxo completo de cada cenário
// ---------------------------------------------------------------------------

describe('motor — resolução da mão por cenário', () => {
  const expected: Record<string, { winner: 0 | 1 | null; tricks: number; decidedBy?: string }> = {
    'A/A': { winner: A, tricks: 2, decidedBy: 'TWO_TRICKS' },
    'B/B': { winner: B, tricks: 2, decidedBy: 'TWO_TRICKS' },
    'A/B/A': { winner: A, tricks: 3, decidedBy: 'TWO_TRICKS' },
    'A/B/B': { winner: B, tricks: 3, decidedBy: 'TWO_TRICKS' },
    'B/A/A': { winner: A, tricks: 3, decidedBy: 'TWO_TRICKS' },
    'B/A/B': { winner: B, tricks: 3, decidedBy: 'TWO_TRICKS' },
    'A/TIE': { winner: A, tricks: 2, decidedBy: 'FIRST_TRICK_ADVANTAGE' },
    'B/TIE': { winner: B, tricks: 2, decidedBy: 'FIRST_TRICK_ADVANTAGE' },
    'A/B/TIE': { winner: A, tricks: 3, decidedBy: 'FIRST_TRICK_ADVANTAGE' },
    'B/A/TIE': { winner: B, tricks: 3, decidedBy: 'FIRST_TRICK_ADVANTAGE' },
    'TIE/A': { winner: A, tricks: 2, decidedBy: 'CANGO_TIE_BREAK' },
    'TIE/B': { winner: B, tricks: 2, decidedBy: 'CANGO_TIE_BREAK' },
    'TIE/TIE/A': { winner: A, tricks: 3, decidedBy: 'CANGO_TIE_BREAK' },
    'TIE/TIE/B': { winner: B, tricks: 3, decidedBy: 'CANGO_TIE_BREAK' },
    'TIE/TIE/TIE': { winner: null, tricks: 3 },
  };

  it.each(Object.keys(expected))('%s', (name) => {
    const exp = expected[name]!;
    const s = run(SCENARIOS[name]!);
    const result = handEnded(s);
    expect(result.winner).toBe(exp.winner);
    // Nenhuma vaza a mais: a mão acaba exatamente na vaza que a decide.
    expect(roundsEnded(s)).toBe(exp.tricks);
    if (exp.winner === null) {
      expect(result).toEqual({ winner: null, points: 0, reason: 'ALL_TIED' });
      expect(s.scores).toEqual([0, 0]);
    } else {
      expect(result).toEqual({
        winner: exp.winner,
        points: 1,
        reason: 'ROUNDS',
        decidedBy: exp.decidedBy,
      });
      const scores = [0, 0];
      scores[exp.winner] = 1;
      expect(s.scores).toEqual(scores);
    }
    // Uma única pontuação, e a mão seguinte começa limpa.
    expect(s.handsPlayed).toBe(1);
    expect(s.hand.number).toBe(2);
    expect(s.hand.tieBreak).toBeNull();
    expect(s.hand.rounds).toEqual([]);
  });

  it.each([
    ['TIE/A', A],
    ['A/TIE', A],
    ['TIE/TIE/B', B],
    ['A/B/TIE', A],
    ['B/A/TIE', B],
  ] as const)('%s pontua o valor da mão (1, 3, 6, 9, 12)', (name, winner) => {
    for (const value of [1, 3, 6, 9, 12]) {
      const s = run(SCENARIOS[name]!, { value });
      expect(handEnded(s).points).toBe(value);
      expect(s.scores[winner]).toBe(value);
      expect(s.scores[winner === A ? B : A]).toBe(0);
    }
  });

  it('a mão acaba na vaza decisiva mesmo com cartas sobrando (A/TIE e TIE/A não jogam a 3ª)', () => {
    for (const name of ['A/TIE', 'TIE/A', 'TIE/B', 'B/TIE']) {
      const tricks = SCENARIOS[name]!;
      // Dá uma terceira carta a todos: se o motor jogasse a 3ª, ela seria usada.
      const extraCard: Record<number, string> = { 0: '4E', 1: '7P', 2: 'QE', 3: '5P' };
      const s0 = rig(tricks);
      const hands = s0.hand.hands.map((h, seat) => [...h, parseCardId(extraCard[seat]!)]);
      let s: MatchState = { ...s0, hand: { ...s0.hand, hands } };
      // No desempate a maior carta ainda é a planejada: as extras são mais fracas.
      s = tricks.reduce(playTrick, s);
      expect(roundsEnded(s)).toBe(2);
      expect(s.hand.number).toBe(2);
    }
  });
});

// ---------------------------------------------------------------------------
// Motor: estado de desempate
// ---------------------------------------------------------------------------

describe('motor — desempate depois da 1ª cangada', () => {
  const afterTie = () => playTrick(rig(SCENARIOS['TIE/TIE/A']!), T1_TIE);

  it('entra em desempate: quem cangou abre e o evento anuncia', () => {
    const s = afterTie();
    expect(s.hand.phase).toBe('PLAY');
    expect(s.hand.tieBreak).toEqual({ causedBySeat: 1, round: 1 });
    expect(s.hand.turnSeat).toBe(1);
    expect(s.hand.roundLeader).toBe(1);
    expect(s.hand.rounds[0]).toMatchObject({ winner: null, winnerSeat: 1 });
    expect(s.events.slice(-2)).toEqual([
      { type: 'ROUND_ENDED', round: 0, winner: null, winnerSeat: 1 },
      { type: 'TIE_BREAK_STARTED', round: 1, leadSeat: 1, continued: false },
    ]);
  });

  it('só a maior carta é aceita; a menor é rejeitada sem mudar nada', () => {
    const s = afterTie();
    // Assento 1 tem 2P e QP: só o 2 vale.
    expect(playableCards(s, 1).map(cardId)).toEqual(['2P']);
    let err: unknown;
    try {
      applyAction(s, { type: 'PLAY_CARD', seat: 1, cardId: 'QP' });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(InvalidActionError);
    expect((err as Error).message).toContain('MUST_PLAY_HIGHEST_CARD');
    // O estado é imutável: nada avançou, a vez continua com o assento 1 e a ação segue liberada.
    expect(s.hand.turnSeat).toBe(1);
    expect(s.hand.currentRound).toEqual([]);
    expect(getAvailableActions(s, 1)).toContain('PLAY_CARD');
    expect(() => applyAction(s, { type: 'PLAY_CARD', seat: 1, cardId: '2P' })).not.toThrow();
  });

  it('todos os jogadores, na ordem da mesa a partir de quem abre, jogam a maior carta', () => {
    let s = afterTie();
    const order: Seat[] = [];
    for (let i = 0; i < 4; i++) {
      const seat = s.hand.turnSeat;
      order.push(seat);
      const hand = s.hand.hands[seat]!;
      const max = Math.max(...hand.map(cardStrength));
      for (const c of hand) {
        const action = { type: 'PLAY_CARD' as const, seat, cardId: cardId(c) };
        if (cardStrength(c) < max) expect(() => applyAction(s, action)).toThrow(InvalidActionError);
      }
      s = applyAction(s, {
        type: 'PLAY_CARD',
        seat,
        cardId: cardId(highestCard(hand)!),
      });
    }
    expect(order).toEqual([1, 2, 3, 0]);
  });

  it('com duas cartas de mesma força máxima, qualquer uma delas vale', () => {
    const s0 = afterTie();
    const hands = s0.hand.hands.map((h, i) => (i === 1 ? ['3P', '3C', '4E'].map(parseCardId) : h));
    const s = { ...s0, hand: { ...s0.hand, hands } };
    expect(playableCards(s, 1).map(cardId)).toEqual(['3P', '3C']);
    expect(() => applyAction(s, { type: 'PLAY_CARD', seat: 1, cardId: '3C' })).not.toThrow();
    expect(() => applyAction(s, { type: 'PLAY_CARD', seat: 1, cardId: '3P' })).not.toThrow();
    expect(() => applyAction(s, { type: 'PLAY_CARD', seat: 1, cardId: '4E' })).toThrow();
  });

  it('no desempate a carta sai aberta: todos veem a maior carta jogada', () => {
    const s = applyAction(afterTie(), { type: 'PLAY_CARD', seat: 1, cardId: '2P' });
    for (const seat of [0, 1, 2, 3] as Seat[]) {
      expect(viewForSeat(s, seat).currentRound).toEqual([
        { seat: 1, card: parseCardId('2P'), covered: false },
      ]);
    }
  });

  it('cangou de novo: a 3ª continua em desempate, aberta por quem cangou a 2ª', () => {
    const tricks = SCENARIOS['TIE/TIE/A']!;
    const s = playTrick(afterTie(), tricks[1]!);
    expect(s.hand.tieBreak).toEqual({ causedBySeat: 2, round: 2 });
    expect(s.hand.turnSeat).toBe(2);
    expect(s.events[s.events.length - 1]).toEqual({
      type: 'TIE_BREAK_STARTED',
      round: 2,
      leadSeat: 2,
      continued: true,
    });
    expect(playableCards(s, 2).map(cardId)).toEqual(['JO']);
  });

  it.each([0, 1, 2, 3] as Seat[])(
    'o assento %s provoca o cango e abre a vaza seguinte, na ordem circular',
    (causer) => {
      // O adversário à direita de quem cangou abre a 1ª com um K; quem cangou joga outro K.
      const leader = ((causer + 3) % 4) as Seat;
      const lows = ['4O', '4C', '5O', '5C'];
      const t1: Trick = [
        [leader, 'KO'],
        [causer, 'KP'],
        [((causer + 1) % 4) as Seat, lows[0]!],
        [((causer + 2) % 4) as Seat, lows[1]!],
      ];
      const s0 = rig([t1], { roundLeader: leader, turnSeat: leader });
      // Uma carta a mais para cada um, para a 2ª vaza existir.
      const second: Record<number, string> = { 0: '6O', 1: '6P', 2: '6E', 3: '6C' };
      const hands = s0.hand.hands.map((h, seat) => [...h, parseCardId(second[seat]!)]);
      let s = playTrick({ ...s0, hand: { ...s0.hand, hands } }, t1);
      expect(s.hand.tieBreak?.causedBySeat).toBe(causer);
      const order: Seat[] = [];
      for (let i = 0; i < 4; i++) {
        const seat = s.hand.turnSeat;
        order.push(seat);
        s = applyAction(s, { type: 'PLAY_CARD', seat, cardId: second[seat]! });
      }
      expect(order).toEqual([0, 1, 2, 3].map((k) => ((causer + k) % 4) as Seat));
    },
  );

  it('a view expõe o desempate a todos e as cartas válidas só ao dono', () => {
    const s = afterTie();
    for (const seat of [0, 1, 2, 3] as Seat[]) {
      const v = viewForSeat(s, seat);
      expect(v.tieBreak).toEqual({ causedBySeat: 1, round: 1 });
      expect(v.playableCardIds).toEqual(playableCards(s, seat).map(cardId));
      expect(v.playableCardIds.every((id) => v.myCards.map(cardId).includes(id))).toBe(true);
    }
    // Fora do desempate, todas as cartas valem.
    const normal = viewForSeat(dealt(), 0);
    expect(normal.tieBreak).toBeNull();
    expect(normal.playableCardIds).toEqual(normal.myCards.map(cardId));
  });

  it('truco durante o desempate segue a regra normal, e a maior carta continua obrigatória', () => {
    let s = afterTie();
    // Sem carta virada no desempate; o truco segue a regra normal.
    expect(getAvailableActions(s, 1)).toEqual(['PLAY_CARD', 'REQUEST_TRUCO']);
    s = applyAction(s, { type: 'REQUEST_TRUCO', seat: 1 });
    expect(s.hand.tieBreak).not.toBeNull();
    s = applyAction(s, { type: 'RAISE', seat: 2 }); // Seis
    s = applyAction(s, { type: 'ACCEPT_TRUCO', seat: 3 });
    expect(s.hand.value).toBe(6);
    expect(s.hand.turnSeat).toBe(1);
    expect(() => applyAction(s, { type: 'PLAY_CARD', seat: 1, cardId: 'QP' })).toThrow(
      /MUST_PLAY_HIGHEST_CARD/,
    );
    // Segue TIE/TIE/A: A leva os 6.
    const tricks = SCENARIOS['TIE/TIE/A']!;
    s = playTrick(playTrick(s, tricks[1]!), tricks[2]!);
    expect(handEnded(s)).toMatchObject({ winner: A, points: 6, decidedBy: 'CANGO_TIE_BREAK' });
    expect(s.scores).toEqual([6, 0]);
  });

  it('correr no desempate encerra a mão pelo truco, sem vazar desempate para a próxima', () => {
    let s = afterTie();
    s = applyAction(s, { type: 'REQUEST_TRUCO', seat: 1 });
    s = applyAction(s, { type: 'RUN', seat: 0 });
    expect(handEnded(s)).toEqual({ winner: B, points: 1, reason: 'RUN' });
    expect(s.hand.number).toBe(2);
    expect(s.hand.tieBreak).toBeNull();
  });

  it('depois de uma mão decidida no desempate, a próxima mão é normal', () => {
    let s = run(SCENARIOS['TIE/A']!);
    expect(s.hand.tieBreak).toBeNull();
    s = skipCeremony(s);
    expect(s.hand.tieBreak).toBeNull();
    const seat = s.hand.turnSeat;
    const v = viewForSeat(s, seat);
    expect(v.playableCardIds).toHaveLength(3);
    // Qualquer carta pode abrir a mão nova (inclusive a mais fraca).
    const weakest = [...s.hand.hands[seat]!].sort((a, b) => cardStrength(a) - cardStrength(b))[0]!;
    expect(() =>
      applyAction(s, { type: 'PLAY_CARD', seat, cardId: cardId(weakest) }),
    ).not.toThrow();
  });

  it('a 4ª carta repetida (retry) é rejeitada e não pontua de novo', () => {
    const tricks = SCENARIOS['TIE/A']!;
    const beforeLast = playTrick(playTrick(rig(tricks), tricks[0]!), tricks[1]!.slice(0, 3));
    const last = tricks[1]![3]!;
    const action = { type: 'PLAY_CARD' as const, seat: last[0], cardId: last[1] };
    const done = applyAction(beforeLast, action);
    expect(done.scores).toEqual([1, 0]);
    expect(() => applyAction(done, action)).toThrow(InvalidActionError);
  });
});

// ---------------------------------------------------------------------------
// IA
// ---------------------------------------------------------------------------

describe('IA no desempate', () => {
  const afterTie = () => playTrick(rig(SCENARIOS['TIE/TIE/A']!), T1_TIE);

  it.each<AIDifficulty>(['easy', 'normal', 'hard'])(
    '%s: joga exatamente a maior carta, em qualquer assento',
    (difficulty) => {
      const ai = aiForDifficulty(difficulty);
      const seats = new Map<Seat, AIPlayer>(
        [0, 1, 2, 3].map((x) => [x as Seat, ai] as [Seat, AIPlayer]),
      );
      let s = afterTie();
      const rng = createRng(42);
      for (let i = 0; i < 4; i++) {
        const seat = s.hand.turnSeat;
        const action = nextAIAction(s, seats, rng)!;
        expect(action).toEqual({
          type: 'PLAY_CARD',
          seat,
          cardId: cardId(highestCard(s.hand.hands[seat]!)!),
        });
        s = applyAction(s, action);
      }
    },
  );

  it.each<AIDifficulty>(['easy', 'normal', 'hard'])(
    '%s: em partidas inteiras IA x IA, toda jogada de desempate é a maior carta',
    (difficulty) => {
      const ai = aiForDifficulty(difficulty);
      const seats = new Map<Seat, AIPlayer>(
        [0, 1, 2, 3].map((x) => [x as Seat, ai] as [Seat, AIPlayer]),
      );
      let tieBreakPlays = 0;
      for (let seed = 1; seed <= 60; seed++) {
        let s = createMatch(seed);
        const rng = createRng(seed * 7 + 1);
        for (let step = 0; step < 3000 && s.status === 'PLAYING'; step++) {
          const action = nextAIAction(s, seats, rng);
          if (!action) throw new Error('IA sem ação');
          if (action.type === 'PLAY_CARD' && s.hand.tieBreak) {
            const hand = s.hand.hands[action.seat]!;
            const max = Math.max(...hand.map(cardStrength));
            expect(cardStrength(parseCardId(action.cardId))).toBe(max);
            tieBreakPlays++;
          }
          s = applyAction(s, action);
        }
        expect(s.status).toBe('FINISHED');
      }
      // Os seeds cobrem desempates de verdade (senão o teste não provaria nada).
      expect(tieBreakPlays).toBeGreaterThan(0);
    },
  );
});
