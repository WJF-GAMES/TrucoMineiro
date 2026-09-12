import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
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

/** Natural aspect ratio of the extracted artwork (assets/images/hero/intro_hero.png). */
const HERO_RATIO = 900 / 1056;

export function IntroScreen({ navigation }: RootScreenProps<'Intro'>) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const pageWidth = width - spacing.screen * 2;
  const [page, setPage] = useState(0);
  const setSettings = useSettingsStore((s) => s.set);

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
      {/* Wood-table tones sampled from the reference continue below the artwork on tall screens. */}
      <LinearGradient
        colors={['#582f18', '#3a2110', '#1b1a0f', colors.bgTop]}
        locations={[0, 0.35, 0.7, 1]}
        style={StyleSheet.absoluteFill}
      />

      <View style={styles.heroWrap} pointerEvents="none">
        <Image
          source={images.introHero}
          style={styles.hero}
          contentFit="cover"
          contentPosition="top center"
          accessibilityLabel="Truco Mineiro: tradição em cada jogada"
        />
        <LinearGradient
          colors={['rgba(0,26,20,0)', 'rgba(0,26,20,0.55)']}
          style={styles.heroFade}
          pointerEvents="none"
        />
      </View>

      <View style={[styles.bottom, { paddingBottom: Math.max(insets.bottom, 10) + 6 }]}>
        <ScrollView
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={(e) =>
            setPage(Math.round(e.nativeEvent.contentOffset.x / pageWidth))
          }
          style={styles.pager}
        >
          <View style={[styles.featuresRow, { width: pageWidth }]}>
            {FEATURES.map((f) => (
              <View key={f.label} style={styles.feature}>
                <Ionicons name={f.icon} size={28} color={f.color} />
                <AppText variant="smallBold" center style={styles.featureLabel} numberOfLines={3}>
                  {f.label}
                </AppText>
              </View>
            ))}
          </View>
          <View style={[styles.page, { width: pageWidth }]}>
            <AppText variant="h2" center>
              Truco de raiz, do jeito mineiro
            </AppText>
            <AppText variant="small" center color={colors.textSecondary} style={styles.pageText}>
              Manilhas fixas, Truco, Seis, Nove e Doze. Partidas de 4 jogadores em dupla, como na
              venda da esquina.
            </AppText>
          </View>
          <View style={[styles.page, { width: pageWidth }]}>
            <AppText variant="h2" center>
              Suba de liga e conquiste prêmios
            </AppText>
            <AppText variant="small" center color={colors.textSecondary} style={styles.pageText}>
              Ganhe pontos, evolua de nível, chame a turma e mostre que o Truco Mineiro é forte.
            </AppText>
          </View>
        </ScrollView>
        <View style={styles.spacer} />
        <View style={styles.dots}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={[styles.dot, i === page && styles.dotActive]} />
          ))}
        </View>
        <PrimaryButton label="Começar" onPress={start} testID="intro-start" style={styles.cta} />
        <AppText variant="smallBold" center style={styles.footer}>
          Truco é gente de verdade.
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bgTop },
  heroWrap: { width: '100%', aspectRatio: HERO_RATIO },
  hero: { width: '100%', height: '100%' },
  heroFade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '22%' },
  bottom: {
    flex: 1,
    justifyContent: 'space-between',
    paddingTop: spacing.md,
    paddingHorizontal: spacing.screen,
  },
  pager: { flexGrow: 0 },
  featuresRow: { flexDirection: 'row', gap: 7 },
  feature: {
    flex: 1,
    backgroundColor: 'rgba(10, 42, 38, 0.78)',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    paddingVertical: 12,
    paddingHorizontal: 3,
    alignItems: 'center',
    minHeight: 94,
    justifyContent: 'center',
  },
  featureLabel: { marginTop: 8, fontSize: 11, lineHeight: 14.5 },
  page: { paddingHorizontal: spacing.md, justifyContent: 'center', minHeight: 94 },
  pageText: { marginTop: 6 },
  spacer: { flex: 1 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginBottom: 12 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.35)' },
  dotActive: { backgroundColor: colors.text, width: 8, height: 8, borderRadius: 4, marginTop: -1 },
  cta: { marginBottom: 10 },
  footer: { marginBottom: 2 },
});
