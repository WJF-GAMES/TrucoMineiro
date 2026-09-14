import React, { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, icons } from '@/design-system';
import { PlayingCard } from './PlayingCard';

/** Duração de uma mistura (o baralho parte em dois, as cartas trançam e ele volta a alinhar). */
export const SHUFFLE_ANIMATION_MS = 720;

const BOARD_W = 250;
const BOARD_H = 168;
const CARD_W = 74;
const CARD_H = Math.round(CARD_W * 1.45 * 0.62);
/** Quanto cada monte se afasta do centro na mistura. */
const SPLIT = 72;
/** Cartas que aparecem trançando entre os dois montes. */
const RIFFLE_CARDS = 5;

interface Props {
  /** Cada incremento toca uma mistura. */
  shuffleCount: number;
  /** Quem está embaralhando é o jogador local (o baralho respira, chamando o toque). */
  interactive: boolean;
}

/**
 * Animação da mistura, como na referência: dois montes se afastam, cartas intermediárias
 * aparecem trançando entre eles com setas curvas sugerindo o movimento, e os montes se
 * recombinam. Só verso — nenhuma face aparece. Roda a cada `SHUFFLE_PERFORMED` (local ou de outro
 * jogador), então quem assiste vê o mesmo que quem embaralha.
 */
export function ShuffleAnimation({ shuffleCount, interactive }: Props) {
  const t = useSharedValue(0);
  const idle = useSharedValue(0);
  const lastCount = useRef(shuffleCount);

  useEffect(() => {
    idle.value = withSequence(
      withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.sin) }),
      withTiming(0, { duration: 1400, easing: Easing.inOut(Easing.sin) }),
    );
    const loop = setInterval(() => {
      idle.value = withSequence(
        withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: 1400, easing: Easing.inOut(Easing.sin) }),
      );
    }, 2800);
    return () => clearInterval(loop);
  }, [idle]);

  useEffect(() => {
    if (shuffleCount === lastCount.current) return;
    lastCount.current = shuffleCount;
    t.value = 0;
    t.value = withTiming(1, { duration: SHUFFLE_ANIMATION_MS, easing: Easing.inOut(Easing.cubic) });
  }, [shuffleCount, t]);

  // 0 → montes juntos; 0,5 → afastados com as cartas trançando; 1 → juntos de novo.
  const left = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(t.value, [0, 0.5, 1], [-14, -SPLIT, -14]) },
      { translateY: interpolate(idle.value, [0, 1], [2, -2]) },
      { rotate: `${interpolate(t.value, [0, 0.5, 1], [-4, -14, -4])}deg` },
    ],
  }));
  const right = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(t.value, [0, 0.5, 1], [14, SPLIT, 14]) },
      { translateY: interpolate(idle.value, [0, 1], [-2, 2]) },
      { rotate: `${interpolate(t.value, [0, 0.5, 1], [4, 14, 4])}deg` },
    ],
  }));
  const arrows = useAnimatedStyle(() => ({
    opacity: interactive ? 0.35 + idle.value * 0.5 : 0.35,
    transform: [{ rotate: `${t.value * 180}deg` }],
  }));

  return (
    <View style={styles.board} pointerEvents="none" testID="shuffle-animation">
      <Animated.View style={[styles.arrows, arrows]}>
        <Ionicons name={icons.refresh} size={BOARD_H - 20} color={colors.primaryBright} />
      </Animated.View>
      <Animated.View style={[styles.pile, left]}>
        <Pile />
      </Animated.View>
      <Animated.View style={[styles.pile, right]}>
        <Pile />
      </Animated.View>
      {Array.from({ length: RIFFLE_CARDS }, (_, i) => (
        <RiffleCard key={i} index={i} t={t} />
      ))}
    </View>
  );
}

/** Carta que aparece entre os montes durante a mistura e some quando eles se juntam. */
function RiffleCard({ index, t }: { index: number; t: SharedValue<number> }) {
  const fromLeft = index % 2 === 0;
  const lane = (index - (RIFFLE_CARDS - 1) / 2) * 12;
  const style = useAnimatedStyle(() => {
    const phase = Math.min(1, Math.max(0, (t.value - 0.2 - index * 0.06) / 0.5));
    const x = interpolate(phase, [0, 0.5, 1], [fromLeft ? -SPLIT : SPLIT, lane, 0]);
    return {
      opacity: interpolate(phase, [0, 0.15, 0.85, 1], [0, 1, 1, 0]),
      transform: [
        { translateX: x },
        { translateY: interpolate(phase, [0, 0.5, 1], [0, -18 - index * 3, 0]) },
        { rotate: `${interpolate(phase, [0, 0.5, 1], [0, fromLeft ? -22 : 22, 0])}deg` },
        { scale: interpolate(phase, [0, 0.5, 1], [0.9, 1.05, 0.9]) },
      ],
    };
  });
  return (
    <Animated.View style={[styles.riffle, style]}>
      <PlayingCard faceDown width={CARD_W} style={styles.flat} />
    </Animated.View>
  );
}

const Pile = React.memo(function Pile() {
  return (
    <View style={{ width: CARD_W, height: CARD_H + 12 }}>
      {[3, 2, 1, 0].map((depth) => (
        <View key={depth} style={[styles.pileCard, { transform: [{ translateY: depth * 3 }] }]}>
          <PlayingCard faceDown width={CARD_W} style={styles.flat} />
        </View>
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  board: {
    width: BOARD_W,
    height: BOARD_H,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  arrows: { position: 'absolute' },
  pile: { position: 'absolute' },
  pileCard: { position: 'absolute', top: 0, left: 0 },
  flat: { height: CARD_H },
  riffle: { position: 'absolute' },
});
