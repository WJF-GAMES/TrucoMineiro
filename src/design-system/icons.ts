/**
 * Single icon family for the whole app: Ionicons (rounded, filled), plus
 * MaterialCommunityIcons only for the playing-cards glyph Ionicons lacks.
 * Every UI icon must come from this map so styles stay consistent (rule: no emoji assets).
 */
import type { ComponentProps } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import createIconSet from '@expo/vector-icons/createIconSet';

export type IoniconName = ComponentProps<typeof Ionicons>['name'];

/**
 * Glifos de cartas do MaterialCommunityIcons (mesmos codepoints do pacote). Importar
 * `@expo/vector-icons/MaterialCommunityIcons` empacotaria a fonte inteira (1,3 MB) e o glyphmap de
 * 7 mil ícones por causa de dois glifos; `assets/fonts/mci-cards.ttf` é um subconjunto só com eles
 * (984 bytes), gerado com o fontTools:
 *   pyftsubset <node_modules/@expo/vector-icons>/build/vendor/react-native-vector-icons/Fonts/MaterialCommunityIcons.ttf
 *     --unicodes=U+F0638,U+F0639 --layout-features='' --notdef-outline --output-file=assets/fonts/mci-cards.ttf
 * Para outro glifo do MCI: incluir o codepoint aqui e no comando acima.
 */
const MCI_CARDS_GLYPHS = {
  cards: 0xf0638,
  'cards-outline': 0xf0639,
} as const;

export const CardsIcon = createIconSet(
  MCI_CARDS_GLYPHS,
  'mci-cards',
  require('../../assets/fonts/mci-cards.ttf'),
);
export type MciName = keyof typeof MCI_CARDS_GLYPHS;

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
  chevronUp: 'chevron-up' as IoniconName,
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
  alert: 'alert-circle' as IoniconName,
  helpOutline: 'help-circle-outline' as IoniconName,
  clockOutline: 'time-outline' as IoniconName,
  arrowUp: 'arrow-up' as IoniconName,
  arrowDown: 'arrow-down' as IoniconName,
  leader: 'ribbon' as IoniconName, // faixa do líder do ranking
  gameController: 'game-controller' as IoniconName,
  playCircle: 'play-circle' as IoniconName,
  tipOutline: 'bulb-outline' as IoniconName,
  sad: 'sad' as IoniconName,
  qrCode: 'qr-code' as IoniconName,
  ban: 'ban' as IoniconName,
  megaphone: 'megaphone' as IoniconName,
  mailOpen: 'mail-open' as IoniconName,
  bellOff: 'notifications-off' as IoniconName,
  hourglass: 'hourglass' as IoniconName,
  leaf: 'leaf' as IoniconName,
  flame: 'flame' as IoniconName,
  skull: 'skull' as IoniconName,
  /** Jogar carta virada ("no escuro"). */
  coveredCard: 'eye-off' as IoniconName,

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
  checkboxOn: 'checkbox' as IoniconName,
  checkboxOff: 'square-outline' as IoniconName,
  robot: 'hardware-chip' as IoniconName,
  tip: 'bulb' as IoniconName,
  arrowLeft: 'arrow-back' as IoniconName,
  arrowRight: 'arrow-forward' as IoniconName,
  sync: 'sync' as IoniconName,
} as const;
