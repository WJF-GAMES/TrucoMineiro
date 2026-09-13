import { useCallback, useEffect, useRef, useState } from 'react';
import { AdAnalytics } from '../analytics/AdAnalytics';
import { AdService } from '../core/AdService';
import { AdPlacementManager } from '../core/AdPlacementManager';
import { useAdStore } from '../core/AdState';
import type { RewardedPlacement } from '../types/ads.types';

/**
 * Rewarded opt-in.
 *
 * O hook nunca inicia um anúncio sozinho: `watch()` só deve ser chamado a partir de um toque
 * explícito do usuário ("ASSISTIR"). O retorno é `true` apenas quando o SDK confirmou a
 * recompensa — fechar antes do fim mantém o conteúdo bloqueado.
 */
export function useRewardedAd(placement: RewardedPlacement, cta = 'default') {
  const loaded = useAdStore((s) => s.rewardedLoaded[placement]);
  const canRequestAds = useAdStore((s) => s.canRequestAds);
  const adsEnabled = useAdStore((s) => s.adsEnabled);
  const [watching, setWatching] = useState(false);
  const mounted = useRef(true);

  const enabled = AdPlacementManager.isEnabled(placement) && adsEnabled && canRequestAds;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    AdService.preloadRewarded(placement);
  }, [enabled, placement]);

  const watch = useCallback(async (): Promise<boolean> => {
    if (!enabled || watching) return false;
    AdAnalytics.offerAccepted(placement, cta);
    setWatching(true);
    try {
      const result = await AdService.showRewarded(placement);
      return result.earned;
    } finally {
      if (mounted.current) setWatching(false);
    }
  }, [cta, enabled, placement, watching]);

  const offerShown = useCallback(() => AdAnalytics.offerShown(placement, cta), [cta, placement]);

  return {
    /** O card/CTA só deve aparecer quando o placement está ligado. */
    available: enabled,
    /** Pronto para exibir agora (sem espera para o usuário). */
    ready: enabled && loaded,
    watching,
    watch,
    offerShown,
  };
}
