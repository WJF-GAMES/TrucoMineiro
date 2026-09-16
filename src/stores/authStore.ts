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
  /** Perfil existe mas está incompleto (sem apelido): o cadastro precisa ser concluído. */
  setNeedsOnboarding: () => void;
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
  // O telefone pendente só existia para a tela do código; com o usuário decidido ele sai daqui.
  setUser: (user, onboarded) =>
    set({
      user,
      status: onboarded ? 'signed_in' : 'onboarding',
      pendingPhone: null,
      confirmation: null,
    }),
  setOnboarded: () => set({ status: 'signed_in' }),
  setNeedsOnboarding: () => set({ status: 'onboarding' }),
  setPending: (pendingPhone, confirmation) => set({ pendingPhone, confirmation }),
  clearPending: () => set({ pendingPhone: null, confirmation: null }),
}));
