import { fetchAndActivate, getRemoteConfig, getValue } from '@react-native-firebase/remote-config';
import { firebaseApp } from './app';

export const remoteConfigDefaults = {
  maintenance_mode: false,
  minimum_supported_version: '1.0.0',
  ai_easy_enabled: true,
  ai_normal_enabled: true,
  ai_hard_enabled: true,
  online_enabled: true,
  matchmaking_enabled: true,
  friends_enabled: true,
  league_enabled: true,
  xp_multiplier: 1,
  matchmaking_bot_fill_seconds: 20,
  matchmaking_timeout_seconds: 90,

  // Monetização por anúncios. Os defaults abaixo valem offline e antes do primeiro fetch;
  // a documentação de cada um está em docs/ADMOB_MONETIZATION.md.
  ads_enabled: true,
  interstitial_enabled: true,
  rewarded_enabled: true,
  native_enabled: true,
  app_open_enabled: false,
  interstitial_min_matches_before_first: 2,
  interstitial_every_n_matches: 3,
  interstitial_cooldown_seconds: 180,
  interstitial_max_per_session: 4,
  interstitial_max_per_day: 8,
  full_screen_global_cooldown_seconds: 180,
  minimum_session_seconds_before_interstitial: 180,
  native_home_enabled: true,
  native_league_enabled: true,
  native_friends_enabled: true,
  native_profile_enabled: false,
  rewarded_analysis_enabled: true,
  rewarded_tip_enabled: true,
  app_open_min_session_number: 4,
  app_open_min_background_seconds: 21600,
} as const;

export type RemoteFlag = keyof typeof remoteConfigDefaults;

const rc = getRemoteConfig(firebaseApp);

let initialized: Promise<void> | null = null;

export function initRemoteConfig(): Promise<void> {
  if (!initialized) {
    initialized = (async () => {
      rc.settings = {
        minimumFetchIntervalMillis: __DEV__ ? 0 : 15 * 60 * 1000,
        fetchTimeoutMillis: 10_000,
      };
      rc.defaultConfig = remoteConfigDefaults as unknown as typeof rc.defaultConfig;
      try {
        await fetchAndActivate(rc);
      } catch {
        // Offline or not configured yet: defaults stay in effect.
      }
    })();
  }
  return initialized;
}

export function flag<K extends RemoteFlag>(key: K): (typeof remoteConfigDefaults)[K] {
  const v = getValue(rc, key);
  const def = remoteConfigDefaults[key];
  if (typeof def === 'boolean') return v.asBoolean() as (typeof remoteConfigDefaults)[K];
  if (typeof def === 'number') return v.asNumber() as (typeof remoteConfigDefaults)[K];
  return v.asString() as (typeof remoteConfigDefaults)[K];
}
