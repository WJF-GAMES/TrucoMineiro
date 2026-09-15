import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

interface SettingsState {
  sound: boolean;
  music: boolean;
  vibration: boolean;
  notifications: boolean;
  language: 'pt-BR';
  hasSeenIntro: boolean;
  set: (patch: Partial<Omit<SettingsState, 'set'>>) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      sound: true,
      music: true,
      vibration: true,
      notifications: true,
      language: 'pt-BR',
      hasSeenIntro: false,
      set: (patch) => set(patch),
    }),
    { name: 'trucox.settings', storage: createJSONStorage(() => AsyncStorage) },
  ),
);
