import { create } from 'zustand';

export type ToastKind = 'info' | 'success' | 'error';

interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  message?: string;
}

interface ToastState {
  current: Toast | null;
  show: (kind: ToastKind, title: string, message?: string) => void;
  hide: () => void;
}

let seq = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

export const useToastStore = create<ToastState>((set) => ({
  current: null,
  show: (kind, title, message) => {
    if (timer) clearTimeout(timer);
    set({ current: { id: ++seq, kind, title, message } });
    timer = setTimeout(() => set({ current: null }), 3200);
  },
  hide: () => set({ current: null }),
}));

export const toast = {
  info: (t: string, m?: string) => useToastStore.getState().show('info', t, m),
  success: (t: string, m?: string) => useToastStore.getState().show('success', t, m),
  error: (t: string, m?: string) => useToastStore.getState().show('error', t, m),
};
