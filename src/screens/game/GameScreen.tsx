import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { BackHandler } from 'react-native';
import type { GameEvent, MatchState, Team } from '@/domain/game';
import { teamOf } from '@/domain/game';
import { useAiGame, AiMatchRecord } from '@/features/game/useAiGame';
import { useOnlineGame } from '@/features/game/useOnlineGame';
import { finalizeAiMatch, FunctionsError } from '@/services/firebase/functions';
import { logEvent } from '@/services/firebase/analytics';
import { reportError } from '@/services/firebase/crashlytics';
import { traced } from '@/services/firebase/perf';
import { toast } from '@/stores/toastStore';
import { GameTable } from './GameTable';
import { StateView } from '@/components';
import { Screen } from '@/components/Screen';
import { buildMatchAnalysis, type MatchAnalysis } from '@/features/game/matchAnalysis';
import { AdService, useGameSessionGuard, usePreloadRewarded } from '@/ads';
import type { RootScreenProps } from '@/navigation/types';

/** How long the online result screen waits for the server-side rewards before showing without them. */
const REWARD_WAIT_MS = 4000;

export function GameScreen(props: RootScreenProps<'Game'>) {
  const { params } = props.route;
  // Enquanto esta tela existir, nenhum anúncio full-screen pode aparecer — nem ao voltar
  // do background, nem por qualquer outro caminho.
  useGameSessionGuard();
  // O rewarded da análise é carregado agora, no começo da partida: quando o resultado aparecer,
  // a oferta já está pronta e ninguém espera por anúncio.
  usePreloadRewarded('match_analysis_rewarded');

  if (params.mode === 'ai')
    return <AiGame {...props} difficulty={params.difficulty} seed={params.seed ?? 1} />;
  return <OnlineGame {...props} sessionId={params.sessionId} />;
}

function useBlockBack(onBack: () => boolean) {
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', onBack);
    return () => sub.remove();
  }, [onBack]);
}

function AiGame({
  navigation,
  difficulty,
  seed,
}: RootScreenProps<'Game'> & { difficulty: 'easy' | 'normal' | 'hard'; seed: number }) {
  const finishing = useRef(false);

  const onFinished = useCallback(
    async (state: MatchState, record: AiMatchRecord) => {
      if (finishing.current) return;
      finishing.current = true;
      const won = state.winner === teamOf(0);
      logEvent('match_completed', { mode: 'ai', difficulty, won });
      logEvent(won ? 'match_won' : 'match_lost', { mode: 'ai', difficulty });
      // Conta a partida para a cadência de anúncios (o anúncio em si só é decidido no resultado).
      AdService.notifyMatchCompleted();
      const analysis = buildMatchAnalysis(state.events, teamOf(0));
      let progression: {
        xpGained?: number;
        coinsGained?: number;
        leaguePointsDelta?: number;
        leveledUp?: boolean;
      } = {};
      try {
        const res = await traced('match_result', () => finalizeAiMatch(record), { mode: 'ai' });
        if (res.progression) {
          progression = {
            xpGained: res.progression.xpGained,
            coinsGained: res.progression.coinsGained,
            leaguePointsDelta: res.progression.leaguePointsDelta,
            leveledUp: res.progression.leveledUp,
          };
        }
      } catch (e) {
        reportError(e, 'finalizeAiMatch');
        toast.error(
          'Resultado não sincronizado',
          e instanceof FunctionsError
            ? e.message
            : 'Sua progressão será atualizada quando a conexão voltar.',
        );
      }
      setTimeout(() => {
        navigation.replace('MatchResult', {
          mode: 'ai',
          won,
          scores: state.scores,
          difficulty,
          analysis,
          ...progression,
          rematch: { mode: 'ai', difficulty },
        });
      }, 900);
    },
    [navigation, difficulty],
  );

  const controller = useAiGame(difficulty, seed, onFinished);
  useBlockBack(useCallback(() => true, []));

  return (
    <GameTable
      controller={controller}
      onExit={() => navigation.replace('Main', { screen: 'Play' })}
    />
  );
}

function OnlineGame({ navigation, sessionId }: RootScreenProps<'Game'> & { sessionId: string }) {
  const controller = useOnlineGame(sessionId);
  const navigated = useRef(false);
  useBlockBack(useCallback(() => true, []));

  const myTeam = useMemo(() => teamOf(controller.mySeat), [controller.mySeat]);

  /**
   * A mesa online entrega eventos em lotes (só os novos de cada snapshot). Acumulá-los aqui é o
   * que permite montar a mesma análise da partida que o modo IA tem — sem pedir nada ao servidor.
   */
  const events = useRef<GameEvent[]>([]);
  const lastBatch = useRef<GameEvent[] | null>(null);
  useEffect(() => {
    if (controller.recentEvents === lastBatch.current) return;
    lastBatch.current = controller.recentEvents;
    if (controller.recentEvents.length) events.current.push(...controller.recentEvents);
  }, [controller.recentEvents]);

  useEffect(() => {
    if (navigated.current) return;
    if (controller.status === 'finished' && controller.view) {
      const won = controller.view.winner === myTeam;
      const scores = controller.view.scores;
      const earned = controller.progression;
      // The server writes the rewards right after finishing the match; wait for them, but never
      // hold the player on a finished table — after REWARD_WAIT_MS we move on without the numbers.
      const delay = earned ? 900 : REWARD_WAIT_MS;
      const t = setTimeout(() => {
        navigated.current = true;
        logEvent('match_completed', { mode: 'online', won });
        logEvent(won ? 'match_won' : 'match_lost', { mode: 'online' });
        AdService.notifyMatchCompleted();
        navigation.replace('MatchResult', {
          mode: 'online',
          won,
          scores,
          analysis: analysisOf(events.current, myTeam),
          xpGained: earned?.xpGained,
          coinsGained: earned?.coinsGained,
          leaguePointsDelta: earned?.leaguePointsDelta,
          leveledUp: earned?.leveledUp,
          rematch: { mode: 'online', roomCode: null },
        });
      }, delay);
      return () => clearTimeout(t);
    }
    if (controller.status === 'abandoned') {
      navigated.current = true;
      toast.info('Partida encerrada', 'Um jogador abandonou a mesa.');
      setTimeout(() => navigation.replace('Main', { screen: 'Play' }), 600);
    }
  }, [controller.status, controller.view, controller.progression, myTeam, navigation]);

  if (controller.status === 'error') {
    return (
      <Screen>
        <StateView
          kind="error"
          title="Não foi possível entrar na mesa"
          message={controller.errorMessage ?? undefined}
          actionLabel="Voltar"
          onAction={() => navigation.replace('Main', { screen: 'Play' })}
        />
      </Screen>
    );
  }

  return (
    <GameTable
      controller={controller}
      onExit={async () => {
        await controller.leave();
        navigation.replace('Main', { screen: 'Play' });
      }}
    />
  );
}

/** Sem eventos acumulados (reconexão no meio da partida) não há análise para prometer. */
function analysisOf(events: GameEvent[], myTeam: Team): MatchAnalysis | undefined {
  if (events.length === 0) return undefined;
  return buildMatchAnalysis(events, myTeam);
}
