import React, { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, icons, radius, spacing, typography } from '@/design-system';
import { AppText, CountryFlag, PlayerAvatar } from '@/components';
import { formatNumber } from '@/utils/format';
import type { LeagueRankingMember } from '@/domain/model/types';

export const RANKING_ROW_HEIGHT = 40;

/** Colunas da tabela — o cabeçalho da tela importa estes valores para alinhar com as linhas. */
export const RANK_COLUMN_WIDTH = 28;
export const AVATAR_SIZE = 28;
export const FLAG_WIDTH = 20;
/** Faixa marcada à esquerda de "sou eu"; reservada (transparente) em todas as linhas. */
export const ME_MARKER_WIDTH = 3;

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
  /** Tocar na linha abre a ficha do jogador. */
  onOpen?: (member: LeagueRankingMember) => void;
}

function Row({ member, zone, leader, onOpen }: Props) {
  const medal = MEDAL[member.rank];
  return (
    <Pressable
      onPress={onOpen ? () => onOpen(member) : undefined}
      disabled={!onOpen}
      accessibilityRole={onOpen ? 'button' : undefined}
      accessibilityHint={onOpen ? 'Abre o perfil do jogador' : undefined}
      testID={`ranking-row-${member.uid}`}
      style={({ pressed }) => [
        styles.row,
        zone === 'promotion' && styles.promotion,
        zone === 'relegation' && styles.relegation,
        member.isMe && styles.me,
        pressed && styles.pressed,
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

      <PlayerAvatar avatarId={member.avatarId} size={AVATAR_SIZE} ring={false} />
      <View style={styles.flag}>
        <CountryFlag code={member.countryCode} width={FLAG_WIDTH} />
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
        <Ionicons name={icons.leader} size={14} color={colors.gold} style={styles.crown} />
      ) : null}

      <AppText variant="bodyBold" style={styles.points}>
        {formatNumber(member.weeklyPoints)}
      </AppText>
    </Pressable>
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
    // A faixa de "sou eu" existe em TODAS as linhas, transparente nas outras: quando só a
    // minha linha ganhava a borda, ela empurrava o conteúdo 3px e desalinhava a coluna
    // inteira do ranking (regra 9).
    borderLeftWidth: ME_MARKER_WIDTH,
    borderLeftColor: 'transparent',
  },
  // Zonas de promoção/rebaixamento pintam a linha inteira, como no mockup.
  promotion: { backgroundColor: 'rgba(5, 200, 117, 0.12)' },
  relegation: { backgroundColor: 'rgba(160, 20, 35, 0.22)' },
  me: { borderLeftColor: colors.primaryBright },
  pressed: { backgroundColor: colors.card },
  rankCell: { width: RANK_COLUMN_WIDTH, alignItems: 'center' },
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
