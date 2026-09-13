import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { colors, spacing } from '@/design-system';
import { leagueShield } from '@/assets';
import { AppText, StateView, Surface } from '@/components';
import { useAuthStore } from '@/stores/authStore';
import { getLeagueHistory } from '@/services/firebase/firestore';
import { formatNumber, romanNumeral } from '@/utils/format';
import type { LeagueHistoryEntry, WeeklyResult } from '@/domain/model/types';

const RESULT_LABEL: Record<WeeklyResult, string> = {
  promoted: 'Subiu',
  stayed: 'Permaneceu',
  relegated: 'Desceu',
  top_league: 'Manteve o topo',
  bottom_league: 'Permaneceu',
};

const RESULT_COLOR: Record<WeeklyResult, string> = {
  promoted: colors.primaryBright,
  stayed: colors.textSecondary,
  relegated: colors.dangerSoft,
  top_league: colors.gold,
  bottom_league: colors.textSecondary,
};

/** "2026-W37" -> "Semana 37 de 2026". */
function weekLabel(weekKey: string): string {
  const [year, week] = weekKey.split('-W');
  return week ? `Semana ${Number(week)} de ${year}` : weekKey;
}

export function LeagueHistoryTab() {
  const uid = useAuthStore((s) => s.user?.uid);
  const [items, setItems] = useState<LeagueHistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => {
    setItems(null);
    setError(null);
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    getLeagueHistory(uid, 30)
      .then((h) => !cancelled && setItems(h))
      .catch(() => !cancelled && setError('Não foi possível carregar seu histórico.'));
    return () => {
      cancelled = true;
    };
  }, [uid, attempt]);

  if (error) {
    return (
      <StateView kind="error" message={error} actionLabel="Tentar novamente" onAction={reload} />
    );
  }
  if (!items) return <StateView kind="loading" />;
  if (items.length === 0) {
    return (
      <StateView
        kind="empty"
        icon="calendar"
        title="Sua primeira semana está rolando"
        message="Quando ela terminar, o resultado aparece aqui."
      />
    );
  }

  return (
    <FlatList
      data={items}
      keyExtractor={(h) => h.weekKey}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.list}
      renderItem={({ item }) => (
        <Surface style={styles.row} padding={10}>
          <Image
            source={leagueShield(item.leagueId)}
            style={styles.shield}
            contentFit="contain"
          />
          <View style={styles.info}>
            <AppText variant="bodyBold" numberOfLines={1}>
              {weekLabel(item.weekKey)}
            </AppText>
            <AppText variant="caption" color={colors.textSecondary}>
              Divisão {romanNumeral(item.division)} • {item.finalRank}º de {item.groupSize} •{' '}
              {formatNumber(item.weeklyPoints)} pts
            </AppText>
          </View>
          <AppText variant="smallBold" color={RESULT_COLOR[item.result]}>
            {RESULT_LABEL[item.result]}
          </AppText>
        </Surface>
      )}
    />
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: spacing.screen, paddingTop: spacing.md, paddingBottom: spacing.xl },
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
  shield: { width: 38, height: 42 },
  info: { flex: 1, marginLeft: spacing.sm },
});
