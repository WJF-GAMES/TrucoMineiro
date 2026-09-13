import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, IoniconName, motion, radius, spacing } from '@/design-system';
import { AppText } from '@/components';
import { haptic } from '@/utils/haptics';

export interface QuickAction {
  key: string;
  icon: IoniconName;
  label: string;
  onPress: () => void;
  loading?: boolean;
  /** Destaca a ação principal do momento (sincronizar, quando ainda não sincronizou). */
  highlight?: boolean;
  testID?: string;
}

/**
 * Quatro atalhos compactos em uma linha. Compactos de propósito: a tela já tem banner,
 * busca e listas — mais um bloco de botões grandes competiria com o conteúdo (regra 71).
 */
export function FriendsQuickActions({ actions }: { actions: QuickAction[] }) {
  return (
    <View style={styles.row}>
      {actions.map((a) => (
        <Pressable
          key={a.key}
          testID={a.testID}
          accessibilityRole="button"
          accessibilityLabel={a.label}
          accessibilityState={{ busy: a.loading }}
          disabled={a.loading}
          onPress={() => {
            haptic.selection();
            a.onPress();
          }}
          style={({ pressed }) => [
            styles.action,
            a.highlight && styles.highlight,
            pressed && { transform: [{ scale: motion.pressScale }] },
          ]}
        >
          <View style={[styles.iconBox, a.highlight && styles.iconBoxHighlight]}>
            {a.loading ? (
              <ActivityIndicator size="small" color={colors.primaryBright} />
            ) : (
              <Ionicons
                name={a.icon}
                size={20}
                color={a.highlight ? colors.primaryBright : colors.cream}
              />
            )}
          </View>
          <AppText variant="small" center numberOfLines={2} style={styles.label}>
            {a.label}
          </AppText>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  action: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  highlight: { borderColor: colors.cardBorderStrong, backgroundColor: colors.cardMuted },
  iconBox: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(4, 21, 23, 0.55)',
  },
  iconBoxHighlight: { backgroundColor: colors.primaryGlow },
  label: { marginTop: 6, fontSize: 11.5, lineHeight: 14 },
});
