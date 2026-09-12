import { TextStyle } from 'react-native';

/**
 * The reference uses a rounded geometric sans with bold headings.
 * We ship Nunito (closest open font) and a brush script for the promo tagline.
 */
export const fontFamily = {
  regular: 'Nunito_400Regular',
  medium: 'Nunito_500Medium',
  semibold: 'Nunito_600SemiBold',
  bold: 'Nunito_700Bold',
  extrabold: 'Nunito_800ExtraBold',
  black: 'Nunito_900Black',
  script: 'KaushanScript_400Regular',
} as const;

const base = (size: number, family: string, lineHeight?: number): TextStyle => ({
  fontSize: size,
  fontFamily: family,
  lineHeight: lineHeight ?? Math.round(size * 1.25),
  color: '#ffffff',
});

export const typography = {
  display: base(28, fontFamily.extrabold, 34), // "Bem-vindo de volta!", "Quase la!"
  h1: base(22, fontFamily.extrabold, 28), // screen titles ("Amigos", "Mais")
  h2: base(19, fontFamily.extrabold, 24), // "Escolha como jogar", "Liga Bronze"
  h3: base(16, fontFamily.bold, 21), // card titles, list titles
  body: base(14, fontFamily.medium, 19),
  bodyBold: base(14, fontFamily.bold, 19),
  small: base(12, fontFamily.medium, 16),
  smallBold: base(12, fontFamily.bold, 16),
  caption: base(10.5, fontFamily.semibold, 14),
  button: { ...base(16, fontFamily.extrabold, 20), letterSpacing: 0.6 },
  buttonSmall: { ...base(13, fontFamily.extrabold, 17), letterSpacing: 0.4 },
  stat: base(22, fontFamily.extrabold, 26),
  tab: base(11, fontFamily.semibold, 14),
  script: base(30, fontFamily.script, 36),
} as const;

export type TypographyToken = keyof typeof typography;
