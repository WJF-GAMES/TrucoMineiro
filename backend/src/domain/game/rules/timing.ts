import { cardId } from '../cards/card';
import type { GameAction, HandPhase, Seat } from '../state/types';
import { cardStrength } from './strength';
import type { SeatView } from '../engine/engine';

/**
 * Relógio da jogada — regra única do cliente e do servidor.
 *
 * O servidor é a autoridade: guarda o início e o prazo de cada decisão e, se o prazo vencer, faz
 * **pelo assento** a jogada mais conservadora possível — carta mais fraca, correr do truco,
 * entregar a mão de onze. O cliente mostra o mesmo prazo e pode antecipar a jogada automática;
 * nos dois casos o motor valida como qualquer outra ação. No desempate por cango a única carta
 * liberada é a maior, então é ela que sai (nunca uma aleatória).
 */
export const TURN_TIMING = {
  /**
   * Tempo para jogar uma carta ou responder a um truco.
   *
   * Ritmo de mesa, não de relógio de xadrez: o jogador precisa ler as cartas na mesa, o placar,
   * quanto vale a mão e só então decidir. Com 25 s a partida passava a sensação de pressa.
   */
  turnMs: 30_000,
  /**
   * Tempo para embaralhar (quantas vezes quiser) antes de o sistema fechar sozinho.
   * São vários gestos seguidos mais a decisão de parar — o prazo é o mais longo da cerimônia.
   */
  shuffleMs: 15_000,
  /** Tempo para cortar: escolher entre alto/meio/baixo e confirmar. */
  cutMs: 12_000,
  /** A partir daqui o relógio vira alerta (cor + vibração). */
  warningMs: 6_000,
  /**
   * Folga do servidor além do prazo do cliente: animações (cerimônia, vaza sendo mostrada) pausam
   * o relógio do aparelho e a rede atrasa a jogada automática dele.
   */
  serverGraceMs: 6_000,
} as const;

/** Duração do prazo conforme o que o jogador tem de decidir. */
export function turnDurationMs(phase: HandPhase): number {
  if (phase === 'SHUFFLING') return TURN_TIMING.shuffleMs;
  if (phase === 'CUTTING') return TURN_TIMING.cutMs;
  return TURN_TIMING.turnMs;
}

/**
 * Chave da decisão em curso. No embaralho/corte a decisão é o estágio inteiro (cada mistura muda a
 * versão, mas o prazo é um só); nas outras fases cada ação aceita abre um prazo novo.
 */
export function decisionKey(view: Pick<SeatView, 'phase' | 'handNumber' | 'version'>): string {
  return view.phase === 'SHUFFLING' || view.phase === 'CUTTING'
    ? `${view.handNumber}:${view.phase}`
    : `${view.version}`;
}

/** Jogada automática quando o tempo acaba. `null` quando não há nada a fazer. */
export function timeoutAction(view: SeatView, seat: Seat): GameAction | null {
  const actions = view.availableActions;
  // Cerimônia: o tempo acabou → fecha o embaralhamento com o baralho como está / corta no meio.
  if (actions.includes('FINISH_SHUFFLE')) return { type: 'FINISH_SHUFFLE', seat };
  // `FINISH_CUT` corta no meio sozinho quando ninguém cortou: um único fechamento para o estágio.
  if (actions.includes('FINISH_CUT')) return { type: 'FINISH_CUT', seat };
  if (actions.includes('RUN')) return { type: 'RUN', seat };
  if (actions.includes('DECLINE_MAO_DE_ONZE')) return { type: 'DECLINE_MAO_DE_ONZE', seat };
  const playable = view.myCards.filter((c) => view.playableCardIds.includes(cardId(c)));
  if (actions.includes('PLAY_CARD') && playable.length > 0) {
    const weakest = [...playable].sort((a, b) => cardStrength(a) - cardStrength(b))[0]!;
    return { type: 'PLAY_CARD', seat, cardId: cardId(weakest) };
  }
  return null;
}
