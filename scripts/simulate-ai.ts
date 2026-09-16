/**
 * Mass simulation of AI vs AI matches. Looks for deadlocks, loops, impossible states and crashes.
 * Usage: npm run test:sim -- [matches] [difficulty]
 */
import {
  aiForDifficulty,
  AIDifficulty,
  applyAction,
  cardStrength,
  createMatch,
  createRng,
  getAvailableActions,
  MatchState,
  observe,
  parseCardId,
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
  let tieBreakPlays = 0;
  let coveredPlays = 0;
  let reveals = 0;
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
      // Carta virada nunca no desempate por cango.
      if (action.type === 'PLAY_CARD_COVERED') {
        if (state.hand.tieBreak) throw new Error(`Covered card in tie-break at match ${g}`);
        coveredPlays++;
      }
      // Desempate por cango: toda carta jogada é a maior da mão de quem joga.
      if (action.type === 'PLAY_CARD' && state.hand.tieBreak) {
        const max = Math.max(...state.hand.hands[seat]!.map(cardStrength));
        if (cardStrength(parseCardId(action.cardId)) !== max)
          throw new Error(`Tie-break played a lower card at match ${g}`);
        tieBreakPlays++;
      }
      const eventsBefore = state.events.length;
      state = applyAction(state, action);
      steps++;
      for (const e of state.events.slice(eventsBefore)) {
        if (e.type !== 'HAND_REVEALED') continue;
        reveals++;
        const ids = new Set(e.hands.flat().map((c) => `${c.rank}${c.suit}`));
        if (ids.size !== 12) throw new Error(`Reveal with ${ids.size} cards at match ${g}`);
      }
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
      // O desempate só existe no meio de uma mão, depois de uma vaza cangada.
      if (
        state.hand.tieBreak &&
        state.hand.phase !== 'PLAY' &&
        state.hand.phase !== 'TRUCO_RESPONSE'
      )
        throw new Error(`Tie-break leaked into phase ${state.hand.phase} at match ${g}`);
      if (state.hand.tieBreak && state.hand.rounds.at(-1)?.winner !== null)
        throw new Error(`Tie-break without a tied trick at match ${g}`);
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
    `[${difficulty}] ${matches} matches OK in ${ms}ms | avg steps ${(totalSteps / matches).toFixed(1)} | max steps ${maxSteps} | max hands ${maxHands} | team0 win rate ${((team0Wins / matches) * 100).toFixed(1)}% | trucos ${trucos} | desempates (cartas) ${tieBreakPlays} | viradas ${coveredPlays} | revelações ${reveals}`,
  );
}
