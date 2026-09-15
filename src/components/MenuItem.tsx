import React, { PropsWithChildren } from 'react';
import { Pressable, StyleSheet, Switch, View, ViewStyle } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, icons, IoniconName, radius, spacing } from '@/design-system';
import { AppText } from './AppText';
import { Surface } from './Surface';
import { haptic } from '@/utils/haptics';

interface MenuItemProps {
  icon: IoniconName;
  iconColor?: string;
  title: string;
  subtitle?: string;
  value?: string;
  onPress?: () => void;
  danger?: boolean;
  toggle?: boolean;
  onToggle?: (v: boolean) => void;
  trailing?: React.ReactNode;
  last?: boolean;
  testID?: string;
}

/** Row with cream icon on the left, title/subtitle and chevron/value/switch on the right. */
export function MenuItem({
  icon,
  iconColor,
  title,
  subtitle,
  value,
  onPress,
  danger,
  toggle,
  onToggle,
  trailing,
  last,
  testID,
}: MenuItemProps) {
  const color = danger ? colors.dangerSoft : colors.text;
  const content = (
    <View style={[styles.row, !last && styles.divider]}>
      <View style={styles.iconBox}>
        <Ionicons
          name={icon}
          size={24}
          color={iconColor ?? (danger ? colors.dangerSoft : colors.cream)}
        />
      </View>
      <View style={styles.texts}>
        <AppText variant="h3" color={color} style={{ fontSize: 15.5 }}>
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="small" color={colors.textSecondary}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {trailing}
      {value ? (
        <AppText variant="body" color={colors.textSecondary} style={styles.value}>
          {value}
        </AppText>
      ) : null}
      {toggle !== undefined ? (
        <Switch
          value={toggle}
          onValueChange={(v) => {
            haptic.selection();
            onToggle?.(v);
          }}
          trackColor={{ false: colors.switchTrack, true: colors.primary }}
          thumbColor={colors.text}
          ios_backgroundColor={colors.switchTrack}
          accessibilityLabel={title}
          // A linha inteira já é o alvo de toque; o switch só reflete o estado (sem isto o
          // toque no próprio switch dispararia a troca duas vezes e ela se anularia).
          style={styles.switchDisplay}
        />
      ) : onPress ? (
        <Ionicons name={icons.chevronRight} size={20} color={colors.textSecondary} />
      ) : null}
    </View>
  );

  // Linha informativa (sem ação e sem switch): não pode virar um botão que não faz nada.
  if (!onPress && toggle === undefined) return <View testID={testID}>{content}</View>;

  const isToggle = toggle !== undefined && !onPress;
  return (
    <Pressable
      testID={testID}
      accessibilityRole={isToggle ? 'switch' : 'button'}
      accessibilityLabel={title}
      accessibilityHint={subtitle}
      accessibilityState={isToggle ? { checked: toggle } : undefined}
      onPress={() => {
        haptic.selection();
        // Tocar em qualquer ponto da linha vale como tocar no switch: o alvo passa de 51x31
        // (só o switch) para a linha inteira, de 64dp de altura (regra 14).
        if (isToggle) onToggle?.(!toggle);
        else onPress?.();
      }}
      style={({ pressed }) => pressed && styles.pressed}
    >
      {content}
    </Pressable>
  );
}

/** Group of MenuItems inside one card, separated by dividers (Mais, Configurações, Perfil, Liga). */
export function MenuGroup({ children, style }: PropsWithChildren<{ style?: ViewStyle }>) {
  const items = React.Children.toArray(children);
  return (
    <Surface padding={0} style={[styles.group, style ?? {}]}>
      {items.map((child, i) =>
        React.isValidElement<MenuItemProps>(child)
          ? React.cloneElement(child, { last: i === items.length - 1 })
          : child,
      )}
    </Surface>
  );
}

/** Standalone tall card row (Mais screen top items: Loja / Perfil / Configurações). */
export function MenuCard(props: MenuItemProps) {
  return (
    <Surface padding={0} style={styles.single}>
      <MenuItem {...props} last />
    </Surface>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 15,
    paddingHorizontal: spacing.md,
    minHeight: 64,
  },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.divider },
  iconBox: { width: 34, alignItems: 'center', marginRight: 12 },
  texts: { flex: 1 },
  value: { marginRight: 6 },
  pressed: { opacity: 0.75 },
  switchDisplay: { pointerEvents: 'none' },
  group: { overflow: 'hidden', marginBottom: spacing.md },
  single: { marginBottom: spacing.sm, borderRadius: radius.card },
});
