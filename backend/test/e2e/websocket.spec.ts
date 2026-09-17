import type { Socket } from 'socket.io-client';
import { io } from 'socket.io-client';
import {
  connectSocket,
  emitAck,
  Harness,
  makeFriends,
  newUser,
  onboard,
  pickAction,
  resetDb,
  sleep,
  startHarness,
  TestUser,
  waitFor,
} from '../helpers/harness';
import type { SeatViewPayload } from '../../src/game/game-views';

describe('WebSocket (Socket.IO /rt) — E2E', () => {
  let h: Harness;
  const sockets: Socket[] = [];
  beforeAll(async () => {
    process.env.SCHEDULER_ENABLED = 'true';
    h = await startHarness();
  });
  afterAll(async () => {
    delete process.env.SCHEDULER_ENABLED;
    await h.close();
  });
  beforeEach(async () => resetDb(h));
  afterEach(() => {
    for (const s of sockets.splice(0)) s.disconnect();
  });

  const connect = async (u: TestUser) => {
    const s = await connectSocket(h, u);
    sockets.push(s);
    return s;
  };

  it('app fechado durante a busca de partida: sem socket, a busca é cancelada', async () => {
    const u = newUser('mmws');
    await onboard(h, u);
    const s = await connect(u);
    await h.http.post('/v1/matchmaking').set('authorization', u.auth).send({}).expect(200);
    s.disconnect();
    const statusOf = async () =>
      (await h.http.get('/v1/matchmaking').set('authorization', u.auth)).body.data.entry?.status;
    let status = await statusOf();
    for (let i = 0; i < 50 && status !== 'cancelled'; i++) {
      await sleep(100);
      status = await statusOf();
    }
    expect(status).toBe('cancelled');
    // Queda curta com reconexão dentro da carência não cancela.
    await h.http.post('/v1/matchmaking').set('authorization', u.auth).send({}).expect(200);
    const s2 = await connect(u);
    s2.disconnect();
    await connect(u);
    await sleep(800);
    expect(await statusOf()).toBe('searching');
  });

  it('recusa conexão sem token, com token inválido e de usuário sem cadastro', async () => {
    const attempt = (auth: object) =>
      new Promise<{ message: string; data?: { code: string } }>((resolve) => {
        const s = io(`${h.url}/rt`, { transports: ['websocket'], auth, reconnection: false, forceNew: true });
        s.once('connect_error', (e) => {
          s.close();
          resolve(e as unknown as { message: string; data?: { code: string } });
        });
        s.once('connect', () => {
          s.close();
          resolve({ message: 'CONNECTED' });
        });
      });
    expect((await attempt({})).message).toBe('AUTH_TOKEN_MISSING');
    expect((await attempt({ token: 'lixo' })).message).toBe('AUTH_TOKEN_INVALID');
    expect((await attempt({ token: 'test:naoexiste01:' })).message).toBe('USER_NOT_FOUND');
  });

  it('presença: amigo online/offline em tempo real, contagem e estado na partida', async () => {
    const [a, b] = [newUser('pa'), newUser('pb')];
    await onboard(h, a);
    await onboard(h, b);
    await makeFriends(h, a, b);
    const sa = await connect(a);
    const sub = await emitAck<{ presence: Record<string, { state: string }> }>(sa, 'presence.subscribe', { uids: [b.uid] });
    expect(sub.ok).toBe(true);
    expect(sub.data!.presence[b.uid]!.state).toBe('offline');

    const online = waitFor<{ uid: string; presence: { state: string } }>(sa, 'presence.changed', (p) => p.uid === b.uid);
    const sb = await connect(b);
    expect((await online).presence.state).toBe('online');
    const friends = await h.http.get('/v1/friends').set('authorization', a.auth).expect(200);
    expect(friends.body.data.friends[0].presence.state).toBe('online');

    const inMatch = waitFor<{ uid: string; presence: { state: string } }>(sa, 'presence.changed', (p) => p.presence.state === 'in_match');
    expect((await emitAck(sb, 'presence.set', { state: 'IN_MATCH' })).ok).toBe(true);
    expect((await inMatch).uid).toBe(b.uid);

    const count = await h.http.get('/v1/stats/online').set('authorization', a.auth).expect(200);
    expect(count.body.data.count).toBe(2);

    const offline = waitFor<{ uid: string; presence: { state: string } }>(sa, 'presence.changed', (p) => p.presence.state === 'offline');
    sb.disconnect();
    expect((await offline).uid).toBe(b.uid);
    const bad = await emitAck(sa, 'presence.set', { state: 'INVISIBLE' });
    expect(bad).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
  });

  it('convite em tempo real: dono cria sala, amigo recebe na caixa, entra e o dono vê', async () => {
    const [host, friend] = [newUser('ih'), newUser('if')];
    await onboard(h, host);
    await onboard(h, friend);
    await makeFriends(h, host, friend);
    const sh = await connect(host);
    const sf = await connect(friend);
    const inboxEvent = waitFor<{ invites: { code: string }[] }>(sf, 'invites.updated', (p) => p.invites.length > 0);
    const created = await h.http.post('/v1/rooms/friends').set('authorization', host.auth).send({ friendUids: [friend.uid] }).expect(200);
    const code = created.body.data.code as string;
    expect((await inboxEvent).invites[0]!.code).toBe(code);

    const sub = await emitAck<{ room: { code: string } }>(sh, 'room.subscribe', { code });
    expect(sub.data!.room.code).toBe(code);
    const joined = waitFor<{ room: { players: Record<string, unknown> } }>(sh, 'room.updated', (p) => Boolean(p.room?.players[friend.uid]));
    const accept = await emitAck<{ code: string }>(sf, 'room.invite.accept', { code });
    expect(accept).toMatchObject({ ok: true, data: { code } });
    await joined;

    const invalid = await emitAck(sf, 'room.subscribe', { code: 'x' });
    expect(invalid).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
  });

  it('2x2 com quatro clientes Socket.IO: partida completa, views privadas, queda e reconexão', async () => {
    const users = [newUser('w0'), newUser('w1'), newUser('w2'), newUser('w3')];
    for (const u of users) await onboard(h, u);
    const code = (await h.http.post('/v1/rooms').set('authorization', users[0]!.auth).send({}).expect(200)).body.data.code;
    const clients = await Promise.all(users.map((u) => connect(u)));
    for (const [i, s] of clients.entries()) {
      if (i > 0) expect((await emitAck(s, 'room.join', { code })).ok).toBe(true);
      expect((await emitAck(s, 'room.ready', { code, ready: true })).ok).toBe(true);
    }
    const activeEvents = clients.map((s) => waitFor<{ matchId: string }>(s, 'user.active-match', (p) => Boolean(p.matchId)));
    const start = await h.http.post(`/v1/rooms/${code}/start`).set('authorization', users[0]!.auth).expect(200);
    const matchId = start.body.data.sessionId as string;
    for (const e of activeEvents) expect((await e).matchId).toBe(matchId);

    const latest = new Map<number, SeatViewPayload>();
    const seatOf = new Map<Socket, number>();
    const results: unknown[] = [];
    const attach = (s: Socket) => {
      s.on('game.view', (v: SeatViewPayload) => {
        const prev = latest.get(v.seat);
        if (!prev || prev.version <= v.version) latest.set(v.seat, v);
      });
      s.on('game.result', (r: unknown) => results.push(r));
    };
    for (const s of clients) {
      attach(s);
      const joined = await emitAck<{ seat: number; view: SeatViewPayload }>(s, 'game.join', { matchId });
      expect(joined.ok).toBe(true);
      seatOf.set(s, joined.data!.seat);
      latest.set(joined.data!.seat, joined.data!.view);
      // Nenhum cliente recebe a mão de outro.
      expect(joined.data!.view.myCards.length).toBeLessThanOrEqual(3);
    }
    expect(new Set(seatOf.values())).toEqual(new Set([0, 1, 2, 3]));

    // Um cliente tentando jogar pelo assento de outro é recusado.
    const intruder = await emitAck(clients[0]!, 'game.action', {
      matchId,
      actionId: 'intruder-1',
      action: { type: 'FINISH_SHUFFLE', seat: 3 },
    });
    expect(intruder.ok).toBe(false);

    let dropped = false;
    let reconnected = false;
    const deadline = Date.now() + 150_000;
    let actions = 0;
    while (Date.now() < deadline) {
      const match = await h.prisma.match.findUniqueOrThrow({ where: { id: matchId }, select: { status: true } });
      if (match.status !== 'PLAYING') break;
      // No meio da partida, o cliente 3 cai e volta.
      if (!dropped && actions === 15) {
        dropped = true;
        clients[3]!.disconnect();
        await sleep(200);
        const p = await h.prisma.matchParticipant.findFirstOrThrow({ where: { matchId, seat: seatOf.get(clients[3]!)! } });
        expect(p.connected).toBe(false);
        const fresh = await connect(users[3]!);
        attach(fresh);
        const rejoin = await emitAck<{ seat: number; view: SeatViewPayload; meta: { players: Record<string, { connected: boolean }> } }>(
          fresh,
          'game.reconnect',
          { matchId },
        );
        expect(rejoin.ok).toBe(true);
        expect(rejoin.data!.seat).toBe(seatOf.get(clients[3]!));
        seatOf.set(fresh, rejoin.data!.seat);
        clients[3] = fresh;
        reconnected = true;
      }
      let acted = false;
      for (const s of clients) {
        const seat = seatOf.get(s)!;
        const v = latest.get(seat);
        if (!v) continue;
        const action = pickAction(v);
        if (!action) continue;
        const res = await emitAck(s, 'game.action', { matchId, action, actionId: `ws_${v.version}_${seat}` });
        if (res.ok) {
          acted = true;
          actions++;
        } else if (!['NOT_YOUR_TURN', 'INVALID_ACTION', 'INVALID_CARD'].includes(res.error!.code)) {
          throw new Error(JSON.stringify(res.error));
        }
      }
      if (!acted) {
        // Resincroniza por snapshot (como o app faz ao voltar do background).
        for (const s of clients) {
          const sync = await emitAck<{ view: SeatViewPayload }>(s, 'game.sync', { matchId });
          if (sync.ok && sync.data!.view) latest.set(sync.data!.view.seat, sync.data!.view);
        }
        await sleep(30);
      }
    }
    const match = await h.prisma.match.findUniqueOrThrow({ where: { id: matchId } });
    expect(match.status).toBe('FINISHED');
    expect(dropped && reconnected).toBe(true);
    await sleep(300);
    expect(results.length).toBeGreaterThanOrEqual(3);
    const final = latest.get(0)!;
    expect(final.status).toBe('FINISHED');
    const metrics = await h.http.get('/metrics').set('x-admin-secret', 'test-admin-secret').expect(200);
    expect(metrics.text).toMatch(/ws_connected_sockets \d+/);
  });

  it('IA joga sozinha quando o humano está conectado mas é a vez dos bots (agendador do servidor)', async () => {
    const u = newUser('bots');
    await onboard(h, u);
    const code = (await h.http.post('/v1/rooms').set('authorization', u.auth).send({}).expect(200)).body.data.code;
    await h.http.post(`/v1/rooms/${code}/fill-bots`).set('authorization', u.auth).expect(200);
    await h.http.post(`/v1/rooms/${code}/ready`).set('authorization', u.auth).send({ ready: true }).expect(200);
    const s = await connect(u);
    const matchId = (await h.http.post(`/v1/rooms/${code}/start`).set('authorization', u.auth).expect(200)).body.data.sessionId;
    const views: SeatViewPayload[] = [];
    s.on('game.view', (v: SeatViewPayload) => views.push(v));
    await emitAck(s, 'game.join', { matchId });
    // Sem nenhum pedido do cliente, o servidor faz a IA agir (cerimônia do dealer, que é IA).
    await waitFor<SeatViewPayload>(s, 'game.view', (v) => v.version > 0, 15_000);
    expect(views.some((v) => v.recentEvents.length > 0)).toBe(true);
    const advance = await emitAck(s, 'game.advance-bots', { matchId });
    expect(advance.ok).toBe(true);
  });
});
