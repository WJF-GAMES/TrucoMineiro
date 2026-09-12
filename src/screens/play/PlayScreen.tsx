import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, gradients, IoniconName, radius, spacing } from '@/design-system';
import { images } from '@/assets';
import { AppText, GameHeader, Screen, Surface } from '@/components';
import { logEvent } from '@/services/firebase/analytics';
import { flag } from '@/services/firebase/remoteConfig';
import { subscribeOnlineCount } from '@/services/firebase/rtdb';
import { formatNumber } from '@/utils/format';
import { haptic } from '@/utils/haptics';
import { toast } from '@/stores/toastStore';
import type { TabScreenProps } from '@/navigation/types';

/** Big illustrated mode card ("JOGAR CONTRA A IA" / "JOGAR ONLINE"). */
function GameModeCard({
  title,
  subtitle,
  image,
  gradient,
  fadeColor,
  footerIcon,
  footer,
  onPress,
  testID,
}: {
  title: string;
  subtitle: string;
  image: number;
  gradient: readonly [string, string];
  fadeColor: string;
  footerIcon: IoniconName;
  footer: string;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={({ pressed }) => [styles.mode, pressed && styles.pressed]}
    >
      <LinearGradient colors={gradient} style={StyleSheet.absoluteFill} />
      <Image source={image} style={styles.modeImage} contentFit="cover" contentPosition="top" />
      <LinearGradient
        colors={['rgba(0,0,0,0)', fadeColor]}
        locations={[0.1, 1]}
        style={styles.modeFade}
      />
      <View style={styles.modeBody}>
        <AppText variant="h2" center style={styles.modeTitle}>
          {title}
        </AppText>
        <AppText variant="small" center color="rgba(255,255,255,0.9)" style={styles.modeSubtitle}>
          {subtitle}
        </AppText>
        <View style={styles.modeFooter}>
          <Ionicons name={footerIcon} size={14} color={colors.gold} />
          <AppText variant="caption" style={{ marginLeft: 5 }}>
            {footer}
          </AppText>
        </View>
      </View>
    </Pressable>
  );
}

/** Wide action row ("JOGO RÁPIDO", "CRIAR SALA", "Dicas de Truco"). */
export function ActionRow({
  icon,
  iconColor,
  title,
  subtitle,
  onPress,
  highlight,
  chevron,
  testID,
}: {
  icon: IoniconName;
  iconColor: string;
  title: string;
  subtitle: string;
  onPress: () => void;
  highlight?: boolean;
  chevron?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={({ pressed }) => [pressed && styles.pressed]}
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
          <AppText variant="small" color={colors.textSecondary}>
            {subtitle}
          </AppText>
        </View>
        {chevron ? (
          <Ionicons
            name="chevron-forward"
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
    <Screen scroll testID="screen-play">
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
          footer={`${formatNumber(online)} online`}
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
  mode: {
    flex: 1,
    height: 334,
    borderRadius: radius.card,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.22)',
  },
  modeImage: { width: '100%', height: '62%' },
  modeFade: { position: 'absolute', left: 0, right: 0, top: '30%', bottom: 0 },
  modeBody: { position: 'absolute', left: 8, right: 8, bottom: 10 },
  modeTitle: {
    fontSize: 21,
    lineHeight: 25,
    textShadowColor: 'rgba(0,0,0,0.55)',
    textShadowRadius: 5,
    textShadowOffset: { width: 0, height: 1 },
  },
  modeSubtitle: { marginTop: 7, fontSize: 13, lineHeight: 17 },
  modeFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
  },
  pressed: { opacity: 0.85 },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 15,
    paddingHorizontal: 12,
    marginBottom: spacing.sm,
    overflow: 'hidden',
  },
  actionHighlight: { borderColor: 'rgba(60, 220, 140, 0.55)' },
  actionIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  actionIconHighlight: { backgroundColor: 'rgba(0,0,0,0.3)' },
  actionTitleUpper: { letterSpacing: 0.5 },
});
