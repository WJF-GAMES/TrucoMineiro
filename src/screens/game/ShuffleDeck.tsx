import React, { useCallback, useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Svg, { Path, Polygon } from 'react-native-svg';
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
  runOnJS,
  type SharedValue,
} from 'react-native-reanimated';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, icons } from '@/design-system';
import { AppText } from '@/components';
import { haptic } from '@/utils/haptics';
import { PlayingCard } from './PlayingCard';

/** Distância percorrida pelo dedo (px) que conta como um gesto curto de embaralhar. */
const SWIPE_DISTANCE = 54;
/** Duração de um ciclo de mistura: separar, alternar as cartas e recompor. */
const BURST_MS = 560;
/** Cartas que "voam" entre os montes a cada ciclo. Poucas de propósito: leitura e custo. */
const FLYING = [
  { dir: 1, phase: 0 },
  { dir: -1, phase: 0.14 },
  { dir: 1, phase: 0.28 },
] as const;

const BOARD_W = 250;
const BOARD_H = 158;
const CARD_W = 84;
const CARD_H = Math.round(CARD_W * 1.45);
/** Meia-distância entre os dois montes com o baralho em repouso. */
const REST_GAP = 30;

interface Props {
  /** Só quem embaralha arrasta o baralho; para os demais a animação continua, o gesto não. */
  interactive: boolean;
  /** 0..1 do embaralhamento. Quando o gesto é de outro jogador, é ele que dispara a mistura. */
  progress: number;
  onBump: () => void;
  /** Recompõe tudo num monte só, com o pulso de confirmação. */
  settled: boolean;
}

/**
 * Baralho animado da etapa de embaralhar.
 *
 * Em repouso são dois montes levemente inclinados que flutuam e brilham — o suficiente para
 * dizer "me toque". A cada gesto curto o baralho **se abre**, algumas cartas atravessam de um
 * monte para o outro (cada uma com um rastro translúcido que sugere o borrão de movimento) e o
 * baralho **se recompõe**. Ao concluir, os dois montes convergem num monte só e dão um pulso.
 *
 * Toda a animação vive em shared values na thread de UI: o único salto para o JS é o `onBump`
 * (no máximo quatro vezes) e o haptic. Nenhum re-render por quadro.
 */
export function ShuffleDeck({ interactive, progress, onBump, settled }: Props) {
  /** 0 → 1 uma vez por ciclo de mistura. Monotônico: dá para derivar tudo dele com `interpolate`. */
  const cycle = useSharedValue(1);
  const idle = useSharedValue(0);
  const settle = useSharedValue(0);
  const pop = useSharedValue(0);
  const travel = useSharedValue(0);
  const lastX = useSharedValue(0);
  const lastY = useSharedValue(0);

  /** Um ciclo de mistura. Worklet simples — shared values não entram em array de dependência. */
  const burst = () => {
    'worklet';
    cycle.value = 0;
    cycle.value = withTiming(1, { duration: BURST_MS, easing: Easing.inOut(Easing.quad) });
  };

  const onSwipe = useCallback(() => {
    haptic.selection();
    onBump();
  }, [onBump]);

  // Flutuação e brilho de repouso, só enquanto o baralho ainda não fechou.
  useEffect(() => {
    if (settled) {
      cancelAnimation(idle);
      idle.value = withTiming(0, { duration: 200 });
      return;
    }
    idle.value = withRepeat(
      withTiming(1, { duration: 1600, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
    return () => cancelAnimation(idle);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- shared values são estáveis
  }, [settled]);

  useEffect(() => {
    if (!settled) {
      settle.value = withTiming(0, { duration: 200 });
      return;
    }
    settle.value = withTiming(1, { duration: 320, easing: Easing.out(Easing.cubic) });
    pop.value = withSequence(
      withTiming(1, { duration: 170, easing: Easing.out(Easing.quad) }),
      withSpring(0, { damping: 11, stiffness: 160 }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- shared values são estáveis
  }, [settled]);

  // Quando quem embaralha é outro jogador, o progresso que chega de fora move o baralho.
  const seenProgress = useRef(progress);
  useEffect(() => {
    if (progress > seenProgress.current && !settled) burst();
    seenProgress.current = progress;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `burst` só escreve shared values
  }, [progress, settled]);

  const pan = Gesture.Pan()
    .enabled(interactive)
    // Só assume o gesto quando o dedo anda: sem isso o toque simples viraria um arrasto de 0px
    // e o `Gesture.Tap` nunca dispararia.
    .activeOffsetX([-6, 6])
    .activeOffsetY([-6, 6])
    .onBegin(() => {
      lastX.value = 0;
      lastY.value = 0;
      travel.value = 0;
    })
    .onUpdate((e) => {
      // Qualquer direção conta: o movimento natural é um vaivém curto sobre o baralho.
      travel.value +=
        Math.abs(e.translationX - lastX.value) + Math.abs(e.translationY - lastY.value);
      lastX.value = e.translationX;
      lastY.value = e.translationY;
      if (travel.value >= SWIPE_DISTANCE) {
        travel.value = 0;
        burst();
        runOnJS(onSwipe)();
      }
    });

  const tap = Gesture.Tap()
    .enabled(interactive)
    .maxDuration(400)
    .onEnd(() => {
      burst();
      runOnJS(onSwipe)();
    });

  // Exclusive: enquanto o dedo arrasta, o toque não dispara um gesto extra.
  const gesture = Gesture.Exclusive(pan, tap);

  // --- Estilos animados -----------------------------------------------------

  const boardStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(idle.value, [0, 1], [2, -4]) },
      { scale: 1 + pop.value * 0.07 },
    ],
  }));

  const glowStyle = useAnimatedStyle(() => {
    const spread = Math.sin(cycle.value * Math.PI);
    return {
      opacity: 0.2 + idle.value * 0.12 + spread * 0.3 + settle.value * 0.25,
      transform: [{ scale: 0.9 + idle.value * 0.05 + spread * 0.08 }],
    };
  });

  const leftPacket = useAnimatedStyle(() => {
    const spread = Math.sin(cycle.value * Math.PI);
    const open = 1 - settle.value;
    return {
      transform: [
        { translateX: -(REST_GAP + spread * 24) * open },
        { translateY: -(spread * 6) * open },
        { rotate: `${-(6 + spread * 8) * open}deg` },
      ],
    };
  });

  const rightPacket = useAnimatedStyle(() => {
    const spread = Math.sin(cycle.value * Math.PI);
    const open = 1 - settle.value;
    return {
      transform: [
        { translateX: (REST_GAP + spread * 24) * open },
        { translateY: spread * 6 * open },
        { rotate: `${(6 + spread * 8) * open}deg` },
      ],
    };
  });

  const arrowStyle = useAnimatedStyle(() => {
    const spread = Math.sin(cycle.value * Math.PI);
    return { opacity: (0.22 + idle.value * 0.12 + spread * 0.4) * (1 - settle.value) };
  });

  const handStyle = useAnimatedStyle(() => ({
    opacity: interactive && !settled ? 0.55 + idle.value * 0.3 : 0,
    transform: [{ translateY: interpolate(idle.value, [0, 1], [0, -5]) }, { scale: 1 + idle.value * 0.06 }],
  }));

  const checkStyle = useAnimatedStyle(() => ({
    opacity: settle.value,
    transform: [{ scale: 0.6 + settle.value * 0.4 + pop.value * 0.25 }],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        style={[styles.board, boardStyle]}
        accessible
        accessibilityRole="button"
        accessibilityLabel="Baralho"
        accessibilityHint={
          interactive
            ? 'Toque para embaralhar o baralho. Repita até completar.'
            : 'Outro jogador está embaralhando.'
        }
        accessibilityState={{ disabled: !interactive }}
        onAccessibilityTap={interactive ? onSwipe : undefined}
      >
        <Animated.View style={[styles.glow, glowStyle]} pointerEvents="none" />

        <Animated.View style={[styles.arrows, arrowStyle]} pointerEvents="none">
          <ShuffleArrows />
        </Animated.View>

        <Animated.View style={[styles.packet, leftPacket]} pointerEvents="none">
          <DeckStack />
        </Animated.View>
        <Animated.View style={[styles.packet, rightPacket]} pointerEvents="none">
          <DeckStack />
        </Animated.View>

        {FLYING.map((f, i) => (
          <FlyingCard key={i} cycle={cycle} settle={settle} dir={f.dir} phase={f.phase} />
        ))}

        <Animated.View style={[styles.hand, handStyle]} pointerEvents="none">
          <Ionicons name={icons.hand} size={30} color={colors.text} />
        </Animated.View>

        <Animated.View style={[styles.check, checkStyle]} pointerEvents="none">
          <Ionicons name={icons.checkCircle} size={34} color={colors.primaryBright} />
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}

/** Monte de cartas viradas para baixo com profundidade (três cartas deslocadas). */
const DeckStack = React.memo(function DeckStack() {
  return (
    <View style={{ width: CARD_W, height: CARD_H }}>
      {[2, 1, 0].map((depth) => (
        <View
          key={depth}
          style={[
            StyleSheet.absoluteFill,
            { transform: [{ translateX: -depth * 2 }, { translateY: -depth * 2.5 }] },
          ]}
        >
          <PlayingCard faceDown width={CARD_W} />
        </View>
      ))}
    </View>
  );
});

/**
 * Carta que atravessa de um monte ao outro, com um rastro atrás dela.
 * O rastro é a mesma carta atrasada em 10% do ciclo e translúcida — é o que dá a leitura de
 * borrão de movimento sem custo de blur real.
 */
function FlyingCard({
  cycle,
  settle,
  dir,
  phase,
}: {
  cycle: SharedValue<number>;
  settle: SharedValue<number>;
  dir: 1 | -1;
  phase: number;
}) {
  const cardStyle = useAnimatedStyle(() => {
    const t = Math.min(1, Math.max(0, (cycle.value - phase) / 0.58));
    return {
      opacity: interpolate(t, [0, 0.1, 0.9, 1], [0, 1, 1, 0]) * (1 - settle.value),
      transform: [
        { translateX: interpolate(t, [0, 1], [-dir * REST_GAP, dir * REST_GAP]) },
        { translateY: -Math.sin(t * Math.PI) * 30 },
        { rotate: `${interpolate(t, [0, 0.5, 1], [-dir * 4, dir * 16, -dir * 4])}deg` },
      ],
    };
  });

  const trailStyle = useAnimatedStyle(() => {
    const t = Math.max(0, Math.min(1, (cycle.value - phase) / 0.58) - 0.12);
    return {
      opacity: interpolate(t, [0, 0.1, 0.9, 1], [0, 0.34, 0.34, 0]) * (1 - settle.value),
      transform: [
        { translateX: interpolate(t, [0, 1], [-dir * REST_GAP, dir * REST_GAP]) },
        { translateY: -Math.sin(t * Math.PI) * 30 },
        { rotate: `${interpolate(t, [0, 0.5, 1], [-dir * 4, dir * 16, -dir * 4])}deg` },
      ],
    };
  });

  return (
    <>
      <Animated.View style={[styles.packet, trailStyle]} pointerEvents="none">
        <PlayingCard faceDown width={CARD_W} />
      </Animated.View>
      <Animated.View style={[styles.packet, cardStyle]} pointerEvents="none">
        <PlayingCard faceDown width={CARD_W} />
      </Animated.View>
    </>
  );
}

/** Setas curvas que sugerem o vaivém das cartas entre os montes (arte da referência). */
const ShuffleArrows = React.memo(function ShuffleArrows() {
  const stroke = 'rgba(226, 244, 236, 0.85)';
  return (
    <Svg width={BOARD_W} height={BOARD_H} viewBox={`0 0 ${BOARD_W} ${BOARD_H}`}>
      <Path
        d="M62 48 Q126 2 192 44"
        stroke={stroke}
        strokeWidth={3}
        fill="none"
        strokeLinecap="round"
      />
      <Polygon points="196,48 178,36 180,52" fill={stroke} />
      <Path
        d="M188 110 Q124 156 58 114"
        stroke={stroke}
        strokeWidth={3}
        fill="none"
        strokeLinecap="round"
      />
      <Polygon points="54,110 72,122 70,106" fill={stroke} />
    </Svg>
  );
});

/** Faixa fina de progresso do embaralhamento (0..1), usada logo abaixo do baralho. */
export function ShuffleProgressBar({ progress, done }: { progress: number; done: boolean }) {
  const value = useSharedValue(progress);
  useEffect(() => {
    value.value = withTiming(done ? 1 : progress, { duration: 260, easing: Easing.out(Easing.cubic) });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- shared values são estáveis
  }, [progress, done]);
  const fill = useAnimatedStyle(() => ({ width: `${Math.round(value.value * 100)}%` }));
  return (
    <View style={styles.progressTrack} accessibilityLabel={`Embaralhamento ${Math.round(progress * 100)}%`}>
      <Animated.View
        style={[styles.progressFill, fill, done && { backgroundColor: colors.primaryBright }]}
      />
    </View>
  );
}

/** Legenda curta sob o baralho; muda conforme quem está embaralhando. */
export function DeckHint({ text }: { text: string }) {
  return (
    <View style={styles.hintBox}>
      <AppText variant="small" color={colors.textSecondary} center>
        {text}
      </AppText>
    </View>
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
  glow: {
    position: 'absolute',
    left: 18,
    right: 18,
    top: 12,
    bottom: 12,
    borderRadius: BOARD_H / 2,
    backgroundColor: colors.primaryGlow,
  },
  arrows: { position: 'absolute', left: 0, top: 0, width: BOARD_W, height: BOARD_H },
  packet: { position: 'absolute', width: CARD_W, height: CARD_H },
  hand: { position: 'absolute', bottom: -2, left: BOARD_W / 2 - 4 },
  check: { position: 'absolute' },
  progressTrack: {
    height: 6,
    width: 168,
    alignSelf: 'center',
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.12)',
    overflow: 'hidden',
  },
  progressFill: { height: '100%', borderRadius: 3, backgroundColor: colors.gold },
  hintBox: {
    alignSelf: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: 'rgba(0, 24, 18, 0.55)',
    maxWidth: 300,
  },
});
