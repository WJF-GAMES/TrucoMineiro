import type { AdConfig } from '../types/ads.types';

/**
 * Configuração de monetização.
 *
 * `AD_CONFIG_DEFAULTS` é a verdade local (vale offline, no primeiro boot e em teste).
 * A fonte remota é plugável: hoje é o Remote Config do Firebase (`remoteAdConfigSource`),
 * amanhã pode ser qualquer outra coisa sem que nenhum manager precise mudar.
 */
export const AD_CONFIG_DEFAULTS: AdConfig = {
  adsEnabled: true,
  interstitialEnabled: true,
  rewardedEnabled: true,
  nativeEnabled: true,
  appOpenEnabled: false,

  interstitialMinMatchesBeforeFirst: 2,
  interstitialEveryNMatches: 3,
  interstitialCooldownSeconds: 180,
  interstitialMaxPerSession: 4,
  interstitialMaxPerDay: 8,
  fullScreenGlobalCooldownSeconds: 180,
  minimumSessionSecondsBeforeInterstitial: 180,

  nativeHomeEnabled: true,
  nativeLeagueEnabled: true,
  nativeFriendsEnabled: true,
  nativeProfileEnabled: false,

  rewardedAnalysisEnabled: true,
  rewardedTipEnabled: true,

  appOpenMinSessionNumber: 4,
  appOpenMinBackgroundSeconds: 6 * 60 * 60,
};

/** Uma fonte de configuração devolve overrides parciais; o que faltar cai no default. */
export type AdConfigSource = () => Partial<AdConfig>;

let source: AdConfigSource | null = null;
let cache: AdConfig = AD_CONFIG_DEFAULTS;

export function setAdConfigSource(next: AdConfigSource | null) {
  source = next;
  cache = AD_CONFIG_DEFAULTS;
}

/** Configuração efetiva. Nunca lança: qualquer falha da fonte remota mantém os defaults. */
export function getAdConfig(): AdConfig {
  if (!source) return AD_CONFIG_DEFAULTS;
  try {
    cache = { ...AD_CONFIG_DEFAULTS, ...source() };
  } catch {
    // Remote Config indisponível: segue com o último valor bom.
  }
  return cache;
}
