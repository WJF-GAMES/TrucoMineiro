import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, spacing } from '@/design-system';
import { AppText, PrimaryButton, SecondaryButton, Sheet } from '@/components';
import { useAdStore } from '../core/AdState';
import { SponsoredBadge } from './SponsoredBadge';

interface Props {
  visible: boolean;
  title: string;
  description: string;
  /** Texto do botão de confirmação. Nunca pode prometer nada além do conteúdo liberado. */
  confirmLabel: string;
  loading?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  testID?: string;
}

/**
 * Confirmação explícita antes de um Rewarded.
 *
 * Nenhum rewarded começa sem passar por aqui: o usuário lê o que ganha, vê que é anúncio e
 * escolhe. "Agora não" é um caminho de primeira classe, não um botão escondido.
 */
export function RewardedGate({
  visible,
  title,
  description,
  confirmLabel,
  loading,
  onCancel,
  onConfirm,
  testID,
}: Props) {
  // Enquanto a folha está aberta, nenhum full-screen automático pode roubar a tela.
  useEffect(() => {
    if (!visible) return;
    const store = useAdStore.getState();
    store.pushCriticalModal();
    return () => {
      useAdStore.getState().popCriticalModal();
    };
  }, [visible]);

  return (
    <Sheet visible={visible} onClose={onCancel} title={title} testID={testID}>
      <View style={styles.badgeRow}>
        <SponsoredBadge label="Conteúdo patrocinado" />
      </View>
      <View style={styles.row}>
        <Ionicons name="play-circle" size={28} color={colors.primaryBright} />
        <AppText variant="body" color={colors.textSecondary} style={styles.description}>
          {description}
        </AppText>
      </View>
      <PrimaryButton
        label={confirmLabel}
        onPress={onConfirm}
        loading={loading}
        style={styles.confirm}
        testID={testID ? `${testID}-confirm` : undefined}
      />
      <SecondaryButton
        label="Agora não"
        onPress={onCancel}
        disabled={loading}
        style={styles.cancel}
        testID={testID ? `${testID}-cancel` : undefined}
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  badgeRow: { marginBottom: spacing.md },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  description: { flex: 1 },
  confirm: { marginTop: spacing.xl },
  cancel: { marginTop: spacing.sm },
});
