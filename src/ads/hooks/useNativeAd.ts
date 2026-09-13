import { useEffect, useRef, useState } from 'react';
import { NativeAdEventType, type NativeAd } from 'react-native-google-mobile-ads';
import { AdAnalytics } from '../analytics/AdAnalytics';
import { NativeAdManager } from '../managers/NativeAdManager';
import { useAdStore } from '../core/AdState';
import type { NativePlacement } from '../types/ads.types';

const MAX_ATTEMPTS = 4;

/**
 * Carrega um Native Ad para a tela e cuida do ciclo de vida.
 *
 * Sem anúncio, `ad` fica `null` e o componente que chama não renderiza nada — nada de espaço
 * vazio nem de spinner eterno. Ao desmontar, o anúncio e os listeners são destruídos (entrar e
 * sair da tela muitas vezes não pode vazar memória).
 */
export function useNativeAd(placement: NativePlacement) {
  const canRequestAds = useAdStore((s) => s.canRequestAds);
  const adsEnabled = useAdStore((s) => s.adsEnabled);
  const [ad, setAd] = useState<NativeAd | null>(null);
  const attempt = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let current: NativeAd | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let subscriptions: { remove: () => void }[] = [];

    const cleanup = () => {
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      subscriptions.forEach((s) => s.remove());
      subscriptions = [];
      current?.destroy();
      current = null;
    };

    const load = async () => {
      if (cancelled) return;
      if (!adsEnabled || !canRequestAds || !NativeAdManager.isEnabled(placement)) return;

      const loaded = await NativeAdManager.load(placement);
      if (cancelled) {
        loaded?.destroy();
        return;
      }
      if (!loaded) {
        attempt.current += 1;
        if (attempt.current >= MAX_ATTEMPTS) return;
        retryTimer = setTimeout(load, NativeAdManager.retryDelayMs(attempt.current - 1));
        return;
      }
      attempt.current = 0;
      current = loaded;
      subscriptions = [
        loaded.addAdEventListener(NativeAdEventType.IMPRESSION, () =>
          AdAnalytics.impression(placement),
        ),
        loaded.addAdEventListener(NativeAdEventType.CLICKED, () => AdAnalytics.clicked(placement)),
        loaded.addAdEventListener(NativeAdEventType.OPENED, () => AdAnalytics.opened(placement)),
        loaded.addAdEventListener(NativeAdEventType.CLOSED, () => AdAnalytics.closed(placement)),
        loaded.addAdEventListener(NativeAdEventType.PAID, (paid) => {
          if (!paid) return;
          AdAnalytics.paid({
            valueMicros: paid.value * 1_000_000,
            currencyCode: paid.currencyCode,
            precision: paid.precision,
            adUnit: loaded.adUnitId,
            placement,
          });
        }),
      ];
      setAd(loaded);
    };

    void load();

    return () => {
      cancelled = true;
      setAd(null);
      cleanup();
    };
  }, [adsEnabled, canRequestAds, placement]);

  return ad;
}
