import { createMatch, parseCardId, viewForSeat, applyAction, skipCeremony } from '@/domain/game';
import type { MatchState } from '@/domain/game';
import { TURN_TIMING, formatTurnClock, timeoutAction, turnDurationMs } from '../turnTimer';

/** Mão já embaralhada e cortada: os testes de jogo começam com as cartas na mão. */
const dealt = (seed: number, targetScore?: number) => skipCeremony(createMatch(seed, targetScore));

function withHands(m: MatchState, hands: string[][]): MatchState {
  return { ...m, hand: { ...m.hand, hands: hands.map((h) => h.map(parseCardId)) } };
}

describe('timeoutAction', () => {
  it('joga a carta mais fraca quando o tempo de jogar acaba', () => {
    const m = withHands(dealt(1), [['3E', '4O', 'KP'], ['5E'], ['5O'], ['5P']]);
    const a = timeoutAction(viewForSeat(m, 0), 0);
    expect(a).toEqual({ type: 'PLAY_CARD', seat: 0, cardId: '4O' });
  });

  it('nunca escolhe a manilha como carta mais fraca', () => {
    const m = withHands(dealt(1), [['4P', 'QO'], ['5E'], ['5O'], ['5P']]);
    const a = timeoutAction(viewForSeat(m, 0), 0);
    expect(a).toEqual({ type: 'PLAY_CARD', seat: 0, cardId: 'QO' });
  });

  it('corre quando o tempo de responder ao truco acaba', () => {
    let m = dealt(1);
    m = applyAction(m, { type: 'REQUEST_TRUCO', seat: 0 });
    expect(timeoutAction(viewForSeat(m, 1), 1)).toEqual({ type: 'RUN', seat: 1 });
    // Quem pediu não tem nada a fazer.
    expect(timeoutAction(viewForSeat(m, 0), 0)).toBeNull();
  });

  it('entrega a mão de onze quando o tempo acaba', () => {
    const m = dealt(1);
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

  it('no desempate por cango joga a maior carta (a única liberada), nunca a mais fraca', () => {
    const m = withHands(dealt(1), [
      ['KO', '5O'],
      ['KP', '2P', 'QP'],
      ['4O', '3O'],
      ['4C', '6C'],
    ]);
    let s = m;
    for (const [seat, c] of [
      [0, 'KO'],
      [1, 'KP'],
      [2, '4O'],
      [3, '4C'],
    ] as const)
      s = applyAction(s, { type: 'PLAY_CARD', seat, cardId: c });
    // Cangou: o assento 1 abre e só pode jogar o 2.
    const view = viewForSeat(s, 1);
    expect(view.tieBreak).not.toBeNull();
    expect(timeoutAction(view, 1)).toEqual({ type: 'PLAY_CARD', seat: 1, cardId: '2P' });
    // E a jogada automática é aceita pelo motor.
    expect(() => applyAction(s, timeoutAction(view, 1)!)).not.toThrow();
  });

  it('não faz nada fora da vez', () => {
    const m = dealt(1);
    expect(timeoutAction(viewForSeat(m, 1), 1)).toBeNull();
  });
});

describe('timeoutAction na cerimônia', () => {
  it('fecha o embaralhamento com o baralho como está e corta no meio', () => {
    const m = createMatch(1); // dealer 3 embaralha
    expect(timeoutAction(viewForSeat(m, 3), 3)).toEqual({ type: 'FINISH_SHUFFLE', seat: 3 });
    expect(timeoutAction(viewForSeat(m, 0), 0)).toBeNull();
    const cutting = applyAction(m, { type: 'FINISH_SHUFFLE', seat: 3 });
    // Fechar o corte já corta no meio quando ninguém cortou: uma ação só fecha o estágio.
    expect(timeoutAction(viewForSeat(cutting, 0), 0)).toEqual({ type: 'FINISH_CUT', seat: 0 });
    const cutOnce = applyAction(cutting, { type: 'CUT', seat: 0, depth: 'high' });
    expect(timeoutAction(viewForSeat(cutOnce, 0), 0)).toEqual({ type: 'FINISH_CUT', seat: 0 });
  });
  it('usa o prazo de cada fase', () => {
    expect(turnDurationMs('SHUFFLING')).toBe(TURN_TIMING.shuffleMs);
    expect(turnDurationMs('CUTTING')).toBe(TURN_TIMING.cutMs);
    expect(turnDurationMs('PLAY')).toBe(TURN_TIMING.turnMs);
    expect(turnDurationMs('TRUCO_RESPONSE')).toBe(TURN_TIMING.turnMs);
  });
});

describe('chave da decisão', () => {
  it('cada mistura muda a versão da partida (é o hook que mantém um único prazo por estágio)', () => {
    const m = createMatch(1);
    const once = applyAction(m, { type: 'SHUFFLE', seat: 3 });
    expect(once.version).toBe(m.version + 1);
    expect(once.hand.phase).toBe('SHUFFLING');
    expect(once.hand.number).toBe(m.hand.number);
  });
});

describe('formatTurnClock', () => {
  it('arredonda para cima e nunca fica negativo', () => {
    expect(formatTurnClock(25_000)).toBe('25s');
    expect(formatTurnClock(4_100)).toBe('5s');
    expect(formatTurnClock(0)).toBe('0s');
    expect(formatTurnClock(-50)).toBe('0s');
  });
});
