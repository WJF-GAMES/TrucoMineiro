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
  // Sem a Bottom Navigation, ninguém mais afasta o conteúdo da barra de navegação do sistema: o
  // último botão (ex.: "Fechar sala") ficava atrás dela no Android.
  const tabBarSpace = withTabBar ? spacing.tabBarHeight + insets.bottom : insets.bottom;
  // A Bottom Navigation ocupa o próprio espaço embaixo da tela (não fica por cima dela). Numa
  // tela que não rola — as que têm uma FlatList própria, como Liga e Amigos — reservar a altura
  // da barra no container virava uma faixa morta: a lista terminava antes dela e as últimas
  // linhas pareciam cortadas. Ali o espaço final fica por conta da própria lista.
  const bottom = !scroll && withTabBar ? bottomInset : bottomInset + tabBarSpace + spacing.xl;
  const inner = [padded && styles.padded, { paddingBottom: bottom }, contentStyle];
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
