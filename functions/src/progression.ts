import { db, now } from './lib/admin';
import {
  Achievement,
  AIDifficultyId,
  LeagueId,
  MatchHistoryEntry,
  PlayerStats,
  Profile,
  ProgressionResult,
  xpForLevel,
} from './domain/model/types';
import { leagueForPoints } from './domain/model/leagues';
import { defaultProfile, defaultStats } from './users';

export const ACHIEVEMENTS: Achievement[] = [
  {
    id: 'first_win',
    order: 0,
    title: 'Primeira vitória',
    description: 'Vença sua primeira partida.',
    icon: 'trophy',
    target: 1,
    stat: 'wins',
  },
  {
    id: 'ten_wins',
    order: 1,
    title: 'Trucador',
    description: 'Vença 10 partidas.',
    icon: 'ribbon',
    target: 10,
    stat: 'wins',
  },
  {
    id: 'fifty_matches',
    order: 2,
    title: 'Frequentador da venda',
    description: 'Jogue 50 partidas.',
    icon: 'cafe',
    target: 50,
    stat: 'matches',
  },
  {
    id: 'truco_master',
    order: 3,
    title: 'Mestre do Truco',
    description: 'Peça truco 50 vezes.',
    icon: 'flame',
    target: 50,
    stat: 'trucosCalled',
  },
  {
    id: 'streak_5',
    order: 4,
    title: 'Embalado',
    description: 'Vença 5 partidas seguidas.',
    icon: 'flash',
    target: 5,
    stat: 'bestStreak',
  },
  {
    id: 'hard_win',
    order: 5,
    title: 'Sem medo',
    description: 'Vença a IA no modo Difícil.',
    icon: 'skull',
    target: 1,
    stat: 'hardWins',
  },
  {
    id: 'online_10',
    order: 6,
    title: 'Gente de verdade',
    description: 'Jogue 10 partidas online.',
    icon: 'people',
    target: 10,
    stat: 'onlineMatches',
  },
];

interface RewardTable {
  xpWin: number;
  xpLoss: number;
  coinsWin: number;
  coinsLoss: number;
  lpWin: number;
  lpLoss: number;
}

const REWARDS: Record<'online' | AIDifficultyId, RewardTable> = {
  online: { xpWin: 80, xpLoss: 30, coinsWin: 50, coinsLoss: 10, lpWin: 25, lpLoss: -10 },
  easy: { xpWin: 30, xpLoss: 10, coinsWin: 15, coinsLoss: 5, lpWin: 5, lpLoss: 0 },
  normal: { xpWin: 60, xpLoss: 20, coinsWin: 30, coinsLoss: 8, lpWin: 10, lpLoss: 0 },
  hard: { xpWin: 90, xpLoss: 30, coinsWin: 45, coinsLoss: 10, lpWin: 15, lpLoss: -5 },
};

export interface MatchOutcomeInput {
  matchId: string;
  mode: 'ai' | 'online';
  difficulty?: AIDifficultyId;
  players: MatchHistoryEntry['players'];
  scores: [number, number];
  winnerTeam: 0 | 1;
  handsPlayed: number;
  /** trucos called per uid during the match (for stats) */
  trucosByUid?: Record<string, { called: number; accepted: number }>;
  xpMultiplier?: number;
}

/**
 * Applies XP / coins / league points / stats / achievements for every human player of a match.
 * Idempotent: the matchHistory document is created inside the same transaction and acts as the lock.
 */
export async function processProgression(
  input: MatchOutcomeInput,
): Promise<{ alreadyProcessed: boolean; byUid: Record<string, ProgressionResult> }> {
  const historyRef = db.doc(`matchHistory/${input.matchId}`);
  const humans = input.players.filter((p) => !p.bot);
  const table = REWARDS[input.mode === 'online' ? 'online' : (input.difficulty ?? 'normal')];
  const mult = input.xpMultiplier ?? 1;

  return db.runTransaction(async (tx) => {
    const history = await tx.get(historyRef);
    if (history.exists) return { alreadyProcessed: true, byUid: {} };

    const profileRefs = humans.map((h) => db.doc(`profiles/${h.uid}`));
    const statsRefs = humans.map((h) => db.doc(`playerStats/${h.uid}`));
    const achRefs = humans.map((h) => db.doc(`userAchievements/${h.uid}`));
    const snaps = await Promise.all(
      [...profileRefs, ...statsRefs, ...achRefs].map((r) => tx.get(r)),
    );

    const byUid: Record<string, ProgressionResult> = {};
    humans.forEach((h, i) => {
      const won = h.seat % 2 === input.winnerTeam;
      const { id: _p, ...pDefault } = defaultProfile(h.uid);
      const { id: _s, ...sDefault } = defaultStats(h.uid);
      const profile = {
        ...pDefault,
        ...(snaps[i]!.data() as Partial<Profile> | undefined),
      } as Profile;
      const stats = {
        ...sDefault,
        ...(snaps[humans.length + i]!.data() as Partial<PlayerStats> | undefined),
      } as PlayerStats;
      const ach =
        (snaps[humans.length * 2 + i]!.data() as
          { unlocked?: Record<string, number> } | undefined) ?? {};

      const xpGained = Math.round((won ? table.xpWin : table.xpLoss) * mult);
      const coinsGained = won ? table.coinsWin : table.coinsLoss;
      const lpDelta = won ? table.lpWin : table.lpLoss;

      // Level
      let xp = profile.xp + xpGained;
      let level = profile.level;
      let xpToNext = profile.xpToNext || xpForLevel(level);
      let leveledUp = false;
      while (xp >= xpToNext) {
        xp -= xpToNext;
        level += 1;
        xpToNext = xpForLevel(level);
        leveledUp = true;
      }
      // League
      const leaguePoints = Math.max(0, profile.leaguePoints + lpDelta);
      const newLeague = leagueForPoints(leaguePoints);
      const promoted = newLeague.order > (leagueForPoints(profile.leaguePoints).order ?? 0);

      tx.set(profileRefs[i]!, {
        ...profile,
        xp,
        level,
        xpToNext,
        leaguePoints,
        leagueId: newLeague.id as LeagueId,
        coins: profile.coins + coinsGained,
        updatedAt: now(),
      });

      // Stats
      const trucos = input.trucosByUid?.[h.uid];
      const currentStreak = won ? stats.currentStreak + 1 : 0;
      const nextStats: PlayerStats = {
        ...stats,
        matches: stats.matches + 1,
        wins: stats.wins + (won ? 1 : 0),
        losses: stats.losses + (won ? 0 : 1),
        aiMatches: stats.aiMatches + (input.mode === 'ai' ? 1 : 0),
        onlineMatches: stats.onlineMatches + (input.mode === 'online' ? 1 : 0),
        trucosCalled: stats.trucosCalled + (trucos?.called ?? 0),
        trucosAccepted: stats.trucosAccepted + (trucos?.accepted ?? 0),
        currentStreak,
        bestStreak: Math.max(stats.bestStreak, currentStreak),
        hardWins:
          stats.hardWins + (won && input.mode === 'ai' && input.difficulty === 'hard' ? 1 : 0),
        updatedAt: now(),
      };
      nextStats.winRate =
        nextStats.matches === 0 ? 0 : Math.round((nextStats.wins / nextStats.matches) * 100);
      const { id: _sid, ...statsData } = nextStats;
      tx.set(statsRefs[i]!, statsData);

      // Achievements
      const unlocked = { ...(ach.unlocked ?? {}) };
      for (const a of ACHIEVEMENTS) {
        if (!unlocked[a.id] && Number(nextStats[a.stat]) >= a.target) unlocked[a.id] = now();
      }
      tx.set(achRefs[i]!, { unlocked }, { merge: true });

      byUid[h.uid] = {
        xpGained,
        coinsGained,
        leaguePointsDelta: lpDelta,
        leveledUp,
        newLevel: level,
        newLeagueId: newLeague.id as LeagueId,
        promoted,
      };
    });

    const entry: Omit<MatchHistoryEntry, 'id'> = {
      mode: input.mode,
      ...(input.difficulty ? { difficulty: input.difficulty } : {}),
      playerIds: humans.map((h) => h.uid),
      players: input.players,
      scores: input.scores,
      winnerTeam: input.winnerTeam,
      handsPlayed: input.handsPlayed,
      finishedAt: now(),
    };
    tx.set(historyRef, entry);
    return { alreadyProcessed: false, byUid };
  });
}
