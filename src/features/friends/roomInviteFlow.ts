import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { respondRoomInvite } from '@/services/firebase/functions';
import { INVITE_UNAVAILABLE, inviteErrorMessage } from './inviteErrors';
import { logEvent } from '@/services/firebase/analytics';
import { navigationRef } from '@/navigation/navigationRef';

/**
 * Entrar numa sala a partir de um convite — o mesmo caminho para a linha da lista, o aviso dentro
 * do app, o toque no push e o link `trucomineiro://room?code=`.
 *
 * O convite que chega antes de o usuário poder entrar (app fechado, sessão expirada, cadastro
 * incompleto) fica guardado aqui e é retomado assim que ele estiver logado.
 */

/** Um convite vale por no máximo isto no aparelho; o servidor confere o prazo de verdade. */
export const PENDING_INVITE_TTL_MS = 30 * 60_000;

const CODE = /^[A-Z0-9]{6}$/;

export { INVITE_UNAVAILABLE, inviteErrorMessage } from './inviteErrors';

export interface PendingInvite {
  code: string;
  inviteId?: string | null;
  at: number;
}

interface PendingInviteState {
  pending: PendingInvite | null;
  /** Códigos já tratados por push/link nesta execução: o aviso interno não repete o convite. */
  handled: string[];
  offer: (code: string, inviteId?: string | null) => void;
  take: () => PendingInvite | null;
}

export const usePendingInviteStore = create<PendingInviteState>()(
  persist(
    (set, get) => ({
      pending: null,
      handled: [],
      offer: (code, inviteId) => {
        const upper = code.toUpperCase();
        if (!CODE.test(upper)) return;
        set((s) => ({
          pending: { code: upper, inviteId: inviteId ?? null, at: Date.now() },
          handled: s.handled.includes(upper) ? s.handled : [...s.handled, upper].slice(-20),
        }));
      },
      take: () => {
        const p = get().pending;
        set({ pending: null });
        if (!p || Date.now() - p.at > PENDING_INVITE_TTL_MS) return null;
        return p;
      },
    }),
    {
      name: 'trucox.pendingInvite',
      storage: createJSONStorage(() => AsyncStorage),
      // Só o convite pendente atravessa o reinício do app (login no meio do caminho).
      partialize: (s) => ({ pending: s.pending }),
    },
  ),
);

/** Dados do push de convite → código da sala, ou `null` se não for convite. */
export function inviteFromPush(data: Record<string, string> | undefined | null) {
  if (!data || data.type !== 'room_invite' || !data.code) return null;
  return { code: data.code, inviteId: data.inviteId ?? null };
}

/** `trucomineiro://room?code=ABC123` ou `trucomineiro://room/ABC123`. */
export function inviteFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = /^trucomineiro:\/\/room(?:\/([A-Za-z0-9]{6})|\?(?:.*&)?code=([A-Za-z0-9]{6}))/.exec(
    url.trim(),
  );
  const code = m?.[1] ?? m?.[2];
  return code ? code.toUpperCase() : null;
}

function goHome() {
  if (navigationRef.isReady()) navigationRef.navigate('Main', { screen: 'Home' });
}

export type InviteSource = 'push' | 'link' | 'banner' | 'list';

/**
 * Aceita e leva para a sala. Idempotente no servidor: abrir o mesmo push duas vezes só reabre a
 * sala. Em erro, explica e oferece voltar ao início. Devolve se entrou.
 */
export async function enterInvitedRoom(code: string, source: InviteSource): Promise<boolean> {
  if (source === 'push' || source === 'link') logEvent('game_invite_opened', { source });
  try {
    const res = await respondRoomInvite(code, true);
    logEvent('game_invite_accepted', { source, late: Boolean(res.pending) });
    logEvent('room_invite_accepted');
    logEvent('room_joined', { via: 'invite' });
    // Partida em andamento com a vaga guardada: o lobby mostra a espera até a troca com a IA.
    if (navigationRef.isReady()) navigationRef.navigate('Lobby', { code });
    return true;
  } catch (e) {
    const message = inviteErrorMessage(e);
    if (message === INVITE_UNAVAILABLE) logEvent('game_invite_expired', { source });
    Alert.alert('Convite para jogar', message, [{ text: 'Voltar ao início', onPress: goHome }]);
    return false;
  }
}

/** Recusa: o dono vê "Recusou" na hora e a vaga fica livre. */
export async function declineInvitedRoom(code: string): Promise<void> {
  await respondRoomInvite(code, false);
  logEvent('game_invite_declined');
  logEvent('room_invite_declined');
}
