import React, { useEffect } from 'react';
import { ActivityIndicator, BackHandler, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { colors, radius, spacing } from '@/design-system';
import { AppText } from './AppText';

interface Props {
  visible: boolean;
  message?: string;
  testID?: string;
}

/**
 * Carregamento bloqueante: escurece a tela, trava toques e o botão voltar do Android, e mostra um
 * spinner central com uma frase curta. O fade de entrada suaviza respostas rápidas sem atrasar
 * nada — nenhuma espera artificial.
 */
export function LoadingOverlay({ visible, message, testID }: Props) {
  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, [visible]);

  if (!visible) return null;
  return (
    <Animated.View
      entering={FadeIn.duration(180)}
      exiting={FadeOut.duration(150)}
      style={styles.root}
      testID={testID}
      accessibilityViewIsModal
      accessibilityLiveRegion="polite"
      accessibilityLabel={message ?? 'Carregando'}
    >
      <View style={styles.box}>
        <ActivityIndicator size="large" color={colors.primaryBright} />
        {message ? (
          <AppText variant="bodyBold" center style={styles.text}>
            {message}
          </AppText>
        ) : null}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 100,
    elevation: 100,
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  box: {
    minWidth: 180,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.card,
    backgroundColor: 'rgba(6, 30, 24, 0.94)',
    borderWidth: 1,
    borderColor: colors.cardBorderStrong,
    alignItems: 'center',
  },
  text: { marginTop: spacing.md },
});
