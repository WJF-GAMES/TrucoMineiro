import { useEffect, useMemo, useRef } from 'react';
import type { GameAction, Seat, SeatView } from '@/domain/game';
import { haptic } from '@/utils/haptics';
import { nowMs } from '@/utils/clock';
import { devLog } from '@/utils/devLog';
import { TURN_TIMING, timeoutAction, turnDurationMs } from './turnTimer';

interface Options {
  view: SeatView | null;
  mySeat: Seat;
  /** É a vez do jogador local decidir algo (carta, truco, mão de onze). */
  myMove: boolean;
  /** Cerimônia, vaza sendo mostrada, reconexão: o relógio não corre. */
  paused: boolean;
  act: (action: GameAction) => Promise<void> | void;
}

/**
 * Prazo absoluto (epoch ms) da jogada local, ou `null` quando não é a vez / está pausado.
 *
 * O prazo nasce uma vez por decisão (`view.version` muda a cada ação aceita) e sobrevive a
 * re-renders, a background/foreground e ao relógio do anel — tudo lê o mesmo instante. Quando o
 * tempo acaba, a jogada automática sai pelo mesmo `act` de um toque.
 */
export function useTurnTimer({ view, mySeat, myMove, paused, act }: Options): number | null {
  // No embaralho/corte a decisão é o estágio inteiro: cada mistura muda `version`, mas o prazo
  // é um só ("tempo para embaralhar"). Nas outras fases cada ação aceita abre um prazo novo.
  const ceremonyPhase = view?.phase === 'SHUFFLING' || view?.phase === 'CUTTING';
  const decisionKey =
    view && myMove && !paused
      ? ceremonyPhase
        ? `${view.handNumber}:${view.phase}`
        : `${view.version}`
      : null;
  // Derivado por decisão: nasce no mesmo render em que a vez chega e não muda até a próxima.
  const phase = view?.phase ?? 'PLAY';
  const deadlineAt = useMemo(
    () => (decisionKey === null ? null : nowMs() + turnDurationMs(phase)),
    [decisionKey, phase],
  );

  // Chave viva: se o disparo chegar atrasado (JS travado numa animação pesada) depois de a
  // decisão já ter mudado, a jogada automática é descartada em vez de bater no motor.
  const liveKey = useRef(decisionKey);
  useEffect(() => {
    liveKey.current = decisionKey;
  }, [decisionKey]);

  useEffect(() => {
    if (deadlineAt === null || !view || decisionKey === null) return;
    devLog('TURN_CHANGED', {
      version: view.version,
      phase: view.phase,
      inMs: deadlineAt - Date.now(),
    });
    const warnIn = deadlineAt - TURN_TIMING.warningMs - Date.now();
    const warn = warnIn > 0 ? setTimeout(() => haptic.heavy(), warnIn) : null;
    const fire = setTimeout(
      () => {
        // Um timer por efeito, limpo a cada re-execução: nunca dispara duas vezes para a mesma
        // decisão. Se a jogada não for aceita (online), a vez continua e o jogador age à mão.
        if (liveKey.current !== decisionKey) {
          devLog('TIMEOUT_STALE', { version: view.version, key: decisionKey });
          return;
        }
        const action = timeoutAction(view, mySeat);
        devLog('TIMEOUT', { version: view.version, action: action?.type ?? null });
        if (action) void act(action);
      },
      Math.max(0, deadlineAt - Date.now()),
    );
    return () => {
      if (warn) clearTimeout(warn);
      clearTimeout(fire);
    };
  }, [deadlineAt, decisionKey, view, mySeat, act]);

  return deadlineAt;
}
