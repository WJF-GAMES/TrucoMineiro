import { applyAction, createMatch, parseCardId, viewForSeat, skipCeremony } from '@/domain/game';
import type { GameEvent, MatchState, PlayedCard, Seat } from '@/domain/game';
import {
  EMPTY_TRICK,
  TRICK_TIMING,
  advance,
  isHolding,
  nextWakeAt,
  presentTrick,
  type TrickPresentation,
} from '../trickPresentation';

/** Mão já embaralhada e cortada: os testes de jogo começam com as cartas na mão. */
const dealt = (seed: number, targetScore?: number) => skipCeremony(createMatch(seed, targetScore));

/** Mão fixa: assento 3 (o último a jogar) fecha a vaza com a carta mais forte. */
const HANDS = [
  ['4E', '5E', '6E'], // 0
  ['4O', '5O', '6O'], // 1
  ['QP', '5P', '6P'], // 2
  ['4P', '7C', 'AE'], // 3 — Zap fecha a primeira vaza
];

function rigged(): MatchState {
  const m = dealt(1);
  return { ...m, hand: { ...m.hand, hands: HANDS.map((h) => h.map(parseCardId)) } };
}

function play(state: MatchState, cardId: string): MatchState {
  return applyAction(state, { type: 'PLAY_CARD', seat: state.hand.turnSeat, cardId });
}

/** Emula o controlador: a view e o lote de eventos novos desde a última ação. */
function step(prev: TrickPresentation, before: MatchState, after: MatchState, now = 1_000) {
  const batch = after.events.slice(before.events.length) as GameEvent[];
  return presentTrick(prev, viewForSeat(after, 0), batch, true, now);
}

const seatsOf = (plays: PlayedCard[]) => plays.map((p) => p.seat).sort();

describe('presentTrick', () => {
  it('mostra a carta que está ganhando enquanto a vaza está aberta', () => {
    let s = rigged();
    const s1 = play(s, '4E');
    let t = step(EMPTY_TRICK, s, s1);
    expect(t.phase).toBe('open');
    expect(t.leadingSeat).toBe(0);

    s = s1;
    const s2 = play(s, '5O'); // 5 > 4: assento 1 assume
    t = step(t, s, s2);
    expect(t.leadingSeat).toBe(1);
    expect(t.plays).toHaveLength(2);
  });

  it('segura as quatro cartas com a vencedora quando o último jogador fecha a vaza', () => {
    const s0 = rigged();
    const s1 = play(s0, '4E');
    const s2 = play(s1, '5O');
    const s3 = play(s2, 'QP');
    let t = step(EMPTY_TRICK, s0, s1);
    t = step(t, s1, s2);
    t = step(t, s2, s3);
    const s4 = play(s3, '4P'); // Zap: assento 3 leva
    expect(viewForSeat(s4, 0).currentRound).toHaveLength(0); // o motor já resolveu
    t = step(t, s3, s4, 5_000);

    expect(t.phase).toBe('resolved');
    expect(seatsOf(t.plays)).toEqual([0, 1, 2, 3]);
    expect(t.plays.find((p) => p.seat === 3)?.card).toEqual(parseCardId('4P'));
    expect(t.resolved).toEqual({ winnerSeat: 3, winner: 1 });
    expect(t.leadingSeat).toBeNull();
    expect(t.handEnded).toBe(false);
    expect(isHolding(t)).toBe(true);
    expect(t.holdUntil).toBe(5_000 + TRICK_TIMING.flyMs + TRICK_TIMING.holdMs);
  });

  it('funciona para qualquer assento que feche a vaza', () => {
    for (const closer of [0, 1, 2, 3] as Seat[]) {
      // Dealer escolhido para que `closer` seja o último da vaza.
      const m = dealt(1);
      const dealer = closer;
      const first = ((dealer + 1) % 4) as Seat;
      let s: MatchState = {
        ...m,
        hand: {
          ...m.hand,
          dealerSeat: dealer,
          turnSeat: first,
          roundLeader: first,
          hands: [
            ['4E', '5E', '6E'],
            ['4O', '5O', '6O'],
            ['QP', '5P', '6P'],
            ['QO', '7C', 'AE'],
          ].map((h) => h.map(parseCardId)),
        },
      };
      let t = EMPTY_TRICK;
      for (let i = 0; i < 4; i++) {
        const next = play(s, s.hand.hands[s.hand.turnSeat]![0]!.rank + suitCode(s));
        t = step(t, s, next);
        s = next;
      }
      expect(t.phase).toBe('resolved');
      expect(seatsOf(t.plays)).toEqual([0, 1, 2, 3]);
      expect(t.plays.find((p) => p.seat === closer)).toBeDefined();
    }
  });

  it('reconstrói a última vaza da mão quando a view já é da mão seguinte', () => {
    // Mão de duas vazas: 3 leva as duas com manilhas.
    const s0 = rigged();
    let s = s0;
    let t = EMPTY_TRICK;
    for (const c of ['4E', '5O', 'QP', '4P']) {
      const n = play(s, c);
      t = step(t, s, n);
      s = n;
    }
    t = advance(t, 999_999); // recolhe
    t = advance(t, 999_999);
    expect(t).toBe(EMPTY_TRICK);
    // 3 lidera a segunda vaza
    for (const c of ['7C', '5E', '6O', '5P']) {
      const before = s;
      s = play(s, c);
      t = step(t, before, s, 10_000);
    }
    expect(s.hand.number).toBe(2); // mão nova já começou
    expect(t.phase).toBe('resolved');
    expect(t.handEnded).toBe(true);
    expect(seatsOf(t.plays)).toEqual([0, 1, 2, 3]);
    expect(t.plays.find((p) => p.seat === 3)?.card).toEqual(parseCardId('7C'));
  });

  it('não segura nada na reconexão quando já há carta nova na mesa', () => {
    const s0 = rigged();
    let s = s0;
    for (const c of ['4E', '5O', 'QP', '4P', '7C']) s = play(s, c);
    const batch = s.events as GameEvent[]; // lote inteiro, como um rejoin
    const t = presentTrick(EMPTY_TRICK, viewForSeat(s, 0), batch, true, 0);
    expect(t.phase).toBe('open');
    expect(t.plays).toHaveLength(1);
  });

  it('avança segurando → recolhendo → vazio pelo relógio', () => {
    const s0 = rigged();
    let s = s0;
    let t = EMPTY_TRICK;
    for (const c of ['4E', '5O', 'QP', '4P']) {
      const n = play(s, c);
      t = step(t, s, n, 0);
      s = n;
    }
    expect(nextWakeAt(t)).toBe(t.holdUntil);
    expect(advance(t, t.holdUntil! - 1).phase).toBe('resolved');
    const collecting = advance(t, t.holdUntil!);
    expect(collecting.phase).toBe('collecting');
    expect(collecting.plays).toHaveLength(4);
    expect(nextWakeAt(collecting)).toBe(t.clearAt);
    expect(advance(collecting, t.clearAt!)).toBe(EMPTY_TRICK);
  });

  it('um lote repetido (mesma view) não reinicia a apresentação', () => {
    const s0 = rigged();
    let s = s0;
    let t = EMPTY_TRICK;
    for (const c of ['4E', '5O', 'QP', '4P']) {
      const n = play(s, c);
      t = step(t, s, n, 0);
      s = n;
    }
    const again = presentTrick(t, viewForSeat(s, 0), [], false, 100);
    expect(again).toBe(t);
  });

  it('empate entre adversários fecha a vaza sem vencedora destacada', () => {
    const m = dealt(1);
    const s0: MatchState = {
      ...m,
      hand: {
        ...m.hand,
        hands: [['3E'], ['3O'], ['5P'], ['6P']].map((h) => h.map(parseCardId)),
      },
    };
    let s = s0;
    let t = EMPTY_TRICK;
    for (const c of ['3E', '3O', '5P', '6P']) {
      const n = play(s, c);
      t = step(t, s, n);
      s = n;
    }
    expect(t.phase).toBe('resolved');
    expect(t.resolved).toEqual({ winnerSeat: 0, winner: null });
    expect(t.plays).toHaveLength(4);
  });
});

/** Naipe da primeira carta do assento da vez, como sufixo de id. */
function suitCode(s: MatchState): string {
  const c = s.hand.hands[s.hand.turnSeat]![0]!;
  return { paus: 'P', copas: 'C', espadas: 'E', ouros: 'O' }[c.suit];
}
