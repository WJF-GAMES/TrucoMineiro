import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, gradients, radius } from '@/design-system';
import { AppText } from './AppText';
import { haptic } from '@/utils/haptics';

export interface ChipOption<T extends string> {
  key: T;
  label: string;
  badge?: number;
}

interface Props<T extends string> {
  options: ChipOption<T>[];
  value: T;
  onChange: (v: T) => void;
  scroll?: boolean;
  testID?: string;
}

/** Segmented pill tabs ("Meus Amigos | Solicitações | Buscar", store categories). */
export function Chips<T extends string>({ options, value, onChange, scroll, testID }: Props<T>) {
  const content = options.map((o) => {
    const active = o.key === value;
    return (
      <Pressable
        key={o.key}
        testID={`${testID ?? 'chip'}-${o.key}`}
        accessibilityRole="tab"
        accessibilityState={{ selected: active }}
        accessibilityLabel={o.label}
        onPress={() => {
          haptic.selection();
          onChange(o.key);
        }}
        // A pílula tem 38dp de altura por desenho; o hitSlop leva o alvo real aos 44dp
        // recomendados sem mudar o visual (regra 14).
        hitSlop={{ top: 6, bottom: 6 }}
        style={styles.chipWrap}
      >
        {active ? (
          <LinearGradient
            colors={gradients.primaryChip}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={[styles.chip, styles.active]}
          >
            <ChipLabel label={o.label} badge={o.badge} active />
          </LinearGradient>
        ) : (
          <View style={[styles.chip, styles.inactive]}>
            <ChipLabel label={o.label} badge={o.badge} />
          </View>
        )}
      </Pressable>
    );
  });
  if (scroll) {
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {content}
      </ScrollView>
    );
  }
  return <View style={styles.row}>{content}</View>;
}

function ChipLabel({ label, badge, active }: { label: string; badge?: number; active?: boolean }) {
  return (
    <View style={styles.labelRow}>
      <AppText
        variant="smallBold"
        color={active ? colors.text : colors.textSecondary}
        style={styles.label}
        numberOfLines={1}
        // A pílula tem altura fixa: sem o teto o rótulo é cortado na fonte máxima do sistema.
        maxFontSizeMultiplier={1.2}
      >
        {label}
      </AppText>
      {badge ? (
        <View style={styles.badge}>
          <AppText variant="caption" color={colors.text} style={{ fontSize: 10 }}>
            {badge}
          </AppText>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8 },
  chipWrap: { borderRadius: radius.pill },
  chip: {
    height: 38,
    paddingHorizontal: 16,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  active: { borderColor: 'rgba(120,255,190,0.5)' },
  inactive: { backgroundColor: 'rgba(15, 50, 46, 0.9)', borderColor: colors.cardBorder },
  label: { fontSize: 13, flexShrink: 1 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  badge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
