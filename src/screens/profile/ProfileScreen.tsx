import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, icons, spacing } from '@/design-system';
import { leagueShield } from '@/assets';
import {
  AppText,
  GameHeader,
  IconButton,
  MenuGroup,
  MenuItem,
  PlayerAvatar,
  ProgressBar,
  Screen,
  StateView,
  StatsRow,
  Surface,
} from '@/components';
import { useProfileStore } from '@/stores/profileStore';
import { useAuthStore } from '@/stores/authStore';
import { getAchievements, subscribeUserAchievements } from '@/services/api';
import { leagueById } from '@/domain/model/leagues';
import { formatNumber, pct } from '@/utils/format';
import { traced } from '@/services/firebase/perf';
import { NativeAdCard } from '@/ads';
import type { RootScreenProps } from '@/navigation/types';

export function ProfileScreen({ navigation }: RootScreenProps<'Profile'>) {
  const profile = useProfileStore((s) => s.profile);
  const stats = useProfileStore((s) => s.stats);
  const loading = useProfileStore((s) => s.loading);
  const uid = useAuthStore((s) => s.user?.uid);
  const [achievements, setAchievements] = useState<{ total: number; unlocked: number } | null>(
    null,
  );
  const [detailsOpen, setDetailsOpen] = useState(false);

  useEffect(() => {
    if (!uid) return;
    let total = 0;
    traced('profile_load', () => getAchievements())
      .then((a) => {
        total = a.length;
        setAchievements((prev) => ({ total, unlocked: prev?.unlocked ?? 0 }));
      })
      .catch(() => undefined);
    return subscribeUserAchievements(uid, (ua) =>
      setAchievements((prev) => ({
        total: prev?.total ?? total,
        unlocked: Object.keys(ua?.unlocked ?? {}).length,
      })),
    );
  }, [uid]);

  if (loading && !profile) {
    return (
      <Screen>
        <GameHeader variant="title" title="Perfil" showBack />
        <StateView kind="loading" />
      </Screen>
    );
  }

  return (
    <Screen scroll testID="screen-profile">
      <GameHeader variant="title" title="Perfil" showBack />
      <View style={styles.top}>
        <PlayerAvatar avatarId={profile?.avatarId} size={112} badge="check" />
        <View style={styles.identity}>
          <View style={styles.nameRow}>
            <AppText variant="h1" numberOfLines={1} style={{ flex: 1 }}>
              {profile?.nickname ?? 'Trucador'}
            </AppText>
            <IconButton
              icon="pencil"
              accessibilityLabel="Editar perfil"
              onPress={() => navigation.navigate('EditProfile')}
              size={18}
              style={styles.editBtn}
            />
          </View>
          <AppText variant="bodyBold" color={colors.primaryBright}>
            Nível {profile?.level ?? 1}
          </AppText>
          <View style={styles.xpRow}>
            <ProgressBar
              value={profile?.xp ?? 0}
              max={profile?.xpToNext ?? 300}
              height={10}
              style={{ flex: 1 }}
            />
            <AppText variant="caption" color={colors.textSecondary} style={{ marginLeft: 8 }}>
              {formatNumber(profile?.xp ?? 0)} / {formatNumber(profile?.xpToNext ?? 300)} XP
            </AppText>
          </View>
        </View>
      </View>

      <Surface style={styles.league}>
        <Image
          source={leagueShield(profile?.leagueId)}
          style={styles.shield}
          contentFit="contain"
        />
        <View style={{ marginLeft: 12 }}>
          <AppText variant="h2">Liga {leagueById(profile?.leagueId).displayName}</AppText>
          <AppText variant="small" color={colors.textSecondary}>
            {formatNumber(profile?.leaguePoints ?? 0)} pontos
          </AppText>
        </View>
      </Surface>

      <View style={styles.stats}>
        <StatsRow
          stats={[
            { value: String(stats?.matches ?? 0), label: 'Partidas' },
            { value: String(stats?.wins ?? 0), label: 'Vitórias' },
            { value: String(stats?.losses ?? 0), label: 'Derrotas', color: colors.dangerSoft },
            { value: `${pct(stats?.wins ?? 0, stats?.matches ?? 0)}%`, label: 'Aproveitamento' },
          ]}
        />
      </View>

      {/* Os números de truco ficavam escondidos num toast: três dados espremidos numa faixa que
          some sozinha em segundos e não pode ser relida. Aqui eles são conteúdo da tela, abertos
          por um toque, e o número fica na mesma leitura visual dos de cima (regras 70 e 87). */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Estatísticas detalhadas"
        accessibilityState={{ expanded: detailsOpen }}
        onPress={() => setDetailsOpen((v) => !v)}
        style={styles.detailsToggle}
        testID="profile-details-toggle"
      >
        <AppText variant="h3" style={styles.detailsTitle}>
          Estatísticas detalhadas
        </AppText>
        <Ionicons
          name={detailsOpen ? icons.chevronUp : icons.chevronDown}
          size={20}
          color={colors.textSecondary}
        />
      </Pressable>
      {detailsOpen ? (
        <View style={styles.details} testID="profile-details">
          <StatsRow
            stats={[
              { value: String(stats?.trucosCalled ?? 0), label: 'Trucos pedidos' },
              { value: String(stats?.trucosAccepted ?? 0), label: 'Trucos aceitos' },
              { value: String(stats?.bestStreak ?? 0), label: 'Melhor sequência' },
            ]}
          />
          <StatsRow
            stats={[
              { value: String(stats?.onlineMatches ?? 0), label: 'Online' },
              { value: String(stats?.aiMatches ?? 0), label: 'Contra a IA' },
              { value: String(stats?.hardWins ?? 0), label: 'Vitórias no difícil' },
            ]}
          />
        </View>
      ) : null}

      <MenuGroup>
        <MenuItem
          icon="trophy"
          iconColor={colors.gold}
          title="Minhas Conquistas"
          value={achievements ? `${achievements.unlocked} de ${achievements.total}` : undefined}
          onPress={() => navigation.navigate('Achievements')}
          testID="profile-achievements"
        />
        <MenuItem
          icon="time"
          title="Histórico de Partidas"
          onPress={() => navigation.navigate('MatchHistory')}
        />
        <MenuItem
          icon="person"
          title="Editar Perfil"
          onPress={() => navigation.navigate('EditProfile')}
        />
      </MenuGroup>

      {/* Placement preparado, porém desligado no lançamento (`native_profile_enabled = false`):
          enquanto a flag for falsa este componente não renderiza nem requisita nada. */}
      <NativeAdCard placement="profile_native" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md },
  identity: { flex: 1, marginLeft: 14 },
  nameRow: { flexDirection: 'row', alignItems: 'center' },
  editBtn: { width: 36, height: 36, borderRadius: 10, marginLeft: 8 },
  xpRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  league: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
  },
  shield: { width: 46, height: 54 },
  stats: { marginTop: spacing.md },
  detailsToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 48,
    marginTop: spacing.sm,
  },
  detailsTitle: { fontSize: 15.5 },
  details: { gap: spacing.sm, marginBottom: spacing.sm },
});
