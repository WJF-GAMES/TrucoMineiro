import React from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, icons } from '@/design-system';
import { avatarImages } from '@/assets';
import type { AvatarId, PresenceState } from '@/domain/model/types';

interface Props {
  avatarId: AvatarId | string | null | undefined;
  size?: number;
  ring?: boolean;
  ringColor?: string;
  status?: PresenceState | null;
  /** Small badge at the bottom-right (e.g. a check on a selected avatar). */
  badge?: 'check' | null;
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
          // Memória além do disco: sem isto cada avatar que volta a aparecer é decodificado de
          // novo (1–2 s no emulador) e a mesa mostra anéis vazios depois da distribuição.
          cachePolicy="memory-disk"
          transition={0}
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
              width: size * 0.3,
              height: size * 0.3,
              borderRadius: size * 0.15,
              backgroundColor: colors.primary,
            },
          ]}
        >
          <Ionicons name={icons.check} size={Math.round(size * 0.2)} color={colors.text} />
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
});
