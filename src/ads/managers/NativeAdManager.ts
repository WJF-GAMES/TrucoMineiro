import {
  NativeAd,
  NativeAdChoicesPlacement,
  NativeMediaAspectRatio,
} from 'react-native-google-mobile-ads';
import { AdAnalytics } from '../analytics/AdAnalytics';
import { adUnitFor } from '../config/adUnits';
import { getAdConfig } from '../config/adConfig';
import { useAdStore } from '../core/AdState';
import { BACKOFF_STEPS_MS } from '../core/backoff';
import { adLog } from '../log';
import type { NativePlacement } from '../types/ads.types';

/**
 * Native Ads.
 *
 * Cada card de tela carrega o seu próprio anúncio e o destrói ao sair — o manager só centraliza
 * a requisição, o backoff e a regra de "este placement está ligado?". Se o anúncio não carregar,
 * quem chama simplesmente não renderiza nada (nunca um espaço vazio ou um loading eterno).
 */

function nativeEnabled(placement: NativePlacement): boolean {
  const config = getAdConfig();
  if (!config.adsEnabled || !config.nativeEnabled) return false;
  switch (placement) {
    case 'home_native_primary':
      return config.nativeHomeEnabled;
    case 'league_native_footer':
      return config.nativeLeagueEnabled;
    case 'friends_native_footer':
      return config.nativeFriendsEnabled;
    case 'profile_native':
      return config.nativeProfileEnabled;
  }
}

export const NativeAdManager = {
  isEnabled(placement: NativePlacement): boolean {
    return nativeEnabled(placement) && adUnitFor(placement) !== null;
  },

  /** Carrega um Native Ad. Devolve `null` em qualquer falha — o chamador some com o card. */
  async load(placement: NativePlacement): Promise<NativeAd | null> {
    if (!NativeAdManager.isEnabled(placement)) return null;
    const store = useAdStore.getState();
    if (!store.adsEnabled) return null;
    if (!store.canRequestAds) {
      adLog(`Native:${placement}`, 'skip: consentimento pendente');
      return null;
    }
    const unitId = adUnitFor(placement);
    if (!unitId) return null;

    const startedAt = Date.now();
    AdAnalytics.request(placement);
    try {
      const ad = await NativeAd.createForAdRequest(unitId, {
        aspectRatio: NativeMediaAspectRatio.LANDSCAPE,
        // O rótulo AdChoices fica no canto superior direito, longe dos controles do app.
        adChoicesPlacement: NativeAdChoicesPlacement.TOP_RIGHT,
        startVideoMuted: true,
      });
      AdAnalytics.loaded(placement, Date.now() - startedAt);
      adLog(`Native:${placement}`, 'loaded');
      return ad;
    } catch (e) {
      AdAnalytics.failed(placement, String(e).slice(0, 80));
      adLog(`Native:${placement}`, 'failed', e);
      return null;
    }
  },

  /** Atraso da n-ésima retentativa, no mesmo backoff dos outros formatos. */
  retryDelayMs(attempt: number): number {
    return BACKOFF_STEPS_MS[Math.min(attempt, BACKOFF_STEPS_MS.length - 1)]!;
  },
};
