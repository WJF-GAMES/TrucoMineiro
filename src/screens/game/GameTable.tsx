import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, { FadeIn, FadeOut, LinearTransition, ZoomIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, gradients, icons, radius, spacing } from '@/design-system';
import {
  AppText,
  CountdownRing,
  CountdownText,
  IconButton,
  PlayerAvatar,
  PrimaryButton,
  SecondaryButton,
  StateView,
  Surface,
} from '@/components';
import { cardId, nextStake, Seat, stakeName, teamOf, GameEvent } from '@/domain/game';
import type { TableController, TablePlayer } from '@/features/game/types';
import { relativePosition, type TablePosition } from '@/features/game/seatLayout';
import { useCeremony } from '@/features/game/useCeremony';
import { useTrickPresentation } from '@/features/game/useTrickPresentation';
import { CANGO_COPY, isHolding, type TrickPresentation } from '@/features/game/trickPresentation';
import { useTurnTimer } from '@/features/game/useTurnTimer';
import { TURN_TIMING, formatTurnClock } from '@/features/game/turnTimer';
import { PlayingCard } from './PlayingCard';
import { HandCard } from './HandCard';
import { TrickCard, type TrickCardStatus } from './TrickCard';
import { HandRevealOverlay } from './HandRevealOverlay';
import { useHandReveal } from '@/features/game/handReveal';
import { useMatchKeepAwake } from '@/features/game/useMatchKeepAwake';
import { CeremonyStagePill, TableCeremony } from './TableCeremony';
import { MatchCountdown } from './MatchCountdown';
import { DealOverlay, type DealTargets, type Point } from './DealOverlay';
import { haptic } from '@/utils/haptics';
import { logEvent } from '@/services/firebase/analytics';

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
          'MAO_DE_ONZE_DECLINED',
        ].includes(e.type),
      );
    const text = last ? describeEvent(last, bySeat, mySeat, controller.recentEvents) : null;
    if (text) setBanner({ text: text.text, color: text.color, key: (banner?.key ?? 0) + 1 });
  }

  // Telemetria do cango (opcional; a regra é do motor). Uma vez por versão: online o mesmo lote
  // pode chegar em mais de um snapshot.
  const loggedVersion = useRef<number | null>(null);
  const version = controller.view?.version ?? null;
  useEffect(() => {
    if (version === null || loggedVersion.current === version) return;
    loggedVersion.current = version;
    let round = 0;
    for (const e of controller.recentEvents) {
      if (e.type === 'ROUND_ENDED') {
        round = e.round + 1;
        if (e.winner === null) logEvent('trick_tied', { round });
      }
      if (e.type === 'TIE_BREAK_STARTED')
        logEvent('cango_tiebreak_started', { round: e.round + 1, continued: e.continued });
      if (e.type === 'HAND_ENDED' && e.result.decidedBy === 'CANGO_TIE_BREAK')
        logEvent('cango_tiebreak_resolved', { round });
    }
  }, [version, controller.recentEvents]);

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
  // Partida em andamento: a tela não apaga sozinha. Ao terminar/sair, volta o normal.
  useMatchKeepAwake(tableLive);
  // Abertura da partida: "3, 2, 1, Valendo!" antes do primeiro embaralho. Só na primeira mão,
  // antes de qualquer ação — quem reconecta no meio não vê contagem.
  const [countdownDone, setCountdownDone] = useState(false);
  const countdownActive =
    tableLive && !!view && view.handNumber === 1 && view.version === 0 && !countdownDone;
  const finishCountdown = useCallback(() => setCountdownDone(true), []);
  // A vaza que fechou a mão anterior ainda está na mesa: a cerimônia da mão nova espera por ela.
  const trick = useTrickPresentation(view, controller.recentEvents);
  const holding = isHolding(trick);
  // Correram da mão de onze: a mesa mostra as cartas de todos antes da mão seguinte.
  const reveal = useHandReveal(controller.recentEvents, view?.version ?? null);
  const revealing = reveal !== null;
  // Cerimônia dirigida pelo motor (SHUFFLING/CUTTING) + distribuição local depois do corte.
  // Ela espera a vaza anterior sair da mesa, a revelação e a contagem inicial acabarem.
  const ceremonyHeld = !tableLive || holding || revealing || countdownActive;
  // Relógio da jogada local: corre para carta, truco, mão de onze e também para embaralhar e
  // cortar (o estouro fecha o embaralhamento / corta no meio).
  const myMove = availableActions.length > 0 && !holding && !revealing && !countdownActive && !busy;
  const deadlineAt = useTurnTimer({
    view,
    mySeat,
    myMove,
    paused: status === 'reconnecting',
    act,
    serverDeadline: controller.serverDeadline,
  });
  const ceremony = useCeremony({
    view,
    mySeat,
    recentEvents: controller.recentEvents,
    deadlineAt,
    act,
    held: ceremonyHeld,
  });
  const tableHold = ceremony.active || countdownActive;

  // Enquanto o baralho está sendo embaralhado ninguém joga — nem os bots. Sem isto a mão já
  // começaria andada por trás da cerimônia.
  const { setBotsPaused } = controller;
  // Bots só param durante a distribuição (a mesa está mostrando as cartas voando); no embaralho e
  // no corte eles agem pelo motor como qualquer jogador.
  const botsHold = countdownActive || revealing || (ceremony.active && ceremony.stage === 'deal');

  // Distribuição: as cartas voam do baralho até as posições reais (montinhos e slots da mão).
  // As posições são medidas na hora em que o estágio começa — a mesa está montada por baixo.
  const bodyRef = useRef<View>(null);
  const crossRef = useRef<View>(null);
  const handRef = useRef<View>(null);
  /**
   * Trava de jogada dupla: a versão da view em que o jogador tocou uma carta. Até a view mudar,
   * nenhuma outra carta responde — dois toques rápidos não viram duas jogadas.
   */
  const [playLock, setPlayLock] = useState<number | null>(null);
  const locked = playLock !== null && playLock === view?.version;
  useEffect(() => {
    if (!locked) return;
    // Jogada recusada (rede, versão velha): a vez continua e a mão volta a responder.
    const t = setTimeout(() => setPlayLock(null), 2500);
    return () => clearTimeout(t);
  }, [locked]);
  /** Modo "virada" armado para a decisão atual (a versão em que foi armado). */
  const [coverArmedAt, setCoverArmedAt] = useState<number | null>(null);
  /**
   * Altura real da mesa. A cruz de cartas tem tamanho fixo e ficava ancorada em 22% do topo:
   * num aparelho baixo (320x640 e afins) a carta de baixo caía em cima do meu próprio avatar e
   * do rótulo "Ganhando". Medindo a mesa dá para centrar a cruz na faixa que sobra entre o
   * assento de cima e o meu, e encolhê-la quando essa faixa é menor que ela (regras 21 e 78).
   */
  const [tableHeight, setTableHeight] = useState(0);
  const backsRefs = useRef<Record<'top' | 'left' | 'right', View | null>>({
    top: null,
    left: null,
    right: null,
  });
  const [dealTargets, setDealTargets] = useState<DealTargets | null>(null);
  const commitTargets = useCallback((t: DealTargets) => setDealTargets(t), []);
  const dealing = ceremony.active && ceremony.stage === 'deal';
  useEffect(() => {
    // Fora da distribuição as posições ficam guardadas (o layout é o mesmo); só a próxima
    // distribuição as mede de novo.
    if (!dealing) return;
    let cancelled = false;
    const body = bodyRef.current;
    if (!body) return;
    body.measureInWindow((bx, by) => {
      const centerOf = (node: View | null): Promise<Point | null> =>
        new Promise((resolve) => {
          if (!node) return resolve(null);
          node.measureInWindow((x, y, w, h) => resolve({ x: x - bx + w / 2, y: y - by + h / 2 }));
        });
      void Promise.all([
        centerOf(crossRef.current),
        centerOf(backsRefs.current.top),
        centerOf(backsRefs.current.left),
        centerOf(backsRefs.current.right),
        new Promise<{ cx: number; cy: number } | null>((resolve) => {
          const hand = handRef.current;
          if (!hand) return resolve(null);
          hand.measureInWindow((x, y, w, h) => resolve({ cx: x - bx + w / 2, cy: y - by + h / 2 }));
        }),
      ]).then(([origin, top, left, right, hand]) => {
        if (cancelled || !origin || !hand) return;
        const step = 82 + 10; // largura da carta na mão + gap
        commitTargets({
          origin,
          seats: { top: top ?? undefined, left: left ?? undefined, right: right ?? undefined },
          hand: [-1, 0, 1].map((i) => ({ x: hand.cx + i * step, y: hand.cy })),
        });
      });
    });
    return () => {
      cancelled = true;
    };
  }, [dealing, commitTargets]);

  useEffect(() => {
    setBotsPaused(botsHold);
    return () => setBotsPaused(false);
  }, [botsHold, setBotsPaused]);

  const crossLayout = useMemo(() => {
    if (!tableHeight) return { top: '22%' as const, scale: 1 };
    const free = Math.max(0, tableHeight - SEAT_TOP_SPACE - SEAT_ME_SPACE);
    // Nunca menor que 70%: abaixo disso as cartas da mesa ficam pequenas demais para ler.
    const scale = Math.max(0.7, Math.min(1, free / CROSS));
    const centre = SEAT_TOP_SPACE + free / 2;
    return { top: centre - CROSS / 2, scale };
  }, [tableHeight]);

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
  const canPlay =
    availableActions.includes('PLAY_CARD') &&
    !busy &&
    !holding &&
    !revealing &&
    !tableHold &&
    !locked;
  // Carta virada: só quando o motor libera (nunca no desempate por cango).
  const canCover = canPlay && availableActions.includes('PLAY_CARD_COVERED');
  const coverArmed = canCover && coverArmedAt === view.version;
  const playCard = (id: string) => {
    setPlayLock(view.version);
    setCoverArmedAt(null);
    void act({ type: coverArmed ? 'PLAY_CARD_COVERED' : 'PLAY_CARD', seat: mySeat, cardId: id });
  };
  const canTruco = availableActions.includes('REQUEST_TRUCO') && !busy && !holding && !tableHold;
  const responding = availableActions.includes('ACCEPT_TRUCO');
  const maoDeOnze = availableActions.includes('ACCEPT_MAO_DE_ONZE');
  const nextValue =
    view.phase === 'TRUCO_RESPONSE' ? (view.proposedValue ?? 3) : (nextStake(view.handValue) ?? 12);
  const turnPlayer = bySeat.get(view.turnSeat);
  // Desempate por cango: quais cartas valem vem pronto do motor (só a maior).
  const tieBreak = view.phase === 'PLAY' ? view.tieBreak : null;
  const playable = new Set(view.playableCardIds);

  const seatAt = (pos: TablePosition) =>
    players.find((p) => relativePosition(p.seat, mySeat) === pos);
  const me = bySeat.get(mySeat);
  // Enquanto a última vaza da mão ainda está na mesa, a view já é da mão seguinte: as cartas
  // novas só aparecem depois da cerimônia, senão o jogador as veria antes de embaralhar.
  // (Quando a mão acaba sem vaza — correram, mão de onze — a cerimônia entra no efeito seguinte,
  // no mesmo lote de eventos, então não há quadro em que as cartas novas apareçam antes dela.)
  const handCards = (trick.handEnded && holding) || tableHold ? [] : view.myCards;

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
      <TableFelt top="19%" bottom="40%" />

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
            <Animated.View key={`us-${us}`} entering={ZoomIn.duration(260)}>
              <AppText variant="stat" color={colors.primaryBright} testID="score-us">
                {us}
              </AppText>
            </Animated.View>
          </View>
          <View style={styles.scoreMid}>
            {ceremony.active ? (
              <Animated.View
                key="stage"
                entering={FadeIn.duration(200)}
                exiting={FadeOut.duration(160)}
              >
                <CeremonyStagePill stage={ceremony.stage} />
              </Animated.View>
            ) : (
              <Animated.View
                key="hand"
                entering={FadeIn.duration(220)}
                exiting={FadeOut.duration(160)}
                style={styles.scoreMid}
              >
                <AppText variant="caption" color={colors.textSecondary}>
                  MÃO {view.handNumber}
                </AppText>
                <Animated.View
                  key={`value-${view.handValue}`}
                  entering={ZoomIn.duration(320)}
                  style={styles.valuePill}
                >
                  <AppText variant="smallBold" color={colors.textDark} testID="hand-value">
                    VALE {view.handValue}
                  </AppText>
                </Animated.View>
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
              </Animated.View>
            )}
          </View>
          <View style={styles.scoreSide}>
            <AppText variant="caption" color={colors.textSecondary}>
              ELES
            </AppText>
            <Animated.View key={`them-${them}`} entering={ZoomIn.duration(260)}>
              <AppText variant="stat" color={colors.dangerSoft} testID="score-them">
                {them}
              </AppText>
            </Animated.View>
          </View>
        </Surface>
        <View style={{ width: 44 }} />
      </View>

      {/* A mesa fica sempre montada e visível (avatares e assentos nunca recarregam); a cerimônia
          é um overlay opaco — mesmo gradiente e feltro — que entra e sai por fade. Sem isso a
          distribuição terminava num corte seco, com a mesa inteira montando de uma vez. */}
      <View style={styles.body} ref={bodyRef}>
        <View style={styles.tableBody} pointerEvents={tableHold ? 'none' : 'auto'}>
          {/* Table: three opponents around the felt and the played cards in a cross */}
          <View style={styles.table} onLayout={(e) => setTableHeight(e.nativeEvent.layout.height)}>
            <View style={styles.seatTop}>
              <SeatInfo
                player={top}
                view={view}
                row
                partner
                hideBacks={dealing}
                backsRef={(n) => (backsRefs.current.top = n)}
              />
            </View>
            <View style={styles.seatLeft}>
              <SeatInfo
                player={left}
                view={view}
                hideBacks={dealing}
                backsRef={(n) => (backsRefs.current.left = n)}
              />
            </View>
            <View style={styles.seatRight}>
              <SeatInfo
                player={right}
                view={view}
                hideBacks={dealing}
                backsRef={(n) => (backsRefs.current.right = n)}
              />
            </View>

            <View
              style={[
                styles.cross,
                { top: crossLayout.top, transform: [{ scale: crossLayout.scale }] },
              ]}
              pointerEvents="none"
              ref={crossRef}
            >
              {/* Ordem de desenho fixa (sem zIndex): a faixa "Ganhando"/"Vencedora" do topo passa por
                  cima das laterais, e a das laterais por cima da minha. Trocar o zIndex de uma carta
                  jogada faz o Fabric reinserir a view e ela perdia a posição animada (sumia). */}
              <PlayedSlot
                seat={mySeat}
                pos="bottom"
                trick={trick}
                mySeat={mySeat}
                style={styles.crossBottom}
                mine
              />
              <PlayedSlot
                seat={left?.seat}
                pos="left"
                trick={trick}
                mySeat={mySeat}
                style={styles.crossLeft}
              />
              <PlayedSlot
                seat={right?.seat}
                pos="right"
                trick={trick}
                mySeat={mySeat}
                style={styles.crossRight}
              />
              <PlayedSlot
                seat={top?.seat}
                pos="top"
                trick={trick}
                mySeat={mySeat}
                style={styles.crossTop}
              />
            </View>

            {/* Eu: avatar com o anel do tempo, e o relógio ao lado quando é minha vez */}
            <View style={styles.seatMe} testID={`seat-${mySeat}`}>
              <View style={styles.meAvatarRow}>
                <View style={styles.meClockSpacer} />
                {deadlineAt !== null ? (
                  <CountdownRing
                    deadlineAt={deadlineAt}
                    totalMs={TURN_TIMING.turnMs}
                    size={58}
                    strokeWidth={3.5}
                  >
                    <PlayerAvatar
                      avatarId={me?.avatarId}
                      size={48}
                      ringColor={colors.primaryBright}
                    />
                  </CountdownRing>
                ) : (
                  <View style={styles.meAvatarIdle}>
                    <PlayerAvatar
                      avatarId={me?.avatarId}
                      size={48}
                      ringColor={isMyTurn ? colors.primaryBright : colors.cardBorderStrong}
                    />
                  </View>
                )}
                <View style={styles.meClockSpacer}>
                  {deadlineAt !== null ? (
                    <CountdownText
                      deadlineAt={deadlineAt}
                      warningMs={TURN_TIMING.warningMs}
                      format={formatTurnClock}
                      testID="turn-clock"
                    />
                  ) : null}
                </View>
              </View>
              <AppText variant="smallBold" numberOfLines={1}>
                Você
              </AppText>
            </View>
          </View>

          {/* Status line */}
          <View style={styles.statusLine}>
            {status === 'reconnecting' ? (
              <View style={styles.statusPill}>
                <Ionicons name={icons.wifiOff} size={14} color={colors.gold} />
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
            ) : tableHold ? (
              <AppText variant="small" color={colors.textSecondary} center>
                {countdownActive ? 'A partida vai começar' : 'Preparando a mão...'}
              </AppText>
            ) : holding && trick.resolved ? (
              <AppText
                variant="smallBold"
                color={
                  trick.resolved.winner === null
                    ? colors.gold
                    : trick.resolved.winner === myTeam
                      ? colors.primaryBright
                      : colors.dangerSoft
                }
                center
                testID="trick-result"
              >
                {trick.resolved.winner === null
                  ? trick.resolved.cango
                    ? CANGO_COPY[trick.resolved.cango]
                    : 'Cangou!'
                  : trick.resolved.winnerSeat === mySeat
                    ? 'Você venceu a rodada!'
                    : `${bySeat.get(trick.resolved.winnerSeat)?.nickname ?? '...'} venceu a rodada`}
              </AppText>
            ) : tieBreak ? (
              <AppText
                variant="smallBold"
                color={colors.gold}
                center
                testID="tiebreak-status"
                accessibilityLiveRegion="polite"
              >
                {isMyTurn
                  ? 'Cangou! Jogue sua maior carta.'
                  : view.currentRound.length === 0 && view.turnSeat === tieBreak.causedBySeat
                    ? `${turnPlayer?.nickname ?? '...'} abre o desempate. Vale a maior carta.`
                    : `Desempate: vez de ${turnPlayer?.nickname ?? '...'}. Vale a maior carta.`}
              </AppText>
            ) : revealing ? (
              <AppText variant="smallBold" color={colors.gold} center testID="reveal-status">
                Correram da mão de onze! Veja as cartas.
              </AppText>
            ) : isMyTurn ? (
              <AppText
                variant="smallBold"
                color={coverArmed ? colors.gold : colors.primaryBright}
                center
                accessibilityLiveRegion="polite"
              >
                {coverArmed
                  ? 'Toque na carta que vai virada.'
                  : 'Sua vez! Toque numa carta para jogar.'}
              </AppText>
            ) : (
              <AppText variant="small" color={colors.textSecondary} center>
                Vez de {turnPlayer?.nickname ?? '...'}
              </AppText>
            )}
          </View>

          {/* My hand */}
          <View style={[styles.handArea, { paddingBottom: Math.max(insets.bottom, 10) }]}>
            {/* A faixa da mão era um retângulo quase preto com uma borda dura por cima: na mesa
                ele lia como um corte, e não como o fim do feltro. Agora é o mesmo degradê que o
                resto do app usa para descer até o fundo — começa transparente (o feltro continua
                aparecendo) e fecha na cor da tela, sem aresta nenhuma. */}
            <LinearGradient
              colors={gradients.fadeToBottom}
              locations={[0, 0.45, 1]}
              style={StyleSheet.absoluteFill}
              pointerEvents="none"
            />
            <View style={styles.hand} testID="my-hand" ref={handRef}>
              {handCards.map((c) => {
                const id = cardId(c);
                // No desempate o motor só libera a maior carta: as outras nem chegam a ser tocáveis.
                const allowed = playable.has(id);
                const playThis = canPlay && allowed;
                return (
                  <Animated.View key={id} layout={LinearTransition.duration(220)}>
                    <HandCard
                      card={c}
                      width={82}
                      onPlay={playThis ? () => playCard(id) : undefined}
                      dimmed={(!canPlay && view.phase === 'PLAY') || !allowed}
                      highlighted={playThis && !coverArmed}
                      required={!!tieBreak && allowed}
                      coverArmed={coverArmed}
                    />
                  </Animated.View>
                );
              })}
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
              ) : canTruco || canCover ? (
                <>
                  {canTruco ? (
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
                  {canCover ? (
                    // Alterna o modo: armado, o próximo toque numa carta a joga virada.
                    <SecondaryButton
                      label={coverArmed ? 'Cancelar virada' : 'Jogar virada'}
                      size="md"
                      icon={icons.coveredCard}
                      style={coverArmed ? styles.coverBtnArmed : styles.coverBtn}
                      onPress={() => setCoverArmedAt(coverArmed ? null : view.version)}
                      accessibilityLabel={
                        coverArmed
                          ? 'Cancelar: a próxima carta sai aberta'
                          : 'Jogar virada: a próxima carta tocada sai com a face para baixo e vale menos que qualquer carta aberta'
                      }
                      testID="action-cover"
                    />
                  ) : null}
                </>
              ) : null}
            </View>
          </View>
        </View>

        {ceremony.active && !dealing ? (
          <Animated.View
            key="ceremony"
            style={StyleSheet.absoluteFill}
            entering={FadeIn.duration(240)}
            exiting={FadeOut.duration(260)}
          >
            <LinearGradient colors={gradients.table} style={StyleSheet.absoluteFill} />
            <TableFelt top="8%" bottom="34%" />
            <TableCeremony
              ceremony={ceremony}
              players={players}
              mySeat={mySeat}
              reconnecting={status === 'reconnecting'}
            />
          </Animated.View>
        ) : null}

        {dealing && dealTargets && view.dealerSeat !== undefined ? (
          <DealOverlay
            targets={dealTargets}
            dealerSeat={view.dealerSeat}
            mySeat={mySeat}
            myCards={view.myCards}
          />
        ) : null}

        {reveal ? (
          <HandRevealOverlay hands={reveal.hands} players={players} mySeat={mySeat} />
        ) : null}

        {countdownActive ? <MatchCountdown onDone={finishCountdown} /> : null}
      </View>

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

/**
 * O pano da mesa.
 *
 * Eram duas elipses chapadas (uma na mesa, outra na cerimônia) com uma borda fina por cima do
 * fundo da tela — de longe lia como uma mancha, não como uma mesa. Agora são três camadas:
 * o anel escuro em volta (a beirada), o pano com a luz caindo de cima, e o fio claro na borda.
 */
function TableFelt({ top, bottom }: { top: `${number}%`; bottom: `${number}%` }) {
  return (
    <View style={[styles.feltRail, { top, bottom }]} pointerEvents="none">
      <LinearGradient colors={gradients.felt} style={styles.feltCloth} />
    </View>
  );
}

/** Avatar, nickname and the face-down cards still in hand for one opponent/partner. */
function SeatInfo({
  player,
  view,
  row,
  partner,
  hideBacks,
  backsRef,
}: {
  player?: TablePlayer;
  view: NonNullable<TableController['view']>;
  row?: boolean;
  partner?: boolean;
  /** Durante a distribuição os versos chegam voando: o montinho real fica invisível até lá. */
  hideBacks?: boolean;
  backsRef?: (node: View | null) => void;
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
            <Ionicons name={icons.wifiOff} size={11} color={colors.text} />
          </View>
        ) : null}
      </View>
      <View style={[styles.seatMeta, row && { marginLeft: 8, marginTop: 0 }]}>
        <AppText variant="caption" numberOfLines={1} style={styles.seatName}>
          {player.nickname}
        </AppText>
        {partner ? (
          <View style={styles.partnerChip}>
            <AppText variant="caption" color={colors.primaryBright}>
              Parceiro
            </AppText>
          </View>
        ) : null}
        <View style={[styles.backs, hideBacks && styles.hidden]} ref={backsRef}>
          {Array.from({ length: hideBacks ? 3 : count }).map((_, i) => (
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

function PlayedSlot({
  seat,
  pos,
  trick,
  mySeat,
  style,
  mine,
}: {
  seat?: Seat;
  pos: TablePosition;
  trick: TrickPresentation;
  mySeat: Seat;
  style: object;
  mine?: boolean;
}) {
  const width = mine ? 60 : 54;
  const play = seat === undefined ? undefined : trick.plays.find((p) => p.seat === seat);
  if (!play) {
    return <View style={[styles.slot, style, { width, height: Math.round(width * 1.45) }]} />;
  }
  let status: TrickCardStatus = 'plain';
  if (trick.resolved) {
    if (trick.resolved.winner !== null)
      status = trick.resolved.winnerSeat === play.seat ? 'winner' : 'loser';
  } else if (trick.leadingSeat === play.seat) {
    status = 'leading';
  }
  const collectTo =
    trick.phase === 'collecting' && trick.resolved
      ? relativePosition(trick.resolved.winnerSeat, mySeat)
      : null;
  return (
    <TrickCard
      // Carta virada de outro assento não tem id: a vaza (`trick.round`) diferencia as jogadas.
      key={play.card ? cardId(play.card) : `covered-${play.seat}-${trick.round}`}
      card={play.card}
      covered={Boolean(play.covered)}
      width={width}
      from={pos}
      status={status}
      collectTo={collectTo}
      style={style}
      testID={`played-${play.seat}`}
    />
  );
}

function describeEvent(
  e: GameEvent,
  bySeat: Map<Seat, TablePlayer>,
  mySeat: Seat,
  batch: GameEvent[],
): { text: string; color: string } | null {
  const myTeam = teamOf(mySeat);
  // Correr fecha a mão no mesmo lote: o que importa é quem correu, os pontos vêm junto.
  const ran = batch.find((x) => x.type === 'RAN');
  if (e.type === 'HAND_ENDED' && ran && ran.type === 'RAN') {
    return teamOf(ran.seat) === myTeam
      ? { text: `Corremos. +${ran.points} pra eles`, color: colors.dangerSoft }
      : { text: `Correram! +${ran.points} pra nós`, color: colors.primaryBright };
  }
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
    // ROUND_ENDED não vira faixa: a própria mesa mostra a carta vencedora e a linha de status
    // diz quem levou — a faixa só cobriria as cartas.
    case 'HAND_ENDED':
      if (e.result.winner === null) return { text: 'MÃO CANGADA', color: colors.gold };
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
/** Espaço vertical ocupado pelo assento do parceiro (avatar + nome + montinho). */
const SEAT_TOP_SPACE = 96;
/** Espaço do meu assento na base da mesa (anel do relógio + "Você"). */
const SEAT_ME_SPACE = 88;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bgTop },
  feltRail: {
    position: 'absolute',
    left: '6%',
    right: '6%',
    borderRadius: 180,
    // A beirada: um anel escuro com um fio de luz por fora, e o pano recuado dentro dele.
    backgroundColor: colors.feltRail,
    borderWidth: 1,
    borderColor: colors.feltEdge,
    padding: 5,
  },
  feltCloth: { flex: 1, borderRadius: 176 },
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
  // A coluna do meio carrega tanto "MÃO n / VALE n" quanto a pílula da cerimônia. Sem um
  // limite ela empurrava os dois placares para fora do card durante o embaralho (regra 60).
  scoreMid: { flex: 1, minWidth: 0, alignItems: 'center', paddingHorizontal: 4 },
  valuePill: {
    backgroundColor: colors.gold,
    paddingHorizontal: 10,
    paddingVertical: 2,
    borderRadius: radius.pill,
    marginTop: 2,
  },
  rounds: { flexDirection: 'row', gap: 5, marginTop: 5 },
  roundDot: { width: 9, height: 9, borderRadius: 5 },

  body: { flex: 1 },
  // Cópia do feltro para o overlay da cerimônia (o do root fica coberto pelo gradiente opaco).

  tableBody: { flex: 1 },
  table: { flex: 1, position: 'relative' },
  seatTop: { position: 'absolute', top: 4, left: 0, right: 0, alignItems: 'center' },
  seatLeft: { position: 'absolute', left: spacing.sm, top: '38%' },
  seatRight: { position: 'absolute', right: spacing.sm, top: '38%' },
  seatInfo: { alignItems: 'center' },
  seatInfoRow: { flexDirection: 'row', alignItems: 'center' },
  seatMeta: { alignItems: 'center', marginTop: 4 },
  seatName: { maxWidth: 96, textAlign: 'center' },
  backs: { flexDirection: 'row', marginTop: 3, minHeight: 29 },
  hidden: { opacity: 0 },
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
  },
  crossTop: { position: 'absolute', top: 0, left: CROSS / 2 - 27 },
  crossLeft: { position: 'absolute', left: 0, top: CROSS / 2 - 39 },
  crossRight: { position: 'absolute', right: 0, top: CROSS / 2 - 39 },
  crossBottom: { position: 'absolute', bottom: 0, left: CROSS / 2 - 30 },
  slot: {
    // O tracejado branco lia como rascunho de layout. Um retângulo de cantos arredondados, um
    // tom mais fundo que o pano, lê como o lugar onde a carta vai pousar.
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.slotEdge,
    backgroundColor: colors.slotFill,
  },

  // Abaixo da cruz de cartas e acima do meu avatar: a faixa nunca cobre uma carta jogada.
  banner: { position: 'absolute', left: 0, right: 0, top: '52%', alignItems: 'center' },
  // Durante a cerimônia o aviso fica sobre o baralho, abaixo do título (avatares ficam livres).
  bannerCeremony: { top: '46%' },
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
    // O fundo é o degradê acima; sem cor de fundo nem borda o feltro desce até as cartas.
    paddingTop: 18,
    paddingHorizontal: spacing.screen,
  },
  seatMe: { position: 'absolute', bottom: 2, left: 0, right: 0, alignItems: 'center' },
  meAvatarRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  meAvatarIdle: { width: 58, height: 58, alignItems: 'center', justifyContent: 'center' },
  meClockSpacer: { width: 64, alignItems: 'flex-start', paddingLeft: 6 },
  partnerChip: {
    paddingHorizontal: 7,
    paddingVertical: 1,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(30, 227, 140, 0.5)',
    backgroundColor: 'rgba(0, 40, 26, 0.7)',
    marginTop: 2,
  },
  hand: { flexDirection: 'row', justifyContent: 'center', gap: 10, minHeight: 122 },
  actions: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 10, minHeight: 48 },
  // "Aceitar | SEIS! | Correr" são três botões na mesma linha: com largura mínima fixa eles
  // somavam mais que a tela em aparelhos de 360dp e o "Correr" saía pela borda. Dividindo a
  // faixa disponível o conjunto cabe em qualquer largura, sem esconder nenhuma ação.
  actionBtn: { flex: 1, minWidth: 0, maxWidth: 160 },
  coverBtn: { flex: 1, minWidth: 0, maxWidth: 200 },
  coverBtnArmed: {
    flex: 1,
    minWidth: 0,
    maxWidth: 200,
    borderColor: colors.gold,
    backgroundColor: 'rgba(120, 90, 0, 0.45)',
  },
  trucoBtn: {
    flex: 1,
    minWidth: 0,
    maxWidth: 220,
    borderColor: colors.gold,
    backgroundColor: 'rgba(120, 70, 0, 0.55)',
  },
});
