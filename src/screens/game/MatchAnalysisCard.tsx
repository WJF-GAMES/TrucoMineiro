import React from 'react';
import { StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, spacing } from '@/design-system';
import { AppText, Surface } from '@/components';
import type { MatchAnalysis } from '@/features/game/matchAnalysis';

/** Conteúdo liberado pelo Rewarded da tela de resultado: números e leituras da partida. */
export function MatchAnalysisCard({ analysis }: { analysis: MatchAnalysis }) {
  const { rounds, truco, points } = analysis;
  return (
    <Surface style={styles.card} testID="match-analysis">
      <View style={styles.header}>
        <Ionicons name="stats-chart" size={18} color={colors.primaryBright} />
        <AppText variant="h3" style={styles.title}>
          Análise da partida
        </AppText>
      </View>

      <View style={styles.grid}>
        <Metric label="Mãos" value={`${analysis.handsPlayed}`} />
        <Metric label="Rodadas ganhas" value={`${rounds.won}`} />
        <Metric label="Rodadas perdidas" value={`${rounds.lost}`} />
        <Metric label="Empates" value={`${rounds.tied}`} />
        <Metric label="Trucos pedidos" value={`${truco.calledByUs}`} />
        <Metric label="Trucos sofridos" value={`${truco.calledByThem}`} />
        <Metric label="Fugas" value={`${analysis.runs.us}`} />
        <Metric label="Mão mais cara" value={`${analysis.highestHandValue} pts`} />
      </View>

      <View style={styles.pointsRow}>
        <AppText variant="small" color={colors.textSecondary}>
          Pontos em mãos apostadas
        </AppText>
        <AppText variant="smallBold">
          {points.fromRaisedHands.us} x {points.fromRaisedHands.them}
        </AppText>
      </View>

      {analysis.insights.map((insight, i) => (
        <View key={i} style={styles.insight}>
          <Ionicons name="bulb-outline" size={14} color={colors.gold} style={styles.insightIcon} />
          <AppText variant="small" color={colors.textSecondary} style={styles.insightText}>
            {insight}
          </AppText>
        </View>
      ))}
    </Surface>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <AppText variant="h3" color={colors.primaryBright}>
        {value}
      </AppText>
      <AppText variant="caption" color={colors.textSecondary} numberOfLines={1}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: spacing.md },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { marginLeft: 2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.md },
  metric: { width: '25%', alignItems: 'center', marginBottom: spacing.md },
  pointsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    paddingTop: spacing.sm,
  },
  insight: { flexDirection: 'row', alignItems: 'flex-start', marginTop: spacing.sm },
  insightIcon: { marginTop: 2, marginRight: spacing.sm },
  insightText: { flex: 1 },
});
