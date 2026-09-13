/**
 * Balanceamento dos grupos semanais (puro, sem Firebase — roda igual no app e nas Functions).
 *
 * Regra absoluta: 20 é ALVO, não teto. Nenhum jogador pode ficar sem grupo. Um grupo pode passar
 * de 20 durante a semana; a redistribuição acontece quando ela vale a pena (ver `planGroupSizes`).
 */

export const TARGET_GROUP_SIZE = 20;
export const MIN_GROUP_SIZE = 15;

/**
 * Teto de tolerância para um grupo em andamento. Acima disso o sistema avalia rebalanceamento —
 * abaixo, prefere estabilidade (mover jogador no meio da semana prejudica a competição).
 */
export const MAX_GROUP_SIZE = 29;

export interface GroupZones {
  groupSize: number;
  promotionCount: number;
  relegationCount: number;
  /** 1-based, inclusivo. 0 quando a zona não existe. */
  promotionStart: number;
  promotionEnd: number;
  relegationStart: number;
  relegationEnd: number;
}

/**
 * Quantos jogadores sobem/descem por tamanho de grupo (regra adaptativa da spec).
 * As zonas NUNCA se sobrepõem: em grupos pequenos elas são reduzidas até caberem.
 */
export function baseZoneCount(groupSize: number): number {
  if (groupSize >= MIN_GROUP_SIZE) return 5;
  if (groupSize >= 10) return 3;
  if (groupSize >= 5) return 2;
  return 1;
}

export function zonesForGroupSize(groupSize: number): GroupZones {
  const size = Math.max(0, Math.floor(groupSize));
  if (size === 0) {
    return {
      groupSize: 0,
      promotionCount: 0,
      relegationCount: 0,
      promotionStart: 0,
      promotionEnd: 0,
      relegationStart: 0,
      relegationEnd: 0,
    };
  }
  // Metade do grupo é o máximo que cada zona pode ocupar sem invadir a outra.
  const maxZone = Math.floor(size / 2);
  const count = Math.min(baseZoneCount(size), maxZone);
  return {
    groupSize: size,
    promotionCount: count,
    relegationCount: count,
    promotionStart: count > 0 ? 1 : 0,
    promotionEnd: count,
    relegationStart: count > 0 ? size - count + 1 : 0,
    relegationEnd: count > 0 ? size : 0,
  };
}

/** Divide `total` em `groups` partes com diferença máxima de 1 jogador, maiores primeiro. */
export function splitEvenly(total: number, groups: number): number[] {
  if (groups <= 0 || total <= 0) return [];
  const base = Math.floor(total / groups);
  const remainder = total % groups;
  return Array.from({ length: groups }, (_, i) => base + (i < remainder ? 1 : 0));
}

function meanDistanceToTarget(sizes: number[]): number {
  if (sizes.length === 0) return Number.POSITIVE_INFINITY;
  const sum = sizes.reduce((acc, s) => acc + Math.abs(s - TARGET_GROUP_SIZE), 0);
  return sum / sizes.length;
}

/**
 * Melhor configuração de grupos para `total` jogadores de uma liga numa semana.
 *
 * Critérios, em ordem:
 *  1. ninguém fica de fora (a soma é sempre `total`);
 *  2. nenhum grupo abaixo de MIN_GROUP_SIZE — exceto quando só existe um grupo;
 *  3. menor distância média para TARGET_GROUP_SIZE;
 *  4. menor diferença entre o maior e o menor grupo;
 *  5. menos grupos (menos fragmentação).
 *
 * Exemplos da spec: 21 -> [21] (nunca 20 + 1), 30 -> [15,15], 45 -> [23,22], 61 -> [21,20,20].
 */
export function planGroupSizes(total: number): number[] {
  const n = Math.max(0, Math.floor(total));
  if (n === 0) return [];

  let best: number[] = [n];
  const maxGroups = Math.max(1, Math.floor(n / MIN_GROUP_SIZE));
  for (let groups = 2; groups <= maxGroups; groups++) {
    const sizes = splitEvenly(n, groups);
    if (sizes[sizes.length - 1]! < MIN_GROUP_SIZE) continue;
    if (isBetterPlan(sizes, best)) best = sizes;
  }
  return best;
}

function isBetterPlan(candidate: number[], current: number[]): boolean {
  const dc = meanDistanceToTarget(candidate);
  const dk = meanDistanceToTarget(current);
  if (dc !== dk) return dc < dk;
  const spreadC = candidate[0]! - candidate[candidate.length - 1]!;
  const spreadK = current[0]! - current[current.length - 1]!;
  if (spreadC !== spreadK) return spreadC < spreadK;
  return candidate.length < current.length;
}

/**
 * O plano de `total` jogadores continua compatível com os grupos que já existem?
 * Serve para decidir se vale rebalancear no meio da semana: enquanto a quantidade de grupos
 * desejada não muda e nenhum grupo estourou MAX_GROUP_SIZE, preferimos estabilidade.
 */
export function needsRebalance(currentSizes: number[], total: number): boolean {
  if (currentSizes.length === 0) return total > 0;
  const planned = planGroupSizes(total);
  if (planned.length !== currentSizes.length) return true;
  if (currentSizes.some((s) => s > MAX_GROUP_SIZE || s === 0)) return true;
  // Grupos desiguais (ex.: [29, 1], herdado de uma falha) não podem ficar assim só porque a
  // QUANTIDADE de grupos bate com o plano. Entrando sempre pelo menor, a diferença normal é 1.
  return Math.max(...currentSizes) - Math.min(...currentSizes) > 1;
}

// --- Redistribuição -----------------------------------------------------------------------------

export interface GroupSnapshot {
  groupId: string;
  memberIds: string[];
}

export interface RebalancePlan {
  /** groupId -> uids que devem ficar nele. Índice = ordem dos grupos da semana. */
  groups: { groupId: string; memberIds: string[] }[];
  /** uid -> groupId de destino, só para quem muda de grupo. */
  moves: Record<string, string>;
  /** Grupos existentes que sobraram e devem ser removidos. */
  removedGroupIds: string[];
}

/**
 * Redistribui os jogadores nos tamanhos-alvo mexendo no mínimo possível.
 *
 * Cada grupo-alvo herda um grupo atual como "âncora" (os maiores primeiro), mantém os membros que
 * couberem e só recebe gente de fora para completar. Quem sobra vai para o primeiro grupo com vaga,
 * então a maioria dos jogadores continua com os mesmos adversários da semana.
 *
 * `nextGroupId(index)` gera o id de um grupo novo quando o plano pede mais grupos do que existem.
 */
export function planRebalance(
  current: GroupSnapshot[],
  allMemberIds: string[],
  nextGroupId: (index: number) => string,
): RebalancePlan {
  const targetSizes = planGroupSizes(allMemberIds.length);
  const known = new Set(allMemberIds);

  // Âncoras: grupos atuais com mais membros primeiro (empate resolvido pelo id, para ser determinístico).
  const anchors = [...current]
    .map((g) => ({ groupId: g.groupId, memberIds: g.memberIds.filter((id) => known.has(id)) }))
    .sort((a, b) => b.memberIds.length - a.memberIds.length || a.groupId.localeCompare(b.groupId));

  const groups: { groupId: string; memberIds: string[] }[] = targetSizes.map((_, i) => ({
    groupId: anchors[i]?.groupId ?? nextGroupId(i),
    memberIds: [],
  }));

  const placed = new Set<string>();
  targetSizes.forEach((size, i) => {
    const anchor = anchors[i];
    if (!anchor) return;
    for (const uid of anchor.memberIds) {
      if (groups[i]!.memberIds.length >= size) break;
      groups[i]!.memberIds.push(uid);
      placed.add(uid);
    }
  });

  // Sobras (grupos extintos, grupos que encolheram e jogadores novos) preenchem as vagas restantes.
  const leftovers = allMemberIds.filter((uid) => !placed.has(uid));
  let cursor = 0;
  for (const uid of leftovers) {
    while (cursor < groups.length && groups[cursor]!.memberIds.length >= targetSizes[cursor]!) {
      cursor++;
    }
    // Nunca deixa ninguém de fora: se o plano acabou, o último grupo absorve.
    const target = cursor < groups.length ? groups[cursor]! : groups[groups.length - 1]!;
    target.memberIds.push(uid);
  }

  const originalGroupOf = new Map<string, string>();
  for (const g of current) for (const uid of g.memberIds) originalGroupOf.set(uid, g.groupId);

  const moves: Record<string, string> = {};
  for (const g of groups) {
    for (const uid of g.memberIds) {
      if (originalGroupOf.get(uid) !== g.groupId) moves[uid] = g.groupId;
    }
  }

  const keptIds = new Set(groups.map((g) => g.groupId));
  const removedGroupIds = current.map((g) => g.groupId).filter((id) => !keptIds.has(id));

  return { groups, moves, removedGroupIds };
}
