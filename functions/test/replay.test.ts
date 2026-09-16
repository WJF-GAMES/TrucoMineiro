import { parseAction, replayAiMatch } from '../src/matches';
import {
  aiForDifficulty,
  applyAction,
  cardId,
  cardStrength,
  createMatch,
  createRng,
  nextAIAction,
  parseCardId,
  seatsToAct,
  viewForSeat,
  observe,
  Seat,
  GameAction,
} from '../src/domain/game';

jest.mock('../src/lib/admin', () => ({
  db: {},
  rtdb: {},
  auth: {},
  messaging: {},
  REGION: 'southamerica-east1',
  IS_EMULATOR: true,
  now: () => Date.now(),
}));

function playFullMatch(seed: number, aiSeed: number, difficulty: 'easy' | 'normal' | 'hard') {
  const ai = aiForDifficulty(difficulty);
  const aiSeats = new Map<Seat, typeof ai>([
    [1, ai],
    [2, ai],
    [3, ai],
  ]);
  const rng = createRng(aiSeed);
  const humanRng = createRng(seed ^ 0x9e3779b9);
  let state = createMatch(seed);
  const actions: GameAction[] = [];
  while (state.status === 'PLAYING') {
    const botAction = nextAIAction(state, aiSeats, rng);
    if (botAction) {
      actions.push(botAction);
      state = applyAction(state, botAction);
      continue;
    }
    // Human seat 0 plays like the "normal" AI but with its own RNG (simulating a real player)
    const human = aiForDifficulty('normal').decide(observe(viewForSeat(state, 0)), humanRng);
    actions.push(human);
    state = applyAction(state, human);
  }
  return { state, actions };
}

describe('replayAiMatch (anti-cheat)', () => {
  it('accepts a genuine match and reproduces the winner', () => {
    const { state, actions } = playFullMatch(42, 7, 'hard');
    const replayed = replayAiMatch({
      mode: 'ai',
      matchId: 'm',
      seed: 42,
      aiSeed: 7,
      difficulty: 'hard',
      actions,
    });
    expect(replayed.status).toBe('FINISHED');
    expect(replayed.winner).toBe(state.winner);
    expect(replayed.scores).toEqual(state.scores);
  });

  it('rejects a forged AI action', () => {
    const { actions } = playFullMatch(42, 7, 'normal');
    const idx = actions.findIndex((a) => a.seat !== 0 && a.type === 'PLAY_CARD');
    const forged = actions.slice();
    forged[idx] = { type: 'RUN', seat: forged[idx]!.seat } as GameAction;
    expect(() =>
      replayAiMatch({
        mode: 'ai',
        matchId: 'm',
        seed: 42,
        aiSeed: 7,
        difficulty: 'normal',
        actions: forged,
      }),
    ).toThrow();
  });

  it('rejects an unfinished match', () => {
    const { actions } = playFullMatch(5, 5, 'easy');
    expect(() =>
      replayAiMatch({
        mode: 'ai',
        matchId: 'm',
        seed: 5,
        aiSeed: 5,
        difficulty: 'easy',
        actions: actions.slice(0, 10),
      }),
    ).toThrow();
  });

  it('rejects an invalid human action', () => {
    const { actions } = playFullMatch(9, 9, 'easy');
    const forged = actions.slice();
    forged.splice(0, 0, { type: 'ACCEPT_TRUCO', seat: 0 });
    expect(() =>
      replayAiMatch({
        mode: 'ai',
        matchId: 'm',
        seed: 9,
        aiSeed: 9,
        difficulty: 'easy',
        actions: forged,
      }),
    ).toThrow();
  });

  it('recusa carta menor do humano no desempate por cango', () => {
    // Procura uma partida em que o humano jogou no desempate tendo uma carta mais fraca na mão.
    for (let seed = 1; seed < 200; seed++) {
      const { actions } = playFullMatch(seed, seed, 'normal');
      let state = createMatch(seed);
      for (let i = 0; i < actions.length; i++) {
        const a = actions[i]!;
        if (a.type === 'PLAY_CARD' && a.seat === 0 && state.hand.tieBreak) {
          const lower = state.hand.hands[0]!.find(
            (c) => cardStrength(c) < cardStrength(parseCardId(a.cardId)),
          );
          if (lower) {
            // A gravação genuína passa…
            expect(() =>
              replayAiMatch({
                mode: 'ai',
                matchId: 'm',
                seed,
                aiSeed: seed,
                difficulty: 'normal',
                actions,
              }),
            ).not.toThrow();
            // …e trocar a maior carta por uma menor é recusado.
            const forged = actions.slice();
            forged[i] = { type: 'PLAY_CARD', seat: 0, cardId: cardId(lower) };
            expect(() =>
              replayAiMatch({
                mode: 'ai',
                matchId: 'm',
                seed,
                aiSeed: seed,
                difficulty: 'normal',
                actions: forged,
              }),
            ).toThrow(/MUST_PLAY_HIGHEST_CARD/);
            return;
          }
        }
        state = applyAction(state, a);
      }
    }
    throw new Error('nenhum desempate com carta menor encontrado nos seeds');
  });

  it('replay aceita partidas com cartas viradas (IA e humano) e recusa virada no desempate', () => {
    const { state, actions } = playFullMatch(42, 7, 'hard');
    expect(actions.some((a) => a.type === 'PLAY_CARD_COVERED')).toBe(true);
    const replayed = replayAiMatch({
      mode: 'ai',
      matchId: 'm',
      seed: 42,
      aiSeed: 7,
      difficulty: 'hard',
      actions,
    });
    expect(replayed.scores).toEqual(state.scores);
  });

  it('seatsToAct never empty while playing', () => {
    const s = createMatch(3);
    expect(seatsToAct(s).length).toBeGreaterThan(0);
  });
});

/**
 * O validador é o portão: ele roda ANTES do handler, então o que ele recusa nunca chega ao motor.
 *
 * Ele listava só as ações de jogo e esquecia a cerimônia — e toda mão começa em `SHUFFLING`.
 * Resultado: a partida online travava no embaralhamento quando quem dava as cartas era humano, e
 * a gravação de toda partida contra a IA era recusada no `finalizeMatch`, sem XP, sem ponto de
 * liga e sem vitória registrada (o app só mostrava "Resultado não sincronizado").
 */
describe('parseAction (portão de entrada das ações)', () => {
  const CEREMONY = ['SHUFFLE', 'FINISH_SHUFFLE', 'CUT', 'FINISH_CUT'] as const;

  it.each(CEREMONY)('aceita a ação de cerimônia %s', (type) => {
    expect(parseAction({ type, seat: 2 })).toMatchObject({ type, seat: 2 });
  });

  it('aceita as ações de jogo', () => {
    expect(parseAction({ type: 'PLAY_CARD', seat: 0, cardId: '4P' })).toEqual({
      type: 'PLAY_CARD',
      seat: 0,
      cardId: '4P',
    });
    for (const type of ['REQUEST_TRUCO', 'ACCEPT_TRUCO', 'RAISE', 'RUN'] as const)
      expect(parseAction({ type, seat: 1 })).toEqual({ type, seat: 1 });
  });

  it('aceita a jogada virada com a carta', () => {
    expect(parseAction({ type: 'PLAY_CARD_COVERED', seat: 2, cardId: '4P' })).toEqual({
      type: 'PLAY_CARD_COVERED',
      seat: 2,
      cardId: '4P',
    });
    expect(() => parseAction({ type: 'PLAY_CARD_COVERED', seat: 2 })).toThrow();
  });

  it('preserva a profundidade do corte (sem ela o replay da IA nunca bateria)', () => {
    for (const depth of ['high', 'middle', 'low'] as const)
      expect(parseAction({ type: 'CUT', seat: 3, depth })).toEqual({ type: 'CUT', seat: 3, depth });
    // Sem profundidade continua válido: o motor corta no meio.
    expect(parseAction({ type: 'CUT', seat: 3 })).toEqual({ type: 'CUT', seat: 3 });
  });

  it('recusa profundidade e tipo inventados, e assento fora da mesa', () => {
    expect(() => parseAction({ type: 'CUT', seat: 0, depth: 'muito_fundo' })).toThrow();
    expect(() => parseAction({ type: 'GANHAR_A_PARTIDA', seat: 0 })).toThrow();
    expect(() => parseAction({ type: 'PLAY_CARD', seat: 9, cardId: '4P' })).toThrow();
  });

  it('a gravação de uma partida inteira passa pelo validador', () => {
    // É exatamente o que o cliente manda em `finalizeMatch`: tudo, cerimônia inclusive.
    const { actions } = playFullMatch(999, 7, 'normal');
    const types = new Set(actions.map((a) => a.type));
    expect(types.has('SHUFFLE')).toBe(true);
    expect(types.has('FINISH_CUT')).toBe(true);
    expect(() => actions.map((a) => parseAction(a))).not.toThrow();
  });
});
