import React from 'react';
import { StyleSheet } from 'react-native';
import { spacing } from '@/design-system';
import { GameHeader, MenuGroup, MenuItem, Screen, StateView } from '@/components';
import { useSettingsStore } from '@/stores/settingsStore';

export function NotificationsScreen() {
  const settings = useSettingsStore();
  return (
    <Screen scroll testID="screen-notifications">
      <GameHeader variant="title" title="Notificações" showBack />
      <MenuGroup style={styles.group}>
        <MenuItem
          icon="notifications"
          title="Receber notificações"
          subtitle="Convites, recompensas, liga e novidades"
          toggle={settings.notifications}
          onToggle={(v) => settings.set({ notifications: v })}
        />
      </MenuGroup>
      <StateView
        kind="empty"
        icon="notifications-off"
        title="Nenhuma notificação"
        message="Convites de amigos, salas e recompensas aparecem aqui."
        compact
      />
    </Screen>
  );
}

const styles = StyleSheet.create({ group: { marginBottom: spacing.md } });
