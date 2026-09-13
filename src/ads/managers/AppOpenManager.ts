import { AdEventType, AppOpenAd, type PaidEvent } from 'react-native-google-mobile-ads';
import { AdAnalytics } from '../analytics/AdAnalytics';
import { getAdConfig } from '../config/adConfig';
import { adUnitFor } from '../config/adUnits';
import { AdAudioBridge } from '../core/AdAudioBridge';
import { createRetry } from '../core/backoff';
import { withCloseTimeout } from '../core/withTimeout';
import { useAdStore } from '../core/AdState';
import { adLog } from '../log';
import type { AdPlacement } from '../types/ads.types';
import { errorCode } from './InterstitialManager';

const PLACEMENT: AdPlacement = 'app_open';

/**
 * App Open Ads — infraestrutura pronta, formato **desligado** no lançamento
 * (`app_open_enabled = false`). Antes de ligar queremos medir retenção e a receita dos outros
 * formatos; quando for a hora, basta virar a flag no Remote Config.
 *
 * Enquanto a flag estiver falsa nada é requisitado — nem um load acontece.
 */
class AppOpenManagerImpl {
  private ad: AppOpenAd | null = null;
  private unsubscribe: (() => void)[] = [];
  private loading = false;
  private closeResolver: (() => void) | null = null;
  private readonly retry = createRetry('AppOpen', () => this.preload());

  get enabled(): boolean {
    const config = getAdConfig();
    return config.adsEnabled && config.appOpenEnabled && adUnitFor(PLACEMENT) !== null;
  }

  get loaded(): boolean {
    return this.ad?.loaded === true;
  }

  preload() {
    if (!this.enabled) return;
    if (this.loading || this.loaded) return;
    const unitId = adUnitFor(PLACEMENT);
    if (!unitId) return;
    if (!useAdStore.getState().canRequestAds) return;

    this.teardown();
    this.loading = true;
    const ad = AppOpenAd.createForAdRequest(unitId);
    this.ad = ad;
    this.bind(ad);
    AdAnalytics.request(PLACEMENT);
    ad.load();
  }

  private bind(ad: AppOpenAd) {
    this.unsubscribe.push(
      ad.addAdEventListener(AdEventType.LOADED, () => {
        this.loading = false;
        this.retry.reset();
        useAdStore.getState().setAppOpenLoaded(true);
        AdAnalytics.loaded(PLACEMENT);
      }),
      ad.addAdEventListener(AdEventType.ERROR, (error) => {
        this.loading = false;
        useAdStore.getState().setAppOpenLoaded(false);
        AdAnalytics.failed(PLACEMENT, errorCode(error));
        this.retry.schedule();
      }),
      ad.addAdEventListener(AdEventType.OPENED, () => {
        AdAnalytics.opened(PLACEMENT);
        AdAnalytics.impression(PLACEMENT);
      }),
      ad.addAdEventListener(AdEventType.CLICKED, () => AdAnalytics.clicked(PLACEMENT)),
      ad.addAdEventListener(AdEventType.PAID, (payload) => {
        const paid = payload as unknown as PaidEvent | undefined;
        if (!paid) return;
        AdAnalytics.paid({
          valueMicros: paid.value * 1_000_000,
          currencyCode: paid.currency,
          precision: paid.precision,
          adUnit: ad.adUnitId,
          placement: PLACEMENT,
        });
      }),
      ad.addAdEventListener(AdEventType.CLOSED, () => {
        useAdStore.getState().setAppOpenLoaded(false);
        AdAnalytics.closed(PLACEMENT);
        this.closeResolver?.();
        this.closeResolver = null;
        this.preload();
      }),
    );
  }

  async show(): Promise<boolean> {
    const ad = this.ad;
    if (!this.enabled || !ad || !ad.loaded) return false;
    useAdStore.getState().setFullScreenShowing(true);
    AdAudioBridge.onFullScreenAdOpened();
    const closed = new Promise<void>((resolve) => {
      this.closeResolver = resolve;
    });
    try {
      await ad.show();
      await withCloseTimeout(closed, 'AppOpen');
      return true;
    } catch (e) {
      adLog('AppOpen', 'show failed', e);
      this.closeResolver = null;
      return false;
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
    useAdStore.getState().setAppOpenLoaded(false);
  }
}

export const AppOpenManager = new AppOpenManagerImpl();
