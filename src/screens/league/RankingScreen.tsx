import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { colors, spacing } from '@/design-system';
import { AppText, GameHeader, PlayerAvatar, Screen, StateView, Surface } from '@/components';
import { getGlobalRanking } from '@/services/firebase/firestore';
import type { Profile } from '@/domain/model/types';
import { LEAGUE_NAMES } from '@/domain/model/leagues';
import { useProfileStore } from '@/stores/profileStore';
import { formatNumber } from '@/utils/format';

export function RankingScreen() {
  const [items, setItems] = useState<Profile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const me = useProfileStore((s) => s.profile);

  const load = useCallback(() => {
    getGlobalRanking(50)
      .then((items) => {
        setItems(items);
        setError(null);
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  return (
    <Screen testID="screen-ranking">
      <GameHeader variant="title" title="Ranking Global" showBack />
      {error ? (
        <StateView kind="error" message={error} actionLabel="Tentar de novo" onAction={load} />
      ) : !items ? (
        <StateView kind="loading" />
      ) : items.length === 0 ? (
        <StateView
          kind="empty"
          title="Ninguém no ranking ainda"
          message="Jogue partidas para pontuar na liga."
        />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(p) => p.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: spacing.xxl }}
          renderItem={({ item, index }) => (
            <Surface style={[styles.row, item.id === me?.id ? styles.me : {}]} padding={10}>
              <AppText
                variant="h3"
                color={index < 3 ? colors.gold : colors.textSecondary}
                style={styles.pos}
              >
                {index + 1}
              </AppText>
              <PlayerAvatar avatarId={item.avatarId} size={42} />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <AppText variant="bodyBold" numberOfLines={1}>
                  {item.nickname}
                </AppText>
                <AppText variant="caption" color={colors.textSecondary}>
                  Liga {LEAGUE_NAMES[item.leagueId]} • Nível {item.level}
                </AppText>
              </View>
              <AppText variant="bodyBold" color={colors.primaryBright}>
                {formatNumber(item.leaguePoints)} pts
              </AppText>
            </Surface>
          )}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  me: { borderColor: colors.primaryBright },
  pos: { width: 30, textAlign: 'center', marginRight: 6 },
});
