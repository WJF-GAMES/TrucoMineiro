import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, gradients, radius, spacing } from '@/design-system';
import { images, leagueShield } from '@/assets';
import {
  AppText,
  GameHeader,
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
import { claimReward, FunctionsError } from '@/services/firebase/functions';
import { flag } from '@/services/firebase/remoteConfig';
import { toast } from '@/stores/toastStore';
import { formatNumber, pct } from '@/utils/format';
import { subscribeOnlineCount } from '@/services/firebase/rtdb';
import { LEAGUE_NAMES } from '@/domain/model/leagues';
import type { TabScreenProps } from '@/navigation/types';

function todayId() {
  return `daily_${new Date().toISOString().slice(0, 10)}`;
}

/**
 * Principal (Home). No reference exists for this screen in referencia.png, so it is composed
 * exclusively from patterns of the other screens: logo header, glass cards, green CTA, season banner.
 */
export function HomeScreen({ navigation }: TabScreenProps<'Home'>) {
  const profile = useProfileStore((s) => s.profile);
  const stats = useProfileStore((s) => s.stats);
  const loading = useProfileStore((s) => s.loading);
  const error = useProfileStore((s) => s.error);
  const [online, setOnline] = useState(0);
  const [claiming, setClaiming] = useState(false);
  const [claimed, setClaimed] = useState(false);

  useEffect(() => {
    logEvent('home_viewed');
    return subscribeOnlineCount(setOnline);
  }, []);

  const claim = async () => {
    setClaiming(true);
    try {
      const r = await claimReward(todayId());
      setClaimed(true);
      if (r.alreadyClaimed) toast.info('Recompensa já resgatada hoje');
      else {
        toast.success(`+${r.coins} moedas!`, 'Volte amanhã para mais.');
        logEvent('reward_claimed', { coins: r.coins });
      }
    } catch (e) {
      toast.error('Não deu certo', e instanceof FunctionsError ? e.message : undefined);
    } finally {
      setClaiming(false);
    }
  };

  return (
    <Screen scroll testID="screen-home">
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
        <Pressable
          testID="home-play-ai"
          accessibilityRole="button"
          accessibilityLabel="Jogar contra a IA"
          onPress={() => {
            logEvent('play_clicked', { source: 'home', mode: 'ai' });
            navigation.navigate('AiSetup');
          }}
          style={({ pressed }) => [styles.mode, pressed && styles.pressed]}
        >
          <LinearGradient colors={gradients.modeIa} style={StyleSheet.absoluteFill} />
          <Image
            source={images.modeIa}
            style={styles.modeImage}
            contentFit="cover"
            contentPosition="top"
          />
          <LinearGradient colors={['rgba(2,63,128,0)', '#023f80']} style={styles.modeFade} />
          <View style={styles.modeText}>
            <AppText variant="h3" style={styles.modeTitle}>
              CONTRA A IA
            </AppText>
            <AppText variant="caption" color={colors.textSecondary}>
              3 níveis de dificuldade
            </AppText>
          </View>
        </Pressable>
        <Pressable
          testID="home-play-online"
          accessibilityRole="button"
          accessibilityLabel="Jogar online"
          onPress={() => {
            logEvent('play_clicked', { source: 'home', mode: 'online' });
            navigation.navigate('OnlineHub');
          }}
          style={({ pressed }) => [styles.mode, pressed && styles.pressed]}
        >
          <LinearGradient colors={gradients.modeOnline} style={StyleSheet.absoluteFill} />
          <Image
            source={images.modeOnline}
            style={styles.modeImage}
            contentFit="cover"
            contentPosition="top"
          />
          <LinearGradient colors={['rgba(107,47,15,0)', '#6b2f0f']} style={styles.modeFade} />
          <View style={styles.modeText}>
            <AppText variant="h3" style={styles.modeTitle}>
              ONLINE
            </AppText>
            <AppText variant="caption" color={colors.textSecondary}>
              {online > 0 ? `${formatNumber(online)} online` : 'Jogadores reais'}
            </AppText>
          </View>
        </Pressable>
      </View>

      {flag('daily_reward_enabled') ? (
        <Surface style={styles.reward} strong>
          <Image source={images.coinsMedium} style={styles.rewardImage} contentFit="contain" />
          <View style={{ flex: 1 }}>
            <AppText variant="h3">Recompensa diária</AppText>
            <AppText variant="small" color={colors.textSecondary}>
              Resgate suas moedas de hoje.
            </AppText>
          </View>
          <PillButton
            label={claimed ? 'Resgatado' : claiming ? '...' : 'Resgatar'}
            variant={claimed ? 'muted' : 'gold'}
            onPress={claim}
            disabled={claimed || claiming}
            testID="home-claim"
          />
        </Surface>
      ) : null}

      <SectionTitle
        title="Sua liga"
        actionLabel="Ver liga"
        onAction={() => navigation.navigate('League')}
      />
      <Pressable accessibilityRole="button" onPress={() => navigation.navigate('League')}>
        <Surface style={styles.league}>
          <Image
            source={leagueShield[profile?.leagueId ?? 'bronze']}
            style={styles.shield}
            contentFit="contain"
          />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <AppText variant="h3">Liga {LEAGUE_NAMES[profile?.leagueId ?? 'bronze']}</AppText>
            <AppText variant="small" color={colors.textSecondary}>
              {formatNumber(profile?.leaguePoints ?? 0)} pontos • {stats?.matches ?? 0} partidas •{' '}
              {pct(stats?.wins ?? 0, stats?.matches ?? 0)}% vitórias
            </AppText>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
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

      <SectionTitle
        title="Chame a turma"
        actionLabel="Amigos"
        onAction={() => navigation.navigate('Friends')}
      />
      <Surface style={styles.friends}>
        <Image source={images.bannerAmigos} style={styles.friendsImage} contentFit="cover" />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <AppText variant="bodyBold">Jogue com seus amigos</AppText>
          <AppText variant="small" color={colors.textSecondary}>
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
  mode: {
    flex: 1,
    height: 172,
    borderRadius: radius.card,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  modeImage: { width: '100%', height: '75%' },
  modeFade: { position: 'absolute', left: 0, right: 0, top: '40%', bottom: 0 },
  modeText: { position: 'absolute', left: 10, right: 10, bottom: 10 },
  modeTitle: {
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowRadius: 4,
    textShadowOffset: { width: 0, height: 1 },
  },
  pressed: { opacity: 0.85 },
  reward: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.md },
  rewardImage: { width: 56, height: 40, marginRight: 10 },
  league: { flexDirection: 'row', alignItems: 'center' },
  shield: { width: 46, height: 54 },
  bannerWrap: {
    marginTop: spacing.md,
    borderRadius: radius.card,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.cardBorderStrong,
  },
  banner: { width: '100%', aspectRatio: 831 / 273 },
  friends: { flexDirection: 'row', alignItems: 'center', padding: 10 },
  friendsImage: { width: 64, height: 48, borderRadius: radius.sm },
});
