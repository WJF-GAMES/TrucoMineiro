import React from 'react';
import { Pressable, StyleSheet, View, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, fontFamily } from '@/design-system';
import { AppText } from '@/components/AppText';
import { Card, cardId, isManilha, Suit } from '@/domain/game';
import { haptic } from '@/utils/haptics';

const SUIT_SYMBOL: Record<Suit, string> = { paus: '♣', copas: '♥', espadas: '♠', ouros: '♦' };
const SUIT_COLOR: Record<Suit, string> = {
  paus: '#1c1c1c',
  copas: '#c8102e',
  espadas: '#1c1c1c',
  ouros: '#c8102e',
};
const SUIT_NAME: Record<Suit, string> = {
  paus: 'paus',
  copas: 'copas',
  espadas: 'espadas',
  ouros: 'ouros',
};

interface Props {
  card?: Card | null;
  faceDown?: boolean;
  width?: number;
  onPress?: () => void;
  disabled?: boolean;
  highlighted?: boolean;
  dimmed?: boolean;
  style?: ViewStyle;
  testID?: string;
}

/**
 * Playing card drawn natively: cream face with the rank on both corners and a large centred suit,
 * or the ornate red back used across the reference art.
 */
export function PlayingCard({
  card,
  faceDown,
  width = 64,
  onPress,
  disabled,
  highlighted,
  dimmed,
  style,
  testID,
}: Props) {
  const height = Math.round(width * 1.45);
  const radius = Math.round(width * 0.1);

  if (faceDown || !card) {
    return (
      <View
        style={[styles.back, { width, height, borderRadius: radius }, style]}
        testID={testID}
        accessibilityLabel="Carta virada"
      >
        <LinearGradient
          colors={['#c8172f', '#8b0f22']}
          style={[StyleSheet.absoluteFill, { borderRadius: radius }]}
        />
        <View
          style={[
            styles.backInner,
            { borderRadius: Math.max(2, radius * 0.6), margin: Math.max(2, width * 0.08) },
          ]}
        >
          <View style={[styles.backDiamond, { width: width * 0.32, height: width * 0.32 }]} />
        </View>
      </View>
    );
  }

  const color = SUIT_COLOR[card.suit];
  const manilha = isManilha(card);
  const rankSize = Math.round(width * 0.32);
  const cornerSuitSize = Math.round(width * 0.2);
  const centreSuitSize = Math.round(width * 0.42);

  const corner = (bottom?: boolean) => (
    <View style={[styles.corner, bottom ? styles.cornerBottom : styles.cornerTop]}>
      <AppText style={[styles.rank, { fontSize: rankSize, lineHeight: rankSize * 1.05, color }]}>
        {card.rank}
      </AppText>
      <AppText
        style={[
          styles.suit,
          { fontSize: cornerSuitSize, lineHeight: cornerSuitSize * 1.05, color },
        ]}
      >
        {SUIT_SYMBOL[card.suit]}
      </AppText>
    </View>
  );

  const content = (
    <View
      style={[
        styles.face,
        { width, height, borderRadius: radius },
        manilha && styles.manilha,
        highlighted && styles.highlight,
        dimmed && styles.dimmed,
        style,
      ]}
      testID={testID ?? `card-${cardId(card)}`}
      accessibilityLabel={`${card.rank} de ${SUIT_NAME[card.suit]}`}
    >
      {corner()}
      <View style={styles.centre} pointerEvents="none">
        <AppText
          style={[
            styles.suit,
            { fontSize: centreSuitSize, lineHeight: centreSuitSize * 1.1, color, opacity: 0.92 },
          ]}
        >
          {SUIT_SYMBOL[card.suit]}
        </AppText>
      </View>
      {corner(true)}
    </View>
  );

  if (!onPress) return content;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Jogar ${card.rank} de ${SUIT_NAME[card.suit]}`}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => {
        haptic.medium();
        onPress();
      }}
      style={({ pressed }) => (pressed && !disabled ? styles.pressed : undefined)}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  back: {
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#f5ecd8',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  backInner: {
    flex: 1,
    alignSelf: 'stretch',
    borderWidth: 1.5,
    borderColor: 'rgba(255,225,205,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backDiamond: {
    backgroundColor: 'rgba(255,225,205,0.28)',
    borderWidth: 1,
    borderColor: 'rgba(255,235,220,0.45)',
    transform: [{ rotate: '45deg' }],
  },
  face: {
    backgroundColor: '#fbf6ea',
    borderWidth: 1.5,
    borderColor: '#d9cfb8',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  /**
   * Quinas da carta. As duas âncoras vivem em estilos separados de propósito: no React Native
   * um `top: undefined` num estilo posterior NÃO apaga o `top` do anterior — ele é ignorado na
   * fusão. Com `corner` trazendo top/left, a quina de baixo acabava com as quatro âncoras ao
   * mesmo tempo e caía em cima da de cima (a carta mostrava "3 3" lado a lado no topo).
   */
  corner: { position: 'absolute', alignItems: 'center' },
  cornerTop: { top: 3, left: 5 },
  // Baralho de verdade: a quina de baixo é a de cima girada meia-volta.
  cornerBottom: { bottom: 3, right: 5, transform: [{ rotate: '180deg' }] },
  centre: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rank: { fontFamily: fontFamily.black },
  suit: { fontFamily: fontFamily.bold },
  highlight: { borderColor: colors.primaryBright, borderWidth: 2.5 },
  manilha: { borderColor: colors.gold, borderWidth: 2.5 },
  dimmed: { opacity: 0.72 },
  pressed: { transform: [{ translateY: -6 }] },
});
