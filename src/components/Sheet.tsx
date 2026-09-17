import React, { PropsWithChildren, useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, icons, radius, spacing } from '@/design-system';
import { AppText } from './AppText';
import { IconButton } from './Buttons';

interface Props {
  visible: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  testID?: string;
}

/**
 * Tempo em que a folha ainda está subindo (animação `slide` do Modal) e ignora toques — nela e no
 * fundo escuro (que fecharia a folha). Sem isto, um segundo toque na linha que abriu a folha caía
 * no botão que passava por baixo do dedo — a ficha do amigo abria direto na confirmação de
 * "Remover amizade".
 */
const OPEN_GUARD_MS = 600;

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
  const [armed, setArmed] = useState(false);
  const [prevVisible, setPrevVisible] = useState(visible);
  if (visible !== prevVisible) {
    setPrevVisible(visible);
    setArmed(false);
  }
  useEffect(() => {
    if (!visible || armed) return;
    const t = setTimeout(() => setArmed(true), OPEN_GUARD_MS);
    return () => clearTimeout(t);
  }, [visible, armed]);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* Dentro de um Modal o Android não redimensiona a janela e o iOS nunca redimensiona:
          sem isto o teclado cobria o botão de enviar das folhas com campo de texto (regra 40). */}
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <Pressable
          style={StyleSheet.absoluteFill}
          accessibilityRole="button"
          accessibilityLabel="Fechar"
          onPress={armed ? onClose : undefined}
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
            <IconButton
            icon={icons.close}
            accessibilityLabel="Fechar"
            onPress={onClose}
            boxed={false}
          />
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.body}
          >
            {children}
          </ScrollView>
          {/* Engole os toques enquanto a folha sobe: nem aciona botão, nem cai no fundo (fechar). */}
          {armed ? null : (
            <View
              style={StyleSheet.absoluteFill}
              onStartShouldSetResponder={() => true}
              testID={testID ? `${testID}-opening` : undefined}
            />
          )}
        </View>
      </KeyboardAvoidingView>
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
