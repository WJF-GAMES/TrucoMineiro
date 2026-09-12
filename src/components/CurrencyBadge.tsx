import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, radius } from '@/design-system';
import { images } from '@/assets';
import { AppText } from './AppText';
import { formatNumber } from '@/utils/format';

interface Props {
  kind: 'coin' | 'gem';
  value: number;
  onAdd?: () => void;
  testID?: string;
}

/** Pill with currency icon, amount and a green "+" (header of Jogar/Liga). */
export function CurrencyBadge({ kind, value, onAdd, testID }: Props) {
  return (
    <View
      style={styles.pill}
      testID={testID}
      accessibilityLabel={`${formatNumber(value)} ${kind === 'coin' ? 'moedas' : 'gemas'}`}
    >
      <Image
        source={kind === 'coin' ? images.coin : images.gem}
        style={styles.icon}
        contentFit="contain"
      />
      <AppText variant="bodyBold" style={styles.value}>
        {formatNumber(value)}
      </AppText>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={kind === 'coin' ? 'Comprar moedas' : 'Comprar gemas'}
        onPress={onAdd}
        hitSlop={6}
        style={styles.plus}
      >
        <Ionicons name="add" size={16} color={colors.text} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 38,
    paddingLeft: 6,
    paddingRight: 5,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(3, 30, 26, 0.9)',
    borderWidth: 1,
    borderColor: colors.cardBorderStrong,
  },
  icon: { width: 24, height: 24 },
  value: { marginHorizontal: 7, fontSize: 15 },
  plus: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.primaryDark,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(120,255,190,0.5)',
  },
});
