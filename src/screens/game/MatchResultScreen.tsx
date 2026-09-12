import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, { FadeInDown, ZoomIn } from 'react-native-reanimated';
import { colors, spacing } from '@/design-system';
import { images } from '@/assets';
import { AppText, PrimaryButton, Screen, SecondaryButton, Surface } from '@/components';
import { logEvent } from '@/services/firebase/analytics';
import { haptic } from '@/utils/haptics';
import type { RootScreenProps } from '@/navigation/types';

export function MatchResultScreen({ navigation, route }: RootScreenProps<'MatchResult'>) {
  const {
    won,
    scores,
    mode,
    xpGained,
    coinsGained,
    leaguePointsDelta,
    leveledUp,
    rematch,
    difficulty,
  } = route.params;

  useEffect(() => {
    if (won) haptic.success();
    else haptic.error();
  }, [won]);

  const again = () => {
    logEvent('rematch_clicked', { mode });
    if (rematch?.mode === 'ai')
      navigation.replace('Game', {
        mode: 'ai',
        difficulty: rematch.difficulty,
        seed: Date.now() % 2147483647,
      });
    else navigation.replace('Matchmaking');
  };

  return (
    <Screen testID="screen-result" contentStyle={{ justifyContent: 'center' }}>
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
              label="Moedas"
              value={coinsGained !== undefined ? `+${coinsGained}` : '—'}
              image={images.coin}
            />
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

      <PrimaryButton
        label="Jogar novamente"
        onPress={again}
        style={{ marginTop: spacing.xl }}
        testID="result-rematch"
      />
      <SecondaryButton
        label="Voltar ao início"
        onPress={() => navigation.replace('Main', { screen: 'Home' })}
        style={{ marginTop: spacing.sm }}
        testID="result-home"
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
});
