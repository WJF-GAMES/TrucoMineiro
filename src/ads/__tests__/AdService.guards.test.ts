import { AdService } from '../core/AdService';
import { useAdStore } from '../core/AdState';
import { setAdConfigSource } from '../config/adConfig';

// Os wrappers do Firebase são módulos nativos: aqui só interessa que não quebrem o import.
jest.mock('@/services/firebase/analytics', () => ({
  logEvent: jest.fn(),
  logScreen: jest.fn(),
}));
jest.mock('@/services/firebase/remoteConfig', () => ({
  flag: jest.fn(),
  initRemoteConfig: jest.fn(),
}));

/**
 * Garantia mais importante do módulo: com partida ou matchmaking ativos, nenhum anúncio
 * full-screen pode aparecer — aconteça o que acontecer com frequência, cooldown ou carregamento.
 */
describe('AdService.canShowFullScreenAd', () => {
  beforeEach(() => {
    setAdConfigSource(null);
    useAdStore.setState({
      adsEnabled: true,
      canRequestAds: true,
      isGameActive: false,
      isMatchmakingActive: false,
      isFullScreenAdShowing: false,
      criticalModalCount: 0,
      isAppActive: true,
      isNavigationStable: true,
      currentScreen: 'Main',
    });
  });

  it('libera quando o app está parado numa tela comum', () => {
    expect(AdService.canShowFullScreenAd()).toBe(true);
  });

  it.each(['Splash', 'Intro', 'Login', 'Otp', 'Register', 'Game', 'Matchmaking', 'Lobby'])(
    'bloqueia na tela sem anúncio %s',
    (screen) => {
      useAdStore.getState().setCurrentScreen(screen);
      expect(AdService.canShowFullScreenAd()).toBe(false);
      expect(AdService.rewardedDecision()).toEqual({ show: false, reason: 'ad_free_screen' });
    },
  );

  it('sem tela conhecida (navegação montando) também bloqueia', () => {
    useAdStore.getState().setCurrentScreen(null);
    expect(AdService.canShowFullScreenAd()).toBe(false);
  });

  it('bloqueia durante a partida', () => {
    useAdStore.getState().setGameActive(true);
    expect(AdService.canShowFullScreenAd()).toBe(false);
  });

  it('bloqueia durante o matchmaking', () => {
    useAdStore.getState().setMatchmakingActive(true);
    expect(AdService.canShowFullScreenAd()).toBe(false);
  });

  it('bloqueia com outro full-screen na tela', () => {
    useAdStore.getState().setFullScreenShowing(true);
    expect(AdService.canShowFullScreenAd()).toBe(false);
  });

  it('bloqueia com o app em background', () => {
    useAdStore.getState().setAppActive(false);
    expect(AdService.canShowFullScreenAd()).toBe(false);
  });

  it('bloqueia com modal crítico aberto', () => {
    useAdStore.getState().pushCriticalModal();
    expect(AdService.canShowFullScreenAd()).toBe(false);
    useAdStore.getState().popCriticalModal();
    expect(AdService.canShowFullScreenAd()).toBe(true);
  });

  it('bloqueia com o kill switch desligado', () => {
    useAdStore.getState().setAdsEnabled(false);
    expect(AdService.canShowFullScreenAd()).toBe(false);
  });

  it('bloqueia sem consentimento resolvido', () => {
    useAdStore
      .getState()
      .setConsent({ canRequestAds: false, status: 'REQUIRED', privacyOptionsRequired: false });
    expect(AdService.canShowFullScreenAd()).toBe(false);
  });
});

describe('showInterstitial durante gameplay', () => {
  it('não exibe nada e devolve false', async () => {
    setAdConfigSource(null);
    useAdStore.setState({
      adsEnabled: true,
      canRequestAds: true,
      isGameActive: true,
      isAppActive: true,
      isNavigationStable: true,
      currentScreen: 'Main',
      criticalModalCount: 0,
      isFullScreenAdShowing: false,
      isMatchmakingActive: false,
    });
    await expect(AdService.showInterstitial()).resolves.toBe(false);
    expect(useAdStore.getState().lastSkipReason.match_result_interstitial).toBe('game_active');
  });
});

describe('contagem de partidas', () => {
  it('cada partida concluída avança a cadência e reabre a tela de resultado', () => {
    useAdStore.setState({ fullScreenUsedForCurrentResult: true });
    const before = useAdStore.getState().frequency.matchesCompleted;
    AdService.notifyMatchCompleted();
    const after = useAdStore.getState().frequency;
    expect(after.matchesCompleted).toBe(before + 1);
    expect(useAdStore.getState().fullScreenUsedForCurrentResult).toBe(false);
  });
});
