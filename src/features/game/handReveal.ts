import { useEffect, useState } from 'react';
import type { Card, GameEvent } from '@/domain/game';
import { nowMs } from '@/utils/clock';

/**
 * Revelação das mãos quando a mão acaba sem vazas (hoje: correram da mão de onze).
 *
 * O motor já decidiu e pontuou a mão no mesmo lote (`HAND_REVEALED` → `HAND_ENDED` →
 * `HAND_STARTED`); aqui só se decide por quanto tempo a mesa mostra as cartas de todos antes de a
 * cerimônia da mão seguinte começar. Nada é recalculado a partir disto.
 *
 * São até 12 cartas para ler: com 1,8 s a mesa sumia antes de dar para conferir as mãos. O relógio
 * da jogada e os bots ficam parados enquanto a revelação está na tela (ver `GameTable`), então o
 * tempo extra não come o prazo de ninguém.
 */
export const REVEAL_MS = 5_000;

export interface HandRevealState {
  /** `hands[seat]`: cartas que estavam na mão daquele assento. */
  hands: Card[][];
  until: number;
}

/** Revelação trazida pelo lote, ou `null`. */
export function revealFromBatch(batch: readonly GameEvent[], now: number): HandRevealState | null {
  const e = batch.find((x) => x.type === 'HAND_REVEALED');
  if (!e || e.type !== 'HAND_REVEALED') return null;
  // Payload pode vir com buracos nos arrays (versões antigas): nada de carta `undefined` na mesa.
  const hands = [0, 1, 2, 3].map((seat) => {
    const h = e.hands?.[seat];
    return Array.isArray(h) ? h.filter(Boolean) : [];
  });
  return { hands, until: now + REVEAL_MS };
}

/**
 * A mesa segura a revelação por `REVEAL_MS`. `version` deduplica: um snapshot repetido do servidor
 * (reconexão) com o mesmo lote não revela de novo — quem volta nesse instante segue direto.
 */
export function useHandReveal(
  recentEvents: GameEvent[],
  version: number | null,
): HandRevealState | null {
  const [snap, setSnap] = useState<{
    batch: GameEvent[] | null;
    version: number | null;
    reveal: HandRevealState | null;
  }>({ batch: null, version: null, reveal: null });

  let reveal = snap.reveal;
  if (snap.batch !== recentEvents) {
    const isNew = version !== null && version !== snap.version;
    // O primeiro snapshot (abrir a mesa, reconectar) só registra a versão: nada a revelar de novo.
    const fresh = isNew && snap.version !== null ? revealFromBatch(recentEvents, nowMs()) : null;
    if (fresh) reveal = fresh;
    setSnap({ batch: recentEvents, version: isNew ? version : snap.version, reveal });
  }

  useEffect(() => {
    if (!reveal) return;
    const t = setTimeout(
      () => setSnap((prev) => ({ ...prev, reveal: null })),
      Math.max(0, reveal.until - nowMs()),
    );
    return () => clearTimeout(t);
  }, [reveal]);

  return reveal;
}
