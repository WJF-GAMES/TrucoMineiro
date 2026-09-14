import { AdEventType, RewardedAd, RewardedAdEventType } from 'react-native-google-mobile-ads';
import { setAdConfigSource } from '../config/adConfig';
import { AdService } from '../core/AdService';
import { useAdStore } from '../core/AdState';
import { RewardedManager } from '../managers/RewardedManager';

jest.mock('@/services/firebase/analytics', () => ({ logEvent: jest.fn(), logScreen: jest.fn() }));
jest.mock('@/services/firebase/remoteConfig', () => ({
  flag: jest.fn(),
  initRemoteConfig: jest.fn(),
}));

type Listener = (payload?: unknown) => void;

/**
 * Controla um `RewardedAd` falso: o teste decide se o SDK emite a recompensa antes de fechar.
 * É exatamente a diferença entre "conteúdo liberado" e "conteúdo continua bloqueado".
 */
function stubRewarded({ earnReward }: { earnReward: boolean }) {
  const listeners = new Map<string, Listener[]>();
  const ad = {
    adUnitId: 'test-rewarded',
    loaded: false,
    load: jest.fn(() => {
      ad.loaded = true;
      emit(RewardedAdEventType.LOADED);
    }),
    show: jest.fn(async () => {
      emit(AdEventType.OPENED);
      if (earnReward) emit(RewardedAdEventType.EARNED_REWARD, { type: 'content', amount: 1 });
      emit(AdEventType.CLOSED);
    }),
    addAdEventListener: jest.fn((type: string, listener: Listener) => {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
      return () => undefined;
    }),
    removeAllListeners: jest.fn(),
  };
  function emit(type: string, payload?: unknown) {
    (listeners.get(type) ?? []).forEach((l) => l(payload));
  }
  (RewardedAd.createForAdRequest as jest.Mock).mockReturnValue(ad);
  return ad;
}

describe('fluxo do Rewarded', () => {
  beforeEach(() => {
    setAdConfigSource(null);
    RewardedManager.teardown();
    (RewardedAd.createForAdRequest as jest.Mock).mockReset();
    useAdStore.setState({
      adsEnabled: true,
      canRequestAds: true,
      isGameActive: false,
      isMatchmakingActive: false,
      isFullScreenAdShowing: false,
      criticalModalCount: 0,
      isAppActive: true,
      isNavigationStable: true,
      fullScreenUsedForCurrentResult: false,
    });
  });

  it('libera a recompensa quando o SDK confirma EARNED_REWARD', async () => {
    stubRewarded({ earnReward: true });
    AdService.preloadRewarded('match_analysis_rewarded');

    const result = await AdService.showRewarded('match_analysis_rewarded');
    expect(result.earned).toBe(true);
  });

  it('não libera nada quando o usuário fecha antes do fim', async () => {
    stubRewarded({ earnReward: false });
    AdService.preloadRewarded('match_analysis_rewarded');

    const result = await AdService.showRewarded('match_analysis_rewarded');
    expect(result).toEqual({ earned: false, reason: 'closed_early' });
  });

  it('marca o resultado como já tendo usado full-screen (não leva interstitial depois)', async () => {
    stubRewarded({ earnReward: true });
    AdService.preloadRewarded('match_analysis_rewarded');

    await AdService.showRewarded('match_analysis_rewarded');
    expect(useAdStore.getState().fullScreenUsedForCurrentResult).toBe(true);
    expect(AdService.interstitialDecision()).toEqual({
      show: false,
      reason: 'result_already_used_full_screen',
    });
  });

  it('segura o cooldown global mesmo quando o usuário fecha antes', async () => {
    stubRewarded({ earnReward: false });
    AdService.preloadRewarded('match_analysis_rewarded');

    await AdService.showRewarded('match_analysis_rewarded');
    expect(useAdStore.getState().frequency.lastFullScreenAdAt).not.toBeNull();
  });

  it('não exibe nada sem anúncio carregado', async () => {
    (RewardedAd.createForAdRequest as jest.Mock).mockReturnValue({
      adUnitId: 'x',
      loaded: false,
      load: jest.fn(),
      show: jest.fn(),
      addAdEventListener: jest.fn(() => () => undefined),
      removeAllListeners: jest.fn(),
    });
    AdService.preloadRewarded('home_tip_rewarded');

    const result = await AdService.showRewarded('home_tip_rewarded');
    expect(result).toEqual({ earned: false, reason: 'not_loaded' });
  });

  it('é bloqueado durante a partida, mesmo carregado', async () => {
    stubRewarded({ earnReward: true });
    AdService.preloadRewarded('match_analysis_rewarded');
    useAdStore.getState().setGameActive(true);

    const result = await AdService.showRewarded('match_analysis_rewarded');
    expect(result).toEqual({ earned: false, reason: 'blocked' });
    useAdStore.getState().setGameActive(false);
  });

  it('é bloqueado pelo kill switch', async () => {
    setAdConfigSource(() => ({ adsEnabled: false }));
    stubRewarded({ earnReward: true });

    const result = await AdService.showRewarded('match_analysis_rewarded');
    expect(result).toEqual({ earned: false, reason: 'disabled' });
  });
});
