import { cardId, parseCardId } from '../cards/card';
import { leadingPlay } from '../rules/strength';
import {
  applyAction,
  createMatch,
  decideHand,
  getAvailableActions,
  InvalidActionError,
  viewForSeat,
  skipCeremony,
} from '../engine/engine';
import { HandState, MatchState, Seat } from '../state/types';

/** Mão já embaralhada e cortada: os testes de jogo começam com as cartas na mão. */
const dealt = (seed: number, targetScore?: number) => skipCeremony(createMatch(seed, targetScore));

/** Helper: rig the hands of the current deal so tests are deterministic. */
function withHands(
  state: MatchState,
  hands: string[][],
  extra: Partial<HandState> = {},
): MatchState {
  return {
    ...state,
    hand: { ...state.hand, hands: hands.map((h) => h.map(parseCardId)), ...extra },
  };
}

function playAll(state: MatchState, cards: string[]): MatchState {
  let s = state;
  for (const c of cards)
    s = applyAction(s, { type: 'PLAY_CARD', seat: s.hand.turnSeat, cardId: c });
  return s;
}

describe('createMatch', () => {
  it('deals 3 cards to each of 4 seats and seat 0 leads', () => {
    const m = dealt(7);
    expect(m.hand.hands).toHaveLength(4);
    m.hand.hands.forEach((h) => expect(h).toHaveLength(3));
    expect(m.hand.turnSeat).toBe(0);
    expect(m.hand.dealerSeat).toBe(3);
    expect(m.scores).toEqual([0, 0]);
    expect(m.hand.value).toBe(1);
    expect(m.status).toBe('PLAYING');
  });

  it('is deterministic for a given seed', () => {
    const a = dealt(99).hand.hands.flat().map(cardId);
    const b = dealt(99).hand.hands.flat().map(cardId);
    expect(a).toEqual(b);
  });
});

describe('turn order and validation', () => {
  it('only the seat in turn can play, and only its own cards', () => {
    const m = dealt(1);
    expect(getAvailableActions(m, 0)).toEqual(['PLAY_CARD', 'REQUEST_TRUCO']);
    expect(getAvailableActions(m, 1)).toEqual([]);
    const foreign = cardId(m.hand.hands[1]![0]!);
    expect(() => applyAction(m, { type: 'PLAY_CARD', seat: 1, cardId: foreign })).toThrow(
      InvalidActionError,
    );
    expect(() => applyAction(m, { type: 'PLAY_CARD', seat: 0, cardId: foreign })).toThrow(
      InvalidActionError,
    );
    const own = cardId(m.hand.hands[0]![0]!);
    const next = applyAction(m, { type: 'PLAY_CARD', seat: 0, cardId: own });
    expect(next.hand.turnSeat).toBe(1);
    expect(next.hand.hands[0]).toHaveLength(2);
    expect(next.version).toBe(m.version + 1);
  });

  it('rejects responding to a truco that was not called', () => {
    const m = dealt(1);
    expect(() => applyAction(m, { type: 'ACCEPT_TRUCO', seat: 1 })).toThrow(InvalidActionError);
  });
});

describe('rounds and hand resolution', () => {
  it('awards the round to the strongest card and lets the winner lead', () => {
    const m = withHands(dealt(3), [
      ['4O', '5O', '6O'],
      ['3P', '5C', '6C'],
      ['4E', '5E', '6E'],
      ['QP', '5P', '6P'],
    ]);
    const s = playAll(m, ['4O', '3P', '4E', 'QP']);
    expect(s.hand.rounds).toHaveLength(1);
    expect(s.hand.rounds[0]!.winner).toBe(1);
    expect(s.hand.rounds[0]!.winnerSeat).toBe(1);
    expect(s.hand.turnSeat).toBe(1);
  });

  it('team winning two rounds takes the hand value', () => {
    const m = withHands(dealt(3), [
      ['4O', '5O', '6O'],
      ['3P', '3C', '6C'],
      ['4E', '5E', '6E'],
      ['QP', '5P', '6P'],
    ]);
    let s = playAll(m, ['4O', '3P', '4E', 'QP']); // team 1 wins r1
    s = playAll(s, ['3C', '5E', '5P', '5O']); // seat 1 leads, team 1 wins r2
    expect(s.scores).toEqual([0, 1]);
    expect(s.handsPlayed).toBe(1);
    expect(s.hand.number).toBe(2);
    expect(s.hand.dealerSeat).toBe(0);
    // A mão nova começa com o dealer embaralhando; depois da cerimônia o assento 1 lidera.
    expect(s.hand.phase).toBe('SHUFFLING');
    expect(s.hand.turnSeat).toBe(0);
    expect(skipCeremony(s).hand.turnSeat).toBe(1);
  });

  it('ties the round when the two strongest cards are equal and from different teams', () => {
    const m = withHands(dealt(3), [
      ['3O', '5O', '6O'],
      ['3P', '5C', '6C'],
      ['4E', '5E', '6E'],
      ['QP', '5P', '6P'],
    ]);
    const s = playAll(m, ['3O', '3P', '4E', 'QP']);
    expect(s.hand.rounds[0]!.winner).toBeNull();
    expect(s.hand.turnSeat).toBe(0); // leader leads again
  });

  it('does not tie when the two strongest equal cards belong to the same team', () => {
    const m = withHands(dealt(3), [
      ['3O', '5O', '6O'],
      ['4C', '5C', '6C'],
      ['3E', '5E', '6E'],
      ['QP', '5P', '6P'],
    ]);
    const s = playAll(m, ['3O', '4C', '3E', 'QP']);
    expect(s.hand.rounds[0]!.winner).toBe(0);
  });

  it('first round tied: second round decides', () => {
    const m = withHands(dealt(3), [
      ['3O', '5O', '6O'],
      ['3P', 'KC', '6C'],
      ['4E', '5E', '6E'],
      ['QP', '5P', '6P'],
    ]);
    let s = playAll(m, ['3O', '3P', '4E', 'QP']);
    s = playAll(s, ['5O', 'KC', '5E', '5P']);
    expect(s.scores).toEqual([0, 1]);
  });

  it('first round won and second tied: first winner takes the hand', () => {
    const m = withHands(dealt(3), [
      ['3O', '5O', '6O'],
      ['2P', '5C', '6C'],
      ['4E', '5E', '6E'],
      ['QP', '5P', '6P'],
    ]);
    let s = playAll(m, ['3O', '2P', '4E', 'QP']); // team 0 wins
    s = playAll(s, ['5O', '5C', '5E', '5P']); // tie
    expect(s.scores).toEqual([1, 0]);
  });

  it('decideHand covers every combination', () => {
    expect(decideHand([])).toBeUndefined();
    expect(decideHand([0])).toBeUndefined();
    expect(decideHand([0, 1])).toBeUndefined();
    expect(decideHand([null, null])).toBeUndefined();
    expect(decideHand([0, 0])).toBe(0);
    expect(decideHand([0, null])).toBe(0);
    expect(decideHand([null, 1])).toBe(1);
    expect(decideHand([0, 1, 1])).toBe(1);
    expect(decideHand([0, 1, null])).toBe(0);
    expect(decideHand([null, null, 1])).toBe(1);
    expect(decideHand([null, null, null])).toBeNull();
  });

  it('all three rounds tied gives no points and moves to the next hand', () => {
    const m = withHands(dealt(3), [
      ['3O', '2O', 'KO'],
      ['3P', '2P', 'KP'],
      ['4E', '5E', '6E'],
      ['4C', '5C', '6C'],
    ]);
    let s = playAll(m, ['3O', '3P', '4E', '4C']);
    s = playAll(s, ['2O', '2P', '5E', '5C']);
    s = playAll(s, ['KO', 'KP', '6E', '6C']);
    expect(s.scores).toEqual([0, 0]);
    expect(s.handsPlayed).toBe(1);
    expect(s.events.some((e) => e.type === 'HAND_ENDED' && e.result.reason === 'ALL_TIED')).toBe(
      true,
    );
  });
});

describe('truco', () => {
  it('request -> accept raises the value and resumes the caller turn', () => {
    const m = dealt(5);
    let s = applyAction(m, { type: 'REQUEST_TRUCO', seat: 0 });
    expect(s.hand.phase).toBe('TRUCO_RESPONSE');
    expect(getAvailableActions(s, 0)).toEqual([]);
    expect(getAvailableActions(s, 2)).toEqual([]);
    expect(getAvailableActions(s, 1)).toEqual(['ACCEPT_TRUCO', 'RUN', 'RAISE']);
    expect(getAvailableActions(s, 3)).toEqual(['ACCEPT_TRUCO', 'RUN', 'RAISE']);
    s = applyAction(s, { type: 'ACCEPT_TRUCO', seat: 3 });
    expect(s.hand.value).toBe(3);
    expect(s.hand.phase).toBe('PLAY');
    expect(s.hand.turnSeat).toBe(0);
    // Same team cannot raise again while the other team has not raised
    expect(getAvailableActions(s, 0)).toEqual(['PLAY_CARD']);
    const s2 = applyAction(s, { type: 'PLAY_CARD', seat: 0, cardId: cardId(s.hand.hands[0]![0]!) });
    expect(getAvailableActions(s2, 1)).toEqual(['PLAY_CARD', 'REQUEST_TRUCO']);
  });

  it('running concedes the current value to the requester', () => {
    const m = dealt(5);
    let s = applyAction(m, { type: 'REQUEST_TRUCO', seat: 0 });
    s = applyAction(s, { type: 'RUN', seat: 1 });
    expect(s.scores).toEqual([1, 0]);
    expect(s.hand.number).toBe(2);
  });

  it('raise chain Truco -> Seis -> Nove -> Doze and running at Doze concedes 9', () => {
    const m = dealt(5);
    let s = applyAction(m, { type: 'REQUEST_TRUCO', seat: 0 }); // 3
    s = applyAction(s, { type: 'RAISE', seat: 1 }); // 6 (3 accepted)
    expect(s.hand.value).toBe(3);
    expect(s.hand.truco?.proposedValue).toBe(6);
    expect(getAvailableActions(s, 0)).toEqual(['ACCEPT_TRUCO', 'RUN', 'RAISE']);
    s = applyAction(s, { type: 'RAISE', seat: 2 }); // 9
    s = applyAction(s, { type: 'RAISE', seat: 3 }); // 12
    expect(s.hand.truco?.proposedValue).toBe(12);
    expect(getAvailableActions(s, 0)).toEqual(['ACCEPT_TRUCO', 'RUN']);
    s = applyAction(s, { type: 'RUN', seat: 0 });
    expect(s.scores).toEqual([0, 9]);
  });

  it('accepting Doze and winning ends the match', () => {
    const m = withHands(dealt(5), [
      ['4P', '7C', 'AE'],
      ['4O', '5O', '6O'],
      ['7O', '3P', '3C'],
      ['4E', '5E', '6E'],
    ]);
    let s = applyAction(m, { type: 'REQUEST_TRUCO', seat: 0 });
    s = applyAction(s, { type: 'RAISE', seat: 1 });
    s = applyAction(s, { type: 'RAISE', seat: 0 });
    s = applyAction(s, { type: 'RAISE', seat: 1 });
    s = applyAction(s, { type: 'ACCEPT_TRUCO', seat: 0 });
    expect(s.hand.value).toBe(12);
    s = playAll(s, ['4P', '4O', '7O', '4E']);
    s = playAll(s, ['7C', '5O', '3P', '5E']);
    expect(s.status).toBe('FINISHED');
    expect(s.winner).toBe(0);
    expect(s.scores).toEqual([12, 0]);
    expect(getAvailableActions(s, 0)).toEqual([]);
  });
});

describe('mão de onze', () => {
  it('asks the team at 11 whether to play (worth 3) or concede 1', () => {
    let m = dealt(9);
    m = { ...m, scores: [11, 5] };
    // Force a new hand start by finishing the current one via run
    let s = applyAction(m, { type: 'REQUEST_TRUCO', seat: 0 });
    s = applyAction(s, { type: 'RUN', seat: 1 }); // team 0 gets 1 -> 12? no: capped by target -> match ends
    expect(s.status).toBe('FINISHED');

    // Now the realistic path: team 1 at 11, team 0 wins nothing.
    let t = { ...dealt(9), scores: [3, 11] as [number, number] };
    t = applyAction(t, { type: 'REQUEST_TRUCO', seat: 0 });
    t = applyAction(t, { type: 'ACCEPT_TRUCO', seat: 1 });
    // Play out with rigged hands so team 0 wins this hand (3 points -> 6 x 11), next hand is mão de onze for team 1.
    t = withHands(t, [
      ['4P', '7C', 'AE'],
      ['4O', '5O', '6O'],
      ['7O', '3P', '3C'],
      ['4E', '5E', '6E'],
    ]);
    t = playAll(t, ['4P', '4O', '7O', '4E']);
    t = playAll(t, ['7C', '5O', '3P', '5E']);
    expect(t.scores).toEqual([6, 11]);
    t = skipCeremony(t); // a decisão da mão de onze vem depois de as cartas chegarem
    expect(t.hand.phase).toBe('MAO_DE_ONZE');
    expect(t.hand.maoDeOnzeTeam).toBe(1);
    expect(getAvailableActions(t, 0)).toEqual([]);
    expect(getAvailableActions(t, 1)).toEqual(['ACCEPT_MAO_DE_ONZE', 'DECLINE_MAO_DE_ONZE']);

    const declined = applyAction(t, { type: 'DECLINE_MAO_DE_ONZE', seat: 3 });
    expect(declined.scores).toEqual([7, 11]);

    const accepted = applyAction(t, { type: 'ACCEPT_MAO_DE_ONZE', seat: 1 });
    expect(accepted.hand.value).toBe(3);
    expect(accepted.hand.phase).toBe('PLAY');
    // Nobody can call truco in a mão de onze hand
    const seat = accepted.hand.turnSeat as Seat;
    expect(getAvailableActions(accepted, seat)).toEqual(['PLAY_CARD']);
  });
});

describe('seat view hides information', () => {
  it('exposes only the own hand and card counts', () => {
    const m = dealt(11);
    const v = viewForSeat(m, 2);
    expect(v.myCards.map(cardId)).toEqual(m.hand.hands[2]!.map(cardId));
    expect(v.cardCounts).toEqual([3, 3, 3, 3]);
    expect(JSON.stringify(v)).not.toContain(cardId(m.hand.hands[0]![0]!));
  });
});

describe('leadingPlay', () => {
  const p = (seat: 0 | 1 | 2 | 3, id: string) => ({ seat, card: parseCardId(id) });
  it('a primeira carta lidera sozinha', () => {
    expect(leadingPlay([p(0, '5O')])).toEqual({ seat: 0, card: parseCardId('5O'), tied: false });
  });
  it('a segunda assume, a terceira assume, a quarta assume', () => {
    expect(leadingPlay([p(0, '5O'), p(1, 'KE')])?.seat).toBe(1);
    expect(leadingPlay([p(0, '5O'), p(1, 'KE'), p(2, '3P')])?.seat).toBe(2);
    expect(leadingPlay([p(0, '5O'), p(1, 'KE'), p(2, '3P'), p(3, '7O')])?.seat).toBe(3);
  });
  it('a primeira permanece quando ninguém a supera', () => {
    expect(leadingPlay([p(0, '3O'), p(1, 'KE'), p(2, '2P'), p(3, 'AO')])?.seat).toBe(0);
  });
  it('manilha vence tudo e as manilhas se ordenam entre si', () => {
    expect(leadingPlay([p(0, '3O'), p(1, '7O'), p(2, '4P'), p(3, '7C')])?.seat).toBe(2);
  });
  it('empate entre adversários fica marcado; entre parceiros não', () => {
    expect(leadingPlay([p(0, '3O'), p(1, '3E')])?.tied).toBe(true);
    expect(leadingPlay([p(0, '3O'), p(2, '3E')])?.tied).toBe(false);
    // Carta maior depois do empate desempata.
    expect(leadingPlay([p(0, '3O'), p(1, '3E'), p(2, '7O')])).toMatchObject({
      seat: 2,
      tied: false,
    });
  });
  it('mesa vazia', () => {
    expect(leadingPlay([])).toBeNull();
  });
});

describe('cerimônia: embaralhar → cortar → distribuir', () => {
  const ids = (cards: readonly { rank: string; suit: string }[]) =>
    cards.map((c) => cardId(c as Parameters<typeof cardId>[0]));
  const shuffleN = (state: MatchState, n: number) => {
    let s = state;
    for (let i = 0; i < n; i++) s = applyAction(s, { type: 'SHUFFLE', seat: s.hand.dealerSeat });
    return s;
  };

  it('a mão começa com o dealer embaralhando e ninguém com cartas', () => {
    const m = createMatch(7);
    expect(m.hand.phase).toBe('SHUFFLING');
    expect(m.hand.dealerSeat).toBe(3);
    expect(m.hand.turnSeat).toBe(3);
    expect(m.hand.deck).toHaveLength(40);
    expect(m.hand.deckVersion).toBe(0);
    expect(m.hand.shuffleCount).toBe(0);
    m.hand.hands.forEach((h) => expect(h).toHaveLength(0));
    expect(getAvailableActions(m, 3)).toEqual(['SHUFFLE', 'FINISH_SHUFFLE']);
    expect(getAvailableActions(m, 0)).toEqual([]);
  });

  it('cada mistura altera de verdade a ordem e sobe a versão, sempre sobre o baralho atual', () => {
    const m0 = createMatch(7);
    const m1 = shuffleN(m0, 1);
    const m2 = shuffleN(m1, 1);
    const m3 = shuffleN(m2, 1);
    expect(ids(m1.hand.deck)).not.toEqual(ids(m0.hand.deck));
    expect(ids(m2.hand.deck)).not.toEqual(ids(m1.hand.deck));
    expect(ids(m3.hand.deck)).not.toEqual(ids(m2.hand.deck));
    expect([m1, m2, m3].map((m) => m.hand.deckVersion)).toEqual([1, 2, 3]);
    expect([m1, m2, m3].map((m) => m.hand.shuffleCount)).toEqual([1, 2, 3]);
    // Mesmo conjunto de 40 cartas, só a ordem muda.
    expect([...ids(m3.hand.deck)].sort()).toEqual([...ids(m0.hand.deck)].sort());
    expect(m3.events.filter((e) => e.type === 'SHUFFLE_PERFORMED')).toHaveLength(3);
    // Determinístico: o mesmo seed reproduz a mesma sequência (replay no servidor).
    expect(ids(shuffleN(createMatch(7), 3).hand.deck)).toEqual(ids(m3.hand.deck));
  });

  it('só o dealer embaralha e só na fase certa', () => {
    const m = createMatch(7);
    expect(() => applyAction(m, { type: 'SHUFFLE', seat: 0 })).toThrow(InvalidActionError);
    const cutting = applyAction(m, { type: 'FINISH_SHUFFLE', seat: 3 });
    expect(() => applyAction(cutting, { type: 'SHUFFLE', seat: 3 })).toThrow(InvalidActionError);
    expect(() => applyAction(cutting, { type: 'CUT', seat: 3 })).toThrow(InvalidActionError);
    expect(() => applyAction(m, { type: 'PLAY_CARD', seat: 0, cardId: '4P' })).toThrow(
      InvalidActionError,
    );
  });

  it('ESTÁ BOM não embaralha de novo escondido: o corte usa exatamente o último baralho', () => {
    const shuffled = shuffleN(createMatch(7), 2);
    const finalized = applyAction(shuffled, { type: 'FINISH_SHUFFLE', seat: 3 });
    expect(ids(finalized.hand.deck)).toEqual(ids(shuffled.hand.deck));
    expect(finalized.hand.deckVersion).toBe(2);
    expect(finalized.hand.phase).toBe('CUTTING');
    expect(finalized.hand.turnSeat).toBe(0);
    expect(getAvailableActions(finalized, 0)).toEqual(['CUT', 'FINISH_CUT']);
    const last = finalized.events[finalized.events.length - 1];
    expect(last).toEqual({ type: 'SHUFFLE_FINALIZED', seat: 3, deckVersion: 2, shuffleCount: 2 });
  });

  it('o corte gira o baralho, mas só o FINISH_CUT distribui', () => {
    const finalized = applyAction(shuffleN(createMatch(7), 1), { type: 'FINISH_SHUFFLE', seat: 3 });
    const before = ids(finalized.hand.deck);
    const cut = applyAction(finalized, { type: 'CUT', seat: 0, depth: 'high' });
    // Corte alto: as 10 de cima vão para baixo.
    expect(ids(cut.hand.deck)).toEqual([...before.slice(10), ...before.slice(0, 10)]);
    expect(cut.hand.deckVersion).toBe(2);
    expect(cut.hand.cutCount).toBe(1);
    // O baralho girou, mas a mesa continua no corte: ninguém recebeu carta ainda.
    expect(cut.hand.phase).toBe('CUTTING');
    cut.hand.hands.forEach((h) => expect(h).toHaveLength(0));

    const dealtHigh = applyAction(cut, { type: 'FINISH_CUT', seat: 0 });
    expect(dealtHigh.hand.phase).toBe('PLAY');
    expect(dealtHigh.hand.turnSeat).toBe(0);
    // Fechar não mexe mais no baralho: distribui exatamente o que o último corte deixou.
    expect(ids(dealtHigh.hand.deck)).toEqual(ids(cut.hand.deck));
    expect(dealtHigh.hand.deckVersion).toBe(2);
    dealtHigh.hand.hands.forEach((h) => expect(h).toHaveLength(3));
    // As cartas distribuídas são as 12 de cima do baralho cortado, na ordem da mesa.
    const top12 = ids(dealtHigh.hand.deck).slice(0, 12);
    const dealtIds = [0, 1, 2].flatMap((round) =>
      [0, 1, 2, 3].map((seat) => cardId(dealtHigh.hand.hands[seat]![round]!)),
    );
    expect(dealtIds).toEqual(top12);
    expect(dealtHigh.events.slice(-2).map((e) => e.type)).toEqual(['CUT_FINALIZED', 'HAND_DEALT']);
  });

  it('o corte pode ser repetido dentro do prazo, sempre sobre o baralho já cortado', () => {
    const finalized = applyAction(shuffleN(createMatch(7), 1), { type: 'FINISH_SHUFFLE', seat: 3 });
    const before = ids(finalized.hand.deck);
    const c1 = applyAction(finalized, { type: 'CUT', seat: 0, depth: 'high' });
    const c2 = applyAction(c1, { type: 'CUT', seat: 0, depth: 'low' });
    const c3 = applyAction(c2, { type: 'CUT', seat: 0, depth: 'middle' });

    expect([c1, c2, c3].map((m) => m.hand.cutCount)).toEqual([1, 2, 3]);
    expect([c1, c2, c3].map((m) => m.hand.deckVersion)).toEqual([2, 3, 4]);
    // Cada corte parte do baralho que o anterior deixou, nunca da ordem original.
    const rotate = (deck: string[], n: number) => [...deck.slice(n), ...deck.slice(0, n)];
    expect(ids(c2.hand.deck)).toEqual(rotate(ids(c1.hand.deck), 30));
    expect(ids(c3.hand.deck)).toEqual(rotate(ids(c2.hand.deck), 20));
    expect(ids(c3.hand.deck)).not.toEqual(before);
    // Nenhuma carta se perde nem se repete depois de vários cortes.
    expect(new Set(ids(c3.hand.deck)).size).toBe(40);
    // E a mesa segue no corte até o jogador fechar.
    expect(c3.hand.phase).toBe('CUTTING');
    expect(applyAction(c3, { type: 'FINISH_CUT', seat: 0 }).hand.phase).toBe('PLAY');
  });

  it('fechar sem cortar corta no meio: o corte é obrigatório na mesa', () => {
    const finalized = applyAction(shuffleN(createMatch(7), 1), { type: 'FINISH_SHUFFLE', seat: 3 });
    const before = ids(finalized.hand.deck);
    const dealt = applyAction(finalized, { type: 'FINISH_CUT', seat: 0 });
    expect(dealt.hand.cutCount).toBe(1);
    expect(ids(dealt.hand.deck)).toEqual([...before.slice(20), ...before.slice(0, 20)]);
    expect(dealt.hand.phase).toBe('PLAY');
    expect(dealt.events.slice(-3).map((e) => e.type)).toEqual([
      'CUT_DONE',
      'CUT_FINALIZED',
      'HAND_DEALT',
    ]);
  });

  it('só quem corta corta, e só na fase de corte', () => {
    const finalized = applyAction(shuffleN(createMatch(7), 1), { type: 'FINISH_SHUFFLE', seat: 3 });
    for (const seat of [1, 2, 3] as const) {
      expect(getAvailableActions(finalized, seat)).toEqual([]);
      expect(() => applyAction(finalized, { type: 'CUT', seat, depth: 'high' })).toThrow();
      expect(() => applyAction(finalized, { type: 'FINISH_CUT', seat })).toThrow();
    }
    const dealt = applyAction(finalized, { type: 'FINISH_CUT', seat: 0 });
    expect(() => applyAction(dealt, { type: 'CUT', seat: 0, depth: 'high' })).toThrow();
  });

  it('sem nenhuma mistura o tempo pode fechar e o baralho já vem embaralhado pelo motor', () => {
    const m = skipCeremony(createMatch(11));
    expect(m.hand.phase).toBe('PLAY');
    expect(m.hand.shuffleCount).toBe(0);
    expect(m.hand.deckVersion).toBe(1); // só o corte
    expect(ids(m.hand.deck)).not.toEqual([...ids(m.hand.deck)].sort());
  });

  it('a mão de onze só é decidida depois de as cartas chegarem', () => {
    const m = createMatch(7);
    const at11: MatchState = {
      ...m,
      scores: [11, 0],
      hand: { ...m.hand, maoDeOnzeTeam: 0 },
    };
    expect(at11.hand.phase).toBe('SHUFFLING');
    expect(skipCeremony(at11).hand.phase).toBe('MAO_DE_ONZE');
  });
});
