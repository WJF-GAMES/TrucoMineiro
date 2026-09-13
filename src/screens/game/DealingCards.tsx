import React, { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { PlayingCard } from './PlayingCard';

const BOARD_W = 250;
const BOARD_H = 158;
const CARD_W = 66;
/** Voltas de cartas em volta da mesa — a distribuição do truco sugerida, não contada. */
const ROUNDS = 2;
const SEATS: readonly { x: number; y: number }[] = [
  { x: 0, y: 118 }, // você
  { x: 132, y: 0 }, // direita
  { x: 0, y: -118 }, // parceiro
  { x: -132, y: 0 }, // esquerda
];

interface Props {
  durationMs: number;
}

/**
 * Distribuição: cartas saem do monte central para os quatro assentos, em voltas, na ordem da mesa.
 * É só transição — as cartas reais já estão no estado e entram na mão quando a cerimônia fecha.
 */
export function DealingCards({ durationMs }: Props) {
  const t = useSharedValue(0);

  useEffect(() => {
    t.value = 0;
    t.value = withTiming(1, { duration: durationMs, easing: Easing.linear });
  }, [durationMs, t]);

  const total = SEATS.length * ROUNDS;
  return (
    <Animated.View style={styles.board} pointerEvents="none">
      <Animated.View style={styles.stack}>
        <PlayingCard faceDown width={CARD_W} />
      </Animated.View>
      {Array.from({ length: total }).map((_, i) => (
        <DealtCard key={i} t={t} index={i} total={total} />
      ))}
    </Animated.View>
  );
}

function DealtCard({ t, index, total }: { t: SharedValue<number>; index: number; total: number }) {
  const target = SEATS[index % SEATS.length]!;
  const phase = index / total;
  const span = 1 / total + 0.22; // as cartas se sobrepõem um pouco: fica mais fluido que enfileirado

  const style = useAnimatedStyle(() => {
    const local = Math.min(1, Math.max(0, (t.value - phase) / span));
    const eased = 1 - Math.pow(1 - local, 3); // out-cubic: sai rápido e desacelera ao chegar
    return {
      opacity: interpolate(local, [0, 0.08, 0.82, 1], [0, 1, 1, 0]),
      transform: [
        { translateX: target.x * eased },
        { translateY: target.y * eased },
        { rotate: `${eased * (index % 2 === 0 ? 16 : -16)}deg` },
        { scale: 1 - eased * 0.18 },
      ],
    };
  });

  return (
    <Animated.View style={[styles.flying, style]}>
      <PlayingCard faceDown width={CARD_W} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  board: {
    width: BOARD_W,
    height: BOARD_H,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  stack: { position: 'absolute' },
  flying: { position: 'absolute' },
});
