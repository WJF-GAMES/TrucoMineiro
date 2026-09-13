import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { radius } from '@/design-system';
import type { Country } from '@/utils/phone';

/**
 * Bandeiras desenhadas em SVG.
 *
 * Emoji de bandeira não é asset (e o Android sequer renderiza 🇧🇷: aparece "BR"),
 * então cada país vira um desenho simples — o Brasil fiel, os demais em versão
 * reduzida, legível no tamanho em que aparecem (24x17).
 */

const VB = { w: 60, h: 42 };

const FLAGS: Record<string, React.ReactNode> = {
  BR: (
    <>
      <Rect width={60} height={42} fill="#009c3b" />
      <Path d="M30 4 55 21 30 38 5 21Z" fill="#ffdf00" />
      <Circle cx={30} cy={21} r={8.5} fill="#002776" />
      <Path d="M21.8 18.2a19 19 0 0 1 16.5 4.2" stroke="#fff" strokeWidth={2.2} fill="none" />
    </>
  ),
  PT: (
    <>
      <Rect width={60} height={42} fill="#da291c" />
      <Rect width={24} height={42} fill="#046a38" />
      <Circle cx={24} cy={21} r={7.5} fill="#ffe900" stroke="#046a38" strokeWidth={1.5} />
    </>
  ),
  US: (
    <>
      <Rect width={60} height={42} fill="#fff" />
      {[0, 2, 4, 6, 8, 10, 12].map((i) => (
        <Rect key={i} y={(i * 42) / 13} width={60} height={42 / 13} fill="#b31942" />
      ))}
      <Rect width={26} height={(42 / 13) * 7} fill="#0a3161" />
    </>
  ),
  AR: (
    <>
      <Rect width={60} height={42} fill="#74acdf" />
      <Rect y={14} width={60} height={14} fill="#fff" />
      <Circle cx={30} cy={21} r={5} fill="#f6b40e" />
    </>
  ),
  UY: (
    <>
      <Rect width={60} height={42} fill="#fff" />
      {[1, 3, 5, 7].map((i) => (
        <Rect key={i} y={(i * 42) / 9} width={60} height={42 / 9} fill="#0038a8" />
      ))}
      <Rect width={26} height={(42 / 9) * 4} fill="#fff" />
      <Circle cx={13} cy={9} r={5.5} fill="#fcd116" />
    </>
  ),
  PY: (
    <>
      <Rect width={60} height={42} fill="#fff" />
      <Rect width={60} height={14} fill="#d52b1e" />
      <Rect y={28} width={60} height={14} fill="#0038a8" />
      <Circle cx={30} cy={21} r={5} fill="#fcd116" stroke="#0038a8" strokeWidth={1.2} />
    </>
  ),
};

interface Props {
  /** Objeto do seletor de país (tela de login). */
  country?: Country;
  /** Alternativa para quem só tem o código ISO vindo do backend (ranking das ligas). */
  code?: string;
  width?: number;
}

export function CountryFlag({ country, code, width = 24 }: Props) {
  const height = Math.round((width * VB.h) / VB.w);
  const iso = (country?.code ?? code ?? '').toUpperCase();
  return (
    <View style={[styles.frame, { width, height }]}>
      <Svg width={width} height={height} viewBox={`0 0 ${VB.w} ${VB.h}`}>
        {FLAGS[iso] ?? <Rect width={60} height={42} fill="#123a37" />}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    borderRadius: radius.xs / 2,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.35)',
  },
});
