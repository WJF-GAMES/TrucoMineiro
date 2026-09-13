import { getAdConfig } from '../config/adConfig';
import { PLACEMENT_FORMAT, PLACEMENT_SCREEN, hasAdUnit } from '../config/adUnits';
import type { AdFormat, AdPlacement } from '../types/ads.types';

/**
 * Placements nomeados.
 *
 * Nenhuma tela inventa string de anúncio: ela pede um placement desta lista, e é este módulo que
 * responde se ele está ligado (kill switch, flag do formato, flag da tela e Ad Unit resolvida).
 */

const PLACEMENT_FLAG: Record<AdPlacement, (c: ReturnType<typeof getAdConfig>) => boolean> = {
  home_native_primary: (c) => c.nativeEnabled && c.nativeHomeEnabled,
  league_native_footer: (c) => c.nativeEnabled && c.nativeLeagueEnabled,
  friends_native_footer: (c) => c.nativeEnabled && c.nativeFriendsEnabled,
  profile_native: (c) => c.nativeEnabled && c.nativeProfileEnabled,
  match_result_interstitial: (c) => c.interstitialEnabled,
  match_analysis_rewarded: (c) => c.rewardedEnabled && c.rewardedAnalysisEnabled,
  home_tip_rewarded: (c) => c.rewardedEnabled && c.rewardedTipEnabled,
  app_open: (c) => c.appOpenEnabled,
};

export const AdPlacementManager = {
  formatOf(placement: AdPlacement): AdFormat {
    return PLACEMENT_FORMAT[placement];
  },

  screenOf(placement: AdPlacement): string {
    return PLACEMENT_SCREEN[placement];
  },

  /** Ligado = kill switch ok + flag do formato + flag do placement + Ad Unit disponível. */
  isEnabled(placement: AdPlacement): boolean {
    const config = getAdConfig();
    if (!config.adsEnabled) return false;
    if (!PLACEMENT_FLAG[placement](config)) return false;
    return hasAdUnit(placement);
  },

  all(): AdPlacement[] {
    return Object.keys(PLACEMENT_FORMAT) as AdPlacement[];
  },
};
