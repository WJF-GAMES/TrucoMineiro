import { useEffect, useMemo, useState } from 'react';
import {
  subscribeBlockedUsers,
  subscribeFriendRows,
  subscribeIncomingRequests,
  subscribeOutgoingRequests,
  subscribePresence,
} from '@/services/api';
import type { FriendRequest, Presence, PresenceState, Profile } from '@/domain/model/types';

export interface FriendEntry {
  profile: Profile;
  presence: Presence | null;
}

const PRESENCE_RANK: Record<PresenceState, number> = { online: 0, in_match: 1, offline: 2 };

/** Amigos do usuário com o perfil e a presença (online / na partida / offline). */
export function useFriends(uid: string | undefined) {
  const [friendIds, setFriendIds] = useState<string[] | null>(null);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  // Separada do perfil: a presença ao vivo chega por outro canal e não pode ser descartada quando
  // a lista é relida.
  const [presences, setPresences] = useState<Record<string, Presence | null>>({});
  const [blockedIds, setBlockedIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Troca de conta no mesmo aparelho: zera durante a renderização, não dentro do efeito
  // (setState no corpo do efeito encadeia renderizações à toa).
  const [prevUid, setPrevUid] = useState(uid);
  if (uid !== prevUid) {
    setPrevUid(uid);
    setFriendIds(null);
    setProfiles({});
    setPresences({});
    setBlockedIds([]);
    setError(null);
  }

  useEffect(() => {
    if (!uid) return;
    // Uma chamada traz amigos com perfil e presença; a lista é relida quando o servidor avisa.
    const unsubFriends = subscribeFriendRows(
      uid,
      (rows) => {
        setProfiles(Object.fromEntries(rows.map((r) => [r.uid, r.profile])));
        setPresences((prev) => {
          const next = { ...prev };
          for (const r of rows) if (!(r.uid in next)) next[r.uid] = r.presence;
          return next;
        });
        setFriendIds(rows.map((r) => r.uid));
      },
      (e) => setError(e.message),
    );
    const unsubBlocked = subscribeBlockedUsers(uid, setBlockedIds);
    return () => {
      unsubFriends();
      unsubBlocked();
    };
  }, [uid]);

  useEffect(() => {
    if (!friendIds) return;
    // Presença ao vivo (online / na partida / offline) de cada amigo.
    const unsubs = friendIds.map((id) =>
      subscribePresence(id, (presence) => setPresences((prev) => ({ ...prev, [id]: presence }))),
    );
    return () => unsubs.forEach((u) => u());
  }, [friendIds]);

  const friends = useMemo(
    () =>
      (friendIds ?? [])
        .flatMap((id): FriendEntry[] =>
          profiles[id] ? [{ profile: profiles[id], presence: presences[id] ?? null }] : [],
        )
        .sort(
          (a, b) =>
            PRESENCE_RANK[a.presence?.state ?? 'offline'] -
              PRESENCE_RANK[b.presence?.state ?? 'offline'] ||
            a.profile.nickname.localeCompare(b.profile.nickname, 'pt-BR'),
        ),
    [friendIds, profiles, presences],
  );

  return {
    friends,
    friendIds,
    friendIdSet: useMemo(() => new Set(friendIds ?? []), [friendIds]),
    blockedIds,
    loading: friendIds === null,
    error,
  };
}

/** Solicitações recebidas e enviadas, já separadas para as duas listas da aba. */
export function useFriendRequests(uid: string | undefined) {
  const [incoming, setIncoming] = useState<FriendRequest[]>([]);
  const [outgoing, setOutgoing] = useState<FriendRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const [prevUid, setPrevUid] = useState(uid);
  if (uid !== prevUid) {
    setPrevUid(uid);
    setIncoming([]);
    setOutgoing([]);
    setLoading(true);
  }

  useEffect(() => {
    if (!uid) return;
    let pending = 2;
    const done = () => {
      pending--;
      if (pending <= 0) setLoading(false);
    };
    const unsubIn = subscribeIncomingRequests(uid, (r) => {
      setIncoming(sortByDate(r));
      done();
    });
    const unsubOut = subscribeOutgoingRequests(uid, (r) => {
      setOutgoing(sortByDate(r));
      done();
    });
    return () => {
      unsubIn();
      unsubOut();
    };
  }, [uid]);

  const pendingToUids = useMemo(() => new Set(outgoing.map((r) => r.to)), [outgoing]);

  return { incoming, outgoing, pendingToUids, loading };
}

const sortByDate = (r: FriendRequest[]) => [...r].sort((a, b) => b.createdAt - a.createdAt);
