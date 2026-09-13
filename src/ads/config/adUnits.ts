import { Platform } from 'react-native';
import { TestIds } from 'react-native-google-mobile-ads';
import type { AdFormat, AdPlacement } from '../types/ads.types';
import { isProductionAdEnvironment } from './environment';

/**
 * Resolução de Ad Unit por placement.
 *
 * - dev/staging: constantes oficiais `TestIds` do SDK (nunca IDs escritos à mão).
 * - production: IDs vindos do ambiente. Enquanto estiverem vazios, o placement fica **sem** unit
 *   e o `AdService` simplesmente não serve aquele formato — jamais cai para Test Ads num app
 *   publicado (isso geraria tráfego inválido).
 */

/**
 * Os IDs de produção precisam do prefixo `EXPO_PUBLIC_` para chegarem ao bundle do app.
 * Todos nascem vazios: ver `.env.example` e `docs/ADMOB_MONETIZATION.md`.
 */
const PRODUCTION_IDS: Record<AdPlacement, { android?: string; ios?: string }> = {
  match_result_interstitial: {
    android: process.env.EXPO_PUBLIC_ADMOB_ANDROID_INTERSTITIAL_MATCH_RESULT,
    ios: process.env.EXPO_PUBLIC_ADMOB_IOS_INTERSTITIAL_MATCH_RESULT,
  },
  match_analysis_rewarded: {
    android: process.env.EXPO_PUBLIC_ADMOB_ANDROID_REWARDED_MATCH_ANALYSIS,
    ios: process.env.EXPO_PUBLIC_ADMOB_IOS_REWARDED_MATCH_ANALYSIS,
  },
  home_tip_rewarded: {
    android: process.env.EXPO_PUBLIC_ADMOB_ANDROID_REWARDED_HOME_TIP,
    ios: process.env.EXPO_PUBLIC_ADMOB_IOS_REWARDED_HOME_TIP,
  },
  home_native_primary: {
    android: process.env.EXPO_PUBLIC_ADMOB_ANDROID_NATIVE_HOME,
    ios: process.env.EXPO_PUBLIC_ADMOB_IOS_NATIVE_HOME,
  },
  league_native_footer: {
    android: process.env.EXPO_PUBLIC_ADMOB_ANDROID_NATIVE_LEAGUE,
    ios: process.env.EXPO_PUBLIC_ADMOB_IOS_NATIVE_LEAGUE,
  },
  friends_native_footer: {
    android: process.env.EXPO_PUBLIC_ADMOB_ANDROID_NATIVE_FRIENDS,
    ios: process.env.EXPO_PUBLIC_ADMOB_IOS_NATIVE_FRIENDS,
  },
  profile_native: {
    android: process.env.EXPO_PUBLIC_ADMOB_ANDROID_NATIVE_PROFILE,
    ios: process.env.EXPO_PUBLIC_ADMOB_IOS_NATIVE_PROFILE,
  },
  app_open: {
    android: process.env.EXPO_PUBLIC_ADMOB_ANDROID_APP_OPEN,
    ios: process.env.EXPO_PUBLIC_ADMOB_IOS_APP_OPEN,
  },
};

export const PLACEMENT_FORMAT: Record<AdPlacement, AdFormat> = {
  match_result_interstitial: 'interstitial',
  match_analysis_rewarded: 'rewarded',
  home_tip_rewarded: 'rewarded',
  home_native_primary: 'native',
  league_native_footer: 'native',
  friends_native_footer: 'native',
  profile_native: 'native',
  app_open: 'app_open',
};

/** Tela onde cada placement vive (vai em toda telemetria). */
export const PLACEMENT_SCREEN: Record<AdPlacement, string> = {
  match_result_interstitial: 'MatchResult',
  match_analysis_rewarded: 'MatchResult',
  home_tip_rewarded: 'Home',
  home_native_primary: 'Home',
  league_native_footer: 'League',
  friends_native_footer: 'Friends',
  profile_native: 'Profile',
  app_open: 'App',
};

const TEST_ID_BY_FORMAT: Record<AdFormat, string> = {
  interstitial: TestIds.INTERSTITIAL,
  rewarded: TestIds.REWARDED,
  native: TestIds.NATIVE,
  app_open: TestIds.APP_OPEN,
  banner: TestIds.ADAPTIVE_BANNER,
};

/**
 * Ad Unit ID do placement, ou `null` quando produção ainda não tem o ID configurado.
 * Fora de produção o retorno é sempre um Test ID oficial do Google.
 */
export function adUnitFor(placement: AdPlacement): string | null {
  if (!isProductionAdEnvironment) return TEST_ID_BY_FORMAT[PLACEMENT_FORMAT[placement]];
  const ids = PRODUCTION_IDS[placement];
  const id = (Platform.OS === 'ios' ? ids.ios : ids.android)?.trim();
  return id ? id : null;
}

/** Um placement só existe de fato quando tem unit resolvida. */
export function hasAdUnit(placement: AdPlacement): boolean {
  return adUnitFor(placement) !== null;
}
