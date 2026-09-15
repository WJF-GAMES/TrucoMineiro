import React, { useMemo } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeOut, ZoomIn } from 'react-native-reanimated';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, icons, radius, spacing } from '@/design-system';
import {
  AppText,
  CountdownRing,
  CountdownText,
  PlayerAvatar,
  PrimaryButton,
  SecondaryButton,
} from '@/components';
import type { Seat } from '@/domain/game';
import type { TablePlayer } from '@/features/game/types';
import { relativePosition } from '@/features/game/seatLayout';
import {
  CEREMONY_TIMING,
  CUT_DEPTHS,
  CeremonyStage,
  type CutDepth,
  cutSplit,
  formatSeatClock,
  cutterSeat,
  seatStatus,
  shufflerSeat,
} from '@/features/game/shuffleCeremony';
import type { ShuffleCeremony } from '@/features/game/useCeremony';
import { haptic } from '@/utils/haptics';
import { CutDeck } from './CutDeck';
import { PlayingCard } from './PlayingCard';
import { ShuffleAnimation } from './ShuffleAnimation';

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
  // Onde cortar: escolha do jogador local — vai no `CUT` para o motor. Quem não corta vê o meio.
  const { cutDepth, setCutDepth } = ceremony;
  const cutChooser = showCut && ceremony.iAmActor && !ceremony.celebrating && !reconnecting;
  const showShuffle = ceremony.stage === 'shuffle';
  const shuffleChooser = showShuffle && ceremony.iAmActor && !reconnecting;
  const shuffleFeedback = shuffleCopy(ceremony.shuffleCount);

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
          // O texto novo só entra depois de o antigo sair: sem o atraso os dois se sobrepõem.
          entering={FadeIn.delay(110).duration(200)}
          exiting={FadeOut.duration(100)}
          accessibilityLiveRegion="polite"
          style={styles.title}
        >
          <AppText variant={compact ? 'h2' : 'h1'} center>
            {copy.title}
          </AppText>
          <AppText
            variant={copy.subtitle ? 'body' : compact ? 'h2' : 'h1'}
            center
            color={copy.subtitle ? colors.textSecondary : copy.accent}
            style={copy.subtitle ? styles.subtitleSmall : styles.subtitle}
          >
            {copy.highlight}
          </AppText>
        </Animated.View>

        {/* Prazo e progresso do gesto no MESMO cartão.
            Antes eram dois blocos separados (relógio em cima, "Mistura do baralho" embaixo) e o
            número de misturas ainda aparecia numa terceira e numa quarta frase. Quem embaralha
            precisa de duas respostas — quanto tempo resta e quantas vezes já misturei — e elas
            agora moram juntas, uma vez cada. */}
        {(showShuffle || showCut) &&
        ceremony.deadlineAt !== null &&
        ceremony.stageTotalMs !== null ? (
          <View style={styles.stageCard} testID={showCut ? 'cut-status' : 'shuffle-status'}>
            <View style={styles.timerCard} testID="shuffle-timer">
              <Ionicons name={icons.stopwatch} size={26} color={colors.primaryBright} />
              <View style={styles.timerMeta}>
                <AppText variant="caption" color={colors.textSecondary} numberOfLines={1}>
                  {showCut ? 'Tempo para cortar' : 'Tempo para embaralhar'}
                </AppText>
                <CountdownText
                  deadlineAt={ceremony.deadlineAt}
                  warningMs={CEREMONY_TIMING.warningMs}
                  format={formatShuffleClock}
                  big
                  testID="shuffle-clock"
                />
              </View>
              <CountdownRing
                deadlineAt={ceremony.deadlineAt}
                totalMs={ceremony.stageTotalMs}
                size={34}
                strokeWidth={5}
              />
            </View>
            <View style={styles.stageDivider} />
            <View style={styles.gestureRow}>
              <View style={styles.mixDots}>
                {[1, 2, 3].map((n) => (
                  <View
                    key={n}
                    style={[
                      styles.mixDot,
                      (showCut ? ceremony.cutCount : ceremony.shuffleCount) >= n && styles.mixDotOn,
                    ]}
                  />
                ))}
              </View>
              <AppText
                variant="small"
                color={colors.textSecondary}
                numberOfLines={1}
                style={styles.gestureText}
              >
                {showCut
                  ? cutCountCopy(ceremony.cutCount)
                  : (shuffleFeedback ?? shuffleCountCopy(ceremony.shuffleCount))}
              </AppText>
            </View>
          </View>
        ) : null}

        <View style={styles.deckRow}>
          <View style={styles.sideSeat}>
            <CeremonySeat player={seatAt('left')} ceremony={ceremony} dealerSeat={dealerSeat} />
          </View>

          <View style={[styles.deckArea, { transform: [{ scale: deckScale }] }]}>
            <Animated.View
              key={ceremony.stage}
              entering={FadeIn.delay(80).duration(180)}
              exiting={FadeOut.duration(90)}
            >
              {showDeal ? (
                <View style={styles.dealStack}>
                  <PlayingCard faceDown width={66} />
                </View>
              ) : showCut ? (
                <CutDeck
                  interactive={cutChooser && !ceremony.shuffleBusy}
                  onCut={ceremony.bump}
                  done={ceremony.celebrating}
                  depth={cutDepth}
                />
              ) : (
                <ShuffleAnimation
                  shuffleCount={ceremony.shuffleCount}
                  interactive={shuffleChooser}
                />
              )}
            </Animated.View>
          </View>

          <View style={styles.sideSeat}>
            <CeremonySeat player={seatAt('right')} ceremony={ceremony} dealerSeat={dealerSeat} />
          </View>
        </View>

        <View style={styles.hintSlot}>
          {reconnecting ? (
            <View style={styles.syncPill}>
              <Ionicons name={icons.sync} size={14} color={colors.gold} />
              <AppText variant="smallBold" color={colors.gold} style={{ marginLeft: 6 }}>
                Sincronizando com a mesa...
              </AppText>
            </View>
          ) : copy.hint && (ceremony.celebrating || (!shuffleChooser && !cutChooser)) ? (
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
          {/* O relógio só aparece aqui quando o estágio não tem cartão próprio: no embaralho e
              no corte o prazo já está grande no cartão, e dois contadores na mesma tela
              disputavam a atenção sem dizer nada a mais. */}
          {ceremony.actorSeat === mySeat &&
          ceremony.deadlineAt !== null &&
          !showShuffle &&
          !showCut ? (
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

      {/* Rodapé: opções de corte para quem corta; senão os três passos do ritual */}
      {cutChooser ? (
        <CutOptions depth={cutDepth} onChange={setCutDepth} compact={compact} />
      ) : !compact && !shuffleChooser ? (
        <StepsFooter stage={ceremony.stage} shufflerName={shufflerName} cutterName={cutterName} />
      ) : null}

      <View style={styles.ctaSlot}>
        {cutChooser ? (
          <>
            {/* Mesmo par do embaralhamento: repetir o gesto à esquerda, fechar à direita.
                O corte também pode ser repetido quantas vezes o jogador quiser no prazo. */}
            <View style={styles.shuffleActions}>
              <SecondaryButton
                label="CORTAR"
                icon={icons.cut}
                size="lg"
                style={styles.shuffleAgain}
                onPress={ceremony.bump}
                disabled={ceremony.shuffleBusy}
                accessibilityLabel={
                  ceremony.cutCount === 0 ? 'Cortar o baralho' : 'Cortar novamente'
                }
                testID="ceremony-cut"
              />
              <PrimaryButton
                label="CONFIRMAR"
                icon={icons.checkCircle}
                size="lg"
                tone="gold"
                style={styles.shuffleDone}
                onPress={ceremony.finish}
                disabled={ceremony.shuffleBusy}
                accessibilityLabel="Confirmar corte"
                testID="ceremony-finish"
              />
            </View>
            {copy.ctaNote ? (
              <AppText variant="small" color={colors.textMuted} center style={styles.ctaNote}>
                {copy.ctaNote}
              </AppText>
            ) : null}
          </>
        ) : shuffleChooser ? (
          <>
            <View style={styles.shuffleActions}>
              {/* "EMBARALHAR NOVAMENTE" não cabia: são dois botões `lg` com ícone dividindo
                  a largura da tela, e o rótulo por extenso passava da borda em qualquer
                  aparelho. O ícone de repetição já diz "de novo"; o texto abaixo dos botões
                  também. */}
              <SecondaryButton
                label="EMBARALHAR"
                icon={icons.refresh}
                size="lg"
                style={styles.shuffleAgain}
                onPress={ceremony.bump}
                disabled={ceremony.shuffleBusy}
                accessibilityLabel="Embaralhar novamente"
                testID="ceremony-shuffle"
              />
              <PrimaryButton
                label="ESTÁ BOM"
                icon={icons.checkCircle}
                size="lg"
                style={styles.shuffleDone}
                onPress={ceremony.finish}
                disabled={!ceremony.canFinish || ceremony.shuffleBusy}
                testID="ceremony-finish"
              />
            </View>
            {copy.ctaNote ? (
              <AppText variant="small" color={colors.textMuted} center style={styles.ctaNote}>
                {copy.ctaNote}
              </AppText>
            ) : null}
          </>
        ) : copy.cta && !reconnecting ? (
          <>
            <PrimaryButton
              label={copy.cta}
              icon={icons.checkCircle}
              onPress={ceremony.finish}
              disabled={!copy.ctaEnabled}
              tone={cutChooser ? 'gold' : 'primary'}
              testID="ceremony-finish"
            />
            {copy.ctaNote ? (
              <AppText variant="small" color={colors.textMuted} center style={styles.ctaNote}>
                {copy.ctaNote}
              </AppText>
            ) : null}
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
// Opções de corte (alto / meio / baixo)
// ---------------------------------------------------------------------------

function CutOptions({
  depth,
  onChange,
  compact,
}: {
  depth: CutDepth;
  onChange: (d: CutDepth) => void;
  compact: boolean;
}) {
  return (
    <View style={styles.cutOptions} testID="cut-options">
      {CUT_DEPTHS.map((d) => {
        const selected = d.id === depth;
        const split = cutSplit(d.id);
        return (
          <Pressable
            key={d.id}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={d.label + '. ' + d.description}
            onPress={() => {
              haptic.selection();
              onChange(d.id);
            }}
            style={({ pressed }) => [
              styles.cutOption,
              selected && styles.cutOptionSelected,
              pressed && { opacity: 0.85 },
            ]}
            testID={'cut-' + d.id}
          >
            {!compact ? <MiniSplit top={split.top} bottom={split.bottom} /> : null}
            <AppText
              variant="smallBold"
              center
              color={selected ? colors.gold : colors.text}
              style={styles.cutOptionLabel}
            >
              {d.label}
            </AppText>
            <AppText variant="caption" center color={colors.textMuted}>
              {d.description}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Miniatura do baralho partido: espessura de cada metade conforme a opção. */
function MiniSplit({ top, bottom }: { top: number; bottom: number }) {
  const w = 44;
  const h = 14;
  const stack = (n: number) => (
    <View style={{ width: w, height: h + n * 3 }}>
      {Array.from({ length: n }, (_, i) => (
        <View key={i} style={[styles.miniCard, { width: w, height: h, top: (n - 1 - i) * 3 }]} />
      ))}
    </View>
  );
  return (
    <View style={styles.miniSplit}>
      {stack(top)}
      <View style={styles.miniLine} />
      {stack(bottom)}
    </View>
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
          {
            icon: icons.deal,
            label: 'Depois do corte, as cartas serão distribuídas.',
            active: false,
          },
        ]
      : [
          {
            icon: icons.cut,
            label: who(cutterName, stage === 'cut' ? 'está cortando' : 'cortou'),
            active: stage === 'cut',
          },
          {
            icon: icons.shuffle,
            label: 'O corte define por onde as cartas serão distribuídas.',
            active: false,
          },
          {
            icon: icons.deal,
            label: 'Depois do corte, as cartas serão distribuídas.',
            active: stage === 'deal',
          },
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
      <AppText variant="caption" color={colors.textSecondary} numberOfLines={1}>
        PREPARANDO
      </AppText>
      <View style={styles.stagePill}>
        <AppText
          variant="smallBold"
          color={colors.textDark}
          numberOfLines={1}
          maxFontSizeMultiplier={1.1}
        >
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

/**
 * Rótulos curtos de propósito: a pílula vive dentro do placar, entre "NÓS" e "ELES", e sobram
 * pouco mais de 100dp ali. Com os nomes por extenso ela cobria os dois placares em qualquer
 * aparelho. O nome completo do estágio continua no título grande da cerimônia, logo abaixo.
 */
const STAGE_TITLE: Record<CeremonyStage, string> = {
  shuffle: 'EMBARALHAR',
  cut: 'CORTAR',
  deal: 'DISTRIBUINDO...',
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
  return seatStatus(seat, ceremony.stage, dealerSeat) === 'next'
    ? 'Corta em seguida'
    : 'Aguardando...';
}

/** "08s" — o relógio grande do card de tempo do embaralho. */
function formatShuffleClock(ms: number): string {
  return `${String(Math.ceil(Math.max(0, ms) / 1000)).padStart(2, '0')}s`;
}

/** Quantas misturas já foram feitas, por extenso. */
function shuffleCountCopy(count: number): string {
  if (count === 0) return 'Nenhuma mistura ainda';
  return count === 1 ? '1 mistura realizada' : `${count} misturas realizadas`;
}

/** Idem para o corte, que também é repetível dentro do prazo. */
function cutCountCopy(count: number): string {
  if (count === 0) return 'Nenhum corte ainda';
  return count === 1 ? '1 corte realizado' : `${count} cortes realizados`;
}

/** Feedback textual da qualidade da mistura (só UX, não é regra). */
function shuffleCopy(count: number): string | null {
  if (count <= 0) return null;
  if (count === 1) return 'O baralho começou a ser misturado.';
  if (count === 2) return 'O baralho já está bem misturado.';
  return 'O baralho está ótimo!';
}

/** Dica curta sob o baralho. */
function DeckHint({ text }: { text: string }) {
  return (
    <View style={styles.hintBox}>
      <AppText variant="small" color={colors.textSecondary} center>
        {text}
      </AppText>
    </View>
  );
}

interface Copy {
  key: string;
  title: string;
  highlight: string;
  /** O destaque é uma instrução curta (menor), não a segunda linha do título. */
  subtitle?: boolean;
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
          title: 'Cortar o Baralho',
          highlight: 'Você pode cortar quantas vezes quiser dentro do tempo.',
          subtitle: true,
          hint: 'Arraste o baralho para cortar em cima, no meio ou embaixo.',
          cta: 'CONFIRMAR',
          ctaEnabled: true,
          ctaNote: '',
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
        title: 'Embaralhar o Baralho',
        highlight: 'Você pode embaralhar quantas vezes quiser dentro do tempo.',
        subtitle: true,
        hint: null,
        cta: 'ESTÁ BOM',
        ctaEnabled: c.canFinish,
        // Sem nota: o subtítulo já diz que pode repetir e os dois botões dizem o resto. A frase
        // aqui era a quarta repetição da mesma ideia na mesma tela.
        ctaNote: '',
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
  // Acima das cartas da distribuição: elas passam por trás do texto, não por cima.
  title: { zIndex: 2 },
  subtitle: { marginTop: 2 },
  // Cartão único do estágio: o relógio em cima, o progresso do gesto embaixo.
  stageCard: {
    alignSelf: 'center',
    marginTop: 10,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.card,
  },
  timerCard: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  timerMeta: { alignItems: 'center', minWidth: 150 },
  stageDivider: {
    height: 1,
    backgroundColor: colors.divider,
    marginTop: 8,
    marginBottom: 7,
  },
  gestureRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  gestureText: { flexShrink: 1 },
  mixDots: { flexDirection: 'row', gap: 7 },
  mixDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.18)' },
  mixDotOn: { backgroundColor: colors.primaryBright },
  shuffleActions: { flexDirection: 'row', gap: 10 },
  shuffleAgain: { flex: 1 },
  shuffleDone: { flex: 1 },
  hintBox: {
    alignSelf: 'center',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(0,0,0,0.32)',
  },
  dealStack: { alignItems: 'center', justifyContent: 'center', height: 158 },
  subtitleSmall: { marginTop: 6, maxWidth: 300 },
  cutOptions: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  cutOption: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.cardBorder,
    backgroundColor: colors.card,
  },
  cutOptionSelected: {
    borderColor: colors.gold,
    shadowColor: colors.gold,
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 4,
  },
  cutOptionLabel: { marginTop: 8 },
  miniSplit: { alignItems: 'center' },
  miniLine: {
    width: 54,
    borderTopWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: 'rgba(255,255,255,0.7)',
    marginVertical: 3,
  },
  miniCard: {
    position: 'absolute',
    left: 0,
    borderRadius: 4,
    backgroundColor: '#b8142a',
    borderWidth: 1.5,
    borderColor: '#f5ecd8',
  },
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

  stagePillWrap: { alignItems: 'center', maxWidth: '100%' },
  stagePill: {
    backgroundColor: colors.gold,
    maxWidth: '100%',
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
