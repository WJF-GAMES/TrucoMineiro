import type { Seat } from '@/domain/game';

/** Posição na mesa **relativa ao jogador local**: ele é sempre o de baixo. */
export type TablePosition = 'bottom' | 'right' | 'top' | 'left';

export function relativePosition(seat: Seat, mySeat: Seat): TablePosition {
  const rel = (seat - mySeat + 4) % 4;
  return rel === 0 ? 'bottom' : rel === 1 ? 'right' : rel === 2 ? 'top' : 'left';
}
