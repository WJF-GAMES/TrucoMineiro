import { useEffect, useState } from 'react';
import type { GameEvent, SeatView } from '@/domain/game';
import { nowMs } from '@/utils/clock';
import { devLog } from '@/utils/devLog';
import {
  EMPTY_TRICK,
  advance,
  nextWakeAt,
  presentTrick,
  type TrickPresentation,
} from './trickPresentation';

interface Snapshot {
  view: SeatView | null;
  batch: GameEvent[];
  /** `view.version` cujo lote já foi apresentado: um snapshot repetido do servidor não re-segura. */
  consumedVersion: number | null;
  trick: TrickPresentation;
}

/**
 * Mantém a vaza fechada na mesa pelo tempo da apresentação (quarta carta → vencedora → recolher).
 * Ver `trickPresentation.ts` para o porquê.
 *
 * A apresentação é derivada no render em que a view/lote mudam (estado ajustado durante o
 * render, sem efeito); só o relógio — segurar → recolher → limpar — passa por timers.
 */
export function useTrickPresentation(
  view: SeatView | null,
  recentEvents: GameEvent[],
): TrickPresentation {
  const [snap, setSnap] = useState<Snapshot>({
    view: null,
    batch: [],
    consumedVersion: null,
    trick: EMPTY_TRICK,
  });

  let trick = snap.trick;
  if (snap.view !== view || snap.batch !== recentEvents) {
    // No modo IA a view muda num render e o lote no seguinte (mesma versão); online os dois vêm
    // juntos, mas um snapshot repetido traz o mesmo lote de novo. A versão desempata os dois casos.
    const batchIsNew =
      !!view && snap.batch !== recentEvents && snap.consumedVersion !== view.version;
    trick = view ? presentTrick(snap.trick, view, recentEvents, batchIsNew, nowMs()) : EMPTY_TRICK;
    if (trick.phase !== snap.trick.phase || trick.plays.length !== snap.trick.plays.length) {
      devLog(trick.phase === 'resolved' ? 'TRICK_RESOLVED' : 'TRICK', trick.phase, {
        plays: trick.plays.length,
        winnerSeat: trick.resolved?.winnerSeat ?? null,
        leading: trick.leadingSeat,
      });
    }
    setSnap({
      view,
      batch: recentEvents,
      consumedVersion: batchIsNew && view ? view.version : snap.consumedVersion,
      trick,
    });
  }

  useEffect(() => {
    const wakeAt = nextWakeAt(trick);
    if (wakeAt === null) return;
    const t = setTimeout(
      () => setSnap((prev) => ({ ...prev, trick: advance(prev.trick, Date.now()) })),
      Math.max(0, wakeAt - Date.now()),
    );
    return () => clearTimeout(t);
  }, [trick]);

  return trick;
}
