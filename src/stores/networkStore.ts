import { create } from 'zustand';

interface NetworkState {
  connected: boolean;
  /** True after the first connection was established (so we can distinguish "reconnecting"). */
  wasConnected: boolean;
  setConnected: (v: boolean) => void;
}

export const useNetworkStore = create<NetworkState>((set) => ({
  connected: true,
  wasConnected: false,
  setConnected: (connected) =>
    set((s) => ({ connected, wasConnected: s.wasConnected || connected })),
}));
