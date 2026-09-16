import { FieldPath, Query } from 'firebase-admin/firestore';
import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { authedCallable, HttpsError, num, obj } from './lib/callable';
import { db, IS_EMULATOR, now, REGION } from './lib/admin';
import { BatchWriter } from './lib/batchWriter';
import {
  LEAGUE_DEFINITIONS,
  LEAGUE_IDS,
  STARTING_LEAGUE_ID,
  leagueById,
  normalizeLeagueId,
} from './domain/model/leagues';
import {
  MAX_GROUP_SIZE,
  TARGET_GROUP_SIZE,
  needsRebalance,
  planGroupSizes,
  planRebalance,
  zonesForGroupSize,
} from './domain/model/leagueGroups';
import { rankMembers, resolveWeeklyOutcomes } from './domain/model/leagueRanking';
import {
  isValidWeekKey,
  nextWeekKey,
  previousWeekKey,
  weekKeyFor,
  weekWindow,
} from './domain/model/leagueWeek';
import type {
  AvatarId,
  GlobalRankingEntry,
  LeagueId,
  LeagueRankingMember,
  LeagueScreenSnapshot,
  PlayerProgress,
  Profile,
  WeeklyGroupStatus,
  WeeklyLeagueGroup,
  WeeklyLeagueMember,
} from './domain/model/types';

/**
 * Sistema de ligas semanais.
 *
 * Princípio absoluto: NENHUM usuário ativo pode ficar sem liga. Toda leitura da tela passa por
 * `ensureAssignment`, que detecta e conserta (liga faltando, semana antiga, grupo finalizado,
 * grupo inexistente, membro sumido) antes de responder. O cliente nunca escreve nada aqui.
 */

const GROUPS = 'weeklyLeagueGroups';
const PROGRESS = 'playerProgress';
const DEFINITIONS = 'leagueDefinitions';
const EVENTS = 'processedLeagueEvents';
const LOCKS = 'leagueProcessingLocks';
const HISTORY = 'leagueHistory';

/** Acima disso, redistribuir a liga inteira no meio da semana sairia caro demais (ver `assignToGroup`). */
const REBALANCE_MAX_MEMBERS = 5_000;
/** Limite de operações por batch do Firestore. */
const PAGE_SIZE = 300;
const LOCK_TTL_MS = 9 * 60_000;

// --- Ids e refs ----------------------------------------------------------------------------

function pad3(n: number): string {
  return String(n).padStart(3, '0');
}

/** `2026-W37__gold__001` — determinístico, o que torna a criação de grupos idempotente. */
export function groupIdFor(weekKey: string, leagueId: LeagueId, division: number): string {
  return `${weekKey}__${leagueId}__${pad3(division)}`;
}

const groupRef = (groupId: string) => db.doc(`${GROUPS}/${groupId}`);
const memberRef = (groupId: string, uid: string) => db.doc(`${GROUPS}/${groupId}/members/${uid}`);
const progressRef = (uid: string) => db.doc(`${PROGRESS}/${uid}`);
const historyRef = (uid: string, weekKey: string) => db.doc(`${HISTORY}/${uid}/weeks/${weekKey}`);

const ACTIVE_STATUSES: WeeklyGroupStatus[] = ['forming', 'active'];

// --- Defaults ------------------------------------------------------------------------------

export function defaultProgress(uid: string, weekKey: string): PlayerProgress {
  return {
    id: uid,
    uid,
    currentLeagueId: STARTING_LEAGUE_ID,
    currentDivision: 1,
    currentWeekKey: weekKey,
    currentLeagueGroupId: '',
    weeklyPoints: 0,
    seasonPoints: 0,
    lastWeeklyResult: null,
    lastWeeklyRank: null,
    lastProcessedWeekKey: null,
    lastActiveWeekKey: null,
    updatedAt: now(),
  };
}

interface MemberIdentity {
  nickname: string;
  avatarId: AvatarId;
  countryCode: string;
}

async function identityOf(uid: string): Promise<MemberIdentity> {
  const snap = await db.doc(`profiles/${uid}`).get();
  const p = snap.data() as Partial<Profile> | undefined;
  return {
    nickname: p?.nickname || 'Jogador',
    avatarId: (p?.avatarId as AvatarId) ?? 'joao',
    countryCode: p?.countryCode || 'BR',
  };
}

// --- Locks ---------------------------------------------------------------------------------

/**
 * Trava lógica por (operação + liga + semana). Evita que o fechamento semanal, o rebalanceamento e
 * um repair concorrente mexam nos mesmos grupos ao mesmo tempo. Locks vencidos são reaproveitados
 * para que uma Function morta no meio não trave o sistema para sempre.
 */
async function withLock<T>(lockId: string, run: () => Promise<T>): Promise<T | null> {
  const ref = db.doc(`${LOCKS}/${lockId}`);
  const token = `${now()}_${Math.random().toString(36).slice(2)}`;
  const acquired = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data() as { expiresAt?: number } | undefined;
    if (data && (data.expiresAt ?? 0) > now()) return false;
    tx.set(ref, { token, acquiredAt: now(), expiresAt: now() + LOCK_TTL_MS });
    return true;
  });
  if (!acquired) {
    logger.info('league lock ocupado', { lockId });
    return null;
  }
  try {
    return await run();
  } finally {
    await ref.delete().catch(() => undefined);
  }
}

// --- Leitura de grupos ---------------------------------------------------------------------

interface GroupDoc extends Omit<WeeklyLeagueGroup, 'id'> {
  id: string;
}

function toGroup(id: string, data: FirebaseFirestore.DocumentData): GroupDoc {
  return { ...(data as Omit<WeeklyLeagueGroup, 'id'>), id, groupId: id };
}

/** Todos os grupos da liga naquela semana, inclusive os já finalizados. */
async function listAllGroups(leagueId: LeagueId, weekKey: string): Promise<GroupDoc[]> {
  const snap = await db
    .collection(GROUPS)
    .where('leagueId', '==', leagueId)
    .where('weekKey', '==', weekKey)
    .get();
  return snap.docs.map((d) => toGroup(d.id, d.data())).sort((a, b) => a.division - b.division);
}

/** Só os grupos que ainda aceitam jogadores. */
async function listGroups(leagueId: LeagueId, weekKey: string): Promise<GroupDoc[]> {
  return (await listAllGroups(leagueId, weekKey)).filter((g) => ACTIVE_STATUSES.includes(g.status));
}

function groupPayload(
  leagueId: LeagueId,
  weekKey: string,
  division: number,
  memberCount: number,
  status: WeeklyGroupStatus,
): Omit<WeeklyLeagueGroup, 'id'> {
  const { startAt, endAt } = weekWindow(weekKey);
  const zones = zonesForGroupSize(memberCount);
  return {
    groupId: groupIdFor(weekKey, leagueId, division),
    leagueId,
    weekKey,
    division,
    status,
    memberCount,
    targetSize: TARGET_GROUP_SIZE,
    promotionCount: zones.promotionCount,
    relegationCount: zones.relegationCount,
    startAt,
    endAt,
    createdAt: now(),
    updatedAt: now(),
    finalizedAt: null,
  };
}

// --- Atribuição ----------------------------------------------------------------------------

export interface Assignment {
  progress: PlayerProgress;
  group: GroupDoc;
}

/**
 * Garante que `uid` tem liga, semana e grupo válidos AGORA. É o coração do "ninguém fica de fora":
 * qualquer inconsistência é detectada e corrigida aqui, sem erro para o usuário.
 */
export async function ensureAssignment(uid: string, atMs = now()): Promise<Assignment> {
  const weekKey = weekKeyFor(atMs);
  const snap = await progressRef(uid).get();
  const stored = snap.data() as Partial<PlayerProgress> | undefined;
  const leagueId = normalizeLeagueId(stored?.currentLeagueId);

  if (stored?.currentWeekKey === weekKey && stored.currentLeagueGroupId) {
    const [groupSnap, memberSnap] = await Promise.all([
      groupRef(stored.currentLeagueGroupId).get(),
      memberRef(stored.currentLeagueGroupId, uid).get(),
    ]);
    const group = groupSnap.exists ? toGroup(groupSnap.id, groupSnap.data()!) : null;
    const healthy =
      group &&
      memberSnap.exists &&
      group.weekKey === weekKey &&
      group.leagueId === leagueId &&
      ACTIVE_STATUSES.includes(group.status);
    if (healthy) {
      return { progress: { ...defaultProgress(uid, weekKey), ...stored, uid, id: uid }, group };
    }
  }

  return assignToGroup(uid, leagueId, weekKey, stored);
}

/**
 * Coloca o jogador no grupo com menos gente da sua liga (ou cria o primeiro) e, se a distribuição
 * ficou fora do plano, dispara o rebalanceamento.
 *
 * Nunca cria um grupo "sobrando" com 1 pessoa: enquanto o plano pedir a mesma quantidade de grupos,
 * o menor grupo absorve o novo jogador — mesmo que passe de 20, que é ALVO e não teto.
 */
async function assignToGroup(
  uid: string,
  leagueId: LeagueId,
  weekKey: string,
  stored: Partial<PlayerProgress> | undefined,
): Promise<Assignment> {
  const identity = await identityOf(uid);
  const all = await listAllGroups(leagueId, weekKey);
  const groups = all.filter((g) => ACTIVE_STATUSES.includes(g.status));
  const total = groups.reduce((acc, g) => acc + (g.memberCount ?? 0), 0) + 1;

  let target: GroupDoc;
  if (groups.length === 0) {
    // `all` (e não `groups`) para não reutilizar a divisão de um grupo já finalizado.
    target = await createGroup(leagueId, weekKey, nextFreeDivision(all));
  } else {
    const smallest = [...groups].sort(
      (a, b) => a.memberCount - b.memberCount || a.division - b.division,
    )[0]!;
    // O menor grupo absorve o novo jogador mesmo passando de 20 — 20 é ALVO, não teto — e o
    // rebalanceamento abaixo reparte quando o plano mudar. Abrir grupo aqui criaria um grupo de 1.
    //
    // A exceção é uma liga grande demais para redistribuir no meio da semana: aí não há
    // rebalanceamento para consertar depois, então o grupo novo é aberto na hora e vai enchendo
    // com quem chegar.
    const tooBigToRebalance = total > REBALANCE_MAX_MEMBERS;
    target =
      tooBigToRebalance && smallest.memberCount >= MAX_GROUP_SIZE
        ? await createGroup(leagueId, weekKey, nextFreeDivision(all))
        : smallest;
  }

  const progress = await joinGroup(uid, target, identity, stored);

  // Só rebalanceia quando a distribuição realmente saiu do plano — estabilidade vale mais do que
  // perfeição no meio da semana.
  const after = await listGroups(leagueId, weekKey);
  const sizes = after.map((g) => g.memberCount);
  const memberTotal = sizes.reduce((a, b) => a + b, 0);
  if (memberTotal <= REBALANCE_MAX_MEMBERS && needsRebalance(sizes, memberTotal)) {
    await rebalanceLeague(leagueId, weekKey);
    const fixed = await progressRef(uid).get();
    const data = fixed.data() as PlayerProgress | undefined;
    if (data?.currentLeagueGroupId) {
      const g = await groupRef(data.currentLeagueGroupId).get();
      if (g.exists) return { progress: { ...data, id: uid, uid }, group: toGroup(g.id, g.data()!) };
    }
  }

  const refreshed = await groupRef(target.groupId).get();
  return {
    progress,
    group: refreshed.exists ? toGroup(refreshed.id, refreshed.data()!) : target,
  };
}

function nextFreeDivision(groups: GroupDoc[]): number {
  const used = new Set(groups.map((g) => g.division));
  let division = 1;
  while (used.has(division)) division++;
  return division;
}

async function createGroup(
  leagueId: LeagueId,
  weekKey: string,
  division: number,
  status: WeeklyGroupStatus = 'active',
): Promise<GroupDoc> {
  const id = groupIdFor(weekKey, leagueId, division);
  const ref = groupRef(id);
  const created = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) return toGroup(snap.id, snap.data()!);
    const payload = groupPayload(leagueId, weekKey, division, 0, status);
    tx.set(ref, payload);
    return { ...payload, id };
  });
  return created;
}

/** Insere o jogador no grupo e sincroniza `playerProgress`. Idempotente e seguro sob concorrência. */
async function joinGroup(
  uid: string,
  group: GroupDoc,
  identity: MemberIdentity,
  stored: Partial<PlayerProgress> | undefined,
): Promise<PlayerProgress> {
  const gRef = groupRef(group.groupId);
  const mRef = memberRef(group.groupId, uid);
  const pRef = progressRef(uid);

  return db.runTransaction(async (tx) => {
    const [gSnap, mSnap, pSnap] = await Promise.all([tx.get(gRef), tx.get(mRef), tx.get(pRef)]);
    if (!gSnap.exists) throw new HttpsError('aborted', 'Grupo sumiu durante a entrada.');
    const groupData = toGroup(gSnap.id, gSnap.data()!);
    const previous = (pSnap.data() as Partial<PlayerProgress> | undefined) ?? stored;

    if (!mSnap.exists) {
      const member: Omit<WeeklyLeagueMember, 'id'> = {
        uid,
        nickname: identity.nickname,
        avatarId: identity.avatarId,
        countryCode: identity.countryCode,
        weeklyPoints: 0,
        wins: 0,
        matches: 0,
        tiebreakScore: 0,
        currentRank: groupData.memberCount + 1,
        previousRank: 0,
        joinedAt: now(),
        updatedAt: now(),
      };
      tx.set(mRef, member);
      const memberCount = groupData.memberCount + 1;
      const zones = zonesForGroupSize(memberCount);
      tx.update(gRef, {
        memberCount,
        promotionCount: zones.promotionCount,
        relegationCount: zones.relegationCount,
        status: groupData.status === 'forming' ? 'active' : groupData.status,
        updatedAt: now(),
      });
    }

    const progress: PlayerProgress = {
      ...defaultProgress(uid, groupData.weekKey),
      ...previous,
      id: uid,
      uid,
      currentLeagueId: groupData.leagueId,
      currentDivision: groupData.division,
      currentWeekKey: groupData.weekKey,
      currentLeagueGroupId: groupData.groupId,
      // Semana nova zera a pontuação semanal (a antiga já virou histórico na finalização).
      weeklyPoints:
        previous?.currentWeekKey === groupData.weekKey ? (previous.weeklyPoints ?? 0) : 0,
      updatedAt: now(),
    };
    const { id: _id, ...data } = progress;
    tx.set(pRef, data, { merge: true });
    return progress;
  });
}

/**
 * Tira o jogador do grupo da semana (exclusão de conta). Sem isso o ranking continuaria exibindo
 * um jogador que não existe mais e a contagem do grupo ficaria errada.
 */
export async function leaveCurrentLeagueGroup(uid: string): Promise<void> {
  const snap = await progressRef(uid).get();
  const groupId = (snap.data() as Partial<PlayerProgress> | undefined)?.currentLeagueGroupId;
  if (!groupId) return;
  await db
    .runTransaction(async (tx) => {
      const [gSnap, mSnap] = await Promise.all([
        tx.get(groupRef(groupId)),
        tx.get(memberRef(groupId, uid)),
      ]);
      if (!mSnap.exists) return;
      tx.delete(memberRef(groupId, uid));
      if (!gSnap.exists) return;
      const memberCount = Math.max(0, (gSnap.data() as WeeklyLeagueGroup).memberCount - 1);
      const zones = zonesForGroupSize(memberCount);
      tx.update(groupRef(groupId), {
        memberCount,
        promotionCount: zones.promotionCount,
        relegationCount: zones.relegationCount,
        updatedAt: now(),
      });
    })
    .catch((e: Error) => logger.warn('falha ao sair do grupo', { uid, error: e.message }));
}

// --- Rebalanceamento -----------------------------------------------------------------------

/**
 * Redistribui uma liga inteira numa semana, mexendo no mínimo de jogadores possível
 * (ver `planRebalance`). Idempotente: rodar duas vezes não move ninguém na segunda.
 */
export async function rebalanceLeague(
  leagueId: LeagueId,
  weekKey: string,
): Promise<{ groups: number; moved: number } | null> {
  return withLock(`rebalance__${weekKey}__${leagueId}`, async () => {
    const groups = await listGroups(leagueId, weekKey);
    const loaded = await Promise.all(
      groups.map(async (g) => ({
        group: g,
        members: (await db.collection(`${GROUPS}/${g.groupId}/members`).get()).docs.map((d) => ({
          uid: d.id,
          data: d.data() as Omit<WeeklyLeagueMember, 'id'>,
        })),
      })),
    );

    const memberData = new Map<string, Omit<WeeklyLeagueMember, 'id'>>();
    for (const g of loaded) for (const m of g.members) memberData.set(m.uid, m.data);
    const allMemberIds = [...memberData.keys()].sort();
    if (allMemberIds.length === 0) return { groups: 0, moved: 0 };

    const taken = new Set(groups.map((g) => g.division));
    const nextGroupId = () => {
      let division = 1;
      while (taken.has(division)) division++;
      taken.add(division);
      return groupIdFor(weekKey, leagueId, division);
    };

    const plan = planRebalance(
      loaded.map((g) => ({ groupId: g.group.groupId, memberIds: g.members.map((m) => m.uid) })),
      allMemberIds,
      nextGroupId,
    );

    const divisionOf = new Map(groups.map((g) => [g.groupId, g.division]));
    const writer = new BatchWriter();
    plan.groups.forEach((target, index) => {
      const division = divisionOf.get(target.groupId) ?? divisionFromId(target.groupId, index + 1);
      const payload = groupPayload(leagueId, weekKey, division, target.memberIds.length, 'active');
      writer.set(groupRef(target.groupId), { ...payload, groupId: target.groupId }, true);
      for (const uid of target.memberIds) {
        if (plan.moves[uid] !== target.groupId) continue;
        const data = memberData.get(uid)!;
        writer.set(memberRef(target.groupId, uid), { ...data, updatedAt: now() });
        writer.update(progressRef(uid), {
          currentLeagueGroupId: target.groupId,
          currentDivision: division,
          updatedAt: now(),
        });
      }
    });

    // Remove os membros dos grupos de origem só depois de gravá-los no destino.
    for (const g of loaded) {
      const keep = new Set(plan.groups.find((t) => t.groupId === g.group.groupId)?.memberIds ?? []);
      for (const m of g.members)
        if (!keep.has(m.uid)) writer.delete(memberRef(g.group.groupId, m.uid));
    }
    for (const id of plan.removedGroupIds) writer.delete(groupRef(id));

    await writer.flush();
    for (const target of plan.groups) await recomputeRanking(target.groupId);

    logger.info('liga rebalanceada', {
      leagueId,
      weekKey,
      groups: plan.groups.length,
      moved: Object.keys(plan.moves).length,
    });
    return { groups: plan.groups.length, moved: Object.keys(plan.moves).length };
  });
}

function divisionFromId(groupId: string, fallback: number): number {
  const parsed = Number(groupId.split('__')[2]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// --- Pontuação -----------------------------------------------------------------------------

export type LeaguePointsEvent = 'match_win' | 'match_loss' | 'bonus';

export interface AddPointsInput {
  uid: string;
  matchId: string;
  eventType: LeaguePointsEvent;
  points: number;
  won: boolean;
}

/**
 * Soma pontos da semana. A chave de idempotência é `matchId + uid + eventType`, então reprocessar
 * a mesma partida nunca pontua duas vezes.
 */
export async function addWeeklyLeaguePoints(
  input: AddPointsInput,
): Promise<{ applied: boolean; weeklyPoints: number }> {
  const points = Math.max(0, Math.round(input.points));
  const assignment = await ensureAssignment(input.uid);
  const eventId = `${input.matchId}__${input.uid}__${input.eventType}`.replace(
    /[^A-Za-z0-9_-]/g,
    '_',
  );
  const eventRef = db.doc(`${EVENTS}/${eventId}`);
  const mRef = memberRef(assignment.group.groupId, input.uid);
  const pRef = progressRef(input.uid);
  const weekKey = assignment.group.weekKey;

  return db.runTransaction(async (tx) => {
    const [eventSnap, mSnap, pSnap] = await Promise.all([
      tx.get(eventRef),
      tx.get(mRef),
      tx.get(pRef),
    ]);
    const progress = pSnap.data() as PlayerProgress | undefined;
    if (eventSnap.exists) {
      return { applied: false, weeklyPoints: progress?.weeklyPoints ?? 0 };
    }
    if (!mSnap.exists) throw new HttpsError('aborted', 'Membro do grupo não encontrado.');

    const member = mSnap.data() as Omit<WeeklyLeagueMember, 'id'>;
    const weeklyPoints = (member.weeklyPoints ?? 0) + points;

    tx.set(eventRef, {
      uid: input.uid,
      matchId: input.matchId,
      eventType: input.eventType,
      points,
      weekKey,
      groupId: assignment.group.groupId,
      processedAt: now(),
    });
    tx.update(mRef, {
      weeklyPoints,
      wins: (member.wins ?? 0) + (input.won ? 1 : 0),
      matches: (member.matches ?? 0) + 1,
      tiebreakScore: (member.tiebreakScore ?? 0) + points,
      updatedAt: now(),
    });
    tx.set(
      pRef,
      {
        weeklyPoints: (progress?.weeklyPoints ?? 0) + points,
        seasonPoints: (progress?.seasonPoints ?? 0) + points,
        lastActiveWeekKey: weekKey,
        updatedAt: now(),
      },
      { merge: true },
    );
    return { applied: true, weeklyPoints };
  });
}

// --- Ranking -------------------------------------------------------------------------------

/** Recalcula e grava `currentRank`/`previousRank` do grupo. O cliente nunca decide posição. */
export async function recomputeWeeklyLeagueRanking(groupId: string): Promise<number> {
  return recomputeRanking(groupId);
}

async function recomputeRanking(groupId: string): Promise<number> {
  const snap = await db.collection(`${GROUPS}/${groupId}/members`).get();
  if (snap.empty) return 0;
  const members = snap.docs.map((d) => ({
    ...(d.data() as Omit<WeeklyLeagueMember, 'id'>),
    uid: d.id, // o id do documento manda: um `uid` gravado errado não pode desviar o ranking
  }));
  const ranked = rankMembers(members);
  const writer = new BatchWriter();
  for (const m of ranked) {
    if (m.currentRank === m.rank) continue;
    writer.update(memberRef(groupId, m.uid), {
      currentRank: m.rank,
      previousRank: m.currentRank || m.rank,
      updatedAt: now(),
    });
  }
  await writer.flush();
  return ranked.length;
}

// --- Snapshot da tela ----------------------------------------------------------------------

async function buildSnapshot(uid: string): Promise<LeagueScreenSnapshot> {
  const { group } = await ensureAssignment(uid);
  const progressSnap = await progressRef(uid).get();
  const progress = progressSnap.data() as PlayerProgress | undefined;

  const membersSnap = await db.collection(`${GROUPS}/${group.groupId}/members`).get();
  const ranked = rankMembers(
    membersSnap.docs.map((d) => ({ ...(d.data() as Omit<WeeklyLeagueMember, 'id'>), uid: d.id })),
  );
  const zones = zonesForGroupSize(ranked.length);
  const def = leagueById(group.leagueId);
  const { startAt, endAt } = weekWindow(group.weekKey);

  const members: LeagueRankingMember[] = ranked.map((m) => ({
    uid: m.uid,
    nickname: m.nickname || 'Jogador',
    avatarId: (m.avatarId as AvatarId) ?? 'joao',
    countryCode: m.countryCode || 'BR',
    weeklyPoints: m.weeklyPoints ?? 0,
    wins: m.wins ?? 0,
    rank: m.rank,
    tiebreakScore: m.tiebreakScore ?? 0,
    joinedAt: m.joinedAt ?? 0,
    isMe: m.uid === uid,
  }));
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
    groupId: group.groupId,
    groupSize: ranked.length,
    promotionCount: zones.promotionCount,
    relegationCount: zones.relegationCount,
    promotionStart: zones.promotionStart,
    promotionEnd: zones.promotionEnd,
    relegationStart: zones.relegationStart,
    relegationEnd: zones.relegationEnd,
    userRank: me?.rank ?? 0,
    userWeeklyPoints: me?.weeklyPoints ?? 0,
    members,
    lastWeeklyResult: progress?.lastWeeklyResult ?? null,
    lastWeeklyRank: progress?.lastWeeklyRank ?? null,
  };
}

// --- Fechamento semanal --------------------------------------------------------------------

export interface FinalizeReport {
  weekKey: string;
  groups: number;
  players: number;
  promoted: number;
  relegated: number;
  stayed: number;
  skipped: number;
}

/**
 * Fecha uma semana: congela o ranking, grava o histórico, move os jogadores de liga e zera os
 * pontos. Idempotente em dois níveis — o grupo vira `finalized` e cada jogador guarda
 * `lastProcessedWeekKey`, então rodar de novo (ou retomar após falha) não duplica nada.
 */
export async function finalizeWeek(weekKey: string): Promise<FinalizeReport> {
  const report: FinalizeReport = {
    weekKey,
    groups: 0,
    players: 0,
    promoted: 0,
    relegated: 0,
    stayed: 0,
    skipped: 0,
  };

  let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  for (;;) {
    let q: Query = db
      .collection(GROUPS)
      .where('weekKey', '==', weekKey)
      .orderBy(FieldPath.documentId())
      .limit(PAGE_SIZE);
    if (cursor) q = q.startAfter(cursor.id);
    const page = await q.get();
    if (page.empty) break;
    cursor = page.docs[page.docs.length - 1]!;

    for (const doc of page.docs) {
      const group = toGroup(doc.id, doc.data());
      if (group.status === 'finalized') continue;
      const done = await finalizeGroup(group, report);
      if (done) report.groups++;
    }
    if (page.size < PAGE_SIZE) break;
  }

  logger.info('semana finalizada', report);
  return report;
}

async function finalizeGroup(group: GroupDoc, report: FinalizeReport): Promise<boolean> {
  const gRef = groupRef(group.groupId);
  await gRef.set({ status: 'finalizing', updatedAt: now() }, { merge: true });

  const membersSnap = await db.collection(`${GROUPS}/${group.groupId}/members`).get();
  const members = membersSnap.docs.map((d) => ({
    ...(d.data() as Omit<WeeklyLeagueMember, 'id'>),
    uid: d.id, // o id do documento manda: um `uid` gravado errado não pode desviar o ranking
  }));
  const leagueId = normalizeLeagueId(group.leagueId);
  const outcomes = resolveWeeklyOutcomes(leagueId, members);
  const processedAt = now();

  for (const outcome of outcomes) {
    const applied = await db.runTransaction(async (tx) => {
      const pRef = progressRef(outcome.uid);
      const hRef = historyRef(outcome.uid, group.weekKey);
      const [pSnap, hSnap] = await Promise.all([tx.get(pRef), tx.get(hRef)]);
      const progress = pSnap.data() as Partial<PlayerProgress> | undefined;
      // Já processado nesta semana (retentativa ou execução concorrente): não repete nada.
      if (hSnap.exists || progress?.lastProcessedWeekKey === group.weekKey) return false;

      tx.set(hRef, {
        weekKey: group.weekKey,
        leagueId,
        division: group.division,
        groupId: group.groupId,
        groupSize: outcomes.length,
        finalRank: outcome.finalRank,
        weeklyPoints: outcome.weeklyPoints,
        result: outcome.result,
        previousLeagueId: outcome.previousLeagueId,
        nextLeagueId: outcome.nextLeagueId,
        processedAt,
      });
      tx.set(
        pRef,
        {
          uid: outcome.uid,
          currentLeagueId: outcome.nextLeagueId,
          weeklyPoints: 0,
          lastWeeklyResult: outcome.result,
          lastWeeklyRank: outcome.finalRank,
          lastProcessedWeekKey: group.weekKey,
          updatedAt: processedAt,
        },
        { merge: true },
      );
      // Espelho para as telas que mostram a liga sem abrir a aba Ligas.
      tx.set(
        db.doc(`profiles/${outcome.uid}`),
        { leagueId: outcome.nextLeagueId, updatedAt: processedAt },
        { merge: true },
      );
      tx.set(
        memberRef(group.groupId, outcome.uid),
        { currentRank: outcome.finalRank, updatedAt: processedAt },
        { merge: true },
      );
      return true;
    });

    if (!applied) {
      report.skipped++;
      continue;
    }
    report.players++;
    if (outcome.result === 'promoted') report.promoted++;
    else if (outcome.result === 'relegated') report.relegated++;
    else report.stayed++;
  }

  await gRef.set(
    { status: 'finalized', finalizedAt: processedAt, updatedAt: processedAt },
    { merge: true },
  );
  return true;
}

/**
 * Monta os grupos da próxima semana com quem jogou na semana que acabou.
 *
 * Contas dormentes (sem pontos na semana) NÃO são pré-alocadas — a liga delas fica guardada em
 * `playerProgress` e `ensureAssignment` as coloca num grupo assim que abrirem o app. É isso que
 * mantém o processo viável com muitos usuários sem violar a regra de ninguém ficar de fora.
 */
export async function prepareNextWeekGroups(
  finishedWeekKey: string,
  targetWeekKey = nextWeekKey(finishedWeekKey),
): Promise<{ weekKey: string; leagues: number; players: number }> {
  let leagues = 0;
  let players = 0;

  for (const leagueId of LEAGUE_IDS) {
    const base = db
      .collection(PROGRESS)
      .where('currentLeagueId', '==', leagueId)
      .where('lastProcessedWeekKey', '==', finishedWeekKey)
      .where('lastActiveWeekKey', '==', finishedWeekKey);

    const count = (await base.count().get()).data().count;
    if (count === 0) continue;
    leagues++;

    const sizes = planGroupSizes(count);
    let division = 0;
    let remaining = 0;
    let groupId = '';
    let placed = 0;
    const writer = new BatchWriter();
    let cursor: string | null = null;

    for (;;) {
      let q: Query = base.orderBy(FieldPath.documentId()).limit(PAGE_SIZE);
      if (cursor) q = q.startAfter(cursor);
      const page = await q.get();
      if (page.empty) break;
      cursor = page.docs[page.docs.length - 1]!.id;

      for (const doc of page.docs) {
        if (remaining === 0) {
          division++;
          remaining = sizes[division - 1] ?? sizes[sizes.length - 1] ?? 1;
          groupId = groupIdFor(targetWeekKey, leagueId, division);
          writer.set(
            groupRef(groupId),
            { ...groupPayload(leagueId, targetWeekKey, division, remaining, 'forming'), groupId },
            true,
          );
        }
        const identity = doc.data() as Partial<PlayerProgress>;
        writer.set(memberRef(groupId, doc.id), {
          uid: doc.id,
          nickname: '',
          avatarId: 'joao',
          countryCode: 'BR',
          weeklyPoints: 0,
          wins: 0,
          matches: 0,
          tiebreakScore: 0,
          currentRank: 0,
          previousRank: identity.lastWeeklyRank ?? 0,
          joinedAt: now(),
          updatedAt: now(),
        });
        writer.update(progressRef(doc.id), {
          currentWeekKey: targetWeekKey,
          currentLeagueGroupId: groupId,
          currentDivision: division,
          weeklyPoints: 0,
          updatedAt: now(),
        });
        remaining--;
        placed++;
      }
      if (page.size < PAGE_SIZE) break;
    }

    await writer.flush();
    players += placed;
  }

  // Apelido/avatar/bandeira são preenchidos quando o jogador abre a tela (ver `refreshIdentity`),
  // evitando ler `profiles` de todo mundo na virada.
  logger.info('próxima semana preparada', { weekKey: targetWeekKey, leagues, players });
  return { weekKey: targetWeekKey, leagues, players };
}

/** Mantém apelido/avatar/bandeira do membro em dia com o perfil (barato, roda na abertura da tela). */
/** Copia apelido/avatar/país atuais do perfil para a linha do jogador no grupo da semana. */
export async function refreshIdentity(uid: string, groupId: string): Promise<void> {
  const [identity, snap] = await Promise.all([identityOf(uid), memberRef(groupId, uid).get()]);
  const member = snap.data() as Partial<WeeklyLeagueMember> | undefined;
  if (!member) return;
  if (
    member.nickname === identity.nickname &&
    member.avatarId === identity.avatarId &&
    member.countryCode === identity.countryCode
  ) {
    return;
  }
  await memberRef(groupId, uid).set({ ...identity, updatedAt: now() }, { merge: true });
}

// --- Repair --------------------------------------------------------------------------------

export interface RepairReport {
  scanned: number;
  fixedProgress: number;
  fixedGroups: number;
  fixedCounts: number;
  removedDuplicates: number;
}

/**
 * Varredura administrativa: conserta contagem de membros errada, jogador em dois grupos, grupo
 * inexistente, semana antiga e liga inválida. Só o repair faz full scan — o caminho normal sempre
 * consulta por (liga + semana).
 */
export async function repairLeagueSystem(limit = 5_000): Promise<RepairReport> {
  const report: RepairReport = {
    scanned: 0,
    fixedProgress: 0,
    fixedGroups: 0,
    fixedCounts: 0,
    removedDuplicates: 0,
  };
  const weekKey = weekKeyFor(now());

  const groupsSnap = await db.collection(GROUPS).where('weekKey', '==', weekKey).get();

  // 1. Jogadores em dois grupos ao mesmo tempo. Vem ANTES da contagem, senão consertaríamos o
  //    memberCount de um grupo que ainda vai perder o membro duplicado.
  const seen = new Map<string, string>();
  for (const doc of groupsSnap.docs) {
    const members = await db.collection(`${GROUPS}/${doc.id}/members`).get();
    for (const m of members.docs) {
      const other = seen.get(m.id);
      if (!other) {
        seen.set(m.id, doc.id);
        continue;
      }
      // Mantém o grupo apontado pelo progresso; o outro vínculo é lixo.
      const progress = (await progressRef(m.id).get()).data() as PlayerProgress | undefined;
      const keep = progress?.currentLeagueGroupId === doc.id ? doc.id : other;
      const drop = keep === doc.id ? other : doc.id;
      await memberRef(drop, m.id).delete();
      seen.set(m.id, keep);
      report.removedDuplicates++;
    }
  }

  // 2. Contagem de membros de cada grupo, e remoção dos que ficaram vazios.
  for (const doc of groupsSnap.docs) {
    const group = toGroup(doc.id, doc.data());
    const real = (await db.collection(`${GROUPS}/${group.groupId}/members`).count().get()).data()
      .count;
    if (real === 0 && group.status !== 'finalized') {
      await doc.ref.delete();
      report.fixedGroups++;
      continue;
    }
    if (real !== group.memberCount) {
      const zones = zonesForGroupSize(real);
      await doc.ref.set(
        {
          memberCount: real,
          promotionCount: zones.promotionCount,
          relegationCount: zones.relegationCount,
          updatedAt: now(),
        },
        { merge: true },
      );
      report.fixedCounts++;
    }
  }

  // 3. Progresso inconsistente.
  let cursor: string | null = null;
  while (report.scanned < limit) {
    let q: Query = db.collection(PROGRESS).orderBy(FieldPath.documentId()).limit(PAGE_SIZE);
    if (cursor) q = q.startAfter(cursor);
    const page = await q.get();
    if (page.empty) break;
    cursor = page.docs[page.docs.length - 1]!.id;

    for (const doc of page.docs) {
      report.scanned++;
      const p = doc.data() as Partial<PlayerProgress>;
      const leagueId = normalizeLeagueId(p.currentLeagueId);
      const staleWeek = p.currentWeekKey !== weekKey;
      const brokenGroup = !p.currentLeagueGroupId || seen.get(doc.id) !== p.currentLeagueGroupId;
      // Semana antiga não é defeito: só vira problema quando o jogador volta (ensureAssignment
      // resolve na hora). Aqui consertamos apenas o que quebraria a tela do jogador ativo.
      if (p.currentLeagueId !== leagueId) {
        await doc.ref.set({ currentLeagueId: leagueId, updatedAt: now() }, { merge: true });
        report.fixedProgress++;
      } else if (!staleWeek && brokenGroup) {
        await ensureAssignment(doc.id);
        report.fixedProgress++;
      }
    }
    if (page.size < PAGE_SIZE) break;
  }

  logger.info('repair concluído', report);
  return report;
}

// --- Seed ----------------------------------------------------------------------------------

/** Grava as 20 ligas em `leagueDefinitions`. Idempotente: rodar 2x dá o mesmo resultado. */
export async function seedLeagueDefinitionsInternal(): Promise<number> {
  const writer = new BatchWriter();
  for (const league of LEAGUE_DEFINITIONS) {
    const { id, ...data } = league;
    writer.set(db.doc(`${DEFINITIONS}/${id}`), { ...data, id, updatedAt: now() }, true);
  }
  await writer.flush();
  return LEAGUE_DEFINITIONS.length;
}

// --- Callables -----------------------------------------------------------------------------

export const bootstrapLeagueSystemForUser = authedCallable<
  Record<string, never>,
  { leagueId: LeagueId; weekKey: string; groupId: string; division: number }
>(async ({ uid }) => {
  const { group } = await ensureAssignment(uid);
  await refreshIdentity(uid, group.groupId).catch(() => undefined);
  return {
    leagueId: group.leagueId,
    weekKey: group.weekKey,
    groupId: group.groupId,
    division: group.division,
  };
});

export const ensureUserLeagueAssignment = bootstrapLeagueSystemForUser;

export const getLeagueScreenSnapshot = authedCallable<Record<string, never>, LeagueScreenSnapshot>(
  async ({ uid }) => {
    const { group } = await ensureAssignment(uid);
    await refreshIdentity(uid, group.groupId).catch(() => undefined);
    return buildSnapshot(uid);
  },
);

export const getGlobalLeagueRanking = authedCallable<
  { limit?: number },
  { entries: GlobalRankingEntry[] }
>(
  async ({ uid, data }) => {
    const max = Math.min(Math.max(data.limit ?? 50, 1), 100);
    const snap = await db
      .collection(PROGRESS)
      .orderBy('seasonPoints', 'desc')
      .orderBy(FieldPath.documentId())
      .limit(max)
      .get();
    if (snap.empty) return { entries: [] };
    const profiles = await db.getAll(...snap.docs.map((d) => db.doc(`profiles/${d.id}`)));
    const byId = new Map(profiles.map((p) => [p.id, p.data() as Partial<Profile> | undefined]));
    const entries: GlobalRankingEntry[] = snap.docs.map((doc, i) => {
      const progress = doc.data() as Partial<PlayerProgress>;
      const profile = byId.get(doc.id);
      return {
        uid: doc.id,
        rank: i + 1,
        nickname: profile?.nickname || 'Jogador',
        avatarId: (profile?.avatarId as AvatarId) ?? 'joao',
        countryCode: profile?.countryCode || 'BR',
        leagueId: normalizeLeagueId(progress.currentLeagueId),
        seasonPoints: progress.seasonPoints ?? 0,
        isMe: doc.id === uid,
      };
    });
    return { entries };
  },
  (d) => {
    const o = obj(d ?? {}, 'payload');
    return { limit: o.limit === undefined ? undefined : num(o.limit, 'limit') };
  },
);

// --- Admin ---------------------------------------------------------------------------------

function assertAdmin(req: { get(name: string): string | undefined }): void {
  const secret = process.env.SEED_SECRET;
  if (IS_EMULATOR) return;
  if (!secret || req.get('x-seed-secret') !== secret) {
    throw new HttpsError('permission-denied', 'forbidden');
  }
}

/**
 * Operações administrativas do sistema de ligas. Mesmo segredo do `seedCatalog`.
 * `?op=seed|repair|finalize|prepare|rebalance|rank`.
 */
export const leagueAdmin = onRequest({ region: REGION, timeoutSeconds: 540 }, async (req, res) => {
  try {
    assertAdmin(req);
  } catch {
    res.status(403).send('forbidden');
    return;
  }
  const op = String(req.query.op ?? 'seed');
  const weekKeyParam = typeof req.query.weekKey === 'string' ? req.query.weekKey : undefined;
  const weekKey = weekKeyParam && isValidWeekKey(weekKeyParam) ? weekKeyParam : weekKeyFor(now());

  try {
    switch (op) {
      case 'seed':
        res.json({ ok: true, leagues: await seedLeagueDefinitionsInternal() });
        return;
      case 'repair':
        res.json({ ok: true, report: await repairLeagueSystem() });
        return;
      case 'finalize':
        res.json({ ok: true, report: await finalizeWeek(weekKey) });
        return;
      case 'prepare':
        res.json({ ok: true, report: await prepareNextWeekGroups(weekKey) });
        return;
      case 'rebalance': {
        const leagueId = normalizeLeagueId(req.query.leagueId);
        res.json({ ok: true, report: await rebalanceLeague(leagueId, weekKey) });
        return;
      }
      case 'rank': {
        const groupId = String(req.query.groupId ?? '');
        if (!groupId) {
          res.status(400).json({ ok: false, error: 'groupId obrigatório' });
          return;
        }
        res.json({ ok: true, members: await recomputeWeeklyLeagueRanking(groupId) });
        return;
      }
      default:
        res.status(400).json({ ok: false, error: `op desconhecida: ${op}` });
    }
  } catch (e) {
    logger.error('leagueAdmin falhou', { op, error: (e as Error).message });
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

// --- Agendadas -----------------------------------------------------------------------------

/**
 * Virada da semana: segunda-feira 00:05 em São Paulo. Fecha a semana que acabou e já monta os
 * grupos da nova. Como cada etapa é idempotente, uma execução interrompida pode ser repetida
 * (manualmente via `leagueAdmin?op=finalize`) sem estragar nada.
 */
export const finalizeWeeklyLeagues = onSchedule(
  { region: REGION, schedule: '5 0 * * 1', timeZone: 'America/Sao_Paulo', timeoutSeconds: 540 },
  async () => {
    const finished = previousWeekKey(weekKeyFor(now()));
    await withLock(`finalize__${finished}`, async () => {
      await seedLeagueDefinitionsInternal();
      const report = await finalizeWeek(finished);
      const prepared = await prepareNextWeekGroups(finished);
      logger.info('virada semanal concluída', { report, prepared });
    });
  },
);

/**
 * Recalcula as posições gravadas dos grupos ativos uma vez por dia. A tela sempre ordena com o
 * mesmo comparador (domínio compartilhado), então isto serve para a seta de "subiu/desceu" e para
 * deixar o dado persistido coerente — não para a exibição em si.
 */
export const refreshLeagueRankings = onSchedule(
  { region: REGION, schedule: '0 3 * * *', timeZone: 'America/Sao_Paulo', timeoutSeconds: 540 },
  async () => {
    const weekKey = weekKeyFor(now());
    const snap = await db.collection(GROUPS).where('weekKey', '==', weekKey).get();
    for (const doc of snap.docs) {
      if (!ACTIVE_STATUSES.includes((doc.data() as WeeklyLeagueGroup).status)) continue;
      await recomputeRanking(doc.id).catch((e) =>
        logger.warn('falha ao recalcular ranking', { groupId: doc.id, error: e.message }),
      );
    }
  },
);
