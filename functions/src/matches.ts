import { authedCallable, HttpsError, num, obj, oneOf, str } from './lib/callable';
import { db } from './lib/admin';
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
  seatsToAct,
  teamOf,
} from './domain/game';
import { AvatarId, ProgressionResult } from './domain/model/types';
import { processProgression } from './progression';

const DIFFICULTIES = ['easy', 'normal', 'hard'] as const;
const ACTION_TYPES = [
  'PLAY_CARD',
  'REQUEST_TRUCO',
  'ACCEPT_TRUCO',
  'RAISE',
  'RUN',
  'ACCEPT_MAO_DE_ONZE',
  'DECLINE_MAO_DE_ONZE',
] as const;

export function parseAction(v: unknown): GameAction {
  const o = obj(v, 'action');
  const type = oneOf(o.type, ACTION_TYPES, 'action.type');
  const seat = num(o.seat, 'action.seat');
  if (![0, 1, 2, 3].includes(seat)) throw new Error('action.seat inválido.');
  if (type === 'PLAY_CARD')
    return { type, seat: seat as Seat, cardId: str(o.cardId, 'cardId', 2, 3) };
  return { type, seat: seat as Seat } as GameAction;
}

export interface FinalizeAiRequest {
  mode: 'ai';
  matchId: string;
  seed: number;
  aiSeed: number;
  difficulty: AIDifficulty;
  actions: GameAction[];
}

/**
 * Replays a local AI match on the server. Human actions are validated by the engine and every AI
 * action must equal what the deterministic AI would have produced, so the client cannot forge a win.
 */
export function replayAiMatch(req: FinalizeAiRequest): MatchState {
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
      throw new HttpsError('invalid-argument', 'Ações após o fim da partida.');
    if (aiSeats.has(action.seat)) {
      const expected = nextAIAction(state, aiSeats, rng);
      if (!expected || JSON.stringify(expected) !== JSON.stringify(action)) {
        throw new HttpsError('invalid-argument', 'Jogada da IA não confere com a simulação.');
      }
    } else if (action.seat !== 0) {
      throw new HttpsError('invalid-argument', 'Assento inválido.');
    } else if (!getAvailableActions(state, 0).includes(action.type)) {
      throw new HttpsError('invalid-argument', 'Jogada inválida na sequência.');
    }
    state = applyAction(state, action);
  }
  if (state.status !== 'FINISHED')
    throw new HttpsError('failed-precondition', 'A partida não terminou.');
  return state;
}

export const finalizeMatch = authedCallable<
  FinalizeAiRequest,
  { alreadyProcessed: boolean; winnerTeam: 0 | 1; progression: ProgressionResult | null }
>(
  async ({ uid, data }) => {
    if (data.actions.length > 2000)
      throw new HttpsError('invalid-argument', 'Partida grande demais.');
    const state = replayAiMatch(data);
    const winnerTeam = state.winner!;
    const profile = (await db.doc(`profiles/${uid}`).get()).data() as
      { nickname?: string; avatarId?: AvatarId } | undefined;
    const trucos = data.actions.reduce(
      (acc, a) => {
        if (a.seat !== 0) return acc;
        if (a.type === 'REQUEST_TRUCO' || a.type === 'RAISE') acc.called++;
        if (a.type === 'ACCEPT_TRUCO') acc.accepted++;
        return acc;
      },
      { called: 0, accepted: 0 },
    );
    const result = await processProgression({
      matchId: `${uid}_${data.matchId}`.replace(/[^A-Za-z0-9_-]/g, ''),
      mode: 'ai',
      difficulty: data.difficulty,
      players: [
        {
          uid,
          seat: 0,
          nickname: profile?.nickname ?? 'Você',
          avatarId: profile?.avatarId ?? 'joao',
          bot: false,
        },
        { uid: 'bot1', seat: 1, nickname: 'IA', avatarId: 'seu_ze', bot: true },
        { uid: 'bot2', seat: 2, nickname: 'IA', avatarId: 'maria', bot: true },
        { uid: 'bot3', seat: 3, nickname: 'IA', avatarId: 'tiao', bot: true },
      ],
      scores: state.scores,
      winnerTeam,
      handsPlayed: state.handsPlayed,
      trucosByUid: { [uid]: trucos },
    });
    return {
      alreadyProcessed: result.alreadyProcessed,
      winnerTeam,
      progression: result.byUid[uid] ?? null,
    };
  },
  (d) => {
    const o = obj(d, 'payload');
    if (o.mode !== 'ai')
      throw new Error('mode inválido (use submitGameAction para partidas online).');
    const actions = Array.isArray(o.actions) ? o.actions.map(parseAction) : [];
    return {
      mode: 'ai',
      matchId: str(o.matchId, 'matchId', 4, 80),
      seed: num(o.seed, 'seed'),
      aiSeed: num(o.aiSeed, 'aiSeed'),
      difficulty: oneOf(o.difficulty, DIFFICULTIES, 'difficulty'),
      actions,
    };
  },
);

export { seatsToAct, teamOf };
