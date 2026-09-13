import {
  AdEventType,
  RewardedAd,
  RewardedAdEventType,
  type PaidEvent,
  type RewardedAdReward,
} from 'react-native-google-mobile-ads';
import { AdAnalytics } from '../analytics/AdAnalytics';
import { adUnitFor } from '../config/adUnits';
import { AdAudioBridge } from '../core/AdAudioBridge';
import { createRetry } from '../core/backoff';
import { withCloseTimeout } from '../core/withTimeout';
import { useAdStore } from '../core/AdState';
import { adLog } from '../log';
import type { RewardedPlacement, RewardedResult } from '../types/ads.types';
import { errorCode } from './InterstitialManager';

/**
 * Rewarded Ads — o formato prioritário do app.
 *
 * Sempre opt-in: quem chama `show()` já obteve o "assistir" explícito do usuário. A recompensa
 * só é liberada no callback `EARNED_REWARD`; fechar o vídeo antes não libera nada.
 */
class RewardedSlot {
  private ad: RewardedAd | null = null;
  private unsubscribe: (() => void)[] = [];
  private loading = false;
  private requestedAt = 0;
  private earned = false;
  private closeResolver: (() => void) | null = null;
  private readonly retry: ReturnType<typeof createRetry>;

  constructor(private readonly placement: RewardedPlacement) {
    this.retry = createRetry(`Rewarded:${placement}`, () => this.preload());
  }

  get loaded(): boolean {
    return this.ad?.loaded === true;
  }

  preload() {
    if (this.loading || this.loaded) return;
    const unitId = adUnitFor(this.placement);
    if (!unitId) {
      adLog(`Rewarded:${this.placement}`, 'sem ad unit configurada — formato desativado');
      return;
    }
    if (!useAdStore.getState().canRequestAds) return;

    this.teardown();
    this.loading = true;
    this.requestedAt = Date.now();
    const ad = RewardedAd.createForAdRequest(unitId);
    this.ad = ad;
    this.bind(ad);
    AdAnalytics.request(this.placement);
    ad.load();
  }

  private bind(ad: RewardedAd) {
    const scope = `Rewarded:${this.placement}`;
    this.unsubscribe.push(
      ad.addAdEventListener(RewardedAdEventType.LOADED, () => {
        this.loading = false;
        this.retry.reset();
        useAdStore.getState().setRewardedLoaded(this.placement, true);
        AdAnalytics.loaded(this.placement, Date.now() - this.requestedAt);
        adLog(scope, 'loaded');
      }),
      ad.addAdEventListener(RewardedAdEventType.EARNED_REWARD, (reward) => {
        this.earned = true;
        const r = reward as RewardedAdReward | undefined;
        AdAnalytics.rewardEarned(this.placement, r?.type ?? 'content', r?.amount ?? 1);
        adLog(scope, 'earned reward');
      }),
      ad.addAdEventListener(AdEventType.ERROR, (error) => {
        this.loading = false;
        useAdStore.getState().setRewardedLoaded(this.placement, false);
        AdAnalytics.failed(this.placement, errorCode(error));
        adLog(scope, `error: ${errorCode(error)}`);
        this.retry.schedule();
      }),
      ad.addAdEventListener(AdEventType.OPENED, () => {
        AdAnalytics.opened(this.placement);
        AdAnalytics.impression(this.placement);
      }),
      ad.addAdEventListener(AdEventType.CLICKED, () => AdAnalytics.clicked(this.placement)),
      ad.addAdEventListener(AdEventType.PAID, (payload) => {
        const paid = payload as unknown as PaidEvent | undefined;
        if (!paid) return;
        AdAnalytics.paid({
          valueMicros: paid.value * 1_000_000,
          currencyCode: paid.currency,
          precision: paid.precision,
          adUnit: ad.adUnitId,
          placement: this.placement,
        });
      }),
      ad.addAdEventListener(AdEventType.CLOSED, () => {
        useAdStore.getState().setRewardedLoaded(this.placement, false);
        AdAnalytics.closed(this.placement);
        this.closeResolver?.();
        this.closeResolver = null;
        this.preload();
      }),
    );
  }

  async show(): Promise<RewardedResult> {
    const ad = this.ad;
    if (!ad || !ad.loaded) {
      this.preload();
      return { earned: false, reason: 'not_loaded' };
    }
    this.earned = false;
    useAdStore.getState().setFullScreenShowing(true);
    AdAudioBridge.onFullScreenAdOpened();
    const closed = new Promise<void>((resolve) => {
      this.closeResolver = resolve;
    });
    try {
      await ad.show();
      await withCloseTimeout(closed, `Rewarded:${this.placement}`);
      return this.earned ? { earned: true } : { earned: false, reason: 'closed_early' };
    } catch (e) {
      adLog(`Rewarded:${this.placement}`, 'show failed', e);
      this.closeResolver = null;
      return { earned: false, reason: 'error' };
    } finally {
      useAdStore.getState().setFullScreenShowing(false);
      AdAudioBridge.onFullScreenAdClosed();
    }
  }

  teardown() {
    this.retry.cancel();
    this.unsubscribe.forEach((u) => u());
    this.unsubscribe = [];
    this.ad?.removeAllListeners();
    this.ad = null;
    this.loading = false;
    this.closeResolver = null;
    useAdStore.getState().setRewardedLoaded(this.placement, false);
  }
}

const slots: Record<RewardedPlacement, RewardedSlot> = {
  match_analysis_rewarded: new RewardedSlot('match_analysis_rewarded'),
  home_tip_rewarded: new RewardedSlot('home_tip_rewarded'),
};

export const RewardedManager = {
  preload(placement: RewardedPlacement) {
    slots[placement].preload();
  },
  isLoaded(placement: RewardedPlacement): boolean {
    return slots[placement].loaded;
  },
  show(placement: RewardedPlacement): Promise<RewardedResult> {
    return slots[placement].show();
  },
  teardown() {
    (Object.keys(slots) as RewardedPlacement[]).forEach((p) => slots[p].teardown());
  },
};
