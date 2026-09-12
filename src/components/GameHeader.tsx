import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { useNavigation } from '@react-navigation/native';
import { colors, spacing } from '@/design-system';
import { images } from '@/assets';
import { useProfileStore } from '@/stores/profileStore';
import { AppText } from './AppText';
import { PlayerAvatar } from './PlayerAvatar';
import { CurrencyBadge } from './CurrencyBadge';
import { IconButton } from './Buttons';
import type { RootNavigation } from '@/navigation/types';

interface Props {
  /** "logo" = logo on top + avatar/currency row (Jogar, Liga). "title" = centered title + avatar (other tabs). */
  variant: 'logo' | 'title';
  title?: string;
  showBack?: boolean;
  onBack?: () => void;
  rightSlot?: React.ReactNode;
}

export function GameHeader({ variant, title, showBack, onBack, rightSlot }: Props) {
  const navigation = useNavigation<RootNavigation>();
  const profile = useProfileStore((s) => s.profile);
  const avatarId = profile?.avatarId ?? 'joao';

  if (variant === 'logo') {
    return (
      <View style={styles.wrap}>
        <Image
          source={images.logo}
          style={styles.logo}
          contentFit="contain"
          accessibilityLabel="Truco Mineiro"
        />
        <View style={styles.row}>
          <PlayerAvatar avatarId={avatarId} size={48} badge="coin" testID="header-avatar" />
          <View style={styles.currencies}>
            <CurrencyBadge
              kind="coin"
              value={profile?.coins ?? 0}
              onAdd={() => navigation.navigate('Store', { tab: 'moedas' })}
            />
            <CurrencyBadge
              kind="gem"
              value={profile?.gems ?? 0}
              onAdd={() => navigation.navigate('Store', { tab: 'moedas' })}
            />
          </View>
          <IconButton
            icon="notifications"
            accessibilityLabel="Notificações"
            onPress={() => navigation.navigate('Notifications')}
          />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.titleWrap}>
      <View style={styles.titleRow}>
        <View style={styles.side}>
          {showBack ? (
            <IconButton
              icon="chevron-back"
              boxed={false}
              accessibilityLabel="Voltar"
              onPress={onBack ?? (() => navigation.goBack())}
              size={28}
              color={colors.text}
            />
          ) : (
            <PlayerAvatar avatarId={avatarId} size={44} badge="coin" />
          )}
        </View>
        <AppText variant="h1" center style={styles.title} numberOfLines={1}>
          {title}
        </AppText>
        <View style={[styles.side, styles.right]}>{rightSlot}</View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingTop: spacing.headerTop, marginBottom: spacing.md },
  logo: { width: 110, height: 44, alignSelf: 'center', marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  currencies: {
    flexDirection: 'row',
    gap: 8,
    flex: 1,
    justifyContent: 'center',
    marginHorizontal: 8,
  },
  titleWrap: { paddingTop: spacing.headerTop, marginBottom: spacing.md },
  titleRow: { flexDirection: 'row', alignItems: 'center', minHeight: 48 },
  side: { width: 48, alignItems: 'flex-start', justifyContent: 'center' },
  right: { alignItems: 'flex-end' },
  title: { flex: 1 },
});
