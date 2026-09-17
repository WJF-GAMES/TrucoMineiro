import {
  AIDifficulty,
  GameAction,
  MatchState,
  Seat,
  aiForDifficulty,
  applyAction,
  createMatch,
  createRng,
  getAvailableActions,
  nextAIAction,
} from '../domain/game';
import { AppError } from '../common/errors';

/**
 * Tudo o que um cliente pode mandar — inclusive a cerimônia (`SHUFFLE`/`FINISH_SHUFFLE`/`CUT`/
 * `FINISH_CUT`), que abre toda mão.
 */
export const ACTION_TYPES = [
  'SHUFFLE',
  'FINISH_SHUFFLE',
  'CUT',
  'FINISH_CUT',
  'PLAY_CARD',
  'PLAY_CARD_COVERED',
  'REQUEST_TRUCO',
  'ACCEPT_TRUCO',
  'RAISE',
  'RUN',
  'ACCEPT_MAO_DE_ONZE',
  'DECLINE_MAO_DE_ONZE',
] as const;

const CUT_DEPTHS = ['high', 'middle', 'low'] as const;
/** Id de carta do motor: posto + naipe (`7C`, `AE`, `QO`). */
const CARD_ID = /^[4-7QJKA23][PCEO]$/;

function invalid(message: string): never {
  throw new AppError('VALIDATION_FAILED', message);
}

/** Valida a forma da ação (a regra em si é do motor). */
export function parseAction(v: unknown): GameAction {
  if (!v || typeof v !== 'object' || Array.isArray(v)) invalid('action inválido.');
  const o = v as Record<string, unknown>;
  const type = o.type;
  if (typeof type !== 'string' || !(ACTION_TYPES as readonly string[]).includes(type))
    invalid('action.type inválido.');
  const seat = o.seat;
  if (typeof seat !== 'number' || ![0, 1, 2, 3].includes(seat)) invalid('action.seat inválido.');
  if (type === 'PLAY_CARD' || type === 'PLAY_CARD_COVERED') {
    const cardId = o.cardId;
    if (typeof cardId !== 'string' || cardId.length < 2 || cardId.length > 3 || !CARD_ID.test(cardId))
      invalid('cardId inválido.');
    return { type, seat: seat as Seat, cardId };
  }
  if (type === 'CUT') {
    if (o.depth === undefined) return { type, seat: seat as Seat };
    if (typeof o.depth !== 'string' || !(CUT_DEPTHS as readonly string[]).includes(o.depth))
      invalid('action.depth inválido.');
    return { type, seat: seat as Seat, depth: o.depth as (typeof CUT_DEPTHS)[number] };
  }
  return { type, seat: seat as Seat } as GameAction;
}

export interface AiReplayRequest {
  seed: number;
  aiSeed: number;
  difficulty: AIDifficulty;
  actions: GameAction[];
}

export const MAX_AI_ACTIONS = 2000;

/**
 * Re-executa uma partida local contra a IA. Ações humanas são validadas pelo motor e cada ação da
 * IA precisa ser exatamente a que a IA determinística produziria: o cliente não forja vitória.
 */
export function replayAiMatch(req: AiReplayRequest): MatchState {
  if (req.actions.length > MAX_AI_ACTIONS) throw new AppError('MATCH_TOO_LONG', 'Partida grande demais.');
  const ai = aiForDifficulty(req.difficulty);
  const aiSeats = new Map<Seat, typeof ai>([
    [1, ai],
    [2, ai],
    [3, ai],
  ]);
  const rng = createRng(req.aiSeed);
  let state = createMatch(req.seed);
  for (const action of req.actions) {
    if (state.status !== 'PLAYING')
      throw new AppError('AI_REPLAY_MISMATCH', 'Ações após o fim da partida.');
    if (aiSeats.has(action.seat)) {
      const expected = nextAIAction(state, aiSeats, rng);
      if (!expected || JSON.stringify(expected) !== JSON.stringify(action))
        throw new AppError('AI_REPLAY_MISMATCH', 'Jogada da IA não confere com a simulação.');
    } else if (action.seat !== 0) {
      throw new AppError('AI_REPLAY_MISMATCH', 'Assento inválido.');
    } else if (!getAvailableActions(state, 0).includes(action.type)) {
      throw new AppError('AI_REPLAY_MISMATCH', 'Jogada inválida na sequência.');
    }
    try {
      state = applyAction(state, action);
    } catch (e) {
      throw new AppError('AI_REPLAY_MISMATCH', (e as Error).message);
    }
  }
  if (state.status !== 'FINISHED') throw new AppError('MATCH_NOT_FINISHED', 'A partida não terminou.');
  return state;
}
