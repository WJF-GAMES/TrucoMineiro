import React, { useEffect, useRef, useState } from 'react';
import { Alert, Share, StyleSheet, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, radius, spacing } from '@/design-system';
import {
  AppText,
  GameHeader,
  IconButton,
  PlayerAvatar,
  PrimaryButton,
  Screen,
  SecondaryButton,
  StateView,
  Surface,
} from '@/components';
import { useAuthStore } from '@/stores/authStore';
import { subscribeRoom } from '@/services/firebase/rtdb';
import {
  fillRoomWithBots,
  leaveRoom,
  setReady,
  startMatch,
  FunctionsError,
} from '@/services/firebase/functions';
import type { Room, RoomPlayer } from '@/domain/model/types';
import { toast } from '@/stores/toastStore';
import { logEvent } from '@/services/firebase/analytics';
import { traced } from '@/services/firebase/perf';
import type { RootScreenProps } from '@/navigation/types';

const SEAT_LABEL = ['Você', 'Adversário', 'Parceiro', 'Adversário'];

export function LobbyScreen({ navigation, route }: RootScreenProps<'Lobby'>) {
  const { code } = route.params;
  const uid = useAuthStore((s) => s.user?.uid);
  const [room, setRoom] = useState<Room | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const navigated = useRef(false);

  useEffect(
    () =>
      subscribeRoom(
        code,
        (r) => setRoom(r),
        (e) => setError(e.message),
      ),
    [code],
  );

  useEffect(() => {
    if (!room || navigated.current) return;
    if (room.status === 'in_match' && room.sessionId) {
      navigated.current = true;
      logEvent('match_started', { mode: 'online', source: 'room' });
      navigation.replace('Game', { mode: 'online', sessionId: room.sessionId });
    } else if (room.status === 'closed') {
      navigated.current = true;
      toast.info('Sala encerrada', 'O anfitrião fechou a sala.');
      navigation.replace('Main', { screen: 'Play' });
    }
  }, [room, navigation]);

  const players = room ? Object.values(room.players).sort((a, b) => a.seat - b.seat) : [];
  const me = players.find((p) => p.uid === uid);
  const isHost = room?.hostUid === uid;
  const humanCount = players.filter((p) => !p.bot).length;
  const allReady = players.length === 4 && players.every((p) => p.ready || p.bot);
  const mySeat = me?.seat ?? 0;

  const share = async () => {
    await Share.share({
      message: `Bora um truco? Entre na minha sala no Truco Mineiro com o código ${code}`,
    });
  };
  const copy = async () => {
    await Clipboard.setStringAsync(code);
    toast.success('Código copiado');
  };

  const toggleReady = async () => {
    if (!me) return;
    setBusy('ready');
    try {
      await setReady(code, !me.ready);
    } catch (e) {
      toast.error('Não deu certo', e instanceof FunctionsError ? e.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  const start = async () => {
    setBusy('start');
    try {
      await traced('match_start', () => startMatch(code));
    } catch (e) {
      toast.error('Não foi possível iniciar', e instanceof FunctionsError ? e.message : undefined);
      setBusy(null);
    }
  };

  const fillBots = async () => {
    setBusy('bots');
    try {
      await fillRoomWithBots(code);
    } catch (e) {
      toast.error('Não deu certo', e instanceof FunctionsError ? e.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  const leave = () => {
    Alert.alert(
      isHost ? 'Fechar a sala?' : 'Sair da sala?',
      isHost ? 'Todos os jogadores serão removidos.' : undefined,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Sair',
          style: 'destructive',
          onPress: async () => {
            navigated.current = true;
            await leaveRoom(code).catch(() => undefined);
            navigation.replace('Main', { screen: 'Play' });
          },
        },
      ],
    );
  };

  if (error) {
    return (
      <Screen>
        <GameHeader
          variant="title"
          title="Sala"
          showBack
          onBack={() => navigation.replace('Main', { screen: 'Play' })}
        />
        <StateView
          kind="error"
          message={error}
          actionLabel="Voltar"
          onAction={() => navigation.replace('Main', { screen: 'Play' })}
        />
      </Screen>
    );
  }
  if (room === undefined) {
    return (
      <Screen>
        <GameHeader variant="title" title="Sala" />
        <StateView kind="loading" title="Entrando na sala..." />
      </Screen>
    );
  }
  if (room === null) {
    return (
      <Screen>
        <GameHeader
          variant="title"
          title="Sala"
          showBack
          onBack={() => navigation.replace('Main', { screen: 'Play' })}
        />
        <StateView
          kind="empty"
          icon="close-circle"
          title="Sala não existe mais"
          message="Ela foi encerrada ou o código está errado."
          actionLabel="Voltar"
          onAction={() => navigation.replace('Main', { screen: 'Play' })}
        />
      </Screen>
    );
  }

  return (
    <Screen scroll testID="screen-lobby">
      <GameHeader
        variant="title"
        title="Sala"
        showBack
        onBack={leave}
        rightSlot={
          <IconButton
            icon="share-social"
            accessibilityLabel="Compartilhar código"
            onPress={share}
          />
        }
      />

      <Surface style={styles.codeCard} strong>
        <AppText variant="small" color={colors.textSecondary}>
          Código da sala
        </AppText>
        <View style={styles.codeRow}>
          <AppText variant="display" style={styles.code} testID="lobby-code">
            {code}
          </AppText>
          <IconButton icon="copy-outline" accessibilityLabel="Copiar código" onPress={copy} />
        </View>
        <AppText variant="caption" color={colors.textSecondary}>
          {room.status === 'starting'
            ? 'Iniciando partida...'
            : `${players.length}/4 jogadores  •  ${humanCount} ${humanCount === 1 ? 'pessoa' : 'pessoas'}`}
        </AppText>
      </Surface>

      <View style={styles.seats}>
        {[0, 1, 2, 3].map((seat) => {
          const p = players.find((x) => x.seat === seat);
          const relative = (seat - mySeat + 4) % 4;
          return (
            <SeatCard
              key={seat}
              seat={seat}
              player={p}
              label={SEAT_LABEL[relative]!}
              team={seat % 2 === mySeat % 2 ? 'Nós' : 'Eles'}
              isHost={p?.uid === room.hostUid}
            />
          );
        })}
      </View>

      <AppText
        variant="small"
        center
        color={colors.textSecondary}
        style={{ marginTop: spacing.md }}
      >
        Duplas: assentos 1 e 3 contra 2 e 4. Compartilhe o código para os amigos entrarem.
      </AppText>

      <View style={styles.actions}>
        {isHost ? (
          <>
            <PrimaryButton
              label={busy === 'start' ? 'Iniciando...' : 'Iniciar partida'}
              onPress={start}
              loading={busy === 'start'}
              disabled={!allReady || room.status !== 'waiting'}
              testID="lobby-start"
            />
            {players.length < 4 ? (
              <SecondaryButton
                label="Completar com IA"
                icon="hardware-chip"
                onPress={fillBots}
                loading={busy === 'bots'}
                style={{ marginTop: spacing.sm }}
                testID="lobby-fill-bots"
              />
            ) : null}
            {!allReady && players.length === 4 ? (
              <AppText
                variant="caption"
                center
                color={colors.textSecondary}
                style={{ marginTop: 8 }}
              >
                Aguardando todos ficarem prontos.
              </AppText>
            ) : null}
          </>
        ) : (
          <PrimaryButton
            label={me?.ready ? 'Pronto!' : 'Estou pronto'}
            icon={me?.ready ? 'checkmark-circle' : undefined}
            onPress={toggleReady}
            loading={busy === 'ready'}
            testID="lobby-ready"
          />
        )}
        {isHost && me ? (
          <SecondaryButton
            label={me.ready ? 'Marcar como não pronto' : 'Marcar como pronto'}
            onPress={toggleReady}
            loading={busy === 'ready'}
            style={{ marginTop: spacing.sm }}
          />
        ) : null}
        <SecondaryButton
          label={isHost ? 'Fechar sala' : 'Sair da sala'}
          icon="log-out"
          onPress={leave}
          style={{ marginTop: spacing.sm }}
          testID="lobby-leave"
        />
      </View>
    </Screen>
  );
}

function SeatCard({
  seat,
  player,
  label,
  team,
  isHost,
}: {
  seat: number;
  player?: RoomPlayer;
  label: string;
  team: string;
  isHost: boolean;
}) {
  return (
    <Surface
      style={[styles.seat, player?.ready ? styles.seatReady : {}]}
      padding={10}
      testID={`lobby-seat-${seat}`}
    >
      {player ? (
        <>
          <PlayerAvatar
            avatarId={player.avatarId}
            size={56}
            ringColor={player.ready ? colors.primaryBright : colors.cardBorderStrong}
          />
          <AppText variant="bodyBold" numberOfLines={1} style={{ marginTop: 6 }}>
            {player.nickname}
          </AppText>
          <View style={styles.seatMeta}>
            {isHost ? <Ionicons name="star" size={12} color={colors.gold} /> : null}
            <AppText
              variant="caption"
              color={player.ready || player.bot ? colors.primaryBright : colors.textSecondary}
            >
              {player.bot ? 'IA' : player.ready ? 'Pronto' : 'Aguardando'}
            </AppText>
            {player.connected === false ? (
              <Ionicons name="cloud-offline" size={12} color={colors.dangerSoft} />
            ) : null}
          </View>
        </>
      ) : (
        <>
          <View style={styles.emptySeat}>
            <Ionicons name="person-add" size={24} color={colors.textMuted} />
          </View>
          <AppText variant="bodyBold" color={colors.textMuted} style={{ marginTop: 6 }}>
            Vaga livre
          </AppText>
          <AppText variant="caption" color={colors.textMuted}>
            Aguardando jogador
          </AppText>
        </>
      )}
      <View style={styles.seatTag}>
        <AppText variant="caption" color={colors.textSecondary}>
          {label} • {team}
        </AppText>
      </View>
    </Surface>
  );
}

const styles = StyleSheet.create({
  codeCard: { alignItems: 'center', paddingVertical: 14 },
  codeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  code: { letterSpacing: 6, fontSize: 34 },
  seats: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: spacing.lg },
  seat: {
    width: '48%',
    flexGrow: 1,
    alignItems: 'center',
    minHeight: 150,
    justifyContent: 'center',
  },
  seatReady: { borderColor: colors.primaryBright },
  seatMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  emptySeat: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.textMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  seatTag: {
    marginTop: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  actions: { marginTop: spacing.xl },
});
