import { AppState, type AppStateStatus } from 'react-native';
import mobileAds, { MaxAdContentRating } from 'react-native-google-mobile-ads';
import { AdAnalytics } from '../analytics/AdAnalytics';
import { getAdConfig, setAdConfigSource } from '../config/adConfig';
import { remoteAdConfigSource } from '../config/remoteAdConfigSource';
import { adEnvironment, usingTestAds } from '../config/environment';
import { AppOpenManager } from '../managers/AppOpenManager';
import { InterstitialManager } from '../managers/InterstitialManager';
import { RewardedManager } from '../managers/RewardedManager';
import { ConsentManager } from '../privacy/ConsentManager';
import { adLog } from '../log';
import type {
  AdDecision,
  AdPlacement,
  RewardedPlacement,
  RewardedResult,
} from '../types/ads.types';
import { AdAudioBridge } from './AdAudioBridge';
import { AdPlacementManager } from './AdPlacementManager';
import {
  canShowRewarded,
  registerFullScreenShown,
  registerInterstitialShown,
  registerMatchCompleted,
  shouldShowAppOpen,
  shouldShowInterstitial,
} from './AdFrequencyManager';
import { currentGuards, useAdStore } from './AdState';

/**
 * Fachada única do módulo de anúncios.
 *
 * Telas e hooks falam só com este objeto: ele decide (frequência + guardas), fala com os
 * managers e mantém o estado observável. Nenhuma tela instancia SDK.
 */

/** Depois de tanto tempo em background, a volta conta como uma sessão nova. */
const NEW_SESSION_AFTER_BACKGROUND_SECONDS = 30 * 60;

let appStateSub: { remove: () => void } | null = null;
let backgroundedAt: number | null = null;
let initializing: Promise<void> | null = null;

async function doInitialize() {
  const store = useAdStore.getState();
  setAdConfigSource(remoteAdConfigSource);

  await store.hydrate();
  store.beginSession(Date.now());

  const config = getAdConfig();
  store.setAdsEnabled(config.adsEnabled);
  if (!config.adsEnabled) {
    adLog('', 'kill switch ligado: nenhum anúncio será requisitado');
    return;
  }

  // Consentimento antes de qualquer requisição.
  const canRequestAds = await ConsentManager.initialize();

  try {
    await mobileAds().setRequestConfiguration({
      // Jogo de baralho para maiores: conteúdo até PG mantém o inventário amplo sem exageros.
      maxAdContentRating: MaxAdContentRating.PG,
      tagForChildDirectedTreatment: false,
      tagForUnderAgeOfConsent: false,
      ...(testDeviceIdentifiers().length
        ? { testDeviceIdentifiers: testDeviceIdentifiers() }
        : {}),
    });
    await mobileAds().initialize();
  } catch (e) {
    adLog('', 'initialize failed', e);
    return;
  }

  AdAudioBridge.syncUserPreference();
  store.setInitialized(true);
  adLog('', `initialized with ${usingTestAds ? 'TEST ADS' : 'PRODUCTION ADS'} (${adEnvironment})`);

  if (canRequestAds) AdService.preloadAds();

  if (!appStateSub) {
    appStateSub = AppState.addEventListener('change', handleAppStateChange);
  }
}

function testDeviceIdentifiers(): string[] {
  const raw: string | undefined = process.env.EXPO_PUBLIC_ADMOB_TEST_DEVICE_IDS;
  if (!raw) return [];
  return raw
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

function handleAppStateChange(status: AppStateStatus) {
  if (status === 'active') AdService.handleForeground();
  else if (status === 'background' || status === 'inactive') AdService.handleBackground();
}

export const AdService = {
  /** Idempotente: pode ser chamado de qualquer lugar sem medo de inicializar duas vezes. */
  initialize(): Promise<void> {
    if (!initializing) {
      initializing = doInitialize().catch((e) => {
        adLog('', 'initialize threw', e);
      });
    }
    return initializing;
  },

  /**
   * Pré-carregamento escalonado: nada de disparar todos os formatos no mesmo frame de startup.
   * A ordem segue a prioridade de negócio (rewarded primeiro, app open por último).
   */
  preloadAds() {
    const store = useAdStore.getState();
    if (!store.adsEnabled || !store.canRequestAds) return;
    const config = getAdConfig();
    if (!config.adsEnabled) return;

    if (AdPlacementManager.isEnabled('match_result_interstitial')) InterstitialManager.preload();
    setTimeout(() => {
      if (AdPlacementManager.isEnabled('home_tip_rewarded')) {
        RewardedManager.preload('home_tip_rewarded');
      }
    }, 1500);
    setTimeout(() => {
      if (AppOpenManager.enabled) AppOpenManager.preload();
    }, 4000);
  },

  /** Kill switch + consentimento: a resposta mais geral de "esse app mostra anúncio agora?". */
  canShowAds(): boolean {
    const store = useAdStore.getState();
    return store.adsEnabled && store.canRequestAds && getAdConfig().adsEnabled;
  },

  /**
   * Guarda absoluta de full-screen. Durante partida ou matchmaking a resposta é sempre `false`,
   * independentemente de frequência, cooldown ou anúncio carregado.
   */
  canShowFullScreenAd(): boolean {
    const guards = currentGuards();
    if (!AdService.canShowAds()) return false;
    if (guards.isGameActive) return false;
    if (guards.isMatchmakingActive) return false;
    if (guards.isFullScreenAdShowing) return false;
    if (!guards.isAppActive) return false;
    if (guards.isCriticalModalOpen) return false;
    if (!guards.isNavigationStable) return false;
    return true;
  },

  /** Contabiliza uma partida concluída (entrada da cadência de intersticiais). */
  notifyMatchCompleted() {
    useAdStore.getState().updateFrequency(registerMatchCompleted);
    // A tela de resultado é um novo contexto: o full-screen ainda não foi usado nele.
    useAdStore.getState().setResultFullScreenUsed(false);
  },

  /** Decisão pura, sem efeito colateral — útil para o painel de debug e para os testes. */
  interstitialDecision(): AdDecision {
    const store = useAdStore.getState();
    return shouldShowInterstitial({
      now: Date.now(),
      config: getAdConfig(),
      snapshot: store.frequency,
      guards: currentGuards(),
      adLoaded: InterstitialManager.loaded,
      fullScreenUsedForCurrentResult: store.fullScreenUsedForCurrentResult,
    });
  },

  /**
   * Interstitial do fim de partida. Resolve `false` sem bloquear nada quando a decisão é pular —
   * o usuário nunca espera por anúncio.
   */
  async showInterstitial(placement: AdPlacement = 'match_result_interstitial'): Promise<boolean> {
    if (!AdPlacementManager.isEnabled(placement)) {
      AdAnalytics.skipped(placement, 'ads_disabled');
      useAdStore.getState().setSkipReason(placement, 'ads_disabled');
      return false;
    }
    const decision = AdService.interstitialDecision();
    if (!decision.show) {
      AdAnalytics.skipped(placement, decision.reason);
      useAdStore.getState().setSkipReason(placement, decision.reason);
      if (decision.reason === 'not_loaded') InterstitialManager.preload();
      return false;
    }

    useAdStore.getState().setSkipReason(placement, null);
    const shown = await InterstitialManager.show();
    if (shown) {
      const now = Date.now();
      useAdStore.getState().updateFrequency((s) => registerInterstitialShown(s, now));
      useAdStore.getState().setResultFullScreenUsed(true);
    }
    return shown;
  },

  rewardedDecision(): AdDecision {
    return canShowRewarded(getAdConfig(), currentGuards());
  },

  isRewardedReady(placement: RewardedPlacement): boolean {
    return AdPlacementManager.isEnabled(placement) && RewardedManager.isLoaded(placement);
  },

  preloadRewarded(placement: RewardedPlacement) {
    if (AdPlacementManager.isEnabled(placement)) RewardedManager.preload(placement);
  },

  /**
   * Rewarded. Só deve ser chamado depois do "assistir" explícito do usuário.
   * A recompensa é liberada exclusivamente quando `earned` volta `true`.
   */
  async showRewarded(placement: RewardedPlacement): Promise<RewardedResult> {
    if (!AdPlacementManager.isEnabled(placement)) {
      AdAnalytics.skipped(placement, 'ads_disabled');
      return { earned: false, reason: 'disabled' };
    }
    const decision = AdService.rewardedDecision();
    if (!decision.show) {
      AdAnalytics.skipped(placement, decision.reason);
      useAdStore.getState().setSkipReason(placement, decision.reason);
      return { earned: false, reason: 'blocked' };
    }

    const result = await RewardedManager.show(placement);
    if (result.earned) {
      const now = Date.now();
      useAdStore.getState().updateFrequency((s) => registerFullScreenShown(s, now));
      // Quem assistiu um rewarded nesta tela não leva interstitial em seguida.
      useAdStore.getState().setResultFullScreenUsed(true);
    } else if (result.reason === 'closed_early') {
      AdAnalytics.rewardDeclined(placement, 'closed_early');
      // Mesmo sem recompensa o anúncio ocupou a tela: o cooldown global vale.
      const now = Date.now();
      useAdStore.getState().updateFrequency((s) => registerFullScreenShown(s, now));
      useAdStore.getState().setResultFullScreenUsed(true);
    }
    return result;
  },

  handleBackground() {
    useAdStore.getState().setAppActive(false);
    backgroundedAt = Date.now();
  },

  handleForeground() {
    const store = useAdStore.getState();
    store.setAppActive(true);
    const away = backgroundedAt ? (Date.now() - backgroundedAt) / 1000 : 0;
    backgroundedAt = null;

    if (away >= NEW_SESSION_AFTER_BACKGROUND_SECONDS) AdService.resetSession();
    if (!store.initialized) return;

    void ConsentManager.refreshConsentInfo();

    // App Open nasce desligado; quando for ligado, esta é a porta de entrada dele.
    if (!AppOpenManager.enabled) return;
    const decision = shouldShowAppOpen({
      now: Date.now(),
      config: getAdConfig(),
      snapshot: useAdStore.getState().frequency,
      guards: currentGuards(),
      adLoaded: AppOpenManager.loaded,
      backgroundSeconds: away,
    });
    if (!decision.show) {
      AdAnalytics.skipped('app_open', decision.reason);
      useAdStore.getState().setSkipReason('app_open', decision.reason);
      return;
    }
    void AppOpenManager.show().then((shown) => {
      if (!shown) return;
      const now = Date.now();
      useAdStore.getState().updateFrequency((s) => registerFullScreenShown(s, now));
    });
  },

  /** Nova sessão: contadores de sessão zerados, número da sessão incrementado. */
  resetSession() {
    useAdStore.getState().beginSession(Date.now());
    AdService.preloadAds();
  },

  /** Desliga tudo (kill switch em runtime, logout, teste). */
  shutdown() {
    InterstitialManager.teardown();
    RewardedManager.teardown();
    AppOpenManager.teardown();
    appStateSub?.remove();
    appStateSub = null;
    initializing = null;
    useAdStore.getState().setInitialized(false);
  },

  /** Snapshot legível para o painel de debug (somente desenvolvimento). */
  getDebugState() {
    const store = useAdStore.getState();
    const config = getAdConfig();
    const f = store.frequency;
    return {
      environment: store.environment,
      mode: store.usingTestAds ? 'TEST ADS' : 'PRODUCTION ADS',
      initialized: store.initialized,
      consentStatus: store.consentStatus,
      canRequestAds: store.canRequestAds,
      adsEnabled: config.adsEnabled && store.adsEnabled,
      interstitialLoaded: InterstitialManager.loaded,
      rewardedAnalysisLoaded: RewardedManager.isLoaded('match_analysis_rewarded'),
      rewardedTipLoaded: RewardedManager.isLoaded('home_tip_rewarded'),
      appOpenEnabled: AppOpenManager.enabled,
      appOpenLoaded: AppOpenManager.loaded,
      sessionNumber: f.sessionNumber,
      sessionAds: `${f.sessionInterstitialCount} / ${config.interstitialMaxPerSession}`,
      dailyAds: `${f.dailyInterstitialCount} / ${config.interstitialMaxPerDay}`,
      matchesSinceAd: `${f.matchesSinceLastInterstitial} / ${config.interstitialEveryNMatches}`,
      matchesCompleted: f.matchesCompleted,
      isGameActive: store.isGameActive,
      isMatchmakingActive: store.isMatchmakingActive,
      isFullScreenAdShowing: store.isFullScreenAdShowing,
      nextInterstitial: AdService.interstitialDecision(),
      lastSkipReason: store.lastSkipReason,
    };
  },
};
