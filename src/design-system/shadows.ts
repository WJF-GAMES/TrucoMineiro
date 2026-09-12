import { Platform, ViewStyle } from 'react-native';

const make = (opacity: number, radius: number, y: number, color = '#000'): ViewStyle =>
  Platform.select<ViewStyle>({
    ios: {
      shadowColor: color,
      shadowOpacity: opacity,
      shadowRadius: radius,
      shadowOffset: { width: 0, height: y },
    },
    android: { elevation: Math.round(radius / 2) },
    default: {},
  }) ?? {};

export const shadows = {
  card: make(0.35, 10, 4),
  button: make(0.45, 12, 6, '#00994d'),
  glowGreen: make(0.6, 14, 0, '#05c875'),
  header: make(0.3, 6, 2),
} as const;
