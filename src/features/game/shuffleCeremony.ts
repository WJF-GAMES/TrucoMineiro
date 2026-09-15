import { nextSeat, type Seat } from '@/domain/game';
import { TURN_TIMING } from './turnTimer';

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

/**
 * Distribuição: doze cartas saem do baralho uma a uma e pousam onde vão ficar; no fim, as do
 * jogador local viram no lugar.
 */
export const DEAL_TIMING = {
  /** Intervalo entre uma carta e a seguinte saindo do baralho. */
  staggerMs: 110,
  /** Voo do baralho até o destino. */
  flyMs: 360,
  /** Respiro antes de virar as minhas cartas. */
  flipDelayMs: 140,
  /** Virada das minhas cartas no lugar. */
  flipMs: 340,
} as const;

export const DEAL_TOTAL_MS =
  DEAL_TIMING.staggerMs * 11 + DEAL_TIMING.flyMs + DEAL_TIMING.flipDelayMs + DEAL_TIMING.flipMs;

export const CEREMONY_TIMING = {
  /**
   * Prazos dos estágios. Quem manda no relógio é `TURN_TIMING` (é dele que sai o `deadlineAt`
   * de verdade, em `useCeremony`/`useTurnTimer`): aqui são só apelidos, para o anel de progresso
   * e o contador desenharem exatamente o mesmo tempo que o motor cobra. Duplicar o número faria
   * a barra andar num ritmo e o prazo acabar noutro.
   */
  shuffleMs: TURN_TIMING.shuffleMs,
  cutMs: TURN_TIMING.cutMs,
  /** Últimos segundos em que o contador vira alerta (cor + vibração). */
  warningMs: 5_000,
  /** "Baralho embaralhado!" antes de passar o baralho adiante. */
  successMs: 1_100,
  /** "Agora é hora de cortar." — respiro entre os estágios. */
  handoffMs: 1_200,
  /**
   * Cartas voando para os quatro assentos: derivado de `DEAL_TOTAL_MS` com uma folga, para a
   * mesa real só assumir depois de a última carta pousar. Antes era um número solto que precisava
   * ser lembrado a cada ajuste da animação.
   */
  dealMs: DEAL_TOTAL_MS + 180,
  /** Quanto um bot/adversário demora "embaralhando" (puramente cosmético). */
  remoteShuffleMs: 2_200,
  /** Idem para o corte. */
  remoteCutMs: 1_500,
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

export function seatStatus(seat: Seat, stage: CeremonyStage, dealerSeat: Seat): SeatCeremonyStatus {
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

/**
 * Onde cortar — alto (poucas cartas de cima), no meio ou baixo (a maior parte de cima).
 * Apresentação pura: o motor/servidor já definiu a ordem; isto só desenha o monte de cima com
 * mais ou menos cartas e dá ao jogador a sensação de escolha do truco de mesa.
 */
export type CutDepth = 'high' | 'middle' | 'low';

export const CUT_DEPTHS: readonly {
  id: CutDepth;
  label: string;
  description: string;
  /** Cartas desenhadas no monte de cima (de um total de `CUT_STACK_CARDS`). */
  topCards: number;
}[] = [
  { id: 'high', label: 'Corte alto', description: 'Tira poucas cartas de cima', topCards: 1 },
  { id: 'middle', label: 'Corte no meio', description: 'Divide o baralho ao meio', topCards: 2 },
  { id: 'low', label: 'Corte baixo', description: 'Tira a maior parte de cima', topCards: 3 },
];

export const CUT_STACK_CARDS = 4;

export function cutSplit(depth: CutDepth): { top: number; bottom: number } {
  const top = CUT_DEPTHS.find((d) => d.id === depth)?.topCards ?? 2;
  return { top, bottom: CUT_STACK_CARDS - top };
}
