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
          <AppText
            variant="stat"
            center
            color={s.color ?? colors.text}
            numberOfLines={1}
            maxFontSizeMultiplier={1.3}
          >
            {s.value}
          </AppText>
          {/* "Aproveitamento" é 1–2px mais largo que o card em telas de 375dp: encolhe um
              pouco em vez de quebrar a linha (o que desalinharia os números dos quatro cards),
              e a escala do sistema é limitada porque o card tem altura própria. */}
          <AppText
            variant="caption"
            center
            color={colors.textSecondary}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.75}
            maxFontSizeMultiplier={1.2}
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
