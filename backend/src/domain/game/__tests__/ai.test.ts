import { cardId } from '../cards/card';
import { aiForDifficulty, AIDifficulty } from '../ai/ai';
import { runAITurns } from '../ai/driver';
import { observe } from '../ai/observation';
import {
  applyAction,
  createMatch,
  getAvailableActions,
  seatsToAct,
  viewForSeat,
  skipCeremony,
} from '../engine/engine';
import { createRng } from '../engine/rng';
import { MatchState, Seat } from '../state/types';

/** Mão já embaralhada e cortada: os testes de jogo começam com as cartas na mão. */
const dealt = (seed: number, targetScore?: number) => skipCeremony(createMatch(seed, targetScore));

const ALL: AIDifficulty[] = ['easy', 'normal', 'hard'];

function fullAITable(d: AIDifficulty) {
  const ai = aiForDifficulty(d);
  return new Map<Seat, typeof ai>([
    [0, ai],
    [1, ai],
    [2, ai],
    [3, ai],
  ]);
}

describe.each(ALL)('AI %s', (difficulty) => {
  it('only produces actions that the engine allows and finishes 300 matches', () => {
    const rng = createRng(1234);
    for (let g = 0; g < 300; g++) {
      let state: MatchState = dealt(g);
      let steps = 0;
      while (state.status === 'PLAYING') {
        const actors = seatsToAct(state);
        expect(actors.length).toBeGreaterThan(0);
        const seat = actors[0]!;
        const obs = observe(viewForSeat(state, seat));
        const action = aiForDifficulty(difficulty).decide(obs, rng);
        expect(action.seat).toBe(seat);
        expect(getAvailableActions(state, seat)).toContain(action.type);
        if (action.type === 'PLAY_CARD') {
          expect(state.hand.hands[seat]!.map(cardId)).toContain(action.cardId);
        }
        state = applyAction(state, action);
        steps++;
        expect(steps).toBeLessThan(2000);
      }
      expect(state.winner === 0 || state.winner === 1).toBe(true);
      expect(Math.max(...state.scores)).toBe(12);
    }
  });

  it('never sees hidden cards: the observation contains only its own hand', () => {
    const state = dealt(77);
    const obs = observe(viewForSeat(state, 1));
    const json = JSON.stringify(obs);
    for (const seat of [0, 2, 3] as Seat[]) {
      for (const c of state.hand.hands[seat]!) expect(json).not.toContain(`"${cardId(c)}"`);
    }
    expect(obs.myCards).toHaveLength(3);
  });
});

describe('runAITurns', () => {
  it('stops when a human seat must act', () => {
    const ai = aiForDifficulty('normal');
    const aiSeats = new Map<Seat, typeof ai>([
      [1, ai],
      [2, ai],
      [3, ai],
    ]);
    const s = runAITurns(dealt(5), aiSeats, createRng(5));
    // Seat 0 leads hand 1, so nothing happens until the human plays.
    expect(seatsToAct(s)).toEqual([0]);
    const played = applyAction(s, {
      type: 'PLAY_CARD',
      seat: 0,
      cardId: cardId(s.hand.hands[0]![0]!),
    });
    const after = runAITurns(played, aiSeats, createRng(6));
    expect(after.status === 'FINISHED' || seatsToAct(after).includes(0)).toBe(true);
  });

  it('completes a full AI vs AI match', () => {
    const s = runAITurns(dealt(8), fullAITable('hard'), createRng(8), 5000);
    expect(s.status).toBe('FINISHED');
  });
});
