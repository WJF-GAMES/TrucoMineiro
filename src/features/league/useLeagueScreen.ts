import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { getLeagueScreenSnapshot, FunctionsError } from '@/services/firebase/functions';
import { subscribeGroupMembers } from '@/services/firebase/firestore';
import { rankMembers } from '@/domain/model/leagueRanking';
import type { LeagueRankingMember, LeagueScreenSnapshot } from '@/domain/model/types';

export interface LeagueScreenState {
  snapshot: LeagueScreenSnapshot | null;
  members: LeagueRankingMember[];
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/**
 * Carrega a aba "Minha Liga".
 *
 * O snapshot é a fonte de verdade (o backend corrige vínculo faltando antes de responder), e a
 * assinatura do grupo mantém a lista viva enquanto a tela está aberta. A reordenação local usa o
 * mesmo comparador puro do servidor — o app nunca inventa posição, só reexibe o que já foi gravado.
 */
export function useLeagueScreen(): LeagueScreenState {
  const uid = useAuthStore((s) => s.user?.uid);
  const [snapshot, setSnapshot] = useState<LeagueScreenSnapshot | null>(null);
  const [live, setLive] = useState<LeagueRankingMember[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // `attempt` dispara a busca; o estado de carregamento é ajustado no handler (evento), nunca
  // dentro do efeito — assim não há setState síncrono causando renders em cascata.
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    getLeagueScreenSnapshot()
      .then((s) => {
        if (!mounted.current) return;
        setSnapshot(s);
        setLive(null);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (!mounted.current) return;
        setError(e instanceof FunctionsError ? e.message : 'Não foi possível carregar sua liga.');
        setLoading(false);
      });
  }, [attempt]);

  const groupId = snapshot?.groupId;
  useEffect(() => {
    if (!groupId || !uid) return;
    return subscribeGroupMembers(
      groupId,
      (docs) => {
        setLive(
          rankMembers(docs).map((m) => ({
            uid: m.uid,
            nickname: m.nickname,
            avatarId: m.avatarId,
            countryCode: m.countryCode,
            weeklyPoints: m.weeklyPoints,
            wins: m.wins,
            tiebreakScore: m.tiebreakScore,
            joinedAt: m.joinedAt,
            rank: m.rank,
            isMe: m.uid === uid,
          })),
        );
      },
      // Uma falha na assinatura ao vivo não derruba a tela: o snapshot já está na mão.
      () => undefined,
    );
  }, [groupId, uid]);

  const members = useMemo(() => live ?? snapshot?.members ?? [], [live, snapshot]);

  return { snapshot, members, loading, error, reload };
}
