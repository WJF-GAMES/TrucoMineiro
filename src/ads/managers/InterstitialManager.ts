import { AdEventType, InterstitialAd, type PaidEvent } from 'react-native-google-mobile-ads';
import { AdAnalytics } from '../analytics/AdAnalytics';
import { adUnitFor } from '../config/adUnits';
import { AdAudioBridge } from '../core/AdAudioBridge';
import { createRetry } from '../core/backoff';
import { withCloseTimeout } from '../core/withTimeout';
import { useAdStore } from '../core/AdState';
import { adLog } from '../log';
import type { AdPlacement } from '../types/ads.types';

const PLACEMENT: AdPlacement = 'match_result_interstitial';

/**
 * Interstitial do fim de partida — o único ponto de anúncio automático do app.
 *
 * O carregamento acontece muito antes de ser necessário (Home/entrada da partida), para que no
 * fim do jogo o anúncio já esteja pronto. Se não estiver, o `AdService` pula: nunca esperamos.
 */
class InterstitialManagerImpl {
  private ad: InterstitialAd | null = null;
  private unsubscribe: (() => void)[] = [];
  private loading = false;
  private requestedAt = 0;
  private closeResolver: (() => void) | null = null;
  private readonly retry = createRetry('Interstitial', () => this.preload());

  get loaded(): boolean {
    return this.ad?.loaded === true;
  }

  preload() {
    if (this.loading || this.loaded) return;
    const unitId = adUnitFor(PLACEMENT);
    if (!unitId) {
      adLog('Interstitial', 'sem ad unit configurada — formato desativado');
      return;
    }
    if (!useAdStore.getState().canRequestAds) {
      adLog('Interstitial', 'preload adiado: consentimento pendente');
      return;
    }

    this.teardown();
    this.loading = true;
    this.requestedAt = Date.now();
    const ad = InterstitialAd.createForAdRequest(unitId);
    this.ad = ad;
    this.bind(ad);
    AdAnalytics.request(PLACEMENT);
    adLog('Interstitial', 'load');
    ad.load();
  }

  private bind(ad: InterstitialAd) {
    this.unsubscribe.push(
      ad.addAdEventListener(AdEventType.LOADED, () => {
        this.loading = false;
        this.retry.reset();
        useAdStore.getState().setInterstitialLoaded(true);
        AdAnalytics.loaded(PLACEMENT, Date.now() - this.requestedAt);
        adLog('Interstitial', 'loaded');
      }),
      ad.addAdEventListener(AdEventType.ERROR, (error) => {
        this.loading = false;
        useAdStore.getState().setInterstitialLoaded(false);
        AdAnalytics.failed(PLACEMENT, errorCode(error));
        adLog('Interstitial', `error: ${errorCode(error)}`);
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
        useAdStore.getState().setInterstitialLoaded(false);
        AdAnalytics.closed(PLACEMENT);
        adLog('Interstitial', 'closed');
        this.closeResolver?.();
        this.closeResolver = null;
        // Um interstitial só serve uma vez: já deixa o próximo a caminho.
        this.preload();
      }),
    );
  }

  /**
   * Exibe o anúncio já carregado. Resolve quando o usuário volta ao app.
   * A decisão de *poder* exibir é do `AdService`; aqui só cuidamos do SDK.
   */
  async show(): Promise<boolean> {
    const ad = this.ad;
    if (!ad || !ad.loaded) return false;
    const store = useAdStore.getState();
    store.setFullScreenShowing(true);
    AdAudioBridge.onFullScreenAdOpened();
    const closed = new Promise<void>((resolve) => {
      this.closeResolver = resolve;
    });
    try {
      await ad.show();
      await withCloseTimeout(closed, 'Interstitial');
      return true;
    } catch (e) {
      adLog('Interstitial', 'show failed', e);
      this.closeResolver = null;
      return false;
    } finally {
      useAdStore.getState().setFullScreenShowing(false);
      AdAudioBridge.onFullScreenAdClosed();
    }
  }

  /** Kill switch / logout: solta listeners e o anúncio carregado. */
  teardown() {
    this.retry.cancel();
    this.unsubscribe.forEach((u) => u());
    this.unsubscribe = [];
    this.ad?.removeAllListeners();
    this.ad = null;
    this.loading = false;
    this.closeResolver = null;
    useAdStore.getState().setInterstitialLoaded(false);
  }
}

export function errorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error)
    return String((error as { code: unknown }).code);
  if (error instanceof Error) return error.message.slice(0, 80);
  return 'unknown';
}

export const InterstitialManager = new InterstitialManagerImpl();
