import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { BackHandler } from 'react-native';
import type { MatchState } from '@/domain/game';
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
import type { RootScreenProps } from '@/navigation/types';

export function GameScreen(props: RootScreenProps<'Game'>) {
  const { params } = props.route;
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

  useEffect(() => {
    if (navigated.current) return;
    if (controller.status === 'finished' && controller.view) {
      navigated.current = true;
      const won = controller.view.winner === myTeam;
      logEvent('match_completed', { mode: 'online', won });
      logEvent(won ? 'match_won' : 'match_lost', { mode: 'online' });
      setTimeout(
        () =>
          navigation.replace('MatchResult', {
            mode: 'online',
            won,
            scores: controller.view!.scores,
            rematch: { mode: 'online', roomCode: null },
          }),
        900,
      );
    }
    if (controller.status === 'abandoned') {
      navigated.current = true;
      toast.info('Partida encerrada', 'Um jogador abandonou a mesa.');
      setTimeout(() => navigation.replace('Main', { screen: 'Play' }), 600);
    }
  }, [controller.status, controller.view, myTeam, navigation]);

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
