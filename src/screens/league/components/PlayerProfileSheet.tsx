import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, icons, spacing, type IoniconName } from '@/design-system';
import { AppText, PrimaryButton, Sheet } from '@/components';
import { PlayerProfileSummary, type PlayerSummaryData } from '@/components/PlayerProfileSummary';
import { getProfile } from '@/services/firebase/firestore';
import { FunctionsError, sendFriendRequest } from '@/services/firebase/functions';
import { logEvent } from '@/services/firebase/analytics';
import { useAuthStore } from '@/stores/authStore';
import { toast } from '@/stores/toastStore';
import { useFriendRequests, useFriends } from '@/features/friends/useFriends';

/** O que a linha do ranking já sabe do jogador: a ficha abre com isso e completa depois. */
export type RankingPlayer = Pick<PlayerSummaryData, 'id' | 'nickname' | 'avatarId' | 'countryCode'>;

type Relation = 'me' | 'friend' | 'blocked' | 'sent' | 'received' | 'none';

const RELATION_NOTE: Partial<Record<Relation, { icon: IoniconName; text: string }>> = {
  me: { icon: icons.profile, text: 'Este é você.' },
  friend: { icon: icons.people, text: 'Vocês já são amigos.' },
  blocked: { icon: icons.ban, text: 'Você bloqueou este jogador.' },
  sent: { icon: icons.clock, text: 'Pedido de amizade enviado. Aguardando resposta.' },
};

/**
 * Ficha de um jogador do ranking — o mesmo cartão da ficha do amigo (quem é, liga e números),
 * com a ação que faz sentido para a relação: adicionar, aceitar o pedido que ele mandou, ou só
 * informar (já amigos, pedido enviado, bloqueado, você mesmo).
 *
 * Só é montada quando alguém é escolhido: as assinaturas de amizade não rodam à toa na Liga.
 */
export function PlayerProfileSheet({
  player,
  onClose,
}: {
  player: RankingPlayer;
  onClose: () => void;
}) {
  const myUid = useAuthStore((s) => s.user?.uid);
  const { friendIdSet, blockedIds, loading: friendsLoading } = useFriends(myUid);
  const { incoming, pendingToUids, loading: requestsLoading } = useFriendRequests(myUid);
  const [full, setFull] = useState<PlayerSummaryData | null>(null);
  const [busy, setBusy] = useState(false);
  const [sentNow, setSentNow] = useState(false);

  useEffect(() => {
    let active = true;
    getProfile(player.id)
      .then((p) => {
        if (active && p) setFull(p);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [player.id]);

  const relation: Relation =
    player.id === myUid
      ? 'me'
      : friendIdSet.has(player.id)
        ? 'friend'
        : blockedIds.includes(player.id)
          ? 'blocked'
          : incoming.some((r) => r.from === player.id)
            ? 'received'
            : sentNow || pendingToUids.has(player.id)
              ? 'sent'
              : 'none';
  const ready = relation === 'me' || (!friendsLoading && !requestsLoading);

  const add = async () => {
    setBusy(true);
    try {
      // Com um pedido dele pendente, o backend cruza os dois e a amizade sai na hora.
      await sendFriendRequest(player.id);
      if (relation === 'received') {
        logEvent('friend_request_accepted');
        toast.success('Agora vocês são amigos!', player.nickname);
      } else {
        logEvent('friend_request_sent');
        setSentNow(true);
        toast.success('Solicitação enviada', `${player.nickname} vai receber seu convite.`);
      }
    } catch (e) {
      toast.error('Não foi possível enviar', e instanceof FunctionsError ? e.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  const note = RELATION_NOTE[relation];
  return (
    <Sheet
      visible
      onClose={onClose}
      title={player.nickname}
      subtitle="Jogador da liga"
      testID="sheet-player"
    >
      <PlayerProfileSummary player={full ?? player} />

      {!ready ? null : note ? (
        <View style={styles.note} testID={`player-relation-${relation}`}>
          <Ionicons name={note.icon} size={18} color={colors.textSecondary} />
          <AppText variant="small" color={colors.textSecondary} style={styles.noteText}>
            {note.text}
          </AppText>
        </View>
      ) : (
        <PrimaryButton
          label={relation === 'received' ? 'Aceitar pedido de amizade' : 'Adicionar amigo'}
          icon={relation === 'received' ? icons.check : icons.personAdd}
          size="md"
          loading={busy}
          onPress={() => void add()}
          style={styles.action}
          testID="player-sheet-add"
        />
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  action: { marginTop: spacing.lg },
  note: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.lg, gap: 8 },
  noteText: { flex: 1 },
});
