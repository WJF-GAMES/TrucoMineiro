import React from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, radius, spacing } from '@/design-system';
import { AppText } from '@/components';

/**
 * Identificação obrigatória de anúncio. Vive num componente próprio para que todo conteúdo
 * patrocinado do app use exatamente o mesmo rótulo, e para que ninguém consiga "escondê-lo"
 * sem passar por aqui.
 */
export function SponsoredBadge({ label = 'Patrocinado' }: { label?: string }) {
  return (
    <View style={styles.badge} accessibilityLabel={`${label}. Conteúdo de anúncio.`}>
      <AppText variant="caption" color={colors.textMuted}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.xs,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1,
    borderColor: colors.divider,
  },
});
