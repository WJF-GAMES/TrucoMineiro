/**
 * Monetização por anúncios (Google Mobile Ads).
 *
 * Ponto único de entrada: telas importam daqui, nunca do SDK diretamente.
 * Arquitetura e políticas em `docs/ADMOB_MONETIZATION.md`.
 */
export { AdService } from './core/AdService';
export { useAdStore } from './core/AdState';
export { AdPlacementManager } from './core/AdPlacementManager';
export { ConsentManager } from './privacy/ConsentManager';
export { TrackingManager, setTrackingProvider } from './privacy/TrackingManager';
export { AdAudioBridge, registerAudioSink } from './core/AdAudioBridge';
export { getAdConfig, AD_CONFIG_DEFAULTS } from './config/adConfig';
export { adEnvironment, usingTestAds } from './config/environment';

export {
  useAds,
  useGameSessionGuard,
  useMatchmakingGuard,
  usePreloadInterstitial,
  usePreloadRewarded,
} from './hooks/useAds';
export { useRewardedAd } from './hooks/useRewardedAd';
export { useNativeAd } from './hooks/useNativeAd';

export { NativeAdCard } from './components/NativeAdCard';
export { SponsoredContentCard } from './components/SponsoredContentCard';
export { SponsoredBadge } from './components/SponsoredBadge';
export { RewardedGate } from './components/RewardedGate';
export { AdsDebugPanel } from './components/AdsDebugPanel';

export type {
  AdConfig,
  AdEnvironment,
  AdFormat,
  AdPlacement,
  NativePlacement,
  RewardedPlacement,
  RewardedResult,
} from './types/ads.types';
