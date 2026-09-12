import React from 'react';
import { StyleSheet, View } from 'react-native';
import { colors } from '@/design-system';
import { AppText } from './AppText';
import { Surface } from './Surface';

interface Stat {
  value: string;
  label: string;
  color?: string;
}

/** Four small stat cards: Partidas / Vitórias / Derrotas / Aproveitamento. */
export function StatsRow({ stats }: { stats: Stat[] }) {
  return (
    <View style={styles.row}>
      {stats.map((s) => (
        <Surface key={s.label} padding={0} style={styles.card}>
          <AppText variant="stat" center color={s.color ?? colors.text}>
            {s.value}
          </AppText>
          <AppText
            variant="caption"
            center
            color={colors.textSecondary}
            numberOfLines={1}
            adjustsFontSizeToFit
          >
            {s.label}
          </AppText>
        </Surface>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8 },
  card: {
    flex: 1,
    paddingVertical: 17,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
