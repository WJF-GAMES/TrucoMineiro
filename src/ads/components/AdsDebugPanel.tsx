import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, spacing } from '@/design-system';
import { AppText, SecondaryButton, Sheet } from '@/components';
import { AdService } from '../core/AdService';
import { useAdStore } from '../core/AdState';
import { ConsentManager } from '../privacy/ConsentManager';

/**
 * Painel de diagnóstico dos anúncios. **Só existe em desenvolvimento** — em release o
 * componente devolve `null` e o bundler descarta o conteúdo.
 */
export function AdsDebugPanel({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  // Reagir ao store mantém o painel vivo enquanto o estado muda por baixo; o tick cobre o que
  // não passa pelo store (cooldown correndo, anúncio que terminou de carregar).
  const frequency = useAdStore((s) => s.frequency);
  const [, tick] = useState(0);

  useEffect(() => {
    if (!visible) return;
    const timer = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [visible]);

  if (!__DEV__) return null;

  // Leitura direta no render: o painel é só um espelho do estado do serviço.
  void frequency;
  const state = AdService.getDebugState();

  const decision = state.nextInterstitial;

  return (
    <Sheet visible={visible} onClose={onClose} title="Anúncios (debug)" testID="ads-debug">
      <Row label="Environment" value={state.environment} />
      <Row label="Mode" value={state.mode} />
      <Row label="Initialized" value={state.initialized ? 'sim' : 'não'} />
      <Row
        label="Consent"
        value={`${state.consentStatus} (canRequestAds=${state.canRequestAds})`}
      />
      <Row label="Ads enabled" value={state.adsEnabled ? 'sim' : 'não (kill switch)'} />

      <Section title="Carregamento" />
      <Row label="Interstitial" value={state.interstitialLoaded ? 'Loaded' : 'Not loaded'} />
      <Row
        label="Rewarded análise"
        value={state.rewardedAnalysisLoaded ? 'Loaded' : 'Not loaded'}
      />
      <Row label="Rewarded dica" value={state.rewardedTipLoaded ? 'Loaded' : 'Not loaded'} />
      <Row
        label="App Open"
        value={state.appOpenEnabled ? (state.appOpenLoaded ? 'Loaded' : 'Not loaded') : 'Disabled'}
      />

      <Section title="Frequência" />
      <Row label="Sessão" value={`#${state.sessionNumber}`} />
      <Row label="Session ads" value={state.sessionAds} />
      <Row label="Daily ads" value={state.dailyAds} />
      <Row label="Matches since ad" value={state.matchesSinceAd} />
      <Row label="Matches (total)" value={`${state.matchesCompleted}`} />
      <Row
        label="Próximo interstitial"
        value={decision.show ? 'Liberado' : `Bloqueado: ${decision.reason}`}
      />

      <Section title="Guardas" />
      <Row label="Partida ativa" value={state.isGameActive ? 'sim' : 'não'} />
      <Row label="Matchmaking ativo" value={state.isMatchmakingActive ? 'sim' : 'não'} />
      <Row label="Full-screen na tela" value={state.isFullScreenAdShowing ? 'sim' : 'não'} />

      <SecondaryButton
        label="Atualizar consentimento"
        size="sm"
        onPress={() => void ConsentManager.refreshConsentInfo()}
        style={styles.action}
      />
      <SecondaryButton
        label="Recarregar anúncios"
        size="sm"
        onPress={() => AdService.preloadAds()}
        style={styles.action}
      />
    </Sheet>
  );
}

function Section({ title }: { title: string }) {
  return (
    <AppText variant="smallBold" color={colors.primaryBright} style={styles.section}>
      {title}
    </AppText>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <AppText variant="small" color={colors.textSecondary}>
        {label}
      </AppText>
      <AppText variant="smallBold" style={styles.value} numberOfLines={1}>
        {value}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3,
    gap: spacing.md,
  },
  value: { flexShrink: 1, textAlign: 'right' },
  section: { marginTop: spacing.lg, marginBottom: spacing.xs },
  action: { marginTop: spacing.md },
});
