import { cardId, cardStrength, type GameAction, type Seat, type SeatView } from '@/domain/game';

/**
 * Relógio da jogada do jogador local.
 *
 * O prazo é local: nenhuma regra depende dele. Quando ele estoura, o cliente faz **pelo próprio
 * assento** a jogada mais conservadora possível — carta mais fraca, correr do truco, entregar a
 * mão de onze — e o motor/servidor valida como qualquer outra ação. O cliente continua sem
 * decidir regra: só escolhe entre as ações que `availableActions` já liberou.
 */
export const TURN_TIMING = {
  /** Tempo para jogar uma carta ou responder a um truco. */
  turnMs: 25_000,
  /** A partir daqui o relógio vira alerta (cor + vibração). */
  warningMs: 5_000,
} as const;

/** Jogada automática quando o tempo acaba. `null` quando não há nada a fazer. */
export function timeoutAction(view: SeatView, seat: Seat): GameAction | null {
  const actions = view.availableActions;
  if (actions.includes('RUN')) return { type: 'RUN', seat };
  if (actions.includes('DECLINE_MAO_DE_ONZE')) return { type: 'DECLINE_MAO_DE_ONZE', seat };
  if (actions.includes('PLAY_CARD') && view.myCards.length > 0) {
    const weakest = [...view.myCards].sort((a, b) => cardStrength(a) - cardStrength(b))[0]!;
    return { type: 'PLAY_CARD', seat, cardId: cardId(weakest) };
  }
  return null;
}

/** "12s" ao lado do avatar (arredonda para cima: só mostra 0s quando o tempo acabou mesmo). */
export function formatTurnClock(ms: number): string {
  return `${Math.ceil(Math.max(0, ms) / 1000)}s`;
}
