import { Injectable, OnModuleDestroy } from '@nestjs/common';
import {
  LeagueGroup,
  LeagueGroupStatus,
  LeagueProgress,
  LeagueScoreEvent,
  LeagueSeasonStatus,
  Prisma,
  WeeklyResult,
} from '@prisma/client';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { JobLockService } from '../jobs/job-lock.service';
import { RealtimeService } from '../realtime/realtime.service';
import { S2C } from '../realtime/events';
import { moduleLogger } from '../common/logger';
import { now } from '../common/clock';
import { AppError } from '../common/errors';
import { KeyedMutex } from '../common/keyed-mutex';
import {
  LEAGUE_DEFINITIONS,
  LEAGUE_IDS,
  STARTING_LEAGUE_ID,
  leagueById,
  normalizeLeagueId,
} from '../domain/model/leagues';
import {
  MAX_GROUP_SIZE,
  TARGET_GROUP_SIZE,
  needsRebalance,
  planGroupSizes,
  planRebalance,
  zonesForGroupSize,
} from '../domain/model/leagueGroups';
import { rankMembers, resolveWeeklyOutcomes } from '../domain/model/leagueRanking';
import { nextWeekKey, previousWeekKey, weekKeyFor, weekWindow } from '../domain/model/leagueWeek';
import type {
  AvatarId,
  GlobalRankingEntry,
  LeagueDefinition,
  LeagueHistoryEntry,
  LeagueId,
  LeagueRankingMember,
  LeagueScreenSnapshot,
  WeeklyGroupStatus,
  WeeklyResult as DomainWeeklyResult,
} from '../domain/model/types';

const log = moduleLogger('leagues');

/** Acima disso, redistribuir a liga inteira no meio da semana sairia caro demais. */
const REBALANCE_MAX_MEMBERS = 5_000;
const PAGE_SIZE = 200;
const ACTIVE: LeagueGroupStatus[] = [LeagueGroupStatus.FORMING, LeagueGroupStatus.ACTIVE];
const RANK_BROADCAST_DEBOUNCE_MS = 750;

const pad3 = (n: number) => String(n).padStart(3, '0');

/** `2026-W37__gold__001` — determinístico, o que torna a criação de grupos idempotente. */
export function groupIdFor(weekKey: string, leagueId: LeagueId, division: number): string {
  return `${weekKey}__${leagueId}__${pad3(division)}`;
}

function divisionFromId(groupId: string, fallback: number): number {
  const parsed = Number(groupId.split('__')[2]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const toWeeklyResult = (r: DomainWeeklyResult): WeeklyResult => r.toUpperCase() as WeeklyResult;
const fromWeeklyResult = (r: WeeklyResult | null): DomainWeeklyResult | null =>
  r ? (r.toLowerCase() as DomainWeeklyResult) : null;
const fromGroupStatus = (s: LeagueGroupStatus): WeeklyGroupStatus =>
  s.toLowerCase() as WeeklyGroupStatus;

export interface Assignment {
  progress: LeagueProgress;
  group: LeagueGroup;
}

export interface AddPointsInput {
  userId: string;
  matchKey: string;
  event: LeagueScoreEvent;
  points: number;
  won: boolean;
}

export interface FinalizeReport {
  weekKey: string;
  groups: number;
  players: number;
  promoted: number;
  relegated: number;
  stayed: number;
  skipped: number;
  alreadyFinalized?: boolean;
}

/**
 * Sistema de ligas semanais.
 *
 * Princípio absoluto: NENHUM usuário ativo pode ficar sem liga. Toda leitura da tela passa por
 * `ensureAssignment`, que detecta e conserta (liga faltando, semana antiga, grupo finalizado,
 * grupo inexistente, membro sumido) antes de responder. O cliente nunca escreve nada aqui.
 *
 * Concorrência: toda mudança na composição dos grupos de uma liga numa semana acontece sob a trava
 * `league:{semana}:{liga}` (advisory lock do PostgreSQL), válida entre instâncias.
 */
@Injectable()
export class LeaguesService implements OnModuleDestroy {
  private readonly pendingBroadcast = new Map<string, NodeJS.Timeout>();
  private readonly assignQueue = new KeyedMutex();

  constructor(
    private readonly prisma: PrismaService,
    private readonly locks: JobLockService,
    private readonly realtime: RealtimeService,
  ) {}

  // --- Catálogo / semanas ------------------------------------------------------------------

  /** Grava as 20 ligas. Idempotente. */
  async seedDefinitions(db: Tx | PrismaService = this.prisma): Promise<number> {
    for (const l of LEAGUE_DEFINITIONS) {
      const data = {
        order: l.order,
        displayName: l.displayName,
        assetKey: l.assetKey,
        previousLeagueId: l.previousLeagueId,
        nextLeagueId: l.nextLeagueId,
        isFirst: l.isFirst,
        isLast: l.isLast,
        active: l.active,
      };
      await db.league.upsert({ where: { id: l.id }, create: { id: l.id, ...data }, update: data });
    }
    return LEAGUE_DEFINITIONS.length;
  }

  async definitions(): Promise<LeagueDefinition[]> {
    const rows = await this.prisma.league.findMany({ orderBy: { order: 'asc' } });
    return rows.map((r) => ({
      id: r.id as LeagueId,
      order: r.order,
      displayName: r.displayName,
      assetKey: r.assetKey,
      previousLeagueId: (r.previousLeagueId as LeagueId | null) ?? null,
      nextLeagueId: (r.nextLeagueId as LeagueId | null) ?? null,
      isFirst: r.isFirst,
      isLast: r.isLast,
      active: r.active,
    }));
  }

  async ensureSeason(weekKey: string, db: Tx | PrismaService = this.prisma) {
    const { startAt, endAt } = weekWindow(weekKey);
    await db.leagueSeason.upsert({
      where: { weekKey },
      create: { weekKey, startAt: new Date(startAt), endAt: new Date(endAt) },
      update: {},
    });
  }

  private lockName(weekKey: string, leagueId: string) {
    return `league:${weekKey}:${leagueId}`;
  }

  private async recountGroup(tx: Tx, groupId: string): Promise<number> {
    const memberCount = await tx.leagueMembership.count({ where: { groupId } });
    const zones = zonesForGroupSize(memberCount);
    await tx.leagueGroup.update({
      where: { id: groupId },
      data: {
        memberCount,
        promotionCount: zones.promotionCount,
        relegationCount: zones.relegationCount,
      },
    });
    return memberCount;
  }

  // --- Atribuição ---------------------------------------------------------------------------

  /**
   * Garante que o usuário tem liga, semana e grupo válidos AGORA. Qualquer inconsistência é
   * corrigida aqui, sem erro para o usuário.
   */
  async ensureAssignment(userId: string, atMs = now()): Promise<Assignment> {
    const weekKey = weekKeyFor(atMs);
    // Caminho quente: as duas leituras em paralelo (o vínculo da semana é único por usuário).
    const [progress, membership] = await Promise.all([
      this.prisma.leagueProgress.findUnique({ where: { userId } }),
      this.prisma.leagueMembership.findUnique({
        where: { userId_weekKey: { userId, weekKey } },
        include: { group: true },
      }),
    ]);
    const leagueId = normalizeLeagueId(progress?.currentLeagueId);
    const g = membership?.group;
    if (
      progress?.currentWeekKey === weekKey &&
      progress.currentGroupId === g?.id &&
      g.leagueId === leagueId &&
      ACTIVE.includes(g.status)
    ) {
      return { progress, group: g };
    }
    return this.assignToGroup(userId, leagueId, weekKey);
  }

  /**
   * Coloca o jogador no grupo com menos gente da sua liga (ou cria o primeiro). Nunca cria um
   * grupo "sobrando" com 1 pessoa: 20 é ALVO, não teto — o rebalanceamento reparte depois.
   */
  private async assignToGroup(
    userId: string,
    leagueId: LeagueId,
    weekKey: string,
  ): Promise<Assignment> {
    await this.ensureSeason(weekKey);
    const assigned = await this.assignQueue.run(this.lockName(weekKey, leagueId), () =>
      this.prisma.tx(async (tx) => {
        await this.prisma.advisoryLock(tx, this.lockName(weekKey, leagueId));
        let target: LeagueGroup | null = null;

        const existing = await tx.leagueMembership.findUnique({
          where: { userId_weekKey: { userId, weekKey } },
          include: { group: true },
        });
        if (existing) {
          if (existing.group.leagueId === leagueId && ACTIVE.includes(existing.group.status)) {
            target = existing.group;
          } else {
            // Vínculo desta semana num grupo errado (liga mudou / grupo fechado): sai dele.
            await tx.leagueMembership.delete({ where: { id: existing.id } });
            if (existing.group.status !== LeagueGroupStatus.FINALIZED)
              await this.recountGroup(tx, existing.groupId);
          }
        }

        if (!target) {
          const all = await tx.leagueGroup.findMany({
            where: { weekKey, leagueId },
            orderBy: { division: 'asc' },
          });
          const active = all.filter((g) => ACTIVE.includes(g.status));
          const total = active.reduce((acc, g) => acc + g.memberCount, 0) + 1;
          if (active.length === 0) {
            target = await this.createGroup(tx, leagueId, weekKey, nextFreeDivision(all));
          } else {
            const smallest = [...active].sort(
              (a, b) => a.memberCount - b.memberCount || a.division - b.division,
            )[0]!;
            target =
              total > REBALANCE_MAX_MEMBERS && smallest.memberCount >= MAX_GROUP_SIZE
                ? await this.createGroup(tx, leagueId, weekKey, nextFreeDivision(all))
                : smallest;
          }
          await tx.leagueMembership.create({
            data: {
              groupId: target.id,
              userId,
              weekKey,
              currentRank: target.memberCount + 1,
              joinedAt: new Date(now()),
            },
          });
          await this.recountGroup(tx, target.id);
          if (target.status === LeagueGroupStatus.FORMING) {
            await tx.leagueGroup.update({
              where: { id: target.id },
              data: { status: LeagueGroupStatus.ACTIVE },
            });
          }
        }

        const previous = await tx.leagueProgress.findUnique({ where: { userId } });
        const data = {
          currentLeagueId: target.leagueId,
          currentDivision: target.division,
          currentWeekKey: target.weekKey,
          currentGroupId: target.id,
          // Semana nova zera a pontuação semanal (a antiga já virou histórico na finalização).
          weeklyPoints: previous?.currentWeekKey === target.weekKey ? previous.weeklyPoints : 0,
        };
        await tx.leagueProgress.upsert({
          where: { userId },
          create: { userId, ...data },
          update: data,
        });
        return target.id;
      }),
    );

    const groups = await this.prisma.leagueGroup.findMany({
      where: { weekKey, leagueId, status: { in: ACTIVE } },
      select: { memberCount: true },
    });
    const sizes = groups.map((g) => g.memberCount);
    const total = sizes.reduce((a, b) => a + b, 0);
    if (total <= REBALANCE_MAX_MEMBERS && needsRebalance(sizes, total)) {
      await this.rebalanceLeague(leagueId, weekKey);
    }
    // Entrada comum não recalcula o grupo inteiro: quem chega tem 0 pontos e entrou por último,
    // então `currentRank = memberCount + 1` já é a posição certa (o refresh periódico confirma).
    const progress = await this.prisma.leagueProgress.findUniqueOrThrow({ where: { userId } });
    const group = await this.prisma.leagueGroup.findUniqueOrThrow({
      where: { id: progress.currentGroupId ?? assigned },
    });
    return { progress, group };
  }

  private async createGroup(
    tx: Tx,
    leagueId: LeagueId,
    weekKey: string,
    division: number,
    status: LeagueGroupStatus = LeagueGroupStatus.ACTIVE,
    memberCount = 0,
  ): Promise<LeagueGroup> {
    const id = groupIdFor(weekKey, leagueId, division);
    const zones = zonesForGroupSize(memberCount);
    return tx.leagueGroup.upsert({
      where: { id },
      create: {
        id,
        weekKey,
        leagueId,
        division,
        status,
        memberCount,
        targetSize: TARGET_GROUP_SIZE,
        promotionCount: zones.promotionCount,
        relegationCount: zones.relegationCount,
      },
      update: {},
    });
  }

  /** Exclusão de conta: sai do grupo da semana (a contagem do grupo fica certa). */
  async leaveCurrentGroup(userId: string): Promise<void> {
    const memberships = await this.prisma.leagueMembership.findMany({
      where: { userId },
      include: { group: { select: { status: true, weekKey: true, leagueId: true } } },
    });
    for (const m of memberships) {
      if (m.group.status === LeagueGroupStatus.FINALIZED) continue;
      await this.prisma.tx(async (tx) => {
        await this.prisma.advisoryLock(tx, this.lockName(m.group.weekKey, m.group.leagueId));
        await tx.leagueMembership.deleteMany({ where: { id: m.id } });
        await this.recountGroup(tx, m.groupId);
      });
    }
  }

  // --- Rebalanceamento ----------------------------------------------------------------------

  /** Redistribui uma liga numa semana mexendo no mínimo de jogadores. Idempotente. */
  async rebalanceLeague(
    leagueId: LeagueId,
    weekKey: string,
  ): Promise<{ groups: number; moved: number }> {
    const result = await this.assignQueue.run(this.lockName(weekKey, leagueId), () =>
      this.prisma.tx(
        async (tx) => {
          await this.prisma.advisoryLock(tx, this.lockName(weekKey, leagueId));
          const groups = await tx.leagueGroup.findMany({
            where: { weekKey, leagueId, status: { in: ACTIVE } },
            include: { members: { select: { userId: true } } },
          });
          const allMemberIds = groups.flatMap((g) => g.members.map((m) => m.userId)).sort();
          if (allMemberIds.length === 0) return { groups: 0, moved: 0, ids: [] as string[] };

          const taken = new Set(
            (
              await tx.leagueGroup.findMany({
                where: { weekKey, leagueId },
                select: { division: true },
              })
            ).map((g) => g.division),
          );
          const nextGroupId = () => {
            let division = 1;
            while (taken.has(division)) division++;
            taken.add(division);
            return groupIdFor(weekKey, leagueId, division);
          };
          const plan = planRebalance(
            groups.map((g) => ({ groupId: g.id, memberIds: g.members.map((m) => m.userId) })),
            allMemberIds,
            nextGroupId,
          );
          const divisionOf = new Map(groups.map((g) => [g.id, g.division]));
          for (const [index, target] of plan.groups.entries()) {
            const division =
              divisionOf.get(target.groupId) ?? divisionFromId(target.groupId, index + 1);
            await this.createGroup(tx, leagueId, weekKey, division);
            const movers = target.memberIds.filter((uid) => plan.moves[uid] === target.groupId);
            if (movers.length === 0) continue;
            await tx.leagueMembership.updateMany({
              where: { weekKey, userId: { in: movers } },
              data: { groupId: target.groupId },
            });
            await tx.leagueProgress.updateMany({
              where: { userId: { in: movers } },
              data: { currentGroupId: target.groupId, currentDivision: division },
            });
          }
          if (plan.removedGroupIds.length > 0)
            await tx.leagueGroup.deleteMany({ where: { id: { in: plan.removedGroupIds } } });
          for (const target of plan.groups) {
            await this.recountGroup(tx, target.groupId);
            await tx.leagueGroup.update({
              where: { id: target.groupId },
              data: { status: LeagueGroupStatus.ACTIVE },
            });
          }
          return {
            groups: plan.groups.length,
            moved: Object.keys(plan.moves).length,
            ids: plan.groups.map((g) => g.groupId),
          };
        },
        { timeoutMs: 60_000 },
      ),
    );
    for (const id of result.ids) await this.recomputeRanking(id);
    log.info('league_rebalanced', {
      leagueId,
      weekKey,
      groups: result.groups,
      moved: result.moved,
    });
    return { groups: result.groups, moved: result.moved };
  }

  // --- Pontuação ----------------------------------------------------------------------------

  /**
   * Soma pontos da semana. Chave de idempotência: `partida + usuário + evento` — reprocessar a
   * mesma partida nunca pontua duas vezes.
   */
  async addWeeklyPoints(input: AddPointsInput): Promise<{ applied: boolean; groupId: string }> {
    const points = Math.max(0, Math.round(input.points));
    const { group } = await this.ensureAssignment(input.userId);
    const key = `${input.matchKey}__${input.userId}__${input.event}`.slice(0, 240);
    const applied = await this.prisma.tx(async (tx) => {
      const inserted = await tx.leagueScore.createMany({
        data: [
          {
            key,
            userId: input.userId,
            groupId: group.id,
            weekKey: group.weekKey,
            matchId: input.matchKey.slice(0, 160),
            event: input.event,
            points,
          },
        ],
        skipDuplicates: true,
      });
      if (inserted.count === 0) return false;
      const updated = await tx.leagueMembership.updateMany({
        where: { groupId: group.id, userId: input.userId },
        data: {
          weeklyPoints: { increment: points },
          wins: { increment: input.won ? 1 : 0 },
          matches: { increment: 1 },
          tiebreakScore: { increment: points },
        },
      });
      if (updated.count === 0) throw new AppError('CONFLICT', 'Membro do grupo não encontrado.');
      await tx.leagueProgress.update({
        where: { userId: input.userId },
        data: {
          weeklyPoints: { increment: points },
          seasonPoints: { increment: points },
          lastActiveWeekKey: group.weekKey,
        },
      });
      return true;
    });
    if (applied) this.scheduleGroupBroadcast(group.id);
    return { applied, groupId: group.id };
  }

  // --- Ranking ------------------------------------------------------------------------------

  /** Recalcula e grava `currentRank`/`previousRank`. O cliente nunca decide posição. */
  async recomputeRanking(groupId: string): Promise<number> {
    const members = await this.prisma.leagueMembership.findMany({
      where: { groupId },
      select: {
        id: true,
        weeklyPoints: true,
        tiebreakScore: true,
        wins: true,
        joinedAt: true,
        currentRank: true,
        user: { select: { firebaseUid: true } },
      },
    });
    if (members.length === 0) return 0;
    const ranked = rankMembers(
      members.map((m) => ({
        id: m.id,
        uid: m.user.firebaseUid,
        weeklyPoints: m.weeklyPoints,
        tiebreakScore: m.tiebreakScore,
        wins: m.wins,
        joinedAt: m.joinedAt.getTime(),
        currentRank: m.currentRank,
      })),
    );
    const changed = ranked.filter((m) => m.currentRank !== m.rank);
    if (changed.length > 0) {
      const values = Prisma.join(
        changed.map(
          (m) => Prisma.sql`(${m.id}::uuid, ${m.rank}::int, ${m.currentRank || m.rank}::int)`,
        ),
      );
      await this.prisma.$executeRaw`
        UPDATE "LeagueMembership" AS lm
        SET "currentRank" = v.rank, "previousRank" = v.prev, "updatedAt" = now()
        FROM (VALUES ${values}) AS v(id, rank, prev)
        WHERE lm.id = v.id`;
    }
    return ranked.length;
  }

  /** Membros do grupo já ordenados, com identidade atual do perfil (sem cópia desatualizada). */
  async groupMembers(groupId: string, viewerId: string | null): Promise<LeagueRankingMember[]> {
    const rows = await this.prisma.leagueMembership.findMany({
      where: { groupId },
      select: {
        userId: true,
        weeklyPoints: true,
        wins: true,
        tiebreakScore: true,
        joinedAt: true,
        user: {
          select: {
            firebaseUid: true,
            countryCode: true,
            profile: { select: { nickname: true, avatarId: true } },
          },
        },
      },
    });
    return rankMembers(
      rows.map((m) => ({
        userId: m.userId,
        uid: m.user.firebaseUid,
        nickname: m.user.profile?.nickname || 'Jogador',
        avatarId: (m.user.profile?.avatarId ?? 'joao') as AvatarId,
        countryCode: m.user.countryCode || 'BR',
        weeklyPoints: m.weeklyPoints,
        wins: m.wins,
        tiebreakScore: m.tiebreakScore,
        joinedAt: m.joinedAt.getTime(),
      })),
    ).map((m) => ({
      uid: m.uid,
      nickname: m.nickname,
      avatarId: m.avatarId,
      countryCode: m.countryCode,
      weeklyPoints: m.weeklyPoints,
      wins: m.wins,
      rank: m.rank,
      tiebreakScore: m.tiebreakScore,
      joinedAt: m.joinedAt,
      isMe: m.userId === viewerId,
    }));
  }

  /** Ranking ao vivo: agrupa as mudanças de pontos e manda a lista para quem está na tela. */
  onModuleDestroy() {
    for (const timer of this.pendingBroadcast.values()) clearTimeout(timer);
    this.pendingBroadcast.clear();
  }

  scheduleGroupBroadcast(groupId: string) {
    if (this.pendingBroadcast.has(groupId)) return;
    const timer = setTimeout(() => {
      this.pendingBroadcast.delete(groupId);
      void this.broadcastGroup(groupId);
    }, RANK_BROADCAST_DEBOUNCE_MS);
    timer.unref?.();
    this.pendingBroadcast.set(groupId, timer);
  }

  async broadcastGroup(groupId: string) {
    try {
      await this.recomputeRanking(groupId);
      const members = await this.groupMembers(groupId, null);
      this.realtime.toLeague(groupId, S2C.leagueMembers, { groupId, members });
    } catch (e) {
      log.warn('league_broadcast_failed', { groupId, error: (e as Error).message });
    }
  }

  // --- Tela ---------------------------------------------------------------------------------

  async snapshot(userId: string): Promise<LeagueScreenSnapshot> {
    const { group, progress } = await this.ensureAssignment(userId);
    const members = await this.groupMembers(group.id, userId);
    const zones = zonesForGroupSize(members.length);
    const def = leagueById(group.leagueId);
    const { startAt, endAt } = weekWindow(group.weekKey);
    const me = members.find((m) => m.isMe);
    return {
      weekKey: group.weekKey,
      startAt,
      endAt,
      serverTime: now(),
      currentLeague: def,
      previousLeague: def.previousLeagueId ? leagueById(def.previousLeagueId) : null,
      nextLeague: def.nextLeagueId ? leagueById(def.nextLeagueId) : null,
      division: group.division,
      groupId: group.id,
      groupSize: members.length,
      promotionCount: zones.promotionCount,
      relegationCount: zones.relegationCount,
      promotionStart: zones.promotionStart,
      promotionEnd: zones.promotionEnd,
      relegationStart: zones.relegationStart,
      relegationEnd: zones.relegationEnd,
      userRank: me?.rank ?? 0,
      userWeeklyPoints: me?.weeklyPoints ?? 0,
      members,
      lastWeeklyResult: fromWeeklyResult(progress?.lastWeeklyResult ?? null),
      lastWeeklyRank: progress?.lastWeeklyRank ?? null,
    };
  }

  /** Resumo leve para o bootstrap. */
  async summary(userId: string) {
    const { group, progress } = await this.ensureAssignment(userId);
    return {
      leagueId: group.leagueId as LeagueId,
      weekKey: group.weekKey,
      groupId: group.id,
      division: group.division,
      weeklyPoints: progress.weeklyPoints,
      groupStatus: fromGroupStatus(group.status),
    };
  }

  async globalRanking(viewerId: string, limit = 50): Promise<GlobalRankingEntry[]> {
    const max = Math.min(Math.max(Math.floor(limit) || 50, 1), 100);
    const rows = await this.prisma.leagueProgress.findMany({
      orderBy: [{ seasonPoints: 'desc' }, { userId: 'asc' }],
      take: max,
      select: {
        userId: true,
        seasonPoints: true,
        currentLeagueId: true,
        user: {
          select: {
            firebaseUid: true,
            countryCode: true,
            profile: { select: { nickname: true, avatarId: true } },
          },
        },
      },
    });
    return rows.map((r, i) => ({
      uid: r.user.firebaseUid,
      rank: i + 1,
      nickname: r.user.profile?.nickname || 'Jogador',
      avatarId: (r.user.profile?.avatarId ?? 'joao') as AvatarId,
      countryCode: r.user.countryCode || 'BR',
      leagueId: normalizeLeagueId(r.currentLeagueId),
      seasonPoints: r.seasonPoints,
      isMe: r.userId === viewerId,
    }));
  }

  async history(
    userId: string,
    limit = 20,
    cursor?: string,
  ): Promise<{ items: LeagueHistoryEntry[]; nextCursor: string | null }> {
    const take = Math.min(Math.max(limit, 1), 50);
    const rows = await this.prisma.leagueWeekResult.findMany({
      where: { userId },
      orderBy: [{ processedAt: 'desc' }, { weekKey: 'desc' }],
      take: take + 1,
      ...(cursor ? { cursor: { userId_weekKey: { userId, weekKey: cursor } }, skip: 1 } : {}),
    });
    const items = rows.slice(0, take).map((r) => ({
      id: r.weekKey,
      weekKey: r.weekKey,
      leagueId: r.leagueId as LeagueId,
      division: r.division,
      groupId: r.groupId,
      groupSize: r.groupSize,
      finalRank: r.finalRank,
      weeklyPoints: r.weeklyPoints,
      result: fromWeeklyResult(r.result)!,
      previousLeagueId: r.previousLeagueId as LeagueId,
      nextLeagueId: r.nextLeagueId as LeagueId,
      processedAt: r.processedAt.getTime(),
    }));
    return { items, nextCursor: rows.length > take ? items[items.length - 1]!.weekKey : null };
  }

  // --- Fechamento semanal -------------------------------------------------------------------

  /**
   * Fecha uma semana: congela o ranking, grava o histórico, move os jogadores de liga e zera os
   * pontos. Idempotente em dois níveis — o grupo vira FINALIZED e cada jogador guarda
   * `lastProcessedWeekKey` + a linha de `LeagueWeekResult`.
   */
  async finalizeWeek(weekKey: string): Promise<FinalizeReport> {
    const report: FinalizeReport = {
      weekKey,
      groups: 0,
      players: 0,
      promoted: 0,
      relegated: 0,
      stayed: 0,
      skipped: 0,
    };
    await this.ensureSeason(weekKey);
    const season = await this.prisma.leagueSeason.findUniqueOrThrow({ where: { weekKey } });
    if (season.status === LeagueSeasonStatus.FINALIZED)
      return { ...report, alreadyFinalized: true };
    await this.prisma.leagueSeason.update({
      where: { weekKey },
      data: { status: LeagueSeasonStatus.FINALIZING },
    });

    let cursor: string | undefined;
    for (;;) {
      const page = await this.prisma.leagueGroup.findMany({
        where: { weekKey, status: { not: LeagueGroupStatus.FINALIZED } },
        orderBy: { id: 'asc' },
        take: PAGE_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (page.length === 0) break;
      cursor = page[page.length - 1]!.id;
      for (const group of page) {
        await this.finalizeGroup(group, report);
        report.groups++;
      }
      if (page.length < PAGE_SIZE) break;
    }

    await this.prisma.leagueSeason.update({
      where: { weekKey },
      data: { status: LeagueSeasonStatus.FINALIZED, finalizedAt: new Date(now()) },
    });
    log.info('week_finalized', { ...report });
    return report;
  }

  private async finalizeGroup(group: LeagueGroup, report: FinalizeReport) {
    await this.prisma.leagueGroup.update({
      where: { id: group.id },
      data: { status: LeagueGroupStatus.FINALIZING },
    });
    const members = await this.prisma.leagueMembership.findMany({
      where: { groupId: group.id },
      select: {
        userId: true,
        weeklyPoints: true,
        tiebreakScore: true,
        wins: true,
        joinedAt: true,
        user: { select: { firebaseUid: true } },
      },
    });
    const leagueId = normalizeLeagueId(group.leagueId);
    const userByUid = new Map(members.map((m) => [m.user.firebaseUid, m.userId]));
    const outcomes = resolveWeeklyOutcomes(
      leagueId,
      members.map((m) => ({
        uid: m.user.firebaseUid,
        weeklyPoints: m.weeklyPoints,
        tiebreakScore: m.tiebreakScore,
        wins: m.wins,
        joinedAt: m.joinedAt.getTime(),
      })),
    );
    const processedAt = new Date(now());
    const changedUsers: string[] = [];

    for (let i = 0; i < outcomes.length; i += 50) {
      const chunk = outcomes.slice(i, i + 50);
      const applied = await this.prisma.tx(async (tx) => {
        const ids = chunk.map((o) => userByUid.get(o.uid)!);
        const done = new Set(
          (
            await tx.leagueWeekResult.findMany({
              where: { weekKey: group.weekKey, userId: { in: ids } },
              select: { userId: true },
            })
          ).map((r) => r.userId),
        );
        const out: { userId: string; result: DomainWeeklyResult }[] = [];
        for (const o of chunk) {
          const userId = userByUid.get(o.uid)!;
          if (done.has(userId)) continue;
          await tx.leagueWeekResult.create({
            data: {
              userId,
              weekKey: group.weekKey,
              leagueId,
              division: group.division,
              groupId: group.id,
              groupSize: outcomes.length,
              finalRank: o.finalRank,
              weeklyPoints: o.weeklyPoints,
              result: toWeeklyResult(o.result),
              previousLeagueId: o.previousLeagueId,
              nextLeagueId: o.nextLeagueId,
              processedAt,
            },
          });
          await tx.leagueProgress.upsert({
            where: { userId },
            create: {
              userId,
              currentLeagueId: o.nextLeagueId,
              currentWeekKey: group.weekKey,
              lastWeeklyResult: toWeeklyResult(o.result),
              lastWeeklyRank: o.finalRank,
              lastProcessedWeekKey: group.weekKey,
            },
            update: {
              currentLeagueId: o.nextLeagueId,
              weeklyPoints: 0,
              lastWeeklyResult: toWeeklyResult(o.result),
              lastWeeklyRank: o.finalRank,
              lastProcessedWeekKey: group.weekKey,
            },
          });
          // Espelho para as telas que mostram a liga sem abrir a aba Ligas.
          await tx.userProfile.updateMany({
            where: { userId },
            data: { leagueId: o.nextLeagueId },
          });
          await tx.leagueMembership.updateMany({
            where: { groupId: group.id, userId },
            data: { currentRank: o.finalRank },
          });
          out.push({ userId, result: o.result });
        }
        return out;
      });
      report.skipped += chunk.length - applied.length;
      for (const a of applied) {
        report.players++;
        if (a.result === 'promoted') report.promoted++;
        else if (a.result === 'relegated') report.relegated++;
        else report.stayed++;
        changedUsers.push(a.userId);
      }
    }

    await this.prisma.leagueGroup.update({
      where: { id: group.id },
      data: { status: LeagueGroupStatus.FINALIZED, finalizedAt: processedAt },
    });
    return changedUsers;
  }

  /**
   * Monta os grupos da próxima semana com quem jogou na semana que acabou. Contas dormentes não
   * são pré-alocadas: `ensureAssignment` as coloca num grupo quando abrirem o app.
   */
  async prepareNextWeekGroups(
    finishedWeekKey: string,
    targetWeekKey = nextWeekKey(finishedWeekKey),
  ): Promise<{ weekKey: string; leagues: number; players: number; skippedLeagues: number }> {
    await this.ensureSeason(targetWeekKey);
    let leagues = 0;
    let players = 0;
    let skippedLeagues = 0;
    for (const leagueId of LEAGUE_IDS) {
      const users = await this.prisma.leagueProgress.findMany({
        where: {
          currentLeagueId: leagueId,
          lastProcessedWeekKey: finishedWeekKey,
          lastActiveWeekKey: finishedWeekKey,
        },
        orderBy: { userId: 'asc' },
        select: { userId: true, lastWeeklyRank: true },
      });
      if (users.length === 0) continue;
      const placed = await this.prisma.tx(
        async (tx) => {
          await this.prisma.advisoryLock(tx, this.lockName(targetWeekKey, leagueId));
          const existing = await tx.leagueGroup.count({
            where: { weekKey: targetWeekKey, leagueId },
          });
          if (existing > 0) return -1;
          const already = new Set(
            (
              await tx.leagueMembership.findMany({
                where: { weekKey: targetWeekKey, userId: { in: users.map((u) => u.userId) } },
                select: { userId: true },
              })
            ).map((m) => m.userId),
          );
          const pending = users.filter((u) => !already.has(u.userId));
          const sizes = planGroupSizes(pending.length);
          let offset = 0;
          for (const [i, size] of sizes.entries()) {
            const division = i + 1;
            const slice = pending.slice(offset, offset + size);
            offset += size;
            const group = await this.createGroup(
              tx,
              leagueId,
              targetWeekKey,
              division,
              LeagueGroupStatus.FORMING,
              slice.length,
            );
            await tx.leagueMembership.createMany({
              data: slice.map((u) => ({
                groupId: group.id,
                userId: u.userId,
                weekKey: targetWeekKey,
                previousRank: u.lastWeeklyRank ?? 0,
              })),
              skipDuplicates: true,
            });
            await tx.leagueProgress.updateMany({
              where: { userId: { in: slice.map((u) => u.userId) } },
              data: {
                currentWeekKey: targetWeekKey,
                currentGroupId: group.id,
                currentDivision: division,
                weeklyPoints: 0,
              },
            });
          }
          return pending.length;
        },
        { timeoutMs: 120_000 },
      );
      if (placed < 0) {
        skippedLeagues++;
        continue;
      }
      leagues++;
      players += placed;
    }
    await this.prisma.leagueSeason.update({
      where: { weekKey: targetWeekKey },
      data: { preparedAt: new Date(now()) },
    });
    log.info('next_week_prepared', { weekKey: targetWeekKey, leagues, players, skippedLeagues });
    return { weekKey: targetWeekKey, leagues, players, skippedLeagues };
  }

  /** Virada semanal (segunda 00:05, São Paulo). Travada entre instâncias e idempotente. */
  async weeklyRollover(atMs = now()) {
    const finished = previousWeekKey(weekKeyFor(atMs));
    return this.locks.withLock(`league-finalize:${finished}`, 30 * 60_000, async () => {
      await this.seedDefinitions();
      const report = await this.finalizeWeek(finished);
      const prepared = await this.prepareNextWeekGroups(finished);
      return { report, prepared };
    });
  }

  /** Recalcula as posições gravadas dos grupos ativos (seta de subiu/desceu). */
  async refreshRankings(atMs = now()): Promise<number> {
    const groups = await this.prisma.leagueGroup.findMany({
      where: { weekKey: weekKeyFor(atMs), status: { in: ACTIVE } },
      select: { id: true },
    });
    for (const g of groups) {
      await this.recomputeRanking(g.id).catch((e: Error) =>
        log.warn('ranking_refresh_failed', { groupId: g.id, error: e.message }),
      );
    }
    return groups.length;
  }

  // --- Repair -------------------------------------------------------------------------------

  /** Varredura administrativa: contagens erradas, grupos vazios, liga inválida, vínculo quebrado. */
  async repair(limit = 5_000) {
    const report = { scanned: 0, fixedProgress: 0, fixedGroups: 0, fixedCounts: 0 };
    const weekKey = weekKeyFor(now());
    const groups = await this.prisma.leagueGroup.findMany({ where: { weekKey } });
    for (const g of groups) {
      const real = await this.prisma.leagueMembership.count({ where: { groupId: g.id } });
      if (real === 0 && g.status !== LeagueGroupStatus.FINALIZED) {
        await this.prisma.leagueGroup.delete({ where: { id: g.id } }).catch(() => undefined);
        report.fixedGroups++;
      } else if (real !== g.memberCount) {
        await this.prisma.tx((tx) => this.recountGroup(tx, g.id));
        report.fixedCounts++;
      }
    }
    let cursor: string | undefined;
    while (report.scanned < limit) {
      const page = await this.prisma.leagueProgress.findMany({
        orderBy: { userId: 'asc' },
        take: PAGE_SIZE,
        ...(cursor ? { cursor: { userId: cursor }, skip: 1 } : {}),
      });
      if (page.length === 0) break;
      cursor = page[page.length - 1]!.userId;
      for (const p of page) {
        report.scanned++;
        const leagueId = normalizeLeagueId(p.currentLeagueId);
        if (p.currentLeagueId !== leagueId) {
          await this.prisma.leagueProgress.update({
            where: { userId: p.userId },
            data: { currentLeagueId: leagueId },
          });
          report.fixedProgress++;
          continue;
        }
        if (p.currentWeekKey !== weekKey || !p.currentGroupId) continue;
        const ok = await this.prisma.leagueMembership.count({
          where: { groupId: p.currentGroupId, userId: p.userId },
        });
        if (!ok) {
          await this.ensureAssignment(p.userId);
          report.fixedProgress++;
        }
      }
      if (page.length < PAGE_SIZE) break;
    }
    log.info('league_repair_done', report);
    return report;
  }

  startingLeagueId(): LeagueId {
    return STARTING_LEAGUE_ID;
  }
}

function nextFreeDivision(groups: { division: number }[]): number {
  const used = new Set(groups.map((g) => g.division));
  let division = 1;
  while (used.has(division)) division++;
  return division;
}
