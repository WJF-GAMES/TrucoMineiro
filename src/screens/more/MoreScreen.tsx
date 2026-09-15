import React, { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { colors, spacing } from '@/design-system';
import { DangerButton, GameHeader, MenuCard, MenuGroup, MenuItem, Screen } from '@/components';
import { signOut } from '@/services/firebase/auth';
import { toast } from '@/stores/toastStore';
import { AdsDebugPanel } from '@/ads';
import { APP_VERSION } from '@/utils/appVersion';
import type { TabScreenProps } from '@/navigation/types';

export function MoreScreen({ navigation }: TabScreenProps<'More'>) {
  const [leaving, setLeaving] = useState(false);
  const [adsDebugOpen, setAdsDebugOpen] = useState(false);

  const logout = () => {
    Alert.alert('Sair da conta', 'Você precisará informar seu telefone novamente para entrar.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Sair',
        style: 'destructive',
        onPress: async () => {
          setLeaving(true);
          try {
            await signOut();
          } catch {
            toast.error('Não foi possível sair');
            setLeaving(false);
          }
        },
      },
    ]);
  };

  return (
    <Screen scroll withTabBar testID="screen-more">
      <GameHeader variant="title" title="Mais" />
      <View style={styles.group}>
        <MenuCard
          icon="person"
          title="Perfil"
          subtitle="Seus dados e estatísticas"
          onPress={() => navigation.navigate('Profile')}
          testID="more-profile"
        />
        <MenuCard
          icon="settings"
          title="Configurações"
          subtitle="Som, notificações e mais"
          onPress={() => navigation.navigate('Settings')}
          testID="more-settings"
        />
      </View>

      <MenuGroup style={styles.group2}>
        <MenuItem
          icon="help-circle"
          title="Ajuda e Suporte"
          subtitle="Dúvidas? Fale com a gente"
          onPress={() => navigation.navigate('StaticPage', { kind: 'help' })}
        />
        <MenuItem
          icon="document-text"
          title="Termos de Uso"
          onPress={() => navigation.navigate('StaticPage', { kind: 'terms' })}
        />
        <MenuItem
          icon="shield-half"
          title="Política de Privacidade"
          onPress={() => navigation.navigate('StaticPage', { kind: 'privacy' })}
        />
        <MenuItem
          icon="information-circle"
          title="Sobre o Truco Mineiro"
          subtitle={`Versão ${APP_VERSION}`}
          onPress={() => navigation.navigate('StaticPage', { kind: 'about' })}
        />
      </MenuGroup>

      {/* Diagnóstico de anúncios: existe apenas em desenvolvimento. */}
      {__DEV__ ? (
        <MenuGroup style={styles.group2}>
          <MenuItem
            icon="megaphone"
            title="Anúncios (debug)"
            subtitle="Estado, frequência e consentimento"
            onPress={() => setAdsDebugOpen(true)}
            testID="more-ads-debug"
          />
        </MenuGroup>
      ) : null}

      <DangerButton label="Sair da conta" onPress={logout} loading={leaving} testID="more-logout" />
      <AdsDebugPanel visible={adsDebugOpen} onClose={() => setAdsDebugOpen(false)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  group: { marginBottom: spacing.md },
  group2: { marginBottom: spacing.lg, borderColor: colors.cardBorder },
});
