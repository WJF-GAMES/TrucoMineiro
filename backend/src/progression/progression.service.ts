import { Injectable } from '@nestjs/common';
import { LeagueScoreEvent, Prisma } from '@prisma/client';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { LeaguesService } from '../leagues/leagues.service';
import { RealtimeService } from '../realtime/realtime.service';
import { S2C } from '../realtime/events';
import { moduleLogger } from '../common/logger';
import { normalizeLeagueId } from '../domain/model/leagues';
import { xpForLevel, type AIDifficultyId, type ProgressionResult } from '../domain/model/types';
import { ACHIEVEMENTS } from './achievements';
import { REWARDS } from './rewards';
import { toProfile, toStats } from '../users/user-lookup.service';

const log = moduleLogger('progression');

export { REWARDS } from './rewards';

export interface OutcomeHuman {
  userId: string;
  seat: number;
  trucosCalled?: number;
  trucosAccepted?: number;
}

export interface MatchOutcomeInput {
  matchId: string;
  /** Chave de idempotência da progressão (partida, saída antecipada, id legado). */
  key: string;
  mode: 'ai' | 'online';
  difficulty?: AIDifficultyId;
  humans: OutcomeHuman[];
  scores: [number, number];
  winnerTeam: 0 | 1;
  handsPlayed: number;
  forfeit?: boolean;
  xpMultiplier?: number;
}

export interface OutcomeResult {
  alreadyProcessed: boolean;
  byUserId: Record<string, ProgressionResult>;
}

/**
 * XP, nível, estatísticas, conquistas e pontos da liga de cada humano de uma partida.
 * Idempotente: a linha de `MatchResult` (chave + usuário) é gravada na mesma transação e trava
 * qualquer reprocessamento. Só o servidor chega aqui — o cliente nunca informa resultado.
 */
@Injectable()
export class ProgressionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leagues: LeaguesService,
    private readonly realtime: RealtimeService,
  ) {}

  async process(input: MatchOutcomeInput): Promise<OutcomeResult> {
    const result = await this.prisma.tx((tx) => this.applyInTx(tx, input));
    await this.afterCommit(input, result);
    return result;
  }

  async applyInTx(tx: Tx, input: MatchOutcomeInput): Promise<OutcomeResult> {
    const humans = input.humans;
    if (humans.length === 0) return { alreadyProcessed: false, byUserId: {} };
    const ids = humans.map((h) => h.userId);
    const existing = await tx.matchResult.findMany({ where: { key: input.key, userId: { in: ids } } });
    if (existing.length > 0) {
      return {
        alreadyProcessed: true,
        byUserId: Object.fromEntries(
          existing.map((r) => [
            r.userId,
            {
              xpGained: r.xpGained,
              leaguePointsDelta: r.leaguePointsDelta,
              leveledUp: r.leveledUp,
              newLevel: r.newLevel,
              newLeagueId: normalizeLeagueId(r.newLeagueId),
            },
          ]),
        ),
      };
    }

    const table = REWARDS[input.mode === 'online' ? 'online' : (input.difficulty ?? 'normal')];
    const mult = input.xpMultiplier ?? 1;
    // Trava as linhas na ordem dos ids: duas partidas terminando juntas não se atropelam.
    const sorted = [...ids].sort();
    await tx.$queryRaw`SELECT "userId" FROM "UserProfile" WHERE "userId" IN (${Prisma.join(
      sorted.map((id) => Prisma.sql`${id}::uuid`),
    )}) ORDER BY "userId" FOR UPDATE`;
    const [profiles, stats, unlocked] = await Promise.all([
      tx.userProfile.findMany({ where: { userId: { in: ids } } }),
      tx.playerStatistics.findMany({ where: { userId: { in: ids } } }),
      tx.userAchievement.findMany({ where: { userId: { in: ids } }, select: { userId: true, achievementId: true } }),
    ]);
    const profileBy = new Map(profiles.map((p) => [p.userId, p]));
    const statsBy = new Map(stats.map((s) => [s.userId, s]));

    const byUserId: Record<string, ProgressionResult> = {};
    for (const h of humans) {
      const profile = profileBy.get(h.userId);
      const st = statsBy.get(h.userId);
      if (!profile || !st) {
        log.warn('progression_missing_profile', { userId: h.userId });
        continue;
      }
      const won = h.seat % 2 === input.winnerTeam;
      const xpGained = Math.round((won ? table.xpWin : table.xpLoss) * mult);
      const lpDelta = won ? table.lpWin : table.lpLoss;

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
      // Liga só muda na virada semanal: aqui a liga do perfil é apenas lida.
      const leagueId = normalizeLeagueId(profile.leagueId);
      await tx.userProfile.update({
        where: { userId: h.userId },
        data: { xp, level, xpToNext, leaguePoints: Math.max(0, profile.leaguePoints + lpDelta) },
      });

      const currentStreak = won ? st.currentStreak + 1 : 0;
      const next = {
        matches: st.matches + 1,
        wins: st.wins + (won ? 1 : 0),
        losses: st.losses + (won ? 0 : 1),
        aiMatches: st.aiMatches + (input.mode === 'ai' ? 1 : 0),
        onlineMatches: st.onlineMatches + (input.mode === 'online' ? 1 : 0),
        trucosCalled: st.trucosCalled + (h.trucosCalled ?? 0),
        trucosAccepted: st.trucosAccepted + (h.trucosAccepted ?? 0),
        currentStreak,
        bestStreak: Math.max(st.bestStreak, currentStreak),
        hardWins: st.hardWins + (won && input.mode === 'ai' && input.difficulty === 'hard' ? 1 : 0),
        winRate: 0,
      };
      next.winRate = next.matches === 0 ? 0 : Math.round((next.wins / next.matches) * 100);
      await tx.playerStatistics.update({ where: { userId: h.userId }, data: next });

      const have = new Set(unlocked.filter((u) => u.userId === h.userId).map((u) => u.achievementId));
      const newly = ACHIEVEMENTS.filter(
        (a) => !have.has(a.id) && Number((next as Record<string, number>)[a.stat] ?? 0) >= a.target,
      );
      if (newly.length > 0) {
        await tx.userAchievement.createMany({
          data: newly.map((a) => ({ userId: h.userId, achievementId: a.id })),
          skipDuplicates: true,
        });
      }

      await tx.matchResult.create({
        data: {
          key: input.key,
          matchId: input.matchId,
          userId: h.userId,
          seat: h.seat,
          won,
          forfeit: input.forfeit ?? false,
          scoreTeam0: input.scores[0],
          scoreTeam1: input.scores[1],
          winnerTeam: input.winnerTeam,
          xpGained,
          leaguePointsDelta: lpDelta,
          leveledUp,
          newLevel: level,
          newLeagueId: leagueId,
        },
      });
      byUserId[h.userId] = { xpGained, leaguePointsDelta: lpDelta, leveledUp, newLevel: level, newLeagueId: leagueId };
    }
    return { alreadyProcessed: false, byUserId };
  }

  /**
   * Depois do commit: pontos da semana (idempotência própria por partida+usuário+evento) e aviso
   * ao app com o perfil novo. Falha aqui não desfaz o resultado da partida.
   */
  async afterCommit(input: MatchOutcomeInput, result: OutcomeResult): Promise<void> {
    if (result.alreadyProcessed) return;
    await Promise.all(
      input.humans.map(async (h) => {
        const reward = result.byUserId[h.userId];
        if (!reward) return;
        const won = h.seat % 2 === input.winnerTeam;
        await this.leagues
          .addWeeklyPoints({
            userId: h.userId,
            matchKey: input.key,
            event: won ? LeagueScoreEvent.MATCH_WIN : LeagueScoreEvent.MATCH_LOSS,
            points: reward.leaguePointsDelta,
            won,
          })
          .catch((e: Error) => log.warn('league_points_failed', { userId: h.userId, error: e.message }));
        await this.pushProfile(h.userId);
      }),
    );
  }

  async pushProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { firebaseUid: true, countryCode: true, profile: true, stats: true },
    });
    if (!user?.profile || !user.stats) return;
    this.realtime.toUser(userId, S2C.profileUpdated, {
      profile: toProfile(user.firebaseUid, user.profile, user.countryCode),
      stats: toStats(user.firebaseUid, user.stats),
    });
  }
}
