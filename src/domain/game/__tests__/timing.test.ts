import { cardId } from '../cards/card';
import { applyAction, createMatch, skipCeremony, viewForSeat } from '../engine/engine';
import { cardStrength } from '../rules/strength';
import { decisionKey, TURN_TIMING, timeoutAction, turnDurationMs } from '../rules/timing';
import type { Seat } from '../state/types';

describe('relógio da jogada (regra única do app e do servidor)', () => {
  it('30 s para jogar/responder; cerimônia tem prazos próprios', () => {
    expect(turnDurationMs('PLAY')).toBe(30_000);
    expect(turnDurationMs('TRUCO_RESPONSE')).toBe(30_000);
    expect(turnDurationMs('MAO_DE_ONZE')).toBe(30_000);
    expect(turnDurationMs('SHUFFLING')).toBe(TURN_TIMING.shuffleMs);
    expect(turnDurationMs('CUTTING')).toBe(TURN_TIMING.cutMs);
    expect(TURN_TIMING.serverGraceMs).toBeGreaterThan(0);
  });

  it('a decisão da cerimônia é o estágio inteiro; nas outras fases cada versão abre um prazo', () => {
    expect(decisionKey({ phase: 'SHUFFLING', handNumber: 2, version: 5 })).toBe(
      decisionKey({ phase: 'SHUFFLING', handNumber: 2, version: 9 }),
    );
    expect(decisionKey({ phase: 'PLAY', handNumber: 2, version: 5 })).not.toBe(
      decisionKey({ phase: 'PLAY', handNumber: 2, version: 6 }),
    );
  });

  it('timeout na cerimônia fecha o embaralho', () => {
    const state = createMatch(42);
    const dealer = state.hand.dealerSeat;
    expect(timeoutAction(viewForSeat(state, dealer), dealer)).toEqual({ type: 'FINISH_SHUFFLE', seat: dealer });
  });

  it('timeout na vez joga a carta mais fraca permitida', () => {
    const state = skipCeremony(createMatch(7));
    const seat = state.hand.turnSeat as Seat;
    const view = viewForSeat(state, seat);
    const action = timeoutAction(view, seat)!;
    expect(action.type).toBe('PLAY_CARD');
    const weakest = [...view.myCards].sort((a, b) => cardStrength(a) - cardStrength(b))[0]!;
    expect(action).toEqual({ type: 'PLAY_CARD', seat, cardId: cardId(weakest) });
    expect(() => applyAction(state, action)).not.toThrow();
  });

  it('timeout diante de truco corre', () => {
    let state = skipCeremony(createMatch(11));
    const caller = state.hand.turnSeat as Seat;
    state = applyAction(state, { type: 'REQUEST_TRUCO', seat: caller });
    const responder = ((caller + 1) % 4) as Seat;
    expect(timeoutAction(viewForSeat(state, responder), responder)).toEqual({ type: 'RUN', seat: responder });
  });

  it('sem nada a decidir, não há jogada automática', () => {
    const state = skipCeremony(createMatch(3));
    const idle = ((state.hand.turnSeat + 1) % 4) as Seat;
    expect(timeoutAction(viewForSeat(state, idle), idle)).toBeNull();
  });
});
