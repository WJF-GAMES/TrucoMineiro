import { flag } from '@/services/firebase/remoteConfig';
import type { AdConfig } from '../types/ads.types';
import type { AdConfigSource } from './adConfig';

/**
 * Liga a configuração de anúncios ao Remote Config já existente no app.
 * Cada chave daqui existe em `remoteConfigDefaults` e em `remoteconfig.template.json`,
 * então dá para rodar A/B test de frequência sem publicar versão nova.
 */
export const remoteAdConfigSource: AdConfigSource = (): Partial<AdConfig> => ({
  adsEnabled: flag('ads_enabled'),
  interstitialEnabled: flag('interstitial_enabled'),
  rewardedEnabled: flag('rewarded_enabled'),
  nativeEnabled: flag('native_enabled'),
  appOpenEnabled: flag('app_open_enabled'),

  interstitialMinMatchesBeforeFirst: flag('interstitial_min_matches_before_first'),
  interstitialEveryNMatches: flag('interstitial_every_n_matches'),
  interstitialCooldownSeconds: flag('interstitial_cooldown_seconds'),
  interstitialMaxPerSession: flag('interstitial_max_per_session'),
  interstitialMaxPerDay: flag('interstitial_max_per_day'),
  fullScreenGlobalCooldownSeconds: flag('full_screen_global_cooldown_seconds'),
  minimumSessionSecondsBeforeInterstitial: flag('minimum_session_seconds_before_interstitial'),

  nativeHomeEnabled: flag('native_home_enabled'),
  nativeLeagueEnabled: flag('native_league_enabled'),
  nativeFriendsEnabled: flag('native_friends_enabled'),
  nativeProfileEnabled: flag('native_profile_enabled'),

  rewardedAnalysisEnabled: flag('rewarded_analysis_enabled'),
  rewardedTipEnabled: flag('rewarded_tip_enabled'),

  appOpenMinSessionNumber: flag('app_open_min_session_number'),
  appOpenMinBackgroundSeconds: flag('app_open_min_background_seconds'),
});
