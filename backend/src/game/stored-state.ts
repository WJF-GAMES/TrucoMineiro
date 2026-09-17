import {
  GameEvent,
  MatchState,
  createMatch,
  decisionKey,
  turnDurationMs,
} from '../domain/game';

/**
 * Estado privado da partida, guardado em `Match.state` (JSONB). Nunca sai do servidor:
 * os clientes recebem só `viewForSeat`.
 */
export interface StoredState extends MatchState {
  aiRngState: number;
  /** Eventos produzidos pela última ação (a view de reconexão os reapresenta). */
  recent: GameEvent[];
  /** Chave da decisão em curso (o prazo só reinicia quando ela muda). */
  timerKey: string;
  /** Contador de ações aplicadas (sequência de `GameAction`). */
  seq: number;
  /** Última ação aplicada (ritmo da IA). */
  lastActionAt: number;
}

const MAX_STORED_EVENTS = 30;

export function newStoredState(seed: number, aiSeed: number, at: number): StoredState {
  const base = createMatch(seed);
  return {
    ...base,
    aiRngState: aiSeed,
    recent: base.events,
    timerKey: timerKeyOf(base),
    seq: 0,
    lastActionAt: at,
  };
}

export function timerKeyOf(state: MatchState): string {
  return decisionKey({
    phase: state.hand.phase,
    handNumber: state.hand.number,
    version: state.version,
  });
}

export function timerDurationOf(state: MatchState): number {
  return turnDurationMs(state.hand.phase);
}

/** Mantém o JSON pequeno: só os últimos eventos ficam no estado. */
export function trimState(state: StoredState): StoredState {
  return { ...state, events: state.events.slice(-MAX_STORED_EVENTS) };
}

/** Leitura defensiva do JSONB (colunas antigas ou campos ausentes). */
export function readStoredState(raw: unknown): StoredState | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Partial<StoredState>;
  if (!s.hand || !s.config || !Array.isArray(s.scores)) return null;
  return {
    ...(s as StoredState),
    events: Array.isArray(s.events) ? s.events : [],
    recent: Array.isArray(s.recent) ? s.recent : [],
    aiRngState: s.aiRngState ?? 1,
    timerKey: s.timerKey ?? timerKeyOf(s as MatchState),
    seq: s.seq ?? 0,
    lastActionAt: s.lastActionAt ?? 0,
  };
}
