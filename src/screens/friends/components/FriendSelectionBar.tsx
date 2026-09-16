import React from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, icons, radius, spacing } from '@/design-system';
import { AppText, PrimaryButton, SecondaryButton } from '@/components';
import { selectionCounter, tablePreview } from '@/features/friends/friendSelection';

/**
 * Rodapé do modo "jogar com amigos": contador, como a mesa vai ficar e o CTA.
 * Fica fora da lista, então marcar/desmarcar não mexe na rolagem.
 */
export function FriendSelectionBar({
  count,
  busy,
  onConfirm,
  onCancel,
}: {
  count: number;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <View style={styles.bar} testID="friends-select-bar">
      <View style={styles.texts}>
        <AppText
          variant="bodyBold"
          accessibilityLiveRegion="polite"
          testID="friends-select-counter"
        >
          {selectionCounter(count)}
        </AppText>
        <AppText variant="caption" color={colors.textSecondary}>
          {tablePreview(count)}
        </AppText>
      </View>
      <View style={styles.actions}>
        <SecondaryButton
          label="Cancelar"
          size="md"
          onPress={onCancel}
          disabled={busy}
          style={styles.cancel}
          testID="friends-select-cancel"
        />
        <PrimaryButton
          label="Criar sala"
          accessibilityLabel="Criar sala e convidar os amigos selecionados"
          size="md"
          icon={icons.gameController}
          onPress={onConfirm}
          disabled={count === 0 || busy}
          loading={busy}
          style={styles.confirm}
          testID="friends-select-confirm"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    marginHorizontal: spacing.screen,
    marginBottom: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.card,
    backgroundColor: colors.cardSolid,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  texts: { marginBottom: spacing.sm },
  actions: { flexDirection: 'row', gap: spacing.sm },
  cancel: { flex: 1 },
  confirm: { flex: 2 },
});
