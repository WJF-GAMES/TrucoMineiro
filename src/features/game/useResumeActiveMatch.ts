import { useEffect, useRef } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { lastBootstrapResult } from '@/services/api';
import { navigationRef } from '@/navigation/navigationRef';
import { logEvent } from '@/services/firebase/analytics';

/**
 * App morto no meio de uma partida online: ao reabrir, o bootstrap informa a partida em
 * andamento e o jogador volta direto para a mesa (a IA temporária devolve o assento na hora).
 * Roda uma vez por sessão, só com a pilha principal montada.
 */
export function useResumeActiveMatch(routeName: string | null): void {
  const status = useAuthStore((s) => s.status);
  const uid = useAuthStore((s) => s.user?.uid);
  const resumedFor = useRef<string | null>(null);

  useEffect(() => {
    if (status !== 'signed_in' || !uid || !routeName || routeName === 'Splash') return;
    if (resumedFor.current === uid) return;
    const active = lastBootstrapResult()?.activeMatch;
    resumedFor.current = uid;
    if (!active || routeName === 'Game' || !navigationRef.isReady()) return;
    logEvent('match_started', { mode: 'online', source: 'resume' });
    navigationRef.navigate('Game', { mode: 'online', sessionId: active.matchId });
  }, [status, uid, routeName]);
}
