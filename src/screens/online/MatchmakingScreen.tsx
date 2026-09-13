import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, spacing } from '@/design-system';
import {
  AppText,
  PlayerAvatar,
  PrimaryButton,
  Screen,
  SecondaryButton,
  StateView,
  Surface,
} from '@/components';
import { useAuthStore } from '@/stores/authStore';
import { useProfileStore } from '@/stores/profileStore';
import { cancelMatchmaking, startMatchmaking, FunctionsError } from '@/services/firebase/functions';
import { subscribeMatchmaking } from '@/services/firebase/rtdb';
import { flag } from '@/services/firebase/remoteConfig';
import { logEvent } from '@/services/firebase/analytics';
import { useMatchmakingGuard } from '@/ads';
import { startTrace } from '@/services/firebase/perf';
import type { MatchmakingStatus } from '@/domain/model/types';
import type { RootScreenProps } from '@/navigation/types';

type UiState =
  | 'idle'
  | 'searching'
  | 'players_found'
  | 'preparing'
  | 'ready'
  | 'cancelled'
  | 'timeout'
  | 'error';

const COPY: Record<UiState, { title: string; message: string }> = {
  idle: { title: 'Preparando busca', message: 'Só um instante.' },
  searching: {
    title: 'Procurando jogadores...',
    message: 'Estamos montando uma mesa com 4 trucadores.',
  },
  players_found: { title: 'Jogadores encontrados!', message: 'Organizando as duplas.' },
  preparing: { title: 'Preparando partida', message: 'Embaralhando as cartas.' },
  ready: { title: 'Mesa pronta!', message: 'Entrando na partida.' },
  cancelled: { title: 'Busca cancelada', message: 'Quando quiser, é só voltar.' },
  timeout: {
    title: 'Ninguém apareceu',
    message: 'A resenha tá calma agora. Tente de novo ou jogue contra a IA.',
  },
  error: { title: 'Algo deu errado', message: 'Não foi possível entrar na fila.' },
};

const STATUS_MAP: Partial<Record<MatchmakingStatus, UiState>> = {
  searching: 'searching',
  found: 'players_found',
  preparing: 'preparing',
  ready: 'ready',
  cancelled: 'cancelled',
  timeout: 'timeout',
  error: 'error',
};

export function MatchmakingScreen({ navigation }: RootScreenProps<'Matchmaking'>) {
  // Fila de matchmaking também é gameplay: nenhum anúncio full-screen pode interromper.
  useMatchmakingGuard();
  const uid = useAuthStore((s) => s.user?.uid);
  const profile = useProfileStore((s) => s.profile);
  const [ui, setUi] = useState<UiState>('searching');
  const [seconds, setSeconds] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const timeoutSeconds = flag('matchmaking_timeout_seconds');
  const botFillSeconds = flag('matchmaking_bot_fill_seconds');
  const secondsRef = useRef(0);
  const botFillRequested = useRef(false);
  const stopTrace = useRef<(() => Promise<void>) | null>(null);
  const navigated = useRef(false);

  const pulse = useSharedValue(1);
  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(1.12, { duration: 900, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [pulse]);
  const pulseStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));

  /** Joins the queue; only touches state from async callbacks. */
  const enqueue = useCallback(async () => {
    navigated.current = false;
    botFillRequested.current = false;
    secondsRef.current = 0;
    logEvent('matchmaking_started');
    stopTrace.current = await startTrace('matchmaking');
    try {
      await startMatchmaking();
    } catch (e) {
      setUi('error');
      setMessage(e instanceof FunctionsError ? e.message : null);
    }
  }, []);

  const retry = () => {
    setUi('searching');
    setSeconds(0);
    setMessage(null);
    enqueue();
  };

  useEffect(() => {
    // Deferred so the queue join (an external system) never sets state during the effect body.
    const t = setTimeout(enqueue, 0);
    return () => clearTimeout(t);
  }, [enqueue]);

  // Timer tick: also drives bot fill and timeout (all inside the interval callback).
  useEffect(() => {
    if (ui !== 'searching' && ui !== 'players_found' && ui !== 'preparing') return;
    const t = setInterval(() => {
      secondsRef.current += 1;
      setSeconds(secondsRef.current);
      if (ui !== 'searching') return;
      if (secondsRef.current >= botFillSeconds && !botFillRequested.current) {
        botFillRequested.current = true;
        startMatchmaking(true).catch(() => undefined);
      }
      if (secondsRef.current >= timeoutSeconds) {
        cancelMatchmaking().catch(() => undefined);
        setUi('timeout');
      }
    }, 1000);
    return () => clearInterval(t);
  }, [ui, timeoutSeconds, botFillSeconds]);

  useEffect(() => {
    if (!uid) return;
    return subscribeMatchmaking(uid, (entry) => {
      if (!entry) return;
      const next = STATUS_MAP[entry.status];
      if (next) setUi((cur) => (cur === 'cancelled' && next === 'searching' ? cur : next));
      if (entry.sessionId && !navigated.current) {
        navigated.current = true;
        stopTrace.current?.();
        setUi('ready');
        const sessionId = entry.sessionId;
        setTimeout(() => navigation.replace('Game', { mode: 'online', sessionId }), 700);
      }
    });
  }, [uid, navigation]);

  const cancel = async () => {
    setUi('cancelled');
    logEvent('matchmaking_cancelled', { seconds: secondsRef.current });
    stopTrace.current?.();
    try {
      await cancelMatchmaking();
    } catch {
      // already cancelled or matched
    }
  };

  const active =
    ui === 'searching' ||
    ui === 'players_found' ||
    ui === 'preparing' ||
    ui === 'ready' ||
    ui === 'idle';
  const copy = COPY[ui];

  return (
    <Screen testID="screen-matchmaking" contentStyle={{ justifyContent: 'center' }}>
      {ui === 'error' ? (
        <StateView
          kind="error"
          title={copy.title}
          message={message ?? copy.message}
          actionLabel="Tentar de novo"
          onAction={retry}
        />
      ) : (
        <View style={styles.center}>
          <Animated.View
            style={[
              styles.pulse,
              active ? pulseStyle : null,
              {
                borderColor:
                  ui === 'timeout' || ui === 'cancelled' ? colors.textMuted : colors.primary,
              },
            ]}
          >
            <PlayerAvatar avatarId={profile?.avatarId} size={96} />
          </Animated.View>
          <AppText
            variant="display"
            center
            style={{ marginTop: spacing.xl }}
            testID="matchmaking-title"
          >
            {copy.title}
          </AppText>
          <AppText variant="body" center color={colors.textSecondary} style={{ marginTop: 6 }}>
            {copy.message}
          </AppText>
          {active ? (
            <Surface style={styles.timer}>
              <Ionicons name="time" size={18} color={colors.gold} />
              <AppText variant="bodyBold" style={{ marginLeft: 8 }}>
                {String(Math.floor(seconds / 60)).padStart(2, '0')}:
                {String(seconds % 60).padStart(2, '0')}
              </AppText>
              <AppText variant="small" color={colors.textSecondary} style={{ marginLeft: 8 }}>
                {ui === 'searching' ? 'na fila' : ''}
              </AppText>
            </Surface>
          ) : null}
        </View>
      )}

      <View style={styles.actions}>
        {active ? (
          <SecondaryButton
            label="Cancelar busca"
            onPress={cancel}
            icon="close"
            testID="matchmaking-cancel"
          />
        ) : ui === 'error' ? null : (
          <>
            <PrimaryButton label="Buscar novamente" onPress={retry} testID="matchmaking-retry" />
            <SecondaryButton
              label="Jogar contra a IA"
              onPress={() => navigation.replace('AiSetup')}
              style={{ marginTop: spacing.sm }}
            />
            <SecondaryButton
              label="Voltar"
              onPress={() => navigation.replace('Main', { screen: 'Play' })}
              style={{ marginTop: spacing.sm }}
            />
          </>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center' },
  pulse: {
    width: 124,
    height: 124,
    borderRadius: 62,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(5,200,117,0.08)',
  },
  timer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.xl,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  actions: { marginTop: spacing.xxxl },
});
