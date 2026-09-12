/**
 * Palette sampled from referencia.png (source of visual truth).
 * Deep emerald backgrounds, translucent teal cards, vivid green CTAs, gold/red accents.
 */
export const colors = {
  // Backgrounds (top to bottom vertical gradient on every screen)
  bgTop: '#00221a',
  bgMid: '#072d27',
  bgBottom: '#0b302e',
  bgDeep: '#001713', // tab bar / deepest surface

  // Surfaces
  card: 'rgba(20, 62, 59, 0.72)',
  cardSolid: '#123a37',
  cardMuted: 'rgba(15, 55, 52, 0.85)',
  cardBorder: 'rgba(120, 200, 170, 0.22)',
  cardBorderStrong: 'rgba(120, 220, 180, 0.38)',
  input: 'rgba(4, 21, 23, 0.85)',
  inputBorder: 'rgba(120, 200, 170, 0.30)',
  overlay: 'rgba(0, 20, 14, 0.55)',
  divider: 'rgba(120, 200, 170, 0.14)',

  // Brand greens
  primary: '#05c875',
  primaryBright: '#1ee38c',
  primaryDark: '#03a25e',
  primaryDeep: '#006330',
  primaryGlow: 'rgba(5, 200, 117, 0.35)',
  success: '#00da77',

  // Accents
  gold: '#edbe0f',
  goldDeep: '#e17804',
  danger: '#f00d17',
  dangerSoft: '#ff4d57',
  dangerBg: 'rgba(90, 20, 30, 0.55)',
  dangerBorder: 'rgba(200, 60, 60, 0.55)',
  blue: '#025bb3',
  blueDeep: '#023f80',
  orange: '#be6824',
  orangeDeep: '#7a3a12',
  gem: '#1ed67c',
  bronze: '#c8783a',
  silver: '#b9c2c9',
  online: '#22e07a',
  away: '#f3c11b',
  offline: '#8a9a96',

  // Text
  text: '#ffffff',
  textSecondary: '#cfe3dc',
  textMuted: '#8fb1a6',
  textOnPrimary: '#ffffff',
  textDark: '#02100d',
  cream: '#f3e9d6', // icon tint used on menu items / tab bar (inactive)
  tabInactive: '#e6ede9',
} as const;

export type ColorToken = keyof typeof colors;

export const gradients = {
  screen: [colors.bgTop, colors.bgMid, colors.bgBottom] as const,
  primaryButton: ['#1fd98a', '#05b96a', '#04834a'] as const,
  primaryChip: ['#1fd98a', '#059c5a'] as const,
  quickPlay: ['#0a6a3c', '#054a2c'] as const,
  modeIa: ['#0f6fd1', '#023f80'] as const,
  modeOnline: ['#c9722a', '#6b2f0f'] as const,
  storeBanner: ['#4b2a6b', '#7a2e3a'] as const,
  card: ['rgba(26, 74, 70, 0.85)', 'rgba(9, 40, 38, 0.85)'] as const,
  fadeToBottom: ['rgba(0,34,26,0)', 'rgba(0,34,26,0.85)', '#00221a'] as const,
  table: ['#0d4a3a', '#063326', '#02201a'] as const,
} as const;
