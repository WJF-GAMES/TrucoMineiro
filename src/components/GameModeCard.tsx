import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, IoniconName, radius } from '@/design-system';
import { AppText } from './AppText';

/**
 * Card ilustrado de modo de jogo ("JOGAR CONTRA A IA" / "JOGAR ONLINE").
 *
 * Arte no topo, título em duas linhas, descrição e uma pílula com ícone.
 * Usado na tela Jogar e na Principal — o mesmo card, só com alturas diferentes.
 */
export function GameModeCard({
  title,
  subtitle,
  image,
  gradient,
  fadeColor,
  footerIcon,
  footer,
  height = 334,
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
  /** Altura do card; a arte ocupa 62% dela. */
  height?: number;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={title.replace('\n', ' ')}
      onPress={onPress}
      style={({ pressed }) => [styles.mode, { height }, pressed && styles.pressed]}
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
          <AppText variant="caption" style={styles.modeFooterText}>
            {footer}
          </AppText>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  mode: {
    flex: 1,
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
  modeFooterText: { marginLeft: 5 },
  pressed: { opacity: 0.85 },
});
