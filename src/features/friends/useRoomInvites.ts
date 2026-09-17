import { useCallback, useEffect, useState } from 'react';
import { deleteRoomInvite, subscribeRoomInvites , ApiError, respondRoomInvite } from '@/services/api';

import { logEvent } from '@/services/firebase/analytics';
import { toast } from '@/stores/toastStore';
import type { RoomInvite } from '@/domain/model/types';
import { inviteErrorMessage } from './inviteErrors';

/**
 * Depois disso o convite não vale mais: a sala foi fechada ou a partida já começou sem o
 * convidado. Convites vencidos são apagados na hora em que aparecem, para a lista não guardar
 * lixo do dia anterior.
 */
export const INVITE_TTL_MS = 15 * 60_000;

/** Prazo do convite: o do servidor quando veio; senão, o padrão a partir do envio. */
export const inviteExpiry = (i: RoomInvite) => i.expiresAt ?? (i.createdAt ?? 0) + INVITE_TTL_MS;

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
 * Convites de sala recebidos de amigos (caixa de entrada do backend, preenchida por
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
      const t = Date.now();
      const expired = list.filter((i) => inviteExpiry(i) < t);
      // Limpeza silenciosa: convite vencido não vira linha na tela nem notificação.
      expired.forEach((i) => void deleteRoomInvite(uid, i.code).catch(() => undefined));
      setInvites(list.filter((i) => inviteExpiry(i) >= t));
    });
  }, [uid]);

  const accept = useCallback(
    async (invite: RoomInvite) => {
      if (!uid) return;
      setBusy(invite.code);
      try {
        // O servidor ocupa a vaga reservada (ou marca a troca com a IA) e apaga o convite.
        await respondRoomInvite(invite.code, true);
        logEvent('game_invite_accepted', { source: 'list' });
        logEvent('room_invite_accepted');
        logEvent('room_joined', { via: 'invite' });
        onJoined?.(invite.code);
      } catch (e) {
        // Sala cheia ou partida já começada: o convite não serve mais para nada.
        if (e instanceof ApiError && e.code !== 'unavailable')
          await deleteRoomInvite(uid, invite.code).catch(() => undefined);
        toast.error('Não foi possível entrar', inviteErrorMessage(e));
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
        // O dono vê a recusa na hora; sem rede, pelo menos some da lista local.
        await respondRoomInvite(invite.code, false).catch(() => deleteRoomInvite(uid, invite.code));
        logEvent('game_invite_declined');
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
