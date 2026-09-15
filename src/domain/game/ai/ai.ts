import { Card, cardId } from '../cards/card';
import { MAX_STRENGTH, cardStrength } from '../rules/strength';
import { GameAction, Seat, Team, teamOf, CutDepth } from '../state/types';
import { Rng } from '../engine/rng';
import { AIObservation } from './observation';

export type AIDifficulty = 'easy' | 'normal' | 'hard';

export interface AIPlayer {
  difficulty: AIDifficulty;
  decide(obs: AIObservation, rng: Rng): GameAction;
}

// ---------------------------------------------------------------------------
// Helpers (only use information present in the observation)
// ---------------------------------------------------------------------------

function sortedByStrength(cards: readonly Card[]): Card[] {
  return cards.slice().sort((a, b) => cardStrength(a) - cardStrength(b));
}

function bestOnTable(obs: AIObservation): { card: Card; seat: Seat } | null {
  let best: { card: Card; seat: Seat } | null = null;
  for (const p of obs.currentRound) {
    if (!best || cardStrength(p.card) > cardStrength(best.card)) {
      best = { card: p.card, seat: p.seat };
    }
  }
  return best;
}

/** 0..1 estimate of how strong the hand is given what is known. */
function handPower(obs: AIObservation): number {
  if (obs.myCards.length === 0) return 0;
  const strengths = obs.myCards.map(cardStrength);
  const max = Math.max(...strengths) / MAX_STRENGTH;
  const avg = strengths.reduce((a, b) => a + b, 0) / strengths.length / MAX_STRENGTH;
  return max * 0.65 + avg * 0.35;
}

function roundsWonBy(obs: AIObservation, team: Team): number {
  return obs.rounds.filter((r) => r.winner === team).length;
}

function opponentOf(team: Team): Team {
  return team === 0 ? 1 : 0;
}

function play(seat: Seat, card: Card): GameAction {
  return { type: 'PLAY_CARD', seat, cardId: cardId(card) };
}

// ---------------------------------------------------------------------------
// Card choice shared by normal/hard
// ---------------------------------------------------------------------------

function chooseCardSmart(obs: AIObservation, aggressive: boolean): Card {
  const mine = sortedByStrength(obs.myCards);
  const lowest = mine[0]!;
  const highest = mine[mine.length - 1]!;
  const table = bestOnTable(obs);
  const ahead = roundsWonBy(obs, obs.team) > roundsWonBy(obs, opponentOf(obs.team));

  if (!table) {
    // Leading the round: lead strong on round one with a good hand, otherwise probe with a low card.
    if (obs.rounds.length === 0) {
      return aggressive || handPower(obs) > 0.6 ? mine[Math.max(0, mine.length - 2)]! : lowest;
    }
    // Later rounds: when ahead, lead the strongest to close the hand.
    return ahead ? highest : lowest;
  }

  const partnerWinning = teamOf(table.seat) === obs.team;
  const tableStrength = cardStrength(table.card);
  if (partnerWinning) {
    // The partner holds the round; only overtake cheaply when the partner's card is weak.
    const cheapBeat = mine.find(
      (c) => cardStrength(c) > tableStrength && cardStrength(c) <= tableStrength + 3,
    );
    return cheapBeat && tableStrength < 8 ? cheapBeat : lowest;
  }

  // Opponent winning: play the weakest card that still beats it; otherwise dump the weakest.
  const beat = mine.find((c) => cardStrength(c) > tableStrength);
  if (beat) return beat;
  const tie = mine.find((c) => cardStrength(c) === tableStrength);
  return tie && obs.rounds.length === 0 ? tie : lowest;
}

// ---------------------------------------------------------------------------
// Difficulties
// ---------------------------------------------------------------------------

const CUT_DEPTHS: readonly CutDepth[] = ['high', 'middle', 'low'];

/**
 * Cerimônia (igual para as três dificuldades): mistura de uma a três vezes — o alvo é sorteado a
 * cada chamada no mesmo RNG, então o replay no servidor reproduz — e corta em algum lugar.
 * `null` quando a vez é de jogar de verdade.
 */
export function ceremonyDecision(obs: AIObservation, rng: Rng): GameAction | null {
  const a = obs.availableActions;
  const seat = obs.seat;
  if (a.includes('SHUFFLE')) {
    const target = 1 + Math.floor(rng.next() * 3);
    return obs.shuffleCount < target ? { type: 'SHUFFLE', seat } : { type: 'FINISH_SHUFFLE', seat };
  }
  if (a.includes('FINISH_SHUFFLE')) return { type: 'FINISH_SHUFFLE', seat };
  if (a.includes('CUT')) {
    // Corta uma ou duas vezes, pelo mesmo critério do embaralhamento, e então fecha.
    const target = 1 + Math.floor(rng.next() * 2);
    if (obs.cutCount < target) {
      const depth = CUT_DEPTHS[Math.floor(rng.next() * CUT_DEPTHS.length)] ?? 'middle';
      return { type: 'CUT', seat, depth };
    }
    return { type: 'FINISH_CUT', seat };
  }
  if (a.includes('FINISH_CUT')) return { type: 'FINISH_CUT', seat };
  return null;
}

export const easyAI: AIPlayer = {
  difficulty: 'easy',
  decide(obs, rng) {
    const ceremony = ceremonyDecision(obs, rng);
    if (ceremony) return ceremony;
    const a = obs.availableActions;
    const seat = obs.seat;
    if (a.includes('ACCEPT_MAO_DE_ONZE')) {
      return { type: rng.next() < 0.5 ? 'ACCEPT_MAO_DE_ONZE' : 'DECLINE_MAO_DE_ONZE', seat };
    }
    if (a.includes('ACCEPT_TRUCO')) {
      const r = rng.next();
      if (r < 0.6) return { type: 'ACCEPT_TRUCO', seat };
      if (r < 0.9 || !a.includes('RAISE')) return { type: 'RUN', seat };
      return { type: 'RAISE', seat };
    }
    if (a.includes('REQUEST_TRUCO') && rng.next() < 0.08) return { type: 'REQUEST_TRUCO', seat };
    const card = obs.myCards[Math.floor(rng.next() * obs.myCards.length)]!;
    return play(seat, card);
  },
};

export const normalAI: AIPlayer = {
  difficulty: 'normal',
  decide(obs, rng) {
    const ceremony = ceremonyDecision(obs, rng);
    if (ceremony) return ceremony;
    const a = obs.availableActions;
    const seat = obs.seat;
    const power = handPower(obs);
    const ahead = roundsWonBy(obs, obs.team) > roundsWonBy(obs, opponentOf(obs.team));
    if (a.includes('ACCEPT_MAO_DE_ONZE')) {
      return { type: power > 0.45 ? 'ACCEPT_MAO_DE_ONZE' : 'DECLINE_MAO_DE_ONZE', seat };
    }
    if (a.includes('ACCEPT_TRUCO')) {
      const score = power + (ahead ? 0.2 : 0);
      if (score > 0.85 && a.includes('RAISE') && rng.next() < 0.5) return { type: 'RAISE', seat };
      if (score > 0.45) return { type: 'ACCEPT_TRUCO', seat };
      return { type: 'RUN', seat };
    }
    if (a.includes('REQUEST_TRUCO')) {
      if ((power > 0.7 && rng.next() < 0.5) || (ahead && power > 0.55 && rng.next() < 0.6)) {
        return { type: 'REQUEST_TRUCO', seat };
      }
    }
    return play(seat, chooseCardSmart(obs, false));
  },
};

export const hardAI: AIPlayer = {
  difficulty: 'hard',
  decide(obs, rng) {
    const ceremony = ceremonyDecision(obs, rng);
    if (ceremony) return ceremony;
    const a = obs.availableActions;
    const seat = obs.seat;
    const power = handPower(obs);
    const opp = opponentOf(obs.team);
    const ahead = roundsWonBy(obs, obs.team) > roundsWonBy(obs, opp);
    const behind = roundsWonBy(obs, obs.team) < roundsWonBy(obs, opp);
    const pointsToWin = 12 - obs.scores[obs.team];
    const oppPointsToWin = 12 - obs.scores[opp];

    if (a.includes('ACCEPT_MAO_DE_ONZE')) {
      return { type: power > 0.4 ? 'ACCEPT_MAO_DE_ONZE' : 'DECLINE_MAO_DE_ONZE', seat };
    }

    if (a.includes('ACCEPT_TRUCO')) {
      const proposed = obs.proposedValue ?? obs.handValue;
      // If running would hand the opponents the match anyway, always accept.
      const desperate = oppPointsToWin <= obs.handValue;
      const score = power + (ahead ? 0.25 : 0) - (behind ? 0.2 : 0) + (desperate ? 1 : 0);
      if (score > 0.9 && a.includes('RAISE') && proposed < pointsToWin + 3 && rng.next() < 0.6) {
        return { type: 'RAISE', seat };
      }
      if (score > 0.5) return { type: 'ACCEPT_TRUCO', seat };
      return { type: 'RUN', seat };
    }

    if (a.includes('REQUEST_TRUCO')) {
      const bluff = rng.next() < 0.12 && obs.rounds.length > 0;
      const strong = power > 0.66 || (ahead && power > 0.5);
      if ((strong && rng.next() < 0.7) || bluff) return { type: 'REQUEST_TRUCO', seat };
    }

    return play(seat, chooseCardSmart(obs, true));
  },
};

export function aiForDifficulty(d: AIDifficulty): AIPlayer {
  return d === 'easy' ? easyAI : d === 'normal' ? normalAI : hardAI;
}
