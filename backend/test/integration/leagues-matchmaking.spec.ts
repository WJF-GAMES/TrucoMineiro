import { LeagueScoreEvent } from '@prisma/client';
import {
  bootstrap,
  Harness,
  newUser,
  onboard,
  resetDb,
  startHarness,
  TestUser,
} from '../helpers/harness';
import { LeaguesService } from '../../src/leagues/leagues.service';
import { JobsService } from '../../src/jobs/jobs.service';
import { MatchmakingService } from '../../src/matchmaking/matchmaking.service';
import { advanceClock } from '../../src/common/clock';
import { nextWeekKey, weekKeyFor, weekStartMs } from '../../src/domain/model/leagueWeek';
import {
  aiForDifficulty,
  applyAction,
  createMatch,
  decisionRng,
  getAvailableActions,
  nextAIAction,
  timeoutAction,
  viewForSeat,
  type GameAction,
  type Seat,
} from '../../src/domain/game';

/**
 * Joga uma partida local contra a IA exatamente como o app faz (motor + IA determinística).
 * `peeks` repete a consulta "qual é a jogada da IA?" para o mesmo estado, como a tela faz a cada
 * re-render: isso não pode mudar a jogada, senão o servidor recusa a partida inteira.
 */
function localAiMatch(
  seed: number,
  aiSeed: number,
  difficulty: 'easy' | 'normal' | 'hard',
  peeks = 1,
) {
  const ai = aiForDifficulty(difficulty);
  const seats = new Map<Seat, typeof ai>([
    [1, ai],
    [2, ai],
    [3, ai],
  ]);
  let state = createMatch(seed);
  const actions: GameAction[] = [];
  for (let i = 0; i < 3000 && state.status === 'PLAYING'; i++) {
    for (let p = 1; p < peeks; p++) nextAIAction(state, seats, decisionRng(aiSeed, state));
    const botAction = nextAIAction(state, seats, decisionRng(aiSeed, state));
    let action: GameAction | null = botAction;
    if (!action && getAvailableActions(state, 0).length > 0)
      action = timeoutAction(viewForSeat(state, 0), 0);
    if (!action) throw new Error('travou');
    state = applyAction(state, action);
    actions.push(action);
  }
  return { state, actions };
}

describe('Liga, matchmaking e partida contra IA', () => {
  let h: Harness;
  let leagues: LeaguesService;
  beforeAll(async () => {
    h = await startHarness();
    leagues = h.app.get(LeaguesService);
  });
  afterAll(async () => h.close());
  beforeEach(async () => resetDb(h));

  const idOf = async (u: TestUser) =>
    (await h.prisma.user.findUniqueOrThrow({ where: { firebaseUid: u.uid } })).id;

  it('liga exige cadastro completo: sem apelido não entra em grupo', async () => {
    const u = newUser('semnome');
    await bootstrap(h, u);
    const res = await h.http.get('/v1/leagues/me').set('authorization', u.auth).expect(412);
    expect(res.body.error.code).toBe('PROFILE_INCOMPLETE');
    await h.http.post('/v1/leagues/me/ensure').set('authorization', u.auth).expect(412);
    expect(await h.prisma.leagueMembership.count({ where: { userId: await idOf(u) } })).toBe(0);
  });

  it('tela da liga: snapshot completo com zonas e ranking do servidor', async () => {
    const users = Array.from({ length: 6 }, (_, i) => newUser(`lg${i}`));
    for (const u of users) await onboard(h, u);
    const ids = await Promise.all(users.map(idOf));
    await leagues.addWeeklyPoints({
      userId: ids[3]!,
      matchKey: 'm1',
      event: LeagueScoreEvent.MATCH_WIN,
      points: 25,
      won: true,
    });
    const res = await h.http.get('/v1/leagues/me').set('authorization', users[0]!.auth).expect(200);
    const snap = res.body.data;
    expect(snap).toMatchObject({
      currentLeague: { id: 'bronze' },
      previousLeague: null,
      nextLeague: { id: 'silver' },
      groupSize: 6,
      promotionCount: 2,
      relegationCount: 2,
    });
    expect(snap.members[0]).toMatchObject({ uid: users[3]!.uid, rank: 1, weeklyPoints: 25 });
    expect(snap.members.find((m: { isMe: boolean }) => m.isMe).uid).toBe(users[0]!.uid);
    expect(snap.endAt - snap.startAt).toBe(7 * 86_400_000);

    const ranking = await h.http
      .get(`/v1/leagues/groups/${snap.groupId}/ranking`)
      .set('authorization', users[1]!.auth)
      .expect(200);
    expect(ranking.body.data.members).toHaveLength(6);
    const global = await h.http
      .get('/v1/leagues/ranking/global?limit=3')
      .set('authorization', users[0]!.auth)
      .expect(200);
    expect(global.body.data.entries[0]).toMatchObject({
      uid: users[3]!.uid,
      seasonPoints: 25,
      rank: 1,
    });
    const defs = await h.http.get('/v1/leagues').set('authorization', users[0]!.auth).expect(200);
    expect(defs.body.data.leagues).toHaveLength(20);
  });

  it('pontos da semana são idempotentes por partida + usuário + evento', async () => {
    const u = newUser();
    await onboard(h, u);
    const id = await idOf(u);
    const input = {
      userId: id,
      matchKey: 'dup-match',
      event: LeagueScoreEvent.MATCH_WIN,
      points: 25,
      won: true,
    };
    const results = await Promise.all([
      leagues.addWeeklyPoints(input),
      leagues.addWeeklyPoints(input),
      leagues.addWeeklyPoints(input),
    ]);
    expect(results.filter((r) => r.applied)).toHaveLength(1);
    const m = await h.prisma.leagueMembership.findFirstOrThrow({ where: { userId: id } });
    expect(m).toMatchObject({ weeklyPoints: 25, wins: 1, matches: 1 });
    const p = await h.prisma.leagueProgress.findUniqueOrThrow({ where: { userId: id } });
    expect(p).toMatchObject({ weeklyPoints: 25, seasonPoints: 25 });
  });

  it('virada semanal: promoção, rebaixamento, histórico e próxima semana — job idempotente', async () => {
    const users = Array.from({ length: 10 }, (_, i) => newUser(`wk${i}`));
    // Todos na Prata para testar subida e descida.
    for (const u of users) await onboard(h, u);
    const ids = await Promise.all(users.map(idOf));
    const week = weekKeyFor(Date.now());
    await h.prisma.leagueProgress.updateMany({ data: { currentLeagueId: 'silver' } });
    await h.prisma.leagueMembership.deleteMany({});
    await h.prisma.leagueGroup.deleteMany({});
    for (const id of ids) await leagues.ensureAssignment(id);
    const group = await h.prisma.leagueGroup.findFirstOrThrow({ where: { weekKey: week } });
    expect(group).toMatchObject({ leagueId: 'silver', memberCount: 10 });
    // Pontos decrescentes: os 3 primeiros sobem, os 3 últimos descem (grupo de 10).
    for (const [i, id] of ids.entries())
      if (i < 7)
        await leagues.addWeeklyPoints({
          userId: id,
          matchKey: `w${i}`,
          event: LeagueScoreEvent.MATCH_WIN,
          points: 100 - i * 10,
          won: true,
        });

    const jobs = h.app.get(JobsService);
    const atNextWeek = weekStartMs(nextWeekKey(week)) + 5 * 60_000;
    const first = (await jobs.run('league.weekly-rollover', { atMs: atNextWeek })) as {
      report: { players: number; promoted: number; relegated: number; stayed: number };
      prepared: { players: number };
    };
    expect(first.report).toMatchObject({ players: 10, promoted: 3, relegated: 3, stayed: 4 });
    expect(first.prepared.players).toBe(7);

    const second = (await jobs.run('league.weekly-rollover', { atMs: atNextWeek })) as {
      report: { players: number; alreadyFinalized?: boolean };
    };
    expect(second.report.alreadyFinalized).toBe(true);
    expect(await h.prisma.leagueWeekResult.count()).toBe(10);

    const top = await h.prisma.leagueProgress.findUniqueOrThrow({ where: { userId: ids[0]! } });
    const bottom = await h.prisma.leagueProgress.findUniqueOrThrow({ where: { userId: ids[9]! } });
    expect(top).toMatchObject({
      currentLeagueId: 'gold',
      lastWeeklyResult: 'PROMOTED',
      lastWeeklyRank: 1,
      weeklyPoints: 0,
    });
    expect(bottom).toMatchObject({ currentLeagueId: 'bronze', lastWeeklyResult: 'RELEGATED' });
    const profile = await h.prisma.userProfile.findUniqueOrThrow({ where: { userId: ids[0]! } });
    expect(profile.leagueId).toBe('gold');

    const history = await h.http
      .get('/v1/leagues/me/history')
      .set('authorization', users[0]!.auth)
      .expect(200);
    expect(history.body.data.items[0]).toMatchObject({
      weekKey: week,
      result: 'promoted',
      finalRank: 1,
      nextLeagueId: 'gold',
    });

    // Quem pontuou já está no grupo da próxima semana; dormente entra ao abrir o app.
    const next = nextWeekKey(week);
    const prepared = await h.prisma.leagueMembership.count({ where: { weekKey: next } });
    expect(prepared).toBe(7);
    const g = await h.prisma.leagueGroup.findFirstOrThrow({
      where: { weekKey: next, leagueId: 'gold' },
    });
    expect(g).toMatchObject({ status: 'FORMING', memberCount: 3 });
    const dormant = await leagues.ensureAssignment(ids[9]!, atNextWeek);
    expect(dormant.group).toMatchObject({ weekKey: next, leagueId: 'bronze' });
  });

  it('rebalanceamento: 30 jogadores na mesma liga viram dois grupos de 15', async () => {
    const users = Array.from({ length: 30 }, (_, i) => newUser(`rb${i}`));
    for (const u of users) await onboard(h, u);
    const groups = await h.prisma.leagueGroup.findMany({
      where: { status: { in: ['ACTIVE', 'FORMING'] } },
    });
    expect(groups.map((g) => g.memberCount).sort()).toEqual([15, 15]);
    const total = await h.prisma.leagueMembership.count();
    expect(total).toBe(30);
    const report = await leagues.repair();
    expect(report.fixedCounts).toBe(0);
  });

  it('matchmaking: 4 jogadores formam mesa; com IA um jogador sozinho joga', async () => {
    const users = Array.from({ length: 4 }, (_, i) => newUser(`mm${i}`));
    for (const u of users) await onboard(h, u);
    for (const u of users.slice(0, 3)) {
      await h.http.post('/v1/matchmaking').set('authorization', u.auth).send({}).expect(200);
      const t = await h.http.get('/v1/matchmaking').set('authorization', u.auth).expect(200);
      expect(t.body.data.entry.status).toBe('searching');
    }
    await h.http.post('/v1/matchmaking').set('authorization', users[3]!.auth).send({}).expect(200);
    const entries = await Promise.all(
      users.map(
        async (u) =>
          (await h.http.get('/v1/matchmaking').set('authorization', u.auth).expect(200)).body.data
            .entry,
      ),
    );
    expect(entries.every((e) => e.status === 'ready' && e.sessionId === entries[0].sessionId)).toBe(
      true,
    );
    const parts = await h.prisma.matchParticipant.findMany({
      where: { matchId: entries[0].sessionId },
    });
    expect(parts.filter((p) => p.controller === 'HUMAN')).toHaveLength(4);

    const solo = newUser('solo');
    await onboard(h, solo);
    await h.http.post('/v1/matchmaking').set('authorization', solo.auth).send({}).expect(200);
    await h.http.delete('/v1/matchmaking').set('authorization', solo.auth).expect(200);
    expect(
      (await h.http.get('/v1/matchmaking').set('authorization', solo.auth)).body.data.entry.status,
    ).toBe('cancelled');
    await h.http
      .post('/v1/matchmaking')
      .set('authorization', solo.auth)
      .send({ allowBots: true })
      .expect(200);
    const entry = (await h.http.get('/v1/matchmaking').set('authorization', solo.auth)).body.data
      .entry;
    expect(entry.status).toBe('ready');
    const soloParts = await h.prisma.matchParticipant.findMany({
      where: { matchId: entry.sessionId },
    });
    expect(soloParts.filter((p) => p.controller === 'AI_PERMANENT')).toHaveLength(3);
    // Já em partida: não entra na fila de novo.
    const busy = await h.http.post('/v1/matchmaking').set('authorization', solo.auth).send({});
    expect(busy.body.error.code).toBe('ALREADY_IN_MATCH');
  });

  it('matchmaking: busca abandonada (app morto) expira e não senta ninguém numa mesa', async () => {
    const users = Array.from({ length: 4 }, (_, i) => newUser(`mmx${i}`));
    for (const u of users) await onboard(h, u);
    for (const u of users.slice(0, 3))
      await h.http.post('/v1/matchmaking').set('authorization', u.auth).send({}).expect(200);
    advanceClock(200_000); // além de MATCHMAKING_MAX_SEARCH_SECONDS (150 s)
    // O 4º chega: os três parados não podem formar mesa com ele.
    await h.http.post('/v1/matchmaking').set('authorization', users[3]!.auth).send({}).expect(200);
    expect(await h.prisma.match.count()).toBe(0);
    await h.app.get(MatchmakingService).cleanup();
    const statuses = await Promise.all(
      users.map(
        async (u) =>
          (await h.http.get('/v1/matchmaking').set('authorization', u.auth)).body.data.entry.status,
      ),
    );
    expect(statuses).toEqual(['timeout', 'timeout', 'timeout', 'searching']);
  });

  it('partida contra IA: o servidor re-executa, pontua uma vez e recusa fraude', async () => {
    const u = newUser('ai');
    await onboard(h, u);
    // `peeks: 4` = a tela consultou a jogada da IA quatro vezes por estado (re-renders). O
    // servidor precisa aceitar: foi isso que, com um sorteio compartilhado, recusava a partida
    // inteira em produção e deixava o jogador sem XP.
    const { state, actions } = localAiMatch(12345, 777, 'hard', 4);
    const body = {
      matchId: 'local-match-0001',
      seed: 12345,
      aiSeed: 777,
      difficulty: 'hard',
      actions,
    };
    const res = await h.http
      .post('/v1/matches/ai')
      .set('authorization', u.auth)
      .send(body)
      .expect(200);
    expect(res.body.data).toMatchObject({ alreadyProcessed: false, winnerTeam: state.winner });
    expect(res.body.data.progression.xpGained).toBeGreaterThan(0);
    const again = await h.http
      .post('/v1/matches/ai')
      .set('authorization', u.auth)
      .send(body)
      .expect(200);
    expect(again.body.data.alreadyProcessed).toBe(true);
    expect(again.body.data.progression).toEqual(res.body.data.progression);
    const stats = await h.prisma.playerStatistics.findFirstOrThrow();
    expect(stats).toMatchObject({ matches: 1, aiMatches: 1, hardWins: state.winner === 0 ? 1 : 0 });
    expect(await h.prisma.gameAction.count()).toBe(actions.length);

    // Forjar a jogada da IA é detectado.
    const forged = [...actions];
    const idx = forged.findIndex((a) => a.seat === 1 && a.type === 'PLAY_CARD');
    forged[idx] = { type: 'RUN', seat: 1 } as GameAction;
    const bad = await h.http
      .post('/v1/matches/ai')
      .set('authorization', u.auth)
      .send({ ...body, matchId: 'local-match-0002', actions: forged });
    expect(bad.body.error.code).toBe('AI_REPLAY_MISMATCH');
    // Partida incompleta não conta.
    const partial = await h.http
      .post('/v1/matches/ai')
      .set('authorization', u.auth)
      .send({ ...body, matchId: 'local-match-0003', actions: actions.slice(0, 10) });
    expect(partial.body.error.code).toBe('MATCH_NOT_FINISHED');
    const history = await h.http.get('/v1/matches').set('authorization', u.auth).expect(200);
    expect(history.body.data.items).toHaveLength(1);
    expect(history.body.data.items[0]).toMatchObject({ mode: 'ai', difficulty: 'hard' });
  });
});
