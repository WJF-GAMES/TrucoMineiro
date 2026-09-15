import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, { FadeInDown, ZoomIn } from 'react-native-reanimated';
import { colors, icons, spacing } from '@/design-system';
import { AppText, PrimaryButton, Screen, SecondaryButton, Surface } from '@/components';
import { logEvent } from '@/services/firebase/analytics';
import { haptic } from '@/utils/haptics';
import { AdService, RewardedGate, SponsoredBadge, useRewardedAd } from '@/ads';
import type { RootScreenProps } from '@/navigation/types';
import { MatchAnalysisCard } from './MatchAnalysisCard';

/**
 * Pausa entre o resultado aparecer e o interstitial. O usuário precisa ver o placar e as
 * recompensas antes de qualquer anúncio — e o anúncio tem de acontecer *antes* de ele iniciar
 * uma ação, nunca depois de tocar em "Jogar novamente".
 */
const INTERSTITIAL_DELAY_MS = 2600;

export function MatchResultScreen({ navigation, route }: RootScreenProps<'MatchResult'>) {
  const {
    won,
    scores,
    mode,
    xpGained,
    leaguePointsDelta,
    leveledUp,
    rematch,
    difficulty,
    analysis,
  } = route.params;

  const [analysisUnlocked, setAnalysisUnlocked] = useState(false);
  const [gateOpen, setGateOpen] = useState(false);
  const rewarded = useRewardedAd('match_analysis_rewarded', 'ver_analise');
  /** Uma ação do usuário (rematch, voltar, rewarded) cancela o interstitial pendente. */
  const userActed = useRef(false);

  useEffect(() => {
    if (won) haptic.success();
    else haptic.error();
  }, [won]);

  // Interstitial do fim de partida: momento natural, depois de o resultado ser lido.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (userActed.current) return;
      void AdService.showInterstitial('match_result_interstitial');
    }, INTERSTITIAL_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);

  const leaveFor = useCallback((run: () => void) => {
    userActed.current = true;
    run();
  }, []);

  const again = () =>
    leaveFor(() => {
      logEvent('rematch_clicked', { mode });
      if (rematch?.mode === 'ai')
        navigation.replace('Game', {
          mode: 'ai',
          difficulty: rematch.difficulty,
          seed: Date.now() % 2147483647,
        });
      else navigation.replace('Matchmaking');
    });

  const openGate = () => {
    userActed.current = true;
    rewarded.offerShown();
    setGateOpen(true);
  };

  const watchAnalysis = useCallback(async () => {
    const earned = await rewarded.watch();
    setGateOpen(false);
    // A análise só é liberada quando o SDK confirma a recompensa; fechar antes mantém bloqueado.
    if (earned) setAnalysisUnlocked(true);
  }, [rewarded]);

  const canOfferAnalysis = Boolean(analysis) && rewarded.ready && !analysisUnlocked;

  return (
    <Screen scroll testID="screen-result" contentStyle={styles.content}>
      <Animated.View entering={ZoomIn.duration(400)} style={styles.hero}>
        <View
          style={[
            styles.iconCircle,
            { borderColor: won ? colors.primaryBright : colors.dangerSoft },
          ]}
        >
          <Ionicons
            name={won ? 'trophy' : 'sad'}
            size={56}
            color={won ? colors.gold : colors.dangerSoft}
          />
        </View>
        <AppText variant="display" center style={{ marginTop: spacing.lg }}>
          {won ? 'Vitória!' : 'Derrota'}
        </AppText>
        <AppText variant="body" center color={colors.textSecondary}>
          {won ? 'Truco é gente de verdade. Mandou bem!' : 'Bola pra frente. A próxima é nossa.'}
        </AppText>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(200)}>
        <Surface style={styles.score}>
          <View style={styles.scoreSide}>
            <AppText variant="caption" color={colors.textSecondary}>
              NÓS
            </AppText>
            <AppText variant="display" color={colors.primaryBright}>
              {scores[0]}
            </AppText>
          </View>
          <AppText variant="h2" color={colors.textSecondary}>
            x
          </AppText>
          <View style={styles.scoreSide}>
            <AppText variant="caption" color={colors.textSecondary}>
              ELES
            </AppText>
            <AppText variant="display" color={colors.dangerSoft}>
              {scores[1]}
            </AppText>
          </View>
        </Surface>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(350)}>
        <Surface style={styles.rewards}>
          <AppText variant="h3" style={{ marginBottom: 8 }}>
            Recompensas{' '}
            {mode === 'ai' && difficulty
              ? `(${difficulty === 'easy' ? 'Fácil' : difficulty === 'normal' ? 'Normal' : 'Difícil'})`
              : ''}
          </AppText>
          <View style={styles.rewardRow}>
            <RewardItem label="XP" value={xpGained !== undefined ? `+${xpGained}` : '—'} />
            <RewardItem
              label="Liga"
              value={
                leaguePointsDelta !== undefined
                  ? `${leaguePointsDelta >= 0 ? '+' : ''}${leaguePointsDelta}`
                  : '—'
              }
            />
          </View>
          {leveledUp ? (
            <AppText variant="smallBold" color={colors.gold} center style={{ marginTop: 8 }}>
              Você subiu de nível!
            </AppText>
          ) : null}
        </Surface>
      </Animated.View>

      {analysisUnlocked && analysis ? <MatchAnalysisCard analysis={analysis} /> : null}

      {canOfferAnalysis ? (
        <Surface style={styles.analysisOffer} testID="result-analysis-offer">
          <View style={styles.analysisHeader}>
            <View style={styles.analysisTitle}>
              <Ionicons name={icons.stats} size={18} color={colors.primaryBright} />
              <AppText variant="h3" style={styles.analysisTitleText}>
                Análise da partida
              </AppText>
            </View>
            <SponsoredBadge label="Conteúdo patrocinado" />
          </View>
          <AppText variant="small" color={colors.textSecondary} style={styles.analysisBody}>
            Veja rodada a rodada como a partida foi decidida: trucos, fugas e onde os pontos
            escaparam.
          </AppText>
          <SecondaryButton
            label="Ver análise completa"
            size="sm"
            icon="play"
            onPress={openGate}
            loading={rewarded.watching}
            style={styles.analysisAction}
            testID="result-analysis-watch"
          />
        </Surface>
      ) : null}

      <PrimaryButton
        label="Jogar novamente"
        onPress={again}
        style={{ marginTop: spacing.xl }}
        testID="result-rematch"
      />
      <SecondaryButton
        label="Voltar ao início"
        onPress={() => leaveFor(() => navigation.replace('Main', { screen: 'Home' }))}
        style={{ marginTop: spacing.sm }}
        testID="result-home"
      />

      <RewardedGate
        visible={gateOpen}
        title="Análise completa"
        description="Assista a um anúncio para liberar a análise completa desta partida. É só conteúdo: nada de XP, pontos de liga ou vantagem no jogo."
        confirmLabel="Assistir"
        loading={rewarded.watching}
        onCancel={() => setGateOpen(false)}
        onConfirm={watchAnalysis}
        testID="result-analysis-gate"
      />
    </Screen>
  );
}

function RewardItem({ label, value, image }: { label: string; value: string; image?: number }) {
  return (
    <View style={styles.reward}>
      {image ? (
        <Image
          source={image}
          style={{ width: 22, height: 22, marginBottom: 2 }}
          contentFit="contain"
        />
      ) : null}
      <AppText variant="h2" color={colors.primaryBright}>
        {value}
      </AppText>
      <AppText variant="caption" color={colors.textSecondary}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { justifyContent: 'center', flexGrow: 1 },
  hero: { alignItems: 'center', marginBottom: spacing.xl },
  iconCircle: {
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: colors.card,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  score: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-evenly' },
  scoreSide: { alignItems: 'center', minWidth: 90 },
  rewards: { marginTop: spacing.md },
  rewardRow: { flexDirection: 'row', justifyContent: 'space-around' },
  reward: { alignItems: 'center' },
  analysisOffer: { marginTop: spacing.md },
  analysisHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  analysisTitle: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  analysisTitleText: { marginLeft: 2 },
  analysisBody: { marginTop: spacing.sm },
  analysisAction: { alignSelf: 'flex-start', marginTop: spacing.md },
});
