import React, { PropsWithChildren } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, spacing } from '@/design-system';
import { AppText } from './AppText';
import { IconButton } from './Buttons';

interface Props {
  visible: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  testID?: string;
}

/** Folha inferior translúcida — mesma linguagem dos cards, ancorada na base da tela. */
export function Sheet({
  visible,
  onClose,
  title,
  subtitle,
  children,
  testID,
}: PropsWithChildren<Props>) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable
          style={StyleSheet.absoluteFill}
          accessibilityRole="button"
          accessibilityLabel="Fechar"
          onPress={onClose}
        />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.xl }]} testID={testID}>
          <View style={styles.grabber} />
          <View style={styles.header}>
            <View style={styles.titles}>
              <AppText variant="h2">{title}</AppText>
              {subtitle ? (
                <AppText variant="small" color={colors.textSecondary} style={styles.subtitle}>
                  {subtitle}
                </AppText>
              ) : null}
            </View>
            <IconButton icon="close" accessibilityLabel="Fechar" onPress={onClose} boxed={false} />
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.body}
          >
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end', backgroundColor: colors.overlay },
  sheet: {
    backgroundColor: colors.bgMid,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderTopWidth: 1,
    borderColor: colors.cardBorderStrong,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    maxHeight: '88%',
  },
  grabber: {
    alignSelf: 'center',
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.cardBorderStrong,
    marginBottom: spacing.md,
  },
  header: { flexDirection: 'row', alignItems: 'flex-start' },
  titles: { flex: 1, paddingRight: spacing.sm },
  subtitle: { marginTop: 2 },
  body: { paddingTop: spacing.lg },
});
