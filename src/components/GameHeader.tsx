import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { useNavigation } from '@react-navigation/native';
import { colors, spacing } from '@/design-system';
import { images } from '@/assets';
import { useProfileStore } from '@/stores/profileStore';
import { AppText } from './AppText';
import { PlayerAvatar } from './PlayerAvatar';
import { IconButton } from './Buttons';
import type { RootNavigation } from '@/navigation/types';

interface Props {
  /** "logo" = avatar + logo centralizada + sino (Jogar, Liga). "title" = título centralizado (demais abas). */
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
        <View style={styles.row}>
          <View style={styles.side}>
            <PlayerAvatar avatarId={avatarId} size={48} testID="header-avatar" />
          </View>
          <Image
            source={images.logo}
            style={styles.logo}
            contentFit="contain"
            accessibilityLabel="Truco Mineiro"
          />
          <View style={[styles.side, styles.right]}>
            <IconButton
              icon="notifications"
              accessibilityLabel="Notificações"
              onPress={() => navigation.navigate('Notifications')}
            />
          </View>
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
            <PlayerAvatar avatarId={avatarId} size={44} />
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
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 60 },
  // Ocupa a faixa livre entre avatar e sino; `contain` centraliza a marca dentro dela.
  logo: { flex: 1, height: 60, marginHorizontal: spacing.sm },
  titleWrap: { paddingTop: spacing.headerTop, marginBottom: spacing.md },
  titleRow: { flexDirection: 'row', alignItems: 'center', minHeight: 48 },
  side: { width: 48, alignItems: 'flex-start', justifyContent: 'center' },
  right: { alignItems: 'flex-end' },
  title: { flex: 1 },
});
