import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { colors, radius, spacing } from '@/design-system';
import { leagueShield } from '@/assets';
import { subscribeStats } from '@/services/api';
import { leagueById } from '@/domain/model/leagues';
import { formatNumber, pct } from '@/utils/format';
import type { AvatarId, LeagueId, PlayerStats, PresenceState } from '@/domain/model/types';
import { AppText } from './AppText';
import { CountryFlag } from './CountryFlag';
import { PlayerAvatar } from './PlayerAvatar';
import { StatsRow } from './StatsRow';

export interface PlayerSummaryData {
  id: string;
  nickname: string;
  avatarId: AvatarId;
  countryCode?: string;
  /** Ausentes enquanto o perfil completo ainda não chegou (a ficha abre com o que a lista tinha). */
  level?: number;
  leagueId?: LeagueId;
  leaguePoints?: number;
}

/**
 * O "quem é" de um jogador: avatar, apelido, país, nível, liga e números.
 * Usado pela ficha do amigo e pela ficha de jogador da Liga — as duas mostram o mesmo cartão.
 * Os números vêm de `playerStats/{uid}`, que qualquer usuário logado pode ler.
 */
export function PlayerProfileSummary({
  player,
  status,
}: {
  player: PlayerSummaryData;
  status?: PresenceState;
}) {
  const stats = usePlayerStats(player.id);
  const league = player.leagueId ? leagueById(player.leagueId) : null;
  return (
    <View testID="player-summary">
      <View style={styles.identity}>
        <PlayerAvatar avatarId={player.avatarId} size={72} status={status} />
        <View style={styles.identityTexts}>
          <View style={styles.nameRow}>
            <AppText variant="h3" numberOfLines={1} style={styles.nick}>
              @{player.nickname}
            </AppText>
            {player.countryCode ? <CountryFlag code={player.countryCode} width={22} /> : null}
          </View>
          {player.level !== undefined ? (
            <AppText variant="small" color={colors.primaryBright}>
              Nível {player.level}
            </AppText>
          ) : null}
        </View>
      </View>

      {league && player.leagueId ? (
        <View style={styles.league}>
          <Image
            source={leagueShield(player.leagueId)}
            style={styles.shield}
            contentFit="contain"
          />
          <View style={styles.leagueTexts}>
            <AppText variant="bodyBold">Liga {league.displayName}</AppText>
            <AppText variant="small" color={colors.textSecondary}>
              {formatNumber(player.leaguePoints ?? 0)} pontos
            </AppText>
          </View>
        </View>
      ) : null}

      <View style={styles.stats}>
        <StatsRow
          stats={[
            { value: String(stats?.matches ?? 0), label: 'Partidas' },
            { value: String(stats?.wins ?? 0), label: 'Vitórias' },
            { value: `${pct(stats?.wins ?? 0, stats?.matches ?? 0)}%`, label: 'Aproveitamento' },
          ]}
        />
      </View>
    </View>
  );
}

/** Números do jogador; trocar de jogador limpa os do anterior durante a renderização. */
function usePlayerStats(uid: string) {
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [prevUid, setPrevUid] = useState(uid);
  if (uid !== prevUid) {
    setPrevUid(uid);
    setStats(null);
  }
  useEffect(() => subscribeStats(uid, setStats), [uid]);
  return stats;
}

const styles = StyleSheet.create({
  identity: { flexDirection: 'row', alignItems: 'center' },
  identityTexts: { flex: 1, marginLeft: 14 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  nick: { flexShrink: 1, fontSize: 16 },
  league: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.lg,
    padding: 10,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  shield: { width: 38, height: 38 },
  leagueTexts: { marginLeft: 12, flex: 1 },
  stats: { marginTop: spacing.md },
});
