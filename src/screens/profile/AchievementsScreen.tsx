import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, icons, IoniconName, spacing } from '@/design-system';
import { AppText, GameHeader, ProgressBar, Screen, StateView, Surface } from '@/components';
import { useAuthStore } from '@/stores/authStore';
import { useProfileStore } from '@/stores/profileStore';
import { getAchievements, subscribeUserAchievements } from '@/services/api';
import type { Achievement } from '@/domain/model/types';

export function AchievementsScreen() {
  const uid = useAuthStore((s) => s.user?.uid);
  const stats = useProfileStore((s) => s.stats);
  const [list, setList] = useState<Achievement[] | null>(null);
  const [unlocked, setUnlocked] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    getAchievements()
      .then((a) => alive && setList(a))
      .catch(() => alive && setError('Não foi possível carregar suas conquistas.'));
    const stop = uid
      ? subscribeUserAchievements(uid, (ua) => setUnlocked(ua?.unlocked ?? {}))
      : undefined;
    return () => {
      alive = false;
      stop?.();
    };
  }, [uid, attempt]);

  return (
    <Screen scroll testID="screen-achievements">
      <GameHeader variant="title" title="Minhas Conquistas" showBack />
      {error ? (
        <StateView
          kind="error"
          title="Não foi possível carregar"
          message="Verifique sua conexão e tente de novo."
          actionLabel="Tentar novamente"
          onAction={() => {
            setError(null);
            setAttempt((n) => n + 1);
          }}
        />
      ) : !list ? (
        <StateView kind="loading" />
      ) : list.length === 0 ? (
        <StateView kind="empty" title="Sem conquistas cadastradas" />
      ) : (
        list.map((a) => {
          const done = Boolean(unlocked[a.id]);
          const current = Number(stats?.[a.stat] ?? 0);
          return (
            <Surface key={a.id} style={[styles.row, done ? styles.done : {}]}>
              <View style={[styles.icon, done && styles.iconDone]}>
                <Ionicons
                  name={(a.icon as IoniconName) || 'medal'}
                  size={24}
                  color={done ? colors.textDark : colors.cream}
                />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <AppText variant="h3">{a.title}</AppText>
                <AppText variant="small" color={colors.textSecondary}>
                  {a.description}
                </AppText>
                <View style={styles.progress}>
                  <ProgressBar
                    value={Math.min(current, a.target)}
                    max={a.target}
                    height={6}
                    style={{ flex: 1 }}
                  />
                  <AppText variant="caption" color={colors.textSecondary} style={{ marginLeft: 8 }}>
                    {Math.min(current, a.target)}/{a.target}
                  </AppText>
                </View>
              </View>
              {done ? (
                <Ionicons name={icons.checkCircle} size={22} color={colors.primaryBright} />
              ) : null}
            </Surface>
          );
        })
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
  done: { borderColor: colors.primaryBright },
  icon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconDone: { backgroundColor: colors.gold },
  progress: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
});
