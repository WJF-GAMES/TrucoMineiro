import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GameAction, GameEvent, Seat, SeatView } from '@/domain/game';
import { cutterSeatOf } from '@/domain/game';
import { haptic } from '@/utils/haptics';
import { nowMs } from '@/utils/clock';
import { devLog } from '@/utils/devLog';
import { CEREMONY_TIMING, type CeremonyStage, type CutDepth } from './shuffleCeremony';
import { TURN_TIMING } from './turnTimer';

/**
 * O que a mesa precisa saber sobre a cerimônia de início de mão — embaralhar → cortar →
 * distribuir. A interface é a mesma que a tela sempre consumiu; a diferença é a fonte: tudo vem
 * do **motor** (`view.phase`, `deckVersion`, `shuffleCount`), não de uma máquina local.
 */
export interface ShuffleCeremony {
  active: boolean;
  stage: CeremonyStage;
  dealerSeat: Seat | null;
  actorSeat: Seat | null;
  iAmActor: boolean;
  /** 0..1 da mistura (três misturas = cheio). */
  progress: number;
  /** O estágio já pode ser fechado: uma mistura no embaralho, sempre no corte. */
  canFinish: boolean;
  /** Estágio terminado, a transição está a caminho (só a distribuição usa). */
  celebrating: boolean;
  timedOut: boolean;
  /** Prazo do jogador local no estágio (`null` para os outros assentos ou sem prazo). */
  deadlineAt: number | null;
  stageTotalMs: number | null;
  /** Quantas vezes o baralho já foi misturado nesta mão. */
  shuffleCount: number;
  /** Quantas vezes o baralho já foi cortado nesta mão. */
  cutCount: number;
  /** Uma mistura ou um corte foi pedido e ainda não voltou do motor/servidor. */
  shuffleBusy: boolean;
  /**
   * "EMBARALHAR NOVAMENTE" / "CORTAR": uma mistura ou um corte real no motor.
   * Como o embaralhamento, o corte pode ser repetido quantas vezes o jogador quiser enquanto o
   * prazo do estágio não acabar — cada um sobre o baralho que o anterior deixou.
   */
  bump: () => void;
  /** "ESTÁ BOM" / "CONFIRMAR CORTE": fecha o estágio. */
  finish: () => void;
  /** Onde cortar: a profundidade que o próximo corte usa. */
  cutDepth: CutDepth;
  setCutDepth: (d: CutDepth) => void;
}

interface Options {
  view: SeatView | null;
  mySeat: Seat;
  recentEvents: GameEvent[];
  /** Prazo da decisão local (vem do relógio de turno). */
  deadlineAt: number | null;
  act: (action: GameAction) => Promise<void> | void;
  /** A mesa está ocupada (vaza sendo mostrada, contagem inicial): a cerimônia espera. */
  held: boolean;
}

const INACTIVE: Omit<ShuffleCeremony, 'bump' | 'finish' | 'setCutDepth'> = {
  active: false,
  stage: 'done',
  dealerSeat: null,
  actorSeat: null,
  iAmActor: false,
  progress: 0,
  canFinish: false,
  celebrating: false,
  timedOut: false,
  deadlineAt: null,
  stageTotalMs: null,
  shuffleCount: 0,
  cutCount: 0,
  shuffleBusy: false,
  cutDepth: 'middle',
};

/**
 * Cerimônia dirigida pelo motor.
 *
 * - `SHUFFLING` → estágio "shuffle": o dealer mistura quantas vezes quiser (`SHUFFLE`) e fecha
 *   (`FINISH_SHUFFLE`). Cada mistura muda o baralho de verdade; `shuffleCount`/`deckVersion` vêm
 *   da view.
 * - `CUTTING` → estágio "cut": o assento seguinte corta (`CUT` com a profundidade escolhida) e o
 *   motor distribui na mesma ação.
 * - "deal" é o único estágio local: depois do `CUT_DONE` a mesa mostra as cartas voando por
 *   `CEREMONY_TIMING.dealMs` antes de liberar a mão.
 */
export function useCeremony({ view, mySeat, recentEvents, deadlineAt, act, held }: Options) {
  const [cutDepth, setCutDepth] = useState<CutDepth>('middle');

  // Distribuição: começa quando o lote traz o corte (derivado no render, como a apresentação da
  // vaza) e dura o tempo da animação.
  const [dealSnap, setDealSnap] = useState<{ batch: GameEvent[] | null; until: number | null }>({
    batch: null,
    until: null,
  });
  let dealingUntil = dealSnap.until;
  if (dealSnap.batch !== recentEvents) {
    const cut = recentEvents.some((e) => e.type === 'CUT_DONE');
    dealingUntil = cut ? nowMs() + CEREMONY_TIMING.dealMs : dealSnap.until;
    if (cut) devLog('CEREMONY_STAGE', 'deal', { hand: view?.handNumber ?? null });
    setDealSnap({ batch: recentEvents, until: dealingUntil });
  }
  useEffect(() => {
    if (dealingUntil === null) return;
    const t = setTimeout(
      () => setDealSnap((prev) => ({ ...prev, until: null })),
      Math.max(0, dealingUntil - nowMs()),
    );
    return () => clearTimeout(t);
  }, [dealingUntil]);

  // Uma mistura por vez: o botão trava até o motor/servidor responder (ou 1,2 s, por segurança).
  const [shuffleBusy, setShuffleBusy] = useState(false);
  const commitBusy = useCallback((b: boolean) => setShuffleBusy(b), []);
  const shuffleCount = view?.shuffleCount ?? 0;
  const cutCount = view?.cutCount ?? 0;
  // A trava vale para os dois gestos repetíveis: o contador que mudou libera o botão de novo.
  const gestureCount = shuffleCount + cutCount;
  const seenCount = useRef(gestureCount);
  useEffect(() => {
    if (gestureCount !== seenCount.current) {
      seenCount.current = gestureCount;
      commitBusy(false);
    }
  }, [gestureCount, commitBusy]);
  useEffect(() => {
    if (!shuffleBusy) return;
    const t = setTimeout(() => commitBusy(false), 1200);
    return () => clearTimeout(t);
  }, [shuffleBusy, commitBusy]);

  const phase = view?.phase;
  const stage: CeremonyStage =
    dealingUntil !== null
      ? 'deal'
      : phase === 'SHUFFLING'
        ? 'shuffle'
        : phase === 'CUTTING'
          ? 'cut'
          : 'done';
  const active = !!view && stage !== 'done' && !held;
  const dealerSeat = view?.dealerSeat ?? null;
  const actorSeat: Seat | null =
    dealerSeat === null || stage === 'deal' || stage === 'done'
      ? null
      : stage === 'shuffle'
        ? dealerSeat
        : cutterSeatOf(dealerSeat);
  const iAmActor = actorSeat === mySeat;

  useEffect(() => {
    if (active && stage !== 'deal') devLog('CEREMONY_STAGE', stage, { dealer: dealerSeat });
  }, [active, stage, dealerSeat]);

  const bump = useCallback(() => {
    if (!view || !iAmActor || shuffleBusy) return;
    if (stage === 'shuffle') {
      if (!view.availableActions.includes('SHUFFLE')) return;
      commitBusy(true);
      haptic.light();
      devLog('SHUFFLE', { count: view.shuffleCount + 1 });
      void act({ type: 'SHUFFLE', seat: mySeat });
      return;
    }
    if (stage === 'cut') {
      if (!view.availableActions.includes('CUT')) return;
      commitBusy(true);
      haptic.light();
      devLog('CUT', { count: view.cutCount + 1, depth: cutDepth });
      void act({ type: 'CUT', seat: mySeat, depth: cutDepth });
    }
  }, [view, iAmActor, stage, shuffleBusy, commitBusy, act, mySeat, cutDepth]);

  // `finish` chega por gesto (runOnJS) e pode ser entregue atrasado, com a closure de um render
  // antigo: decide sempre pela view viva e fecha cada estágio (mão:fase) uma vez só.
  const liveView = useRef(view);
  useEffect(() => {
    liveView.current = view;
  }, [view]);
  const finishedFor = useRef<string | null>(null);
  const finish = useCallback(() => {
    const live = liveView.current;
    if (!live) return;
    const key = `${live.handNumber}:${live.phase}`;
    if (finishedFor.current === key) return;
    let action: GameAction | null = null;
    if (live.phase === 'SHUFFLING' && live.availableActions.includes('FINISH_SHUFFLE')) {
      if (live.shuffleCount < 1) return;
      devLog('CEREMONY_COMPLETE', 'shuffle', { count: live.shuffleCount });
      action = { type: 'FINISH_SHUFFLE', seat: mySeat };
    } else if (live.phase === 'CUTTING' && live.availableActions.includes('FINISH_CUT')) {
      devLog('CEREMONY_COMPLETE', 'cut', { count: live.cutCount, depth: cutDepth });
      // Sem nenhum corte no prazo, o motor corta no meio ao fechar: o corte nunca é pulado.
      action = { type: 'FINISH_CUT', seat: mySeat };
    }
    if (!action) return;
    finishedFor.current = key;
    haptic.medium();
    // Online, se o servidor recusar, o estágio volta a aceitar o gesto.
    Promise.resolve(act(action)).catch(() => {
      if (finishedFor.current === key) finishedFor.current = null;
    });
  }, [act, mySeat, cutDepth]);

  return useMemo<ShuffleCeremony>(() => {
    if (!active) return { ...INACTIVE, bump, finish, setCutDepth, cutDepth };
    const totalMs =
      stage === 'shuffle' ? TURN_TIMING.shuffleMs : stage === 'cut' ? TURN_TIMING.cutMs : null;
    return {
      active: true,
      stage,
      dealerSeat,
      actorSeat,
      iAmActor,
      progress: stage === 'cut' ? Math.min(1, cutCount / 2) : Math.min(1, shuffleCount / 3),
      // O corte pode ser fechado a qualquer momento: quem não cortar leva o corte no meio.
      canFinish: stage === 'cut' ? true : shuffleCount >= 1,
      celebrating: stage === 'deal',
      timedOut: false,
      deadlineAt: iAmActor ? deadlineAt : null,
      stageTotalMs: totalMs,
      shuffleCount,
      cutCount,
      shuffleBusy,
      bump,
      finish,
      cutDepth,
      setCutDepth,
    };
  }, [
    active,
    stage,
    dealerSeat,
    actorSeat,
    iAmActor,
    shuffleCount,
    cutCount,
    shuffleBusy,
    deadlineAt,
    bump,
    finish,
    cutDepth,
  ]);
}
