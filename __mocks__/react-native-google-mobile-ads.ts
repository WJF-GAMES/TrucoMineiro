/* eslint-disable @typescript-eslint/no-require-imports --
 * Mock de módulo do Jest: precisa de `require` para não carregar o SDK nativo real.
 */
/**
 * Mock do Google Mobile Ads para os testes.
 *
 * O SDK real resolve para `src/index.ts` sob o preset `jest-expo` e toca módulos nativos logo no
 * import, então o mock oficial da biblioteca (pensado para os testes dela própria) não serve aqui.
 * Este mock cobre exatamente a superfície que o app usa.
 *
 * Os `TestIds` vêm do arquivo real da biblioteca: assim os testes de configuração continuam
 * verificando os IDs oficiais do Google, e não uma cópia nossa que poderia envelhecer.
 */
import * as React from 'react';
import { View } from 'react-native';

export const { TestIds } = require('react-native-google-mobile-ads/lib/commonjs/TestIds');

export enum AdEventType {
  LOADED = 'loaded',
  ERROR = 'error',
  OPENED = 'opened',
  PAID = 'paid',
  CLICKED = 'clicked',
  CLOSED = 'closed',
}

export enum RewardedAdEventType {
  LOADED = 'rewarded_loaded',
  EARNED_REWARD = 'rewarded_earned_reward',
}

export enum NativeAdEventType {
  IMPRESSION = 'impression',
  CLICKED = 'clicked',
  OPENED = 'opened',
  CLOSED = 'closed',
  PAID = 'paid',
}

export enum MaxAdContentRating {
  G = 'G',
  PG = 'PG',
  T = 'T',
  MA = 'MA',
}

export enum RevenuePrecisions {
  UNKNOWN = 0,
  ESTIMATED = 1,
  PUBLISHER_PROVIDED = 2,
  PRECISE = 3,
}

export enum NativeMediaAspectRatio {
  ANY = 1,
  LANDSCAPE = 2,
  PORTRAIT = 3,
  SQUARE = 4,
}

export enum NativeAdChoicesPlacement {
  TOP_LEFT = 0,
  TOP_RIGHT = 1,
  BOTTOM_RIGHT = 2,
  BOTTOM_LEFT = 3,
}

export enum AdsConsentStatus {
  UNKNOWN = 'UNKNOWN',
  REQUIRED = 'REQUIRED',
  NOT_REQUIRED = 'NOT_REQUIRED',
  OBTAINED = 'OBTAINED',
}

export enum AdsConsentPrivacyOptionsRequirementStatus {
  UNKNOWN = 'UNKNOWN',
  REQUIRED = 'REQUIRED',
  NOT_REQUIRED = 'NOT_REQUIRED',
}

export enum AdsConsentDebugGeography {
  DISABLED = 0,
  EEA = 1,
  NOT_EEA = 2,
  REGULATED_US_STATE = 3,
  OTHER = 4,
}

const consentInfo = {
  status: AdsConsentStatus.NOT_REQUIRED,
  canRequestAds: true,
  privacyOptionsRequirementStatus: AdsConsentPrivacyOptionsRequirementStatus.NOT_REQUIRED,
  isConsentFormAvailable: false,
};

export const AdsConsent = {
  gatherConsent: jest.fn(async () => consentInfo),
  requestInfoUpdate: jest.fn(async () => consentInfo),
  getConsentInfo: jest.fn(async () => consentInfo),
  showForm: jest.fn(async () => consentInfo),
  showPrivacyOptionsForm: jest.fn(async () => consentInfo),
  loadAndShowConsentFormIfRequired: jest.fn(async () => consentInfo),
};

/**
 * Base dos anúncios full-screen: nunca carrega sozinho, para o teste controlar o estado.
 * `createForAdRequest` é um `jest.fn` em cada classe, para o teste poder devolver o próprio dublê.
 */
class FakeFullScreenAd {
  loaded = false;
  constructor(public adUnitId: string) {}
  load = jest.fn();
  show = jest.fn(async () => undefined);
  addAdEventListener = jest.fn(() => () => undefined);
  addAdEventsListener = jest.fn(() => () => undefined);
  removeAllListeners = jest.fn();
}

export class InterstitialAd extends FakeFullScreenAd {
  static createForAdRequest = jest.fn((adUnitId: string) => new InterstitialAd(adUnitId));
}
export class RewardedAd extends FakeFullScreenAd {
  static createForAdRequest = jest.fn((adUnitId: string) => new RewardedAd(adUnitId));
}
export class RewardedInterstitialAd extends FakeFullScreenAd {
  static createForAdRequest = jest.fn((adUnitId: string) => new RewardedInterstitialAd(adUnitId));
}
export class AppOpenAd extends FakeFullScreenAd {
  static createForAdRequest = jest.fn((adUnitId: string) => new AppOpenAd(adUnitId));
}

export class NativeAd {
  adUnitId = 'test-native';
  responseId = 'test-response';
  advertiser: string | null = 'Anunciante';
  body = 'Corpo do anúncio';
  callToAction = 'Instalar';
  headline = 'Título do anúncio';
  price: string | null = null;
  store: string | null = null;
  starRating: number | null = null;
  icon: { url: string; scale: number } | null = null;
  images: { url: string; scale: number }[] | null = null;
  mediaContent = { aspectRatio: 1.91, hasVideoContent: false, duration: 0 };
  extras: Record<string, unknown> | null = null;

  static createForAdRequest = jest.fn(async () => new NativeAd());
  addAdEventListener = jest.fn(() => ({ remove: jest.fn() }));
  removeAllAdEventListeners = jest.fn();
  destroy = jest.fn();
}

export enum NativeAssetType {
  ADVERTISER = 'advertiser',
  BODY = 'body',
  CALL_TO_ACTION = 'callToAction',
  HEADLINE = 'headline',
  PRICE = 'price',
  STORE = 'store',
  STAR_RATING = 'starRating',
  ICON = 'icon',
  IMAGE = 'image',
}

export const NativeAdView = ({ children, ...props }: { children?: React.ReactNode }) =>
  React.createElement(View, props, children);
export const NativeMediaView = (props: object) => React.createElement(View, props);
export const NativeAsset = ({ children }: { children: React.ReactElement }) => children;
export const BannerAd = (props: object) => React.createElement(View, props);

const mobileAdsModule = {
  initialize: jest.fn(async () => []),
  setRequestConfiguration: jest.fn(async () => undefined),
  openAdInspector: jest.fn(async () => undefined),
  openDebugMenu: jest.fn(),
  setAppVolume: jest.fn(),
  setAppMuted: jest.fn(),
};

export const MobileAds = jest.fn(() => mobileAdsModule);
export default MobileAds;
