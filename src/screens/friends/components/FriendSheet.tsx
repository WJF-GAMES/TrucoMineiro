import React, { useEffect, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { colors, radius, spacing } from '@/design-system';
import { leagueShield } from '@/assets';
import {
  AppText,
  CountryFlag,
  DangerButton,
  PlayerAvatar,
  PrimaryButton,
  SecondaryButton,
  Sheet,
  StatsRow,
} from '@/components';
import { subscribeStats } from '@/services/firebase/firestore';
import { leagueById } from '@/domain/model/leagues';
import { formatNumber, pct } from '@/utils/format';
import type { PlayerStats, PresenceState } from '@/domain/model/types';
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
 * continuam aqui, mas agora embaixo do que interessa primeiro — jogar junto. Os números vêm
 * de `playerStats/{uid}`, que é público para quem está logado (ver firestore.rules).
 */
export function FriendSheet({ entry, busy, onClose, onPlay, onRemove, onBlock }: Props) {
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const uid = entry?.profile.id;

  // Cada amigo tem os seus números: abrir outro limpa o anterior durante a renderização.
  const [prevUid, setPrevUid] = useState(uid);
  if (uid !== prevUid) {
    setPrevUid(uid);
    setStats(null);
  }

  useEffect(() => {
    if (!uid) return;
    return subscribeStats(uid, setStats);
  }, [uid]);

  if (!entry) return null;
  const { profile, presence } = entry;
  const state = presence?.state ?? 'offline';
  const league = leagueById(profile.leagueId);

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
      <View style={styles.identity}>
        <PlayerAvatar avatarId={profile.avatarId} size={72} status={state} />
        <View style={styles.identityTexts}>
          <View style={styles.nameRow}>
            <AppText variant="h3" numberOfLines={1} style={styles.nick}>
              @{profile.nickname}
            </AppText>
            <CountryFlag code={profile.countryCode} width={22} />
          </View>
          <AppText variant="small" color={colors.primaryBright}>
            Nível {profile.level}
          </AppText>
        </View>
      </View>

      <View style={styles.league}>
        <Image source={leagueShield(profile.leagueId)} style={styles.shield} contentFit="contain" />
        <View style={styles.leagueTexts}>
          <AppText variant="bodyBold">Liga {league.displayName}</AppText>
          <AppText variant="small" color={colors.textSecondary}>
            {formatNumber(profile.leaguePoints ?? 0)} pontos
          </AppText>
        </View>
      </View>

      <View style={styles.stats}>
        <StatsRow
          stats={[
            { value: String(stats?.matches ?? 0), label: 'Partidas' },
            { value: String(stats?.wins ?? 0), label: 'Vitórias' },
            { value: `${pct(stats?.wins ?? 0, stats?.matches ?? 0)}%`, label: 'Aproveitamento' },
          ]}
        />
      </View>

      <PrimaryButton
        label={state === 'online' ? 'Jogar juntos' : 'Convidar para jogar'}
        icon="play"
        size="md"
        loading={busy}
        onPress={() => onPlay(profile.id)}
        style={styles.action}
        testID="friend-sheet-play"
      />
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
  identity: { flexDirection: 'row', alignItems: 'center' },
  identityTexts: { flex: 1, marginLeft: 14 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  nick: { flexShrink: 1, fontSize: 16 },
  league: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.lg,
    padding: 10,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  shield: { width: 38, height: 38 },
  leagueTexts: { marginLeft: 12, flex: 1 },
  stats: { marginTop: spacing.md },
  action: { marginTop: spacing.md },
});
