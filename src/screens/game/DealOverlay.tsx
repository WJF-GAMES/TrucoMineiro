import React, { useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { nextSeat, type Card, type Seat } from '@/domain/game';
import { relativePosition, type TablePosition } from '@/features/game/seatLayout';
import { DEAL_TIMING } from '@/features/game/shuffleCeremony';
import { PlayingCard } from './PlayingCard';

/** Ponto (centro) no sistema de coordenadas do corpo da mesa. */
export interface Point {
  x: number;
  y: number;
}

/** Onde cada carta deve pousar: os montinhos dos outros e os três slots da minha mão. */
export interface DealTargets {
  /** Centro do baralho de onde as cartas saem. */
  origin: Point;
  /** Centro do montinho de versos de cada adversário/parceiro. */
  seats: Partial<Record<Exclude<TablePosition, 'bottom'>, Point>>;
  /** Centro de cada um dos meus três slots, da esquerda para a direita. */
  hand: Point[];
}

/** Largura das cartas na mão (a mesma de `DraggableCard` na mesa) e dos versos nos assentos. */
const HAND_CARD_W = 82;
const BACK_CARD_W = 20;
const DECK_CARD_W = 66;

interface Props {
  targets: DealTargets;
  dealerSeat: Seat;
  mySeat: Seat;
  /** Minhas três cartas — viram viradas para cima no lugar, no fim. */
  myCards: Card[];
}

/**
 * Distribuição de verdade: doze cartas saem do baralho, uma a uma, na ordem da mesa (a partir do
 * assento depois de quem deu), e cada uma **pousa exatamente onde vai ficar** — no montinho de
 * versos do assento ou num dos três slots da minha mão. A única animação depois disso é virar
 * as minhas cartas no lugar. Quando a cerimônia fecha, a mesa real assume nas mesmas posições:
 * nada pisca, nada cai de novo.
 */
export function DealOverlay({ targets, dealerSeat, mySeat, myCards }: Props) {
  const plan = useMemo(() => {
    const order: Seat[] = [];
    let s = nextSeat(dealerSeat);
    for (let i = 0; i < 4; i++) {
      order.push(s);
      s = nextSeat(s);
    }
    const items: {
      key: string;
      to: Point;
      width: number;
      mine: boolean;
      card: Card | null;
      index: number;
    }[] = [];
    let handIndex = 0;
    for (let round = 0; round < 3; round++) {
      for (const seat of order) {
        const pos = relativePosition(seat, mySeat);
        const index = items.length;
        if (pos === 'bottom') {
          const slot = targets.hand[handIndex] ?? targets.hand[targets.hand.length - 1];
          items.push({
            key: `me-${handIndex}`,
            to: slot ?? targets.origin,
            width: HAND_CARD_W,
            mine: true,
            card: myCards[handIndex] ?? null,
            index,
          });
          handIndex++;
        } else {
          const to = targets.seats[pos] ?? targets.origin;
          items.push({
            key: `${pos}-${round}`,
            to,
            width: BACK_CARD_W,
            mine: false,
            card: null,
            index,
          });
        }
      }
    }
    return items;
  }, [targets, dealerSeat, mySeat, myCards]);

  const flip = useSharedValue(0);
  useEffect(() => {
    const lastLanding = DEAL_TIMING.staggerMs * 11 + DEAL_TIMING.flyMs;
    flip.value = 0;
    flip.value = withDelay(
      lastLanding + DEAL_TIMING.flipDelayMs,
      withTiming(1, { duration: DEAL_TIMING.flipMs, easing: Easing.inOut(Easing.cubic) }),
    );
  }, [flip]);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" testID="deal-overlay">
      {/* O que sobra do baralho, no lugar de onde as cartas saem */}
      <View
        style={[
          styles.abs,
          {
            left: targets.origin.x - DECK_CARD_W / 2,
            top: targets.origin.y - (DECK_CARD_W * 1.45) / 2,
          },
        ]}
      >
        <PlayingCard faceDown width={DECK_CARD_W} />
      </View>
      {plan.map((item) => (
        <DealtCard
          key={item.key}
          from={targets.origin}
          to={item.to}
          width={item.width}
          index={item.index}
          mine={item.mine}
          card={item.card}
          flip={flip}
        />
      ))}
    </View>
  );
}

function DealtCard({
  from,
  to,
  width,
  index,
  mine,
  card,
  flip,
}: {
  from: Point;
  to: Point;
  width: number;
  index: number;
  mine: boolean;
  card: Card | null;
  flip: SharedValue<number>;
}) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = 0;
    t.value = withDelay(
      index * DEAL_TIMING.staggerMs,
      withTiming(1, { duration: DEAL_TIMING.flyMs, easing: Easing.out(Easing.cubic) }),
    );
  }, [t, index]);

  const height = Math.round(width * 1.45);
  const startScale = DECK_CARD_W / width;

  const body = useAnimatedStyle(() => ({
    opacity: interpolate(t.value, [0, 0.05], [0, 1]),
    transform: [
      { translateX: interpolate(t.value, [0, 1], [from.x, to.x]) - width / 2 },
      { translateY: interpolate(t.value, [0, 1], [from.y, to.y]) - height / 2 },
      { scale: interpolate(t.value, [0, 1], [startScale, 1]) },
      { rotate: `${interpolate(t.value, [0, 0.5, 1], [0, mine ? -6 : 10, 0])}deg` },
    ],
  }));

  // Virada no lugar: o verso gira até 90° e some; a face aparece dos 90° até 0°.
  const backStyle = useAnimatedStyle(() => ({
    opacity: mine ? (flip.value < 0.5 ? 1 : 0) : 1,
    transform: [
      { perspective: 800 },
      { rotateY: `${interpolate(flip.value, [0, 1], [0, 180])}deg` },
    ],
  }));
  const faceStyle = useAnimatedStyle(() => ({
    opacity: flip.value >= 0.5 ? 1 : 0,
    transform: [
      { perspective: 800 },
      { rotateY: `${interpolate(flip.value, [0, 1], [-180, 0])}deg` },
    ],
  }));

  return (
    <Animated.View style={[styles.abs, { width, height }, body]}>
      <Animated.View style={[StyleSheet.absoluteFill, backStyle]}>
        <PlayingCard faceDown width={width} />
      </Animated.View>
      {mine && card ? (
        <Animated.View style={[StyleSheet.absoluteFill, faceStyle]}>
          <PlayingCard card={card} width={width} />
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  abs: { position: 'absolute', left: 0, top: 0 },
});
