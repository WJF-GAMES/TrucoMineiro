import React, { useCallback, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, icons } from '@/design-system';
import { haptic } from '@/utils/haptics';
import { PlayingCard } from './PlayingCard';

const BOARD_W = 250;
const BOARD_H = 158;
const CARD_W = 84;
const CARD_H = Math.round(CARD_W * 1.45);
/** Quanto o monte de cima precisa andar para o corte valer. */
const CUT_DISTANCE = 74;
/** Fração do ciclo em que o monte de cima está afastado; o resto é ele descendo por baixo. */
const LIFT_PHASE = 0.45;

interface Props {
  /** Só quem corta arrasta; para os demais o corte acontece sozinho. */
  interactive: boolean;
  /** Dispara o corte (o próprio gesto já anima; isto avisa a máquina de estados). */
  onCut: () => void;
  /** Corte concluído — por gesto, por tempo ou por outro jogador. */
  done: boolean;
}

/**
 * Etapa do corte: um monte só, partido ao meio.
 *
 * O arrasto **escova** a primeira metade da animação — o monte de cima acompanha o dedo até a
 * lateral — e soltar depois do limiar completa o corte, com a metade de baixo indo para o topo.
 * Um toque simples corta direto. Nada disso muda as cartas: a ordem já veio do motor/servidor.
 */
export function CutDeck({ interactive, onCut, done }: Props) {
  /** 0 = intacto, LIFT_PHASE = metade afastada, 1 = corte concluído. */
  const cut = useSharedValue(0);
  const idle = useSharedValue(0);

  const commit = useCallback(() => {
    haptic.medium();
    onCut();
  }, [onCut]);

  useEffect(() => {
    if (done) {
      cancelAnimation(idle);
      idle.value = withTiming(0, { duration: 200 });
      return;
    }
    idle.value = withRepeat(
      withTiming(1, { duration: 1500, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
    return () => cancelAnimation(idle);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- shared values são estáveis
  }, [done]);

  /** Leva o corte até o fim. Worklets simples, chamados tanto do gesto quanto dos efeitos. */
  const runCut = (duration: number) => {
    'worklet';
    cut.value = withTiming(1, { duration, easing: Easing.out(Easing.cubic) });
  };
  const scrubCut = (ratio: number) => {
    'worklet';
    cut.value = ratio * LIFT_PHASE;
  };
  const releaseCut = () => {
    'worklet';
    cut.value = withSpring(0, { damping: 16 });
  };

  // Corte por tempo ou por outro jogador: a animação roda sozinha até o fim.
  useEffect(() => {
    if (done) runCut(420);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- shared values são estáveis
  }, [done]);

  const pan = Gesture.Pan()
    .enabled(interactive)
    .activeOffsetX([-8, 8])
    // O arrasto escova a primeira metade da animação: o monte de cima segue o dedo.
    .onUpdate((e) => scrubCut(Math.min(1, Math.abs(e.translationX) / CUT_DISTANCE)))
    .onEnd((e) => {
      if (Math.abs(e.translationX) >= CUT_DISTANCE * 0.7) {
        runCut(380);
        runOnJS(commit)();
        return;
      }
      releaseCut();
    });

  const tap = Gesture.Tap()
    .enabled(interactive)
    .maxDuration(400)
    .onEnd(() => {
      runCut(460);
      runOnJS(commit)();
    });

  const gesture = Gesture.Exclusive(pan, tap);

  const boardStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: interpolate(idle.value, [0, 1], [2, -3]) }],
  }));

  // Metade de cima: sai para a lateral, sobe e desce por baixo da outra.
  const topHalf = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(cut.value, [0, LIFT_PHASE, 1], [0, CUT_DISTANCE, 0]) },
      { translateY: interpolate(cut.value, [0, LIFT_PHASE, 1], [-9, -24, 5]) },
      { rotate: `${interpolate(cut.value, [0, LIFT_PHASE, 1], [-2, 7, 0])}deg` },
    ],
  }));

  // Metade de baixo: é pintada por cima (ordem no JSX), então subir já a coloca no topo do monte.
  const bottomHalf = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(cut.value, [0, LIFT_PHASE, 1], [9, 5, -5]) },
      { rotate: `${interpolate(cut.value, [0, LIFT_PHASE, 1], [2, 1, 0])}deg` },
    ],
  }));

  const lineStyle = useAnimatedStyle(() => ({
    opacity: (0.25 + idle.value * 0.35) * (1 - Math.min(1, cut.value / LIFT_PHASE)),
  }));

  const scissorsStyle = useAnimatedStyle(() => ({
    opacity: interactive && !done ? (0.5 + idle.value * 0.4) * (1 - cut.value) : 0,
    transform: [{ translateX: interpolate(idle.value, [0, 1], [-4, 4]) }],
  }));

  const checkStyle = useAnimatedStyle(() => ({
    opacity: interpolate(cut.value, [0.75, 1], [0, 1]),
    transform: [{ scale: interpolate(cut.value, [0.75, 1], [0.6, 1]) }],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        style={[styles.board, boardStyle]}
        accessible
        accessibilityRole="button"
        accessibilityLabel="Cortar o baralho"
        accessibilityHint={
          interactive ? 'Toque ou arraste para o lado para cortar.' : 'Outro jogador está cortando.'
        }
        accessibilityState={{ disabled: !interactive }}
        onAccessibilityTap={interactive ? commit : undefined}
      >
        <Animated.View style={[styles.line, lineStyle]} pointerEvents="none" />

        <Animated.View style={[styles.half, topHalf]} pointerEvents="none">
          <HalfStack />
        </Animated.View>
        <Animated.View style={[styles.half, bottomHalf]} pointerEvents="none">
          <HalfStack />
        </Animated.View>

        <Animated.View style={[styles.scissors, scissorsStyle]} pointerEvents="none">
          <Ionicons name={icons.cut} size={24} color={colors.gold} />
        </Animated.View>

        <Animated.View style={[styles.check, checkStyle]} pointerEvents="none">
          <Ionicons name={icons.checkCircle} size={34} color={colors.primaryBright} />
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}

const HalfStack = React.memo(function HalfStack() {
  return (
    <View style={{ width: CARD_W, height: CARD_H }}>
      {[1, 0].map((depth) => (
        <View
          key={depth}
          style={[
            StyleSheet.absoluteFill,
            { transform: [{ translateX: -depth * 2 }, { translateY: -depth * 2 }] },
          ]}
        >
          <PlayingCard faceDown width={CARD_W} />
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
  half: { position: 'absolute', width: CARD_W, height: CARD_H },
  line: {
    position: 'absolute',
    height: 2,
    width: CARD_W + 34,
    borderRadius: 1,
    borderTopWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.gold,
  },
  scissors: { position: 'absolute', right: 26 },
  check: { position: 'absolute' },
});
