import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, gradients, radius, spacing } from '@/design-system';
import { images } from '@/assets';
import { AppText, GameHeader, Screen } from '@/components';
import { ActionRow } from '@/screens/play/PlayScreen';
import { createRoom, FunctionsError } from '@/services/firebase/functions';
import { subscribeOnlineCount } from '@/services/firebase/rtdb';
import { flag } from '@/services/firebase/remoteConfig';
import { logEvent } from '@/services/firebase/analytics';
import { toast } from '@/stores/toastStore';
import { formatNumber } from '@/utils/format';
import type { RootScreenProps } from '@/navigation/types';

export function OnlineHubScreen({ navigation }: RootScreenProps<'OnlineHub'>) {
  const [online, setOnline] = useState(0);
  const [creating, setCreating] = useState(false);
  useEffect(() => subscribeOnlineCount(setOnline), []);

  const create = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const { code } = await createRoom();
      logEvent('room_created');
      navigation.replace('Lobby', { code });
    } catch (e) {
      toast.error(
        'Não foi possível criar a sala',
        e instanceof FunctionsError ? e.message : undefined,
      );
    } finally {
      setCreating(false);
    }
  };

  return (
    <Screen scroll testID="screen-online-hub">
      <GameHeader variant="title" title="Jogar Online" showBack />
      <View style={styles.hero}>
        <LinearGradient colors={gradients.modeOnline} style={StyleSheet.absoluteFill} />
        <Image
          source={images.modeOnline}
          style={styles.heroImage}
          contentFit="cover"
          contentPosition="center"
        />
        <LinearGradient colors={['rgba(107,47,15,0)', '#6b2f0f']} style={styles.heroFade} />
        <View style={styles.heroText}>
          <AppText variant="h2">JOGAR ONLINE</AppText>
          <AppText variant="small" color="rgba(255,255,255,0.9)">
            Enfrente jogadores reais de todo o Brasil.{' '}
            {online > 0 ? `${formatNumber(online)} online agora.` : ''}
          </AppText>
        </View>
      </View>

      <View style={{ height: spacing.lg }} />
      <ActionRow
        testID="online-quick"
        icon="flash"
        iconColor={colors.gold}
        title="JOGO RÁPIDO"
        subtitle="Encontrar partida automaticamente"
        highlight
        onPress={() => {
          if (!flag('matchmaking_enabled'))
            return toast.info('Jogo rápido indisponível', 'Crie uma sala e chame os amigos.');
          logEvent('online_selected', { entry: 'quick' });
          navigation.replace('Matchmaking');
        }}
      />
      <ActionRow
        testID="online-create"
        icon="people"
        iconColor={colors.gold}
        title={creating ? 'CRIANDO SALA...' : 'CRIAR SALA'}
        subtitle="Jogue com amigos (código de sala)"
        onPress={create}
      />
      <ActionRow
        testID="online-join"
        icon="keypad"
        iconColor={colors.cream}
        title="ENTRAR EM SALA"
        subtitle="Informe o código que recebeu"
        chevron
        onPress={() => navigation.navigate('JoinRoom')}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    height: 180,
    borderRadius: radius.card,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  heroImage: { width: '100%', height: '80%', opacity: 0.95 },
  heroFade: { position: 'absolute', left: 0, right: 0, top: '25%', bottom: 0 },
  heroText: { position: 'absolute', left: 14, right: 14, bottom: 12 },
});
