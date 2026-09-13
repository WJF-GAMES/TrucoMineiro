import type { LeagueId, WeeklyLeagueMember, WeeklyResult } from './types';
import { zonesForGroupSize } from './leagueGroups';
import { promotedLeagueId, relegatedLeagueId, leagueById } from './leagues';

/**
 * Ordenação oficial do ranking semanal. Puro e compartilhado: o servidor grava `currentRank` com
 * ele e o app reordena a lista ao vivo com exatamente o mesmo critério, então nunca divergem.
 *
 * 1. pontos da semana (desc)
 * 2. desempate acumulado (desc) — soma de saldo de pontos das partidas
 * 3. vitórias (desc)
 * 4. quem chegou primeiro no grupo (asc)
 * 5. uid (asc) — desempate estável e determinístico
 */
export function compareMembers(a: RankableMember, b: RankableMember): number {
  if (a.weeklyPoints !== b.weeklyPoints) return b.weeklyPoints - a.weeklyPoints;
  const ta = a.tiebreakScore ?? 0;
  const tb = b.tiebreakScore ?? 0;
  if (ta !== tb) return tb - ta;
  const wa = a.wins ?? 0;
  const wb = b.wins ?? 0;
  if (wa !== wb) return wb - wa;
  const ja = a.joinedAt ?? 0;
  const jb = b.joinedAt ?? 0;
  if (ja !== jb) return ja - jb;
  return a.uid.localeCompare(b.uid);
}

export interface RankableMember {
  uid: string;
  weeklyPoints: number;
  tiebreakScore?: number;
  wins?: number;
  joinedAt?: number;
}

/** Ordena e atribui `currentRank` 1..n (cópia — não muta a entrada). */
export function rankMembers<T extends RankableMember>(members: T[]): (T & { rank: number })[] {
  return [...members]
    .sort(compareMembers)
    .map((member, index) => ({ ...member, rank: index + 1 }));
}

/**
 * Um jogador só sobe de liga se tiver pontuado na semana.
 *
 * Sem essa trava, um grupo pequeno e inativo promoveria gente com 0 ponto só por existir
 * (num grupo de 2 pessoas paradas, alguém subiria toda semana). Quem não pontuou permanece;
 * a zona continua sendo posicional, esta regra só rebaixa o resultado para "stayed".
 */
export const MIN_WEEKLY_POINTS_FOR_PROMOTION = 1;

export interface WeeklyOutcome {
  uid: string;
  finalRank: number;
  weeklyPoints: number;
  result: WeeklyResult;
  previousLeagueId: LeagueId;
  nextLeagueId: LeagueId;
}

/**
 * Resultado de fim de semana de um grupo: quem sobe, quem fica e quem desce.
 * Bronze é piso (não desce) e Lenda de Minas é teto (não sobe) — nesses casos o resultado é
 * `bottom_league` / `top_league` para a UI poder explicar por que a liga não mudou.
 */
export function resolveWeeklyOutcomes(
  leagueId: LeagueId,
  members: RankableMember[],
): WeeklyOutcome[] {
  const ranked = rankMembers(members);
  const zones = zonesForGroupSize(ranked.length);
  const def = leagueById(leagueId);

  return ranked.map((member) => {
    const inPromotion = zones.promotionCount > 0 && member.rank <= zones.promotionEnd;
    const inRelegation = zones.relegationCount > 0 && member.rank >= zones.relegationStart;
    const earned = member.weeklyPoints >= MIN_WEEKLY_POINTS_FOR_PROMOTION;

    let result: WeeklyResult = 'stayed';
    let nextLeague = leagueId;
    if (inPromotion && earned) {
      result = def.isLast ? 'top_league' : 'promoted';
      nextLeague = promotedLeagueId(leagueId);
    } else if (inRelegation) {
      result = def.isFirst ? 'bottom_league' : 'relegated';
      nextLeague = relegatedLeagueId(leagueId);
    }

    return {
      uid: member.uid,
      finalRank: member.rank,
      weeklyPoints: member.weeklyPoints,
      result,
      previousLeagueId: leagueId,
      nextLeagueId: nextLeague,
    };
  });
}

/** Texto da regra semanal ("Os 5 primeiros sobem..."), sempre derivado dos números do backend. */
export function weeklyRuleText(zones: {
  promotionCount: number;
  relegationCount: number;
}): string {
  const { promotionCount: up, relegationCount: down } = zones;
  if (up === 0 && down === 0) {
    return 'Seu grupo ainda é pequeno demais para promoção e rebaixamento nesta semana.';
  }
  const upText = up === 1 ? 'O 1º colocado sobe de liga' : `Os ${up} primeiros sobem de liga`;
  const downText = down === 1 ? 'o último desce' : `os ${down} últimos descem`;
  return `${upText} e ${downText} no final de cada semana. Jogue e mantenha-se no topo!`;
}

export type { WeeklyLeagueMember };
