import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { colors, spacing } from '@/design-system';
import { AppText } from './AppText';

export function SectionTitle({
  title,
  actionLabel,
  onAction,
  style,
}: {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
  style?: object;
}) {
  return (
    <View style={[styles.row, style]}>
      <AppText variant="h3" style={{ fontSize: 17 }}>
        {title}
      </AppText>
      {actionLabel ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          onPress={onAction}
          hitSlop={8}
        >
          <AppText variant="small" color={colors.textSecondary}>
            {actionLabel}
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
});
