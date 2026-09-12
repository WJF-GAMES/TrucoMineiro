import React, { useState } from 'react';
import { Alert, StyleSheet } from 'react-native';
import { spacing } from '@/design-system';
import { GameHeader, MenuGroup, MenuItem, Screen } from '@/components';
import { useSettingsStore } from '@/stores/settingsStore';
import { deleteAccount, FunctionsError } from '@/services/firebase/functions';
import { signOut } from '@/services/firebase/auth';
import { toast } from '@/stores/toastStore';
import type { RootScreenProps } from '@/navigation/types';

const THEME_LABEL = { auto: 'Automático', dark: 'Escuro', light: 'Claro' } as const;

export function SettingsScreen({ navigation }: RootScreenProps<'Settings'>) {
  const settings = useSettingsStore();
  const [deleting, setDeleting] = useState(false);

  const cycleTheme = () => {
    const order: (typeof settings.theme)[] = ['auto', 'dark', 'light'];
    const next = order[(order.indexOf(settings.theme) + 1) % order.length]!;
    settings.set({ theme: next });
    toast.info(`Tema: ${THEME_LABEL[next]}`, 'O Truco Mineiro usa a identidade escura oficial.');
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
        <MenuItem
          icon="language"
          title="Idioma"
          value="Português (BR)"
          onPress={() =>
            toast.info('Idioma', 'Por enquanto o Truco Mineiro fala só português mesmo, uai.')
          }
        />
        <MenuItem
          icon="contrast"
          title="Tema"
          value={THEME_LABEL[settings.theme]}
          onPress={cycleTheme}
        />
      </MenuGroup>

      <MenuGroup style={styles.group}>
        <MenuItem
          icon="shield-half"
          title="Privacidade e Segurança"
          onPress={() => navigation.navigate('StaticPage', { kind: 'privacy_security' })}
        />
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
