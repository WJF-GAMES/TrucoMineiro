import React, { useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, { FadeInDown, FadeOut, ZoomIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, gradients, radius, spacing } from '@/design-system';
import {
  AppText,
  IconButton,
  PlayerAvatar,
  PrimaryButton,
  SecondaryButton,
  StateView,
  Surface,
} from '@/components';
import { Card, cardId, nextStake, Seat, stakeName, teamOf, GameEvent } from '@/domain/game';
import type { TableController, TablePlayer } from '@/features/game/types';
import { relativePosition, type TablePosition } from '@/features/game/seatLayout';
import { useShuffleCeremony } from '@/features/game/useShuffleCeremony';
import { PlayingCard } from './PlayingCard';
import { DraggableCard } from './DraggableCard';
import { CeremonyStagePill, TableCeremony } from './TableCeremony';
import { haptic } from '@/utils/haptics';

interface Props {
  controller: TableController;
  onExit: () => void;
}

const CALL_LABELS: Record<string, string> = { 3: 'TRUCO!', 6: 'SEIS!', 9: 'NOVE!', 12: 'DOZE!' };

export function GameTable({ controller, onExit }: Props) {
  const insets = useSafeAreaInsets();
  const { view, players, mySeat, availableActions, busy, act, status } = controller;
  const [banner, setBanner] = useState<{ text: string; color: string; key: number } | null>(null);
  const [seenEvents, setSeenEvents] = useState<GameEvent[] | null>(null);

  const bySeat = useMemo(() => {
    const map = new Map<Seat, TablePlayer>();
    players.forEach((p) => map.set(p.seat, p));
    return map;
  }, [players]);

  // Announce notable events with a short banner (derived when a new event batch arrives).
  if (controller.recentEvents !== seenEvents) {
    setSeenEvents(controller.recentEvents);
    const last = [...controller.recentEvents]
      .reverse()
      .find((e) =>
        [
          'TRUCO_REQUESTED',
          'TRUCO_RAISED',
          'TRUCO_ACCEPTED',
          'RAN',
          'HAND_ENDED',
          'ROUND_ENDED',
          'MAO_DE_ONZE_DECLINED',
        ].includes(e.type),
      );
    const text = last ? describeEvent(last, bySeat, mySeat) : null;
    if (text) setBanner({ text: text.text, color: text.color, key: (banner?.key ?? 0) + 1 });
  }

  useEffect(() => {
    if (!banner) return;
    haptic.light();
    const t = setTimeout(() => setBanner(null), 1600);
    return () => clearTimeout(t);
  }, [banner]);

  /**
   * Cerimônia de início de mão: embaralhar → cortar → distribuir. Só entra numa mão que está
   * realmente começando — quem reconecta no meio da mão cai direto na mesa, sem ritual.
   * Precisa ficar antes dos `return` de loading/erro: é um hook.
   */
  const tableLive = status === 'playing' || status === 'reconnecting';
  const freshHand =
    tableLive &&
    !!view &&
    view.rounds.length === 0 &&
    view.currentRound.length === 0 &&
    view.myCards.length === 3;
  const ceremony = useShuffleCeremony({
    handNumber: view?.handNumber ?? 0,
    dealerSeat: view?.dealerSeat ?? null,
    mySeat,
    eligible: freshHand,
    paused: status === 'reconnecting',
  });

  // Enquanto o baralho está sendo embaralhado ninguém joga — nem os bots. Sem isto a mão já
  // começaria andada por trás da cerimônia.
  const { setBotsPaused } = controller;
  useEffect(() => {
    setBotsPaused(ceremony.active);
    return () => setBotsPaused(false);
  }, [ceremony.active, setBotsPaused]);

  if (status === 'loading' || !view)
    return (
      <StateView kind="loading" title="Preparando a mesa..." message="Embaralhando as cartas." />
    );
  if (status === 'error')
    return (
      <StateView
        kind="error"
        message={controller.errorMessage ?? undefined}
        actionLabel="Sair"
        onAction={onExit}
      />
    );

  const myTeam = teamOf(mySeat);
  const us = view.scores[myTeam];
  const them = view.scores[myTeam === 0 ? 1 : 0];
  const isMyTurn = view.phase === 'PLAY' && view.turnSeat === mySeat;
  const canPlay = availableActions.includes('PLAY_CARD') && !busy;
  const canTruco = availableActions.includes('REQUEST_TRUCO') && !busy;
  const responding = availableActions.includes('ACCEPT_TRUCO');
  const maoDeOnze = availableActions.includes('ACCEPT_MAO_DE_ONZE');
  const nextValue =
    view.phase === 'TRUCO_RESPONSE' ? (view.proposedValue ?? 3) : (nextStake(view.handValue) ?? 12);
  const turnPlayer = bySeat.get(view.turnSeat);

  const seatAt = (pos: TablePosition) => players.find((p) => relativePosition(p.seat, mySeat) === pos);
  const playedBy = (seat?: Seat): Card | null =>
    seat === undefined ? null : (view.currentRound.find((p) => p.seat === seat)?.card ?? null);

  const top = seatAt('top');
  const left = seatAt('left');
  const right = seatAt('right');

  const confirmExit = () => {
    Alert.alert('Sair da partida?', 'Sair agora conta como abandono.', [
      { text: 'Continuar jogando', style: 'cancel' },
      { text: 'Sair', style: 'destructive', onPress: onExit },
    ]);
  };

  return (
    <View style={styles.root} testID="screen-game">
      <LinearGradient colors={gradients.table} style={StyleSheet.absoluteFill} />
      <View style={styles.felt} pointerEvents="none" />

      {/* Header: score, hand value, rounds */}
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <IconButton
          icon="close"
          accessibilityLabel="Sair da partida"
          onPress={confirmExit}
          size={22}
        />
        <Surface padding={0} style={styles.scoreCard}>
          <View style={styles.scoreSide}>
            <AppText variant="caption" color={colors.textSecondary}>
              NÓS
            </AppText>
            <AppText variant="stat" color={colors.primaryBright} testID="score-us">
              {us}
            </AppText>
          </View>
          <View style={styles.scoreMid}>
            {ceremony.active ? (
              <CeremonyStagePill stage={ceremony.stage} />
            ) : (
              <>
                <AppText variant="caption" color={colors.textSecondary}>
                  MÃO {view.handNumber}
                </AppText>
                <View style={styles.valuePill}>
                  <AppText variant="smallBold" color={colors.textDark}>
                    VALE {view.handValue}
                  </AppText>
                </View>
                <View style={styles.rounds}>
                  {[0, 1, 2].map((i) => {
                    const r = view.rounds[i];
                    const c = !r
                      ? 'rgba(255,255,255,0.2)'
                      : r.winner === null
                        ? colors.gold
                        : r.winner === myTeam
                          ? colors.primaryBright
                          : colors.dangerSoft;
                    return <View key={i} style={[styles.roundDot, { backgroundColor: c }]} />;
                  })}
                </View>
              </>
            )}
          </View>
          <View style={styles.scoreSide}>
            <AppText variant="caption" color={colors.textSecondary}>
              ELES
            </AppText>
            <AppText variant="stat" color={colors.dangerSoft} testID="score-them">
              {them}
            </AppText>
          </View>
        </Surface>
        <View style={{ width: 44 }} />
      </View>

      {ceremony.active ? (
        <TableCeremony
          ceremony={ceremony}
          players={players}
          mySeat={mySeat}
          reconnecting={status === 'reconnecting'}
        />
      ) : (
        <>
        {/* Table: three opponents around the felt and the played cards in a cross */}
        <View style={styles.table}>
          <View style={styles.seatTop}>
            <SeatInfo player={top} view={view} row />
          </View>
          <View style={styles.seatLeft}>
            <SeatInfo player={left} view={view} />
          </View>
          <View style={styles.seatRight}>
            <SeatInfo player={right} view={view} />
          </View>

          <View style={styles.cross} pointerEvents="none">
            <PlayedSlot card={playedBy(top?.seat)} style={styles.crossTop} />
            <PlayedSlot card={playedBy(left?.seat)} style={styles.crossLeft} />
            <PlayedSlot card={playedBy(right?.seat)} style={styles.crossRight} />
            <PlayedSlot card={playedBy(mySeat)} style={styles.crossBottom} mine />
          </View>
        </View>

        {/* Status line */}
        <View style={styles.statusLine}>
          {status === 'reconnecting' ? (
            <View style={styles.statusPill}>
              <Ionicons name="cloud-offline" size={14} color={colors.gold} />
              <AppText variant="smallBold" style={{ marginLeft: 6 }}>
                Reconectando...
              </AppText>
            </View>
          ) : view.phase === 'TRUCO_RESPONSE' ? (
            <AppText variant="smallBold" color={colors.gold} center>
              {view.trucoRequesterTeam === myTeam
                ? `Aguardando resposta ao ${stakeName(view.proposedValue ?? 3)}...`
                : `Pediram ${stakeName(view.proposedValue ?? 3)}! Aceitar, aumentar ou correr?`}
            </AppText>
          ) : view.phase === 'MAO_DE_ONZE' ? (
            <AppText variant="smallBold" color={colors.gold} center>
              {view.maoDeOnzeTeam === myTeam
                ? 'Mão de onze! Jogar valendo 3 ou entregar 1?'
                : 'Os adversários decidem a mão de onze...'}
            </AppText>
          ) : isMyTurn ? (
            <AppText variant="smallBold" color={colors.primaryBright} center>
              Sua vez! Escolha uma carta.
            </AppText>
          ) : (
            <AppText variant="small" color={colors.textSecondary} center>
              Vez de {turnPlayer?.nickname ?? '...'}
            </AppText>
          )}
        </View>

        {/* My hand */}
        <View style={[styles.handArea, { paddingBottom: Math.max(insets.bottom, 10) }]}>
          <View style={styles.meRow}>
            <PlayerAvatar
              avatarId={bySeat.get(mySeat)?.avatarId}
              size={38}
              ringColor={isMyTurn ? colors.primaryBright : colors.cardBorderStrong}
            />
            <AppText variant="smallBold" style={{ marginLeft: 8, flex: 1 }} numberOfLines={1}>
              {bySeat.get(mySeat)?.nickname ?? 'Você'}
            </AppText>
            <AppText variant="caption" color={colors.textSecondary}>
              {bySeat.get(seatAt('top')?.seat ?? mySeat) ? `parceiro: ${top?.nickname ?? '-'}` : ''}
            </AppText>
          </View>
          <View style={styles.hand} testID="my-hand">
            {view.myCards.map((c, i) => (
              <Animated.View key={cardId(c)} entering={FadeInDown.delay(i * 80)}>
                <DraggableCard
                  card={c}
                  width={82}
                  onPlay={
                    canPlay
                      ? () => act({ type: 'PLAY_CARD', seat: mySeat, cardId: cardId(c) })
                      : undefined
                  }
                  disabled={!canPlay}
                  dimmed={!canPlay && view.phase === 'PLAY'}
                  highlighted={canPlay}
                />
              </Animated.View>
            ))}
          </View>

          {/* Actions come strictly from availableActions */}
          <View style={styles.actions}>
            {maoDeOnze ? (
              <>
                <PrimaryButton
                  label="Jogar (vale 3)"
                  size="md"
                  style={styles.actionBtn}
                  onPress={() => act({ type: 'ACCEPT_MAO_DE_ONZE', seat: mySeat })}
                  disabled={busy}
                />
                <SecondaryButton
                  label="Entregar 1"
                  size="md"
                  style={styles.actionBtn}
                  onPress={() => act({ type: 'DECLINE_MAO_DE_ONZE', seat: mySeat })}
                  disabled={busy}
                />
              </>
            ) : responding ? (
              <>
                <PrimaryButton
                  label="Aceitar"
                  size="md"
                  style={styles.actionBtn}
                  onPress={() => act({ type: 'ACCEPT_TRUCO', seat: mySeat })}
                  disabled={busy}
                  testID="action-accept"
                />
                {availableActions.includes('RAISE') ? (
                  <SecondaryButton
                    label={stakeName(nextStake(view.proposedValue ?? 3) ?? 12)}
                    size="md"
                    style={styles.actionBtn}
                    onPress={() => act({ type: 'RAISE', seat: mySeat })}
                    disabled={busy}
                    testID="action-raise"
                  />
                ) : null}
                <SecondaryButton
                  label="Correr"
                  size="md"
                  style={styles.actionBtn}
                  onPress={() => act({ type: 'RUN', seat: mySeat })}
                  disabled={busy}
                  testID="action-run"
                />
              </>
            ) : canTruco ? (
              <SecondaryButton
                label={CALL_LABELS[nextValue] ?? `Pedir ${nextValue}`}
                size="md"
                icon="flame"
                style={styles.trucoBtn}
                onPress={() => act({ type: 'REQUEST_TRUCO', seat: mySeat })}
                disabled={busy}
                testID="action-truco"
              />
            ) : null}
          </View>
        </View>
        </>
      )}

      {/* Resultado da mão anterior. Fica fora do ramo acima porque a mão seguinte já começa com a
          cerimônia: sem isto o "+2 pra nós!" nunca chegaria a aparecer. */}
      {banner ? (
        <Animated.View
          key={banner.key}
          entering={ZoomIn.duration(200)}
          exiting={FadeOut}
          style={[styles.banner, ceremony.active && styles.bannerCeremony]}
          pointerEvents="none"
        >
          <AppText variant="h1" center style={[styles.bannerText, { color: banner.color }]}>
            {banner.text}
          </AppText>
        </Animated.View>
      ) : null}
    </View>
  );
}

/** Avatar, nickname and the face-down cards still in hand for one opponent/partner. */
function SeatInfo({
  player,
  view,
  row,
}: {
  player?: TablePlayer;
  view: NonNullable<TableController['view']>;
  row?: boolean;
}) {
  if (!player) return <View />;
  const isTurn = view.phase === 'PLAY' && view.turnSeat === player.seat;
  const count = view.cardCounts[player.seat] ?? 0;
  return (
    <View style={[styles.seatInfo, row && styles.seatInfoRow]} testID={`seat-${player.seat}`}>
      <View>
        <PlayerAvatar
          avatarId={player.avatarId}
          size={46}
          ringColor={
            isTurn
              ? colors.primaryBright
              : player.connected
                ? colors.cardBorderStrong
                : colors.dangerSoft
          }
        />
        {!player.connected ? (
          <View style={styles.disconnected}>
            <Ionicons name="cloud-offline" size={11} color={colors.text} />
          </View>
        ) : null}
      </View>
      <View style={[styles.seatMeta, row && { marginLeft: 8, marginTop: 0 }]}>
        <AppText variant="caption" numberOfLines={1} style={styles.seatName}>
          {player.nickname}
        </AppText>
        <View style={styles.backs}>
          {Array.from({ length: count }).map((_, i) => (
            <PlayingCard
              key={i}
              faceDown
              width={20}
              style={i === 0 ? undefined : styles.backOverlap}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

function PlayedSlot({ card, style, mine }: { card: Card | null; style: object; mine?: boolean }) {
  const width = mine ? 60 : 54;
  if (!card) {
    return <View style={[styles.slot, style, { width, height: Math.round(width * 1.45) }]} />;
  }
  return (
    <Animated.View entering={ZoomIn.duration(220)} style={style}>
      <PlayingCard card={card} width={width} />
    </Animated.View>
  );
}

function describeEvent(
  e: GameEvent,
  bySeat: Map<Seat, TablePlayer>,
  mySeat: Seat,
): { text: string; color: string } | null {
  const myTeam = teamOf(mySeat);
  switch (e.type) {
    case 'TRUCO_REQUESTED':
    case 'TRUCO_RAISED':
      return { text: CALL_LABELS[e.value] ?? `${e.value}!`, color: colors.gold };
    case 'TRUCO_ACCEPTED':
      return { text: 'ACEITO!', color: colors.primaryBright };
    case 'RAN':
      return teamOf(e.seat) === myTeam
        ? { text: 'CORREMOS', color: colors.dangerSoft }
        : { text: 'CORRERAM!', color: colors.primaryBright };
    case 'ROUND_ENDED':
      if (e.winner === null) return { text: 'EMPATOU', color: colors.gold };
      return e.winner === myTeam
        ? {
            text: `${bySeat.get(e.winnerSeat)?.nickname ?? 'Nós'} levou!`,
            color: colors.primaryBright,
          }
        : { text: 'Eles levaram', color: colors.dangerSoft };
    case 'HAND_ENDED':
      if (e.result.winner === null) return { text: 'MÃO EMPATADA', color: colors.gold };
      return e.result.winner === myTeam
        ? { text: `+${e.result.points} pra nós!`, color: colors.primaryBright }
        : { text: `+${e.result.points} pra eles`, color: colors.dangerSoft };
    case 'MAO_DE_ONZE_DECLINED':
      return { text: 'Entregaram 1 ponto', color: colors.gold };
    default:
      return null;
  }
}

const CROSS = 200;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bgTop },
  felt: {
    position: 'absolute',
    left: '7%',
    right: '7%',
    top: '19%',
    bottom: '40%',
    borderRadius: 180,
    backgroundColor: 'rgba(20, 110, 70, 0.2)',
    borderWidth: 2,
    borderColor: 'rgba(120, 220, 160, 0.14)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.screen,
  },
  scoreCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    flex: 1,
    marginHorizontal: 8,
    justifyContent: 'space-between',
  },
  scoreSide: { alignItems: 'center', minWidth: 44 },
  scoreMid: { alignItems: 'center' },
  valuePill: {
    backgroundColor: colors.gold,
    paddingHorizontal: 10,
    paddingVertical: 2,
    borderRadius: radius.pill,
    marginTop: 2,
  },
  rounds: { flexDirection: 'row', gap: 5, marginTop: 5 },
  roundDot: { width: 9, height: 9, borderRadius: 5 },

  table: { flex: 1, position: 'relative' },
  seatTop: { position: 'absolute', top: 4, left: 0, right: 0, alignItems: 'center' },
  seatLeft: { position: 'absolute', left: spacing.sm, top: '38%' },
  seatRight: { position: 'absolute', right: spacing.sm, top: '38%' },
  seatInfo: { alignItems: 'center' },
  seatInfoRow: { flexDirection: 'row', alignItems: 'center' },
  seatMeta: { alignItems: 'center', marginTop: 4 },
  seatName: { maxWidth: 96, textAlign: 'center' },
  backs: { flexDirection: 'row', marginTop: 3 },
  backOverlap: { marginLeft: -9 },
  disconnected: {
    position: 'absolute',
    right: -4,
    top: -4,
    backgroundColor: colors.dangerSoft,
    borderRadius: 9,
    width: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },

  cross: {
    position: 'absolute',
    width: CROSS,
    height: CROSS,
    alignSelf: 'center',
    top: '26%',
  },
  crossTop: { position: 'absolute', top: 0, left: CROSS / 2 - 27 },
  crossLeft: { position: 'absolute', left: 0, top: CROSS / 2 - 39 },
  crossRight: { position: 'absolute', right: 0, top: CROSS / 2 - 39 },
  crossBottom: { position: 'absolute', bottom: 0, left: CROSS / 2 - 30 },
  slot: {
    borderRadius: 8,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: 'rgba(255,255,255,0.12)',
  },

  banner: { position: 'absolute', left: 0, right: 0, top: '40%', alignItems: 'center' },
  // Durante a cerimônia o miolo da tela é do baralho: o aviso sobe para logo abaixo do placar.
  bannerCeremony: { top: '15%' },
  bannerText: {
    fontSize: 30,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowRadius: 6,
    textShadowOffset: { width: 0, height: 2 },
  },
  statusLine: {
    minHeight: 26,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
    marginBottom: 4,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderWidth: 1,
    borderColor: colors.gold,
  },
  handArea: {
    backgroundColor: 'rgba(0, 20, 14, 0.62)',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 10,
    paddingHorizontal: spacing.screen,
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
  },
  meRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  hand: { flexDirection: 'row', justifyContent: 'center', gap: 10, minHeight: 122 },
  actions: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 10, minHeight: 48 },
  actionBtn: { minWidth: 104 },
  trucoBtn: {
    minWidth: 150,
    borderColor: colors.gold,
    backgroundColor: 'rgba(120, 70, 0, 0.55)',
  },
});
