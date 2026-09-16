import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, icons } from '@/design-system';
import { AppText } from '@/components';
import { cardId, type Card } from '@/domain/game';
import { haptic } from '@/utils/haptics';
import { PlayingCard } from './PlayingCard';

const SUIT_NAME: Record<Card['suit'], string> = {
  paus: 'paus',
  copas: 'copas',
  espadas: 'espadas',
  ouros: 'ouros',
};

interface Props {
  card: Card;
  width: number;
  /** `undefined` quando a carta não pode ser jogada agora: o toque não faz nada. */
  onPlay?: () => void;
  dimmed?: boolean;
  highlighted?: boolean;
  /** Desempate por cango: esta é a maior carta, a única que pode ser jogada. */
  required?: boolean;
  /** O modo "virada" está armado: o toque joga esta carta com a face para baixo. */
  coverArmed?: boolean;
}

/**
 * Carta da mão do jogador. Jogar é **um toque**: a mesa assume a trajetória até o slot (não há
 * arraste nem ponto de soltura). O retorno visual é imediato — a carta afunda no toque e o
 * háptico dispara antes de a jogada chegar ao motor/servidor.
 */
export function HandCard({
  card,
  width,
  onPlay,
  dimmed,
  highlighted,
  required,
  coverArmed,
}: Props) {
  const name = `${card.rank} de ${SUIT_NAME[card.suit]}`;
  const enabled = Boolean(onPlay);
  const label = !enabled ? name : coverArmed ? `Jogar ${name} virada` : `Jogar ${name}`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={
        required ? 'Esta é a maior carta e deve ser jogada no desempate.' : undefined
      }
      accessibilityState={{ disabled: !enabled }}
      disabled={!enabled}
      onPress={() => {
        haptic.medium();
        onPlay?.();
      }}
      hitSlop={4}
      style={({ pressed }) => [styles.wrap, pressed && enabled && styles.pressed]}
      testID={`hand-${cardId(card)}`}
    >
      <PlayingCard card={card} width={width} dimmed={dimmed} highlighted={highlighted} />
      {coverArmed && enabled ? (
        // Prévia do que o toque vai fazer: a carta sai de face para baixo.
        <View style={[styles.coverVeil, { borderRadius: Math.round(width * 0.1) }]}>
          <Ionicons name={icons.coveredCard} size={Math.round(width * 0.32)} color={colors.text} />
          <AppText variant="caption" color={colors.text} style={styles.veilText}>
            VIRADA
          </AppText>
        </View>
      ) : null}
      {required ? (
        <View style={styles.requiredTag} pointerEvents="none">
          <AppText variant="caption" color={colors.textDark}>
            MAIOR
          </AppText>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center' },
  pressed: { transform: [{ translateY: -8 }, { scale: 1.04 }] },
  coverVeil: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(8, 20, 16, 0.72)',
    borderWidth: 2,
    borderColor: colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  veilText: { marginTop: 2, letterSpacing: 1 },
  // Selo discreto na base da carta obrigatória: não depende só do brilho para ser entendido.
  requiredTag: {
    position: 'absolute',
    bottom: -9,
    alignSelf: 'center',
    paddingHorizontal: 7,
    paddingVertical: 1,
    borderRadius: 999,
    backgroundColor: colors.gold,
  },
});
