import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, spacing } from '@/design-system';
import { AppText, PrimaryButton, SecondaryButton, Sheet } from '@/components';
import type { ContactsPermission } from '@/services/contacts';
import type { SyncErrorKind, SyncProgress } from '@/features/friends/useContactsSync';
import { ContactsPrivacyNote } from './ContactsCards';

interface Props {
  visible: boolean;
  onClose: () => void;
  permission: ContactsPermission;
  syncing: boolean;
  progress: SyncProgress;
  error: SyncErrorKind | null;
  /** Quantos contatos da agenda já jogam — só existe depois de uma sincronização. */
  matchCount: number | null;
  onSync: () => void;
  onOpenSettings: () => void;
}

const PROGRESS_LABEL: Record<SyncProgress['phase'], string> = {
  idle: 'Preparando...',
  permission: 'Pedindo acesso à agenda...',
  reading: 'Lendo seus contatos...',
  matching: 'Procurando sua turma...',
  done: 'Pronto!',
  error: 'Não deu certo',
};

const ERROR_MESSAGE: Record<SyncErrorKind, string> = {
  permission: 'Sem acesso à agenda não dá para procurar sua turma. Você pode tentar de novo.',
  read: 'Não conseguimos ler os contatos do aparelho. Tente de novo em instantes.',
  offline: 'Sem conexão com o servidor. Verifique sua internet e tente de novo.',
  rate_limit: 'Você já sincronizou muitos contatos hoje. Tente de novo amanhã.',
  app_check: 'Não foi possível validar o app neste aparelho. Tente de novo mais tarde.',
  unknown: 'Algo deu errado por aqui. Tente de novo.',
};

/**
 * Diálogo de sincronização da agenda.
 *
 * É aqui que o fluxo inteiro acontece — benefício, permissão, progresso e erro — em vez de
 * espalhar cards pela lista. A permissão do sistema só é pedida depois deste diálogo explicar
 * o motivo (regra 14), e o diálogo só abre quando o usuário toca em "Sincronizar contatos".
 */
export function ContactsSyncSheet({
  visible,
  onClose,
  permission,
  syncing,
  progress,
  error,
  matchCount,
  onSync,
  onOpenSettings,
}: Props) {
  // Terminou bem: fecha sozinho e devolve o usuário para a lista, que já mostra o resultado.
  useEffect(() => {
    if (!visible || syncing || error) return;
    if (progress.phase !== 'done') return;
    const t = setTimeout(onClose, 900);
    return () => clearTimeout(t);
  }, [visible, syncing, error, progress.phase, onClose]);

  const blocked = permission === 'blocked' || permission === 'restricted';
  const done = !syncing && !error && progress.phase === 'done';

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={
        syncing
          ? PROGRESS_LABEL[progress.phase]
          : done
            ? 'Prontinho!'
            : blocked
              ? 'Acesso aos contatos desativado'
              : error
                ? 'Não foi possível sincronizar'
                : 'Encontre sua turma'
      }
      subtitle={
        syncing
          ? 'Isso fica só no seu aparelho.'
          : done
            ? matchCount
              ? `${matchCount} ${matchCount === 1 ? 'pessoa' : 'pessoas'} da sua agenda ${
                  matchCount === 1 ? 'já joga' : 'já jogam'
                } Truco Mineiro.`
              : 'Ninguém da sua agenda joga ainda — que tal convidar?'
            : blocked
              ? permission === 'restricted'
                ? 'O acesso aos contatos está restrito neste aparelho.'
                : 'Você pode liberar nas configurações do aparelho.'
              : error
                ? ERROR_MESSAGE[error]
                : 'Descubra quem da sua agenda já joga Truco Mineiro.'
      }
      testID="sheet-contacts-sync"
    >
      {syncing ? (
        <View style={styles.track}>
          <View
            style={[
              styles.fill,
              { width: `${Math.round((progress.ratio ?? 0.15) * 100)}%` },
              progress.ratio === null && styles.fillIndeterminate,
            ]}
          />
        </View>
      ) : done ? (
        <View style={styles.doneRow}>
          <Ionicons name="checkmark-circle" size={44} color={colors.primaryBright} />
        </View>
      ) : (
        <>
          {!error && !blocked ? <Benefits /> : null}
          {blocked ? (
            <SecondaryButton
              label="Abrir configurações"
              icon="settings"
              onPress={onOpenSettings}
              style={styles.cta}
              testID="contacts-open-settings"
            />
          ) : (
            <PrimaryButton
              label={error ? 'Tentar de novo' : 'Sincronizar contatos'}
              icon={error ? 'refresh' : 'sync'}
              size="md"
              onPress={onSync}
              style={styles.cta}
              testID="contacts-sync"
            />
          )}
        </>
      )}
      <ContactsPrivacyNote style={styles.privacy} />
    </Sheet>
  );
}

/** O "porquê" antes do diálogo do sistema: o usuário decide sabendo o que ganha e o que sai daqui. */
function Benefits() {
  return (
    <View style={styles.benefits}>
      {[
        { icon: 'people' as const, text: 'Veja quem da sua agenda já joga e adicione num toque.' },
        { icon: 'phone-portrait' as const, text: 'Nomes e fotos da agenda não saem do aparelho.' },
        { icon: 'lock-closed' as const, text: 'Enviamos só os números, e nunca guardamos nenhum.' },
      ].map((b) => (
        <View key={b.icon} style={styles.benefitRow}>
          <View style={styles.benefitIcon}>
            <Ionicons name={b.icon} size={16} color={colors.primaryBright} />
          </View>
          <AppText variant="small" color={colors.textSecondary} style={styles.benefitText}>
            {b.text}
          </AppText>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  benefits: { gap: spacing.md },
  benefitRow: { flexDirection: 'row', alignItems: 'center' },
  benefitIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(4, 21, 23, 0.6)',
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  benefitText: { flex: 1, marginLeft: 10, lineHeight: 17 },
  cta: { marginTop: spacing.xl },
  privacy: { marginTop: spacing.lg },
  doneRow: { alignItems: 'center', paddingVertical: spacing.md },
  track: {
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(4, 21, 23, 0.6)',
    marginTop: spacing.sm,
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: 3, backgroundColor: colors.primary },
  fillIndeterminate: { width: '35%', opacity: 0.7 },
});
