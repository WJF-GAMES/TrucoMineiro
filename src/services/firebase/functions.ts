import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from '@react-native-firebase/functions';
import { EMULATOR_HOST, EMULATOR_PORTS, FUNCTIONS_REGION, USE_EMULATORS, firebaseApp } from './app';
import type { AvatarId, ProgressionResult, AIDifficultyId } from '@/domain/model/types';
import type { GameAction } from '@/domain/game';

const functions = getFunctions(firebaseApp, FUNCTIONS_REGION);

if (USE_EMULATORS) {
  connectFunctionsEmulator(functions, EMULATOR_HOST, EMULATOR_PORTS.functions);
}

export class FunctionsError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'FunctionsError';
  }
}

async function call<Req, Res>(name: string, data: Req): Promise<Res> {
  try {
    const fn = httpsCallable<Req, Res>(functions, name);
    const res = await fn(data);
    return res.data;
  } catch (e) {
    const err = e as { code?: string; message?: string };
    const code = (err.code ?? 'unknown').replace('functions/', '');
    throw new FunctionsError(code, friendlyMessage(code, err.message));
  }
}

function friendlyMessage(code: string, raw?: string): string {
  switch (code) {
    case 'unavailable':
    case 'deadline-exceeded':
      return 'Sem conexão com o servidor. Tente novamente.';
    case 'unauthenticated':
      return 'Sua sessão expirou. Entre novamente.';
    case 'not-found':
      return raw && !raw.includes('INTERNAL') ? raw : 'Não encontrado.';
    case 'failed-precondition':
    case 'invalid-argument':
    case 'permission-denied':
    case 'resource-exhausted':
    case 'already-exists':
      return raw ?? 'Operação não permitida.';
    default:
      return 'Algo deu errado. Tente novamente.';
  }
}

// --- Typed API ---------------------------------------------------------------

export interface BootstrapResult {
  onboarded: boolean;
}
export const bootstrapUser = () =>
  call<Record<string, never>, BootstrapResult>('bootstrapUser', {});

export const updateProfile = (data: { nickname: string; avatarId: AvatarId }) =>
  call<typeof data, { ok: true }>('updateProfile', data);

export const createRoom = () => call<Record<string, never>, { code: string }>('createRoom', {});
export const joinRoom = (code: string) =>
  call<{ code: string }, { code: string }>('joinRoom', { code });
export const leaveRoom = (code: string) =>
  call<{ code: string }, { ok: true }>('leaveRoom', { code });
export const setReady = (code: string, ready: boolean) =>
  call<{ code: string; ready: boolean }, { ok: true }>('setReady', { code, ready });
export const fillRoomWithBots = (code: string) =>
  call<{ code: string }, { ok: true }>('fillRoomWithBots', { code });
export const startMatch = (code: string) =>
  call<{ code: string }, { sessionId: string }>('startMatch', { code });

export const startMatchmaking = (allowBots = false) =>
  call<{ allowBots: boolean }, { ok: true }>('startMatchmaking', { allowBots });
export const advanceBots = (sessionId: string) =>
  call<{ sessionId: string }, SubmitActionResult>('advanceBots', { sessionId });
export const cancelMatchmaking = () =>
  call<Record<string, never>, { ok: true }>('cancelMatchmaking', {});

export interface SubmitActionResult {
  version: number;
  status: 'PLAYING' | 'FINISHED';
}
export const submitGameAction = (sessionId: string, action: GameAction, clientActionId: string) =>
  call<{ sessionId: string; action: GameAction; clientActionId: string }, SubmitActionResult>(
    'submitGameAction',
    {
      sessionId,
      action,
      clientActionId,
    },
  );
export const requestTruco = (sessionId: string, clientActionId: string) =>
  call<{ sessionId: string; clientActionId: string }, SubmitActionResult>('requestTruco', {
    sessionId,
    clientActionId,
  });
export const respondTruco = (
  sessionId: string,
  response: 'ACCEPT_TRUCO' | 'RAISE' | 'RUN',
  clientActionId: string,
) =>
  call<{ sessionId: string; response: string; clientActionId: string }, SubmitActionResult>(
    'respondTruco',
    {
      sessionId,
      response,
      clientActionId,
    },
  );
export const abandonMatch = (sessionId: string) =>
  call<{ sessionId: string }, { ok: true }>('abandonMatch', { sessionId });
export const rejoinMatch = (sessionId: string) =>
  call<{ sessionId: string }, { ok: true }>('rejoinMatch', { sessionId });

export interface FinalizeAiMatchRequest {
  mode?: 'ai';
  matchId: string;
  seed: number;
  aiSeed: number;
  difficulty: AIDifficultyId;
  actions: GameAction[];
}
export interface FinalizeMatchResult {
  alreadyProcessed: boolean;
  winnerTeam: 0 | 1;
  progression: ProgressionResult | null;
}
export const finalizeAiMatch = (req: FinalizeAiMatchRequest) =>
  call<FinalizeAiMatchRequest, FinalizeMatchResult>('finalizeMatch', { ...req, mode: 'ai' });

export const claimReward = (rewardId: string) =>
  call<{ rewardId: string }, { alreadyClaimed: boolean; coins: number }>('claimReward', {
    rewardId,
  });
export const registerDevice = (token: string, platform: string) =>
  call<{ token: string; platform: string }, { ok: true }>('registerDevice', { token, platform });
export const deleteAccount = () => call<Record<string, never>, { ok: true }>('deleteAccount', {});

export const sendFriendRequest = (toUid: string) =>
  call<{ toUid: string }, { ok: true }>('sendFriendRequest', { toUid });
export const respondFriendRequest = (requestId: string, accept: boolean) =>
  call<{ requestId: string; accept: boolean }, { ok: true }>('respondFriendRequest', {
    requestId,
    accept,
  });
export const removeFriend = (friendUid: string) =>
  call<{ friendUid: string }, { ok: true }>('removeFriend', { friendUid });
export const inviteFriendToRoom = (friendUid: string, code: string) =>
  call<{ friendUid: string; code: string }, { ok: true }>('inviteFriendToRoom', {
    friendUid,
    code,
  });
export const purchaseItem = (itemId: string) =>
  call<{ itemId: string }, { ok: true; coins: number; gems: number }>('purchaseItem', { itemId });
