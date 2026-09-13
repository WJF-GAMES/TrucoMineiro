import { nextSeat, type Seat } from '@/domain/game';

/**
 * Cerimônia de início de mão: **embaralhar → cortar → distribuir**.
 *
 * É uma etapa de *apresentação*, não de regra. O baralho já vem embaralhado pelo motor
 * (Fisher-Yates com PRNG semeado) ou pelo servidor, e o cliente nunca é autoridade — nada aqui
 * altera cartas, ordem ou resultado. O que a cerimônia faz é dar ao jogador o tempo e o ritual do
 * truco de mesa antes das cartas aparecerem na mão.
 *
 * Módulo sem React: só derivações puras (quem embaralha, quanto falta, quanto já foi feito),
 * fáceis de testar e reutilizáveis pela UI e por um futuro fluxo autoritativo no servidor.
 */

export type CeremonyStage = 'shuffle' | 'cut' | 'deal' | 'done';

/** O que cada assento está fazendo no estágio atual (dirige avatar, halo e microcopy). */
export type SeatCeremonyStatus = 'acting' | 'next' | 'waiting';

export const CEREMONY_TIMING = {
  /** Tempo do jogador da vez para embaralhar antes do fallback automático. */
  shuffleMs: 10_000,
  /** Tempo para cortar. O corte é um gesto único, então é mais curto. */
  cutMs: 8_000,
  /** Últimos segundos em que o contador vira alerta (cor + vibração). */
  warningMs: 4_000,
  /** "Baralho embaralhado!" antes de passar o baralho adiante. */
  successMs: 850,
  /** "Agora é hora de cortar." — respiro entre os estágios. */
  handoffMs: 900,
  /** Cartas voando para os quatro assentos. */
  dealMs: 1_150,
  /** Quanto um bot/adversário demora "embaralhando" (puramente cosmético). */
  remoteShuffleMs: 1_900,
  /** Idem para o corte. */
  remoteCutMs: 1_100,
} as const;

/** Gestos curtos necessários para liberar o botão e para completar sozinho. */
export const SHUFFLE_SWIPES_TO_ARM = 2;
export const SHUFFLE_SWIPES_TO_COMPLETE = 4;

/**
 * Quem embaralha é quem dá as cartas. Quem corta é o jogador seguinte — sempre um adversário
 * do embaralhador (assentos alternam entre as duplas) e o primeiro a jogar na mão, como na mesa.
 */
export function shufflerSeat(dealerSeat: Seat): Seat {
  return dealerSeat;
}

export function cutterSeat(dealerSeat: Seat): Seat {
  return nextSeat(dealerSeat);
}

/** Assento que age no estágio atual; em `deal`/`done` ninguém age. */
export function actorSeatFor(stage: CeremonyStage, dealerSeat: Seat): Seat | null {
  if (stage === 'shuffle') return shufflerSeat(dealerSeat);
  if (stage === 'cut') return cutterSeat(dealerSeat);
  return null;
}

export function seatStatus(
  seat: Seat,
  stage: CeremonyStage,
  dealerSeat: Seat,
): SeatCeremonyStatus {
  if (actorSeatFor(stage, dealerSeat) === seat) return 'acting';
  if (stage === 'shuffle' && cutterSeat(dealerSeat) === seat) return 'next';
  return 'waiting';
}

/** Progresso 0..1 a partir dos gestos curtos já dados. */
export function shuffleProgress(swipes: number): number {
  return Math.min(1, Math.max(0, swipes / SHUFFLE_SWIPES_TO_COMPLETE));
}

export function canFinishShuffle(swipes: number): boolean {
  return swipes >= SHUFFLE_SWIPES_TO_ARM;
}

export function isShuffleComplete(swipes: number): boolean {
  return swipes >= SHUFFLE_SWIPES_TO_COMPLETE;
}

/** Milissegundos restantes, nunca negativo. `null` quando o estágio não tem prazo. */
export function remainingMs(deadlineAt: number | null, now: number): number | null {
  if (deadlineAt === null) return null;
  return Math.max(0, deadlineAt - now);
}

/** 8200ms -> "00:09" (arredonda para cima: o relógio só chega a 00:00 quando o tempo acabou). */
export function formatSeatClock(ms: number): string {
  const total = Math.ceil(Math.max(0, ms) / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function isUrgent(ms: number | null): boolean {
  return ms !== null && ms <= CEREMONY_TIMING.warningMs;
}

/** Duração total do estágio — base do anel de progresso do avatar ativo. */
export function stageDurationMs(stage: CeremonyStage): number | null {
  if (stage === 'shuffle') return CEREMONY_TIMING.shuffleMs;
  if (stage === 'cut') return CEREMONY_TIMING.cutMs;
  return null;
}
