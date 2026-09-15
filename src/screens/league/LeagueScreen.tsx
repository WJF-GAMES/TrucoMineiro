import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, icons, radius, spacing } from '@/design-system';
import { leagueShield } from '@/assets';
import {
  AppText,
  Chips,
  IconButton,
  PrimaryButton,
  Screen,
  StateView,
  Surface,
} from '@/components';
import { useLeagueScreen } from '@/features/league/useLeagueScreen';
import { weeklyRuleText } from '@/domain/model/leagueRanking';
import { formatCountdown, romanNumeral } from '@/utils/format';
import { logEvent } from '@/services/firebase/analytics';
import { NativeAdCard } from '@/ads';
import { toast } from '@/stores/toastStore';
import {
  AVATAR_SIZE,
  FLAG_WIDTH,
  LeagueRankingRow,
  ME_MARKER_WIDTH,
  RANK_COLUMN_WIDTH,
  RANKING_ROW_HEIGHT,
  type RankingZone,
} from './components/LeagueRankingRow';
import { LeagueHistoryTab } from './components/LeagueHistoryTab';
import { GlobalRankingTab } from './components/GlobalRankingTab';
import type { LeagueScreenSnapshot } from '@/domain/model/types';
import type { TabScreenProps } from '@/navigation/types';

type Tab = 'mine' | 'global' | 'history';

const TABS: { key: Tab; label: string }[] = [
  { key: 'mine', label: 'Minha Liga' },
  { key: 'global', label: 'Classificação Geral' },
  { key: 'history', label: 'Histórico de Ligas' },
];

export function LeagueScreen({ navigation }: TabScreenProps<'League'>) {
  const [tab, setTab] = useState<Tab>('mine');
  const { snapshot, members, loading, error, reload } = useLeagueScreen();

  useEffect(() => {
    logEvent('league_screen_viewed');
  }, []);

  return (
    <Screen withTabBar testID="screen-league" padded={false}>
      {/* Aba raiz da navegação: não tem "voltar" (não há de onde voltar), igual a Principal,
          Jogar, Amigos e Mais. O espaçador da esquerda mantém o título centrado. */}
      <View style={styles.header}>
        <View style={styles.headerSide} />
        <View style={styles.headerTitle}>
          <AppText variant="h1" center>
            Liga
          </AppText>
          <AppText variant="small" center color={colors.textSecondary}>
            Jogue, pontue e suba de liga!
          </AppText>
        </View>
        <View style={styles.headerSide}>
          <IconButton
            icon={icons.helpOutline}
            boxed={false}
            size={26}
            color={colors.textSecondary}
            accessibilityLabel="Como funcionam as ligas"
            onPress={() =>
              toast.info(
                'Como funcionam as ligas',
                'Cada semana você compete num grupo da sua liga. Pontue jogando: os primeiros sobem de liga e os últimos descem.',
              )
            }
          />
        </View>
      </View>

      <View style={styles.tabs}>
        <Chips<Tab> testID="league-tab" options={TABS} value={tab} onChange={setTab} scroll />
      </View>

      {tab === 'mine' ? (
        <MyLeagueTab
          snapshot={snapshot}
          members={members}
          loading={loading}
          error={error}
          onRetry={reload}
          onPlay={() => {
            logEvent('league_play_now_clicked');
            navigation.navigate('Play');
          }}
        />
      ) : tab === 'global' ? (
        <GlobalRankingTab />
      ) : (
        <LeagueHistoryTab />
      )}
    </Screen>
  );
}

interface MyLeagueProps {
  snapshot: LeagueScreenSnapshot | null;
  members: ReturnType<typeof useLeagueScreen>['members'];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onPlay: () => void;
}

function MyLeagueTab({ snapshot, members, loading, error, onRetry, onPlay }: MyLeagueProps) {
  const zoneOf = useCallback(
    (rank: number): RankingZone => {
      if (!snapshot) return 'neutral';
      if (snapshot.promotionCount > 0 && rank <= snapshot.promotionEnd) return 'promotion';
      if (snapshot.relegationCount > 0 && rank >= snapshot.relegationStart) return 'relegation';
      return 'neutral';
    },
    [snapshot],
  );

  const getItemLayout = useCallback(
    (_: unknown, index: number) => ({
      length: RANKING_ROW_HEIGHT,
      offset: RANKING_ROW_HEIGHT * index,
      index,
    }),
    [],
  );

  if (error) {
    return (
      <StateView
        kind="error"
        title="Não foi possível carregar sua liga."
        message="Verifique sua conexão e tente de novo."
        actionLabel="Tentar novamente"
        onAction={onRetry}
      />
    );
  }

  // Enquanto o backend prepara/conserta o vínculo, a tela mostra progresso — nunca "sem liga".
  if (loading || !snapshot) {
    return <StateView kind="loading" title="Preparando sua liga..." message="Só um instante." />;
  }

  return (
    <FlatList
      testID="league-ranking-list"
      data={members}
      keyExtractor={(m) => m.uid}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.list}
      getItemLayout={getItemLayout}
      initialNumToRender={20}
      windowSize={11}
      removeClippedSubviews
      ListHeaderComponent={<LeagueHero snapshot={snapshot} hasMembers={members.length > 0} />}
      renderItem={({ item }) => (
        <LeagueRankingRow member={item} zone={zoneOf(item.rank)} leader={item.rank === 1} />
      )}
      // Grupo recém-criado: o ranking existe, só não tem ninguém ainda. Sem isto a tela
      // mostrava o cabeçalho da tabela e um vão em branco até o card de regras (regra 41).
      ListEmptyComponent={
        <StateView
          kind="empty"
          icon="people"
          title="O grupo está sendo montado"
          message="Assim que os jogadores da sua divisão entrarem, o ranking aparece aqui."
          compact
        />
      }
      ListFooterComponent={<LeagueFooter snapshot={snapshot} onPlay={onPlay} />}
    />
  );
}

function LeagueHero({
  snapshot,
  hasMembers,
}: {
  snapshot: LeagueScreenSnapshot;
  hasMembers: boolean;
}) {
  const remaining = useRemaining(snapshot);
  const { currentLeague, previousLeague, nextLeague } = snapshot;

  return (
    <View>
      <Surface style={styles.hero} strong>
        <View style={styles.heroTop}>
          <Image
            source={leagueShield(currentLeague.id)}
            style={styles.heroShield}
            contentFit="contain"
            accessibilityLabel={`Brasão da liga ${currentLeague.displayName}`}
          />
          <View style={styles.heroInfo}>
            <AppText variant="caption" color={colors.textSecondary}>
              LIGA
            </AppText>
            <AppText variant="h1" style={styles.heroName}>
              {currentLeague.displayName.toUpperCase()}
            </AppText>
            <AppText variant="small" color={colors.textSecondary}>
              Divisão {romanNumeral(snapshot.division)}
            </AppText>
          </View>
        </View>

        <View style={styles.countdown}>
          <Ionicons name={icons.clockOutline} size={20} color={colors.gold} />
          <View style={styles.countdownText}>
            <AppText variant="caption" color={colors.textSecondary}>
              Final da semana em
            </AppText>
            <AppText variant="h3">{formatCountdown(remaining)}</AppText>
          </View>
        </View>

        <View style={styles.zones}>
          <ZoneCell
            icon="arrow-up"
            color={colors.primaryBright}
            label="Sobem de liga"
            value={rangeLabel(snapshot.promotionStart, snapshot.promotionEnd)}
          />
          <View style={styles.zoneDivider} />
          <ZoneCell
            icon="arrow-down"
            color={colors.dangerSoft}
            label="Descem de liga"
            value={rangeLabel(snapshot.relegationStart, snapshot.relegationEnd)}
          />
        </View>

        <View style={styles.neighbors}>
          <NeighborCard
            label="Próxima liga"
            league={nextLeague}
            emptyTitle="Liga máxima"
            emptyHint="Você chegou ao topo!"
            fallbackId={currentLeague.id}
          />
          <NeighborCard
            label="Liga anterior"
            league={previousLeague}
            emptyTitle="Liga inicial"
            emptyHint="Você está na primeira liga"
            fallbackId={currentLeague.id}
          />
        </View>
      </Surface>

      {hasMembers ? (
        <View style={styles.tableHead}>
          <AppText variant="caption" color={colors.textSecondary} style={styles.headRank}>
            #
          </AppText>
          <AppText variant="caption" color={colors.textSecondary} style={styles.headPlayer}>
            Jogador
          </AppText>
          <AppText variant="caption" color={colors.textSecondary}>
            Pontos da Semana
          </AppText>
        </View>
      ) : null}
    </View>
  );
}

function LeagueFooter({
  snapshot,
  onPlay,
}: {
  snapshot: LeagueScreenSnapshot;
  onPlay: () => void;
}) {
  return (
    <View style={styles.footer}>
      <Surface style={styles.ruleCard}>
        <Ionicons name={icons.trophy} size={22} color={colors.gold} />
        <AppText variant="small" color={colors.textSecondary} style={styles.ruleText}>
          {weeklyRuleText(snapshot)}
        </AppText>
      </Surface>

      <PrimaryButton
        label="JOGAR AGORA"
        onPress={onPlay}
        style={styles.cta}
        testID="league-play-now"
        accessibilityLabel="Jogar agora e ganhar pontos"
      />
      <AppText variant="small" center color={colors.textSecondary} style={styles.ctaHint}>
        Ganhe pontos e suba de liga!
      </AppText>

      {/* Depois do ranking inteiro e com folga em relação ao "JOGAR AGORA": o anúncio nunca
          entra entre as posições nem pode ser confundido com um jogador da liga. */}
      <NativeAdCard placement="league_native_footer" style={styles.nativeAd} />
    </View>
  );
}

function ZoneCell({
  icon,
  color,
  label,
  value,
}: {
  icon: 'arrow-up' | 'arrow-down';
  color: string;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.zoneCell}>
      <Ionicons name={icon} size={22} color={color} />
      <View style={styles.zoneTexts}>
        <AppText variant="caption" color={colors.textSecondary}>
          {label}
        </AppText>
        <AppText variant="h3">{value}</AppText>
      </View>
    </View>
  );
}

function NeighborCard({
  label,
  league,
  emptyTitle,
  emptyHint,
  fallbackId,
}: {
  label: string;
  league: LeagueScreenSnapshot['nextLeague'];
  emptyTitle: string;
  emptyHint: string;
  fallbackId: string;
}) {
  return (
    <Surface style={styles.neighbor} padding={10}>
      <Image
        source={leagueShield(league?.id ?? fallbackId)}
        style={styles.neighborShield}
        contentFit="contain"
      />
      <View style={styles.neighborText}>
        <AppText variant="caption" color={colors.textSecondary} numberOfLines={1}>
          {league ? label : emptyTitle}
        </AppText>
        <AppText variant="bodyBold" numberOfLines={1}>
          {league ? league.displayName : emptyHint}
        </AppText>
      </View>
    </Surface>
  );
}

/** "1º - 5º", ou um traço quando a zona não existe (grupo pequeno demais). */
function rangeLabel(start: number, end: number): string {
  if (!start || !end) return '—';
  return start === end ? `${start}º` : `${start}º - ${end}º`;
}

/**
 * Countdown ancorado no relógio do servidor: guardamos a diferença entre `serverTime` e o relógio
 * local no momento da resposta e só descontamos o tempo que passou desde então.
 */
function useRemaining(snapshot: LeagueScreenSnapshot): number {
  // Valor inicial já correto (servidor), então o efeito só precisa manter a contagem andando.
  const [remaining, setRemaining] = useState(() => snapshot.endAt - snapshot.serverTime);
  useEffect(() => {
    const skew = snapshot.serverTime - Date.now();
    const id = setInterval(() => setRemaining(snapshot.endAt - (Date.now() + skew)), 30_000);
    return () => clearInterval(id);
  }, [snapshot]);
  return remaining;
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.screen,
    paddingTop: spacing.headerTop,
  },
  headerTitle: { flex: 1 },
  headerSide: { width: 32, alignItems: 'center' },
  tabs: { paddingHorizontal: spacing.screen, marginTop: spacing.md },
  list: { paddingHorizontal: spacing.screen, paddingTop: spacing.md, paddingBottom: spacing.xl },

  hero: { marginBottom: spacing.md },
  heroTop: { flexDirection: 'row', alignItems: 'center' },
  heroShield: { width: 96, height: 106 },
  heroInfo: { flex: 1, marginLeft: spacing.md },
  heroName: { fontSize: 30, color: colors.gold },

  countdown: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.md,
    padding: spacing.sm + 2,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.cardMuted,
  },
  countdownText: { marginLeft: spacing.sm },

  zones: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.sm,
    padding: spacing.sm + 2,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.cardMuted,
  },
  zoneCell: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  zoneTexts: { marginLeft: spacing.sm, flex: 1 },
  zoneDivider: { width: 1, alignSelf: 'stretch', backgroundColor: colors.divider },

  neighbors: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  neighbor: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  neighborShield: { width: 38, height: 42 },
  neighborText: { flex: 1, marginLeft: spacing.sm },

  tableHead: {
    flexDirection: 'row',
    alignItems: 'center',
    // Mesmo recuo das linhas (faixa de "sou eu" + padding), para as colunas baterem.
    paddingLeft: spacing.sm + ME_MARKER_WIDTH,
    paddingRight: spacing.sm,
    paddingBottom: spacing.sm,
  },
  headRank: { width: RANK_COLUMN_WIDTH, textAlign: 'center' },
  // "Jogador" começa onde começa o apelido: avatar + bandeira + os respiros entre eles.
  headPlayer: { flex: 1, marginLeft: AVATAR_SIZE + spacing.sm + FLAG_WIDTH + spacing.sm },

  footer: { marginTop: spacing.md },
  ruleCard: { flexDirection: 'row', alignItems: 'center' },
  ruleText: { flex: 1, marginLeft: spacing.sm },
  cta: { marginTop: spacing.md },
  ctaHint: { marginTop: spacing.sm },
  nativeAd: { marginTop: spacing.xxxl },
});
