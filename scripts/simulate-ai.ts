/**
 * Mass simulation of AI vs AI matches. Looks for deadlocks, loops, impossible states and crashes.
 * Usage: npm run test:sim -- [matches] [difficulty]
 */
import {
  aiForDifficulty,
  AIDifficulty,
  applyAction,
  createMatch,
  createRng,
  getAvailableActions,
  MatchState,
  observe,
  Seat,
  seatsToAct,
  viewForSeat,
} from '../src/domain/game';

const matches = Number(process.argv[2] ?? 2000);
const difficulties: AIDifficulty[] = process.argv[3]
  ? [process.argv[3] as AIDifficulty]
  : ['easy', 'normal', 'hard'];

for (const difficulty of difficulties) {
  const ai = aiForDifficulty(difficulty);
  const rng = createRng(2024);
  let totalSteps = 0;
  let maxSteps = 0;
  let maxHands = 0;
  let team0Wins = 0;
  let trucos = 0;
  const started = Date.now();

  for (let g = 0; g < matches; g++) {
    let state: MatchState = createMatch(g * 7919 + 13);
    let steps = 0;
    while (state.status === 'PLAYING') {
      const actors = seatsToAct(state);
      if (actors.length === 0) throw new Error(`Deadlock at match ${g} version ${state.version}`);
      const seat: Seat = actors[0]!;
      const action = ai.decide(observe(viewForSeat(state, seat)), rng);
      if (!getAvailableActions(state, seat).includes(action.type)) {
        throw new Error(`AI ${difficulty} produced invalid action ${action.type} at match ${g}`);
      }
      if (action.type === 'REQUEST_TRUCO') trucos++;
      state = applyAction(state, action);
      steps++;
      if (steps > 5000) throw new Error(`Loop detected at match ${g}`);
      const totalCards =
        state.hand.hands.reduce((a, h) => a + h.length, 0) +
        state.hand.currentRound.length +
        state.hand.rounds.length * 4;
      const ceremony = state.hand.phase === 'SHUFFLING' || state.hand.phase === 'CUTTING';
      const expectedCards = ceremony ? 0 : 12;
      if (state.hand.phase !== 'FINISHED' && totalCards !== expectedCards)
        throw new Error(`Impossible card count ${totalCards} at match ${g}`);
      if (state.hand.deck.length !== 40) throw new Error(`Deck lost cards at match ${g}`);
    }
    if (state.scores[0] < 12 && state.scores[1] < 12)
      throw new Error('Match finished without a winner');
    totalSteps += steps;
    maxSteps = Math.max(maxSteps, steps);
    maxHands = Math.max(maxHands, state.handsPlayed);
    if (state.winner === 0) team0Wins++;
  }
  const ms = Date.now() - started;
  console.log(
    `[${difficulty}] ${matches} matches OK in ${ms}ms | avg steps ${(totalSteps / matches).toFixed(1)} | max steps ${maxSteps} | max hands ${maxHands} | team0 win rate ${((team0Wins / matches) * 100).toFixed(1)}% | trucos ${trucos}`,
  );
}
