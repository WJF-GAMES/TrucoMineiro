import { normalizeSeatView, normalizeSessionMeta } from '../normalizeSeatView';

/**
 * Realtime Database never stores empty arrays or nulls: a seat view written with
 * `currentRound: []` comes back without the key. The table crashed with
 * "Cannot convert undefined value to object" before these were restored.
 */
describe('normalizeSeatView', () => {
  const sparse = {
    seat: 2,
    phase: 'PLAY',
    turnSeat: 3,
    handNumber: 1,
    handValue: 1,
    scores: [0, 0],
    status: 'PLAYING',
    version: 7,
    // myCards, cardCounts, currentRound, rounds, availableActions and recentEvents are all missing
  };

  it('restores every array the UI iterates over', () => {
    const v = normalizeSeatView(sparse)!;
    expect(v.myCards).toEqual([]);
    expect(v.cardCounts).toEqual([0, 0, 0, 0]);
    expect(v.currentRound).toEqual([]);
    expect(v.rounds).toEqual([]);
    expect(v.availableActions).toEqual([]);
    expect(v.recentEvents).toEqual([]);
    expect(v.seat).toBe(2);
    expect(v.team).toBe(0);
    expect(v.version).toBe(7);
  });

  it('keeps real data and drops holes inside arrays', () => {
    const v = normalizeSeatView({
      ...sparse,
      myCards: [{ rank: '3', suit: 'paus' }],
      cardCounts: [1, undefined, 3, 0],
      currentRound: [null, { seat: 1, card: { rank: '4', suit: 'paus' } }],
      rounds: [{ winner: 1, winnerSeat: 1, plays: undefined }],
      availableActions: ['PLAY_CARD'],
    })!;
    expect(v.myCards).toHaveLength(1);
    expect(v.cardCounts).toEqual([1, 0, 3, 0]);
    expect(v.currentRound).toHaveLength(1);
    expect(v.rounds[0]).toEqual({ winner: 1, winnerSeat: 1, plays: [] });
    expect(v.availableActions).toEqual(['PLAY_CARD']);
  });

  it('rejects payloads that are not a seat view', () => {
    expect(normalizeSeatView(null)).toBeNull();
    expect(normalizeSeatView(undefined)).toBeNull();
    expect(normalizeSeatView({})).toBeNull();
    expect(normalizeSeatView({ seat: 0 })).toBeNull();
  });
});

describe('normalizeSessionMeta', () => {
  it('fills the player map and defaults connected to true', () => {
    const meta = normalizeSessionMeta({
      id: 's1',
      status: 'playing',
      players: {
        '0': { uid: 'u1', seat: 0, nickname: 'Joao', avatarId: 'joao' },
        '1': {
          uid: 'bot1',
          seat: 1,
          nickname: 'IA',
          avatarId: 'seu_ze',
          bot: true,
          connected: false,
        },
        '2': null,
      },
    })!;
    expect(Object.keys(meta.players)).toEqual(['0', '1']);
    expect(meta.players['0']!.connected).toBe(true);
    expect(meta.players['1']!.bot).toBe(true);
    expect(meta.players['1']!.connected).toBe(false);
    expect(meta.roomCode).toBeNull();
  });

  it('rejects payloads without a status', () => {
    expect(normalizeSessionMeta(null)).toBeNull();
    expect(normalizeSessionMeta({ id: 'x' })).toBeNull();
  });
});
