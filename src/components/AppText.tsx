import React from 'react';
import { StyleSheet, Text, TextProps } from 'react-native';
import { colors, typography, TypographyToken } from '@/design-system';

interface Props extends TextProps {
  variant?: TypographyToken;
  color?: string;
  center?: boolean;
}

export function AppText({ variant = 'body', color, center, style, children, ...rest }: Props) {
  return (
    <Text
      {...rest}
      style={[typography[variant], { color: color ?? colors.text }, center && styles.center, style]}
    >
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({ center: { textAlign: 'center' } });
