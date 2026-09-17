import type { ActionType, GameAction, GameEvent, Seat, SeatView } from '@/domain/game';
import type { AvatarId, ProgressionResult } from '@/domain/model/types';

export interface TablePlayer {
  seat: Seat;
  nickname: string;
  avatarId: AvatarId;
  isYou: boolean;
  bot: boolean;
  connected: boolean;
}

export type TableStatus =
  'loading' | 'playing' | 'finished' | 'reconnecting' | 'error' | 'abandoned';

/** What the table UI needs, regardless of the match being local (AI) or online. */
export interface TableController {
  status: TableStatus;
  errorMessage: string | null;
  mySeat: Seat;
  view: SeatView | null;
  players: TablePlayer[];
  /** Latest engine events since the previous view (for toasts/animations). */
  recentEvents: GameEvent[];
  /** Actions the local player may take right now (mirrors view.availableActions). */
  availableActions: ActionType[];
  /** True while a submitted action is in flight or AI is "thinking". */
  busy: boolean;
  act: (action: GameAction) => Promise<void> | void;
  leave: () => Promise<void> | void;
  /**
   * Segura as jogadas automáticas (IA local / bots do servidor) enquanto a mesa roda a cerimônia
   * de início de mão. Sem isso os bots jogariam por trás do baralho e a mão já começaria andada.
   */
  setBotsPaused: (paused: boolean) => void;
  /** Rewards computed by the server (online only; the AI mode gets them from finalizeMatch). */
  progression?: ProgressionResult | null;
  /**
   * Online: prazo oficial da decisão atual, já convertido para o relógio do aparelho
   * (`turnDeadlineAt - serverTime + recebido em`), amarrado à versão da view que o trouxe.
   */
  serverDeadline?: { version: number; at: number } | null;
}
