import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, gradients, icons, IoniconName, radius, spacing } from '@/design-system';
import { images } from '@/assets';
import { AppText, GameHeader, PrimaryButton, Screen, Surface } from '@/components';
import type { AIDifficultyId } from '@/domain/model/types';
import { flag } from '@/services/firebase/remoteConfig';
import { logEvent } from '@/services/firebase/analytics';
import { haptic } from '@/utils/haptics';
import type { RootScreenProps } from '@/navigation/types';

const LEVELS: {
  id: AIDifficultyId;
  title: string;
  description: string;
  icon: IoniconName;
  bars: number;
}[] = [
  {
    id: 'easy',
    title: 'Fácil',
    description: 'Para aprender as regras sem pressão.',
    icon: 'leaf',
    bars: 1,
  },
  {
    id: 'normal',
    title: 'Normal',
    description: 'A IA joga como um bom trucador.',
    icon: 'flame',
    bars: 2,
  },
  {
    id: 'hard',
    title: 'Difícil',
    description: 'Blefes, contagem de cartas e muito truco.',
    icon: 'skull',
    bars: 3,
  },
];

export function AiSetupScreen({ navigation }: RootScreenProps<'AiSetup'>) {
  const enabled: Record<AIDifficultyId, boolean> = {
    easy: flag('ai_easy_enabled'),
    normal: flag('ai_normal_enabled'),
    hard: flag('ai_hard_enabled'),
  };
  // A seleção inicial tem de ser um nível que existe: quando "Normal" está desligado por
  // remote config, deixá-lo marcado dava um card apagado com o check verde em cima e um
  // "Iniciar partida" que abria uma mesa desativada.
  const firstEnabled = LEVELS.find((l) => enabled[l.id])?.id ?? null;
  const [difficulty, setDifficulty] = useState<AIDifficultyId | null>(
    enabled.normal ? 'normal' : firstEnabled,
  );
  const selectable = difficulty !== null && enabled[difficulty] ? difficulty : firstEnabled;

  return (
    <Screen scroll testID="screen-ai-setup">
      <GameHeader variant="title" title="Contra a IA" showBack />
      <View style={styles.hero}>
        <LinearGradient colors={gradients.modeIa} style={StyleSheet.absoluteFill} />
        <Image
          source={images.modeIa}
          style={styles.heroImage}
          contentFit="cover"
          contentPosition="center"
        />
        <LinearGradient colors={['rgba(2,63,128,0)', '#023f80']} style={styles.heroFade} />
        <View style={styles.heroText}>
          <AppText variant="h2">JOGAR CONTRA A IA</AppText>
          <AppText variant="small" color="rgba(255,255,255,0.9)">
            Você e um parceiro IA contra uma dupla IA. Treine, evolua e melhore suas habilidades.
          </AppText>
        </View>
      </View>

      <AppText variant="h3" style={styles.section}>
        Escolha a dificuldade
      </AppText>
      {LEVELS.map((l) => {
        const selected = l.id === selectable;
        const off = !enabled[l.id];
        return (
          <Pressable
            key={l.id}
            testID={`difficulty-${l.id}`}
            accessibilityRole="radio"
            accessibilityState={{ selected, disabled: off }}
            accessibilityLabel={l.title}
            disabled={off}
            onPress={() => {
              haptic.selection();
              setDifficulty(l.id);
            }}
          >
            <Surface
              style={[
                styles.level,
                selected ? styles.levelSelected : {},
                off ? styles.levelOff : {},
              ]}
            >
              <View style={[styles.levelIcon, selected && styles.levelIconSelected]}>
                <Ionicons
                  name={l.icon}
                  size={22}
                  color={selected ? colors.textDark : colors.cream}
                />
              </View>
              <View style={{ flex: 1 }}>
                <AppText variant="h3">{l.title}</AppText>
                <AppText variant="small" color={colors.textSecondary}>
                  {off ? 'Indisponível no momento' : l.description}
                </AppText>
              </View>
              <View style={styles.bars}>
                {[1, 2, 3].map((b) => (
                  <View
                    key={b}
                    style={[
                      styles.bar,
                      { height: 6 + b * 4 },
                      b <= l.bars && (selected ? styles.barOn : styles.barDim),
                    ]}
                  />
                ))}
              </View>
              {selected ? (
                <Ionicons
                  name={icons.checkCircle}
                  size={22}
                  color={colors.primaryBright}
                  style={{ marginLeft: 8 }}
                />
              ) : null}
            </Surface>
          </Pressable>
        );
      })}

      {selectable === null ? (
        <AppText variant="small" center color={colors.textSecondary} style={styles.unavailable}>
          Nenhum nível está disponível agora. Tente de novo em instantes.
        </AppText>
      ) : null}
      <PrimaryButton
        label="Iniciar partida"
        testID="ai-start"
        style={styles.cta}
        disabled={selectable === null}
        onPress={() => {
          if (selectable === null) return;
          logEvent('ai_selected', { difficulty: selectable });
          navigation.replace('Game', {
            mode: 'ai',
            difficulty: selectable,
            seed: Date.now() % 2147483647,
          });
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    height: 210,
    borderRadius: radius.card,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  heroImage: { width: '100%', height: '78%', opacity: 0.95 },
  heroFade: { position: 'absolute', left: 0, right: 0, top: '25%', bottom: 0 },
  heroText: { position: 'absolute', left: 14, right: 14, bottom: 12 },
  section: { marginTop: spacing.xl, marginBottom: spacing.sm },
  level: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
    paddingVertical: 12,
  },
  levelSelected: { borderColor: colors.primaryBright, backgroundColor: 'rgba(5, 120, 70, 0.35)' },
  levelOff: { opacity: 0.5 },
  levelIcon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  levelIconSelected: { backgroundColor: colors.primaryBright },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 3, marginLeft: 8 },
  bar: { width: 6, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.15)' },
  barDim: { backgroundColor: colors.textSecondary },
  barOn: { backgroundColor: colors.primaryBright },
  unavailable: { marginTop: spacing.md },
  cta: { marginTop: spacing.lg },
});
