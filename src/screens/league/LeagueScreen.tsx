import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { colors, radius, spacing } from '@/design-system';
import { images, leagueShield } from '@/assets';
import {
  AppText,
  GameHeader,
  IconButton,
  MenuGroup,
  MenuItem,
  ProgressBar,
  Screen,
  StateView,
  StatsRow,
  Surface,
} from '@/components';
import { useProfileStore } from '@/stores/profileStore';
import { subscribeCurrentSeason } from '@/services/firebase/firestore';
import type { Season } from '@/domain/model/types';
import { LEAGUE_NAMES, leagueById } from '@/domain/model/leagues';
import { daysUntil, formatNumber, pct } from '@/utils/format';
import { toast } from '@/stores/toastStore';
import type { TabScreenProps } from '@/navigation/types';

export function LeagueScreen({ navigation }: TabScreenProps<'League'>) {
  const profile = useProfileStore((s) => s.profile);
  const stats = useProfileStore((s) => s.stats);
  const loading = useProfileStore((s) => s.loading);
  const [season, setSeason] = useState<Season | null>(null);
  useEffect(() => subscribeCurrentSeason(setSeason), []);

  const league = leagueById(profile?.leagueId ?? 'bronze');
  const next = league.nextLeagueId ? leagueById(league.nextLeagueId) : null;
  const points = profile?.leaguePoints ?? 0;
  const max = league.maxPoints ?? points;

  return (
    <Screen scroll testID="screen-league">
      <GameHeader variant="logo" />
      <AppText variant="h1" center style={styles.title}>
        Sua Liga
      </AppText>

      {loading && !profile ? (
        <StateView kind="loading" compact />
      ) : (
        <>
          <View style={styles.leagueRow}>
            <Surface style={styles.leagueCard}>
              <View style={styles.leagueTop}>
                <Image
                  source={leagueShield[league.id]}
                  style={styles.shieldBig}
                  contentFit="contain"
                />
                <IconButton
                  icon="information-circle-outline"
                  boxed={false}
                  size={26}
                  color={colors.textSecondary}
                  accessibilityLabel="Como funciona a liga"
                  onPress={() =>
                    toast.info(
                      'Como funciona',
                      `Some ${league.maxPoints ?? ''} pontos para subir para a próxima liga.`,
                    )
                  }
                />
              </View>
              <AppText variant="h2" style={styles.leagueName}>
                Liga {LEAGUE_NAMES[league.id]}
              </AppText>
              <View style={styles.progressRow}>
                <ProgressBar
                  value={points - league.minPoints}
                  max={max - league.minPoints}
                  height={10}
                  style={{ flex: 1 }}
                />
                <AppText variant="caption" color={colors.textSecondary} style={{ marginLeft: 8 }}>
                  {formatNumber(points)} / {league.maxPoints ? formatNumber(league.maxPoints) : '∞'}{' '}
                  pontos
                </AppText>
              </View>
            </Surface>
            <Surface style={styles.nextCard}>
              <AppText variant="small" color={colors.textSecondary}>
                Próxima Liga
              </AppText>
              <AppText variant="h3">{next ? LEAGUE_NAMES[next.id] : 'Topo'}</AppText>
              <Image
                source={next ? leagueShield[next.id] : leagueShield.diamante}
                style={styles.shieldSmall}
                contentFit="contain"
              />
            </Surface>
          </View>

          <View style={styles.stats}>
            <StatsRow
              stats={[
                { value: String(stats?.matches ?? 0), label: 'Partidas' },
                { value: String(stats?.wins ?? 0), label: 'Vitórias' },
                { value: String(stats?.losses ?? 0), label: 'Derrotas', color: colors.dangerSoft },
                {
                  value: `${pct(stats?.wins ?? 0, stats?.matches ?? 0)}%`,
                  label: 'Aproveitamento',
                },
              ]}
            />
          </View>

          <MenuGroup>
            <MenuItem
              icon="trophy"
              iconColor={colors.gold}
              title="Ranking Global"
              onPress={() => navigation.navigate('Ranking')}
              testID="league-ranking"
            />
            <MenuItem
              icon="gift"
              iconColor={colors.dangerSoft}
              title="Recompensas da Liga"
              onPress={() =>
                toast.info(
                  'Recompensas',
                  `Ao fechar a temporada na ${LEAGUE_NAMES[league.id]} você ganha ${league.rewardCoins} moedas.`,
                )
              }
            />
            <MenuItem
              icon="time"
              iconColor={colors.cream}
              title="Temporada Atual"
              subtitle={
                season ? `Termina em ${daysUntil(season.endsAt)} dias` : 'Carregando temporada...'
              }
              onPress={() => toast.info(season?.name ?? 'Temporada', season?.subtitle)}
            />
          </MenuGroup>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={season?.name ?? 'Temporada Minas Gerais'}
            onPress={() =>
              toast.info(
                season?.name ?? 'Temporada Minas Gerais',
                season?.subtitle ?? 'Mostre que o Truco Mineiro é forte!',
              )
            }
            style={styles.bannerWrap}
          >
            <Image source={images.bannerTemporada} style={styles.banner} contentFit="cover" />
          </Pressable>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { marginBottom: spacing.md },
  leagueRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  leagueCard: { flex: 1.7 },
  leagueTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  shieldBig: { width: 98, height: 114, marginTop: -38, marginLeft: 2 },
  leagueName: { marginTop: 8, fontSize: 24 },
  progressRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  nextCard: { flex: 1, alignItems: 'flex-start', justifyContent: 'center', paddingVertical: 18 },
  shieldSmall: { width: 62, height: 62, alignSelf: 'center', marginTop: 14 },
  stats: { marginTop: spacing.md, marginBottom: spacing.md },
  bannerWrap: {
    borderRadius: radius.card,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.cardBorderStrong,
  },
  banner: { width: '100%', aspectRatio: 831 / 273 },
});
