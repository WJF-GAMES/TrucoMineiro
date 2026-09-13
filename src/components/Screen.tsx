import React, { PropsWithChildren } from 'react';
import { ScrollView, StyleSheet, View, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView, Edge, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { colors, gradients, spacing } from '@/design-system';

interface Props {
  scroll?: boolean;
  /** Reserves room for the Bottom Navigation so the last card is never covered by it. */
  withTabBar?: boolean;
  padded?: boolean;
  edges?: Edge[];
  contentStyle?: ViewStyle;
  /** Extra bottom padding for screens under the tab bar. */
  bottomInset?: number;
  testID?: string;
}

/** Full-screen emerald gradient background used by every screen in the reference. */
export function Screen({
  scroll = false,
  withTabBar = false,
  padded = true,
  edges = ['top'],
  contentStyle,
  bottomInset = 0,
  children,
  testID,
}: PropsWithChildren<Props>) {
  const insets = useSafeAreaInsets();
  const tabBarSpace = withTabBar ? spacing.tabBarHeight + insets.bottom : 0;
  const inner = [
    padded && styles.padded,
    { paddingBottom: bottomInset + tabBarSpace + spacing.xl },
    contentStyle,
  ];
  return (
    <View style={styles.root} testID={testID}>
      <StatusBar style="light" />
      <LinearGradient
        colors={gradients.screen}
        locations={[0, 0.55, 1]}
        style={StyleSheet.absoluteFill}
      />
      <SafeAreaView edges={edges} style={styles.safe}>
        {scroll ? (
          <ScrollView
            contentContainerStyle={inner}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>
        ) : (
          <View style={[styles.safe, inner]}>{children}</View>
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bgTop },
  safe: { flex: 1 },
  padded: { paddingHorizontal: spacing.screen },
});
