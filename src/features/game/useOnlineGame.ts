import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GameAction, Seat } from '@/domain/game';
import type { ProgressionResult, SessionMeta } from '@/domain/model/types';
import { nowMs } from '@/utils/clock';
import { useAuthStore } from '@/stores/authStore';
import { useNetworkStore } from '@/stores/networkStore';
import {
  abandonMatch,
  advanceBots,
  setPresenceState,
  submitGameAction,
  subscribeMatch,
  ApiError,
} from '@/services/api';
import { logEvent } from '@/services/firebase/analytics';
import { reportError, setCrashContext } from '@/services/firebase/crashlytics';
import { toast } from '@/stores/toastStore';
import type { TableController, TablePlayer } from './types';
import { normalizeSeatView, normalizeSessionMeta, RemoteSeatView } from './normalizeSeatView';
import { TRICK_RESOLVE_PAUSE_MS } from './trickPresentation';

/**
 * Partida online. O servidor (NestJS) é a única autoridade: este hook recebe pelo WebSocket a
 * projeção do próprio assento (`game.view`), os metadados da mesa e o resultado, e manda só a
 * intenção de jogada (com chave de idempotência). A cada reconexão o servidor devolve o retrato
 * completo (`game.join`), então uma queda nunca deixa a mesa com estado velho.
 */
export function useOnlineGame(sessionId: string): TableController {
  const uid = useAuthStore((s) => s.user?.uid);
  const connected = useNetworkStore((s) => s.connected);
  const [meta, setMeta] = useState<SessionMeta | null>(null);
  const [view, setView] = useState<RemoteSeatView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progression, setProgression] = useState<ProgressionResult | null>(null);
  const [serverDeadline, setServerDeadline] = useState<{ version: number; at: number } | null>(null);
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
    const entry = Object.values(meta.players).find((p) => p.uid === uid && !p.bot);
    return entry ? (entry.seat as Seat) : null;
  }, [meta, uid]);

  useEffect(() => {
    setCrashContext({ matchId: sessionId, gameMode: 'online' });
    // Eventos podem chegar fora de ordem: nunca volta para uma versão anterior.
    const applyView = (raw: unknown) => {
      const next = normalizeSeatView(raw);
      if (!next) return;
      const receivedAt = nowMs();
      setView((prev) => (prev && prev.seat === next.seat && prev.version > next.version ? prev : next));
      // Prazo do servidor no relógio local: a diferença de relógio entre aparelho e servidor some.
      const timing = raw as { turnDeadlineAt?: unknown; serverTime?: unknown };
      if (typeof timing.turnDeadlineAt === 'number' && typeof timing.serverTime === 'number') {
        const at = timing.turnDeadlineAt - timing.serverTime + receivedAt;
        setServerDeadline((prev) => (prev && prev.version > next.version ? prev : { version: next.version, at }));
      }
    };
    const unsub = subscribeMatch(sessionId, {
      onSnapshot: (s) => {
        setError(null);
        setMeta(normalizeSessionMeta(s.meta));
        if (s.view) applyView(s.view);
        if (s.result) setProgression(s.result);
      },
      onMeta: (m) => setMeta(normalizeSessionMeta(m)),
      onView: applyView,
      onResult: setProgression,
      onError: (e) => {
        // Sem assento (saí da partida) é definitivo; o resto (rede) se resolve na reconexão.
        if (e instanceof ApiError && (e.code === 'not-found' || e.code === 'permission-denied'))
          setError(e.message);
      },
    });
    return unsub;
  }, [sessionId]);

  useEffect(() => {
    if (mySeat === null || !uid) return;
    setPresenceState(uid, 'in_match', sessionId).catch(() => undefined);
    return () => {
      setPresenceState(uid, 'online', null).catch(() => undefined);
    };
  }, [sessionId, mySeat, uid]);

  // Ritmo da mesa: quando a IA precisa agir, o cliente pede um passo depois da pausa da animação.
  // O servidor também age sozinho (agendador), então nada trava se este cliente sumir.
  useEffect(() => {
    if (!meta || !view || view.status !== 'PLAYING' || meta.status !== 'playing') return;
    if (botsPaused) return;
    const botSeats = new Set(
      Object.values(meta.players)
        .filter((p) => p.bot || p.controller === 'AI_TEMPORARY')
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

  const act = useCallback(
    async (action: GameAction) => {
      if (busy) return;
      setInFlight(true);
      const version = view?.version ?? 0;
      const clientActionId = `${version}_${++seq.current}_${Date.now().toString(36)}`;
      try {
        const res = await submitGameAction(sessionId, action, clientActionId);
        setAckedVersion(res.duplicate ? null : version);
        if (action.type === 'PLAY_CARD' || action.type === 'PLAY_CARD_COVERED')
          logEvent('card_played', {
            mode: 'online',
            covered: action.type === 'PLAY_CARD_COVERED',
          });
        if (action.type === 'REQUEST_TRUCO' || action.type === 'RAISE')
          logEvent('truco_requested', { mode: 'online' });
        if (action.type === 'ACCEPT_TRUCO') logEvent('truco_accepted', { mode: 'online' });
        if (action.type === 'RUN') logEvent('truco_rejected', { mode: 'online' });
      } catch (e) {
        reportError(e, 'submitGameAction');
        toast.error('Jogada não aceita', e instanceof ApiError ? e.message : undefined);
      } finally {
        setInFlight(false);
      }
    },
    [busy, sessionId, view?.version],
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
              isYou: p.uid === uid && !p.bot,
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
    serverDeadline,
  };
}
