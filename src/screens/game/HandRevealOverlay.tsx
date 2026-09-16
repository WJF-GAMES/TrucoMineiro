import React from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut, FlipInYLeft } from 'react-native-reanimated';
import { colors, radius, spacing } from '@/design-system';
import { AppText } from '@/components';
import { cardId, type Card, type Seat } from '@/domain/game';
import type { TablePlayer } from '@/features/game/types';
import { relativePosition, type TablePosition } from '@/features/game/seatLayout';
import { PlayingCard } from './PlayingCard';

interface Props {
  /** `hands[seat]`: o que cada assento tinha na mão quando a mão acabou. */
  hands: Card[][];
  players: TablePlayer[];
  mySeat: Seat;
}

const ORDER: TablePosition[] = ['top', 'left', 'right', 'bottom'];
const SUIT: Record<Card['suit'], string> = {
  paus: 'paus',
  copas: 'copas',
  espadas: 'espadas',
  ouros: 'ouros',
};

/**
 * Mão de onze recusada: as cartas de todos viram na mesa, cada grupo no lado de quem as tinha.
 * Só apresentação — o resultado já foi decidido e pontuado pelo motor.
 */
export function HandRevealOverlay({ hands, players, mySeat }: Props) {
  const bySeat = new Map(players.map((p) => [p.seat, p]));
  const seats = ([0, 1, 2, 3] as Seat[]).sort(
    (a, b) =>
      ORDER.indexOf(relativePosition(a, mySeat)) - ORDER.indexOf(relativePosition(b, mySeat)),
  );
  return (
    <Animated.View
      entering={FadeIn.duration(180)}
      exiting={FadeOut.duration(220)}
      style={styles.root}
      pointerEvents="none"
      testID="hand-reveal"
      accessibilityLiveRegion="polite"
    >
      <AppText variant="h3" center color={colors.gold} style={styles.title}>
        Correram! Olha o que cada um tinha
      </AppText>
      <View style={styles.grid}>
        {seats.map((seat) => {
          const pos = relativePosition(seat, mySeat);
          const name = seat === mySeat ? 'Você' : (bySeat.get(seat)?.nickname ?? '...');
          const cards = hands[seat] ?? [];
          return (
            <View
              key={seat}
              // Parceiro em cima, adversários nos lados, eu embaixo — como na mesa.
              style={[styles.group, pos === 'top' || pos === 'bottom' ? styles.full : styles.half]}
              testID={`reveal-${seat}`}
              accessible
              accessibilityLabel={`${name}: ${
                cards.length
                  ? cards.map((c) => `${c.rank} de ${SUIT[c.suit]}`).join(', ')
                  : 'sem cartas'
              }`}
            >
              <AppText variant="smallBold" numberOfLines={1} style={styles.name}>
                {name}
                {pos !== 'bottom' && seat % 2 === mySeat % 2 ? ' (parceiro)' : ''}
              </AppText>
              <View style={styles.cards}>
                {cards.map((c, i) => (
                  <Animated.View key={cardId(c)} entering={FlipInYLeft.delay(80 * i).duration(260)}>
                    <PlayingCard card={c} width={44} />
                  </Animated.View>
                ))}
              </View>
            </View>
          );
        })}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    top: '14%',
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
    borderRadius: radius.card,
    backgroundColor: 'rgba(4, 22, 17, 0.92)',
    borderWidth: 1,
    borderColor: colors.gold,
  },
  title: { marginBottom: spacing.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', rowGap: spacing.md },
  group: { alignItems: 'center' },
  full: { width: '100%' },
  half: { width: '50%' },
  name: { maxWidth: '90%', marginBottom: 6 },
  cards: { flexDirection: 'row', gap: 4 },
});
