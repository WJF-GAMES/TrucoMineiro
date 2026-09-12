import { cardId } from '../cards/card';
import { aiForDifficulty } from '../ai/ai';
import { nextAIAction, runAITurns } from '../ai/driver';
import { observe } from '../ai/observation';
import {
  applyAction,
  createMatch,
  getAvailableActions,
  seatsToAct,
  viewForSeat,
} from '../engine/engine';
import { createRng } from '../engine/rng';
import { MatchState, Seat, teamOf } from '../state/types';

/**
 * Reproduces what the app does in a match against the AI: seat 0 is human, seats 1-3 are AI, and the
 * driver applies ONE AI action at a time (as useAiGame does with its timer) instead of running a
 * whole loop. A stall here would freeze the table on the device.
 */
describe('single-step AI driver (useAiGame flow)', () => {
  const aiSeats = () => {
    const ai = aiForDifficulty('normal');
    return new Map<Seat, typeof ai>([
      [1, ai],
      [2, ai],
      [3, ai],
    ]);
  };

  it('never stalls: every state has either an AI action or a human action available', () => {
    const seats = aiSeats();
    for (let g = 0; g < 200; g++) {
      const rng = createRng(g * 7919 + 3);
      const humanRng = createRng(g * 104729 + 11);
      let state: MatchState = createMatch(g * 31 + 5);
      let steps = 0;

      while (state.status === 'PLAYING') {
        const action = nextAIAction(state, seats, rng);
        if (action) {
          expect(seats.has(action.seat)).toBe(true);
          state = applyAction(state, action);
        } else {
          // No AI may act, so a human seat must be able to — otherwise the table is frozen.
          const humanActors = seatsToAct(state).filter((s) => !seats.has(s));
          expect(humanActors.length).toBeGreaterThan(0);
          const seat = humanActors[0]!;
          const human = aiForDifficulty('normal').decide(
            observe(viewForSeat(state, seat)),
            humanRng,
          );
          expect(getAvailableActions(state, seat)).toContain(human.type);
          state = applyAction(state, human);
        }
        steps++;
        expect(steps).toBeLessThan(3000);
      }
      expect(state.winner === 0 || state.winner === 1).toBe(true);
    }
  });

  it('leaves the truco answer to the human instead of letting the AI partner decide', () => {
    // Seats 0 (human) and 2 (AI) are partners: when the opponents call truco both may answer.
    const seats = aiSeats();
    let sawSharedResponsibility = false;

    for (let g = 0; g < 400 && !sawSharedResponsibility; g++) {
      const rng = createRng(g * 13 + 1);
      const humanRng = createRng(g * 7 + 5);
      let state = createMatch(g * 17 + 2);
      let steps = 0;

      while (state.status === 'PLAYING' && steps < 2000) {
        const actors = seatsToAct(state);
        if (state.hand.phase === 'TRUCO_RESPONSE' && actors.includes(0) && actors.includes(2)) {
          sawSharedResponsibility = true;
          // The driver must stand down so the UI can offer accept / raise / run to the player.
          expect(nextAIAction(state, seats, rng)).toBeNull();
          expect(runAITurns(state, seats, rng)).toBe(state);
          break;
        }
        const action = nextAIAction(state, seats, rng);
        if (action) {
          state = applyAction(state, action);
        } else {
          const seat = actors.find((s) => !seats.has(s))!;
          state = applyAction(
            state,
            aiForDifficulty('normal').decide(observe(viewForSeat(state, seat)), humanRng),
          );
        }
        steps++;
      }
    }
    expect(sawSharedResponsibility).toBe(true);
  });

  it('still plays for the AI when only AI seats can act', () => {
    const seats = aiSeats();
    const rng = createRng(99);
    const state = createMatch(42);
    // Hand 1 starts with seat 0 (human) leading, so no AI may act yet.
    expect(seatsToAct(state)).toEqual([0]);
    expect(nextAIAction(state, seats, rng)).toBeNull();

    const played = applyAction(state, {
      type: 'PLAY_CARD',
      seat: 0,
      cardId: cardId(state.hand.hands[0]![0]!),
    });
    const next = nextAIAction(played, seats, rng);
    expect(next).not.toBeNull();
    expect(teamOf(next!.seat)).toBe(1);
  });
});
