import { useEffect, useMemo, useState } from 'react';
import { subscribePresence } from '@/services/firebase/rtdb';
import type { PresenceState } from '@/domain/model/types';

/**
 * Presença (online / na partida / offline) de uma lista de jogadores — usada para os contatos da
 * agenda que já jogam, que não passam pelo `useFriends`. Assina só os uids pedidos e larga os que
 * saem da lista.
 */
export function usePresenceMap(uids: readonly string[]): Record<string, PresenceState> {
  const [states, setStates] = useState<Record<string, PresenceState>>({});
  // A lista chega nova a cada render; a chave estável evita reassinar à toa.
  const key = useMemo(() => [...new Set(uids)].sort().join('|'), [uids]);

  useEffect(() => {
    if (!key) return;
    const unsubs = key
      .split('|')
      .map((uid) =>
        subscribePresence(uid, (p) =>
          setStates((prev) =>
            prev[uid] === (p?.state ?? 'offline')
              ? prev
              : { ...prev, [uid]: p?.state ?? 'offline' },
          ),
        ),
      );
    return () => unsubs.forEach((u) => u());
  }, [key]);

  return states;
}
