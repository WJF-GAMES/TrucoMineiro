import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, icons, spacing } from '@/design-system';
import { AppText, PlayerAvatar, Sheet, StateView } from '@/components';
import { useFriends } from '@/features/friends/useFriends';

const STATUS: Record<string, string> = {
  online: 'Online',
  in_match: 'Em partida agora',
  offline: 'Offline — recebe o convite por notificação',
};

/**
 * Escolher um amigo para uma vaga da sala (trocar quem recusou ou preencher uma vaga livre).
 * Online primeiro: aumenta a chance de a mesa fechar rápido.
 */
export function FriendPickerSheet({
  visible,
  uid,
  exclude,
  onClose,
  onPick,
}: {
  visible: boolean;
  uid: string | undefined;
  /** Quem já está na sala ou convidado. */
  exclude: string[];
  onClose: () => void;
  onPick: (friendUid: string) => void;
}) {
  const { friends, loading } = useFriends(visible ? uid : undefined);
  const available = friends.filter((f) => !exclude.includes(f.profile.id));
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Convidar amigo"
      subtitle="Ele recebe o convite e a vaga fica guardada."
      testID="friend-picker"
    >
      {loading ? (
        <StateView kind="loading" compact />
      ) : available.length === 0 ? (
        <StateView
          kind="empty"
          icon="people"
          title="Ninguém disponível"
          message="Todos os seus amigos já estão na sala ou convidados."
          compact
        />
      ) : (
        available.map(({ profile, presence }) => {
          const state = presence?.state ?? 'offline';
          return (
            <Pressable
              key={profile.id}
              accessibilityRole="button"
              accessibilityLabel={`Convidar ${profile.nickname}, ${STATUS[state]}`}
              onPress={() => onPick(profile.id)}
              style={styles.row}
              testID={`friend-pick-${profile.id}`}
            >
              <PlayerAvatar avatarId={profile.avatarId} size={42} status={state} />
              <View style={styles.texts}>
                <AppText variant="bodyBold" numberOfLines={1}>
                  {profile.nickname}
                </AppText>
                <AppText variant="caption" color={colors.textSecondary} numberOfLines={1}>
                  {STATUS[state]}
                </AppText>
              </View>
              <Ionicons name={icons.personAdd} size={20} color={colors.primaryBright} />
            </Pressable>
          );
        })
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  texts: { flex: 1, marginLeft: spacing.md },
});
