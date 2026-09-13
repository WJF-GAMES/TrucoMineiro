import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Ionicons from '@expo/vector-icons/Ionicons';
import {
  colors,
  gradients,
  IoniconName,
  motion,
  radius,
  shadows,
  typography,
} from '@/design-system';
import { AppText } from './AppText';
import { haptic } from '@/utils/haptics';

interface BaseProps {
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
  icon?: IoniconName;
  iconColor?: string;
  size?: 'lg' | 'md' | 'sm';
  testID?: string;
  accessibilityLabel?: string;
}

const HEIGHTS = { lg: 56, md: 48, sm: 40 } as const;

/** Big green gradient CTA ("COMEÇAR", "CONTINUAR", "CRIAR CONTA"). */
export function PrimaryButton({
  label,
  onPress,
  disabled,
  loading,
  style,
  icon,
  iconColor,
  size = 'lg',
  testID,
  accessibilityLabel,
}: BaseProps) {
  const inactive = disabled || loading;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: inactive }}
      disabled={inactive}
      onPress={() => {
        haptic.light();
        onPress?.();
      }}
      style={({ pressed }) => [
        styles.wrap,
        { height: HEIGHTS[size] },
        shadows.button,
        pressed && { transform: [{ scale: motion.pressScale }] },
        inactive && styles.disabled,
        style,
      ]}
    >
      <LinearGradient
        colors={gradients.primaryButton}
        locations={[0, 0.55, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={[styles.gradient, { height: HEIGHTS[size] }]}
      >
        <View style={styles.shine} />
        {loading ? (
          <ActivityIndicator color={colors.text} />
        ) : (
          <View style={styles.row}>
            {icon ? (
              <Ionicons
                name={icon}
                size={size === 'sm' ? 16 : 20}
                color={iconColor ?? colors.text}
                style={styles.icon}
              />
            ) : null}
            <AppText variant={size === 'sm' ? 'buttonSmall' : 'button'} style={styles.label}>
              {label}
            </AppText>
          </View>
        )}
      </LinearGradient>
    </Pressable>
  );
}

/** Dark translucent button (e.g. "Assistir", secondary lobby actions). */
export function SecondaryButton({
  label,
  onPress,
  disabled,
  loading,
  style,
  icon,
  size = 'md',
  testID,
  accessibilityLabel,
}: BaseProps) {
  const inactive = disabled || loading;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: inactive }}
      disabled={inactive}
      onPress={() => {
        haptic.light();
        onPress?.();
      }}
      style={({ pressed }) => [
        styles.secondary,
        { height: HEIGHTS[size] },
        pressed && { transform: [{ scale: motion.pressScale }] },
        inactive && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={colors.text} />
      ) : (
        <View style={styles.row}>
          {icon ? <Ionicons name={icon} size={18} color={colors.text} style={styles.icon} /> : null}
          <AppText variant={size === 'sm' ? 'buttonSmall' : 'bodyBold'}>{label}</AppText>
        </View>
      )}
    </Pressable>
  );
}

/** Red outlined button used for "Sair da conta". */
export function DangerButton({
  label,
  onPress,
  disabled,
  loading,
  style,
  icon = 'log-out',
  testID,
}: BaseProps) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled || loading}
      onPress={() => {
        haptic.medium();
        onPress?.();
      }}
      style={({ pressed }) => [styles.danger, pressed && { opacity: 0.85 }, style]}
    >
      {loading ? (
        <ActivityIndicator color={colors.dangerSoft} />
      ) : (
        <View style={styles.row}>
          <Ionicons name={icon} size={20} color={colors.dangerSoft} style={styles.icon} />
          <AppText variant="bodyBold" color={colors.dangerSoft}>
            {label}
          </AppText>
        </View>
      )}
    </Pressable>
  );
}

/** Small pill button ("Jogar", "Convidar", "VER TODOS"). */
export function PillButton({
  label,
  onPress,
  variant = 'primary',
  style,
  disabled,
  testID,
}: {
  label: string;
  onPress?: () => void;
  variant?: 'primary' | 'muted' | 'gold';
  style?: ViewStyle;
  disabled?: boolean;
  testID?: string;
}) {
  const bg =
    variant === 'primary'
      ? gradients.primaryChip
      : variant === 'gold'
        ? ([colors.gold, '#d9a70b'] as const)
        : (['#3d5451', '#2a3d3b'] as const);
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={() => {
        haptic.selection();
        onPress?.();
      }}
      style={({ pressed }) => [
        pressed && { transform: [{ scale: motion.pressScale }] },
        disabled && styles.disabled,
        style,
      ]}
    >
      <LinearGradient colors={bg} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={styles.pill}>
        <AppText
          variant="smallBold"
          color={variant === 'gold' ? colors.textDark : colors.text}
          style={{ fontSize: 13 }}
        >
          {label}
        </AppText>
      </LinearGradient>
    </Pressable>
  );
}

/** Round icon button (bell, back, edit, more). */
export function IconButton({
  icon,
  onPress,
  size = 22,
  color = colors.cream,
  style,
  accessibilityLabel,
  testID,
  boxed = true,
}: {
  icon: IoniconName;
  onPress?: () => void;
  size?: number;
  color?: string;
  style?: ViewStyle;
  accessibilityLabel: string;
  testID?: string;
  boxed?: boolean;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={8}
      onPress={() => {
        haptic.selection();
        onPress?.();
      }}
      style={({ pressed }) => [boxed && styles.iconBox, pressed && { opacity: 0.7 }, style]}
    >
      <Ionicons name={icon} size={size} color={color} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: radius.button, overflow: 'hidden' },
  gradient: {
    borderRadius: radius.button,
    alignItems: 'center',
    justifyContent: 'center',
    // Respiro igual ao do SecondaryButton: sem isso o texto encosta na borda sempre que o botão
    // é dimensionado pelo conteúdo, em vez de ocupar a largura toda.
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: 'rgba(120,255,190,0.45)',
  },
  shine: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '48%',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  icon: { marginRight: 8 },
  label: { textTransform: 'uppercase' },
  disabled: { opacity: 0.55 },
  secondary: {
    borderRadius: radius.button,
    backgroundColor: 'rgba(30, 70, 66, 0.9)',
    borderWidth: 1,
    borderColor: colors.cardBorderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  danger: {
    height: 52,
    borderRadius: radius.button,
    backgroundColor: colors.dangerBg,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pill: {
    height: 36,
    paddingHorizontal: 18,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(120,255,190,0.35)',
  },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export const buttonTypography = typography.button;
