import { cardId, parseCardId } from '../cards/card';
import { COVERED_CARD_STRENGTH, leadingPlay, playStrength } from '../rules/strength';
import { resolveTrick } from '../rules/hand';
import {
  applyAction,
  createMatch,
  eventsForSeat,
  getAvailableActions,
  InvalidActionError,
  skipCeremony,
  viewForSeat,
} from '../engine/engine';
import { createRng } from '../engine/rng';
import { aiForDifficulty, type AIDifficulty, type AIPlayer } from '../ai/ai';
import { nextAIAction } from '../ai/driver';
import type { GameAction, HandState, MatchState, PlayedCard, Seat } from '../state/types';

/**
 * Carta virada ("no escuro"): vale menos que qualquer carta aberta, some da mão certa, e a
 * identidade nunca chega a quem não a jogou. Times: A = assentos 0 e 2, B = assentos 1 e 3.
 */

const dealt = () => skipCeremony(createMatch(3, 99));

/**
 * Carta virada só vale a partir da segunda rodada da mão: os cenários abaixo partem de uma mão
 * com a primeira rodada já decidida (`winner`), com o assento 0 abrindo a vaza atual.
 */
const afterFirstRound = (winner: 0 | 1): Partial<HandState> => ({
  rounds: [{ winner, winnerSeat: winner === 0 ? 0 : 1, plays: [] }],
});

function rig(hands: string[][], extra: Partial<HandState> = {}): MatchState {
  const s = dealt();
  return { ...s, hand: { ...s.hand, hands: hands.map((h) => h.map(parseCardId)), ...extra } };
}

type Move = [Seat, string, 'open' | 'covered'];
function play(state: MatchState, moves: Move[]): MatchState {
  let s = state;
  for (const [seat, id, how] of moves) {
    const action: GameAction =
      how === 'covered'
        ? { type: 'PLAY_CARD_COVERED', seat, cardId: id }
        : { type: 'PLAY_CARD', seat, cardId: id };
    s = applyAction(s, action);
  }
  return s;
}

const p = (seat: Seat, id: string, covered = false): PlayedCard =>
  covered ? { seat, card: parseCardId(id), covered: true } : { seat, card: parseCardId(id) };

describe('força efetiva da carta virada', () => {
  it('é menor que qualquer carta aberta, inclusive o 4 comum', () => {
    expect(COVERED_CARD_STRENGTH).toBe(0);
    expect(playStrength(p(0, '4P', true))).toBe(0); // Zap virado
    expect(playStrength(p(0, '4O'))).toBeGreaterThan(COVERED_CARD_STRENGTH);
  });

  it('carta fraca virada perde', () => {
    expect(
      resolveTrick([p(0, '5O', true), p(1, '4O'), p(2, '4E', true), p(3, '6C', true)]),
    ).toMatchObject({ outcome: 1, winnerSeat: 1 });
  });

  it('manilha virada perde para uma carta aberta comum', () => {
    expect(
      resolveTrick([p(0, '4P', true), p(1, '5C'), p(2, '7C', true), p(3, '6E')]),
    ).toMatchObject({
      outcome: 1,
      winnerSeat: 3,
    });
  });

  it('a carta aberta mais fraca vence a maior carta do jogo virada', () => {
    expect(
      resolveTrick([p(0, '4P', true), p(1, '4O'), p(2, 'AE', true), p(3, '7C', true)]),
    ).toMatchObject({ outcome: 1, winnerSeat: 1 });
  });

  it('cartas viradas de equipes opostas como maiores forças cangam; a identidade real não desempata', () => {
    // Zap virado (A) contra 5 virado (B): ninguém tem carta aberta — cango, causado pelo assento 1.
    expect(
      resolveTrick([p(0, '4P', true), p(1, '5C', true), p(2, 'QO', true), p(3, 'JE', true)]),
    ).toEqual({
      outcome: 'TIE',
      winnerSeat: null,
      tieCausedBySeat: 1,
    });
  });

  it('virada da mesma dupla não é cango', () => {
    expect(
      resolveTrick([p(0, '4P', true), p(1, '5C', true), p(2, 'QO'), p(3, 'JE', true)]),
    ).toMatchObject({
      outcome: 0,
      winnerSeat: 2,
    });
  });

  it('carta virada nunca aparece como a que está ganhando para a mesa', () => {
    const lead = leadingPlay([{ seat: 0, card: null, covered: true }]);
    expect(lead).toMatchObject({ seat: 0, covered: true });
  });
});

describe('motor — jogar virada', () => {
  const HANDS = [
    ['4P', '5O', '6O'], // A — Zap
    ['4O', '5C', '6C'],
    ['7C', '5E', '6E'], // A — Copeta
    ['QP', '5P', '6P'],
  ];

  it('a ação aparece em availableActions só para quem está na vez', () => {
    const s = rig(HANDS, afterFirstRound(0));
    expect(getAvailableActions(s, 0)).toEqual(['PLAY_CARD', 'PLAY_CARD_COVERED', 'REQUEST_TRUCO']);
    expect(getAvailableActions(s, 1)).toEqual([]);
  });

  it('remove a carta certa da mão e guarda a identidade só no estado autoritativo', () => {
    const s = play(rig(HANDS, afterFirstRound(0)), [[0, '4P', 'covered']]);
    expect(s.hand.hands[0]!.map(cardId)).toEqual(['5O', '6O']);
    expect(s.hand.currentRound).toEqual([{ seat: 0, card: parseCardId('4P'), covered: true }]);
    expect(s.events[s.events.length - 1]).toEqual({
      type: 'CARD_PLAYED',
      seat: 0,
      card: parseCardId('4P'),
      covered: true,
    });
  });

  it('Zap virado perde a vaza para um 4 aberto', () => {
    const s = play(rig(HANDS, afterFirstRound(0)), [
      [0, '4P', 'covered'],
      [1, '4O', 'open'],
      [2, '7C', 'covered'],
      [3, 'QP', 'open'],
    ]);
    expect(s.hand.rounds[1]).toMatchObject({ winner: 1, winnerSeat: 3 });
    expect(s.hand.turnSeat).toBe(3);
  });

  it('carta que não está na mão continua recusada, virada ou não', () => {
    const s = rig(HANDS, afterFirstRound(0));
    expect(() => play(s, [[0, '4O', 'covered']])).toThrow(InvalidActionError);
    expect(() => play(s, [[1, '4O', 'covered']])).toThrow(InvalidActionError);
  });

  it('é proibida em toda a primeira rodada da mão, no motor e em availableActions', () => {
    let s = rig(HANDS);
    expect(s.hand.rounds).toHaveLength(0);
    for (const [seat, id] of [
      [0, '4P'],
      [1, '4O'],
      [2, '7C'],
      [3, 'QP'],
    ] as [Seat, string][]) {
      expect(getAvailableActions(s, seat)).not.toContain('PLAY_CARD_COVERED');
      expect(viewForSeat(s, seat).availableActions).not.toContain('PLAY_CARD_COVERED');
      expect(() => play(s, [[seat, id, 'covered']])).toThrow(/PLAY_CARD_COVERED not allowed/);
      s = play(s, [[seat, id, 'open']]);
    }
    // Fechada a primeira rodada, quem abre a segunda já pode jogar virada.
    expect(s.hand.rounds).toHaveLength(1);
    expect(getAvailableActions(s, s.hand.turnSeat)).toContain('PLAY_CARD_COVERED');
    const card = cardId(s.hand.hands[s.hand.turnSeat]![0]!);
    const next = play(s, [[s.hand.turnSeat, card, 'covered']]);
    expect(next.hand.currentRound[0]).toMatchObject({ covered: true });
  });

  it('é proibida no desempate por cango, no motor e em availableActions', () => {
    const s = rig(
      [
        ['KO', '5O'],
        ['KP', '2P'],
        ['4O', '3O'],
        ['4C', '6C'],
      ],
      {},
    );
    const tie = play(s, [
      [0, 'KO', 'open'],
      [1, 'KP', 'open'],
      [2, '4O', 'open'],
      [3, '4C', 'open'],
    ]);
    expect(tie.hand.tieBreak).not.toBeNull();
    expect(getAvailableActions(tie, 1)).not.toContain('PLAY_CARD_COVERED');
    expect(() => play(tie, [[1, '2P', 'covered']])).toThrow(InvalidActionError);
    // Nem a maior carta pode sair virada.
    expect(() => play(tie, [[1, '2P', 'covered']])).toThrow(/PLAY_CARD_COVERED not allowed/);
    expect(viewForSeat(tie, 1).availableActions).not.toContain('PLAY_CARD_COVERED');
  });

  it('fora do desempate o cango é resolvido pelas forças efetivas', () => {
    // K aberto (A) x K virado (B) não canga: o virado vale zero e A leva.
    const s = play(
      rig(
        [
          ['KO', '5O'],
          ['KP', '5C'],
          ['4E', '5E'],
          ['4C', '5P'],
        ],
        afterFirstRound(1),
      ),
      [
        [0, 'KO', 'open'],
        [1, 'KP', 'covered'],
        [2, '4E', 'open'],
        [3, '4C', 'open'],
      ],
    );
    expect(s.hand.rounds[1]?.winner).toBe(0);
  });
});

describe('segredo da carta virada', () => {
  const s = play(
    rig(
      [
        ['4P', '5O', '6O'],
        ['4O', '5C', '6C'],
        ['7C', '5E', '6E'],
        ['QP', '5P', '6P'],
      ],
      afterFirstRound(1),
    ),
    [
      [0, '4P', 'covered'],
      [1, '4O', 'open'],
    ],
  );

  it('a view de quem não jogou não contém a identidade', () => {
    for (const seat of [1, 2, 3] as Seat[]) {
      const v = viewForSeat(s, seat);
      expect(v.currentRound[0]).toEqual({ seat: 0, card: null, covered: true });
      expect(JSON.stringify(v)).not.toMatch(/"rank":"4","suit":"paus"/);
    }
  });

  it('nem o parceiro vê', () => {
    expect(viewForSeat(s, 2).currentRound[0]?.card).toBeNull();
  });

  it('quem jogou vê a própria carta, marcada como virada', () => {
    expect(viewForSeat(s, 0).currentRound[0]).toEqual({
      seat: 0,
      card: parseCardId('4P'),
      covered: true,
    });
  });

  it('os eventos de cada assento também escondem a carta', () => {
    for (const seat of [1, 2, 3] as Seat[]) {
      const played = eventsForSeat(s.events, seat).filter((e) => e.type === 'CARD_PLAYED');
      expect(played[0]).toEqual({ type: 'CARD_PLAYED', seat: 0, card: null, covered: true });
      // Carta aberta continua aberta para todos.
      expect(played[1]).toEqual({ type: 'CARD_PLAYED', seat: 1, card: parseCardId('4O') });
      expect(JSON.stringify(eventsForSeat(s.events, seat))).not.toMatch(/"rank":"4","suit":"paus"/);
    }
    expect(eventsForSeat(s.events, 0).find((e) => e.type === 'CARD_PLAYED')).toMatchObject({
      card: parseCardId('4P'),
    });
  });

  it('continua escondida depois que a vaza fecha (histórico da mão)', () => {
    const closed = play(s, [
      [2, '7C', 'open'],
      [3, 'QP', 'open'],
    ]);
    const v = viewForSeat(closed, 3);
    expect(v.rounds[1]?.plays[0]).toEqual({ seat: 0, card: null, covered: true });
  });
});

describe('mão de onze recusada revela as mãos', () => {
  function atEleven(): MatchState {
    const m = createMatch(7);
    return skipCeremony({ ...m, scores: [11, 4], hand: { ...m.hand, maoDeOnzeTeam: 0 } });
  }

  it('emite HAND_REVEALED com as 12 cartas antes do fim da mão, e pontua uma vez', () => {
    const s0 = atEleven();
    expect(s0.hand.phase).toBe('MAO_DE_ONZE');
    const handsBefore = s0.hand.hands.map((h) => h.map(cardId));
    const s = applyAction(s0, { type: 'DECLINE_MAO_DE_ONZE', seat: 2 });
    const batch = s.events.slice(s0.events.length).map((e) => e.type);
    expect(batch.slice(0, 3)).toEqual(['MAO_DE_ONZE_DECLINED', 'HAND_REVEALED', 'HAND_ENDED']);
    const reveal = s.events.find((e) => e.type === 'HAND_REVEALED');
    expect(reveal).toBeDefined();
    if (reveal?.type !== 'HAND_REVEALED') throw new Error('sem revelação');
    expect(reveal.hands.map((h) => h.map(cardId))).toEqual(handsBefore);
    // Nenhuma carta repetida nem faltando.
    expect(new Set(reveal.hands.flat().map(cardId)).size).toBe(12);
    expect(s.scores).toEqual([11, 5]);
    expect(s.events.filter((e) => e.type === 'HAND_ENDED')).toHaveLength(1);
  });

  it('bot que corre na mão de onze também revela', () => {
    const ai = aiForDifficulty('easy');
    const seats = new Map<Seat, AIPlayer>(
      [0, 1, 2, 3].map((x) => [x as Seat, ai] as [Seat, AIPlayer]),
    );
    // Procura uma decisão de recusa do bot (easy decide 50/50).
    for (let seed = 1; seed < 50; seed++) {
      const s0 = atEleven();
      const action = nextAIAction(s0, seats, createRng(seed));
      if (action?.type !== 'DECLINE_MAO_DE_ONZE') continue;
      const s = applyAction(s0, action);
      expect(s.events.some((e) => e.type === 'HAND_REVEALED')).toBe(true);
      return;
    }
    throw new Error('nenhuma recusa encontrada');
  });

  it('aceitar não revela nada', () => {
    const s = applyAction(atEleven(), { type: 'ACCEPT_MAO_DE_ONZE', seat: 0 });
    expect(s.events.some((e) => e.type === 'HAND_REVEALED')).toBe(false);
  });
});

describe('IA e carta virada', () => {
  it.each<AIDifficulty>(['easy', 'normal', 'hard'])(
    '%s: só vira quando permitido, nunca na primeira rodada, nunca ao abrir a vaza e nunca tudo',
    (difficulty) => {
      const ai = aiForDifficulty(difficulty);
      const seats = new Map<Seat, AIPlayer>(
        [0, 1, 2, 3].map((x) => [x as Seat, ai] as [Seat, AIPlayer]),
      );
      let covered = 0;
      let plays = 0;
      for (let seed = 1; seed <= 40; seed++) {
        let s = createMatch(seed);
        const rng = createRng(seed * 13 + 5);
        while (s.status === 'PLAYING') {
          const action = nextAIAction(s, seats, rng)!;
          if (action.type === 'PLAY_CARD' || action.type === 'PLAY_CARD_COVERED') plays++;
          if (action.type === 'PLAY_CARD_COVERED') {
            covered++;
            expect(s.hand.tieBreak).toBeNull();
            expect(s.hand.rounds.length).toBeGreaterThan(0);
            expect(s.hand.currentRound.length).toBeGreaterThan(0);
          }
          s = applyAction(s, action);
        }
      }
      if (difficulty === 'easy') expect(covered).toBe(0);
      else {
        expect(covered).toBeGreaterThan(0);
        expect(covered / plays).toBeLessThan(0.3);
      }
    },
  );
});
