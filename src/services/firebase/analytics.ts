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
  // Cango (empate de vaza). Só telemetria: a regra vive no motor.
  | 'trick_tied'
  | 'cango_tiebreak_started'
  | 'cango_tiebreak_resolved'
  | 'match_completed'
  | 'match_won'
  | 'match_lost'
  | 'rematch_clicked'
  | 'friend_request_sent'
  | 'friends_screen_viewed'
  | 'friends_search_used'
  | 'friend_request_accepted'
  | 'friend_request_declined'
  | 'friend_request_cancelled'
  | 'friend_removed'
  | 'friend_blocked'
  | 'friend_unblocked'
  | 'friend_profile_viewed'
  | 'friend_invite_shared'
  | 'room_invite_sent'
  | 'room_invite_received'
  | 'room_invite_accepted'
  | 'room_invite_declined'
  | 'game_invite_created'
  | 'game_invite_sent'
  | 'game_invite_opened'
  | 'game_invite_accepted'
  | 'game_invite_declined'
  | 'game_invite_expired'
  | 'room_ai_fill'
  | 'late_human_reclaimed_seat'
  | 'contacts_sync_started'
  | 'contacts_permission_granted'
  | 'contacts_permission_denied'
  | 'contacts_sync_completed'
  | 'contacts_sync_failed'
  | 'contact_match_found'
  | 'contact_invite_shared'
  | 'friend_qr_opened'
  | 'league_screen_viewed'
  | 'league_joined'
  | 'league_promoted'
  | 'league_relegated'
  | 'league_stayed'
  | 'league_group_rebalanced'
  | 'league_week_finalized'
  | 'league_play_now_clicked'
  // Monetização por anúncios. Nenhum destes pode carregar dado pessoal: só formato,
  // placement, tela e contadores de sessão/partidas.
  | 'ad_request'
  | 'ad_loaded'
  | 'ad_failed'
  // `ad_impression`, `ad_click`, `ad_query`, `ad_reward` e `ad_exposure` são nomes reservados
  // do Firebase Analytics (coleta automática) e seriam descartados — daí os sufixos.
  | 'ad_impression_logged'
  | 'ad_clicked'
  | 'ad_opened'
  | 'ad_closed'
  | 'ad_reward_earned'
  | 'ad_reward_declined'
  | 'ad_skipped_by_frequency'
  | 'ad_revenue_paid'
  | 'ad_consent_resolved'
  | 'rewarded_offer_shown'
  | 'rewarded_offer_accepted';

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
