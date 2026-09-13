/**
 * Stub do `react-native-google-mobile-ads` para a build web.
 *
 * O SDK é um wrapper de código nativo (chega a importar `codegenNativeComponent`), então o
 * bundle web quebra só de encostar nele. O Metro redireciona o import para este arquivo quando
 * `platform === 'web'` (ver metro.config.js) — mesmo padrão já usado para `@react-native-firebase/*`.
 *
 * Na web não existe anúncio: tudo aqui é neutro e silencioso, para as telas subirem exatamente
 * como sobem quando um anúncio não carrega no aparelho. Nada disto roda em Android/iOS.
 */

const noop = () => undefined;
const unsubscribe = () => noop;

/** Sem Ad Unit resolvida, `adUnitFor` já devolveria null — mas a web nem chega a requisitar. */
export const TestIds = {
  APP_OPEN: '',
  ADAPTIVE_BANNER: '',
  BANNER: '',
  INTERSTITIAL: '',
  REWARDED: '',
  REWARDED_INTERSTITIAL: '',
  NATIVE: '',
  NATIVE_VIDEO: '',
};

export const AdEventType = {
  LOADED: 'loaded',
  ERROR: 'error',
  OPENED: 'opened',
  PAID: 'paid',
  CLICKED: 'clicked',
  CLOSED: 'closed',
};

export const RewardedAdEventType = {
  LOADED: 'rewarded_loaded',
  EARNED_REWARD: 'rewarded_earned_reward',
};

export const NativeAdEventType = {
  IMPRESSION: 'impression',
  CLICKED: 'clicked',
  OPENED: 'opened',
  CLOSED: 'closed',
  PAID: 'paid',
};

export const MaxAdContentRating = { G: 'G', PG: 'PG', T: 'T', MA: 'MA' };
export const RevenuePrecisions = { UNKNOWN: 0, ESTIMATED: 1, PUBLISHER_PROVIDED: 2, PRECISE: 3 };
export const NativeMediaAspectRatio = { ANY: 1, LANDSCAPE: 2, PORTRAIT: 3, SQUARE: 4 };
export const NativeAdChoicesPlacement = {
  TOP_LEFT: 0,
  TOP_RIGHT: 1,
  BOTTOM_RIGHT: 2,
  BOTTOM_LEFT: 3,
};
export const NativeAssetType = {
  ADVERTISER: 'advertiser',
  BODY: 'body',
  CALL_TO_ACTION: 'callToAction',
  HEADLINE: 'headline',
  PRICE: 'price',
  STORE: 'store',
  STAR_RATING: 'starRating',
  ICON: 'icon',
  IMAGE: 'image',
};

export const AdsConsentStatus = {
  UNKNOWN: 'UNKNOWN',
  REQUIRED: 'REQUIRED',
  NOT_REQUIRED: 'NOT_REQUIRED',
  OBTAINED: 'OBTAINED',
};
export const AdsConsentPrivacyOptionsRequirementStatus = {
  UNKNOWN: 'UNKNOWN',
  REQUIRED: 'REQUIRED',
  NOT_REQUIRED: 'NOT_REQUIRED',
};
export const AdsConsentDebugGeography = {
  DISABLED: 0,
  EEA: 1,
  NOT_EEA: 2,
  REGULATED_US_STATE: 3,
  OTHER: 4,
};

/** `canRequestAds: false` deixa todo o módulo de anúncios quieto na web. */
const consentInfo = {
  status: AdsConsentStatus.UNKNOWN,
  canRequestAds: false,
  privacyOptionsRequirementStatus: AdsConsentPrivacyOptionsRequirementStatus.NOT_REQUIRED,
  isConsentFormAvailable: false,
};

export const AdsConsent = {
  gatherConsent: async () => consentInfo,
  requestInfoUpdate: async () => consentInfo,
  getConsentInfo: async () => consentInfo,
  showForm: async () => consentInfo,
  showPrivacyOptionsForm: async () => consentInfo,
  loadAndShowConsentFormIfRequired: async () => consentInfo,
};

/** Anúncio que nunca carrega: os managers tratam isso como "pular", que é o comportamento certo. */
class NeverLoads {
  constructor(adUnitId) {
    this.adUnitId = adUnitId;
    this.loaded = false;
  }
  static createForAdRequest(adUnitId) {
    return new this(adUnitId);
  }
  load() {}
  async show() {}
  addAdEventListener() {
    return noop;
  }
  addAdEventsListener() {
    return noop;
  }
  removeAllListeners() {}
}

export class InterstitialAd extends NeverLoads {}
export class RewardedAd extends NeverLoads {}
export class RewardedInterstitialAd extends NeverLoads {}
export class AppOpenAd extends NeverLoads {}
export class GAMInterstitialAd extends NeverLoads {}

export const NativeAd = {
  createForAdRequest: async () => {
    throw new Error('[web] Native Ads não existem na build web.');
  },
};

export const NativeAdView = () => null;
export const NativeMediaView = () => null;
export const NativeAsset = () => null;
export const BannerAd = () => null;
export const GAMBannerAd = () => null;

export const useAppOpenAd = () => ({});
export const useInterstitialAd = () => ({});
export const useRewardedAd = () => ({});
export const useRewardedInterstitialAd = () => ({});
export const useForeground = unsubscribe;

const mobileAdsModule = {
  initialize: async () => [],
  setRequestConfiguration: async () => undefined,
  openAdInspector: async () => undefined,
  openDebugMenu: noop,
  setAppVolume: noop,
  setAppMuted: noop,
};

export const MobileAds = () => mobileAdsModule;
export default MobileAds;
