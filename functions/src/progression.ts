import { logger } from 'firebase-functions/v2';
import { db, now } from './lib/admin';
import {
  Achievement,
  AIDifficultyId,
  MatchHistoryEntry,
  PlayerStats,
  Profile,
  ProgressionResult,
  xpForLevel,
} from './domain/model/types';
import { normalizeLeagueId } from './domain/model/leagues';
import { addWeeklyLeaguePoints } from './leagues';
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
  /** Pontos da liga na semana. Nunca negativos: o ranking semanal só acumula. */
  lpWin: number;
  lpLoss: number;
}

const REWARDS: Record<'online' | AIDifficultyId, RewardTable> = {
  online: { xpWin: 80, xpLoss: 30, lpWin: 25, lpLoss: 8 },
  easy: { xpWin: 30, xpLoss: 10, lpWin: 5, lpLoss: 1 },
  normal: { xpWin: 60, xpLoss: 20, lpWin: 10, lpLoss: 3 },
  hard: { xpWin: 90, xpLoss: 30, lpWin: 15, lpLoss: 5 },
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
 * Applies XP / league points / stats / achievements for every human player of a match.
 * Idempotent: the matchHistory document is created inside the same transaction and acts as the lock.
 */
export async function processProgression(
  input: MatchOutcomeInput,
): Promise<{ alreadyProcessed: boolean; byUid: Record<string, ProgressionResult> }> {
  const historyRef = db.doc(`matchHistory/${input.matchId}`);
  const humans = input.players.filter((p) => !p.bot);
  const table = REWARDS[input.mode === 'online' ? 'online' : (input.difficulty ?? 'normal')];
  const mult = input.xpMultiplier ?? 1;

  const result = await db.runTransaction(async (tx) => {
    const history = await tx.get(historyRef);
    if (history.exists)
      return { alreadyProcessed: true, byUid: {} as Record<string, ProgressionResult> };

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
      // Liga: a partida só soma pontos da SEMANA (feito fora da transação, por
      // `addWeeklyLeaguePoints`). Subir ou descer de liga acontece apenas na virada semanal,
      // então aqui a liga do perfil não muda — ela espelha `playerProgress.currentLeagueId`.
      const leagueId = normalizeLeagueId(profile.leagueId);

      tx.set(profileRefs[i]!, {
        ...profile,
        xp,
        level,
        xpToNext,
        leaguePoints: Math.max(0, profile.leaguePoints + lpDelta),
        leagueId,
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
        leaguePointsDelta: lpDelta,
        leveledUp,
        newLevel: level,
        newLeagueId: leagueId,
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

  // Pontos da semana ficam FORA da transação acima: `addWeeklyLeaguePoints` precisa garantir o
  // vínculo com o grupo antes (leitura de outra coleção) e tem idempotência própria por
  // matchId + uid + eventType, então uma falha aqui não pontua duas vezes na retentativa.
  if (!result.alreadyProcessed) {
    await Promise.all(
      humans.map((h) => {
        const won = h.seat % 2 === input.winnerTeam;
        return addWeeklyLeaguePoints({
          uid: h.uid,
          matchId: input.matchId,
          eventType: won ? 'match_win' : 'match_loss',
          points: won ? table.lpWin : table.lpLoss,
          won,
        }).catch((e: Error) => {
          // A partida já foi contabilizada; perder o ponto da liga não pode derrubar o resultado.
          logger.warn('falha ao somar pontos da liga', { uid: h.uid, error: e.message });
        });
      }),
    );
  }

  return result;
}
