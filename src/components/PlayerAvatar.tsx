import React from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { colors } from '@/design-system';
import { avatarImages } from '@/assets';
import type { AvatarId, PresenceState } from '@/domain/model/types';

interface Props {
  avatarId: AvatarId | string | null | undefined;
  size?: number;
  ring?: boolean;
  ringColor?: string;
  status?: PresenceState | null;
  /** Small coin-like badge at the bottom-right (as in the header avatar). */
  badge?: 'coin' | 'check' | null;
  style?: ViewStyle;
  selected?: boolean;
  testID?: string;
}

export function PlayerAvatar({
  avatarId,
  size = 44,
  ring = true,
  ringColor = colors.primary,
  status,
  badge,
  style,
  selected,
  testID,
}: Props) {
  const source = avatarImages[(avatarId as AvatarId) ?? 'joao'] ?? avatarImages.joao;
  const ringWidth = size >= 80 ? 3 : 2;
  return (
    <View style={[{ width: size, height: size }, style]} testID={testID}>
      <View
        style={[
          styles.ring,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            borderWidth: ring ? ringWidth : 0,
            borderColor: ringColor,
          },
          selected && styles.selected,
        ]}
      >
        <Image
          source={source}
          style={{
            width: size - ringWidth * 2,
            height: size - ringWidth * 2,
            borderRadius: size / 2,
          }}
          contentFit="cover"
        />
      </View>
      {status ? (
        <View
          style={[
            styles.status,
            {
              width: size * 0.28,
              height: size * 0.28,
              borderRadius: size * 0.14,
              backgroundColor:
                status === 'online'
                  ? colors.online
                  : status === 'in_match'
                    ? colors.away
                    : colors.offline,
            },
          ]}
        />
      ) : null}
      {badge ? (
        <View
          style={[
            styles.badge,
            {
              width: size * 0.24,
              height: size * 0.24,
              borderRadius: size * 0.12,
              backgroundColor: badge === 'coin' ? colors.gold : colors.primary,
            },
          ]}
        >
          <View style={[styles.badgeInner, { borderRadius: size * 0.1 }]} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  ring: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0a2a25',
  },
  selected: {
    borderColor: colors.primaryBright,
    shadowColor: colors.primary,
    shadowOpacity: 0.8,
    shadowRadius: 10,
  },
  status: { position: 'absolute', right: 0, bottom: 0, borderWidth: 2, borderColor: colors.bgTop },
  badge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    borderWidth: 2,
    borderColor: colors.bgTop,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeInner: { width: '55%', height: '55%', backgroundColor: 'rgba(255,255,255,0.55)' },
});
