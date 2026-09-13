import { createMatch, parseCardId, viewForSeat, applyAction } from '@/domain/game';
import type { MatchState } from '@/domain/game';
import { TURN_TIMING, formatTurnClock, timeoutAction } from '../turnTimer';

function withHands(m: MatchState, hands: string[][]): MatchState {
  return { ...m, hand: { ...m.hand, hands: hands.map((h) => h.map(parseCardId)) } };
}

describe('timeoutAction', () => {
  it('joga a carta mais fraca quando o tempo de jogar acaba', () => {
    const m = withHands(createMatch(1), [['3E', '4O', 'KP'], ['5E'], ['5O'], ['5P']]);
    const a = timeoutAction(viewForSeat(m, 0), 0);
    expect(a).toEqual({ type: 'PLAY_CARD', seat: 0, cardId: '4O' });
  });

  it('nunca escolhe a manilha como carta mais fraca', () => {
    const m = withHands(createMatch(1), [['4P', 'QO'], ['5E'], ['5O'], ['5P']]);
    const a = timeoutAction(viewForSeat(m, 0), 0);
    expect(a).toEqual({ type: 'PLAY_CARD', seat: 0, cardId: 'QO' });
  });

  it('corre quando o tempo de responder ao truco acaba', () => {
    let m = createMatch(1);
    m = applyAction(m, { type: 'REQUEST_TRUCO', seat: 0 });
    expect(timeoutAction(viewForSeat(m, 1), 1)).toEqual({ type: 'RUN', seat: 1 });
    // Quem pediu não tem nada a fazer.
    expect(timeoutAction(viewForSeat(m, 0), 0)).toBeNull();
  });

  it('entrega a mão de onze quando o tempo acaba', () => {
    const m = createMatch(1);
    const at11: MatchState = {
      ...m,
      scores: [11, 0],
      hand: { ...m.hand, phase: 'MAO_DE_ONZE', maoDeOnzeTeam: 0 },
    };
    expect(timeoutAction(viewForSeat(at11, 0), 0)).toEqual({
      type: 'DECLINE_MAO_DE_ONZE',
      seat: 0,
    });
  });

  it('não faz nada fora da vez', () => {
    const m = createMatch(1);
    expect(timeoutAction(viewForSeat(m, 1), 1)).toBeNull();
  });
});

describe('formatTurnClock', () => {
  it('arredonda para cima e nunca fica negativo', () => {
    expect(formatTurnClock(TURN_TIMING.turnMs)).toBe('25s');
    expect(formatTurnClock(4_100)).toBe('5s');
    expect(formatTurnClock(0)).toBe('0s');
    expect(formatTurnClock(-50)).toBe('0s');
  });
});
