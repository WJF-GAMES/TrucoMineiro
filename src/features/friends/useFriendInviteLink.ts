import { useEffect } from 'react';
import { Alert, Linking } from 'react-native';
import { useAuthStore } from '@/stores/authStore';
import {
  FunctionsError,
  resolveFriendInviteToken,
  sendFriendRequest,
} from '@/services/firebase/functions';
import { logEvent } from '@/services/firebase/analytics';
import { toast } from '@/stores/toastStore';

/** `trucomineiro://add-friend?token=...` — o mesmo link do QR Code. */
const PATTERN = /^trucomineiro:\/\/add-friend\?.*\btoken=([A-Za-z0-9_-]{16,64})/;

export function parseInviteToken(url: string | null | undefined): string | null {
  if (!url) return null;
  return PATTERN.exec(url.trim())?.[1] ?? null;
}

/**
 * Trata o link de convite (QR Code ou link compartilhado) em qualquer lugar do app.
 *
 * Nunca envia a solicitação sozinho: o link é conteúdo externo, então o usuário confirma
 * antes de qualquer coisa acontecer em nome dele.
 */
export function useFriendInviteLink() {
  const status = useAuthStore((s) => s.status);

  useEffect(() => {
    // Só depois de logado: antes disso não existe "eu" para adicionar ninguém.
    if (status !== 'signed_in') return;
    let active = true;

    const handle = async (url: string | null) => {
      const token = parseInviteToken(url);
      if (!token || !active) return;
      try {
        const { uid } = await resolveFriendInviteToken(token);
        if (!active) return;
        Alert.alert(
          'Convite de amizade',
          'Alguém compartilhou um convite com você. Quer enviar a solicitação de amizade?',
          [
            { text: 'Agora não', style: 'cancel' },
            {
              text: 'Enviar',
              onPress: () =>
                sendFriendRequest(uid)
                  .then(() => {
                    logEvent('friend_request_sent', { source: 'invite_link' });
                    toast.success('Solicitação enviada');
                  })
                  .catch((e) =>
                    toast.error(
                      'Não deu certo',
                      e instanceof FunctionsError ? e.message : undefined,
                    ),
                  ),
            },
          ],
        );
      } catch (e) {
        toast.error(
          'Convite inválido',
          e instanceof FunctionsError ? e.message : 'Esse convite expirou.',
        );
      }
    };

    // App aberto pelo link (frio) e link recebido com o app já aberto.
    Linking.getInitialURL()
      .then(handle)
      .catch(() => undefined);
    const sub = Linking.addEventListener('url', (e) => void handle(e.url));
    return () => {
      active = false;
      sub.remove();
    };
  }, [status]);
}
