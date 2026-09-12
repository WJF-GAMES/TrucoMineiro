import * as Haptics from 'expo-haptics';
import { useSettingsStore } from '@/stores/settingsStore';

function enabled() {
  return useSettingsStore.getState().vibration;
}

export const haptic = {
  light: () =>
    enabled() && Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined),
  medium: () =>
    enabled() && Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined),
  heavy: () =>
    enabled() && Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => undefined),
  success: () =>
    enabled() &&
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined),
  error: () =>
    enabled() &&
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined),
  selection: () => enabled() && Haptics.selectionAsync().catch(() => undefined),
};
