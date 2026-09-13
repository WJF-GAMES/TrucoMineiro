import { useCallback, useEffect, useState } from 'react';
import { deleteRoomInvite, subscribeRoomInvites } from '@/services/firebase/rtdb';
import { FunctionsError, joinRoom } from '@/services/firebase/functions';
import { logEvent } from '@/services/firebase/analytics';
import { toast } from '@/stores/toastStore';
import type { RoomInvite } from '@/domain/model/types';

/**
 * Depois disso o convite não vale mais: a sala foi fechada ou a partida já começou sem o
 * convidado. Convites vencidos são apagados na hora em que aparecem, para a lista não guardar
 * lixo do dia anterior.
 */
export const INVITE_TTL_MS = 15 * 60_000;

const JOIN_ERRORS: Record<string, string> = {
  'not-found': 'Essa sala não existe mais.',
  'resource-exhausted': 'A sala já está cheia.',
  'failed-precondition': 'A partida dessa sala já começou.',
  unavailable: 'Sem conexão. Verifique sua internet.',
};

const joinErrorMessage = (e: unknown) =>
  (e instanceof FunctionsError ? JOIN_ERRORS[e.code] : undefined) ??
  (e instanceof FunctionsError ? e.message : 'Não foi possível entrar na sala.');

export interface UseRoomInvites {
  /** Convites válidos, do mais recente para o mais antigo. */
  invites: RoomInvite[];
  /** Código do convite em processamento (entrar/recusar). */
  busy: string | null;
  /** Entra na sala e leva para o lobby. */
  accept: (invite: RoomInvite) => Promise<void>;
  /** Recusa: o convite some para os dois lados. */
  decline: (invite: RoomInvite) => Promise<void>;
}

/**
 * Convites de sala recebidos de amigos (`invites/{uid}` no RTDB, escrito por
 * `inviteFriendToRoom`). A lista é ao vivo: o amigo toca em "Jogar" e o convite aparece aqui.
 */
export function useRoomInvites(
  uid: string | undefined,
  onJoined?: (code: string) => void,
): UseRoomInvites {
  const [invites, setInvites] = useState<RoomInvite[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const [prevUid, setPrevUid] = useState(uid);
  if (uid !== prevUid) {
    setPrevUid(uid);
    setInvites([]);
    setBusy(null);
  }

  useEffect(() => {
    if (!uid) return;
    return subscribeRoomInvites(uid, (list) => {
      const cutoff = Date.now() - INVITE_TTL_MS;
      const expired = list.filter((i) => (i.createdAt ?? 0) < cutoff);
      // Limpeza silenciosa: convite vencido não vira linha na tela nem notificação.
      expired.forEach((i) => void deleteRoomInvite(uid, i.code).catch(() => undefined));
      setInvites(list.filter((i) => (i.createdAt ?? 0) >= cutoff));
    });
  }, [uid]);

  const accept = useCallback(
    async (invite: RoomInvite) => {
      if (!uid) return;
      setBusy(invite.code);
      try {
        await joinRoom(invite.code);
        await deleteRoomInvite(uid, invite.code).catch(() => undefined);
        logEvent('room_invite_accepted');
        logEvent('room_joined', { via: 'invite' });
        onJoined?.(invite.code);
      } catch (e) {
        // Sala cheia ou partida já começada: o convite não serve mais para nada.
        if (e instanceof FunctionsError && e.code !== 'unavailable')
          await deleteRoomInvite(uid, invite.code).catch(() => undefined);
        toast.error('Não foi possível entrar', joinErrorMessage(e));
      } finally {
        setBusy(null);
      }
    },
    [uid, onJoined],
  );

  const decline = useCallback(
    async (invite: RoomInvite) => {
      if (!uid) return;
      setBusy(invite.code);
      try {
        await deleteRoomInvite(uid, invite.code);
        logEvent('room_invite_declined');
      } catch {
        toast.error('Não deu certo', 'Tente de novo em instantes.');
      } finally {
        setBusy(null);
      }
    },
    [uid],
  );

  return { invites, busy, accept, decline };
}
