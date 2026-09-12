import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, IoniconName, spacing } from '@/design-system';
import { AppText } from './AppText';
import { PrimaryButton, SecondaryButton } from './Buttons';

interface Props {
  kind: 'loading' | 'empty' | 'error' | 'offline';
  title?: string;
  message?: string;
  icon?: IoniconName;
  actionLabel?: string;
  onAction?: () => void;
  compact?: boolean;
  testID?: string;
}

const DEFAULTS: Record<Props['kind'], { title: string; message: string; icon: IoniconName }> = {
  loading: { title: 'Carregando...', message: 'Só um instante.', icon: 'hourglass' },
  empty: {
    title: 'Nada por aqui ainda',
    message: 'Quando algo aparecer, você verá aqui.',
    icon: 'leaf',
  },
  error: {
    title: 'Algo deu errado',
    message: 'Não conseguimos carregar. Tente novamente.',
    icon: 'warning',
  },
  offline: {
    title: 'Sem conexão',
    message: 'Verifique sua internet e tente de novo.',
    icon: 'cloud-offline',
  },
};

/** Loading / empty / error / offline states with the same visual language as the rest of the app. */
export function StateView({
  kind,
  title,
  message,
  icon,
  actionLabel,
  onAction,
  compact,
  testID,
}: Props) {
  const d = DEFAULTS[kind];
  return (
    <View style={[styles.wrap, compact && styles.compact]} testID={testID ?? `state-${kind}`}>
      {kind === 'loading' ? (
        <ActivityIndicator size="large" color={colors.primary} />
      ) : (
        <View style={styles.iconCircle}>
          <Ionicons
            name={icon ?? d.icon}
            size={30}
            color={kind === 'error' ? colors.dangerSoft : colors.primaryBright}
          />
        </View>
      )}
      <AppText variant="h3" center style={styles.title}>
        {title ?? d.title}
      </AppText>
      <AppText variant="small" center color={colors.textSecondary} style={styles.message}>
        {message ?? d.message}
      </AppText>
      {actionLabel && onAction ? (
        kind === 'error' || kind === 'offline' ? (
          <SecondaryButton
            label={actionLabel}
            onPress={onAction}
            icon="refresh"
            style={styles.action}
          />
        ) : (
          <PrimaryButton label={actionLabel} onPress={onAction} size="md" style={styles.action} />
        )
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxxl,
    paddingHorizontal: spacing.xl,
  },
  compact: { paddingVertical: spacing.lg },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { marginTop: spacing.md },
  message: { marginTop: 4, maxWidth: 280 },
  action: { marginTop: spacing.lg, minWidth: 180 },
});
