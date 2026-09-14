/**
 * Single icon family for the whole app: Ionicons (rounded, filled), plus
 * MaterialCommunityIcons only for the playing-cards glyph Ionicons lacks.
 * Every UI icon must come from this map so styles stay consistent (rule: no emoji assets).
 */
import type { ComponentProps } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

export type IoniconName = ComponentProps<typeof Ionicons>['name'];
export type MciName = ComponentProps<typeof MaterialCommunityIcons>['name'];

export const icons = {
  // Bottom navigation
  tabHome: 'home' as IoniconName,
  tabHomeOutline: 'home-outline' as IoniconName,
  tabPlay: 'cards' as MciName,
  tabPlayOutline: 'cards-outline' as MciName,
  tabLeague: 'trophy' as IoniconName,
  tabLeagueOutline: 'trophy-outline' as IoniconName,
  tabFriends: 'people' as IoniconName,
  tabFriendsOutline: 'people-outline' as IoniconName,
  tabMore: 'ellipsis-horizontal' as IoniconName,

  // Generic
  chevronRight: 'chevron-forward' as IoniconName,
  chevronDown: 'chevron-down' as IoniconName,
  chevronLeft: 'chevron-back' as IoniconName,
  back: 'chevron-back' as IoniconName,
  close: 'close' as IoniconName,
  check: 'checkmark' as IoniconName,
  plus: 'add' as IoniconName,
  search: 'search' as IoniconName,
  bell: 'notifications' as IoniconName,
  info: 'information-circle-outline' as IoniconName,
  more: 'ellipsis-vertical' as IoniconName,
  share: 'share-social' as IoniconName,
  edit: 'pencil' as IoniconName,
  copy: 'copy-outline' as IoniconName,
  shield: 'shield-checkmark' as IoniconName,
  lock: 'lock-closed' as IoniconName,
  flash: 'flash' as IoniconName,
  people: 'people' as IoniconName,
  personAdd: 'person-add' as IoniconName,
  trophy: 'trophy' as IoniconName,
  gift: 'gift' as IoniconName,
  clock: 'time' as IoniconName,
  stats: 'stats-chart' as IoniconName,
  star: 'star' as IoniconName,
  bars: 'bar-chart' as IoniconName,
  wifi: 'wifi' as IoniconName,
  wifiOff: 'cloud-offline' as IoniconName,
  refresh: 'refresh' as IoniconName,
  warning: 'warning' as IoniconName,

  // More / settings
  store: 'cart' as IoniconName,
  profile: 'person' as IoniconName,
  settings: 'settings' as IoniconName,
  help: 'help-circle' as IoniconName,
  terms: 'document-text' as IoniconName,
  privacy: 'shield-half' as IoniconName,
  about: 'information-circle' as IoniconName,
  logout: 'log-out' as IoniconName,
  sound: 'volume-high' as IoniconName,
  music: 'musical-notes' as IoniconName,
  vibration: 'phone-portrait' as IoniconName,
  language: 'language' as IoniconName,
  theme: 'contrast' as IoniconName,
  trash: 'trash' as IoniconName,
  tips: 'book' as IoniconName,
  play: 'play' as IoniconName,
  eye: 'eye' as IoniconName,
  brush: 'color-wand' as IoniconName,
  history: 'time' as IoniconName,
  medal: 'medal' as IoniconName,
  phone: 'call' as IoniconName,
  keypad: 'keypad' as IoniconName,

  // Cerimônia de mesa (embaralhar / cortar / distribuir)
  shuffle: 'shuffle' as IoniconName,
  cut: 'cut' as IoniconName,
  deal: 'albums-outline' as IoniconName,
  hand: 'hand-left' as IoniconName,
  stopwatch: 'stopwatch' as IoniconName,
  checkCircle: 'checkmark-circle' as IoniconName,
  tip: 'bulb' as IoniconName,
  arrowLeft: 'arrow-back' as IoniconName,
  arrowRight: 'arrow-forward' as IoniconName,
  sync: 'sync' as IoniconName,
} as const;
