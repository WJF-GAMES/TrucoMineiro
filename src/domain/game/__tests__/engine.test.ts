import { cardId, parseCardId } from '../cards/card';
import { leadingPlay } from '../rules/strength';
import {
  applyAction,
  createMatch,
  decideHand,
  getAvailableActions,
  InvalidActionError,
  viewForSeat,
} from '../engine/engine';
import { HandState, MatchState, Seat } from '../state/types';

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
    const m = createMatch(7);
    expect(m.hand.hands).toHaveLength(4);
    m.hand.hands.forEach((h) => expect(h).toHaveLength(3));
    expect(m.hand.turnSeat).toBe(0);
    expect(m.hand.dealerSeat).toBe(3);
    expect(m.scores).toEqual([0, 0]);
    expect(m.hand.value).toBe(1);
    expect(m.status).toBe('PLAYING');
  });

  it('is deterministic for a given seed', () => {
    const a = createMatch(99).hand.hands.flat().map(cardId);
    const b = createMatch(99).hand.hands.flat().map(cardId);
    expect(a).toEqual(b);
  });
});

describe('turn order and validation', () => {
  it('only the seat in turn can play, and only its own cards', () => {
    const m = createMatch(1);
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
    expect(next.version).toBe(1);
  });

  it('rejects responding to a truco that was not called', () => {
    const m = createMatch(1);
    expect(() => applyAction(m, { type: 'ACCEPT_TRUCO', seat: 1 })).toThrow(InvalidActionError);
  });
});

describe('rounds and hand resolution', () => {
  it('awards the round to the strongest card and lets the winner lead', () => {
    const m = withHands(createMatch(3), [
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
    const m = withHands(createMatch(3), [
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
    expect(s.hand.turnSeat).toBe(1);
  });

  it('ties the round when the two strongest cards are equal and from different teams', () => {
    const m = withHands(createMatch(3), [
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
    const m = withHands(createMatch(3), [
      ['3O', '5O', '6O'],
      ['4C', '5C', '6C'],
      ['3E', '5E', '6E'],
      ['QP', '5P', '6P'],
    ]);
    const s = playAll(m, ['3O', '4C', '3E', 'QP']);
    expect(s.hand.rounds[0]!.winner).toBe(0);
  });

  it('first round tied: second round decides', () => {
    const m = withHands(createMatch(3), [
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
    const m = withHands(createMatch(3), [
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
    const m = withHands(createMatch(3), [
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
    const m = createMatch(5);
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
    const m = createMatch(5);
    let s = applyAction(m, { type: 'REQUEST_TRUCO', seat: 0 });
    s = applyAction(s, { type: 'RUN', seat: 1 });
    expect(s.scores).toEqual([1, 0]);
    expect(s.hand.number).toBe(2);
  });

  it('raise chain Truco -> Seis -> Nove -> Doze and running at Doze concedes 9', () => {
    const m = createMatch(5);
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
    const m = withHands(createMatch(5), [
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
    let m = createMatch(9);
    m = { ...m, scores: [11, 5] };
    // Force a new hand start by finishing the current one via run
    let s = applyAction(m, { type: 'REQUEST_TRUCO', seat: 0 });
    s = applyAction(s, { type: 'RUN', seat: 1 }); // team 0 gets 1 -> 12? no: capped by target -> match ends
    expect(s.status).toBe('FINISHED');

    // Now the realistic path: team 1 at 11, team 0 wins nothing.
    let t = { ...createMatch(9), scores: [3, 11] as [number, number] };
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
    const m = createMatch(11);
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
    expect(leadingPlay([p(0, '3O'), p(1, '3E'), p(2, '7O')])).toMatchObject({ seat: 2, tied: false });
  });
  it('mesa vazia', () => {
    expect(leadingPlay([])).toBeNull();
  });
});
