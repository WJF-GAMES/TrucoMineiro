import React, { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { colors, icons, radius } from '@/design-system';
import { AppText } from '@/components';
import type { Card } from '@/domain/game';
import type { TablePosition } from '@/features/game/seatLayout';
import { TRICK_TIMING } from '@/features/game/trickPresentation';
import { PlayingCard } from './PlayingCard';

export type TrickCardStatus = 'plain' | 'leading' | 'winner' | 'loser';

interface Props {
  /** `null` quando a carta foi jogada virada por outro assento (a identidade não chega aqui). */
  card: Card | null;
  /** Jogada virada: a mesa mostra só o verso, do voo até o recolhimento. */
  covered?: boolean;
  width: number;
  /** De onde a carta vem (o assento de quem jogou) — ela voa dali até o slot. */
  from: TablePosition;
  status: TrickCardStatus;
  /** Quando a vaza recolhe, todas as cartas vão na direção de quem levou. */
  collectTo: TablePosition | null;
  style?: object;
  testID?: string;
}

/** Deslocamento inicial (px) a partir do assento de origem, relativo ao slot da cruz. */
const ORIGIN: Record<TablePosition, { x: number; y: number }> = {
  top: { x: 0, y: -150 },
  left: { x: -170, y: -20 },
  right: { x: 170, y: -20 },
  bottom: { x: 0, y: 260 },
};

const COLLECT: Record<TablePosition, { x: number; y: number }> = {
  top: { x: 0, y: -120 },
  left: { x: -140, y: 0 },
  right: { x: 140, y: 0 },
  bottom: { x: 0, y: 160 },
};

/**
 * Carta jogada na mesa: entra voando do assento de quem jogou, ganha o destaque de "Ganhando"
 * (verde, discreto) enquanto a vaza está aberta e de "Vencedora" (dourado, coroa) quando fecha, e
 * sai junto com as outras na direção de quem levou.
 */
export function TrickCard({ card, covered, width, from, status, collectTo, style, testID }: Props) {
  // A trajetória é sempre da mesa: sai do assento de quem jogou e pousa no slot dele.
  const start = ORIGIN[from];
  const x = useSharedValue(start.x);
  const y = useSharedValue(start.y);
  const scale = useSharedValue(0.86);
  const opacity = useSharedValue(0);
  const pop = useSharedValue(0);

  const flown = useRef(false);

  // Um único efeito dirige a carta: voo de entrada (uma vez), pulso da vencedora e recolhimento.
  useEffect(() => {
    if (!flown.current) {
      flown.current = true;
      const ease = Easing.out(Easing.cubic);
      x.value = withTiming(0, { duration: TRICK_TIMING.flyMs, easing: ease });
      y.value = withTiming(0, { duration: TRICK_TIMING.flyMs, easing: ease });
      scale.value = withTiming(1, { duration: TRICK_TIMING.flyMs, easing: ease });
      opacity.value = withTiming(1, { duration: 120 });
    }
    pop.value =
      status === 'winner'
        ? withDelay(
            TRICK_TIMING.flyMs,
            withSequence(withTiming(1, { duration: 160 }), withTiming(0.6, { duration: 220 })),
          )
        : 0;
    if (collectTo) {
      const ease = Easing.in(Easing.cubic);
      const to = COLLECT[collectTo];
      x.value = withTiming(to.x, { duration: TRICK_TIMING.collectMs, easing: ease });
      y.value = withTiming(to.y, { duration: TRICK_TIMING.collectMs, easing: ease });
      scale.value = withTiming(0.6, { duration: TRICK_TIMING.collectMs, easing: ease });
      opacity.value = withDelay(
        TRICK_TIMING.collectMs * 0.45,
        withTiming(0, { duration: TRICK_TIMING.collectMs * 0.55 }),
      );
    }
  }, [status, collectTo, x, y, scale, opacity, pop]);

  const animated = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [
      { translateX: x.value },
      { translateY: y.value },
      { scale: scale.value * (1 + pop.value * 0.1) },
    ],
  }));

  const dimmed = status === 'loser';
  const ring =
    status === 'winner' ? styles.ringWinner : status === 'leading' ? styles.ringLeading : null;

  return (
    <Animated.View style={[style, animated]} testID={testID}>
      <View style={[styles.frame, ring, dimmed && styles.dimmed]}>
        {covered || !card ? (
          <PlayingCard faceDown width={width} />
        ) : (
          <PlayingCard card={card} width={width} />
        )}
      </View>
      {status === 'winner' ? (
        <View style={styles.crown} pointerEvents="none">
          <Ionicons name={icons.trophy} size={12} color={colors.textDark} />
        </View>
      ) : null}
      {status === 'leading' || status === 'winner' ? (
        <View style={styles.tagRow} pointerEvents="none">
          <View style={[styles.tag, status === 'winner' ? styles.tagWinner : styles.tagLeading]}>
            <AppText
              variant="caption"
              numberOfLines={1}
              color={status === 'winner' ? colors.textDark : colors.primaryBright}
            >
              {status === 'winner' ? 'Vencedora' : 'Ganhando'}
            </AppText>
          </View>
        </View>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  frame: { borderRadius: 9, borderWidth: 2, borderColor: 'transparent' },
  ringLeading: {
    borderColor: colors.primaryBright,
    shadowColor: colors.primaryBright,
    shadowOpacity: 0.9,
    shadowRadius: 10,
    elevation: 6,
  },
  ringWinner: {
    borderColor: colors.gold,
    shadowColor: colors.gold,
    shadowOpacity: 1,
    shadowRadius: 14,
    elevation: 8,
  },
  dimmed: { opacity: 0.55 },
  crown: {
    position: 'absolute',
    top: -10,
    alignSelf: 'center',
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.bgTop,
  },
  // A faixa é mais larga que a carta: sem isto o rótulo quebra em duas linhas dentro dos 54px.
  tagRow: { position: 'absolute', bottom: -11, left: -40, right: -40, alignItems: 'center' },
  tag: {
    paddingHorizontal: 8,
    paddingVertical: 1,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  tagLeading: { backgroundColor: 'rgba(0, 30, 20, 0.9)', borderColor: colors.primaryBright },
  tagWinner: { backgroundColor: colors.gold, borderColor: colors.gold },
});
