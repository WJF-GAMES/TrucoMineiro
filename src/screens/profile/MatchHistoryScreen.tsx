import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, spacing } from '@/design-system';
import { AppText, GameHeader, PlayerAvatar, Screen, StateView, Surface } from '@/components';
import { useAuthStore } from '@/stores/authStore';
import { getMatchHistory } from '@/services/firebase/firestore';
import type { MatchHistoryEntry } from '@/domain/model/types';

export function MatchHistoryScreen() {
  const uid = useAuthStore((s) => s.user?.uid);
  const [items, setItems] = useState<MatchHistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!uid) return;
    getMatchHistory(uid)
      .then((items) => {
        setItems(items);
        setError(null);
      })
      .catch((e) => setError(e.message));
  }, [uid]);
  useEffect(load, [load]);

  return (
    <Screen scroll testID="screen-history">
      <GameHeader variant="title" title="Histórico de Partidas" showBack />
      {error ? (
        <StateView kind="error" message={error} actionLabel="Tentar de novo" onAction={load} />
      ) : !items ? (
        <StateView kind="loading" />
      ) : items.length === 0 ? (
        <StateView
          kind="empty"
          title="Nenhuma partida ainda"
          message="Suas partidas concluídas aparecem aqui."
        />
      ) : (
        items.map((m) => {
          const me = m.players.find((p) => p.uid === uid);
          const won = me ? me.seat % 2 === m.winnerTeam : false;
          const date = new Date(m.finishedAt);
          return (
            <Surface key={m.id} style={styles.row}>
              <View
                style={[
                  styles.badge,
                  { backgroundColor: won ? colors.primaryDeep : colors.dangerBg },
                ]}
              >
                <Ionicons
                  name={won ? 'trophy' : 'close'}
                  size={20}
                  color={won ? colors.gold : colors.dangerSoft}
                />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <AppText variant="h3">
                  {won ? 'Vitória' : 'Derrota'} {m.scores[0]} x {m.scores[1]}
                </AppText>
                <AppText variant="caption" color={colors.textSecondary}>
                  {m.mode === 'ai' ? `Contra a IA (${m.difficulty ?? 'normal'})` : 'Online'} •{' '}
                  {date.toLocaleDateString('pt-BR')}{' '}
                  {date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                </AppText>
              </View>
              <View style={styles.avatars}>
                {m.players
                  .filter((p) => p.uid !== uid)
                  .slice(0, 3)
                  .map((p, i) => (
                    <PlayerAvatar
                      key={p.uid + i}
                      avatarId={p.avatarId}
                      size={26}
                      ring={false}
                      style={{ marginLeft: i === 0 ? 0 : -8 }}
                    />
                  ))}
              </View>
            </Surface>
          );
        })
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
  badge: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatars: { flexDirection: 'row' },
});
