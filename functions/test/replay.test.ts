import { replayAiMatch } from '../src/matches';
import { aiForDifficulty, applyAction, createMatch, createRng, nextAIAction, seatsToAct, viewForSeat, observe, Seat, GameAction } from '../src/domain/game';

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
    const replayed = replayAiMatch({ mode: 'ai', matchId: 'm', seed: 42, aiSeed: 7, difficulty: 'hard', actions });
    expect(replayed.status).toBe('FINISHED');
    expect(replayed.winner).toBe(state.winner);
    expect(replayed.scores).toEqual(state.scores);
  });

  it('rejects a forged AI action', () => {
    const { actions } = playFullMatch(42, 7, 'normal');
    const idx = actions.findIndex((a) => a.seat !== 0 && a.type === 'PLAY_CARD');
    const forged = actions.slice();
    forged[idx] = { type: 'RUN', seat: forged[idx]!.seat } as GameAction;
    expect(() => replayAiMatch({ mode: 'ai', matchId: 'm', seed: 42, aiSeed: 7, difficulty: 'normal', actions: forged })).toThrow();
  });

  it('rejects an unfinished match', () => {
    const { actions } = playFullMatch(5, 5, 'easy');
    expect(() => replayAiMatch({ mode: 'ai', matchId: 'm', seed: 5, aiSeed: 5, difficulty: 'easy', actions: actions.slice(0, 10) })).toThrow();
  });

  it('rejects an invalid human action', () => {
    const { actions } = playFullMatch(9, 9, 'easy');
    const forged = actions.slice();
    forged.splice(0, 0, { type: 'ACCEPT_TRUCO', seat: 0 });
    expect(() => replayAiMatch({ mode: 'ai', matchId: 'm', seed: 9, aiSeed: 9, difficulty: 'easy', actions: forged })).toThrow();
  });

  it('seatsToAct never empty while playing', () => {
    const s = createMatch(3);
    expect(seatsToAct(s).length).toBeGreaterThan(0);
  });
});
