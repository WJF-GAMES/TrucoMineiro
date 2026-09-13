import React, { useEffect, useState } from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import Animated, {
  Easing,
  cancelAnimation,
  interpolateColor,
  useAnimatedProps,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, icons, radius } from '@/design-system';
import { AppText } from './AppText';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

interface RingProps {
  /** Instante (epoch ms) em que o tempo acaba. `null` congela o anel onde ele estiver. */
  deadlineAt: number | null;
  /** Duração total do prazo — é ela que diz quanto do anel corresponde a "cheio". */
  totalMs: number;
  size: number;
  strokeWidth?: number;
  style?: ViewStyle;
  children?: React.ReactNode;
}

/**
 * Anel de contagem regressiva desenhado em volta de um avatar.
 *
 * A animação inteira roda na thread de UI (um `withTiming` linear até o fim do prazo), então o
 * relógio não provoca nenhum re-render por segundo. A cor migra de verde para dourado e vermelho
 * conforme o tempo aperta — o tamanho do arco continua indicando o estado sem depender da cor.
 */
export function CountdownRing({
  deadlineAt,
  totalMs,
  size,
  strokeWidth = 3,
  style,
  children,
}: RingProps) {
  const r = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * r;
  const progress = useSharedValue(1);

  useEffect(() => {
    if (deadlineAt === null) {
      cancelAnimation(progress); // reconexão: o anel para onde está em vez de sumir
      return;
    }
    const left = Math.max(0, deadlineAt - Date.now());
    progress.value = totalMs > 0 ? Math.min(1, left / totalMs) : 0;
    progress.value = withTiming(0, { duration: left, easing: Easing.linear });
  }, [deadlineAt, totalMs, progress]);

  const arc = useAnimatedProps(() => ({
    strokeDashoffset: circumference * (1 - progress.value),
    stroke: interpolateColor(
      progress.value,
      [0, 0.18, 0.45, 1],
      [colors.danger, colors.dangerSoft, colors.gold, colors.primaryBright],
    ),
  }));

  return (
    <View style={[{ width: size, height: size }, style]}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="rgba(255,255,255,0.14)"
          strokeWidth={strokeWidth}
          fill="none"
        />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={circumference}
          animatedProps={arc}
          // Começa no topo e desce no sentido horário, como um relógio.
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View style={styles.ringSlot}>{children}</View>
    </View>
  );
}

interface TextProps {
  deadlineAt: number | null;
  /** Abaixo disso o relógio vira alerta. */
  warningMs?: number;
  format: (ms: number) => string;
  testID?: string;
}

/**
 * "00:08" ao lado do nome. Componente isolado de propósito: é o único pedaço da cerimônia que
 * re-renderiza de segundo em segundo, então nada mais da mesa paga por ele.
 */
export function CountdownText({ deadlineAt, warningMs = 4000, format, testID }: TextProps) {
  const [left, setLeft] = useState(() => Math.max(0, (deadlineAt ?? Date.now()) - Date.now()));

  useEffect(() => {
    if (deadlineAt === null) return;
    const tick = () => setLeft(Math.max(0, deadlineAt - Date.now()));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [deadlineAt]);

  const urgent = left <= warningMs;
  const color = urgent ? colors.dangerSoft : colors.gold;
  return (
    <View style={[styles.clock, urgent && styles.clockUrgent]} testID={testID}>
      <Ionicons name={icons.clock} size={14} color={color} />
      <AppText variant="smallBold" color={color} style={styles.clockText}>
        {format(left)}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  ringSlot: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  clock: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(0,0,0,0.32)',
    borderWidth: 1,
    borderColor: 'rgba(237, 190, 15, 0.45)',
  },
  clockUrgent: { borderColor: 'rgba(255, 77, 87, 0.6)' },
  clockText: { marginLeft: 5, fontVariant: ['tabular-nums'] },
});
