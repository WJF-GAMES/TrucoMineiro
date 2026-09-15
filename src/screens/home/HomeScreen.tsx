import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, gradients, icons, radius, spacing } from '@/design-system';
import { images, leagueShield } from '@/assets';
import {
  AppText,
  GameHeader,
  GameModeCard,
  PillButton,
  PlayerAvatar,
  ProgressBar,
  Screen,
  SectionTitle,
  StateView,
  Surface,
} from '@/components';
import { useProfileStore } from '@/stores/profileStore';
import { logEvent } from '@/services/firebase/analytics';
import { formatNumber, pct } from '@/utils/format';
import { subscribeOnlineCount } from '@/services/firebase/rtdb';
import { leagueById } from '@/domain/model/leagues';
import { NativeAdCard, SponsoredContentCard, usePreloadInterstitial } from '@/ads';
import type { TabScreenProps } from '@/navigation/types';

/**
 * Principal (Home). No reference exists for this screen in referencia.png, so it is composed
 * exclusively from patterns of the other screens: logo header, glass cards, green CTA, season banner.
 */
/** Altura dos cards de modo na Principal (a tela Jogar usa o padrão, maior). */
const MODE_CARD_HEIGHT = 250;

export function HomeScreen({ navigation }: TabScreenProps<'Home'>) {
  const profile = useProfileStore((s) => s.profile);
  const stats = useProfileStore((s) => s.stats);
  const loading = useProfileStore((s) => s.loading);
  const error = useProfileStore((s) => s.error);
  const [online, setOnline] = useState(0);

  useEffect(() => {
    logEvent('home_viewed');
    return subscribeOnlineCount(setOnline);
  }, []);

  // O interstitial do fim de partida é carregado aqui, muito antes de ser necessário.
  usePreloadInterstitial();

  return (
    <Screen scroll withTabBar testID="screen-home">
      <GameHeader variant="logo" />

      {loading && !profile ? (
        <StateView kind="loading" compact />
      ) : error && !profile ? (
        <StateView kind="error" message={error} compact />
      ) : (
        <Surface style={styles.welcome}>
          <View style={styles.welcomeRow}>
            <PlayerAvatar avatarId={profile?.avatarId} size={64} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <AppText variant="small" color={colors.textSecondary}>
                Bem-vindo de volta,
              </AppText>
              <AppText variant="h2" numberOfLines={1}>
                {profile?.nickname ?? 'Trucador'}
              </AppText>
              <View style={styles.levelRow}>
                <AppText variant="smallBold" color={colors.primaryBright}>
                  Nível {profile?.level ?? 1}
                </AppText>
                <AppText variant="caption" color={colors.textSecondary}>
                  {formatNumber(profile?.xp ?? 0)} / {formatNumber(profile?.xpToNext ?? 300)} XP
                </AppText>
              </View>
              <ProgressBar
                value={profile?.xp ?? 0}
                max={profile?.xpToNext ?? 300}
                height={8}
                style={{ marginTop: 4 }}
              />
            </View>
          </View>
        </Surface>
      )}

      <AppText variant="h2" center style={styles.sectionTitle}>
        Bora jogar?
      </AppText>
      <View style={styles.modes}>
        <GameModeCard
          testID="home-play-ai"
          title={'JOGAR\nCONTRA A IA'}
          subtitle="Treine, evolua e melhore suas habilidades."
          image={images.modeIa}
          gradient={gradients.modeIa}
          fadeColor="#023f80"
          footerIcon="bar-chart"
          footer="3 níveis de dificuldade"
          height={MODE_CARD_HEIGHT}
          onPress={() => {
            logEvent('play_clicked', { source: 'home', mode: 'ai' });
            navigation.navigate('AiSetup');
          }}
        />
        <GameModeCard
          testID="home-play-online"
          title={'JOGAR\nONLINE'}
          subtitle="Enfrente jogadores reais de todo o Brasil."
          image={images.modeOnline}
          gradient={gradients.modeOnline}
          fadeColor="#6b2f0f"
          footerIcon="people"
          footer={online > 0 ? `${formatNumber(online)} online` : 'Jogadores reais'}
          height={MODE_CARD_HEIGHT}
          onPress={() => {
            logEvent('play_clicked', { source: 'home', mode: 'online' });
            navigation.navigate('OnlineHub');
          }}
        />
      </View>

      {/* Único Native Ad da Principal, entre os modos de jogo e a liga — longe dos CTAs de jogar
          e da Bottom Navigation, para não haver clique acidental. */}
      <NativeAdCard placement="home_native_primary" />

      <SectionTitle
        title="Sua liga"
        actionLabel="Ver liga"
        onAction={() => navigation.navigate('League')}
      />
      <Pressable accessibilityRole="button" onPress={() => navigation.navigate('League')}>
        <Surface style={styles.league}>
          <Image
            source={leagueShield(profile?.leagueId)}
            style={styles.shield}
            contentFit="contain"
          />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <AppText variant="h3">Liga {leagueById(profile?.leagueId).displayName}</AppText>
            <AppText variant="small" color={colors.textSecondary}>
              {formatNumber(profile?.leaguePoints ?? 0)} pontos • {stats?.matches ?? 0} partidas •{' '}
              {pct(stats?.wins ?? 0, stats?.matches ?? 0)}% vitórias
            </AppText>
          </View>
          <Ionicons name={icons.chevronRight} size={20} color={colors.textSecondary} />
        </Surface>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Temporada Minas Gerais"
        onPress={() => navigation.navigate('League')}
        style={styles.bannerWrap}
      >
        <Image source={images.bannerTemporada} style={styles.banner} contentFit="cover" />
      </Pressable>

      {/* Rewarded opcional: conteúdo (dica de estratégia), nunca vantagem dentro da partida. */}
      <SponsoredContentCard />

      <SectionTitle
        title="Chame a turma"
        actionLabel="Amigos"
        onAction={() => navigation.navigate('Friends')}
      />
      <Surface style={styles.friends}>
        <Image source={images.bannerAmigos} style={styles.friendsImage} contentFit="cover" />
        <View style={styles.friendsText}>
          <AppText variant="bodyBold">Jogue com seus amigos</AppText>
          <AppText variant="small" color={colors.textSecondary} style={styles.friendsSubtitle}>
            Crie uma sala e compartilhe o código.
          </AppText>
        </View>
        <PillButton label="Criar sala" onPress={() => navigation.navigate('OnlineHub')} />
      </Surface>
    </Screen>
  );
}

const styles = StyleSheet.create({
  welcome: { marginBottom: spacing.sm },
  welcomeRow: { flexDirection: 'row', alignItems: 'center' },
  levelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 2,
  },
  sectionTitle: { marginTop: spacing.md, marginBottom: spacing.md },
  modes: { flexDirection: 'row', gap: 10 },
  pressed: { opacity: 0.85 },
  league: { flexDirection: 'row', alignItems: 'center' },
  shield: { width: 46, height: 54 },
  bannerWrap: {
    marginTop: spacing.md,
    borderRadius: radius.card,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.cardBorderStrong,
  },
  banner: { width: '100%', aspectRatio: 2172 / 724 },
  friends: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    gap: spacing.sm + 2,
  },
  friendsImage: { width: 52, height: 52, borderRadius: radius.sm },
  friendsText: { flex: 1 },
  friendsSubtitle: { marginTop: 2 },
});
