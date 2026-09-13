import {
  AdsConsent,
  AdsConsentDebugGeography,
  AdsConsentPrivacyOptionsRequirementStatus,
  type AdsConsentInfo,
} from 'react-native-google-mobile-ads';
import { AdAnalytics } from '../analytics/AdAnalytics';
import { useAdStore } from '../core/AdState';
import { adLog } from '../log';
import { isProductionAdEnvironment } from '../config/environment';

/**
 * Consentimento (Google UMP).
 *
 * Nenhum anúncio é requisitado antes de `canRequestAds()` — essa é a porta de entrada do módulo.
 * A mensagem de privacidade em si é configurada no painel do AdMob; enquanto ela não existir,
 * o SDK devolve `NOT_REQUIRED` / `canRequestAds: true` fora da UE, que é o comportamento correto.
 * Nunca fabricamos consentimento aqui.
 */

/** IDs de dispositivo de teste, para forçar a geografia EEA durante o QA. */
function testDeviceIdentifiers(): string[] {
  const raw: string | undefined = process.env.EXPO_PUBLIC_ADMOB_TEST_DEVICE_IDS;
  if (!raw) return [];
  return raw
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

function debugGeography(): AdsConsentDebugGeography | undefined {
  if (isProductionAdEnvironment) return undefined;
  switch (process.env.EXPO_PUBLIC_ADMOB_DEBUG_GEOGRAPHY) {
    case 'EEA':
      return AdsConsentDebugGeography.EEA;
    case 'REGULATED_US_STATE':
      return AdsConsentDebugGeography.REGULATED_US_STATE;
    case 'OTHER':
      return AdsConsentDebugGeography.OTHER;
    default:
      return undefined;
  }
}

function apply(info: AdsConsentInfo) {
  useAdStore.getState().setConsent({
    canRequestAds: info.canRequestAds,
    status: info.status,
    privacyOptionsRequired:
      info.privacyOptionsRequirementStatus === AdsConsentPrivacyOptionsRequirementStatus.REQUIRED,
  });
  adLog('Consent', `status=${info.status} canRequestAds=${info.canRequestAds}`);
  return info;
}

export const ConsentManager = {
  /**
   * Pede a informação de consentimento e, se for necessário, apresenta o formulário.
   * Falhar aqui não pode derrubar o boot: sem consentimento resolvido, ficamos sem anúncios.
   */
  async initialize(): Promise<boolean> {
    const geography = debugGeography();
    const devices = testDeviceIdentifiers();
    try {
      const info = await AdsConsent.gatherConsent({
        ...(geography === undefined ? {} : { debugGeography: geography }),
        ...(devices.length ? { testDeviceIdentifiers: devices } : {}),
      });
      apply(info);
      AdAnalytics.consentResolved(info.status, info.canRequestAds);
      return info.canRequestAds;
    } catch (e) {
      adLog('Consent', 'gatherConsent failed', e);
      useAdStore
        .getState()
        .setConsent({ canRequestAds: false, status: 'ERROR', privacyOptionsRequired: false });
      return false;
    }
  },

  /** Releitura sem apresentar formulário (usada ao voltar do background). */
  async refreshConsentInfo(): Promise<boolean> {
    try {
      const info = await AdsConsent.getConsentInfo();
      apply(info);
      return info.canRequestAds;
    } catch {
      return useAdStore.getState().canRequestAds;
    }
  },

  canRequestAds(): boolean {
    return useAdStore.getState().canRequestAds;
  },

  consentStatus(): string {
    return useAdStore.getState().consentStatus;
  },

  /** Precisa existir um caminho visível para o usuário reabrir as opções de privacidade. */
  privacyOptionsRequired(): boolean {
    return useAdStore.getState().privacyOptionsRequired;
  },

  async showPrivacyOptions(): Promise<boolean> {
    try {
      const info = await AdsConsent.showPrivacyOptionsForm();
      apply(info);
      return true;
    } catch (e) {
      adLog('Consent', 'showPrivacyOptionsForm failed', e);
      return false;
    }
  },
};
