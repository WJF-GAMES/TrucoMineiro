import { create } from 'zustand';
import type { AuthUser, PhoneConfirmation } from '@/services/firebase/auth';

export type AuthStatus = 'booting' | 'signed_out' | 'onboarding' | 'signed_in';

interface AuthState {
  status: AuthStatus;
  user: AuthUser | null;
  /** Kept in memory only while the OTP screen is open. Never persisted. */
  pendingPhone: string | null;
  confirmation: PhoneConfirmation | null;
  setBooting: () => void;
  setSignedOut: () => void;
  setUser: (user: AuthUser, onboarded: boolean) => void;
  setOnboarded: () => void;
  setPending: (phone: string, confirmation: PhoneConfirmation) => void;
  clearPending: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  status: 'booting',
  user: null,
  pendingPhone: null,
  confirmation: null,
  setBooting: () => set({ status: 'booting' }),
  setSignedOut: () =>
    set({ status: 'signed_out', user: null, pendingPhone: null, confirmation: null }),
  setUser: (user, onboarded) => set({ user, status: onboarded ? 'signed_in' : 'onboarding' }),
  setOnboarded: () => set({ status: 'signed_in' }),
  setPending: (pendingPhone, confirmation) => set({ pendingPhone, confirmation }),
  clearPending: () => set({ pendingPhone: null, confirmation: null }),
}));
