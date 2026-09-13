import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, radius, spacing, typography } from '@/design-system';
import { AppText, CountryFlag, PlayerAvatar } from '@/components';
import { formatNumber } from '@/utils/format';
import type { LeagueRankingMember } from '@/domain/model/types';

export const RANKING_ROW_HEIGHT = 40;

export type RankingZone = 'promotion' | 'relegation' | 'neutral';

/** Medalha das 3 primeiras posições; do 4º em diante é só o número. */
const MEDAL: Record<number, string> = {
  1: colors.gold,
  2: colors.silver,
  3: colors.bronze,
};

interface Props {
  member: LeagueRankingMember;
  zone: RankingZone;
  /** Coroa do líder, como na referência. */
  leader: boolean;
}

function Row({ member, zone, leader }: Props) {
  const medal = MEDAL[member.rank];
  return (
    <View
      style={[
        styles.row,
        zone === 'promotion' && styles.promotion,
        zone === 'relegation' && styles.relegation,
        member.isMe && styles.me,
      ]}
      accessibilityLabel={`${member.rank}º lugar, ${member.nickname}, ${formatNumber(
        member.weeklyPoints,
      )} pontos${member.isMe ? ', você' : ''}`}
    >
      <View style={styles.rankCell}>
        {medal ? (
          <View style={[styles.medal, { backgroundColor: medal }]}>
            <AppText variant="smallBold" color={colors.textDark} style={styles.medalText}>
              {member.rank}
            </AppText>
          </View>
        ) : (
          <AppText variant="smallBold" color={colors.textSecondary} style={styles.rankText}>
            {member.rank}
          </AppText>
        )}
      </View>

      <PlayerAvatar avatarId={member.avatarId} size={28} ring={false} />
      <View style={styles.flag}>
        <CountryFlag code={member.countryCode} width={20} />
      </View>

      <AppText
        variant="body"
        numberOfLines={1}
        style={styles.nickname}
        color={member.isMe ? colors.primaryBright : colors.text}
      >
        {member.nickname}
      </AppText>
      {leader ? (
        <Ionicons name="ribbon" size={14} color={colors.gold} style={styles.crown} />
      ) : null}

      <AppText variant="bodyBold" style={styles.points}>
        {formatNumber(member.weeklyPoints)}
      </AppText>
    </View>
  );
}

export const LeagueRankingRow = memo(Row);

const styles = StyleSheet.create({
  row: {
    height: RANKING_ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  // Zonas de promoção/rebaixamento pintam a linha inteira, como no mockup.
  promotion: { backgroundColor: 'rgba(5, 200, 117, 0.12)' },
  relegation: { backgroundColor: 'rgba(160, 20, 35, 0.22)' },
  me: { borderLeftWidth: 3, borderLeftColor: colors.primaryBright },
  rankCell: { width: 28, alignItems: 'center' },
  rankText: { ...typography.smallBold, textAlign: 'center' },
  medal: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  medalText: { fontSize: 11 },
  flag: { marginLeft: spacing.sm, borderRadius: radius.xs / 2 },
  nickname: { flex: 1, marginLeft: spacing.sm },
  crown: { marginLeft: 4 },
  points: { marginLeft: spacing.sm },
});
