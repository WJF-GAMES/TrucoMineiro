import React from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors } from '@/design-system';

export function ProgressBar({
  value,
  max,
  height = 10,
  style,
}: {
  value: number;
  max: number;
  height?: number;
  style?: ViewStyle;
}) {
  const ratio = max <= 0 ? 0 : Math.min(1, Math.max(0, value / max));
  return (
    <View
      style={[styles.track, { height, borderRadius: height / 2 }, style]}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max, now: value }}
    >
      <LinearGradient
        colors={[colors.primaryBright, colors.primary]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={[styles.fill, { width: `${ratio * 100}%`, borderRadius: height / 2 }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    backgroundColor: 'rgba(0, 25, 20, 0.9)',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(120,200,170,0.2)',
  },
  fill: { height: '100%' },
});
