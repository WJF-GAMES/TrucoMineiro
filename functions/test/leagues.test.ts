/* eslint-disable import/first --
 * Os `jest.mock` precisam vir antes de importar `../src/leagues`: o módulo resolve `db` e `now` de
 * `lib/admin` já na carga, então importá-lo primeiro pegaria o Firestore real.
 */
import { FakeFirestore, DOCUMENT_ID } from './fakeFirestore';

/**
 * Testes do motor de ligas rodando contra um Firestore em memória.
 *
 * Cobrem os invariantes que a spec chama de absolutos: ninguém sem grupo, ninguém em dois grupos,
 * contagem sempre certa, e idempotência de pontuação, rebalanceamento e fechamento semanal.
 */

const fs = new FakeFirestore();
let clock = Date.parse('2026-09-09T15:00:00-03:00'); // quarta-feira da semana 2026-W37

jest.mock('../src/lib/admin', () => ({
  db: fs,
  rtdb: {},
  auth: { getUser: jest.fn() },
  messaging: {},
  REGION: 'southamerica-east1',
  DB_TRIGGER_REGION: 'us-central1',
  IS_EMULATOR: true,
  ENFORCE_APP_CHECK: false,
  now: () => clock,
}));

jest.mock('firebase-admin/firestore', () => ({
  FieldPath: { documentId: () => DOCUMENT_ID },
  FieldValue: { increment: (n: number) => n },
}));

jest.mock('firebase-functions/v2', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('firebase-functions/v2/https', () => ({
  onRequest: (_opts: unknown, handler: unknown) => handler,
  onCall: (_opts: unknown, handler: unknown) => handler,
  HttpsError: class extends Error {
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message);
    }
  },
}));
jest.mock('firebase-functions/v2/scheduler', () => ({
  onSchedule: (_opts: unknown, handler: unknown) => handler,
}));

import {
  addWeeklyLeaguePoints,
  ensureAssignment,
  finalizeWeek,
  groupIdFor,
  leaveCurrentLeagueGroup,
  prepareNextWeekGroups,
  rebalanceLeague,
  recomputeWeeklyLeagueRanking,
  repairLeagueSystem,
  seedLeagueDefinitionsInternal,
} from '../src/leagues';
import { MIN_GROUP_SIZE, planGroupSizes } from '../src/domain/model/leagueGroups';
import { weekKeyFor } from '../src/domain/model/leagueWeek';
import type { LeagueId } from '../src/domain/model/types';

const WEEK = weekKeyFor(clock);

// --- helpers --------------------------------------------------------------------------------

function reset() {
  fs.store.clear();
  fs.reads = 0;
  fs.writes = 0;
  clock = Date.parse('2026-09-09T15:00:00-03:00');
}

function createProfile(uid: string, nickname = uid) {
  fs.store.set(`profiles/${uid}`, { nickname, avatarId: 'joao', countryCode: 'BR' });
}

async function joinPlayers(count: number, prefix = 'u'): Promise<string[]> {
  const uids: string[] = [];
  for (let i = 0; i < count; i++) {
    const uid = `${prefix}${String(i).padStart(4, '0')}`;
    createProfile(uid);
    await ensureAssignment(uid);
    uids.push(uid);
  }
  return uids;
}

function groupsOf(leagueId: LeagueId, weekKey = WEEK) {
  return fs
    .docsIn('weeklyLeagueGroups')
    .filter((g) => g.data.leagueId === leagueId && g.data.weekKey === weekKey)
    .sort((a, b) => Number(a.data.division) - Number(b.data.division));
}

function membersOf(groupId: string): string[] {
  return fs.docsIn(`weeklyLeagueGroups/${groupId}/members`).map((m) => m.id);
}

/** Invariantes que precisam valer depois de QUALQUER operação. */
function assertInvariants(expectedUids: string[], leagueId: LeagueId = 'bronze') {
  const groups = groupsOf(leagueId);
  const placements = new Map<string, string[]>();
  for (const g of groups) {
    for (const uid of membersOf(g.id)) {
      placements.set(uid, [...(placements.get(uid) ?? []), g.id]);
    }
    // memberCount bate com a subcoleção
    expect(g.data.memberCount).toBe(membersOf(g.id).length);
    // nenhum grupo vazio sobrando
    expect(membersOf(g.id).length).toBeGreaterThan(0);
  }
  // ninguém em dois grupos
  for (const [uid, ids] of placements) expect({ uid, ids }).toEqual({ uid, ids: [ids[0]] });
  // ninguém de fora
  expect([...placements.keys()].sort()).toEqual([...expectedUids].sort());
  // o progresso aponta para o grupo real
  for (const uid of expectedUids) {
    const progress = fs.store.get(`playerProgress/${uid}`)!;
    expect(progress.currentWeekKey).toBe(WEEK);
    expect(placements.get(uid)![0]).toBe(progress.currentLeagueGroupId);
    expect(progress.currentLeagueId).toBe(leagueId);
  }
  // a distribuição segue o plano
  expect(groups.map((g) => membersOf(g.id).length).sort((a, b) => b - a)).toEqual(
    planGroupSizes(expectedUids.length),
  );
}

beforeEach(reset);

// --- seed -----------------------------------------------------------------------------------

describe('seedLeagueDefinitions', () => {
  it('grava as 20 ligas e é idempotente', async () => {
    expect(await seedLeagueDefinitionsInternal()).toBe(20);
    await seedLeagueDefinitionsInternal();
    const docs = fs.docsIn('leagueDefinitions');
    expect(docs).toHaveLength(20);
    expect(docs.find((d) => d.id === 'gold')!.data).toMatchObject({
      order: 3,
      displayName: 'Ouro',
      assetKey: 'shield_gold',
      previousLeagueId: 'silver',
      nextLeagueId: 'platinum',
    });
    // Nunca um caminho local no banco.
    for (const d of docs) expect(String(d.data.assetKey)).toMatch(/^shield_[a-z_]+$/);
  });
});

// --- atribuição -----------------------------------------------------------------------------

describe('ensureAssignment', () => {
  it('coloca um usuário novo em Bronze com grupo válido e 0 pontos', async () => {
    createProfile('novo');
    const { group, progress } = await ensureAssignment('novo');

    expect(group.leagueId).toBe('bronze');
    expect(group.weekKey).toBe(WEEK);
    expect(group.groupId).toBe(groupIdFor(WEEK, 'bronze', 1));
    expect(progress.weeklyPoints).toBe(0);
    expect(membersOf(group.groupId)).toEqual(['novo']);
    assertInvariants(['novo']);
  });

  it('é idempotente: chamar de novo não cria segundo grupo nem duplica membro', async () => {
    createProfile('a');
    await ensureAssignment('a');
    await ensureAssignment('a');
    await ensureAssignment('a');
    expect(groupsOf('bronze')).toHaveLength(1);
    assertInvariants(['a']);
  });

  it('nunca deixa um grupo com 1 pessoa sobrando: o 21º entra no grupo de 20', async () => {
    const uids = await joinPlayers(21);
    const groups = groupsOf('bronze');
    expect(groups).toHaveLength(1);
    expect(membersOf(groups[0]!.id)).toHaveLength(21);
    assertInvariants(uids);
  });

  it('quebra em dois grupos equilibrados ao chegar no 30º jogador', async () => {
    const uids = await joinPlayers(30);
    expect(groupsOf('bronze').map((g) => membersOf(g.id).length)).toEqual([15, 15]);
    assertInvariants(uids);
  });

  it.each([1, 14, 20, 21, 29, 30, 31, 45, 60])(
    'mantém os invariantes com %i jogadores',
    async (count) => {
      const uids = await joinPlayers(count);
      assertInvariants(uids);
    },
  );

  it('reatribui quando a semana virou', async () => {
    createProfile('a');
    const first = await ensureAssignment('a');
    clock = Date.parse('2026-09-16T12:00:00-03:00'); // semana seguinte
    const second = await ensureAssignment('a');
    expect(second.group.weekKey).toBe(weekKeyFor(clock));
    expect(second.group.groupId).not.toBe(first.group.groupId);
    expect(fs.store.get('playerProgress/a')!.weeklyPoints).toBe(0);
  });

  it('conserta sozinho quando o grupo apontado sumiu', async () => {
    createProfile('a');
    const { group } = await ensureAssignment('a');
    fs.store.delete(`weeklyLeagueGroups/${group.groupId}`);
    fs.store.delete(`weeklyLeagueGroups/${group.groupId}/members/a`);

    const fixed = await ensureAssignment('a');
    expect(fs.store.has(`weeklyLeagueGroups/${fixed.group.groupId}`)).toBe(true);
    assertInvariants(['a']);
  });

  it('conserta sozinho quando o documento de membro sumiu', async () => {
    createProfile('a');
    const { group } = await ensureAssignment('a');
    fs.store.delete(`weeklyLeagueGroups/${group.groupId}/members/a`);
    await fs.doc(`weeklyLeagueGroups/${group.groupId}`).set({ memberCount: 0 }, { merge: true });

    await ensureAssignment('a');
    assertInvariants(['a']);
  });

  it('não deixa o jogador de fora quando o grupo já foi finalizado', async () => {
    createProfile('a');
    const { group } = await ensureAssignment('a');
    await fs.doc(`weeklyLeagueGroups/${group.groupId}`).set({ status: 'finalized' }, { merge: true });

    const again = await ensureAssignment('a');
    expect(again.group.status).not.toBe('finalized');
    expect(membersOf(again.group.groupId)).toContain('a');
  });

  it('normaliza a liga antiga em português gravada no progresso', async () => {
    createProfile('a');
    fs.store.set('playerProgress/a', { uid: 'a', currentLeagueId: 'ouro' });
    const { group } = await ensureAssignment('a');
    expect(group.leagueId).toBe('gold');
    expect(fs.store.get('playerProgress/a')!.currentLeagueId).toBe('gold');
  });

  it('entra normalmente faltando um minuto para a semana acabar', async () => {
    clock = Date.parse('2026-09-13T23:59:00-03:00');
    createProfile('atrasado');
    const { group } = await ensureAssignment('atrasado');
    expect(group.weekKey).toBe(WEEK);
    expect(membersOf(group.groupId)).toContain('atrasado');
  });

  it('aguenta várias entradas concorrentes sem perder ninguém', async () => {
    const uids = Array.from({ length: 12 }, (_, i) => `c${i}`);
    uids.forEach((u) => createProfile(u));
    await Promise.all(uids.map((u) => ensureAssignment(u)));
    const placed = groupsOf('bronze').flatMap((g) => membersOf(g.id));
    expect(new Set(placed).size).toBe(uids.length);
    expect(placed.sort()).toEqual([...uids].sort());
  });
});

// --- pontuação ------------------------------------------------------------------------------

describe('addWeeklyLeaguePoints', () => {
  beforeEach(async () => {
    createProfile('a');
    await ensureAssignment('a');
  });

  it('soma pontos ao membro e ao progresso', async () => {
    const res = await addWeeklyLeaguePoints({
      uid: 'a',
      matchId: 'm1',
      eventType: 'match_win',
      points: 25,
      won: true,
    });
    expect(res).toEqual({ applied: true, weeklyPoints: 25 });
    const progress = fs.store.get('playerProgress/a')!;
    expect(progress.weeklyPoints).toBe(25);
    expect(progress.seasonPoints).toBe(25);
    expect(progress.lastActiveWeekKey).toBe(WEEK);
  });

  it('nunca pontua duas vezes o mesmo evento', async () => {
    const input = {
      uid: 'a',
      matchId: 'm1',
      eventType: 'match_win' as const,
      points: 25,
      won: true,
    };
    await addWeeklyLeaguePoints(input);
    const second = await addWeeklyLeaguePoints(input);
    expect(second.applied).toBe(false);
    expect(fs.store.get('playerProgress/a')!.weeklyPoints).toBe(25);
  });

  it('conta partidas distintas separadamente', async () => {
    await addWeeklyLeaguePoints({ uid: 'a', matchId: 'm1', eventType: 'match_win', points: 25, won: true });
    await addWeeklyLeaguePoints({ uid: 'a', matchId: 'm2', eventType: 'match_loss', points: 8, won: false });
    const group = fs.store.get('playerProgress/a')!.currentLeagueGroupId as string;
    const member = fs.store.get(`weeklyLeagueGroups/${group}/members/a`)!;
    expect(member.weeklyPoints).toBe(33);
    expect(member.wins).toBe(1);
    expect(member.matches).toBe(2);
  });

  it('nunca aceita pontuação negativa', async () => {
    await addWeeklyLeaguePoints({ uid: 'a', matchId: 'm1', eventType: 'bonus', points: -50, won: false });
    expect(fs.store.get('playerProgress/a')!.weeklyPoints).toBe(0);
  });

  it('cria o vínculo sozinho se o jogador ainda não tem grupo', async () => {
    createProfile('b');
    const res = await addWeeklyLeaguePoints({
      uid: 'b',
      matchId: 'm9',
      eventType: 'match_win',
      points: 10,
      won: true,
    });
    expect(res.applied).toBe(true);
    expect(fs.store.get('playerProgress/b')!.currentLeagueGroupId).toBeTruthy();
  });
});

// --- ranking --------------------------------------------------------------------------------

describe('recomputeWeeklyLeagueRanking', () => {
  it('grava as posições por pontos, com o servidor decidindo', async () => {
    const uids = await joinPlayers(5);
    const groupId = groupsOf('bronze')[0]!.id;
    const points = [10, 50, 30, 0, 40];
    for (let i = 0; i < uids.length; i++) {
      await addWeeklyLeaguePoints({
        uid: uids[i]!,
        matchId: `m${i}`,
        eventType: 'match_win',
        points: points[i]!,
        won: true,
      });
    }
    expect(await recomputeWeeklyLeagueRanking(groupId)).toBe(5);
    const ranks = Object.fromEntries(
      fs.docsIn(`weeklyLeagueGroups/${groupId}/members`).map((m) => [m.id, m.data.currentRank]),
    );
    expect(ranks[uids[1]!]).toBe(1); // 50
    expect(ranks[uids[4]!]).toBe(2); // 40
    expect(ranks[uids[2]!]).toBe(3); // 30
    expect(ranks[uids[0]!]).toBe(4); // 10
    expect(ranks[uids[3]!]).toBe(5); // 0
  });
});

// --- rebalanceamento ------------------------------------------------------------------------

describe('rebalanceLeague', () => {
  it('é idempotente: a segunda execução não move ninguém', async () => {
    const uids = await joinPlayers(35);
    const before = groupsOf('bronze').map((g) => membersOf(g.id));
    const report = await rebalanceLeague('bronze', WEEK);
    expect(report!.moved).toBe(0);
    expect(groupsOf('bronze').map((g) => membersOf(g.id))).toEqual(before);
    assertInvariants(uids);
  });

  it('redistribui e mantém todo mundo quando a liga cresce muito de uma vez', async () => {
    const uids = await joinPlayers(20);
    // Simula 40 jogadores empilhados num grupo só (estado inconsistente vindo de uma falha).
    const groupId = groupsOf('bronze')[0]!.id;
    for (let i = 0; i < 40; i++) {
      const uid = `extra${i}`;
      createProfile(uid);
      fs.store.set(`weeklyLeagueGroups/${groupId}/members/${uid}`, {
        uid,
        nickname: uid,
        avatarId: 'joao',
        countryCode: 'BR',
        weeklyPoints: 0,
        wins: 0,
        matches: 0,
        tiebreakScore: 0,
        currentRank: 0,
        previousRank: 0,
        joinedAt: clock,
        updatedAt: clock,
      });
      fs.store.set(`playerProgress/${uid}`, {
        uid,
        currentLeagueId: 'bronze',
        currentWeekKey: WEEK,
        currentLeagueGroupId: groupId,
        currentDivision: 1,
        weeklyPoints: 0,
        seasonPoints: 0,
      });
      uids.push(uid);
    }
    await fs.doc(`weeklyLeagueGroups/${groupId}`).set({ memberCount: 60 }, { merge: true });

    await rebalanceLeague('bronze', WEEK);
    assertInvariants(uids);
    expect(groupsOf('bronze').map((g) => membersOf(g.id).length)).toEqual([20, 20, 20]);
  });

  it('respeita o tamanho mínimo em todo grupo quando há mais de um', async () => {
    const uids = await joinPlayers(31);
    await rebalanceLeague('bronze', WEEK);
    const sizes = groupsOf('bronze').map((g) => membersOf(g.id).length);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(MIN_GROUP_SIZE);
    assertInvariants(uids);
  });
});

// --- fechamento semanal ---------------------------------------------------------------------

describe('finalizeWeek', () => {
  async function playWeek(count: number) {
    const uids = await joinPlayers(count);
    // Pontuação decrescente: u0000 é o líder.
    for (let i = 0; i < uids.length; i++) {
      await addWeeklyLeaguePoints({
        uid: uids[i]!,
        matchId: `m${i}`,
        eventType: 'match_win',
        points: (uids.length - i) * 10,
        won: true,
      });
    }
    return uids;
  }

  it('promove 5, mantém 10 e rebaixa 5 num grupo de 20', async () => {
    const uids = await playWeek(20);
    // Todos partem de Prata para que dê para ver subida e descida.
    for (const uid of uids) {
      await fs.doc(`playerProgress/${uid}`).set({ currentLeagueId: 'silver' }, { merge: true });
    }
    const groupId = groupsOf('bronze')[0]!.id;
    await fs.doc(`weeklyLeagueGroups/${groupId}`).set({ leagueId: 'silver' }, { merge: true });

    const report = await finalizeWeek(WEEK);
    expect(report).toMatchObject({ groups: 1, players: 20, promoted: 5, stayed: 10, relegated: 5 });

    expect(fs.store.get(`playerProgress/${uids[0]!}`)!.currentLeagueId).toBe('gold');
    expect(fs.store.get(`playerProgress/${uids[7]!}`)!.currentLeagueId).toBe('silver');
    expect(fs.store.get(`playerProgress/${uids[19]!}`)!.currentLeagueId).toBe('bronze');
    // Pontos da semana zerados e histórico gravado.
    expect(fs.store.get(`playerProgress/${uids[0]!}`)!.weeklyPoints).toBe(0);
    expect(fs.store.get(`leagueHistory/${uids[0]!}/weeks/${WEEK}`)).toMatchObject({
      finalRank: 1,
      result: 'promoted',
      previousLeagueId: 'silver',
      nextLeagueId: 'gold',
      groupSize: 20,
    });
    // Espelho no perfil, para as telas que não abrem a aba Ligas.
    expect(fs.store.get(`profiles/${uids[0]!}`)!.leagueId).toBe('gold');
  });

  it('Bronze não rebaixa ninguém para fora da escada', async () => {
    const uids = await playWeek(20);
    await finalizeWeek(WEEK);
    expect(fs.store.get(`playerProgress/${uids[19]!}`)!.currentLeagueId).toBe('bronze');
    expect(fs.store.get(`leagueHistory/${uids[19]!}/weeks/${WEEK}`)!.result).toBe('bottom_league');
  });

  it('Lenda de Minas não promove ninguém para fora da escada', async () => {
    const uids = await playWeek(20);
    for (const uid of uids) {
      await fs.doc(`playerProgress/${uid}`).set({ currentLeagueId: 'legend_of_minas' }, { merge: true });
    }
    const groupId = groupsOf('bronze')[0]!.id;
    await fs.doc(`weeklyLeagueGroups/${groupId}`).set({ leagueId: 'legend_of_minas' }, { merge: true });

    await finalizeWeek(WEEK);
    expect(fs.store.get(`playerProgress/${uids[0]!}`)!.currentLeagueId).toBe('legend_of_minas');
    expect(fs.store.get(`leagueHistory/${uids[0]!}/weeks/${WEEK}`)!.result).toBe('top_league');
  });

  it('rodar duas vezes não promove duas vezes nem duplica histórico', async () => {
    const uids = await playWeek(20);
    await finalizeWeek(WEEK);
    const afterFirst = fs.store.get(`playerProgress/${uids[0]!}`)!.currentLeagueId;

    const second = await finalizeWeek(WEEK);
    expect(second.players).toBe(0); // nada reprocessado
    expect(fs.store.get(`playerProgress/${uids[0]!}`)!.currentLeagueId).toBe(afterFirst);
  });

  it('retomar após falha no meio termina o serviço sem estragar quem já foi processado', async () => {
    const uids = await playWeek(20);
    const groupId = groupsOf('bronze')[0]!.id;
    // Simula queda: metade processada e o grupo parado em "finalizing".
    await fs.doc(`weeklyLeagueGroups/${groupId}`).set({ status: 'finalizing' }, { merge: true });
    for (const uid of uids.slice(0, 10)) {
      await fs.doc(`leagueHistory/${uid}/weeks/${WEEK}`).set({ weekKey: WEEK, result: 'stayed' });
      await fs.doc(`playerProgress/${uid}`).set({ lastProcessedWeekKey: WEEK }, { merge: true });
    }

    const report = await finalizeWeek(WEEK);
    expect(report.skipped).toBe(10);
    expect(report.players).toBe(10);
    for (const uid of uids) {
      expect(fs.store.get(`leagueHistory/${uid}/weeks/${WEEK}`)).toBeDefined();
      expect(fs.store.get(`playerProgress/${uid}`)!.lastProcessedWeekKey).toBe(WEEK);
    }
    expect(fs.store.get(`weeklyLeagueGroups/${groupId}`)!.status).toBe('finalized');
  });

  it('quem não pontuou na semana não sobe de liga', async () => {
    const uids = await joinPlayers(20); // ninguém pontuou
    await finalizeWeek(WEEK);
    for (const uid of uids.slice(0, 5)) {
      expect(fs.store.get(`playerProgress/${uid}`)!.currentLeagueId).toBe('bronze');
      expect(fs.store.get(`leagueHistory/${uid}/weeks/${WEEK}`)!.result).toBe('stayed');
    }
  });
});

// --- virada completa ------------------------------------------------------------------------

describe('virada semanal completa', () => {
  it('fecha a semana, monta a seguinte e ninguém fica sem liga', async () => {
    const uids = await joinPlayers(45);
    for (let i = 0; i < uids.length; i++) {
      await addWeeklyLeaguePoints({
        uid: uids[i]!,
        matchId: `m${i}`,
        eventType: 'match_win',
        points: (uids.length - i) * 10,
        won: true,
      });
    }
    expect(groupsOf('bronze').map((g) => membersOf(g.id).length)).toEqual([23, 22]);

    await finalizeWeek(WEEK);
    const next = await prepareNextWeekGroups(WEEK);
    expect(next.weekKey).toBe('2026-W38');

    // Todo mundo que jogou está num grupo da semana nova, na liga certa.
    const placed = new Set<string>();
    for (const g of fs.docsIn('weeklyLeagueGroups').filter((g) => g.data.weekKey === next.weekKey)) {
      const members = membersOf(g.id);
      expect(members.length).toBe(g.data.memberCount);
      for (const uid of members) {
        expect(placed.has(uid)).toBe(false); // ninguém em dois grupos
        placed.add(uid);
        const progress = fs.store.get(`playerProgress/${uid}`)!;
        expect(progress.currentLeagueGroupId).toBe(g.id);
        expect(progress.currentWeekKey).toBe(next.weekKey);
        expect(progress.currentLeagueId).toBe(g.data.leagueId);
        expect(progress.weeklyPoints).toBe(0);
      }
    }
    expect(placed.size).toBe(uids.length);

    // Os 5 primeiros de cada grupo subiram para Prata.
    const silver = fs
      .docsIn('weeklyLeagueGroups')
      .filter((g) => g.data.weekKey === next.weekKey && g.data.leagueId === 'silver');
    expect(silver.reduce((acc, g) => acc + membersOf(g.id).length, 0)).toBe(10);
  });

  it('não carrega contas dormentes para a semana seguinte, mas devolve a liga quando voltam', async () => {
    const uids = await joinPlayers(20);
    // Só metade pontua.
    for (const uid of uids.slice(0, 10)) {
      await addWeeklyLeaguePoints({ uid, matchId: `m-${uid}`, eventType: 'match_win', points: 10, won: true });
    }
    await finalizeWeek(WEEK);
    await prepareNextWeekGroups(WEEK);

    const nextGroups = fs.docsIn('weeklyLeagueGroups').filter((g) => g.data.weekKey === '2026-W38');
    const placed = nextGroups.flatMap((g) => membersOf(g.id));
    expect(placed).toHaveLength(10);
    expect(placed).not.toContain(uids[15]);

    // O dormente volta na semana nova e é alocado na hora, sem erro e sem perder a liga.
    clock = Date.parse('2026-09-16T12:00:00-03:00');
    const back = await ensureAssignment(uids[15]!);
    expect(back.group.weekKey).toBe('2026-W38');
    expect(membersOf(back.group.groupId)).toContain(uids[15]);
  });
});

// --- repair ---------------------------------------------------------------------------------

describe('repairLeagueSystem', () => {
  it('conserta contagem errada, grupo vazio e jogador em dois grupos', async () => {
    const uids = await joinPlayers(20);
    const groupId = groupsOf('bronze')[0]!.id;

    // Estraga de propósito.
    await fs.doc(`weeklyLeagueGroups/${groupId}`).set({ memberCount: 99 }, { merge: true });
    const ghostId = groupIdFor(WEEK, 'bronze', 9);
    fs.store.set(`weeklyLeagueGroups/${ghostId}`, {
      groupId: ghostId,
      leagueId: 'bronze',
      weekKey: WEEK,
      division: 9,
      status: 'active',
      memberCount: 0,
    });
    fs.store.set(`weeklyLeagueGroups/${ghostId}/members/${uids[0]}`, { uid: uids[0], weeklyPoints: 0 });

    const report = await repairLeagueSystem();
    expect(report.fixedCounts).toBeGreaterThan(0);
    expect(report.removedDuplicates).toBe(1);
    expect(fs.store.get(`weeklyLeagueGroups/${groupId}`)!.memberCount).toBe(20);
    expect(fs.store.has(`weeklyLeagueGroups/${ghostId}/members/${uids[0]}`)).toBe(false);
    assertInvariants(uids);
  });

  it('normaliza liga inválida no progresso', async () => {
    fs.store.set('playerProgress/zz', { uid: 'zz', currentLeagueId: 'liga-que-nao-existe' });
    await repairLeagueSystem();
    expect(fs.store.get('playerProgress/zz')!.currentLeagueId).toBe('bronze');
  });
});

// --- saída ----------------------------------------------------------------------------------

describe('leaveCurrentLeagueGroup', () => {
  it('remove o membro e acerta a contagem do grupo', async () => {
    const uids = await joinPlayers(3);
    const groupId = groupsOf('bronze')[0]!.id;
    await leaveCurrentLeagueGroup(uids[1]!);
    expect(membersOf(groupId)).toEqual([uids[0], uids[2]]);
    expect(fs.store.get(`weeklyLeagueGroups/${groupId}`)!.memberCount).toBe(2);
  });
});
