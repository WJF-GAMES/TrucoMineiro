import React, { useState } from 'react';
import { Alert, StyleSheet } from 'react-native';
import { spacing } from '@/design-system';
import { GameHeader, MenuGroup, MenuItem, Screen } from '@/components';
import { useSettingsStore } from '@/stores/settingsStore';
import { useAuthStore } from '@/stores/authStore';
import { clearContactsSync } from '@/features/friends/contactsCache';
import { openAppSettings } from '@/services/contacts';
import { deleteAccount, FunctionsError } from '@/services/firebase/functions';
import { signOut } from '@/services/firebase/auth';
import { toast } from '@/stores/toastStore';
import { ConsentManager, useAdStore } from '@/ads';
import type { RootScreenProps } from '@/navigation/types';

export function SettingsScreen({ navigation }: RootScreenProps<'Settings'>) {
  const settings = useSettingsStore();
  const uid = useAuthStore((s) => s.user?.uid);
  const [deleting, setDeleting] = useState(false);
  const adPrivacyRequired = useAdStore((s) => s.privacyOptionsRequired);

  /**
   * O app não revoga permissão do sistema — isso é do SO. O que ele controla é o cache local
   * da última sincronização, e é isso que este item apaga.
   */
  const confirmForgetContacts = () => {
    Alert.alert(
      'Sincronização de contatos',
      'Isso apaga do aparelho o resultado da última sincronização. Sua agenda nunca foi enviada ' +
        'nem guardada nos nossos servidores. Para revogar o acesso aos contatos, use as ' +
        'configurações do sistema.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Abrir configurações',
          onPress: () => void openAppSettings(),
        },
        {
          text: 'Apagar',
          style: 'destructive',
          onPress: async () => {
            if (uid) await clearContactsSync(uid);
            toast.info('Sincronização apagada', 'Você pode sincronizar de novo quando quiser.');
          },
        },
      ],
    );
  };

  const confirmDelete = () => {
    Alert.alert(
      'Excluir conta',
      'Isso apaga seu perfil, estatísticas e progresso. Essa ação não pode ser desfeita.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Excluir',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            try {
              await deleteAccount();
              await signOut();
            } catch (e) {
              toast.error(
                'Não foi possível excluir',
                e instanceof FunctionsError ? e.message : undefined,
              );
              setDeleting(false);
            }
          },
        },
      ],
    );
  };

  return (
    <Screen scroll testID="screen-settings">
      <GameHeader variant="title" title="Configurações" showBack />
      <MenuGroup style={styles.group}>
        <MenuItem
          icon="volume-high"
          title="Som"
          toggle={settings.sound}
          onToggle={(v) => settings.set({ sound: v })}
          testID="settings-sound"
        />
        <MenuItem
          icon="musical-notes"
          title="Música"
          toggle={settings.music}
          onToggle={(v) => settings.set({ music: v })}
        />
        <MenuItem
          icon="phone-portrait"
          title="Vibração"
          toggle={settings.vibration}
          onToggle={(v) => settings.set({ vibration: v })}
        />
        <MenuItem
          icon="notifications"
          title="Notificações"
          onPress={() => navigation.navigate('Notifications')}
        />
        {/* Sem ação: o app fala só português. Um item clicável que abre um aviso dizendo
            "não dá" é um controle que promete o que não cumpre (regra 18). */}
        <MenuItem icon="language" title="Idioma" value="Português (BR)" />
      </MenuGroup>

      <MenuGroup style={styles.group}>
        <MenuItem
          icon="people"
          title="Sincronização de contatos"
          subtitle="Apagar o resultado guardado neste aparelho"
          onPress={confirmForgetContacts}
          testID="settings-contacts"
        />
        <MenuItem
          icon="shield-half"
          title="Privacidade e Segurança"
          onPress={() => navigation.navigate('StaticPage', { kind: 'privacy_security' })}
        />
        {/* Exigência do UMP: quem precisou dar consentimento tem de conseguir revê-lo a qualquer
            momento. O item só aparece quando o próprio SDK diz que é necessário. */}
        {adPrivacyRequired ? (
          <MenuItem
            icon="megaphone"
            title="Privacidade de anúncios"
            subtitle="Revisar suas escolhas de consentimento"
            onPress={() => void ConsentManager.showPrivacyOptions()}
            testID="settings-ad-privacy"
          />
        ) : null}
        <MenuItem
          icon="help-circle"
          title="Ajuda e Suporte"
          onPress={() => navigation.navigate('StaticPage', { kind: 'help' })}
        />
        <MenuItem
          icon="document-text"
          title="Termos de Uso"
          onPress={() => navigation.navigate('StaticPage', { kind: 'terms' })}
        />
        <MenuItem
          icon="trash"
          title={deleting ? 'Excluindo...' : 'Excluir Conta'}
          danger
          onPress={deleting ? undefined : confirmDelete}
          testID="settings-delete"
        />
      </MenuGroup>
    </Screen>
  );
}

const styles = StyleSheet.create({ group: { marginBottom: spacing.md } });
