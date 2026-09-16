import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { colors, spacing } from '@/design-system';
import { leagueShield } from '@/assets';
import { AppText, CountryFlag, PlayerAvatar, StateView, Surface } from '@/components';
import { getGlobalLeagueRanking, FunctionsError } from '@/services/firebase/functions';
import { leagueById } from '@/domain/model/leagues';
import { formatNumber } from '@/utils/format';
import type { GlobalRankingEntry } from '@/domain/model/types';
import type { RankingPlayer } from './PlayerProfileSheet';

/**
 * Classificação geral da temporada — separada do ranking do grupo semanal.
 * A ordem vem pronta do backend (o cliente nunca ordena ranking global).
 */
export function GlobalRankingTab({
  onOpenPlayer,
}: {
  /** Tocar num jogador abre a ficha dele. */
  onOpenPlayer?: (player: RankingPlayer) => void;
}) {
  const [items, setItems] = useState<GlobalRankingEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => {
    setItems(null);
    setError(null);
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    getGlobalLeagueRanking(50)
      .then((r) => !cancelled && setItems(r.entries))
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(
          e instanceof FunctionsError ? e.message : 'Não foi possível carregar a classificação.',
        );
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

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
        icon="trophy"
        title="Ninguém pontuou ainda"
        message="Jogue uma partida para abrir a classificação."
      />
    );
  }

  return (
    <FlatList
      data={items}
      keyExtractor={(e) => e.uid}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.list}
      renderItem={({ item }) => (
        <Pressable
          onPress={
            onOpenPlayer
              ? () =>
                  onOpenPlayer({
                    id: item.uid,
                    nickname: item.nickname,
                    avatarId: item.avatarId,
                    countryCode: item.countryCode,
                  })
              : undefined
          }
          disabled={!onOpenPlayer}
          accessibilityRole={onOpenPlayer ? 'button' : undefined}
          accessibilityLabel={`${item.rank}º, ${item.nickname}, ${formatNumber(item.seasonPoints)} pontos`}
          accessibilityHint={onOpenPlayer ? 'Abre o perfil do jogador' : undefined}
          testID={`global-row-${item.uid}`}
          style={({ pressed }) => pressed && styles.pressed}
        >
          <Surface style={[styles.row, ...(item.isMe ? [styles.me] : [])]} padding={10}>
            <AppText
              variant="bodyBold"
              color={item.rank <= 3 ? colors.gold : colors.textSecondary}
              style={styles.rank}
            >
              {item.rank}
            </AppText>
            <PlayerAvatar avatarId={item.avatarId} size={34} ring={false} />
            <View style={styles.flag}>
              <CountryFlag code={item.countryCode} width={20} />
            </View>
            <View style={styles.info}>
              <AppText variant="bodyBold" numberOfLines={1}>
                {item.nickname}
              </AppText>
              <AppText variant="caption" color={colors.textSecondary}>
                Liga {leagueById(item.leagueId).displayName}
              </AppText>
            </View>
            <Image
              source={leagueShield(item.leagueId)}
              style={styles.shield}
              contentFit="contain"
            />
            <AppText variant="bodyBold" color={colors.primaryBright} style={styles.points}>
              {formatNumber(item.seasonPoints)}
            </AppText>
          </Surface>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: spacing.screen, paddingTop: spacing.md, paddingBottom: spacing.xl },
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
  me: { borderColor: colors.primaryBright },
  pressed: { opacity: 0.7 },
  rank: { width: 26, textAlign: 'center' },
  flag: { marginLeft: spacing.sm },
  info: { flex: 1, marginLeft: spacing.sm },
  shield: { width: 24, height: 27, marginRight: spacing.sm },
  points: { minWidth: 46, textAlign: 'right' },
});
