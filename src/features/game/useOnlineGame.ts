import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GameAction, Seat } from '@/domain/game';
import type { ProgressionResult, SessionMeta } from '@/domain/model/types';
import { useAuthStore } from '@/stores/authStore';
import { useNetworkStore } from '@/stores/networkStore';
import {
  connectSessionPresence,
  setPresenceState,
  subscribeSeatView,
  subscribeSessionMeta,
  subscribeSessionResult,
} from '@/services/firebase/rtdb';
import {
  abandonMatch,
  advanceBots,
  rejoinMatch,
  submitGameAction,
  FunctionsError,
} from '@/services/firebase/functions';
import { logEvent } from '@/services/firebase/analytics';
import { reportError, setCrashContext } from '@/services/firebase/crashlytics';
import { toast } from '@/stores/toastStore';
import type { TableController, TablePlayer } from './types';
import { normalizeSeatView, normalizeSessionMeta, RemoteSeatView } from './normalizeSeatView';
import { TRICK_RESOLVE_PAUSE_MS } from './trickPresentation';

/**
 * Online match. The server (Cloud Functions) is the only authority: this hook subscribes to the
 * per-seat view in Realtime Database and submits actions through callables with idempotency keys.
 */
export function useOnlineGame(sessionId: string): TableController {
  const uid = useAuthStore((s) => s.user?.uid);
  const connected = useNetworkStore((s) => s.connected);
  const [meta, setMeta] = useState<SessionMeta | null>(null);
  const [view, setView] = useState<RemoteSeatView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progression, setProgression] = useState<ProgressionResult | null>(null);
  const [inFlight, setInFlight] = useState(false);
  // Versão da view no momento em que a última ação foi aceita: até o snapshot seguinte chegar a
  // mesa continua "ocupada" — senão o relógio do turno recomeça para uma decisão que já acabou.
  const [ackedVersion, setAckedVersion] = useState<number | null>(null);
  const [botsPaused, setBotsPaused] = useState(false);
  const seq = useRef(0);
  const busy = inFlight || (ackedVersion !== null && view?.version === ackedVersion);

  // Segurança: se o snapshot nunca vier (rede), libera a mesa depois de alguns segundos.
  useEffect(() => {
    if (ackedVersion === null) return;
    if (view && view.version !== ackedVersion) {
      const release = setTimeout(() => setAckedVersion(null), 0);
      return () => clearTimeout(release);
    }
    const t = setTimeout(() => setAckedVersion(null), 5000);
    return () => clearTimeout(t);
  }, [ackedVersion, view]);

  const mySeat = useMemo<Seat | null>(() => {
    if (!meta || !uid) return null;
    const entry = Object.values(meta.players).find((p) => p.uid === uid);
    return entry ? (entry.seat as Seat) : null;
  }, [meta, uid]);

  useEffect(() => {
    setCrashContext({ matchId: sessionId, gameMode: 'online' });
    const unsub = subscribeSessionMeta(
      sessionId,
      (m) => setMeta(normalizeSessionMeta(m)),
      (e) => setError(e.message),
    );
    return unsub;
  }, [sessionId]);

  useEffect(() => {
    if (mySeat === null || !uid) return;
    const unsubView = subscribeSeatView(
      sessionId,
      mySeat,
      (v) => setView(normalizeSeatView(v)),
      (e) => setError(e.message),
    );
    const unsubResult = subscribeSessionResult(sessionId, mySeat, setProgression);
    const unsubPresence = connectSessionPresence(sessionId, mySeat);
    setPresenceState(uid, 'in_match', sessionId).catch(() => undefined);
    rejoinMatch(sessionId).catch(() => undefined);
    return () => {
      unsubView();
      unsubResult();
      unsubPresence();
      setPresenceState(uid, 'online', null).catch(() => undefined);
    };
  }, [sessionId, mySeat, uid]);

  // Bots are paced by the clients: when a bot must act, ask the server for one bot step.
  useEffect(() => {
    if (!meta || !view || view.status !== 'PLAYING' || meta.status !== 'playing') return;
    if (botsPaused) return;
    const botSeats = new Set(
      Object.values(meta.players)
        .filter((p) => p.bot)
        .map((p) => p.seat),
    );
    const team = (s: number) => s % 2;
    let botMustAct = false;
    // Resposta ao truco / mão de onze: se este cliente pode responder, o humano decide — o bot
    // parceiro só entra se ninguém humano da dupla estiver na mesa para isso.
    const iCanAnswer = view.availableActions.length > 0;
    if (view.phase === 'PLAY' || view.phase === 'SHUFFLING' || view.phase === 'CUTTING')
      botMustAct = botSeats.has(view.turnSeat);
    else if (iCanAnswer) botMustAct = false;
    else if (view.phase === 'TRUCO_RESPONSE' && view.trucoRequesterTeam !== null)
      botMustAct = [...botSeats].some((s) => team(s) !== view.trucoRequesterTeam);
    else if (view.phase === 'MAO_DE_ONZE' && view.maoDeOnzeTeam !== null)
      botMustAct = [...botSeats].some((s) => team(s) === view.maoDeOnzeTeam);
    if (!botMustAct) return;
    const lastEvent = view.recentEvents?.[view.recentEvents.length - 1];
    const pause =
      lastEvent?.type === 'ROUND_ENDED' ||
      lastEvent?.type === 'HAND_ENDED' ||
      lastEvent?.type === 'HAND_STARTED'
        ? TRICK_RESOLVE_PAUSE_MS
        : 900;
    const t = setTimeout(() => advanceBots(sessionId).catch(() => undefined), pause);
    return () => clearTimeout(t);
  }, [meta, view, sessionId, botsPaused]);

  // Re-announce ourselves whenever connectivity comes back.
  useEffect(() => {
    if (connected && mySeat !== null) rejoinMatch(sessionId).catch(() => undefined);
  }, [connected, mySeat, sessionId]);

  const act = useCallback(
    async (action: GameAction) => {
      if (busy) return;
      setInFlight(true);
      const version = view?.version ?? 0;
      const clientActionId = `${uid ?? 'anon'}_${version}_${++seq.current}`;
      try {
        await submitGameAction(sessionId, action, clientActionId);
        setAckedVersion(version);
        if (action.type === 'PLAY_CARD') logEvent('card_played', { mode: 'online' });
        if (action.type === 'REQUEST_TRUCO' || action.type === 'RAISE')
          logEvent('truco_requested', { mode: 'online' });
        if (action.type === 'ACCEPT_TRUCO') logEvent('truco_accepted', { mode: 'online' });
        if (action.type === 'RUN') logEvent('truco_rejected', { mode: 'online' });
      } catch (e) {
        reportError(e, 'submitGameAction');
        toast.error('Jogada não aceita', e instanceof FunctionsError ? e.message : undefined);
      } finally {
        setInFlight(false);
      }
    },
    [busy, sessionId, uid, view?.version],
  );

  const leave = useCallback(async () => {
    try {
      await abandonMatch(sessionId);
    } catch {
      // leaving is best-effort
    }
  }, [sessionId]);

  const players: TablePlayer[] = useMemo(
    () =>
      meta
        ? Object.values(meta.players)
            .sort((a, b) => a.seat - b.seat)
            .map((p) => ({
              seat: p.seat as Seat,
              nickname: p.nickname,
              avatarId: p.avatarId,
              isYou: p.uid === uid,
              bot: p.bot,
              connected: p.connected,
            }))
        : [],
    [meta, uid],
  );

  const status: TableController['status'] = error
    ? 'error'
    : !meta || !view || mySeat === null
      ? 'loading'
      : meta.status === 'abandoned'
        ? 'abandoned'
        : meta.status === 'finished' || view.status === 'FINISHED'
          ? 'finished'
          : !connected
            ? 'reconnecting'
            : 'playing';

  return {
    status,
    errorMessage: error,
    mySeat: mySeat ?? 0,
    view,
    players,
    recentEvents: view?.recentEvents ?? [],
    availableActions: view?.availableActions ?? [],
    busy,
    act,
    leave,
    setBotsPaused,
    progression,
  };
}
