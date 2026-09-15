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
  getAvailableActions,
  nextAIAction,
  viewForSeat,
} from '@/domain/game';
import type { AIDifficultyId, AvatarId } from '@/domain/model/types';
import { useProfileStore } from '@/stores/profileStore';
import { logEvent } from '@/services/firebase/analytics';
import { setCrashContext } from '@/services/firebase/crashlytics';
import type { TableController, TablePlayer } from './types';
import { devLog } from '@/utils/devLog';
import { TRICK_RESOLVE_PAUSE_MS } from './trickPresentation';

/**
 * Quanto um bot "pensa" antes de jogar.
 *
 * Com um valor fixo e curto os três bots respondiam sempre no mesmo compasso, e a mesa inteira
 * passava a sensação de pressa — ninguém na mesa joga em 900 ms, toda vez. A base é mais
 * folgada e cada jogada ganha uma variação própria, derivada da versão da partida: é estável
 * entre renders do mesmo estado (o efeito não pode reagendar sozinho) e reproduzível.
 */
const AI_DELAY_MS = 1_300;
const AI_DELAY_JITTER_MS = 700;
/** Entre uma mistura/corte e o seguinte a IA leva um tempo humano. */
const AI_SHUFFLE_MS = 1_250;
const AI_SHUFFLE_JITTER_MS = 500;
// Depois de uma vaza fechar a mesa ainda mostra a quarta carta, a vencedora e o recolhimento.
const ROUND_END_PAUSE_MS = TRICK_RESOLVE_PAUSE_MS;

/** Variação determinística em [0, span) a partir da versão da partida. */
function pacingJitter(version: number, span: number): number {
  // Hash inteiro simples: versões vizinhas não caem em valores vizinhos.
  const h = Math.imul(version ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  return (h % 1000) * (span / 1000);
}

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
  // View e eventos novos saem do mesmo objeto de estado: a mesa nunca vê a view de uma ação sem
  // o lote de eventos dela (era assim que a vaza velha ficava na mesa por um render a mais).
  const [snapshot, setSnapshot] = useState<{ state: MatchState; recentEvents: GameEvent[] }>(
    () => ({ state: createMatch(seed), recentEvents: [] }),
  );
  const { state, recentEvents } = snapshot;
  const apply = useCallback((action: GameAction) => {
    devLog(action.type, {
      seat: action.seat,
      ...('cardId' in action ? { card: action.cardId } : {}),
    });
    setSnapshot((prev) => {
      // Toques atrasados, timers velhos e closures antigas chegam aqui com ações que a mesa já
      // não aceita. O motor lança nesse caso — e lançar dentro do updater derruba a árvore
      // inteira (tela em branco). A ação inválida é ignorada e registrada.
      if (!getAvailableActions(prev.state, action.seat).includes(action.type)) {
        devLog('REJECTED', {
          type: action.type,
          seat: action.seat,
          version: prev.state.version,
          phase: prev.state.hand.phase,
        });
        return prev;
      }
      const next = applyAction(prev.state, action);
      // O registro da partida (verificado no servidor) só leva ações aceitas. O updater pode
      // rodar duas vezes com o mesmo objeto: o dedupe por referência evita a duplicata.
      if (actions.current[actions.current.length - 1] !== action) actions.current.push(action);
      const recentEvents = next.events.slice(prev.state.events.length);
      devLog('EVENTS', recentEvents.map((e) => e.type).join(','), { version: next.version });
      return { state: next, recentEvents };
    });
  }, []);
  const [busy, setBusy] = useState(false);
  const [botsPaused, setBotsPaused] = useState(false);
  const aiSeed = useMemo(() => (seed * 31 + 7) >>> 0, [seed]);
  const rng = useRef(createRng(aiSeed));
  const actions = useRef<GameAction[]>([]);
  const matchId = useMemo(() => `ai_${seed.toString(36)}_${aiSeed.toString(36)}`, [seed, aiSeed]);
  const finished = useRef(false);

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

  useEffect(() => {
    if (state.status === 'FINISHED' && !finished.current) {
      finished.current = true;
      onFinished(state, { matchId, seed, aiSeed, difficulty, actions: actions.current });
    }
  }, [state, onFinished, matchId, seed, aiSeed, difficulty]);

  // Drive AI turns with pacing. `busy` = há uma jogada de IA agendada. Ela é desligada na limpeza
  // do efeito: assim uma pausa (cerimônia) que cancela o timer não deixa a mesa travada em "busy".
  const commitBusy = useCallback((b: boolean) => setBusy(b), []);
  useEffect(() => {
    if (state.status !== 'PLAYING' || botsPaused) return;
    // Truco pedido contra nós ou mão de onze: a dupla inteira pode responder, mas quem decide é o
    // humano — senão a parceira IA responde em 900 ms e o jogador nunca vê os botões.
    if (state.hand.phase !== 'PLAY' && getAvailableActions(state, 0).length > 0) return;
    const action = nextAIAction(state, aiSeats, rng.current);
    if (!action) return;
    commitBusy(true);
    const lastEvent = state.events[state.events.length - 1];
    const pause =
      lastEvent?.type === 'ROUND_ENDED' || lastEvent?.type === 'HAND_ENDED'
        ? ROUND_END_PAUSE_MS
        : state.hand.phase === 'SHUFFLING' || state.hand.phase === 'CUTTING'
          ? AI_SHUFFLE_MS + pacingJitter(state.version, AI_SHUFFLE_JITTER_MS)
          : AI_DELAY_MS + pacingJitter(state.version, AI_DELAY_JITTER_MS);
    const timer = setTimeout(() => apply(action), pause);
    return () => {
      clearTimeout(timer);
      commitBusy(false);
    };
  }, [state, aiSeats, botsPaused, apply, commitBusy]);

  const act = useCallback(
    (action: GameAction) => {
      if (action.type === 'PLAY_CARD') logEvent('card_played', { mode: 'ai' });
      if (action.type === 'REQUEST_TRUCO' || action.type === 'RAISE')
        logEvent('truco_requested', { mode: 'ai' });
      if (action.type === 'ACCEPT_TRUCO') logEvent('truco_accepted', { mode: 'ai' });
      if (action.type === 'RUN') logEvent('truco_rejected', { mode: 'ai' });
      apply(action);
    },
    [apply],
  );

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
    setBotsPaused,
  };
}
