import type {
  AdConfig,
  AdDecision,
  AdRuntimeGuards,
  FrequencySnapshot,
  InterstitialSkipReason,
} from '../types/ads.types';

/**
 * Decide *se* um anúncio full-screen pode aparecer. Módulo puro e determinístico:
 * nada de SDK, storage ou relógio implícito — o `now` sempre entra por parâmetro.
 * Assim a política de frequência inteira fica coberta por teste.
 */

/** Chave de dia local, usada para zerar o cap diário na virada. */
export function dateKeyOf(now: number): string {
  const d = new Date(now);
  const mm = `${d.getMonth() + 1}`.padStart(2, '0');
  const dd = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export function emptySnapshot(now: number): FrequencySnapshot {
  return {
    dateKey: dateKeyOf(now),
    dailyInterstitialCount: 0,
    sessionNumber: 1,
    matchesCompleted: 0,
    sessionMatchesCompleted: 0,
    matchesSinceLastInterstitial: 0,
    sessionInterstitialCount: 0,
    lastInterstitialAt: null,
    lastFullScreenAdAt: null,
    sessionStartedAt: now,
  };
}

/** Virou o dia: o cap diário recomeça. */
export function rollDaily(snapshot: FrequencySnapshot, now: number): FrequencySnapshot {
  const key = dateKeyOf(now);
  if (key === snapshot.dateKey) return snapshot;
  return { ...snapshot, dateKey: key, dailyInterstitialCount: 0 };
}

/** Começo de sessão: zera os contadores de sessão e incrementa o número da sessão. */
export function startSession(snapshot: FrequencySnapshot, now: number): FrequencySnapshot {
  return {
    ...rollDaily(snapshot, now),
    sessionNumber: snapshot.sessionNumber + 1,
    sessionMatchesCompleted: 0,
    sessionInterstitialCount: 0,
    sessionStartedAt: now,
  };
}

export function registerMatchCompleted(snapshot: FrequencySnapshot): FrequencySnapshot {
  return {
    ...snapshot,
    matchesCompleted: snapshot.matchesCompleted + 1,
    sessionMatchesCompleted: snapshot.sessionMatchesCompleted + 1,
    matchesSinceLastInterstitial: snapshot.matchesSinceLastInterstitial + 1,
  };
}

export function registerInterstitialShown(
  snapshot: FrequencySnapshot,
  now: number,
): FrequencySnapshot {
  const rolled = rollDaily(snapshot, now);
  return {
    ...rolled,
    dailyInterstitialCount: rolled.dailyInterstitialCount + 1,
    sessionInterstitialCount: rolled.sessionInterstitialCount + 1,
    matchesSinceLastInterstitial: 0,
    lastInterstitialAt: now,
    lastFullScreenAdAt: now,
  };
}

/** Rewarded e App Open não contam no cap de interstitial, mas seguram o cooldown global. */
export function registerFullScreenShown(
  snapshot: FrequencySnapshot,
  now: number,
): FrequencySnapshot {
  return { ...snapshot, lastFullScreenAdAt: now };
}

/**
 * Teto de intersticiais por sessão para usuário novo: sessão 1 nunca vê anúncio, sessão 2 vê
 * no máximo um, da sessão 3 em diante vale a regra padrão. Primeiro criar valor, depois monetizar.
 */
export function sessionInterstitialAllowance(sessionNumber: number, config: AdConfig): number {
  if (sessionNumber <= 1) return 0;
  if (sessionNumber === 2) return Math.min(1, config.interstitialMaxPerSession);
  return config.interstitialMaxPerSession;
}

export interface InterstitialDecisionInput {
  now: number;
  config: AdConfig;
  snapshot: FrequencySnapshot;
  guards: AdRuntimeGuards;
  /** O anúncio já está carregado? Se não estiver, a decisão é pular — nunca esperar. */
  adLoaded: boolean;
  /** O usuário já consumiu um full-screen para este resultado (ex.: assistiu ao rewarded). */
  fullScreenUsedForCurrentResult: boolean;
}

/**
 * Ordem importa: a primeira regra que barra devolve o motivo, e é esse motivo que vai para a
 * telemetria (`ad_skipped_by_frequency`) e para o painel de debug.
 */
export function shouldShowInterstitial(input: InterstitialDecisionInput): AdDecision {
  const { now, config, guards, adLoaded, fullScreenUsedForCurrentResult } = input;
  const snapshot = rollDaily(input.snapshot, now);

  if (!config.adsEnabled || !guards.adsEnabled) return deny('ads_disabled');
  if (!config.interstitialEnabled) return deny('interstitial_disabled');
  if (!guards.canRequestAds) return deny('consent_missing');
  if (!guards.isAppActive) return deny('app_background');

  // Gameplay é intocável.
  if (guards.isGameActive) return deny('game_active');
  if (guards.isMatchmakingActive) return deny('matchmaking_active');
  if (guards.isCriticalModalOpen) return deny('modal_open');
  if (!guards.isNavigationStable) return deny('navigation_unstable');
  if (guards.isFullScreenAdShowing) return deny('full_screen_showing');
  if (fullScreenUsedForCurrentResult) return deny('result_already_used_full_screen');

  const allowance = sessionInterstitialAllowance(snapshot.sessionNumber, config);
  if (allowance <= 0) return deny('first_session');
  if (snapshot.sessionInterstitialCount >= allowance) return deny('session_cap');
  if (snapshot.dailyInterstitialCount >= config.interstitialMaxPerDay) return deny('daily_cap');

  const sessionAgeSeconds = (now - snapshot.sessionStartedAt) / 1000;
  if (sessionAgeSeconds < config.minimumSessionSecondsBeforeInterstitial)
    return deny('session_too_young');

  if (snapshot.lastInterstitialAt === null) {
    // Primeiro interstitial da vida do usuário: só depois de o jogo ter criado valor.
    if (snapshot.matchesCompleted < config.interstitialMinMatchesBeforeFirst)
      return deny('not_enough_matches');
  } else {
    if (snapshot.matchesSinceLastInterstitial < config.interstitialEveryNMatches)
      return deny('cadence');
    if ((now - snapshot.lastInterstitialAt) / 1000 < config.interstitialCooldownSeconds)
      return deny('cooldown');
  }

  if (
    snapshot.lastFullScreenAdAt !== null &&
    (now - snapshot.lastFullScreenAdAt) / 1000 < config.fullScreenGlobalCooldownSeconds
  )
    return deny('global_cooldown');

  if (!adLoaded) return deny('not_loaded');

  return { show: true };
}

export interface AppOpenDecisionInput {
  now: number;
  config: AdConfig;
  snapshot: FrequencySnapshot;
  guards: AdRuntimeGuards;
  adLoaded: boolean;
  /** Quanto tempo o app passou em background antes de voltar. */
  backgroundSeconds: number;
}

/**
 * App Open nasce desligado. A política já está escrita para quando for ligado: usuário maduro,
 * background longo, nada de gameplay/matchmaking e sem full-screen recente.
 */
export function shouldShowAppOpen(input: AppOpenDecisionInput): AdDecision {
  const { now, config, guards, adLoaded, backgroundSeconds } = input;
  const snapshot = rollDaily(input.snapshot, now);

  if (!config.adsEnabled || !guards.adsEnabled) return deny('ads_disabled');
  if (!config.appOpenEnabled) return deny('interstitial_disabled');
  if (!guards.canRequestAds) return deny('consent_missing');
  if (!guards.isAppActive) return deny('app_background');
  if (guards.isGameActive) return deny('game_active');
  if (guards.isMatchmakingActive) return deny('matchmaking_active');
  if (guards.isCriticalModalOpen) return deny('modal_open');
  if (!guards.isNavigationStable) return deny('navigation_unstable');
  if (guards.isFullScreenAdShowing) return deny('full_screen_showing');
  if (snapshot.sessionNumber < config.appOpenMinSessionNumber) return deny('first_session');
  // Volta rápida: quem saiu 30 segundos para responder uma mensagem não vê anúncio.
  if (backgroundSeconds < config.appOpenMinBackgroundSeconds) return deny('cadence');
  if (
    snapshot.lastFullScreenAdAt !== null &&
    (now - snapshot.lastFullScreenAdAt) / 1000 < config.fullScreenGlobalCooldownSeconds
  )
    return deny('global_cooldown');
  if (!adLoaded) return deny('not_loaded');

  return { show: true };
}

/** Rewarded é opt-in, então só o kill switch, o consentimento e o estado de tela barram. */
export function canShowRewarded(config: AdConfig, guards: AdRuntimeGuards): AdDecision {
  if (!config.adsEnabled || !guards.adsEnabled) return deny('ads_disabled');
  if (!config.rewardedEnabled) return deny('interstitial_disabled');
  if (!guards.canRequestAds) return deny('consent_missing');
  if (!guards.isAppActive) return deny('app_background');
  if (guards.isGameActive) return deny('game_active');
  if (guards.isMatchmakingActive) return deny('matchmaking_active');
  if (guards.isFullScreenAdShowing) return deny('full_screen_showing');
  return { show: true };
}

function deny(reason: InterstitialSkipReason): AdDecision {
  return { show: false, reason };
}
