import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, gradients, icons, IoniconName, radius, spacing } from '@/design-system';
import { images } from '@/assets';
import { AppText, GameHeader, GameModeCard, Screen, Surface } from '@/components';
import { logEvent } from '@/services/firebase/analytics';
import { flag } from '@/services/firebase/remoteConfig';
import { subscribeOnlineCount } from '@/services/firebase/rtdb';
import { formatNumber } from '@/utils/format';
import { haptic } from '@/utils/haptics';
import { toast } from '@/stores/toastStore';
import type { TabScreenProps } from '@/navigation/types';

/** Wide action row ("JOGO RÁPIDO", "CRIAR SALA", "Dicas de Truco"). */
export function ActionRow({
  icon,
  iconColor,
  title,
  subtitle,
  onPress,
  highlight,
  chevron,
  style,
  testID,
}: {
  icon: IoniconName;
  iconColor: string;
  title: string;
  subtitle: string;
  onPress: () => void;
  highlight?: boolean;
  chevron?: boolean;
  style?: ViewStyle;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={subtitle}
      onPress={onPress}
      style={({ pressed }) => [style, pressed && styles.pressed]}
    >
      <Surface style={[styles.action, highlight ? styles.actionHighlight : {}]} padding={0}>
        {highlight ? (
          <LinearGradient colors={gradients.quickPlay} style={StyleSheet.absoluteFill} />
        ) : null}
        <View style={[styles.actionIcon, highlight && styles.actionIconHighlight]}>
          <Ionicons name={icon} size={26} color={iconColor} />
        </View>
        <View style={{ flex: 1 }}>
          <AppText variant="h3" style={highlight ? styles.actionTitleUpper : undefined}>
            {title}
          </AppText>
          <AppText variant="small" color={colors.textSecondary} style={styles.actionSubtitle}>
            {subtitle}
          </AppText>
        </View>
        {chevron ? (
          <Ionicons
            name={icons.chevronRight}
            size={20}
            color={colors.textSecondary}
            style={{ marginRight: 6 }}
          />
        ) : null}
      </Surface>
    </Pressable>
  );
}

export function PlayScreen({ navigation }: TabScreenProps<'Play'>) {
  const [online, setOnline] = useState(0);
  useEffect(() => subscribeOnlineCount(setOnline), []);
  const onlineEnabled = flag('online_enabled');

  const guardOnline = (fn: () => void) => {
    if (!onlineEnabled) {
      toast.info('Modo online indisponível', 'Estamos em manutenção. Tente mais tarde.');
      return;
    }
    fn();
  };

  return (
    <Screen scroll withTabBar testID="screen-play">
      <GameHeader variant="logo" />
      <AppText variant="h2" center style={styles.title}>
        Escolha como jogar
      </AppText>

      <View style={styles.modes}>
        <GameModeCard
          testID="play-ai"
          title={'JOGAR\nCONTRA A IA'}
          subtitle="Treine, evolua e melhore suas habilidades."
          image={images.modeIa}
          gradient={gradients.modeIa}
          fadeColor="#023f80"
          footerIcon="bar-chart"
          footer="3 níveis de dificuldade"
          onPress={() => {
            haptic.light();
            logEvent('play_clicked', { mode: 'ai' });
            navigation.navigate('AiSetup');
          }}
        />
        <GameModeCard
          testID="play-online"
          title={'JOGAR\nONLINE'}
          subtitle="Enfrente jogadores reais de todo o Brasil."
          image={images.modeOnline}
          gradient={gradients.modeOnline}
          fadeColor="#6b2f0f"
          footerIcon="people"
          // Antes da primeira leitura de presença o contador é 0: "0 online" no card de
          // entrar numa partida online desanima sem motivo. Igual à Principal (regra 59).
          footer={online > 0 ? `${formatNumber(online)} online` : 'Jogadores reais'}
          onPress={() =>
            guardOnline(() => {
              haptic.light();
              logEvent('play_clicked', { mode: 'online' });
              navigation.navigate('OnlineHub');
            })
          }
        />
      </View>

      <ActionRow
        testID="play-quick"
        icon="flash"
        iconColor={colors.gold}
        title="JOGO RÁPIDO"
        subtitle="Encontrar partida automaticamente"
        highlight
        onPress={() =>
          guardOnline(() => {
            logEvent('online_selected', { entry: 'quick' });
            navigation.navigate('Matchmaking');
          })
        }
      />
      <ActionRow
        testID="play-create-room"
        icon="people"
        iconColor={colors.gold}
        title="CRIAR SALA"
        subtitle="Jogue com amigos (código de sala)"
        onPress={() =>
          guardOnline(() => {
            logEvent('online_selected', { entry: 'create_room' });
            navigation.navigate('OnlineHub');
          })
        }
      />
      <ActionRow
        icon="book"
        iconColor={colors.cream}
        title="Dicas de Truco"
        subtitle="Aprenda estratégias e melhore seu jogo!"
        chevron
        onPress={() => navigation.navigate('StaticPage', { kind: 'tips' })}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { marginBottom: spacing.md },
  modes: { flexDirection: 'row', gap: 10, marginBottom: spacing.md },
  pressed: { opacity: 0.85 },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    // 72dp de alvo: confortável para o polegar e deixa título e descrição respirarem.
    minHeight: 72,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
    overflow: 'hidden',
  },
  actionHighlight: { borderColor: 'rgba(60, 220, 140, 0.55)' },
  actionIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  actionIconHighlight: { backgroundColor: 'rgba(0,0,0,0.3)' },
  actionSubtitle: { marginTop: 3 },
  actionTitleUpper: { letterSpacing: 0.5 },
});
