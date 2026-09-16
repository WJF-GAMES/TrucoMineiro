import { normalizeStoredState } from '../src/lib/rtdbState';
import {
  applyAction,
  cardId,
  createMatch,
  getAvailableActions,
  MatchState,
  parseCardId,
  skipCeremony,
} from '../src/domain/game';

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
  // Mão já embaralhada e cortada: o round-trip que importa aqui é o da mesa jogando.
  const fresh = {
    ...skipCeremony(createMatch(1234)),
    appliedActionIds: {},
    aiRngState: 7,
    trucos: {},
  };

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
    expect(state.hand.deck).toHaveLength(40);
    expect(state.hand.deckVersion).toBe(1);
    expect(state.scores).toEqual([0, 0]);
  });

  it('keeps the shuffled deck across the round-trip during the ceremony', () => {
    const shuffling = {
      ...applyAction(createMatch(99), { type: 'SHUFFLE', seat: 3 }),
      appliedActionIds: {},
      aiRngState: 7,
      trucos: {},
    };
    const state = normalizeStoredState(stripEmpties(shuffling))!;
    expect(state.hand.phase).toBe('SHUFFLING');
    expect(state.hand.shuffleCount).toBe(1);
    expect(state.hand.deck.map(cardId)).toEqual(shuffling.hand.deck.map(cardId));
    expect(state.hand.hands.map((h) => h.length)).toEqual([0, 0, 0, 0]);
    expect(getAvailableActions(state, 3)).toEqual(['SHUFFLE', 'FINISH_SHUFFLE']);
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

  it('mantém o desempate por cango (quem abre e a maior carta obrigatória) no round-trip', () => {
    const base = skipCeremony(createMatch(1234));
    const hands = [
      ['KO', '5O'],
      ['KP', '2P'],
      ['4O', '3O'],
      ['4C', '6C'],
    ].map((h) => h.map(parseCardId));
    let s = { ...base, hand: { ...base.hand, hands } };
    for (const [seat, c] of [
      [0, 'KO'],
      [1, 'KP'],
      [2, '4O'],
      [3, '4C'],
    ] as const)
      s = applyAction(s, { type: 'PLAY_CARD', seat, cardId: c });
    const stored = { ...s, appliedActionIds: {}, aiRngState: 7, trucos: {} };
    const back = normalizeStoredState(stripEmpties(stored))!;
    expect(back.hand.tieBreak).toEqual({ causedBySeat: 1, round: 1 });
    expect(back.hand.turnSeat).toBe(1);
    // "Reconexão": o estado relido continua bloqueando a carta menor.
    expect(() => applyAction(back, { type: 'PLAY_CARD', seat: 1, cardId: 'KP' })).toThrow();
    expect(() => applyAction(back, { type: 'PLAY_CARD', seat: 1, cardId: '2P' })).not.toThrow();

    // Fora do desempate a chave some no RTDB e volta como null.
    const normal = normalizeStoredState(stripEmpties(fresh))!;
    expect(normal.hand.tieBreak).toBeNull();
    // Mão decidida no desempate: o resultado guarda como foi decidida.
    let end = back;
    for (const [seat, c] of [
      [1, '2P'],
      [2, '3O'],
      [3, '6C'],
      [0, '5O'],
    ] as const)
      end = {
        ...applyAction(end, { type: 'PLAY_CARD', seat, cardId: c }),
        appliedActionIds: {},
        aiRngState: 7,
        trucos: {},
      };
    const ended = normalizeStoredState(stripEmpties(end))!;
    expect(ended.hand.tieBreak).toBeNull();
    expect(ended.scores).toEqual([1, 0]);
    const handEnded = ended.events.find((e) => e.type === 'HAND_ENDED');
    expect(handEnded).toMatchObject({ result: { winner: 0, decidedBy: 'CANGO_TIE_BREAK' } });
  });

  it('carta virada sobrevive ao round-trip e continua valendo o mínimo', () => {
    const base = skipCeremony(createMatch(1234));
    const hands = [
      ['4P', '5O'],
      ['4O', '5C'],
      ['4E', '6E'],
      ['QP', '5P'],
    ].map((h) => h.map(parseCardId));
    let s = { ...base, hand: { ...base.hand, hands } };
    s = applyAction(s, { type: 'PLAY_CARD_COVERED', seat: 0, cardId: '4P' });
    const back = normalizeStoredState(
      stripEmpties({ ...s, appliedActionIds: {}, aiRngState: 7, trucos: {} }),
    )!;
    expect(back.hand.currentRound).toEqual([{ seat: 0, card: parseCardId('4P'), covered: true }]);
    let end: MatchState = back;
    for (const [seat, c] of [
      [1, '4O'],
      [2, '4E'],
      [3, '5P'],
    ] as const)
      end = applyAction(end, { type: 'PLAY_CARD', seat, cardId: c });
    // Zap virado não vence: a vaza é do time 1 (assento 3 com o 5, maior que o 4 aberto).
    expect(end.hand.rounds[0]).toMatchObject({ winner: 1, winnerSeat: 3 });
  });

  it('rejects garbage', () => {
    expect(normalizeStoredState(null)).toBeNull();
    expect(normalizeStoredState(undefined)).toBeNull();
    expect(normalizeStoredState('nope')).toBeNull();
  });
});

/**
 * A publicação das views é uma escrita separada da transação do estado, então duas ações
 * aplicadas quase juntas podem chegar lá fora de ordem. `advanceBots` é chamado por qualquer
 * jogador da sessão, num timer, e corre contra a carta que um humano acabou de jogar.
 */
describe('shouldPublishViews', () => {
  const { shouldPublishViews } = jest.requireActual('../src/sessions') as {
    shouldPublishViews: (published: unknown, next: number) => boolean;
  };

  it('publica quando ainda não há nada publicado', () => {
    expect(shouldPublishViews(undefined, 0)).toBe(true);
    expect(shouldPublishViews(null, 7)).toBe(true);
  });

  it('publica versões mais novas', () => {
    expect(shouldPublishViews(10, 11)).toBe(true);
  });

  it('republica a mesma versão (o caminho idempotente reescreve sem estragar nada)', () => {
    expect(shouldPublishViews(11, 11)).toBe(true);
  });

  it('recusa voltar atrás: a mesa não pode reaparecer numa versão anterior', () => {
    expect(shouldPublishViews(12, 11)).toBe(false);
    expect(shouldPublishViews(2, 1)).toBe(false);
  });
});

/**
 * Segurança da carta virada no multiplayer: cada assento recebe a própria view e o próprio lote de
 * eventos. Nenhum payload de outro assento pode carregar a identidade da carta.
 */
describe('buildViews (carta virada)', () => {
  const { buildViews } = jest.requireActual('../src/sessions') as {
    buildViews: (state: unknown, recent: unknown[]) => Record<string, unknown>;
  };

  it('só quem jogou vê a carta virada, na view e nos eventos', () => {
    const base = skipCeremony(createMatch(77));
    const hands = [
      ['4P', '5O'],
      ['4O', '5C'],
      ['7C', '5E'],
      ['QP', '5P'],
    ].map((h) => h.map(parseCardId));
    const before = { ...base, hand: { ...base.hand, hands } };
    const after = applyAction(before, { type: 'PLAY_CARD_COVERED', seat: 0, cardId: '4P' });
    const recent = after.events.slice(before.events.length);
    const views = buildViews({ ...after, appliedActionIds: {}, aiRngState: 0, trucos: {} }, recent);
    const zap = /"rank":"4","suit":"paus"/;
    expect(JSON.stringify(views['0'])).toMatch(zap);
    for (const seat of ['1', '2', '3']) expect(JSON.stringify(views[seat])).not.toMatch(zap);
    expect((views['2'] as { currentRound: unknown[] }).currentRound).toEqual([
      { seat: 0, card: null, covered: true },
    ]);
  });
});
