import React from 'react';
import { Alert, StyleSheet } from 'react-native';
import { spacing } from '@/design-system';
import { DangerButton, PrimaryButton, SecondaryButton, Sheet } from '@/components';
import { PlayerProfileSummary } from '@/components/PlayerProfileSummary';
import type { PresenceState } from '@/domain/model/types';
import type { FriendEntry } from '@/features/friends/useFriends';

const STATUS_TEXT: Record<PresenceState, string> = {
  online: 'Online agora',
  in_match: 'Jogando uma partida',
  offline: 'Offline',
};

interface Props {
  /** `null` fecha a folha; o amigo vem inteiro para a folha não depender da lista. */
  entry: FriendEntry | null;
  busy: boolean;
  onClose: () => void;
  onPlay: (uid: string) => void;
  onRemove: (uid: string, nickname: string) => void;
  onBlock: (uid: string, nickname: string) => void;
}

/**
 * Ficha do amigo: quem é, como vai na liga e o que dá para fazer com ele.
 *
 * Substitui o menu de sistema que só tinha "remover/bloquear": as duas ações destrutivas
 * continuam aqui, mas agora embaixo do que interessa primeiro — jogar junto. O cartão de cima
 * (`PlayerProfileSummary`) é o mesmo da ficha de jogador da Liga.
 */
export function FriendSheet({ entry, busy, onClose, onPlay, onRemove, onBlock }: Props) {
  if (!entry) return null;
  const { profile, presence } = entry;
  const state = presence?.state ?? 'offline';

  const confirm = (title: string, message: string, actionLabel: string, run: () => void) =>
    Alert.alert(title, message, [
      { text: 'Cancelar', style: 'cancel' },
      { text: actionLabel, style: 'destructive', onPress: run },
    ]);

  return (
    <Sheet
      visible
      onClose={onClose}
      title={profile.nickname}
      subtitle={STATUS_TEXT[state]}
      testID="sheet-friend"
    >
      <PlayerProfileSummary player={profile} status={state} />

      {state !== 'offline' ? (
        <PrimaryButton
          label="Jogar juntos"
          icon="play"
          size="md"
          loading={busy}
          onPress={() => onPlay(profile.id)}
          style={styles.action}
          testID="friend-sheet-play"
        />
      ) : null}
      <SecondaryButton
        label="Remover amizade"
        icon="person-remove"
        onPress={() =>
          confirm(
            'Remover amizade',
            `${profile.nickname} sai da sua lista de amigos. Vocês podem se adicionar de novo depois.`,
            'Remover',
            () => onRemove(profile.id, profile.nickname),
          )
        }
        style={styles.action}
        testID="friend-sheet-remove"
      />
      <DangerButton
        label="Bloquear jogador"
        icon="ban"
        onPress={() =>
          confirm(
            'Bloquear jogador',
            `${profile.nickname} deixa de ver você no app e vocês não podem mais se convidar.`,
            'Bloquear',
            () => onBlock(profile.id, profile.nickname),
          )
        }
        style={styles.action}
        testID="friend-sheet-block"
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  action: { marginTop: spacing.md },
});
