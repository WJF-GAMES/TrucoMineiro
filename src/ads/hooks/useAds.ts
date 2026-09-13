import { useEffect } from 'react';
import { AdService } from '../core/AdService';
import { useAdStore } from '../core/AdState';
import { AdPlacementManager } from '../core/AdPlacementManager';
import type { AdPlacement, RewardedPlacement } from '../types/ads.types';

/** Estado geral de anúncios para a UI (kill switch, consentimento, ambiente). */
export function useAds() {
  const adsEnabled = useAdStore((s) => s.adsEnabled);
  const canRequestAds = useAdStore((s) => s.canRequestAds);
  const initialized = useAdStore((s) => s.initialized);
  const usingTestAds = useAdStore((s) => s.usingTestAds);

  return {
    initialized,
    usingTestAds,
    canShowAds: adsEnabled && canRequestAds,
    isPlacementEnabled: (placement: AdPlacement) => AdPlacementManager.isEnabled(placement),
  };
}

/**
 * Marca a partida como ativa enquanto a tela estiver montada.
 * Com isso nenhum full-screen pode aparecer durante o jogo — nem vindo do App Open ao voltar
 * do background, nem por qualquer outro caminho.
 */
export function useGameSessionGuard(active = true) {
  useEffect(() => {
    if (!active) return;
    const store = useAdStore.getState();
    store.setGameActive(true);
    return () => {
      useAdStore.getState().setGameActive(false);
    };
  }, [active]);
}

/** Mesma proteção para a fila de matchmaking. */
export function useMatchmakingGuard(active = true) {
  useEffect(() => {
    if (!active) return;
    const store = useAdStore.getState();
    store.setMatchmakingActive(true);
    return () => {
      useAdStore.getState().setMatchmakingActive(false);
    };
  }, [active]);
}

/**
 * Pré-carrega um rewarded bem antes de ele ser oferecido. A análise da partida, por exemplo,
 * é carregada no começo do jogo: quando o resultado aparecer, o anúncio já está pronto e o
 * usuário nunca espera por ele.
 */
export function usePreloadRewarded(placement: RewardedPlacement) {
  useEffect(() => {
    AdService.preloadRewarded(placement);
  }, [placement]);
}

/** Pré-carrega o interstitial bem antes do fim da partida. */
export function usePreloadInterstitial() {
  useEffect(() => {
    if (!AdService.canShowAds()) return;
    AdService.preloadAds();
  }, []);
}
