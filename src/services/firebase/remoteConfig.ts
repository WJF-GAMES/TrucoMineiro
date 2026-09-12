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
  store_enabled: true,
  daily_reward_enabled: true,
  xp_multiplier: 1,
  matchmaking_bot_fill_seconds: 20,
  matchmaking_timeout_seconds: 90,
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
