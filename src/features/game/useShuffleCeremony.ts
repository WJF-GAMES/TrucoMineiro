import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Seat } from '@/domain/game';
import { haptic } from '@/utils/haptics';
import { devLog } from '@/utils/devLog';
import {
  CEREMONY_TIMING,
  CeremonyStage,
  actorSeatFor,
  canFinishShuffle,
  isShuffleComplete,
  shuffleProgress,
  stageDurationMs,
} from './shuffleCeremony';

/** Marca "embaralhado" quando o estágio fecha, independente de quantos gestos houve. */
const SWIPES_DONE = 99;

export interface ShuffleCeremonyOptions {
  /** Muda a cada nova mão: é o gatilho da cerimônia. */
  handNumber: number;
  /** `null` enquanto a mesa carrega. */
  dealerSeat: Seat | null;
  mySeat: Seat;
  /**
   * Só roda quando a mão está de fato começando (nada jogado, três cartas na mão). Entrar numa
   * partida em andamento — reconexão, rejoin — chega aqui como `false` e a mesa aparece direto.
   */
  eligible: boolean;
  /** Congela o relógio enquanto a mesa reconecta: ninguém perde a vez por causa da rede. */
  paused?: boolean;
  /**
   * Prazo vindo do servidor, quando existir. Sem ele o prazo é local — aceitável porque nenhuma
   * regra depende dele: o estouro só dispara a mesma conclusão automática em qualquer cliente.
   */
  serverDeadlineAt?: number | null;
}

export interface ShuffleCeremony {
  active: boolean;
  stage: CeremonyStage;
  dealerSeat: Seat | null;
  actorSeat: Seat | null;
  iAmActor: boolean;
  /** 0..1 do embaralhamento (também anima o progresso de quem embaralha do outro lado). */
  progress: number;
  canFinish: boolean;
  /** Flash de "feito!" entre um estágio e o próximo. */
  celebrating: boolean;
  /** O estágio terminou pelo relógio, não pelo jogador. */
  timedOut: boolean;
  /** `null` quando o estágio não tem prazo ou o relógio está congelado (reconexão). */
  deadlineAt: number | null;
  stageTotalMs: number | null;
  /** Um gesto curto de embaralhar. Ignorado quando não é a vez do jogador local. */
  bump: () => void;
  /** "FINALIZAR EMBARALHAMENTO" / corte confirmado. */
  finish: () => void;
}

interface CeremonyState {
  handNumber: number;
  dealerSeat: Seat;
  stage: CeremonyStage;
  swipes: number;
  celebrating: boolean;
  timedOut: boolean;
  deadlineAt: number | null;
}

const INACTIVE: ShuffleCeremony = {
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
  bump: () => undefined,
  finish: () => undefined,
};

/**
 * Máquina de estados da cerimônia de início de mão.
 *
 * `shuffle` → `cut` → `deal` → `done`. Cada estágio fecha de três formas: o jogador conclui, o
 * relógio estoura (conclusão automática, sem punição) ou o assento é de um bot/adversário e a
 * conclusão é encenada. Em `done` a mesa volta ao normal e as cartas entram na mão.
 */
export function useShuffleCeremony({
  handNumber,
  dealerSeat,
  mySeat,
  eligible,
  paused = false,
  serverDeadlineAt = null,
}: ShuffleCeremonyOptions): ShuffleCeremony {
  const [state, setState] = useState<CeremonyState | null>(null);
  const stateRef = useRef<CeremonyState | null>(null);
  const timers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const frozenMs = useRef<number | null>(null);

  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current.clear();
  }, []);

  const schedule = useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(() => {
      timers.current.delete(id);
      fn();
    }, ms);
    timers.current.add(id);
  }, []);

  const commit = useCallback((next: CeremonyState | null) => {
    stateRef.current = next;
    setState(next);
  }, []);

  // Refs para que um timer já agendado sempre chame a versão atual das transições.
  const enterStageRef = useRef<(stage: CeremonyStage, base: CeremonyState) => void>(() => undefined);
  const completeRef = useRef<(timedOut: boolean) => void>(() => undefined);

  useEffect(() => () => clearTimers(), [clearTimers]);

  // --- Transições -----------------------------------------------------------

  /** Entra num estágio: define o prazo, agenda o estouro e, se o assento for remoto, o "robô". */
  const enterStage = useCallback(
    (stage: CeremonyStage, base: CeremonyState) => {
      clearTimers();
      frozenMs.current = null;

      if (stage === 'done') {
        commit(null);
        return;
      }

      const total = stageDurationMs(stage);
      const next: CeremonyState = {
        ...base,
        stage,
        swipes: 0,
        celebrating: false,
        timedOut: false,
        deadlineAt: total === null ? null : (serverDeadlineAt ?? Date.now() + total),
      };
      commit(next);
      devLog('CEREMONY_STAGE', stage, { hand: next.handNumber, dealer: next.dealerSeat });

      if (stage === 'deal') {
        schedule(() => enterStageRef.current('done', next), CEREMONY_TIMING.dealMs);
        return;
      }

      if (actorSeatFor(stage, next.dealerSeat) !== mySeat) {
        // Bot ou outro jogador: o progresso é encenado para a mesa não parecer congelada.
        const span =
          stage === 'shuffle' ? CEREMONY_TIMING.remoteShuffleMs : CEREMONY_TIMING.remoteCutMs;
        if (stage === 'shuffle') {
          for (let i = 1; i <= 4; i++) {
            schedule(() => {
              const current = stateRef.current;
              if (!current || current.stage !== 'shuffle' || current.celebrating) return;
              commit({ ...current, swipes: i });
            }, Math.round((span / 5) * i));
          }
        }
        schedule(() => completeRef.current(false), span);
        return;
      }

      if (next.deadlineAt !== null) {
        schedule(() => completeRef.current(true), Math.max(0, next.deadlineAt - Date.now()));
      }
    },
    [clearTimers, commit, mySeat, schedule, serverDeadlineAt],
  );

  /** Fecha o estágio atual: comemora e encadeia o próximo. */
  const complete = useCallback(
    (timedOut: boolean) => {
      const current = stateRef.current;
      if (!current || current.celebrating || current.stage === 'deal') return;
      clearTimers();
      commit({ ...current, celebrating: true, timedOut, swipes: SWIPES_DONE });
      devLog('CEREMONY_COMPLETE', current.stage, { timedOut });
      if (actorSeatFor(current.stage, current.dealerSeat) === mySeat) {
        if (timedOut) haptic.error();
        else haptic.success();
      }
      const pause =
        current.stage === 'shuffle' ? CEREMONY_TIMING.handoffMs : CEREMONY_TIMING.successMs;
      schedule(
        () => enterStageRef.current(current.stage === 'shuffle' ? 'cut' : 'deal', current),
        pause,
      );
    },
    [clearTimers, commit, mySeat, schedule],
  );

  // Declarado antes do ciclo de vida de propósito: efeitos rodam na ordem em que aparecem, então
  // quando o efeito abaixo abre a cerimônia as refs já apontam para a versão desta renderização.
  useEffect(() => {
    enterStageRef.current = enterStage;
    completeRef.current = complete;
  });

  // --- Ciclo de vida --------------------------------------------------------

  useEffect(() => {
    const current = stateRef.current;
    if (!eligible || dealerSeat === null) {
      if (current) {
        clearTimers();
        commit(null);
      }
      return;
    }
    if (current?.handNumber === handNumber) return;
    enterStageRef.current('shuffle', {
      handNumber,
      dealerSeat,
      stage: 'shuffle',
      swipes: 0,
      celebrating: false,
      timedOut: false,
      deadlineAt: null,
    });
  }, [eligible, dealerSeat, handNumber, clearTimers, commit]);

  // Reconexão: o relógio congela e volta de onde parou. A vez nunca se perde por causa da rede.
  useEffect(() => {
    const current = stateRef.current;
    if (!current || current.celebrating || current.stage === 'deal') return;
    if (paused) {
      if (current.deadlineAt === null || frozenMs.current !== null) return;
      frozenMs.current = Math.max(0, current.deadlineAt - Date.now());
      clearTimers();
      commit({ ...current, deadlineAt: null });
      return;
    }
    if (frozenMs.current === null) return;
    const left = frozenMs.current;
    frozenMs.current = null;
    commit({ ...current, deadlineAt: Date.now() + left });
    if (actorSeatFor(current.stage, current.dealerSeat) === mySeat) {
      schedule(() => completeRef.current(true), left);
    } else {
      schedule(() => completeRef.current(false), Math.min(left, CEREMONY_TIMING.remoteShuffleMs));
    }
  }, [paused, clearTimers, commit, mySeat, schedule]);

  // --- Ações do jogador -----------------------------------------------------

  const bump = useCallback(() => {
    const current = stateRef.current;
    if (!current || current.stage !== 'shuffle' || current.celebrating) return;
    if (actorSeatFor('shuffle', current.dealerSeat) !== mySeat) return;
    const swipes = current.swipes + 1;
    commit({ ...current, swipes });
    // Embaralhou o bastante: exigir o botão depois disso só atrasaria a mão.
    if (isShuffleComplete(swipes)) completeRef.current(false);
  }, [commit, mySeat]);

  const finish = useCallback(() => {
    const current = stateRef.current;
    if (!current || current.celebrating) return;
    if (actorSeatFor(current.stage, current.dealerSeat) !== mySeat) return;
    if (current.stage === 'shuffle' && !canFinishShuffle(current.swipes)) return;
    completeRef.current(false);
  }, [mySeat]);

  return useMemo<ShuffleCeremony>(() => {
    if (!state) return INACTIVE;
    const actorSeat = actorSeatFor(state.stage, state.dealerSeat);
    return {
      active: true,
      stage: state.stage,
      dealerSeat: state.dealerSeat,
      actorSeat,
      iAmActor: actorSeat === mySeat,
      progress: state.celebrating ? 1 : shuffleProgress(state.swipes),
      canFinish: canFinishShuffle(state.swipes),
      celebrating: state.celebrating,
      timedOut: state.timedOut,
      deadlineAt: state.deadlineAt,
      stageTotalMs: stageDurationMs(state.stage),
      bump,
      finish,
    };
  }, [state, mySeat, bump, finish]);
}
