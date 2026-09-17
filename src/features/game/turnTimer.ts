/**
 * Relógio da jogada do jogador local. A regra (prazos e jogada automática) é do domínio e é a
 * mesma que o servidor aplica quando o prazo vence — ver `domain/game/rules/timing.ts`.
 */
export { TURN_TIMING, decisionKey, timeoutAction, turnDurationMs } from '@/domain/game';

/** "12s" ao lado do avatar (arredonda para cima: só mostra 0s quando o tempo acabou mesmo). */
export function formatTurnClock(ms: number): string {
  return `${Math.ceil(Math.max(0, ms) / 1000)}s`;
}
