import { create } from 'zustand';
import type { PlayerStats, Profile } from '@/domain/model/types';

interface ProfileState {
  profile: Profile | null;
  stats: PlayerStats | null;
  loading: boolean;
  error: string | null;
  setProfile: (p: Profile | null) => void;
  setStats: (s: PlayerStats | null) => void;
  setLoading: (v: boolean) => void;
  setError: (e: string | null) => void;
  reset: () => void;
}

export const useProfileStore = create<ProfileState>((set) => ({
  profile: null,
  stats: null,
  loading: true,
  error: null,
  setProfile: (profile) => set({ profile, loading: false }),
  setStats: (stats) => set({ stats }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error, loading: false }),
  reset: () => set({ profile: null, stats: null, loading: true, error: null }),
}));
