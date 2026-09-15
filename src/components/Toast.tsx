import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, icons, radius, spacing } from '@/design-system';
import { useToastStore } from '@/stores/toastStore';
import { AppText } from './AppText';
import { useNetworkStore } from '@/stores/networkStore';

/** Global toast + "Reconectando..." banner. Mounted once at the root. */
export function ToastHost() {
  const current = useToastStore((s) => s.current);
  const hide = useToastStore((s) => s.hide);
  const connected = useNetworkStore((s) => s.connected);
  const wasConnected = useNetworkStore((s) => s.wasConnected);
  const insets = useSafeAreaInsets();

  // Only announce a drop after it persists: brief blips must not cover the UI.
  const [dropConfirmed, setDropConfirmed] = useState(false);
  const dropping = !connected && wasConnected;
  useEffect(() => {
    if (!dropping) return;
    const t = setTimeout(() => setDropConfirmed(true), 4000);
    return () => {
      clearTimeout(t);
      setDropConfirmed(false);
    };
  }, [dropping]);

  const offline = dropping && dropConfirmed;
  return (
    <>
      {offline ? (
        <Animated.View
          entering={FadeInUp}
          exiting={FadeOutUp}
          style={[styles.banner, { top: insets.top + 4 }]}
          testID="reconnecting-banner"
        >
          <Ionicons name={icons.wifiOff} size={18} color={colors.gold} />
          <AppText variant="smallBold" style={{ marginLeft: 8 }}>
            Reconectando...
          </AppText>
        </Animated.View>
      ) : null}
      {current ? (
        <Animated.View
          key={current.id}
          entering={FadeInUp}
          exiting={FadeOutUp}
          style={[styles.toast, { top: insets.top + (offline ? 48 : 8) }]}
        >
          <Pressable
            onPress={hide}
            style={styles.toastInner}
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            accessibilityLabel={`${current.title}${current.message ? `. ${current.message}` : ''}. Toque para fechar.`}
          >
            <Ionicons
              name={
                current.kind === 'success'
                  ? 'checkmark-circle'
                  : current.kind === 'error'
                    ? 'alert-circle'
                    : 'information-circle'
              }
              size={22}
              color={
                current.kind === 'success'
                  ? colors.primaryBright
                  : current.kind === 'error'
                    ? colors.dangerSoft
                    : colors.gold
              }
            />
            <Animated.View style={{ flex: 1, marginLeft: 10 }}>
              <AppText variant="bodyBold">{current.title}</AppText>
              {current.message ? (
                <AppText variant="small" color={colors.textSecondary}>
                  {current.message}
                </AppText>
              ) : null}
            </Animated.View>
          </Pressable>
        </Animated.View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(10, 40, 36, 0.96)',
    borderWidth: 1,
    borderColor: colors.gold,
    zIndex: 100,
  },
  toast: { position: 'absolute', left: spacing.screen, right: spacing.screen, zIndex: 101 },
  toastInner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: radius.card,
    backgroundColor: 'rgba(10, 40, 36, 0.97)',
    borderWidth: 1,
    borderColor: colors.cardBorderStrong,
  },
});
