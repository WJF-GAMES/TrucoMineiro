import type { ActionType, GameAction, GameEvent, Seat, SeatView } from '@/domain/game';
import type { AvatarId } from '@/domain/model/types';

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
}
