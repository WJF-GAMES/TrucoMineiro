import {
  getAnalytics,
  logEvent as rnLogEvent,
  logScreenView,
  setUserId,
  setUserProperty,
} from '@react-native-firebase/analytics';
import { firebaseApp } from './app';

const analytics = getAnalytics(firebaseApp);

/** Event taxonomy. Never log phone numbers or OTP codes. */
export type AnalyticsEvent =
  | 'app_open'
  | 'intro_viewed'
  | 'phone_login_started'
  | 'otp_sent'
  | 'login_completed'
  | 'profile_created'
  | 'home_viewed'
  | 'play_clicked'
  | 'ai_selected'
  | 'online_selected'
  | 'matchmaking_started'
  | 'matchmaking_cancelled'
  | 'room_created'
  | 'room_joined'
  | 'match_started'
  | 'card_played'
  | 'truco_requested'
  | 'truco_accepted'
  | 'truco_rejected'
  | 'match_completed'
  | 'match_won'
  | 'match_lost'
  | 'rematch_clicked'
  | 'store_viewed'
  | 'reward_claimed'
  | 'friend_request_sent';

export type AnalyticsParams = Record<string, string | number | boolean>;

export function logEvent(name: AnalyticsEvent, params?: AnalyticsParams) {
  rnLogEvent(analytics, name, params);
}

export function logScreen(screenName: string) {
  logScreenView(analytics, { screen_name: screenName, screen_class: screenName }).catch(
    () => undefined,
  );
}

export function identifyUser(uid: string | null) {
  setUserId(analytics, uid).catch(() => undefined);
}

export function setProperty(name: string, value: string) {
  setUserProperty(analytics, name, value).catch(() => undefined);
}
