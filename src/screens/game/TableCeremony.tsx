import React, { useMemo } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeOut, ZoomIn } from 'react-native-reanimated';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, icons, radius, spacing } from '@/design-system';
import { AppText, CountdownRing, CountdownText, PlayerAvatar, PrimaryButton } from '@/components';
import type { Seat } from '@/domain/game';
import type { TablePlayer } from '@/features/game/types';
import { relativePosition } from '@/features/game/seatLayout';
import {
  CEREMONY_TIMING,
  CeremonyStage,
  formatSeatClock,
  cutterSeat,
  seatStatus,
  shufflerSeat,
} from '@/features/game/shuffleCeremony';
import type { ShuffleCeremony } from '@/features/game/useShuffleCeremony';
import { CutDeck } from './CutDeck';
import { DealingCards } from './DealingCards';
import { DeckHint, ShuffleDeck, ShuffleProgressBar } from './ShuffleDeck';

interface Props {
  ceremony: ShuffleCeremony;
  players: TablePlayer[];
  mySeat: Seat;
  /** A mesa perdeu a conexão: o relógio congela e a cerimônia avisa que está sincronizando. */
  reconnecting: boolean;
}

/**
 * Ritual de início de mão: embaralhar, cortar e distribuir, com os quatro jogadores na mesa.
 *
 * Substitui o corpo da mesa (cruz de cartas + mão) enquanto roda — o cabeçalho com o placar
 * continua o mesmo, então nunca se perde de vista de quem é a vez nem como está a partida.
 * Nada aqui decide regra: a cerimônia é o tempo do truco antes das cartas chegarem à mão.
 */
export function TableCeremony({ ceremony, players, mySeat, reconnecting }: Props) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  /** Aparelhos baixos (ou com a barra de navegação grande) perdem o rodapé explicativo. */
  const compact = height < 720;
  /**
   * O baralho tem tamanho fixo (as animações são calculadas em px), então ele encolhe por
   * transform para caber entre os dois adversários em telas estreitas. Sem isso um aparelho de
   * 360pt encavalaria as cartas nos avatares laterais.
   */
  const deckScale = Math.min(
    compact ? 0.86 : 1,
    Math.max(0.7, (width - 2 * SIDE_SEAT_W - 2 * spacing.screen) / DECK_W),
  );

  const bySeat = useMemo(() => {
    const map = new Map<Seat, TablePlayer>();
    players.forEach((p) => map.set(p.seat, p));
    return map;
  }, [players]);

  const dealerSeat = ceremony.dealerSeat ?? mySeat;
  const seatAt = (pos: 'top' | 'left' | 'right') =>
    players.find((p) => relativePosition(p.seat, mySeat) === pos);
  const me = bySeat.get(mySeat);
  const actor = ceremony.actorSeat === null ? null : bySeat.get(ceremony.actorSeat);
  const actorName = actor?.isYou ? 'Você' : (actor?.nickname ?? 'o jogador');
  // O rodapé conta a história inteira da mão, então o primeiro passo é sempre de quem embaralhou —
  // na distribuição não há mais "assento da vez" para nomear.
  const shuffler = bySeat.get(shufflerSeat(dealerSeat));
  const shufflerName = shuffler?.isYou ? 'Você' : (shuffler?.nickname ?? 'O jogador');
  const cutter = bySeat.get(cutterSeat(dealerSeat));
  const cutterName = cutter?.isYou ? 'Você' : (cutter?.nickname ?? 'O jogador');

  const copy = ceremonyCopy(ceremony, actorName);
  const showDeal = ceremony.stage === 'deal';
  const showCut = ceremony.stage === 'cut';

  return (
    <View
      style={[styles.root, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}
      testID="table-ceremony"
    >
      {/* Parceiro no topo */}
      <View style={styles.seatTop}>
        <CeremonySeat player={seatAt('top')} ceremony={ceremony} dealerSeat={dealerSeat} row />
      </View>

      {/* Centro: o que está acontecendo e o baralho, com os adversários flanqueando */}
      <View style={styles.centre}>
        <Animated.View
          key={copy.key}
          entering={FadeIn.duration(220)}
          exiting={FadeOut.duration(140)}
          accessibilityLiveRegion="polite"
        >
          <AppText variant={compact ? 'h2' : 'h1'} center>
            {copy.title}
          </AppText>
          <AppText
            variant={compact ? 'h2' : 'h1'}
            center
            color={copy.accent}
            style={styles.subtitle}
          >
            {copy.highlight}
          </AppText>
        </Animated.View>

        <View style={styles.deckRow}>
          <View style={styles.sideSeat}>
            <CeremonySeat player={seatAt('left')} ceremony={ceremony} dealerSeat={dealerSeat} />
          </View>

          <View style={[styles.deckArea, { transform: [{ scale: deckScale }] }]}>
            {showDeal ? (
              <DealingCards durationMs={CEREMONY_TIMING.dealMs} />
            ) : showCut ? (
              <CutDeck
                interactive={ceremony.iAmActor && !ceremony.celebrating && !reconnecting}
                onCut={ceremony.finish}
                done={ceremony.celebrating}
              />
            ) : (
              <ShuffleDeck
                interactive={ceremony.iAmActor && !ceremony.celebrating && !reconnecting}
                progress={ceremony.progress}
                onBump={ceremony.bump}
                settled={ceremony.celebrating}
              />
            )}
          </View>

          <View style={styles.sideSeat}>
            <CeremonySeat player={seatAt('right')} ceremony={ceremony} dealerSeat={dealerSeat} />
          </View>
        </View>

        {ceremony.stage === 'shuffle' ? (
          <ShuffleProgressBar progress={ceremony.progress} done={ceremony.celebrating} />
        ) : null}

        <View style={styles.hintSlot}>
          {reconnecting ? (
            <View style={styles.syncPill}>
              <Ionicons name={icons.sync} size={14} color={colors.gold} />
              <AppText variant="smallBold" color={colors.gold} style={{ marginLeft: 6 }}>
                Sincronizando com a mesa...
              </AppText>
            </View>
          ) : copy.hint ? (
            <DeckHint text={copy.hint} />
          ) : null}
        </View>
      </View>

      {/* Jogador local: avatar em destaque com o anel do tempo */}
      <View style={styles.meRow}>
        <SeatAvatar
          player={me}
          acting={ceremony.actorSeat === mySeat}
          deadlineAt={ceremony.actorSeat === mySeat ? ceremony.deadlineAt : null}
          totalMs={ceremony.stageTotalMs}
          size={56}
        />
        <View style={styles.meMeta}>
          <AppText variant="h3" numberOfLines={1}>
            {me?.nickname ?? 'Você'}
          </AppText>
          {ceremony.actorSeat === mySeat && ceremony.deadlineAt !== null ? (
            <CountdownText
              deadlineAt={ceremony.deadlineAt}
              warningMs={CEREMONY_TIMING.warningMs}
              format={formatSeatClock}
              testID="ceremony-clock"
            />
          ) : (
            <AppText variant="small" color={colors.textSecondary}>
              {statusLabel(mySeat, ceremony, dealerSeat)}
            </AppText>
          )}
        </View>
      </View>

      {/* Rodapé explicativo + ação principal */}
      {!compact ? <StepsFooter stage={ceremony.stage} shufflerName={shufflerName} cutterName={cutterName} /> : null}

      <View style={styles.ctaSlot}>
        {copy.cta && !reconnecting ? (
          <>
            <PrimaryButton
              label={copy.cta}
              icon={icons.checkCircle}
              onPress={ceremony.finish}
              disabled={!copy.ctaEnabled}
              testID="ceremony-finish"
            />
            <AppText variant="small" color={colors.textMuted} center style={styles.ctaNote}>
              {copy.ctaNote}
            </AppText>
          </>
        ) : (
          <View style={styles.waitingPill} accessibilityLiveRegion="polite">
            <Ionicons name={icons.clock} size={15} color={colors.textSecondary} />
            <AppText variant="smallBold" color={colors.textSecondary} style={{ marginLeft: 7 }}>
              {copy.waiting}
            </AppText>
          </View>
        )}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Jogadores
// ---------------------------------------------------------------------------

function CeremonySeat({
  player,
  ceremony,
  dealerSeat,
  row,
}: {
  player?: TablePlayer;
  ceremony: ShuffleCeremony;
  dealerSeat: Seat;
  row?: boolean;
}) {
  if (!player) return <View />;
  const acting = ceremony.actorSeat === player.seat;
  return (
    <View style={[styles.seat, row && styles.seatRow]} testID={`ceremony-seat-${player.seat}`}>
      <SeatAvatar
        player={player}
        acting={acting}
        deadlineAt={acting ? ceremony.deadlineAt : null}
        totalMs={ceremony.stageTotalMs}
        size={48}
      />
      <View style={[styles.seatMeta, row && styles.seatMetaRow]}>
        <AppText variant="smallBold" numberOfLines={1} style={styles.seatName}>
          {player.nickname}
        </AppText>
        <View style={styles.seatStatus}>
          <Ionicons
            name={acting ? stageIcon(ceremony.stage) : icons.clock}
            size={12}
            color={acting ? colors.primaryBright : colors.textMuted}
          />
          <AppText
            variant="caption"
            color={acting ? colors.primaryBright : colors.textMuted}
            style={styles.seatStatusText}
            numberOfLines={1}
          >
            {statusLabel(player.seat, ceremony, dealerSeat)}
          </AppText>
        </View>
      </View>
    </View>
  );
}

/** Avatar com halo: anel de tempo enquanto age, borda discreta enquanto espera. */
function SeatAvatar({
  player,
  acting,
  deadlineAt,
  totalMs,
  size,
}: {
  player?: TablePlayer;
  acting: boolean;
  deadlineAt: number | null;
  totalMs: number | null;
  size: number;
}) {
  const avatar = (
    <PlayerAvatar
      avatarId={player?.avatarId}
      size={size}
      ringColor={acting ? colors.primaryBright : colors.cardBorderStrong}
    />
  );
  if (!acting || totalMs === null) return avatar;
  return (
    <Animated.View entering={ZoomIn.duration(220)}>
      <CountdownRing deadlineAt={deadlineAt} totalMs={totalMs} size={size + 12} strokeWidth={3}>
        {avatar}
      </CountdownRing>
    </Animated.View>
  );
}

// ---------------------------------------------------------------------------
// Rodapé com os três passos
// ---------------------------------------------------------------------------

function StepsFooter({
  stage,
  shufflerName,
  cutterName,
}: {
  stage: CeremonyStage;
  shufflerName: string;
  cutterName: string;
}) {
  const who = (name: string, verb: string) =>
    name === 'Você' ? `Você ${verb} o baralho.` : `${name} ${verb} o baralho.`;
  // No corte o rodapé recomeça a história a partir dele (como na referência): quem corta,
  // o que o corte define e o que vem depois.
  const steps =
    stage === 'shuffle'
      ? [
          { icon: icons.shuffle, label: who(shufflerName, 'está embaralhando'), active: true },
          { icon: icons.cut, label: 'O baralho será cortado em seguida.', active: false },
          { icon: icons.deal, label: 'Depois do corte, as cartas serão distribuídas.', active: false },
        ]
      : [
          { icon: icons.cut, label: who(cutterName, stage === 'cut' ? 'está cortando' : 'cortou'), active: stage === 'cut' },
          { icon: icons.shuffle, label: 'O corte define por onde as cartas serão distribuídas.', active: false },
          { icon: icons.deal, label: 'Depois do corte, as cartas serão distribuídas.', active: stage === 'deal' },
        ];
  return (
    <View style={styles.steps}>
      {steps.map((s, i) => (
        <React.Fragment key={s.icon}>
          {i > 0 ? <View style={styles.stepDivider} /> : null}
          <View style={styles.step}>
            <Ionicons
              name={s.icon}
              size={22}
              color={s.active ? colors.primaryBright : colors.textMuted}
            />
            <AppText
              variant="caption"
              center
              color={s.active ? colors.text : colors.textMuted}
              style={styles.stepText}
            >
              {s.label}
            </AppText>
          </View>
        </React.Fragment>
      ))}
    </View>
  );
}

/** Três pontos de progresso do ritual — vive no cabeçalho da mesa, ao lado do placar. */
export function CeremonyStagePill({ stage }: { stage: CeremonyStage }) {
  const order: CeremonyStage[] = ['shuffle', 'cut', 'deal'];
  const index = Math.max(0, order.indexOf(stage));
  return (
    <View style={styles.stagePillWrap}>
      <AppText variant="caption" color={colors.textSecondary}>
        PREPARANDO RODADA
      </AppText>
      <View style={styles.stagePill}>
        <AppText variant="smallBold" color={colors.textDark}>
          {STAGE_TITLE[stage]}
        </AppText>
      </View>
      <View style={styles.stageDots}>
        {order.map((s, i) => (
          <View
            key={s}
            style={[
              styles.stageDot,
              i === index && styles.stageDotActive,
              i < index && styles.stageDotDone,
            ]}
          />
        ))}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Microcopy
// ---------------------------------------------------------------------------

const STAGE_TITLE: Record<CeremonyStage, string> = {
  shuffle: 'EMBARALHAR O BARALHO',
  cut: 'CORTAR O BARALHO',
  deal: 'DISTRIBUINDO CARTAS...',
  done: '',
};

function stageIcon(stage: CeremonyStage) {
  return stage === 'cut' ? icons.cut : stage === 'deal' ? icons.deal : icons.shuffle;
}

function statusLabel(seat: Seat, ceremony: ShuffleCeremony, dealerSeat: Seat): string {
  if (ceremony.actorSeat === seat) {
    if (ceremony.celebrating) return 'Pronto';
    return ceremony.stage === 'cut' ? 'Cortando...' : 'Embaralhando...';
  }
  if (ceremony.stage === 'deal') return 'Recebendo...';
  return seatStatus(seat, ceremony.stage, dealerSeat) === 'next' ? 'Corta em seguida' : 'Aguardando...';
}

interface Copy {
  key: string;
  title: string;
  highlight: string;
  accent: string;
  hint: string | null;
  cta: string | null;
  ctaEnabled: boolean;
  ctaNote: string;
  waiting: string;
}

function ceremonyCopy(c: ShuffleCeremony, actorName: string): Copy {
  const mine = c.iAmActor;
  const base = { accent: colors.gold, cta: null, ctaEnabled: false, ctaNote: '', waiting: '' };

  if (c.stage === 'deal') {
    return {
      ...base,
      key: 'deal',
      title: 'Distribuindo',
      highlight: 'as cartas.',
      accent: colors.primaryBright,
      hint: 'Suas cartas chegando...',
      waiting: 'Distribuindo as cartas...',
    };
  }

  if (c.celebrating) {
    const timedOut = c.timedOut && mine;
    if (c.stage === 'shuffle') {
      return {
        ...base,
        key: 'shuffle-done',
        title: timedOut ? 'Tempo esgotado.' : 'Baralho embaralhado!',
        highlight: timedOut ? 'Embaralhamos por você.' : 'Pronto para cortar.',
        accent: timedOut ? colors.dangerSoft : colors.primaryBright,
        hint: 'Agora é hora de cortar o baralho.',
        waiting: 'Passando o baralho para o corte...',
      };
    }
    return {
      ...base,
      key: 'cut-done',
      title: timedOut ? 'Tempo esgotado.' : 'Baralho cortado!',
      highlight: 'Vamos distribuir.',
      accent: timedOut ? colors.dangerSoft : colors.primaryBright,
      hint: null,
      waiting: 'Preparando a distribuição...',
    };
  }

  if (c.stage === 'cut') {
    return mine
      ? {
          ...base,
          key: 'cut-me',
          title: 'Sua vez de',
          highlight: 'cortar o baralho.',
          hint: 'Arraste para definir o corte e confirme.',
          cta: 'CONFIRMAR CORTE',
          ctaEnabled: true,
          ctaNote: 'Depois do corte, as cartas serão distribuídas.',
          waiting: '',
        }
      : {
          ...base,
          key: 'cut-other',
          title: `${actorName} está`,
          highlight: 'cortando o baralho.',
          hint: `Aguardando ${actorName} cortar o baralho.`,
          waiting: `Aguardando ${actorName} cortar...`,
        };
  }

  return mine
    ? {
        ...base,
        key: 'shuffle-me',
        title: 'Sua vez de',
        highlight: 'embaralhar o baralho.',
        hint: 'Toque ou arraste para embaralhar e preparar o corte.',
        cta: 'FINALIZAR EMBARALHAMENTO',
        ctaEnabled: c.canFinish,
        ctaNote: c.canFinish
          ? 'Depois de embaralhar, o próximo passo será cortar o baralho.'
          : 'Embaralhe mais um pouco para liberar.',
        waiting: '',
      }
    : {
        ...base,
        key: 'shuffle-other',
        title: `${actorName} está`,
        highlight: 'embaralhando o baralho.',
        hint: `Aguardando ${actorName} embaralhar o baralho.`,
        waiting: `Aguardando ${actorName} embaralhar...`,
      };
}

/** Largura reservada a cada adversário lateral; o baralho ocupa o que sobra. */
const SIDE_SEAT_W = 72;
/** Largura fixa do tabuleiro do baralho (ver ShuffleDeck/CutDeck). */
const DECK_W = 250;

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: spacing.screen },

  seatTop: { alignItems: 'center', paddingTop: 4 },
  sideSeat: { width: SIDE_SEAT_W, alignItems: 'center' },
  seat: { alignItems: 'center' },
  seatRow: { flexDirection: 'row', alignItems: 'center' },
  seatMeta: { alignItems: 'center', marginTop: 4, maxWidth: SIDE_SEAT_W },
  seatMetaRow: { marginTop: 0, marginLeft: 10, alignItems: 'flex-start' },
  seatName: { textAlign: 'center' },
  seatStatus: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  seatStatusText: { marginLeft: 4, maxWidth: SIDE_SEAT_W - 18 },

  centre: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  subtitle: { marginTop: 2 },
  deckRow: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch', marginTop: 10 },
  deckArea: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  hintSlot: { minHeight: 44, justifyContent: 'center', marginTop: 12 },
  syncPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderWidth: 1,
    borderColor: colors.gold,
  },

  meRow: { flexDirection: 'row', alignItems: 'center', alignSelf: 'center', marginBottom: 10 },
  meMeta: { marginLeft: 12 },

  steps: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: 'rgba(0, 24, 18, 0.5)',
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    paddingVertical: 12,
    paddingHorizontal: 8,
    marginBottom: 12,
  },
  step: { flex: 1, alignItems: 'center', paddingHorizontal: 4 },
  stepText: { marginTop: 6 },
  stepDivider: { width: 1, alignSelf: 'stretch', backgroundColor: colors.divider },

  ctaSlot: { minHeight: 78, justifyContent: 'center' },
  ctaNote: { marginTop: 6 },
  waitingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },

  stagePillWrap: { alignItems: 'center' },
  stagePill: {
    backgroundColor: colors.gold,
    paddingHorizontal: 12,
    paddingVertical: 3,
    borderRadius: radius.pill,
    marginTop: 2,
  },
  stageDots: { flexDirection: 'row', gap: 6, marginTop: 5 },
  stageDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.22)' },
  stageDotActive: { backgroundColor: colors.gold },
  stageDotDone: { backgroundColor: colors.primaryBright },
});
