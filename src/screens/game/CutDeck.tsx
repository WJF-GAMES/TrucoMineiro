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
import { cutSplit, type CutDepth } from '@/features/game/shuffleCeremony';
import { haptic } from '@/utils/haptics';
import { PlayingCard } from './PlayingCard';

const BOARD_W = 250;
const BOARD_H = 196;
const CARD_W = 92;
const CARD_H = Math.round(CARD_W * 1.45 * 0.62); // metades "deitadas" como na referência
/** Espaço entre as duas metades quando o baralho está partido. */
const GAP = 14;
/** Quanto o monte de cima precisa andar para o corte valer. */
const CUT_DISTANCE = 74;
/** Fração do ciclo em que o monte de cima está afastado; o resto é ele descendo por baixo. */
const LIFT_PHASE = 0.45;
/** Deslocamento por carta na pilha (efeito de espessura). */
const STACK_STEP = 4;

interface Props {
  /** Só quem corta arrasta; para os demais o corte acontece sozinho. */
  interactive: boolean;
  /** Dispara o corte (o próprio gesto já anima; isto avisa a máquina de estados). */
  onCut: () => void;
  /** Corte concluído — por gesto, por tempo ou por outro jogador. */
  done: boolean;
  /** Onde o baralho está partido (alto / meio / baixo) — muda a espessura das metades. */
  depth: CutDepth;
}

/**
 * Etapa do corte, como na referência: o baralho já partido em duas metades, uma sobre a outra,
 * com a linha tracejada entre elas. O jogador **arrasta a metade de cima** para o lado (as setas
 * mostram o gesto); soltar depois do limiar completa o corte — a metade de cima desce e a de
 * baixo sobe. Um toque simples também corta. Nada disso muda as cartas: a ordem já veio do
 * motor/servidor; a profundidade só muda quantas cartas cada metade mostra.
 */
export function CutDeck({ interactive, onCut, done, depth }: Props) {
  /** 0 = intacto, LIFT_PHASE = metade afastada, 1 = corte concluído. */
  const cut = useSharedValue(0);
  const idle = useSharedValue(0);
  const split = cutSplit(depth);

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

  const topY = -(CARD_H / 2 + GAP / 2) - split.top * STACK_STEP;
  const bottomY = CARD_H / 2 + GAP / 2;

  const boardStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: interpolate(idle.value, [0, 1], [1, -3]) }],
  }));

  // Metade de cima: sai para a lateral, depois desce para o lugar da metade de baixo.
  const topHalf = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(cut.value, [0, LIFT_PHASE, 1], [0, CUT_DISTANCE, 0]) },
      { translateY: interpolate(cut.value, [0, LIFT_PHASE, 1], [topY, topY - 8, bottomY + 6]) },
      { rotate: `${interpolate(cut.value, [0, LIFT_PHASE, 1], [0, 6, 0])}deg` },
    ],
    zIndex: cut.value > LIFT_PHASE ? 0 : 2,
  }));

  // Metade de baixo: sobe para o topo do monte quando a de cima sai do caminho.
  const bottomHalf = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(cut.value, [0, LIFT_PHASE, 1], [bottomY, bottomY, topY + 4]) },
    ],
    zIndex: cut.value > LIFT_PHASE ? 2 : 0,
  }));

  const lineStyle = useAnimatedStyle(() => ({
    opacity: (0.35 + idle.value * 0.35) * (1 - Math.min(1, cut.value / LIFT_PHASE)),
  }));

  const arrowsStyle = useAnimatedStyle(() => ({
    opacity: interactive && !done ? (0.45 + idle.value * 0.45) * (1 - cut.value) : 0,
    transform: [{ translateY: topY }],
  }));
  const arrowLeft = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(idle.value, [0, 1], [3, -3]) }],
  }));
  const arrowRight = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(idle.value, [0, 1], [-3, 3]) }],
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
          interactive
            ? 'Arraste a parte de cima para o lado, ou toque, para cortar.'
            : 'Outro jogador está cortando.'
        }
        accessibilityState={{ disabled: !interactive }}
        onAccessibilityTap={interactive ? commit : undefined}
      >
        <Animated.View style={[styles.line, lineStyle]} pointerEvents="none" />

        <Animated.View style={[styles.arrows, arrowsStyle]} pointerEvents="none">
          <Animated.View style={arrowLeft}>
            <Ionicons name={icons.arrowLeft} size={26} color={colors.text} />
          </Animated.View>
          <Animated.View style={arrowRight}>
            <Ionicons name={icons.arrowRight} size={26} color={colors.text} />
          </Animated.View>
        </Animated.View>

        <Animated.View style={[styles.half, bottomHalf]} pointerEvents="none">
          <HalfStack cards={split.bottom} />
        </Animated.View>
        <Animated.View style={[styles.half, topHalf]} pointerEvents="none">
          <HalfStack cards={split.top} glow={interactive && !done} />
        </Animated.View>

        <Animated.View style={[styles.check, checkStyle]} pointerEvents="none">
          <Ionicons name={icons.checkCircle} size={34} color={colors.primaryBright} />
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}

/** Pilha "deitada": cada carta a mais empurra a de cima para dar espessura. */
const HalfStack = React.memo(function HalfStack({
  cards,
  glow,
}: {
  cards: number;
  glow?: boolean;
}) {
  const depths = Array.from({ length: Math.max(1, cards) }, (_, i) => cards - 1 - i);
  return (
    <View style={[{ width: CARD_W, height: CARD_H + cards * STACK_STEP }, glow && styles.glow]}>
      {depths.map((depth) => (
        <View
          key={depth}
          style={[styles.card, { transform: [{ translateY: depth * STACK_STEP }] }]}
        >
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
  half: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  card: { position: 'absolute', top: 0, left: 0 },
  flat: { height: CARD_H },
  glow: {
    shadowColor: colors.primaryBright,
    shadowOpacity: 0.7,
    shadowRadius: 14,
    elevation: 8,
  },
  line: {
    position: 'absolute',
    height: 2,
    width: CARD_W + 40,
    borderRadius: 1,
    borderTopWidth: 2,
    borderStyle: 'dashed',
    borderColor: 'rgba(255,255,255,0.75)',
  },
  arrows: {
    position: 'absolute',
    width: CARD_W + 120,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  check: { position: 'absolute' },
});
