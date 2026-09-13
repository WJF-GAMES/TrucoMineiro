import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, spacing } from '@/design-system';
import { AppText, SecondaryButton, Surface } from '@/components';
import { useRewardedAd } from '../hooks/useRewardedAd';
import { nextTip, type TrucoTip } from '../content/trucoTips';
import { SponsoredBadge } from './SponsoredBadge';
import { RewardedGate } from './RewardedGate';

/**
 * "Dica de Truco" da Principal — a porta de entrada opcional do Rewarded.
 *
 * O usuário escolhe assistir; em troca recebe conteúdo (estratégia), nunca vantagem no jogo.
 * Se o placement estiver desligado ou o anúncio não carregar, o card simplesmente não aparece.
 */
export function SponsoredContentCard() {
  const rewarded = useRewardedAd('home_tip_rewarded', 'ver_dica');
  const [gateOpen, setGateOpen] = useState(false);
  const [tip, setTip] = useState<TrucoTip | null>(null);

  useEffect(() => {
    if (rewarded.ready) rewarded.offerShown();
    // `offerShown` é estável por placement; só interessa disparar quando o anúncio fica pronto.
  }, [rewarded.ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const confirm = useCallback(async () => {
    const earned = await rewarded.watch();
    setGateOpen(false);
    // Conteúdo liberado exclusivamente no callback de recompensa do SDK.
    if (earned) setTip((current) => nextTip(current?.id ?? null));
  }, [rewarded]);

  if (!rewarded.ready) return null;

  return (
    <>
      <Surface style={styles.card} testID="home-tip-rewarded">
        <View style={styles.header}>
          <View style={styles.titleRow}>
            <Ionicons name="bulb" size={18} color={colors.gold} />
            <AppText variant="h3" style={styles.title}>
              Dica de Truco
            </AppText>
          </View>
          <SponsoredBadge label="Conteúdo patrocinado" />
        </View>

        {tip ? (
          <>
            <AppText variant="bodyBold" style={styles.tipTitle}>
              {tip.title}
            </AppText>
            <AppText variant="small" color={colors.textSecondary} style={styles.tipBody}>
              {tip.body}
            </AppText>
            <SecondaryButton
              label="Ver outra dica"
              size="sm"
              icon="play"
              onPress={() => setGateOpen(true)}
              loading={rewarded.watching}
              style={styles.action}
              testID="home-tip-again"
            />
          </>
        ) : (
          <>
            <AppText variant="small" color={colors.textSecondary} style={styles.tipBody}>
              Veja uma jogada inteligente em poucos segundos.
            </AppText>
            <SecondaryButton
              label="Assistir"
              size="sm"
              icon="play"
              onPress={() => setGateOpen(true)}
              loading={rewarded.watching}
              style={styles.action}
              testID="home-tip-watch"
            />
          </>
        )}
      </Surface>

      <RewardedGate
        visible={gateOpen}
        title="Dica de Truco"
        description="Assista a um anúncio para liberar uma dica de estratégia. A dica é só conteúdo: ela não muda XP, pontos de liga nem nada dentro da partida."
        confirmLabel="Assistir"
        loading={rewarded.watching}
        onCancel={() => setGateOpen(false)}
        onConfirm={confirm}
        testID="home-tip-gate"
      />
    </>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: spacing.lg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { marginLeft: 2 },
  tipTitle: { marginTop: spacing.md },
  tipBody: { marginTop: spacing.sm },
  action: { alignSelf: 'flex-start', marginTop: spacing.md },
});
