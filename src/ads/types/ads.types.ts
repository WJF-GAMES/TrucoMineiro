/**
 * Tipos do módulo de monetização por anúncios.
 *
 * Regra central: nenhuma tela conhece SDK. As telas falam com `AdService` e com os hooks,
 * sempre através de um *placement* nomeado (nunca de uma string solta).
 */

export type AdEnvironment = 'development' | 'staging' | 'production';

export type AdFormat = 'interstitial' | 'rewarded' | 'native' | 'app_open' | 'banner';

/** Todos os pontos de exibição do app. Toda telemetria carrega um destes. */
export type AdPlacement =
  | 'home_native_primary'
  | 'league_native_footer'
  | 'friends_native_footer'
  | 'profile_native'
  | 'match_result_interstitial'
  | 'match_analysis_rewarded'
  | 'home_tip_rewarded'
  | 'app_open';

export type NativePlacement = Extract<
  AdPlacement,
  'home_native_primary' | 'league_native_footer' | 'friends_native_footer' | 'profile_native'
>;

export type RewardedPlacement = Extract<
  AdPlacement,
  'match_analysis_rewarded' | 'home_tip_rewarded'
>;

/** Configuração de negócio (defaults locais, sobrepostos por Remote Config). */
export interface AdConfig {
  adsEnabled: boolean;
  interstitialEnabled: boolean;
  rewardedEnabled: boolean;
  nativeEnabled: boolean;
  appOpenEnabled: boolean;

  interstitialMinMatchesBeforeFirst: number;
  interstitialEveryNMatches: number;
  interstitialCooldownSeconds: number;
  interstitialMaxPerSession: number;
  interstitialMaxPerDay: number;
  fullScreenGlobalCooldownSeconds: number;
  minimumSessionSecondsBeforeInterstitial: number;

  nativeHomeEnabled: boolean;
  nativeLeagueEnabled: boolean;
  nativeFriendsEnabled: boolean;
  nativeProfileEnabled: boolean;

  rewardedAnalysisEnabled: boolean;
  rewardedTipEnabled: boolean;

  /** A partir de qual sessão o App Open pode ser considerado (quando ligado). */
  appOpenMinSessionNumber: number;
  /** Tempo mínimo em background para o App Open valer a interrupção. */
  appOpenMinBackgroundSeconds: number;
}

/** Estado persistido/contado que alimenta as decisões de frequência. */
export interface FrequencySnapshot {
  /** `YYYY-MM-DD` local, usado para zerar o cap diário na virada do dia. */
  dateKey: string;
  dailyInterstitialCount: number;
  /** Número da sessão atual (1 = primeira sessão da vida do usuário). */
  sessionNumber: number;
  /** Partidas concluídas na vida do usuário. */
  matchesCompleted: number;
  /** Partidas concluídas nesta sessão. */
  sessionMatchesCompleted: number;
  matchesSinceLastInterstitial: number;
  sessionInterstitialCount: number;
  lastInterstitialAt: number | null;
  /** Qualquer full-screen (interstitial, rewarded ou app open). */
  lastFullScreenAdAt: number | null;
  sessionStartedAt: number;
}

/** Flags de runtime que bloqueiam anúncios independentemente da frequência. */
export interface AdRuntimeGuards {
  adsEnabled: boolean;
  canRequestAds: boolean;
  isGameActive: boolean;
  isMatchmakingActive: boolean;
  isFullScreenAdShowing: boolean;
  isCriticalModalOpen: boolean;
  isAppActive: boolean;
  isNavigationStable: boolean;
}

export type InterstitialSkipReason =
  | 'ads_disabled'
  | 'interstitial_disabled'
  | 'consent_missing'
  | 'app_background'
  | 'game_active'
  | 'matchmaking_active'
  | 'modal_open'
  | 'navigation_unstable'
  | 'full_screen_showing'
  | 'result_already_used_full_screen'
  | 'first_session'
  | 'session_cap'
  | 'daily_cap'
  | 'session_too_young'
  | 'not_enough_matches'
  | 'cadence'
  | 'cooldown'
  | 'global_cooldown'
  | 'not_loaded';

export type AdDecision = { show: true } | { show: false; reason: InterstitialSkipReason };

export interface RewardedResult {
  /** `true` somente quando o SDK emitiu `EARNED_REWARD`. */
  earned: boolean;
  reason?: 'disabled' | 'not_loaded' | 'blocked' | 'closed_early' | 'error';
}

export interface AdPaidEvent {
  valueMicros: number;
  currencyCode: string;
  precision: number;
  adUnit: string;
  placement: AdPlacement;
  network?: string;
}
