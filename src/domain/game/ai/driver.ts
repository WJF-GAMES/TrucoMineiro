import { applyAction, seatsToAct, viewForSeat } from '../engine/engine';
import { Rng } from '../engine/rng';
import { MatchState, Seat } from '../state/types';
import { AIPlayer } from './ai';
import { observe } from './observation';

/**
 * Seat the AI should play for, or undefined when nobody (or a human) must act.
 *
 * A truco call can be answered by either player of the responding team, so the human and their AI
 * partner are both "able to act". The human always has priority: otherwise the partner would answer
 * (accept / raise / run) before the player had a chance to decide.
 */
function aiSeatToAct(state: MatchState, aiSeats: ReadonlyMap<Seat, AIPlayer>): Seat | undefined {
  if (state.status !== 'PLAYING') return undefined;
  const actors = seatsToAct(state);
  if (actors.some((s) => !aiSeats.has(s))) return undefined;
  return actors.find((s) => aiSeats.has(s));
}

/**
 * Advances the match by letting the AI act for every seat in `aiSeats` until a
 * non-AI seat must act (or the match ends). Each AI decision only sees its own view.
 */
export function runAITurns(
  state: MatchState,
  aiSeats: ReadonlyMap<Seat, AIPlayer>,
  rng: Rng,
  maxSteps = 500,
): MatchState {
  let current = state;
  for (let i = 0; i < maxSteps; i++) {
    const aiActor = aiSeatToAct(current, aiSeats);
    if (aiActor === undefined) return current;
    const ai = aiSeats.get(aiActor)!;
    current = applyAction(current, ai.decide(observe(viewForSeat(current, aiActor)), rng));
  }
  throw new Error('runAITurns exceeded maxSteps: possible loop');
}

/** Returns the single next AI action without applying it (used for animated play in the UI). */
export function nextAIAction(state: MatchState, aiSeats: ReadonlyMap<Seat, AIPlayer>, rng: Rng) {
  const aiActor = aiSeatToAct(state, aiSeats);
  if (aiActor === undefined) return null;
  return aiSeats.get(aiActor)!.decide(observe(viewForSeat(state, aiActor)), rng);
}
