import { applyAction, createMatch, parseCardId, viewForSeat, skipCeremony } from '@/domain/game';
import type { GameEvent, MatchState, Seat, TablePlay } from '@/domain/game';
import {
  CANGO_COPY,
  EMPTY_TRICK,
  TRICK_TIMING,
  cangoNote,
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

const seatsOf = (plays: TablePlay[]) => plays.map((p) => p.seat).sort();

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
    expect(t.resolved).toEqual({ winnerSeat: 3, winner: 1, cango: null });
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
    // Cangou: nenhuma carta vencedora; as cartas vão para quem cangou (assento 1), que abre.
    expect(t.resolved).toEqual({ winnerSeat: 1, winner: null, cango: 'TIE_BREAK_STARTED' });
    expect(t.plays).toHaveLength(4);
  });
});

describe('cango na mesa', () => {
  type P = [Seat, string];
  /** Joga as vazas (mãos montadas a partir delas) e devolve a apresentação da última. */
  function trickAfter(tricks: P[][]) {
    const m = dealt(1, 99);
    const hands: string[][] = [[], [], [], []];
    for (const t of tricks) for (const [seat, c] of t) hands[seat]!.push(c);
    let s: MatchState = {
      ...m,
      hand: { ...m.hand, hands: hands.map((h) => h.map(parseCardId)) },
    };
    let t = EMPTY_TRICK;
    for (const trick of tricks)
      for (const [seat, c] of trick) {
        const n = applyAction(s, { type: 'PLAY_CARD', seat, cardId: c });
        t = step(t, s, n);
        s = n;
      }
    return { t, s };
  }
  const T1_TIE: P[] = [
    [0, 'KO'],
    [1, 'KP'],
    [2, '4O'],
    [3, '4C'],
  ];

  it('1ª cangada: aviso de desempate, sem vencedora, e a mesa segura as quatro cartas', () => {
    const { t, s } = trickAfter([T1_TIE]);
    expect(t.resolved?.cango).toBe('TIE_BREAK_STARTED');
    expect(CANGO_COPY[t.resolved!.cango!]).toBe('Cangou! Agora todos jogam a maior carta.');
    expect(t.plays).toHaveLength(4);
    expect(t.handEnded).toBe(false);
    // A mesa só libera depois do aviso; a view já traz o desempate para a próxima vaza.
    expect(isHolding(t)).toBe(true);
    expect(viewForSeat(s, 0).tieBreak).toEqual({ causedBySeat: 1, round: 1 });
  });

  it('cangou de novo no desempate: "a terceira decide"', () => {
    const { t } = trickAfter([
      T1_TIE,
      [
        [1, '2P'],
        [2, '2O'],
        [3, '6C'],
        [0, '5O'],
      ],
    ]);
    expect(t.resolved?.cango).toBe('TIE_BREAK_AGAIN');
    expect(CANGO_COPY.TIE_BREAK_AGAIN).toBe('Cangou de novo! A terceira decide.');
  });

  it('cangou depois de a 1ª ter vencedor: "vale a primeira", e a mão acaba', () => {
    const { t } = trickAfter([
      [
        [0, '3O'],
        [1, '2P'],
        [2, '4O'],
        [3, '4C'],
      ],
      [
        [0, 'KO'],
        [1, 'KP'],
        [2, '5E'],
        [3, '6C'],
      ],
    ]);
    expect(t.resolved).toMatchObject({ winner: null, cango: 'FIRST_TRICK_PREVAILS' });
    expect(t.handEnded).toBe(true);
    expect(t.plays).toHaveLength(4);
    expect(CANGO_COPY.FIRST_TRICK_PREVAILS).toBe('Cangou! Vale a primeira.');
  });

  it('três cangadas: ninguém pontua', () => {
    const { t } = trickAfter([
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
    ]);
    expect(t.resolved?.cango).toBe('ALL_TIED');
    expect(t.handEnded).toBe(true);
  });

  it('vaza com vencedora não tem aviso de cango, nem a vaza que decide o desempate', () => {
    const { t } = trickAfter([
      T1_TIE,
      [
        [1, '2P'],
        [2, '3O'],
        [3, '6C'],
        [0, '5O'],
      ],
    ]);
    expect(t.resolved).toMatchObject({ winner: 0, winnerSeat: 2, cango: null });
    expect(t.handEnded).toBe(true);
  });

  it('cangoNote só lê o que o motor anunciou', () => {
    expect(cangoNote([], 0)).toBeNull();
    expect(
      cangoNote([{ type: 'TIE_BREAK_STARTED', round: 1, leadSeat: 3, continued: false }], 0),
    ).toBe('TIE_BREAK_STARTED');
    // Evento de outra vaza não conta.
    expect(
      cangoNote([{ type: 'TIE_BREAK_STARTED', round: 2, leadSeat: 3, continued: true }], 0),
    ).toBeNull();
  });
});

/** Naipe da primeira carta do assento da vez, como sufixo de id. */
function suitCode(s: MatchState): string {
  const c = s.hand.hands[s.hand.turnSeat]![0]!;
  return { paus: 'P', copas: 'C', espadas: 'E', ouros: 'O' }[c.suit];
}
