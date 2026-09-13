import { normalizeStoredState } from '../src/lib/rtdbState';
import { applyAction, cardId, createMatch, getAvailableActions } from '../src/domain/game';

jest.mock('../src/lib/admin', () => ({
  db: {},
  rtdb: {},
  auth: {},
  messaging: {},
  REGION: 'southamerica-east1',
  DB_TRIGGER_REGION: 'us-central1',
  IS_EMULATOR: true,
  ENFORCE_APP_CHECK: false,
  now: () => Date.now(),
}));

/**
 * Realtime Database drops empty arrays, empty objects and nulls. Reproduces that by removing those
 * keys from a real match state and checks the engine can still run on what comes back — before this,
 * `applyAction` crashed inside the transaction with "spread of undefined" and every online play was
 * rejected with "Essa jogada não é permitida agora".
 */
function stripEmpties<T>(value: T): T | undefined {
  if (Array.isArray(value)) {
    const arr = value.map(stripEmpties).filter((v) => v !== undefined);
    return (arr.length ? arr : undefined) as T | undefined;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const cleaned = stripEmpties(v);
      if (cleaned !== undefined && cleaned !== null) out[k] = cleaned;
    }
    return (Object.keys(out).length ? out : undefined) as T | undefined;
  }
  return value === null ? undefined : value;
}

describe('normalizeStoredState (Realtime Database round-trip)', () => {
  const fresh = { ...createMatch(1234), appliedActionIds: {}, aiRngState: 7, trucos: {} };

  it('restores the containers RTDB removed', () => {
    const asStored = stripEmpties(fresh) as Record<string, unknown>;
    // What RTDB really gives back: no currentRound, no rounds, no truco, no appliedActionIds.
    const hand = asStored.hand as Record<string, unknown>;
    expect(hand.currentRound).toBeUndefined();
    expect(hand.rounds).toBeUndefined();
    expect(hand.truco).toBeUndefined();
    expect(asStored.appliedActionIds).toBeUndefined();

    const state = normalizeStoredState(asStored)!;
    expect(state.hand.currentRound).toEqual([]);
    expect(state.hand.rounds).toEqual([]);
    expect(state.hand.truco).toBeNull();
    expect(state.hand.maoDeOnzeTeam).toBeNull();
    expect(state.appliedActionIds).toEqual({});
    expect(state.trucos).toEqual({});
    expect(state.hand.hands.map((h) => h.length)).toEqual([3, 3, 3, 3]);
    expect(state.scores).toEqual([0, 0]);
  });

  it('lets the engine play from a normalized state', () => {
    const state = normalizeStoredState(stripEmpties(fresh))!;
    expect(getAvailableActions(state, 0)).toContain('PLAY_CARD');
    const card = cardId(state.hand.hands[0]![0]!);
    const next = applyAction(state, { type: 'PLAY_CARD', seat: 0, cardId: card });
    expect(next.hand.currentRound).toHaveLength(1);
    expect(next.version).toBe(state.version + 1);
  });

  it('survives a state in the middle of a hand', () => {
    let s = normalizeStoredState(stripEmpties(fresh))!;
    for (let i = 0; i < 4; i++) {
      const seat = s.hand.turnSeat;
      s = {
        ...applyAction(s, {
          type: 'PLAY_CARD',
          seat,
          cardId: cardId(s.hand.hands[seat]![0]!),
        }),
        appliedActionIds: {},
        aiRngState: 7,
        trucos: {},
      };
      s = normalizeStoredState(stripEmpties(s))!;
    }
    expect(s.hand.rounds).toHaveLength(1);
    expect(getAvailableActions(s, s.hand.turnSeat).length).toBeGreaterThan(0);
  });

  it('rejects garbage', () => {
    expect(normalizeStoredState(null)).toBeNull();
    expect(normalizeStoredState(undefined)).toBeNull();
    expect(normalizeStoredState('nope')).toBeNull();
  });
});
