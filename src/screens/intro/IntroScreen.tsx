import React, { useEffect } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { colors, IoniconName, radius, spacing } from '@/design-system';
import { images } from '@/assets';
import { AppText, PrimaryButton } from '@/components';
import { useSettingsStore } from '@/stores/settingsStore';
import { logEvent } from '@/services/firebase/analytics';
import type { RootScreenProps } from '@/navigation/types';

const FEATURES: { icon: IoniconName; color: string; label: string }[] = [
  { icon: 'trophy', color: colors.gold, label: 'Jogue online\ne offline' },
  { icon: 'people', color: colors.primaryBright, label: 'Chame\nseus amigos' },
  { icon: 'bar-chart', color: colors.primaryBright, label: 'Evolua\nde nível' },
  { icon: 'star', color: colors.gold, label: 'Conquiste\nrecompensas' },
];

/** Natural aspect ratio of the artwork (assets/images/hero/intro_hero.png). */
const HERO_RATIO = 1419 / 1683;

const CARD_GAP = 7;

/** Tela única de abertura: arte + benefícios + CTA. Sem etapas, paginação ou swipe. */
export function IntroScreen({ navigation }: RootScreenProps<'Intro'>) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const setSettings = useSettingsStore((s) => s.set);

  // A arte ocupa a largura inteira; em telas altas ela cresce até 62% da altura
  // (o `cover` corta um pouco das laterais) para não sobrar vão morto sob a mesa.
  const naturalHero = width / HERO_RATIO;
  const heroHeight = Math.min(naturalHero * 1.28, Math.max(naturalHero, height * 0.62));

  // "recompensas" é a palavra mais larga dos cards: em Nunito Bold ela ocupa ~6,35x o
  // tamanho da fonte. Sem esse ajuste ela corta com reticências em telas de 320dp.
  const cardWidth = (width - spacing.screen * 2 - CARD_GAP * 3) / 4;
  const labelSize = Math.max(9, Math.min(12, (cardWidth - 2) / 6.35));

  useEffect(() => {
    logEvent('intro_viewed');
  }, []);

  const start = () => {
    setSettings({ hasSeenIntro: true });
    navigation.navigate('Login');
  };

  return (
    <View style={styles.root} testID="screen-intro">
      <StatusBar style="light" />
      {/* A mesa da referência continua abaixo da arte e escurece até o mato do rodapé. */}
      <LinearGradient
        colors={['#8f4b20', '#5a3316', '#2c2211', '#16280d', colors.bgTop]}
        locations={[0, 0.18, 0.42, 0.72, 1]}
        style={[styles.wood, { top: heroHeight - 1 }]}
      />

      <View style={[styles.heroWrap, { height: heroHeight }]}>
        <Image
          source={images.introHero}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          contentPosition="top center"
          accessibilityLabel="Truco Mineiro: tradição em cada jogada. Mais que um jogo, uma resenha!"
        />
        <LinearGradient
          colors={['rgba(0,0,0,0.28)', 'rgba(0,0,0,0)']}
          style={[styles.statusScrim, { height: insets.top + 12 }]}
        />
      </View>

      <View style={[styles.bottom, { paddingBottom: Math.max(insets.bottom, 10) + 6 }]}>
        <View style={styles.features}>
          {FEATURES.map((f) => (
            <View key={f.label} style={styles.feature}>
              <Ionicons name={f.icon} size={30} color={f.color} />
              <AppText
                variant="smallBold"
                center
                numberOfLines={2}
                style={[styles.featureLabel, { fontSize: labelSize, lineHeight: labelSize * 1.28 }]}
              >
                {f.label}
              </AppText>
            </View>
          ))}
        </View>

        <PrimaryButton label="Começar" size="md" onPress={start} testID="intro-start" />

        <AppText variant="small" center style={styles.footer}>
          Truco é gente de verdade.
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bgTop },
  wood: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  heroWrap: { width: '100%', pointerEvents: 'none' },
  statusScrim: { position: 'absolute', left: 0, right: 0, top: 0 },
  bottom: {
    flex: 1,
    justifyContent: 'space-evenly',
    paddingTop: spacing.md,
    paddingHorizontal: spacing.screen,
  },
  features: { flexDirection: 'row', gap: CARD_GAP },
  feature: {
    flex: 1,
    backgroundColor: colors.overlay,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    paddingVertical: 12,
    paddingHorizontal: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 80,
  },
  featureLabel: { marginTop: 8 },
  footer: { color: colors.text },
});
