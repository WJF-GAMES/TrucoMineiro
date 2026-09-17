/**
 * Importação idempotente do backup do Firebase para o PostgreSQL.
 *
 * Modelo relacional (não cópia de documentos): amizades espelhadas viram uma linha por par,
 * `matchHistory` vira Match + MatchParticipant + MatchResult, grupos de liga viram
 * LeagueSeason/LeagueGroup/LeagueMembership etc.
 *
 * Idempotência em dois níveis: chaves naturais (upsert) e `MigrationRecord` (fonte + id +
 * checksum). Rodar de novo com os mesmos arquivos não duplica nada; documento alterado é
 * reaplicado e contado como "atualizado".
 */
import { createHash } from 'crypto';
import { createReadStream, existsSync } from 'fs';
import { join } from 'path';
import { createInterface } from 'readline';
import {
  FriendRequestStatus,
  FriendshipSource,
  LeagueGroupStatus,
  LeagueScoreEvent,
  MatchMode,
  MatchStatus,
  Prisma,
  PrismaClient,
  SeatController,
  SuppressionReason,
  WeeklyResult,
} from '@prisma/client';
import type { ExportedDoc, Json } from './firebase-export';
import { isLeagueId, normalizeLeagueId } from '../../src/domain/model/leagues';
import { isValidWeekKey, weekWindow } from '../../src/domain/model/leagueWeek';
import { zonesForGroupSize } from '../../src/domain/model/leagueGroups';
import { AVATAR_IDS, xpForLevel } from '../../src/domain/model/types';
import { REWARDS } from '../../src/progression/rewards';

export interface EntityReport {
  read: number;
  migrated: number;
  updated: number;
  skipped: number;
  duplicates: number;
  failed: number;
  corrected: number;
  errors: string[];
}

export type ImportReport = Record<string, EntityReport>;

type Data = Record<string, Json>;

const num = (v: Json | undefined, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const str = (v: Json | undefined, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const date = (v: Json | undefined, fallback?: Date): Date => (typeof v === 'number' && v > 0 ? new Date(v) : (fallback ?? new Date()));
const avatar = (v: Json | undefined): string => (AVATAR_IDS.includes(v as never) ? (v as string) : 'joao');
const checksum = (d: unknown) => createHash('sha256').update(JSON.stringify(d)).digest('hex');

export async function readNdjson(dir: string, file: string): Promise<ExportedDoc[]> {
  const path = join(dir, `${file}.ndjson`);
  if (!existsSync(path)) return [];
  const out: ExportedDoc[] = [];
  const rl = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) if (line.trim()) out.push(JSON.parse(line) as ExportedDoc);
  return out;
}

export class Importer {
  readonly report: ImportReport = {};
  private readonly idByUid = new Map<string, string>();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly dryRun = false,
  ) {}

  private entity(name: string): EntityReport {
    return (this.report[name] ??= {
      read: 0,
      migrated: 0,
      updated: 0,
      skipped: 0,
      duplicates: 0,
      failed: 0,
      corrected: 0,
      errors: [],
    });
  }

  /**
   * Aplica `fn` a um documento com idempotência por `MigrationRecord`. `fn` devolve `false`
   * quando o documento foi descartado de propósito (dado transitório/inválido).
   */
  private async apply(
    entity: string,
    source: string,
    sourceId: string,
    payload: unknown,
    fn: (tx: Prisma.TransactionClient) => Promise<boolean | 'corrected'>,
  ) {
    const r = this.entity(entity);
    r.read++;
    const sum = checksum(payload);
    try {
      const prev = await this.prisma.migrationRecord.findUnique({
        where: { source_sourceId: { source, sourceId } },
      });
      if (prev?.checksum === sum) {
        r.duplicates++;
        return;
      }
      if (this.dryRun) {
        r.migrated++;
        return;
      }
      const outcome = await this.prisma.$transaction(async (tx) => {
        const res = await fn(tx);
        if (res !== false) {
          await tx.migrationRecord.upsert({
            where: { source_sourceId: { source, sourceId } },
            create: { source, sourceId, checksum: sum },
            update: { checksum: sum, migratedAt: new Date() },
          });
        }
        return res;
      });
      if (outcome === false) r.skipped++;
      else {
        if (prev) r.updated++;
        else r.migrated++;
        if (outcome === 'corrected') r.corrected++;
      }
    } catch (e) {
      r.failed++;
      if (r.errors.length < 20) r.errors.push(`${sourceId}: ${(e as Error).message.split('\n').slice(-1)[0]}`);
    }
  }

  private async userId(uid: string, tx: Prisma.TransactionClient | PrismaClient = this.prisma): Promise<string | null> {
    const hit = this.idByUid.get(uid);
    if (hit) return hit;
    const row = await tx.user.findUnique({ where: { firebaseUid: uid }, select: { id: true } });
    if (row) this.idByUid.set(uid, row.id);
    return row?.id ?? null;
  }

  // --- Usuários --------------------------------------------------------------------------

  async users(users: ExportedDoc[], profiles: ExportedDoc[], stats: ExportedDoc[], progress: ExportedDoc[]) {
    const byUid = new Map<string, { user?: Data; profile?: Data; stats?: Data; progress?: Data }>();
    const put = (docs: ExportedDoc[], key: 'user' | 'profile' | 'stats' | 'progress') => {
      for (const d of docs) {
        const e = byUid.get(d.id) ?? {};
        e[key] = d.data;
        byUid.set(d.id, e);
      }
    };
    put(users, 'user');
    put(profiles, 'profile');
    put(stats, 'stats');
    put(progress, 'progress');

    for (const [uid, e] of byUid) {
      // Sem `users/{uid}` não há conta: perfil/estatística soltos são órfãos de conta apagada.
      if (!e.user) {
        const r = this.entity('users');
        r.read++;
        r.skipped++;
        continue;
      }
      await this.apply('users', 'user', uid, e, async (tx) => {
        let corrected = false;
        const p = e.profile ?? {};
        const u = e.user ?? {};
        const nickname = str(p.nickname).trim().slice(0, 16);
        if (nickname !== str(p.nickname)) corrected = true;
        const leagueId = normalizeLeagueId(e.progress?.currentLeagueId ?? p.leagueId);
        if (p.leagueId !== undefined && !isLeagueId(p.leagueId)) corrected = true;
        const country = str(p.countryCode, 'BR').slice(0, 2) || 'BR';
        const createdAt = date(p.createdAt ?? u.createdAt);
        const user = await tx.user.upsert({
          where: { firebaseUid: uid },
          create: {
            firebaseUid: uid,
            countryCode: country,
            createdAt,
            lastSeenAt: date(u.lastSeenAt, createdAt),
          },
          update: { countryCode: country },
          select: { id: true },
        });
        this.idByUid.set(uid, user.id);
        const level = Math.max(1, Math.floor(num(p.level, 1)));
        const profileData = {
          nickname,
          nicknameLower: nickname.toLowerCase(),
          avatarId: avatar(p.avatarId),
          level,
          xp: Math.max(0, Math.floor(num(p.xp))),
          xpToNext: Math.max(1, Math.floor(num(p.xpToNext, xpForLevel(level)))),
          leagueId,
          leaguePoints: Math.max(0, Math.floor(num(p.leaguePoints))),
        };
        await tx.userProfile.upsert({
          where: { userId: user.id },
          create: { userId: user.id, ...profileData, createdAt },
          update: profileData,
        });
        const s = e.stats ?? {};
        const statsData = {
          matches: num(s.matches),
          wins: num(s.wins),
          losses: num(s.losses),
          winRate: num(s.winRate),
          aiMatches: num(s.aiMatches),
          onlineMatches: num(s.onlineMatches),
          trucosCalled: num(s.trucosCalled),
          trucosAccepted: num(s.trucosAccepted),
          bestStreak: num(s.bestStreak),
          currentStreak: num(s.currentStreak),
          hardWins: num(s.hardWins),
        };
        await tx.playerStatistics.upsert({
          where: { userId: user.id },
          create: { userId: user.id, ...statsData },
          update: statsData,
        });
        // Aparelhos (tokens FCM).
        const tokens = u.fcmTokens && typeof u.fcmTokens === 'object' ? (u.fcmTokens as Record<string, Json>) : {};
        for (const [token, meta] of Object.entries(tokens)) {
          if (token.length < 10 || token.length > 4096) continue;
          const platform = str((meta as Data | null)?.platform, 'android').slice(0, 20);
          await tx.userDevice.upsert({
            where: { token },
            create: { userId: user.id, token, platform },
            update: { userId: user.id, platform },
          });
        }
        // Token do QR de amizade.
        if (typeof u.inviteToken === 'string' && u.inviteToken.length <= 64) {
          const holder = await tx.user.findUnique({ where: { inviteToken: u.inviteToken }, select: { id: true } });
          if (!holder || holder.id === user.id)
            await tx.user.update({
              where: { id: user.id },
              data: {
                inviteToken: u.inviteToken,
                inviteTokenExpiresAt: typeof u.inviteTokenExpiresAt === 'number' ? new Date(u.inviteTokenExpiresAt) : null,
              },
            });
        }
        return corrected ? 'corrected' : true;
      });
    }
  }

  /** Diretório de telefones (hash). Só vale com o MESMO CONTACTS_PEPPER das Functions. */
  async phoneIndex(docs: ExportedDoc[]) {
    for (const d of docs) {
      await this.apply('phoneIndex', 'phoneIndex', d.id, d.data, async (tx) => {
        const uid = str(d.data.uid);
        if (!/^[0-9a-f]{64}$/.test(d.id) || !uid) return false;
        const id = await this.userId(uid, tx);
        if (!id) return false;
        const other = await tx.user.findUnique({ where: { phoneHash: d.id }, select: { id: true } });
        if (other && other.id !== id) return false;
        await tx.user.update({ where: { id }, data: { phoneHash: d.id } });
        return true;
      });
    }
  }

  async achievements(docs: ExportedDoc[]) {
    const catalog = new Set((await this.prisma.achievement.findMany({ select: { id: true } })).map((a) => a.id));
    for (const d of docs) {
      await this.apply('userAchievements', 'userAchievements', d.id, d.data, async (tx) => {
        const id = await this.userId(d.id, tx);
        if (!id) return false;
        const unlocked = (d.data.unlocked ?? {}) as Record<string, Json>;
        const rows = Object.entries(unlocked)
          .filter(([aid]) => catalog.has(aid))
          .map(([aid, at]) => ({ userId: id, achievementId: aid, unlockedAt: date(at) }));
        if (rows.length) await tx.userAchievement.createMany({ data: rows, skipDuplicates: true });
        return rows.length === Object.keys(unlocked).length ? true : 'corrected';
      });
    }
  }

  // --- Social ----------------------------------------------------------------------------

  async friendships(docs: ExportedDoc[]) {
    // O par espelhado vira UMA linha: a primeira ocorrência cria, a segunda é duplicata.
    for (const d of docs) {
      const [, a, , b] = d.path.split('/');
      if (!a || !b) continue;
      const [x, y] = [a, b].sort();
      await this.apply('friendships', 'friendship', `${x}|${y}`, { since: d.data.since ?? null }, async (tx) => {
        const ia = await this.userId(a, tx);
        const ib = await this.userId(b, tx);
        if (!ia || !ib || ia === ib) return false;
        const pair = ia < ib ? { userAId: ia, userBId: ib } : { userAId: ib, userBId: ia };
        await tx.friendship.upsert({
          where: { userAId_userBId: pair },
          create: {
            ...pair,
            source: d.data.source === 'phone_contact' ? FriendshipSource.PHONE_CONTACT : FriendshipSource.MANUAL,
            createdAt: date(d.data.since),
          },
          update: {},
        });
        return true;
      });
    }
  }

  async friendRequests(docs: ExportedDoc[]) {
    const status: Record<string, FriendRequestStatus> = {
      pending: FriendRequestStatus.PENDING,
      accepted: FriendRequestStatus.ACCEPTED,
      declined: FriendRequestStatus.DECLINED,
    };
    for (const d of docs) {
      await this.apply('friendRequests', 'friendRequest', d.id, d.data, async (tx) => {
        const from = await this.userId(str(d.data.from), tx);
        const to = await this.userId(str(d.data.to), tx);
        const st = status[str(d.data.status)];
        if (!from || !to || !st || from === to) return false;
        await tx.friendRequest.upsert({
          where: { fromUserId_toUserId: { fromUserId: from, toUserId: to } },
          create: {
            fromUserId: from,
            toUserId: to,
            status: st,
            createdAt: date(d.data.createdAt),
            resolvedBy:
              d.data.resolvedBy === 'phone_contact'
                ? FriendshipSource.PHONE_CONTACT
                : d.data.resolvedBy === 'manual'
                  ? FriendshipSource.MANUAL
                  : null,
          },
          update: { status: st },
        });
        return true;
      });
    }
  }

  async blocks(docs: ExportedDoc[]) {
    for (const d of docs) {
      const [, a, , b] = d.path.split('/');
      await this.apply('blocks', 'block', `${a}|${b}`, d.data, async (tx) => {
        const blocker = await this.userId(a ?? '', tx);
        const blocked = await this.userId(b ?? '', tx);
        if (!blocker || !blocked || blocker === blocked) return false;
        await tx.blockedUser.upsert({
          where: { blockerId_blockedId: { blockerId: blocker, blockedId: blocked } },
          create: { blockerId: blocker, blockedId: blocked, createdAt: date(d.data.since) },
          update: {},
        });
        return true;
      });
    }
  }

  async suppressions(docs: ExportedDoc[]) {
    for (const d of docs) {
      const [, a, , b] = d.path.split('/');
      await this.apply('suppressions', 'suppression', `${a}|${b}`, d.data, async (tx) => {
        const user = await this.userId(a ?? '', tx);
        const other = await this.userId(b ?? '', tx);
        if (!user || !other || user === other) return false;
        await tx.friendshipSuppression.upsert({
          where: { userId_otherUserId: { userId: user, otherUserId: other } },
          create: {
            userId: user,
            otherUserId: other,
            reason: d.data.reason === 'blocked' ? SuppressionReason.BLOCKED : SuppressionReason.REMOVED,
            createdAt: date(d.data.since),
          },
          update: {},
        });
        return true;
      });
    }
  }

  // --- Ligas -----------------------------------------------------------------------------

  private async season(tx: Prisma.TransactionClient, weekKey: string) {
    const { startAt, endAt } = weekWindow(weekKey);
    await tx.leagueSeason.upsert({
      where: { weekKey },
      create: { weekKey, startAt: new Date(startAt), endAt: new Date(endAt) },
      update: {},
    });
  }

  async leagueGroups(groups: ExportedDoc[], members: ExportedDoc[]) {
    const status: Record<string, LeagueGroupStatus> = {
      forming: LeagueGroupStatus.FORMING,
      active: LeagueGroupStatus.ACTIVE,
      finalizing: LeagueGroupStatus.FINALIZING,
      finalized: LeagueGroupStatus.FINALIZED,
    };
    for (const g of groups) {
      await this.apply('leagueGroups', 'leagueGroup', g.id, g.data, async (tx) => {
        const weekKey = str(g.data.weekKey);
        if (!isValidWeekKey(weekKey) || !isLeagueId(g.data.leagueId) || g.id.length > 48) return false;
        await this.season(tx, weekKey);
        await tx.leagueGroup.upsert({
          where: { id: g.id },
          create: {
            id: g.id,
            weekKey,
            leagueId: g.data.leagueId as string,
            division: Math.max(1, num(g.data.division, 1)),
            status: status[str(g.data.status)] ?? LeagueGroupStatus.ACTIVE,
            memberCount: 0,
            finalizedAt: typeof g.data.finalizedAt === 'number' ? new Date(g.data.finalizedAt) : null,
            createdAt: date(g.data.createdAt),
          },
          update: { status: status[str(g.data.status)] ?? LeagueGroupStatus.ACTIVE },
        });
        return true;
      });
    }
    const groupWeek = new Map(groups.map((g) => [g.id, str(g.data.weekKey)]));
    for (const m of members) {
      const [, groupId, , uid] = m.path.split('/');
      await this.apply('leagueMemberships', 'leagueMember', `${groupId}|${uid}`, m.data, async (tx) => {
        const weekKey = groupWeek.get(groupId ?? '');
        const userId = await this.userId(uid ?? '', tx);
        if (!weekKey || !userId || !groupId) return false;
        const exists = await tx.leagueGroup.findUnique({ where: { id: groupId }, select: { id: true } });
        if (!exists) return false;
        const data = {
          weeklyPoints: num(m.data.weeklyPoints),
          wins: num(m.data.wins),
          matches: num(m.data.matches),
          tiebreakScore: num(m.data.tiebreakScore),
          currentRank: num(m.data.currentRank),
          previousRank: num(m.data.previousRank),
        };
        // Um usuário em dois grupos na mesma semana (dado inconsistente): vale o primeiro.
        const other = await tx.leagueMembership.findUnique({ where: { userId_weekKey: { userId, weekKey } } });
        if (other && other.groupId !== groupId) return false;
        await tx.leagueMembership.upsert({
          where: { groupId_userId: { groupId, userId } },
          create: { groupId, userId, weekKey, joinedAt: date(m.data.joinedAt), ...data },
          update: data,
        });
        return true;
      });
    }
    // Contagens e zonas recalculadas a partir das linhas reais.
    if (!this.dryRun) {
      for (const g of groups) {
        const count = await this.prisma.leagueMembership.count({ where: { groupId: g.id } });
        const zones = zonesForGroupSize(count);
        await this.prisma.leagueGroup
          .update({
            where: { id: g.id },
            data: { memberCount: count, promotionCount: zones.promotionCount, relegationCount: zones.relegationCount },
          })
          .catch(() => undefined);
      }
    }
  }

  async leagueProgress(docs: ExportedDoc[]) {
    const results: Record<string, WeeklyResult> = {
      promoted: WeeklyResult.PROMOTED,
      stayed: WeeklyResult.STAYED,
      relegated: WeeklyResult.RELEGATED,
      top_league: WeeklyResult.TOP_LEAGUE,
      bottom_league: WeeklyResult.BOTTOM_LEAGUE,
    };
    for (const d of docs) {
      await this.apply('leagueProgress', 'playerProgress', d.id, d.data, async (tx) => {
        const userId = await this.userId(d.id, tx);
        if (!userId) return false;
        const weekKey = str(d.data.currentWeekKey);
        const groupId = str(d.data.currentLeagueGroupId);
        const groupOk = groupId ? Boolean(await tx.leagueGroup.findUnique({ where: { id: groupId }, select: { id: true } })) : false;
        const data = {
          currentLeagueId: normalizeLeagueId(d.data.currentLeagueId),
          currentDivision: Math.max(1, num(d.data.currentDivision, 1)),
          currentWeekKey: isValidWeekKey(weekKey) ? weekKey : '1970-W01',
          currentGroupId: groupOk ? groupId : null,
          weeklyPoints: num(d.data.weeklyPoints),
          seasonPoints: num(d.data.seasonPoints),
          lastWeeklyResult: results[str(d.data.lastWeeklyResult)] ?? null,
          lastWeeklyRank: typeof d.data.lastWeeklyRank === 'number' ? d.data.lastWeeklyRank : null,
          lastProcessedWeekKey: isValidWeekKey(d.data.lastProcessedWeekKey) ? (d.data.lastProcessedWeekKey as string) : null,
          lastActiveWeekKey: isValidWeekKey(d.data.lastActiveWeekKey) ? (d.data.lastActiveWeekKey as string) : null,
        };
        await tx.leagueProgress.upsert({ where: { userId }, create: { userId, ...data }, update: data });
        return groupId && !groupOk ? 'corrected' : true;
      });
    }
  }

  async leagueHistory(docs: ExportedDoc[]) {
    for (const d of docs) {
      const [, uid, , weekKey] = d.path.split('/');
      await this.apply('leagueHistory', 'leagueWeek', `${uid}|${weekKey}`, d.data, async (tx) => {
        const userId = await this.userId(uid ?? '', tx);
        const result = str(d.data.result).toUpperCase() as WeeklyResult;
        if (!userId || !weekKey || !isValidWeekKey(weekKey) || !Object.values(WeeklyResult).includes(result)) return false;
        const data = {
          leagueId: normalizeLeagueId(d.data.leagueId),
          division: Math.max(1, num(d.data.division, 1)),
          groupId: str(d.data.groupId).slice(0, 48),
          groupSize: num(d.data.groupSize),
          finalRank: num(d.data.finalRank),
          weeklyPoints: num(d.data.weeklyPoints),
          result,
          previousLeagueId: normalizeLeagueId(d.data.previousLeagueId),
          nextLeagueId: normalizeLeagueId(d.data.nextLeagueId),
          processedAt: date(d.data.processedAt),
        };
        await tx.leagueWeekResult.upsert({
          where: { userId_weekKey: { userId, weekKey } },
          create: { userId, weekKey, ...data },
          update: data,
        });
        return true;
      });
    }
  }

  async leagueScores(docs: ExportedDoc[]) {
    const events: Record<string, LeagueScoreEvent> = {
      match_win: LeagueScoreEvent.MATCH_WIN,
      match_loss: LeagueScoreEvent.MATCH_LOSS,
      bonus: LeagueScoreEvent.BONUS,
    };
    for (const d of docs) {
      await this.apply('leagueScores', 'leagueEvent', d.id, d.data, async (tx) => {
        const userId = await this.userId(str(d.data.uid), tx);
        const event = events[str(d.data.eventType)];
        if (!userId || !event) return false;
        const key = `legacy:${d.id}`.slice(0, 240);
        await tx.leagueScore.upsert({
          where: { key },
          create: {
            key,
            userId,
            groupId: str(d.data.groupId).slice(0, 48),
            weekKey: str(d.data.weekKey).slice(0, 8),
            matchId: str(d.data.matchId).slice(0, 160),
            event,
            points: num(d.data.points),
            createdAt: date(d.data.processedAt),
          },
          update: {},
        });
        return true;
      });
    }
  }

  // --- Histórico de partidas -------------------------------------------------------------

  async matchHistory(docs: ExportedDoc[]) {
    for (const d of docs) {
      await this.apply('matchHistory', 'matchHistory', d.id, d.data, async (tx) => {
        const mode = d.data.mode === 'ai' ? MatchMode.AI : MatchMode.ONLINE;
        const scores = Array.isArray(d.data.scores) ? (d.data.scores as Json[]) : [0, 0];
        const winnerTeam = num(d.data.winnerTeam, -1);
        if (winnerTeam !== 0 && winnerTeam !== 1) return false;
        const players = (Array.isArray(d.data.players) ? d.data.players : []) as Data[];
        const humanUids = (Array.isArray(d.data.playerIds) ? d.data.playerIds : []).filter((x): x is string => typeof x === 'string');
        // Partida só de contas apagadas: histórico sem dono, não migra.
        const owners = await Promise.all(humanUids.map((uid) => this.userId(uid, tx)));
        if (!owners.some(Boolean)) return false;
        const difficulty = str(d.data.difficulty);
        const finishedAt = date(d.data.finishedAt);
        const externalKey = d.id.slice(0, 160);
        const forfeit = d.id.includes('_left_');
        const match = await tx.match.upsert({
          where: { externalKey },
          create: {
            externalKey,
            mode,
            status: MatchStatus.FINISHED,
            difficulty: mode === MatchMode.AI && ['easy', 'normal', 'hard'].includes(difficulty) ? (difficulty.toUpperCase() as 'EASY') : null,
            scoreTeam0: num(scores[0]),
            scoreTeam1: num(scores[1]),
            winnerTeam,
            handsPlayed: num(d.data.handsPlayed),
            createdAt: finishedAt,
            finishedAt,
          },
          update: {},
          select: { id: true },
        });
        let corrected = false;
        for (const p of players.slice(0, 4)) {
          const seat = num(p.seat, -1);
          if (seat < 0 || seat > 3) continue;
          const bot = p.bot === true;
          const userId = bot ? null : await this.userId(str(p.uid), tx);
          if (!bot && !userId) corrected = true;
          await tx.matchParticipant.upsert({
            where: { matchId_seat: { matchId: match.id, seat } },
            create: {
              matchId: match.id,
              seat,
              team: seat % 2,
              userId,
              botKey: bot || !userId ? str(p.uid).slice(0, 64) || `bot${seat}` : null,
              nickname: str(p.nickname, bot ? 'IA' : 'Jogador').slice(0, 40),
              avatarId: avatar(p.avatarId),
              controller: bot || !userId ? SeatController.AI_PERMANENT : SeatController.HUMAN,
            },
            update: {},
          });
        }
        // Resultado por humano: XP/pontos não eram guardados no histórico — derivados da tabela
        // de recompensas vigente (marcado como "corrigido" no relatório).
        const table = REWARDS[mode === MatchMode.ONLINE ? 'online' : ((difficulty || 'normal') as 'normal')] ?? REWARDS.normal;
        for (const uid of humanUids) {
          const userId = await this.userId(uid, tx);
          if (!userId) continue;
          const seat = num(players.find((p) => p.uid === uid)?.seat, 0);
          const won = seat % 2 === winnerTeam;
          const profile = await tx.userProfile.findUnique({ where: { userId }, select: { level: true, leagueId: true } });
          await tx.matchResult.upsert({
            where: { key_userId: { key: d.id.slice(0, 200), userId } },
            create: {
              key: d.id.slice(0, 200),
              matchId: match.id,
              userId,
              seat,
              won,
              forfeit,
              scoreTeam0: num(scores[0]),
              scoreTeam1: num(scores[1]),
              winnerTeam,
              xpGained: won ? table.xpWin : table.xpLoss,
              leaguePointsDelta: won ? table.lpWin : table.lpLoss,
              leveledUp: false,
              newLevel: profile?.level ?? 1,
              newLeagueId: profile?.leagueId ?? 'bronze',
              createdAt: finishedAt,
            },
            update: {},
          });
        }
        // XP/pontos por partida não existiam no histórico antigo: sempre derivados (corrigido).
        void corrected;
        return 'corrected';
      });
    }
  }
}

/** Dados que NÃO migram (transitórios ou derivados) — ver docs/migration.md. */
export const NOT_MIGRATED = {
  contactSync: 'cota diária (janela de 24 h) — recomeça zerada',
  'blockedBy/*': 'espelho derivado de blocks',
  rateLimits: 'janelas de rate limit',
  leagueProcessingLocks: 'travas transitórias',
  'seasons/current': 'não é lido pelo app',
  'RTDB presence': 'presença efêmera — reconstruída na conexão',
  'RTDB stats/onlineCount': 'derivado da presença',
  'RTDB matchmaking/queue': 'fila efêmera',
  'RTDB rooms, userRooms, invites': 'salas/convites vivem minutos; congelamento curto na virada',
  'RTDB gameSessions, userSessions': 'partidas em andamento não atravessam backends; as encerradas já estão em matchHistory',
};

export async function importAll(
  prisma: PrismaClient,
  dir: string,
  dryRun = false,
  opts: { phonePepperMatches?: boolean } = { phonePepperMatches: true },
): Promise<ImportReport> {
  const imp = new Importer(prisma, dryRun);
  const [users, profiles, stats, progress] = await Promise.all([
    readNdjson(dir, 'users'),
    readNdjson(dir, 'profiles'),
    readNdjson(dir, 'playerStats'),
    readNdjson(dir, 'playerProgress'),
  ]);
  await imp.users(users, profiles, stats, progress);
  // Hash de telefone só vale com o mesmo CONTACTS_PEPPER; senão o diretório se refaz no bootstrap.
  if (opts.phonePepperMatches) await imp.phoneIndex(await readNdjson(dir, 'phoneIndex'));
  await imp.achievements(await readNdjson(dir, 'userAchievements'));
  await imp.friendships(await readNdjson(dir, 'friendships.friends'));
  await imp.friendRequests(await readNdjson(dir, 'friendRequests'));
  await imp.blocks(await readNdjson(dir, 'blocks.blocked'));
  await imp.suppressions(await readNdjson(dir, 'autoConnectSuppressed.users'));
  await imp.leagueGroups(await readNdjson(dir, 'weeklyLeagueGroups'), await readNdjson(dir, 'weeklyLeagueGroups.members'));
  await imp.leagueProgress(progress);
  await imp.leagueHistory(await readNdjson(dir, 'leagueHistory.weeks'));
  await imp.leagueScores(await readNdjson(dir, 'processedLeagueEvents'));
  await imp.matchHistory(await readNdjson(dir, 'matchHistory'));
  return imp.report;
}

export interface ValidationRow {
  entity: string;
  source: number;
  target: number;
  ok: boolean;
  note?: string;
}

/** Conferência de contagens origem × destino (checksum lógico). */
export async function validate(prisma: PrismaClient, dir: string): Promise<ValidationRow[]> {
  const [users, profiles, friends, requests, blocks, supp, progress, groups, members, weeks, history, ach] = await Promise.all([
    readNdjson(dir, 'users'),
    readNdjson(dir, 'profiles'),
    readNdjson(dir, 'friendships.friends'),
    readNdjson(dir, 'friendRequests'),
    readNdjson(dir, 'blocks.blocked'),
    readNdjson(dir, 'autoConnectSuppressed.users'),
    readNdjson(dir, 'playerProgress'),
    readNdjson(dir, 'weeklyLeagueGroups'),
    readNdjson(dir, 'weeklyLeagueGroups.members'),
    readNdjson(dir, 'leagueHistory.weeks'),
    readNdjson(dir, 'matchHistory'),
    readNdjson(dir, 'userAchievements'),
  ]);
  void profiles;
  const accountUids = new Set(users.map((d) => d.id));
  const catalog = new Set((await prisma.achievement.findMany({ select: { id: true } })).map((a) => a.id));
  const pairs = new Set(
    friends
      .map((d) => d.path.split('/'))
      .filter((p) => accountUids.has(p[1]!) && accountUids.has(p[3]!))
      .map((p) => [p[1], p[3]].sort().join('|')),
  );
  const unlocked = ach
    .filter((d) => accountUids.has(d.id))
    .reduce((acc, d) => acc + Object.keys((d.data.unlocked ?? {}) as object).filter((id) => catalog.has(id)).length, 0);
  const row = (entity: string, source: number, target: number, note?: string): ValidationRow => ({
    entity,
    source,
    target,
    ok: source === target,
    ...(note ? { note } : {}),
  });
  return [
    row('users', accountUids.size, await prisma.user.count({ where: { firebaseUid: { in: [...accountUids] } } })),
    row('friendships (pares)', pairs.size, await prisma.friendship.count()),
    row('friendRequests', requests.filter((r) => accountUids.has(str(r.data.from)) && accountUids.has(str(r.data.to))).length, await prisma.friendRequest.count()),
    row('blocks', blocks.filter((b) => accountUids.has(b.path.split('/')[1]!) && accountUids.has(b.path.split('/')[3]!)).length, await prisma.blockedUser.count()),
    row('suppressions', supp.filter((b) => accountUids.has(b.path.split('/')[1]!) && accountUids.has(b.path.split('/')[3]!)).length, await prisma.friendshipSuppression.count()),
    row('leagueProgress', progress.filter((p) => accountUids.has(p.id)).length, await prisma.leagueProgress.count()),
    row('leagueGroups', groups.length, await prisma.leagueGroup.count({ where: { id: { in: groups.map((g) => g.id) } } })),
    row('leagueMemberships', members.filter((m) => accountUids.has(m.path.split('/')[3]!)).length, await prisma.leagueMembership.count({ where: { groupId: { in: groups.map((g) => g.id) } } })),
    row('leagueHistory', weeks.filter((w) => accountUids.has(w.path.split('/')[1]!)).length, await prisma.leagueWeekResult.count()),
    row(
      'matchHistory (com dono ativo)',
      history.filter((h) => ((h.data.playerIds ?? []) as string[]).some((u) => accountUids.has(u))).length,
      await prisma.match.count({ where: { externalKey: { in: history.map((h) => h.id.slice(0, 160)) } } }),
    ),
    row('userAchievements (desbloqueios)', unlocked, await prisma.userAchievement.count(), 'só conquistas do catálogo atual'),
  ];
}
