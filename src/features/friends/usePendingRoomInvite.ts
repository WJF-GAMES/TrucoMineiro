import { useEffect } from 'react';
import { Linking } from 'react-native';
import { useAuthStore } from '@/stores/authStore';
import { subscribePushOpens } from '@/services/firebase/messaging';
import {
  enterInvitedRoom,
  inviteFromPush,
  inviteFromUrl,
  usePendingInviteStore,
} from './roomInviteFlow';

/**
 * Convite que abre o app (push ou link).
 *
 * 1. O toque é guardado na hora, mesmo sem sessão — o app pode estar fechado, deslogado ou no
 *    meio do cadastro.
 * 2. Assim que o usuário está logado e com o cadastro completo (a pilha principal montada),
 *    o convite é retomado e ele cai direto na sala.
 *
 * `routeName` entra só para reagir quando a navegação troca de pilha (Login → Main).
 */
export function usePendingRoomInvite(routeName: string | null): void {
  const status = useAuthStore((s) => s.status);
  const pending = usePendingInviteStore((s) => s.pending);

  useEffect(() => {
    const offer = usePendingInviteStore.getState().offer;
    const unsubPush = subscribePushOpens((data) => {
      const invite = inviteFromPush(data);
      if (invite) offer(invite.code, invite.inviteId);
    });
    const onUrl = (url: string | null) => {
      const code = inviteFromUrl(url);
      if (code) offer(code);
    };
    Linking.getInitialURL()
      .then(onUrl)
      .catch(() => undefined);
    const sub = Linking.addEventListener('url', (e) => onUrl(e.url));
    return () => {
      unsubPush();
      sub.remove();
    };
  }, []);

  useEffect(() => {
    // Sessão válida e cadastro concluído; antes disso o convite espera guardado.
    if (status !== 'signed_in' || !pending) return;
    if (!routeName || routeName === 'Splash') return;
    const invite = usePendingInviteStore.getState().take();
    if (invite) void enterInvitedRoom(invite.code, 'push');
  }, [status, pending, routeName]);
}
