import React, { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { colors } from '@/design-system';
import { AppText } from '@/components';
import type { Card } from '@/domain/game';
import { PlayingCard } from './PlayingCard';
import { haptic } from '@/utils/haptics';

/** Quanto a carta precisa subir (em px) para a soltura valer como jogada. */
const PLAY_THRESHOLD = 70;

interface Props {
  card: Card;
  width: number;
  /** `undefined` quando não é a vez: a carta não arrasta nem responde ao toque. */
  onPlay?: () => void;
  disabled?: boolean;
  dimmed?: boolean;
  highlighted?: boolean;
}

/**
 * Carta da mão que pode ser **arrastada até a mesa** para ser jogada, além do toque.
 *
 * Arrastar é o gesto natural de jogo de cartas e evita a jogada acidental de um toque solto:
 * o compromisso só acontece quando a carta sobe além do limiar. Soltar antes disso devolve a
 * carta para a mão, então dá para "espiar" o movimento e desistir.
 *
 * O toque continua funcionando — é mais rápido e é o que o leitor de tela usa.
 */
export function DraggableCard({ card, width, onPlay, disabled, dimmed, highlighted }: Props) {
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const lifted = useSharedValue(0);
  const armed = useSharedValue(0);
  const canDrag = Boolean(onPlay) && !disabled;

  // `runOnJS` só aceita funções estáveis; sem isso o worklet recria a ponte a cada render.
  const play = useCallback(() => {
    haptic.medium();
    onPlay?.();
  }, [onPlay]);
  const armHaptic = useCallback(() => haptic.selection(), []);

  const reset = () => {
    'worklet';
    translateX.value = withSpring(0, { damping: 18 });
    translateY.value = withSpring(0, { damping: 18 });
    lifted.value = withTiming(0, { duration: 120 });
    armed.value = 0;
  };

  const pan = Gesture.Pan()
    .enabled(canDrag)
    // Só assume o gesto quando o dedo anda de verdade, senão um toque simples viraria arrasto.
    .activeOffsetY([-12, 12])
    .failOffsetX([-24, 24])
    .onStart(() => {
      lifted.value = withTiming(1, { duration: 120 });
    })
    .onUpdate((e) => {
      translateX.value = e.translationX;
      translateY.value = e.translationY;
      const nowArmed = e.translationY < -PLAY_THRESHOLD ? 1 : 0;
      if (nowArmed !== armed.value) {
        armed.value = nowArmed;
        if (nowArmed) runOnJS(armHaptic)();
      }
    })
    .onEnd((e) => {
      if (e.translationY < -PLAY_THRESHOLD) {
        // Some em direção à mesa; o estado do jogo troca a mão logo em seguida.
        translateY.value = withTiming(-PLAY_THRESHOLD * 2.2, { duration: 140 });
        runOnJS(play)();
        return;
      }
      reset();
    })
    .onFinalize((_e, success) => {
      if (!success) reset();
    });

  const cardStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value - lifted.value * 10 },
      { scale: 1 + lifted.value * 0.06 },
    ],
    zIndex: lifted.value > 0 ? 10 : 0,
  }));

  const hintStyle = useAnimatedStyle(() => ({ opacity: armed.value }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={cardStyle}>
        <PlayingCard
          card={card}
          width={width}
          onPress={onPlay}
          disabled={disabled}
          dimmed={dimmed}
          highlighted={highlighted}
        />
        {canDrag ? (
          <Animated.View style={[styles.hint, hintStyle]} pointerEvents="none">
            <View style={styles.hintPill}>
              <AppText variant="caption" color={colors.textDark}>
                Solte para jogar
              </AppText>
            </View>
          </Animated.View>
        ) : null}
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  hint: { position: 'absolute', top: -26, left: 0, right: 0, alignItems: 'center' },
  hintPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: colors.primaryBright,
  },
});
