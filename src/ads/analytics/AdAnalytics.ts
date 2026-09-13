import { logEvent, type AnalyticsParams } from '@/services/firebase/analytics';
import { PLACEMENT_FORMAT, PLACEMENT_SCREEN } from '../config/adUnits';
import { useAdStore } from '../core/AdState';
import { adLog } from '../log';
import type { AdPaidEvent, AdPlacement } from '../types/ads.types';

/**
 * Telemetria de anúncios.
 *
 * Toda métrica sai carimbada com `format`, `placement` e `screen` — é isso que vai permitir,
 * mais para frente, saber qual placement realmente gera receita. Nenhum evento pode conter
 * telefone, nome, e-mail, contatos ou qualquer conteúdo do usuário.
 */

function baseParams(placement: AdPlacement, extra?: AnalyticsParams): AnalyticsParams {
  const { frequency } = useAdStore.getState();
  return {
    format: PLACEMENT_FORMAT[placement],
    placement,
    screen: PLACEMENT_SCREEN[placement],
    session_number: frequency.sessionNumber,
    matches_completed: frequency.matchesCompleted,
    ...extra,
  };
}

export const AdAnalytics = {
  request(placement: AdPlacement) {
    logEvent('ad_request', baseParams(placement));
  },
  loaded(placement: AdPlacement, loadMs?: number) {
    logEvent('ad_loaded', baseParams(placement, loadMs === undefined ? undefined : { load_ms: loadMs }));
  },
  failed(placement: AdPlacement, code: string) {
    logEvent('ad_failed', baseParams(placement, { error_code: code }));
  },
  /** `ad_impression` é nome reservado do Firebase; o nosso evento vai com sufixo. */
  impression(placement: AdPlacement) {
    logEvent('ad_impression_logged', baseParams(placement));
  },
  clicked(placement: AdPlacement) {
    logEvent('ad_clicked', baseParams(placement));
  },
  opened(placement: AdPlacement) {
    logEvent('ad_opened', baseParams(placement));
  },
  closed(placement: AdPlacement) {
    logEvent('ad_closed', baseParams(placement));
  },
  rewardEarned(placement: AdPlacement, rewardType: string, amount: number) {
    logEvent('ad_reward_earned', baseParams(placement, { reward_type: rewardType, reward_amount: amount }));
  },
  rewardDeclined(placement: AdPlacement, reason: string) {
    logEvent('ad_reward_declined', baseParams(placement, { reason }));
  },
  skipped(placement: AdPlacement, reason: string) {
    adLog(placement, `skipped: ${reason}`);
    logEvent('ad_skipped_by_frequency', baseParams(placement, { reason }));
  },
  offerShown(placement: AdPlacement, cta: string) {
    logEvent('rewarded_offer_shown', baseParams(placement, { cta }));
  },
  offerAccepted(placement: AdPlacement, cta: string) {
    logEvent('rewarded_offer_accepted', baseParams(placement, { cta }));
  },
  consentResolved(status: string, canRequestAds: boolean) {
    logEvent('ad_consent_resolved', { status, can_request_ads: canRequestAds });
  },
  /**
   * Evento de receita por impressão. Com ele dá para calcular ARPDAU/ARPU reais por placement
   * assim que o recurso for ligado no painel do AdMob (hoje só chega com anúncio real).
   */
  paid(event: AdPaidEvent) {
    logEvent(
      'ad_revenue_paid',
      baseParams(event.placement, {
        value_micros: Math.round(event.valueMicros),
        currency_code: event.currencyCode,
        precision: event.precision,
        ad_unit: event.adUnit,
        ...(event.network ? { network: event.network } : {}),
      }),
    );
  },
};
