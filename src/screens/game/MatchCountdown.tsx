import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut, ZoomIn, ZoomOut } from 'react-native-reanimated';
import { colors } from '@/design-system';
import { AppText } from '@/components';
import { haptic } from '@/utils/haptics';
import { nowMs } from '@/utils/clock';

/**
 * Cada número fica este tempo na tela; "Valendo!" fecha a contagem.
 * Uma contagem regressiva é lida no compasso do segundo: com 850 ms ela passava antes de o
 * jogador reconhecer a mesa, que é justamente o que esta abertura existe para dar.
 */
export const COUNTDOWN_STEP_MS = 1_000;
export const COUNTDOWN_STEPS = ['3', '2', '1', 'Valendo!'] as const;
export const COUNTDOWN_TOTAL_MS = COUNTDOWN_STEP_MS * COUNTDOWN_STEPS.length;

interface Props {
  onDone: () => void;
}

/**
 * Abertura da partida: "3… 2… 1… Valendo!" no centro da mesa antes do primeiro embaralho.
 * Dá ao jogador um respiro para reconhecer a mesa (parceiro, adversários, placar) antes de a
 * cerimônia começar. Só apresentação — nenhuma regra depende disto.
 */
export function MatchCountdown({ onDone }: Props) {
  // Passo derivado do relógio, não de timers encadeados: se a thread JS engasgar na abertura da
  // partida (é quando tudo monta), a contagem pula um número em vez de esticar o "3" por segundos.
  const startedAt = useMemo(() => nowMs(), []);
  const [step, setStep] = useState(0);

  useEffect(() => {
    const tick = () => {
      const next = Math.min(
        COUNTDOWN_STEPS.length,
        Math.floor((Date.now() - startedAt) / COUNTDOWN_STEP_MS),
      );
      setStep((prev) => (next > prev ? next : prev));
    };
    const id = setInterval(tick, 60);
    return () => clearInterval(id);
  }, [startedAt]);

  useEffect(() => {
    if (step >= COUNTDOWN_STEPS.length) {
      onDone();
      return;
    }
    if (step < COUNTDOWN_STEPS.length - 1) haptic.light();
    else haptic.success();
  }, [step, onDone]);

  if (step >= COUNTDOWN_STEPS.length) return null;
  const label = COUNTDOWN_STEPS[step]!;
  const final = step === COUNTDOWN_STEPS.length - 1;

  return (
    <Animated.View
      style={styles.root}
      entering={FadeIn.duration(200)}
      exiting={FadeOut.duration(220)}
      pointerEvents="none"
      testID="match-countdown"
    >
      <View style={styles.dim} />
      <Animated.View
        key={label}
        entering={ZoomIn.springify().damping(14).stiffness(180)}
        exiting={ZoomOut.duration(180)}
        style={[styles.bubble, final && styles.bubbleFinal]}
      >
        <AppText
          variant="display"
          center
          color={final ? colors.textDark : colors.text}
          style={[styles.number, final && styles.numberFinal]}
        >
          {label}
        </AppText>
      </Animated.View>
      {!final ? (
        <AppText variant="smallBold" color={colors.textSecondary} center style={styles.hint}>
          A partida vai começar
        </AppText>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dim: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 20, 14, 0.45)',
  },
  bubble: {
    width: 150,
    height: 150,
    borderRadius: 75,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 40, 26, 0.85)',
    borderWidth: 3,
    borderColor: colors.primaryBright,
    shadowColor: colors.primaryBright,
    shadowOpacity: 0.8,
    shadowRadius: 18,
    elevation: 10,
  },
  bubbleFinal: {
    width: 220,
    borderRadius: 40,
    backgroundColor: colors.gold,
    borderColor: colors.gold,
    shadowColor: colors.gold,
  },
  number: { fontSize: 72, lineHeight: 80 },
  numberFinal: { fontSize: 40, lineHeight: 48 },
  hint: { marginTop: 18 },
});
