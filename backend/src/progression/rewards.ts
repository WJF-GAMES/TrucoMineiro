import type { AIDifficultyId } from '../domain/model/types';

export interface RewardTable {
  xpWin: number;
  xpLoss: number;
  /** Pontos da liga na semana. Nunca negativos: o ranking semanal só acumula. */
  lpWin: number;
  lpLoss: number;
}

export const REWARDS: Record<'online' | AIDifficultyId, RewardTable> = {
  online: { xpWin: 80, xpLoss: 30, lpWin: 25, lpLoss: 8 },
  easy: { xpWin: 30, xpLoss: 10, lpWin: 5, lpLoss: 1 },
  normal: { xpWin: 60, xpLoss: 20, lpWin: 10, lpLoss: 3 },
  hard: { xpWin: 90, xpLoss: 30, lpWin: 15, lpLoss: 5 },
};
