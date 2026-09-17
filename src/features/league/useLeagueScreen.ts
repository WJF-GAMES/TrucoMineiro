import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { getLeagueScreenSnapshot, ApiError , subscribeGroupMembers } from '@/services/api';

import { rankMembers } from '@/domain/model/leagueRanking';
import type { LeagueRankingMember, LeagueScreenSnapshot } from '@/domain/model/types';

/**
 * O snapshot chega do backend (`GET /v1/leagues/me`). Se a resposta vier incompleta (deploy antigo, payload
 * truncado, stub da build web), a tela lia `snapshot.currentLeague.id` e caía inteira — tela
 * branca, sem mensagem e sem saída. Aqui a resposta é conferida antes de virar estado: o que não
 * tiver liga atual vale como falha de carregamento e cai no estado de erro, com "tentar novamente".
 */
function isUsableSnapshot(s: unknown): s is LeagueScreenSnapshot {
  if (!s || typeof s !== 'object') return false;
  const league = (s as LeagueScreenSnapshot).currentLeague;
  return Boolean(league && typeof league.id === 'string');
}

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
        if (!isUsableSnapshot(s)) {
          setError('Não foi possível carregar sua liga.');
          setLoading(false);
          return;
        }
        setSnapshot(s);
        setLive(null);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (!mounted.current) return;
        setError(e instanceof ApiError ? e.message : 'Não foi possível carregar sua liga.');
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

  /**
   * A assinatura ao vivo só substitui a lista do snapshot quando realmente traz gente.
   * Um `onSnapshot` bem-sucedido porém vazio (grupo ainda não replicado, cache frio, regra de
   * segurança negando a subcoleção) apagava o ranking que o servidor já tinha entregue: a aba
   * ficava com o cabeçalho da tabela e nenhuma linha embaixo, sem erro e sem explicação.
   */
  const members = useMemo(
    () => (live && live.length > 0 ? live : (snapshot?.members ?? [])),
    [live, snapshot],
  );

  return { snapshot, members, loading, error, reload };
}
