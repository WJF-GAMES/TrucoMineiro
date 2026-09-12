import type { League, LeagueId } from './types';

/** Static league ladder (also seeded into Firestore `leagues/` by the seed script). */
export const LEAGUES: League[] = [
  {
    id: 'bronze',
    name: 'Bronze',
    order: 0,
    minPoints: 0,
    maxPoints: 500,
    nextLeagueId: 'prata',
    rewardCoins: 200,
  },
  {
    id: 'prata',
    name: 'Prata',
    order: 1,
    minPoints: 500,
    maxPoints: 1200,
    nextLeagueId: 'ouro',
    rewardCoins: 500,
  },
  {
    id: 'ouro',
    name: 'Ouro',
    order: 2,
    minPoints: 1200,
    maxPoints: 2500,
    nextLeagueId: 'diamante',
    rewardCoins: 1000,
  },
  {
    id: 'diamante',
    name: 'Diamante',
    order: 3,
    minPoints: 2500,
    maxPoints: null,
    nextLeagueId: null,
    rewardCoins: 2500,
  },
];

export const LEAGUE_NAMES: Record<LeagueId, string> = {
  bronze: 'Bronze',
  prata: 'Prata',
  ouro: 'Ouro',
  diamante: 'Diamante',
};

export function leagueForPoints(points: number): League {
  let current = LEAGUES[0]!;
  for (const l of LEAGUES) if (points >= l.minPoints) current = l;
  return current;
}

export function leagueById(id: LeagueId): League {
  return LEAGUES.find((l) => l.id === id) ?? LEAGUES[0]!;
}
