import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AIPlayer,
  GameAction,
  GameEvent,
  MatchState,
  Seat,
  aiForDifficulty,
  applyAction,
  createMatch,
  createRng,
  nextAIAction,
  viewForSeat,
} from '@/domain/game';
import type { AIDifficultyId, AvatarId } from '@/domain/model/types';
import { useProfileStore } from '@/stores/profileStore';
import { logEvent } from '@/services/firebase/analytics';
import { setCrashContext } from '@/services/firebase/crashlytics';
import type { TableController, TablePlayer } from './types';

const AI_DELAY_MS = 900;
const ROUND_END_PAUSE_MS = 1400;

const BOT_NAMES: Record<AIDifficultyId, { seat: Seat; nickname: string; avatarId: AvatarId }[]> = {
  easy: [
    { seat: 1, nickname: 'Seu Zé', avatarId: 'seu_ze' },
    { seat: 2, nickname: 'Maria', avatarId: 'maria' },
    { seat: 3, nickname: 'Caramelo', avatarId: 'cachorro' },
  ],
  normal: [
    { seat: 1, nickname: 'Tião', avatarId: 'tiao' },
    { seat: 2, nickname: 'Maria', avatarId: 'maria' },
    { seat: 3, nickname: 'Seu Antônio', avatarId: 'seu_antonio' },
  ],
  hard: [
    { seat: 1, nickname: 'Galo Carijó', avatarId: 'galo' },
    { seat: 2, nickname: 'Seu Antônio', avatarId: 'seu_antonio' },
    { seat: 3, nickname: 'Tião', avatarId: 'tiao' },
  ],
};

export interface AiMatchRecord {
  matchId: string;
  seed: number;
  aiSeed: number;
  difficulty: AIDifficultyId;
  actions: GameAction[];
}

/**
 * Local match against the AI (seat 0 = human, seats 1-3 = AI; seat 2 is the human's partner).
 * All rule decisions come from the domain engine; this hook only paces AI turns for animation.
 */
export function useAiGame(
  difficulty: AIDifficultyId,
  seed: number,
  onFinished: (state: MatchState, record: AiMatchRecord) => void,
): TableController {
  const profile = useProfileStore((s) => s.profile);
  const [state, setState] = useState<MatchState>(() => createMatch(seed));
  const [busy, setBusy] = useState(false);
  const [recentEvents, setRecentEvents] = useState<GameEvent[]>([]);
  const eventCursor = useRef(0);
  const aiSeed = useMemo(() => (seed * 31 + 7) >>> 0, [seed]);
  const rng = useRef(createRng(aiSeed));
  const actions = useRef<GameAction[]>([]);
  const matchId = useMemo(() => `ai_${seed.toString(36)}_${aiSeed.toString(36)}`, [seed, aiSeed]);
  const finished = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const aiSeats = useMemo(() => {
    const ai: AIPlayer = aiForDifficulty(difficulty);
    return new Map<Seat, AIPlayer>([
      [1, ai],
      [2, ai],
      [3, ai],
    ]);
  }, [difficulty]);

  useEffect(() => {
    setCrashContext({ matchId, gameMode: `ai_${difficulty}` });
    logEvent('match_started', { mode: 'ai', difficulty });
  }, [matchId, difficulty]);

  // Publish new events after every state change.
  useEffect(() => {
    const fresh = state.events.slice(eventCursor.current);
    eventCursor.current = state.events.length;
    if (fresh.length) setRecentEvents(fresh);
    if (state.status === 'FINISHED' && !finished.current) {
      finished.current = true;
      onFinished(state, { matchId, seed, aiSeed, difficulty, actions: actions.current });
    }
  }, [state, onFinished, matchId, seed, aiSeed, difficulty]);

  // Drive AI turns with pacing.
  useEffect(() => {
    if (state.status !== 'PLAYING') return;
    const action = nextAIAction(state, aiSeats, rng.current);
    if (!action) {
      setBusy(false);
      return;
    }
    setBusy(true);
    const lastEvent = state.events[state.events.length - 1];
    const pause =
      lastEvent?.type === 'ROUND_ENDED' ||
      lastEvent?.type === 'HAND_ENDED' ||
      lastEvent?.type === 'HAND_STARTED'
        ? ROUND_END_PAUSE_MS
        : AI_DELAY_MS;
    timer.current = setTimeout(() => {
      actions.current.push(action);
      setState((s) => applyAction(s, action));
    }, pause);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [state, aiSeats]);

  const act = useCallback((action: GameAction) => {
    if (action.type === 'PLAY_CARD') logEvent('card_played', { mode: 'ai' });
    if (action.type === 'REQUEST_TRUCO' || action.type === 'RAISE')
      logEvent('truco_requested', { mode: 'ai' });
    if (action.type === 'ACCEPT_TRUCO') logEvent('truco_accepted', { mode: 'ai' });
    if (action.type === 'RUN') logEvent('truco_rejected', { mode: 'ai' });
    actions.current.push(action);
    setState((s) => applyAction(s, action));
  }, []);

  const view = useMemo(() => viewForSeat(state, 0), [state]);
  const players: TablePlayer[] = useMemo(
    () => [
      {
        seat: 0,
        nickname: profile?.nickname ?? 'Você',
        avatarId: profile?.avatarId ?? 'joao',
        isYou: true,
        bot: false,
        connected: true,
      },
      ...BOT_NAMES[difficulty].map((b) => ({ ...b, isYou: false, bot: true, connected: true })),
    ],
    [profile, difficulty],
  );

  return {
    status: state.status === 'FINISHED' ? 'finished' : 'playing',
    errorMessage: null,
    mySeat: 0,
    view,
    players,
    recentEvents,
    availableActions: view.availableActions,
    busy,
    act,
    leave: () => undefined,
  };
}
