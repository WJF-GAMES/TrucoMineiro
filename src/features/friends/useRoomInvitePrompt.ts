import { useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import { useAuthStore } from '@/stores/authStore';
import { logEvent } from '@/services/firebase/analytics';
import { navigationRef, currentRouteName } from '@/navigation/navigationRef';
import { useRoomInvites } from './useRoomInvites';
import { usePendingInviteStore } from './roomInviteFlow';

/** Telas em que um diálogo de convite atrapalharia mais do que ajudaria. */
const BUSY_ROUTES = new Set(['Game', 'Matchmaking', 'Lobby', 'MatchResult']);

/**
 * Aviso de convite em qualquer lugar do app.
 *
 * A lista da tela Amigos resolve quando o usuário está nela; este diálogo cobre o resto do app,
 * onde o convite chegaria sem ninguém ver. Cada código é oferecido uma vez só por sessão, e
 * nunca durante uma partida — aí o convite fica guardado e o usuário decide depois.
 */
export function useRoomInvitePrompt(routeName: string | null): void {
  const uid = useAuthStore((s) => s.user?.uid);
  const prompted = useRef<Set<string>>(new Set());
  const { invites, accept, decline } = useRoomInvites(uid, (code) => {
    if (navigationRef.isReady()) navigationRef.navigate('Lobby', { code });
  });

  // Trocou de conta: o que já foi oferecido não vale para o próximo usuário.
  useEffect(() => {
    prompted.current = new Set();
  }, [uid]);

  // `routeName` entra nas dependências de propósito: um convite que chegou durante a partida
  // fica guardado e é oferecido quando o usuário sai dela.
  useEffect(() => {
    const route = routeName ?? currentRouteName();
    if (route && BUSY_ROUTES.has(route)) return;
    // Convite que o usuário abriu pelo push já está sendo tratado: nada de perguntar de novo.
    const handled = new Set(usePendingInviteStore.getState().handled);
    const invite = invites.find((i) => !prompted.current.has(i.code) && !handled.has(i.code));
    if (!invite) return;
    prompted.current.add(invite.code);
    logEvent('room_invite_received');
    Alert.alert(
      'Convite para jogar',
      `${invite.fromNickname} convidou você para jogar Truco Mineiro.`,
      [
        { text: 'Agora não', style: 'cancel', onPress: () => void decline(invite) },
        { text: 'Entrar na sala', onPress: () => void accept(invite) },
      ],
    );
  }, [invites, accept, decline, routeName]);
}
