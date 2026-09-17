import {
  Harness,

  newUser,
  onboard,
  pickAction,
  playToEnd,
  resetDb,
  snapshot,
  startHarness,
  TestUser,
} from '../helpers/harness';
import { advanceClock } from '../../src/common/clock';
import { TURN_TIMING, cardId, type GameAction, type Seat } from '../../src/domain/game';

async function roomWithBots(h: Harness, host: TestUser) {
  const room = await h.http.post('/v1/rooms').set('authorization', host.auth).send({}).expect(200);
  const code = room.body.data.code as string;
  await h.http.post(`/v1/rooms/${code}/fill-bots`).set('authorization', host.auth).expect(200);
  await h.http.post(`/v1/rooms/${code}/ready`).set('authorization', host.auth).send({ ready: true }).expect(200);
  const started = await h.http.post(`/v1/rooms/${code}/start`).set('authorization', host.auth).expect(200);
  return { code, matchId: started.body.data.sessionId as string };
}

async function forceTick(h: Harness, matchId: string) {
  await h.prisma.match.update({ where: { id: matchId }, data: { nextTickAt: new Date(Date.now() - 1) } });
  await h.scheduler.runOnce();
}

describe('Partida online autoritativa (servidor)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => h.close());
  beforeEach(async () => resetDb(h));

  it('1 humano x 3 IA: partida completa até 12 com progressão aplicada uma vez', async () => {
    const u = newUser('solo');
    await onboard(h, u);
    const { code, matchId } = await roomWithBots(h, u);

    const snap = await snapshot(h, u, matchId);
    expect(snap.seat).toBe(0);
    expect(Object.values(snap.meta.players).filter((p) => p.bot)).toHaveLength(3);
    // Nunca vazam as cartas dos outros.
    expect(snap.view!.myCards.length + snap.view!.cardCounts[0]!).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(snap)).not.toContain('"hands"');
    expect(JSON.stringify(snap)).not.toContain('"deck"');

    const active = await h.http.get('/v1/me/active-match').set('authorization', u.auth).expect(200);
    expect(active.body.data).toMatchObject({ matchId, roomCode: code });

    const humanActions = await playToEnd(h, matchId, [u]);
    expect(humanActions).toBeGreaterThan(0);

    const match = await h.prisma.match.findUniqueOrThrow({ where: { id: matchId } });
    expect(match.status).toBe('FINISHED');
    expect(Math.max(match.scoreTeam0, match.scoreTeam1)).toBeGreaterThanOrEqual(12);
    expect(match.winnerTeam).not.toBeNull();

    const results = await h.prisma.matchResult.findMany({ where: { matchId } });
    expect(results).toHaveLength(1);
    const stats = await h.prisma.playerStatistics.findFirstOrThrow();
    expect(stats.matches).toBe(1);
    expect(stats.onlineMatches).toBe(1);

    const final = await snapshot(h, u, matchId);
    expect(final.meta.status).toBe('finished');
    expect(final.result).toMatchObject({ xpGained: expect.any(Number) });

    const room = await h.http.get(`/v1/rooms/${code}`).set('authorization', u.auth).expect(200);
    expect(room.body.data).toMatchObject({ status: 'closed', closedReason: 'finished' });

    const history = await h.http.get('/v1/matches').set('authorization', u.auth).expect(200);
    expect(history.body.data.items).toHaveLength(1);
    expect(history.body.data.items[0]).toMatchObject({ mode: 'online', playerIds: [u.uid] });

    // Pontos da semana somados exatamente uma vez.
    const scores = await h.prisma.leagueScore.findMany();
    expect(scores).toHaveLength(1);
    const none = await h.http.get('/v1/me/active-match').set('authorization', u.auth).expect(200);
    expect(none.body.data).toBeNull();
  });

  it('2x2 com quatro humanos: partida completa, cada um vê só a própria mão', async () => {
    const [host, a, b, c] = [newUser('host'), newUser('pa'), newUser('pb'), newUser('pc')];
    for (const u of [host, a, b, c]) await onboard(h, u);
    const room = await h.http.post('/v1/rooms').set('authorization', host.auth).send({}).expect(200);
    const code = room.body.data.code as string;
    for (const u of [a, b, c]) {
      await h.http.post(`/v1/rooms/${code}/join`).set('authorization', u.auth).expect(200);
      await h.http.post(`/v1/rooms/${code}/ready`).set('authorization', u.auth).send({ ready: true }).expect(200);
    }
    // Só o anfitrião inicia; e só com todos prontos.
    const notHost = await h.http.post(`/v1/rooms/${code}/start`).set('authorization', a.auth);
    expect(notHost.body.error.code).toBe('ROOM_NOT_HOST');
    const notReady = await h.http.post(`/v1/rooms/${code}/start`).set('authorization', host.auth);
    expect(notReady.body.error.code).toBe('ROOM_NOT_READY');
    await h.http.post(`/v1/rooms/${code}/ready`).set('authorization', host.auth).send({ ready: true }).expect(200);
    const start = await h.http.post(`/v1/rooms/${code}/start`).set('authorization', host.auth).expect(200);
    const matchId = start.body.data.sessionId as string;
    // Iniciar de novo é idempotente.
    const again = await h.http.post(`/v1/rooms/${code}/start`).set('authorization', host.auth).expect(200);
    expect(again.body.data.sessionId).toBe(matchId);

    const views = await Promise.all([host, a, b, c].map((u) => snapshot(h, u, matchId)));
    expect(new Set(views.map((v) => v.seat))).toEqual(new Set([0, 1, 2, 3]));
    for (const v of views) {
      expect(Object.values(v.meta.players).every((p) => !p.bot)).toBe(true);
    }

    await playToEnd(h, matchId, [host, a, b, c]);
    const match = await h.prisma.match.findUniqueOrThrow({ where: { id: matchId } });
    expect(match.status).toBe('FINISHED');
    const results = await h.prisma.matchResult.findMany({ where: { matchId } });
    expect(results).toHaveLength(4);
    expect(results.filter((r) => r.won)).toHaveLength(2);
    // Parceiros (assentos 0 e 2) têm o mesmo resultado.
    const bySeat = new Map(results.map((r) => [r.seat, r.won]));
    expect(bySeat.get(0)).toBe(bySeat.get(2));
    expect(bySeat.get(1)).toBe(bySeat.get(3));
    expect(bySeat.get(0)).not.toBe(bySeat.get(1));
  });

  it('ação repetida (mesmo actionId) acontece uma vez; jogada fora da vez é recusada', async () => {
    const u = newUser();
    await onboard(h, u);
    const { matchId } = await roomWithBots(h, u);
    // Avança até ser a vez do humano.
    let snap = await snapshot(h, u, matchId);
    for (let i = 0; i < 200 && snap.view!.availableActions.length === 0; i++) {
      await forceTick(h, matchId);
      snap = await snapshot(h, u, matchId);
    }
    const action = pickAction(snap.view!)!;
    const body = { action, actionId: 'dup-action-1' };
    const [r1, r2] = await Promise.all([
      h.http.post(`/v1/matches/${matchId}/actions`).set('authorization', u.auth).send(body),
      h.http.post(`/v1/matches/${matchId}/actions`).set('authorization', u.auth).send(body),
    ]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    const human = await h.prisma.gameAction.count({ where: { matchId, actor: 'HUMAN' } });
    expect(human).toBe(1);
    expect([r1.body.data.duplicate, r2.body.data.duplicate].filter(Boolean)).toHaveLength(1);

    // Assento de outro jogador.
    const wrongSeat = await h.http
      .post(`/v1/matches/${matchId}/actions`)
      .set('authorization', u.auth)
      .send({ action: { ...action, seat: 1 }, actionId: 'wrong-seat-1' });
    expect(wrongSeat.body.error.code).toBe('NOT_YOUR_SEAT');

    // Carta que não está na mão.
    snap = await snapshot(h, u, matchId);
    if (snap.view!.availableActions.includes('PLAY_CARD')) {
      const mine = new Set(snap.view!.myCards.map(cardId));
      const other = ['4P', '4C', '4E', '4O', '5P', '5C', '7O', '3E', 'AE'].find((c) => !mine.has(c))!;
      const bad = await h.http
        .post(`/v1/matches/${matchId}/actions`)
        .set('authorization', u.auth)
        .send({ action: { type: 'PLAY_CARD', seat: 0, cardId: other }, actionId: 'bad-card-1' });
      expect(bad.status).toBe(412);
      expect(['INVALID_CARD', 'INVALID_ACTION']).toContain(bad.body.error.code);
    } else {
      const notTurn = await h.http
        .post(`/v1/matches/${matchId}/actions`)
        .set('authorization', u.auth)
        .send({ action: { type: 'PLAY_CARD', seat: 0, cardId: '4P' }, actionId: 'not-turn-1' });
      expect(['NOT_YOUR_TURN', 'INVALID_ACTION']).toContain(notTurn.body.error.code);
    }

    // Forma inválida é barrada antes do motor.
    const malformed = await h.http
      .post(`/v1/matches/${matchId}/actions`)
      .set('authorization', u.auth)
      .send({ action: { type: 'WIN_MATCH', seat: 0 }, actionId: 'malformed-1' });
    expect(malformed.status).toBe(400);
  });

  it('carta virada: a identidade não chega aos adversários', async () => {
    const [host, a, b, c] = [newUser('cv'), newUser('cv'), newUser('cv'), newUser('cv')];
    for (const u of [host, a, b, c]) await onboard(h, u);
    const room = await h.http.post('/v1/rooms').set('authorization', host.auth).send({}).expect(200);
    const code = room.body.data.code as string;
    for (const u of [a, b, c]) {
      await h.http.post(`/v1/rooms/${code}/join`).set('authorization', u.auth).expect(200);
      await h.http.post(`/v1/rooms/${code}/ready`).set('authorization', u.auth).send({ ready: true }).expect(200);
    }
    await h.http.post(`/v1/rooms/${code}/ready`).set('authorization', host.auth).send({ ready: true }).expect(200);
    const start = await h.http.post(`/v1/rooms/${code}/start`).set('authorization', host.auth).expect(200);
    const matchId = start.body.data.sessionId as string;
    const users = [host, a, b, c];

    // Joga até alguém poder jogar virado e vira a carta.
    for (let step = 0; step < 3000; step++) {
      let covered = false;
      for (const u of users) {
        const snap = await snapshot(h, u, matchId);
        const v = snap.view!;
        if (v.availableActions.includes('PLAY_CARD_COVERED') && v.playableCardIds.length > 0) {
          const played = v.playableCardIds[0]!;
          await h.http
            .post(`/v1/matches/${matchId}/actions`)
            .set('authorization', u.auth)
            .send({ action: { type: 'PLAY_CARD_COVERED', seat: v.seat, cardId: played }, actionId: `cov_${v.version}` })
            .expect(200);
          for (const other of users) {
            const os = await snapshot(h, other, matchId);
            const table = [...os.view!.currentRound, ...os.view!.rounds.flatMap((r) => r.plays)];
            const play = table.find((p) => p.seat === v.seat && p.covered);
            expect(play).toBeDefined();
            if (other === u) expect(play!.card).not.toBeNull();
            else {
              expect(play!.card).toBeNull();
              expect(JSON.stringify(os.view!.recentEvents)).not.toContain(`"covered":true,"card":{`);
            }
          }
          covered = true;
          break;
        }
        const action = pickAction(v);
        if (action)
          await h.http
            .post(`/v1/matches/${matchId}/actions`)
            .set('authorization', u.auth)
            .send({ action, actionId: `pl_${v.version}_${u.uid}` });
      }
      if (covered) return;
      const m = await h.prisma.match.findUniqueOrThrow({ where: { id: matchId } });
      if (m.status !== 'PLAYING') break;
    }
    throw new Error('nenhuma oportunidade de carta virada encontrada');
  });

  it('desconexão: IA temporária assume após a tolerância e o humano reassume ao voltar', async () => {
    const [host, friend] = [newUser('dc'), newUser('dc')];
    for (const u of [host, friend]) await onboard(h, u);
    const room = await h.http.post('/v1/rooms').set('authorization', host.auth).send({}).expect(200);
    const code = room.body.data.code as string;
    await h.http.post(`/v1/rooms/${code}/join`).set('authorization', friend.auth).expect(200);
    await h.http.post(`/v1/rooms/${code}/ready`).set('authorization', friend.auth).send({ ready: true }).expect(200);
    await h.http.post(`/v1/rooms/${code}/ready`).set('authorization', host.auth).send({ ready: true }).expect(200);
    await h.http.post(`/v1/rooms/${code}/fill-bots`).set('authorization', host.auth).expect(200);
    const start = await h.http.post(`/v1/rooms/${code}/start`).set('authorization', host.auth).expect(200);
    const matchId = start.body.data.sessionId as string;
    const friendSeat = (await snapshot(h, friend, matchId)).seat!;

    const friendId = (await h.prisma.user.findUniqueOrThrow({ where: { firebaseUid: friend.uid } })).id;
    await h.game.setConnected(friendId, matchId, false);
    let p = await h.prisma.matchParticipant.findUniqueOrThrow({ where: { matchId_seat: { matchId, seat: friendSeat } } });
    expect(p).toMatchObject({ connected: false, controller: 'HUMAN' });

    advanceClock(1500); // tolerância de teste = 1 s
    await forceTick(h, matchId);
    p = await h.prisma.matchParticipant.findUniqueOrThrow({ where: { matchId_seat: { matchId, seat: friendSeat } } });
    expect(p.controller).toBe('AI_TEMPORARY');
    const v1 = p.controllerVersion;

    // A partida continua com a IA jogando pelo assento dele.
    const before = await h.prisma.gameAction.count({ where: { matchId } });
    for (let i = 0; i < 40; i++) {
      const snap = await snapshot(h, host, matchId);
      const action = pickAction(snap.view!);
      if (action)
        await h.http
          .post(`/v1/matches/${matchId}/actions`)
          .set('authorization', host.auth)
          .send({ action, actionId: `host_${snap.view!.version}` });
      else await forceTick(h, matchId);
    }
    const aiForFriend = await h.prisma.gameAction.count({ where: { matchId, seat: friendSeat, actor: 'AI' } });
    expect(await h.prisma.gameAction.count({ where: { matchId } })).toBeGreaterThan(before);
    expect(aiForFriend).toBeGreaterThan(0);

    // Volta: reassume com versão de controlador nova.
    const rejoin = await h.http.post(`/v1/matches/${matchId}/rejoin`).set('authorization', friend.auth).expect(200);
    expect(rejoin.body.data.ok).toBe(true);
    p = await h.prisma.matchParticipant.findUniqueOrThrow({ where: { matchId_seat: { matchId, seat: friendSeat } } });
    expect(p).toMatchObject({ controller: 'HUMAN', connected: true });
    expect(p.controllerVersion).toBe(v1 + 1);
    const snap = await snapshot(h, friend, matchId);
    expect(snap.meta.players[String(friendSeat)]).toMatchObject({ uid: friend.uid, controller: 'HUMAN' });
  });

  it('abandono com outro humano: vaga vira IA permanente e só quem saiu perde', async () => {
    const [host, friend] = [newUser('ab'), newUser('ab')];
    for (const u of [host, friend]) await onboard(h, u);
    const room = await h.http.post('/v1/rooms').set('authorization', host.auth).send({}).expect(200);
    const code = room.body.data.code as string;
    await h.http.post(`/v1/rooms/${code}/join`).set('authorization', friend.auth).expect(200);
    await h.http.post(`/v1/rooms/${code}/ready`).set('authorization', friend.auth).send({ ready: true }).expect(200);
    await h.http.post(`/v1/rooms/${code}/ready`).set('authorization', host.auth).send({ ready: true }).expect(200);
    await h.http.post(`/v1/rooms/${code}/fill-bots`).set('authorization', host.auth).expect(200);
    const matchId = (await h.http.post(`/v1/rooms/${code}/start`).set('authorization', host.auth).expect(200)).body.data
      .sessionId as string;

    await h.http.post(`/v1/matches/${matchId}/abandon`).set('authorization', friend.auth).expect(200);
    // Abandonar duas vezes não faz nada de novo.
    await h.http.post(`/v1/matches/${matchId}/abandon`).set('authorization', friend.auth).expect(200);
    const forfeits = await h.prisma.matchResult.findMany({ where: { matchId } });
    expect(forfeits).toHaveLength(1);
    expect(forfeits[0]).toMatchObject({ won: false, forfeit: true });
    const m = await h.prisma.match.findUniqueOrThrow({ where: { id: matchId } });
    expect(m.status).toBe('PLAYING');
    const seats = await h.prisma.matchParticipant.findMany({ where: { matchId } });
    expect(seats.filter((s) => s.controller === 'AI_PERMANENT')).toHaveLength(3);
    expect(seats.find((s) => s.replacedUserId)).toBeDefined();

    // O último humano sai: a dupla dele entrega.
    await h.http.post(`/v1/matches/${matchId}/abandon`).set('authorization', host.auth).expect(200);
    const done = await h.prisma.match.findUniqueOrThrow({ where: { id: matchId } });
    expect(done.status).toBe('ABANDONED');
    expect(await h.prisma.matchResult.count({ where: { matchId } })).toBe(2);
    const roomRow = await h.prisma.room.findUniqueOrThrow({ where: { code } });
    expect(roomRow).toMatchObject({ status: 'CLOSED', closedReason: 'ABANDONED' });
    const friendHistory = await h.http.get('/v1/matches').set('authorization', friend.auth).expect(200);
    expect(friendHistory.body.data.items[0].players.find((p: { uid: string }) => p.uid === friend.uid)).toBeDefined();
  });

  it('timeout do servidor: sem ação dentro do prazo, o servidor joga pelo humano', async () => {
    const u = newUser('to');
    await onboard(h, u);
    const { matchId } = await roomWithBots(h, u);
    let snap = await snapshot(h, u, matchId);
    for (let i = 0; i < 200 && snap.view!.availableActions.length === 0; i++) {
      await forceTick(h, matchId);
      snap = await snapshot(h, u, matchId);
    }
    expect(snap.view!.turnDeadlineAt).toBeGreaterThan(Date.now());
    const version = snap.view!.version;
    // Antes do prazo nada acontece.
    await forceTick(h, matchId);
    expect((await snapshot(h, u, matchId)).view!.version).toBe(version);
    advanceClock(TURN_TIMING.turnMs + TURN_TIMING.serverGraceMs + 1000);
    await forceTick(h, matchId);
    const after = await snapshot(h, u, matchId);
    expect(after.view!.version).toBeGreaterThan(version);
    expect(await h.prisma.gameAction.count({ where: { matchId, actor: 'TIMEOUT' } })).toBe(1);
  });

  it('pedido de truco e resposta passam pelo motor (escada 1→3)', async () => {
    const [host, a, b, c] = [newUser('tr'), newUser('tr'), newUser('tr'), newUser('tr')];
    for (const u of [host, a, b, c]) await onboard(h, u);
    const code = (await h.http.post('/v1/rooms').set('authorization', host.auth).send({}).expect(200)).body.data.code;
    for (const u of [a, b, c]) {
      await h.http.post(`/v1/rooms/${code}/join`).set('authorization', u.auth).expect(200);
      await h.http.post(`/v1/rooms/${code}/ready`).set('authorization', u.auth).send({ ready: true }).expect(200);
    }
    await h.http.post(`/v1/rooms/${code}/ready`).set('authorization', host.auth).send({ ready: true }).expect(200);
    const matchId = (await h.http.post(`/v1/rooms/${code}/start`).set('authorization', host.auth).expect(200)).body.data
      .sessionId as string;
    const users = [host, a, b, c];
    for (let step = 0; step < 500; step++) {
      for (const u of users) {
        const v = (await snapshot(h, u, matchId)).view!;
        if (v.availableActions.includes('REQUEST_TRUCO')) {
          await h.http
            .post(`/v1/matches/${matchId}/actions`)
            .set('authorization', u.auth)
            .send({ action: { type: 'REQUEST_TRUCO', seat: v.seat } as GameAction, actionId: `tr_${v.version}` })
            .expect(200);
          const responder = users.find((x) => x !== u && ((users.indexOf(x) % 2) as Seat) !== users.indexOf(u) % 2)!;
          const rv = (await snapshot(h, responder, matchId)).view!;
          expect(rv.phase).toBe('TRUCO_RESPONSE');
          expect(rv.proposedValue).toBe(3);
          expect(rv.availableActions).toEqual(expect.arrayContaining(['ACCEPT_TRUCO', 'RUN']));
          await h.http
            .post(`/v1/matches/${matchId}/actions`)
            .set('authorization', responder.auth)
            .send({ action: { type: 'ACCEPT_TRUCO', seat: rv.seat }, actionId: `ac_${rv.version}` })
            .expect(200);
          const after = (await snapshot(h, u, matchId)).view!;
          expect(after.handValue).toBe(3);
          const p = await h.prisma.matchParticipant.findFirstOrThrow({ where: { matchId, seat: rv.seat } });
          expect(p.trucosAccepted).toBe(1);
          return;
        }
        const action = pickAction(v);
        if (action)
          await h.http
            .post(`/v1/matches/${matchId}/actions`)
            .set('authorization', u.auth)
            .send({ action, actionId: `x_${v.version}_${u.uid}` });
      }
    }
    throw new Error('truco não ficou disponível');
  });
});


