import React, { PropsWithChildren } from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import { colors, radius, shadows, spacing } from '@/design-system';

interface Props {
  style?: ViewStyle | ViewStyle[];
  padding?: number;
  strong?: boolean;
  testID?: string;
}

/** Translucent teal "glass" card with a thin light border, as in every card of the reference. */
export function Surface({
  style,
  padding = spacing.cardPadding,
  strong,
  children,
  testID,
}: PropsWithChildren<Props>) {
  return (
    <View
      testID={testID}
      style={[styles.card, strong && styles.strong, { padding }, shadows.card, style]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  strong: { borderColor: colors.cardBorderStrong },
});
