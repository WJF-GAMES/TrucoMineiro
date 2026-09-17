import React, { useEffect, useRef, useState } from 'react';
import { Alert, Share, StyleSheet, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, icons, radius, spacing } from '@/design-system';
import {
  AppText,
  GameHeader,
  IconButton,
  PillButton,
  PlayerAvatar,
  PrimaryButton,
  Screen,
  SecondaryButton,
  StateView,
  Surface,
} from '@/components';
import { useAuthStore } from '@/stores/authStore';
import { subscribeRoom ,
  claimReservedSeat,
  fillRoomWithBots,
  inviteToRoom,
  leaveRoom,
  removeRoomInvite,
  resolveLobbyTimeout,
  setReady,
  startMatch,
  ApiError,
} from '@/services/api';

import type { Room } from '@/domain/model/types';
import { toast } from '@/stores/toastStore';
import { logEvent } from '@/services/firebase/analytics';
import { traced } from '@/services/firebase/perf';
import type { RootScreenProps } from '@/navigation/types';
import { useMatchmakingGuard } from '@/ads';
import {
  closedMessage,
  formatCountdown,
  inviteChanges,
  lobbyRemaining,
  myLobbyState,
  seatState,
  type SeatState,
} from '@/features/friends/lobbyState';
import { FriendPickerSheet } from '@/screens/friends/components/FriendPickerSheet';

const SEAT_LABEL = ['Você', 'Adversário', 'Parceiro', 'Adversário'];
/** Frequência com que o convidado atrasado pergunta se já pode assumir a vaga da IA. */
const CLAIM_POLL_MS = 3000;

/** Relógio de parede atualizado a cada segundo (só enquanto `active`). */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

export function LobbyScreen({ navigation, route }: RootScreenProps<'Lobby'>) {
  // Sala aguardando jogadores é antessala de partida: sem anúncio full-screen aqui.
  useMatchmakingGuard();
  const { code } = route.params;
  const uid = useAuthStore((s) => s.user?.uid);
  const [room, setRoom] = useState<Room | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  /** Vaga para a qual o dono está escolhendo um amigo (`null` = folha fechada). */
  const [pickingSeat, setPickingSeat] = useState<{ replace?: string } | null>(null);
  const navigated = useRef(false);
  const previous = useRef<Room | null | undefined>(undefined);
  const timeoutAsked = useRef(false);

  useEffect(
    () =>
      subscribeRoom(
        code,
        (r) => setRoom(r),
        (e) => setError(e.message),
      ),
    [code],
  );

  const isHost = room?.hostUid === uid;
  const mine = room ? myLobbyState(room, uid) : 'outside';

  // Avisos curtos para o dono: quem entrou e quem recusou.
  useEffect(() => {
    if (!room) return;
    if (isHost) {
      for (const change of inviteChanges(previous.current, room)) {
        if (change.kind === 'joined') toast.success(`${change.nickname} entrou na sala.`);
        else toast.info(`${change.nickname} não vai jogar.`);
      }
    }
    previous.current = room;
  }, [room, isHost]);

  useEffect(() => {
    if (!room || navigated.current) return;
    if (room.status === 'in_match' && room.sessionId && mine === 'inside') {
      navigated.current = true;
      logEvent('match_started', { mode: 'online', source: 'room' });
      navigation.replace('Game', { mode: 'online', sessionId: room.sessionId });
    } else if (room.status === 'closed' && mine !== 'late_pending') {
      navigated.current = true;
      toast.info('Sala encerrada', closedMessage(room, isHost));
      navigation.replace('Main', { screen: 'Play' });
    }
  }, [room, navigation, mine, isHost]);

  // Convidado que chegou depois do início: pergunta até a troca com a IA acontecer.
  const sessionId = room?.sessionId ?? null;
  useEffect(() => {
    if (mine !== 'late_pending' || !sessionId) return;
    let active = true;
    const poll = async () => {
      try {
        const { status } = await claimReservedSeat(sessionId);
        if (!active) return;
        if (status === 'seated') {
          active = false;
          navigated.current = true;
          logEvent('late_human_reclaimed_seat');
          navigation.replace('Game', { mode: 'online', sessionId });
        } else if (status === 'unavailable') {
          active = false;
          navigated.current = true;
          Alert.alert('Convite para jogar', 'A partida já começou.', [
            {
              text: 'Voltar ao início',
              onPress: () => navigation.replace('Main', { screen: 'Home' }),
            },
          ]);
        }
      } catch {
        // Sem rede: tenta de novo no próximo ciclo.
      }
    };
    void poll();
    const t = setInterval(() => void poll(), CLAIM_POLL_MS);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [mine, sessionId, navigation]);

  const hasCountdown =
    room?.status === 'waiting' && room.fillWithAi === 'on_timeout' && Boolean(room.inviteExpiresAt);
  const now = useNow(hasCountdown);
  const left = room ? lobbyRemaining(room, now) : null;

  // Fim da espera: qualquer um na sala pede, o servidor completa com IA e começa.
  useEffect(() => {
    if (left !== 0 || timeoutAsked.current || mine !== 'inside') return;
    timeoutAsked.current = true;
    logEvent('room_ai_fill', { trigger: 'timeout' });
    resolveLobbyTimeout(code).catch(() => {
      // Relógio do aparelho adiantado: tenta de novo em instantes.
      setTimeout(() => {
        timeoutAsked.current = false;
      }, 2000);
    });
  }, [left, code, mine]);

  const players = room ? Object.values(room.players ?? {}).sort((a, b) => a.seat - b.seat) : [];
  const me = uid ? room?.players?.[uid] : undefined;
  const humanCount = players.filter((p) => !p.bot).length;
  const allReady = players.length === 4 && players.every((p) => p.ready || p.bot);
  const mySeat = me?.seat ?? 0;
  const waiting = room?.status === 'waiting';
  const pendingInvites = Object.values(room?.invites ?? {}).filter((i) => i.status === 'PENDING');

  const share = async () => {
    await Share.share({
      message: `Bora um truco? Entre na minha sala no Truco Mineiro com o código ${code}`,
    });
  };
  const copy = async () => {
    await Clipboard.setStringAsync(code);
    toast.success('Código copiado');
  };

  const run = async (key: string, fn: () => Promise<unknown>, failTitle = 'Não deu certo') => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      toast.error(failTitle, e instanceof ApiError ? e.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  const toggleReady = () => me && run('ready', () => setReady(code, !me.ready));

  const start = () =>
    run('start', () => traced('match_start', () => startMatch(code)), 'Não foi possível iniciar');

  /** Não espera o relógio: completa as vagas com IA e começa (quando todos estão prontos). */
  const fillAndStart = () =>
    run('bots', async () => {
      logEvent('room_ai_fill', { trigger: 'host' });
      await fillRoomWithBots(code);
      if (me?.ready) await startMatch(code);
    });

  const pickFriend = (friendUid: string) => {
    const replace = pickingSeat?.replace;
    setPickingSeat(null);
    void run(
      'invite',
      async () => {
        if (replace) await removeRoomInvite(code, replace);
        await inviteToRoom(code, friendUid);
        logEvent('game_invite_sent', { friends: 1, replace: Boolean(replace) });
        toast.success('Convite enviado');
      },
      'Não foi possível convidar',
    );
  };

  const leave = () => {
    const pending = isHost && pendingInvites.length > 0;
    Alert.alert(
      isHost ? 'Cancelar a sala?' : 'Sair da sala?',
      isHost
        ? pending
          ? 'Os convites enviados deixam de valer.'
          : 'Todos os jogadores serão removidos.'
        : undefined,
      [
        { text: 'Voltar', style: 'cancel' },
        {
          text: isHost ? 'Cancelar sala' : 'Sair',
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

  const goBack = () => navigation.replace('Main', { screen: 'Play' });

  if (error) {
    return (
      <Screen>
        <GameHeader variant="title" title="Sala" showBack onBack={goBack} />
        <StateView kind="error" message={error} actionLabel="Voltar" onAction={goBack} />
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
        <GameHeader variant="title" title="Sala" showBack onBack={goBack} />
        <StateView
          kind="empty"
          icon="close-circle"
          title="Sala não existe mais"
          message="Este convite não está mais disponível."
          actionLabel="Voltar ao início"
          onAction={() => navigation.replace('Main', { screen: 'Home' })}
        />
      </Screen>
    );
  }
  if (mine === 'late_pending') {
    return (
      <Screen testID="screen-lobby-late">
        <GameHeader variant="title" title="Sala" showBack onBack={goBack} />
        <StateView
          kind="loading"
          title="Entrando na partida..."
          message="A partida já começou com a IA no seu lugar. Você assume no início da próxima mão."
          testID="lobby-late-pending"
        />
      </Screen>
    );
  }
  if (mine === 'started_without_me') {
    return (
      <Screen>
        <GameHeader variant="title" title="Sala" showBack onBack={goBack} />
        <StateView
          kind="empty"
          icon="time-outline"
          title="A partida já começou"
          message="Não há mais vaga para você nesta sala."
          actionLabel="Voltar ao início"
          onAction={() => navigation.replace('Main', { screen: 'Home' })}
          testID="lobby-started"
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
          <IconButton icon={icons.share} accessibilityLabel="Compartilhar código" onPress={share} />
        }
      />

      {left !== null ? (
        <Surface style={styles.waitCard} strong testID="lobby-countdown">
          <Ionicons name={icons.hourglass} size={18} color={colors.gold} />
          <View style={styles.waitTexts}>
            <AppText variant="bodyBold">
              {left > 0 ? 'Aguardando jogadores' : 'Completando com IA...'}
            </AppText>
            <AppText variant="caption" color={colors.textSecondary}>
              Quem não entrar a tempo é substituído pela IA.
            </AppText>
          </View>
          <AppText
            variant="h2"
            color={left <= 5000 ? colors.gold : colors.text}
            accessibilityLabel={`Faltam ${Math.ceil(left / 1000)} segundos`}
            testID="lobby-countdown-clock"
          >
            {formatCountdown(left)}
          </AppText>
        </Surface>
      ) : null}

      <Surface style={styles.codeCard} strong>
        <AppText variant="small" color={colors.textSecondary}>
          Código da sala
        </AppText>
        <View style={styles.codeRow}>
          <AppText variant="display" style={styles.code} testID="lobby-code">
            {code}
          </AppText>
          <IconButton icon={icons.copy} accessibilityLabel="Copiar código" onPress={copy} />
        </View>
        <AppText variant="caption" color={colors.textSecondary}>
          {room.status === 'starting'
            ? 'Iniciando partida...'
            : `${players.length}/4 jogadores  •  ${humanCount} ${humanCount === 1 ? 'pessoa' : 'pessoas'}`}
        </AppText>
      </Surface>

      <View style={styles.seats}>
        {[0, 1, 2, 3].map((seat) => {
          const relative = (seat - mySeat + 4) % 4;
          const state = seatState(room, seat);
          // Convidado que ainda não entrou pode ser trocado por outro amigo antes do início.
          const canSwap = isHost && waiting && state.kind === 'invite';
          return (
            <SeatCard
              key={seat}
              seat={seat}
              state={state}
              label={SEAT_LABEL[relative]!}
              team={seat % 2 === mySeat % 2 ? 'Nós' : 'Eles'}
              isHost={state.kind === 'player' && state.player.uid === room.hostUid}
              action={
                canSwap && state.kind === 'invite'
                  ? {
                      label: 'Trocar',
                      onPress: () => setPickingSeat({ replace: state.invite.uid }),
                    }
                  : isHost && waiting && seat !== 0 && state.kind === 'empty'
                    ? { label: 'Convidar', onPress: () => setPickingSeat({}) }
                    : undefined
              }
            />
          );
        })}
      </View>

      <AppText variant="small" center color={colors.textSecondary} style={styles.hint}>
        Você joga com o Parceiro, sentado à sua frente.
        {room.invites ? '' : ' Compartilhe o código para os amigos entrarem.'}
      </AppText>

      <View style={styles.actions}>
        {isHost ? (
          <>
            <PrimaryButton
              label={busy === 'start' ? 'Iniciando...' : 'Começar partida'}
              onPress={start}
              loading={busy === 'start'}
              disabled={!allReady || !waiting}
              testID="lobby-start"
            />
            {players.length < 4 && waiting ? (
              <SecondaryButton
                label={me?.ready ? 'Completar com IA e começar' : 'Completar com IA'}
                icon={icons.robot}
                onPress={fillAndStart}
                loading={busy === 'bots'}
                style={styles.gap}
                testID="lobby-fill-bots"
              />
            ) : null}
            {!allReady && players.length === 4 ? (
              <AppText variant="caption" center color={colors.textSecondary} style={styles.note}>
                Aguardando todos ficarem prontos.
              </AppText>
            ) : null}
            {me && !me.ready ? (
              <SecondaryButton
                label="Marcar como pronto"
                onPress={toggleReady}
                loading={busy === 'ready'}
                style={styles.gap}
              />
            ) : null}
          </>
        ) : me && !me.ready ? (
          <PrimaryButton
            label="Estou pronto"
            onPress={toggleReady}
            loading={busy === 'ready'}
            testID="lobby-ready"
          />
        ) : (
          <AppText variant="small" center color={colors.textSecondary} testID="lobby-wait-host">
            Você está pronto. A partida começa quando o anfitrião iniciar.
          </AppText>
        )}
        <SecondaryButton
          label={isHost ? 'Cancelar sala' : 'Sair da sala'}
          icon={icons.logout}
          onPress={leave}
          style={styles.gap}
          testID="lobby-leave"
        />
      </View>

      <FriendPickerSheet
        visible={pickingSeat !== null}
        uid={uid}
        exclude={[
          ...(pickingSeat?.replace ? [pickingSeat.replace] : []),
          ...players.map((p) => p.uid),
          ...Object.values(room.invites ?? {})
            .filter((i) => i.status === 'PENDING' || i.status === 'ACCEPTED')
            .map((i) => i.uid),
        ]}
        onClose={() => setPickingSeat(null)}
        onPick={pickFriend}
      />
    </Screen>
  );
}

function SeatCard({
  seat,
  state,
  label,
  team,
  isHost,
  action,
}: {
  seat: number;
  state: SeatState;
  label: string;
  team: string;
  isHost: boolean;
  action?: { label: string; onPress: () => void };
}) {
  const ok =
    state.kind === 'player' &&
    (state.label === 'IA' || state.label === 'Entrou' || state.label === 'Pronto');
  const statusColor =
    state.kind === 'invite' && state.label === 'Recusou'
      ? colors.dangerSoft
      : ok
        ? colors.primaryBright
        : colors.textSecondary;
  const name =
    state.kind === 'player'
      ? state.player.nickname
      : state.kind === 'invite'
        ? state.invite.nickname
        : 'Vaga livre';
  const status = state.kind === 'empty' ? 'Aguardando jogador' : state.label;
  return (
    <Surface
      style={[styles.seat, ok ? styles.seatReady : {}]}
      padding={10}
      testID={`lobby-seat-${seat}`}
    >
      {state.kind === 'player' || state.kind === 'invite' ? (
        <PlayerAvatar
          avatarId={state.kind === 'player' ? state.player.avatarId : state.invite.avatarId}
          size={56}
          ringColor={ok ? colors.primaryBright : colors.cardBorderStrong}
          style={state.kind === 'invite' ? styles.faded : undefined}
        />
      ) : (
        <View style={styles.emptySeat}>
          <Ionicons name={icons.personAdd} size={24} color={colors.textMuted} />
        </View>
      )}
      <AppText
        variant="bodyBold"
        numberOfLines={1}
        color={state.kind === 'empty' ? colors.textMuted : colors.text}
        style={styles.seatName}
        accessibilityLabel={`${label}, ${team}: ${name}, ${status}`}
      >
        {name}
      </AppText>
      <View style={styles.seatMeta}>
        {isHost ? <Ionicons name={icons.star} size={12} color={colors.gold} /> : null}
        {state.kind === 'invite' && state.label === 'Aguardando...' ? (
          <Ionicons name={icons.hourglass} size={11} color={colors.textSecondary} />
        ) : null}
        <AppText variant="caption" color={statusColor} testID={`lobby-seat-status-${seat}`}>
          {state.kind === 'invite' && state.label === 'Aguardando...'
            ? 'Convidado · aguardando'
            : status}
        </AppText>
        {state.kind === 'player' && state.player.connected === false ? (
          <Ionicons name={icons.wifiOff} size={12} color={colors.dangerSoft} />
        ) : null}
      </View>
      {action ? (
        <PillButton
          label={action.label}
          variant="muted"
          onPress={action.onPress}
          style={styles.seatAction}
          testID={`lobby-seat-action-${seat}`}
        />
      ) : null}
      <View style={styles.seatTag}>
        <AppText variant="caption" color={colors.textSecondary}>
          {label} • {team}
        </AppText>
      </View>
    </Surface>
  );
}

const styles = StyleSheet.create({
  waitCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
    paddingVertical: 12,
  },
  waitTexts: { flex: 1 },
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
  seatName: { marginTop: 6 },
  seatMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  seatAction: { marginTop: 6 },
  faded: { opacity: 0.55 },
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
  hint: { marginTop: spacing.md },
  actions: { marginTop: spacing.xl },
  gap: { marginTop: spacing.sm },
  note: { marginTop: 8 },
});
