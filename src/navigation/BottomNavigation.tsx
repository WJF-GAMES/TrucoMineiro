import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CardsIcon, colors, icons, spacing } from '@/design-system';
import { AppText } from '@/components/AppText';
import { haptic } from '@/utils/haptics';

const LABELS: Record<string, string> = {
  Home: 'Principal',
  Play: 'Jogar',
  League: 'Liga',
  Friends: 'Amigos',
  More: 'Mais',
};

function TabIcon({ route, active }: { route: string; active: boolean }) {
  const color = active ? colors.primary : colors.tabInactive;
  const size = 26;
  switch (route) {
    case 'Home':
      return (
        <Ionicons name={active ? icons.tabHome : icons.tabHomeOutline} size={size} color={color} />
      );
    case 'Play':
      return (
        <CardsIcon
          name={active ? icons.tabPlay : icons.tabPlayOutline}
          size={size + 2}
          color={color}
        />
      );
    case 'League':
      return (
        <Ionicons
          name={active ? icons.tabLeague : icons.tabLeagueOutline}
          size={size}
          color={color}
        />
      );
    case 'Friends':
      return (
        <Ionicons
          name={active ? icons.tabFriends : icons.tabFriendsOutline}
          size={size}
          color={color}
        />
      );
    default:
      return <Ionicons name={icons.tabMore} size={size} color={color} />;
  }
}

/** Custom tab bar matching the reference: dark deep-green bar, green active icon+label, top indicator. */
export function BottomNavigation({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 8) }]}
      testID="bottom-navigation"
    >
      {state.routes.map((route, index) => {
        const active = state.index === index;
        return (
          <Pressable
            key={route.key}
            testID={`tab-${route.name}`}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={LABELS[route.name] ?? route.name}
            onPress={() => {
              const event = navigation.emit({
                type: 'tabPress',
                target: route.key,
                canPreventDefault: true,
              });
              if (!active && !event.defaultPrevented) {
                haptic.selection();
                navigation.navigate(route.name);
              }
            }}
            style={({ pressed }) => [styles.tab, pressed && styles.tabPressed]}
          >
            <View style={[styles.indicator, active && styles.indicatorActive]} />
            <TabIcon route={route.name} active={active} />
            <AppText
              variant="tab"
              color={active ? colors.primary : colors.tabInactive}
              style={styles.label}
              numberOfLines={1}
              // A barra tem altura fixa (ícone + rótulo): sem o teto, a fonte máxima do
              // sistema corta os rótulos das cinco abas (regras 12 e 50).
              maxFontSizeMultiplier={1.2}
            >
              {LABELS[route.name] ?? route.name}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: colors.bgDeep,
    borderTopWidth: 1,
    borderTopColor: 'rgba(120,200,170,0.12)',
    paddingTop: 6,
    minHeight: spacing.tabBarHeight,
  },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'flex-start', paddingTop: 4 },
  // Retorno imediato ao toque: sem isso a única resposta é a troca de tela (regra 19).
  tabPressed: { opacity: 0.6 },
  indicator: {
    width: 32,
    height: 3,
    borderRadius: 2,
    marginBottom: 6,
    backgroundColor: 'transparent',
  },
  indicatorActive: { backgroundColor: colors.primary },
  label: { marginTop: 3 },
});
