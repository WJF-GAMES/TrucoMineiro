import { Harness, makeFriends, newUser, onboard, playToEnd, resetDb, snapshot, startHarness, TestUser } from '../helpers/harness';
import { advanceClock } from '../../src/common/clock';
import { PushService } from '../../src/notifications/push.service';

async function friendRoom(h: Harness, host: TestUser, friends: TestUser[]) {
  const res = await h.http
    .post('/v1/rooms/friends')
    .set('authorization', host.auth)
    .send({ friendUids: friends.map((f) => f.uid) });
  if (res.status !== 200) throw new Error(JSON.stringify(res.body));
  return res.body.data as { code: string; inviteExpiresAt: number };
}

const room = async (h: Harness, u: TestUser, code: string) =>
  (await h.http.get(`/v1/rooms/${code}`).set('authorization', u.auth).expect(200)).body.data;
const inbox = async (h: Harness, u: TestUser) =>
  (await h.http.get('/v1/invites').set('authorization', u.auth).expect(200)).body.data.invites as {
    code: string;
    from: string;
    inviteId: string;
  }[];

describe('Salas, convites e vagas com IA', () => {
  let h: Harness;
  let pushSpy: jest.SpyInstance;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => h.close());
  beforeEach(async () => {
    await resetDb(h);
    pushSpy?.mockRestore();
    pushSpy = jest.spyOn(h.app.get(PushService), 'notify');
  });

  async function crew(n: number) {
    const host = newUser('host');
    const friends = Array.from({ length: n }, (_, i) => newUser(`amigo${i}`));
    await onboard(h, host);
    for (const f of friends) {
      await onboard(h, f);
      await makeFriends(h, host, f);
    }
    return { host, friends };
  }

  it('cria sala com 3 amigos: vagas reservadas, caixa de entrada e push', async () => {
    const { host, friends } = await crew(3);
    pushSpy.mockClear();
    const { code, inviteExpiresAt } = await friendRoom(h, host, friends);
    expect(inviteExpiresAt).toBeGreaterThan(Date.now());
    const r = await room(h, host, code);
    expect(r).toMatchObject({ status: 'waiting', hostUid: host.uid, fillWithAi: 'on_timeout' });
    expect(Object.keys(r.players)).toEqual([host.uid]);
    expect(Object.values(r.invites).map((i) => (i as { seat: number }).seat).sort()).toEqual([1, 2, 3]);
    for (const f of friends) {
      const list = await inbox(h, f);
      expect(list).toEqual([expect.objectContaining({ code, from: host.uid, inviteId: `${code}_${f.uid}` })]);
    }
    expect(pushSpy).toHaveBeenCalledTimes(3);
    expect(pushSpy.mock.calls[0]![1]).toMatchObject({
      type: 'ROOM_INVITE',
      data: { type: 'room_invite', code },
    });
  });

  it('só amigos podem ser chamados; limite de 3', async () => {
    const { host, friends } = await crew(1);
    const stranger = newUser('estranho');
    await onboard(h, stranger);
    const res = await h.http.post('/v1/rooms/friends').set('authorization', host.auth).send({ friendUids: [stranger.uid] });
    expect(res.body.error.code).toBe('NOT_FRIENDS');
    const many = await h.http
      .post('/v1/rooms/friends')
      .set('authorization', host.auth)
      .send({ friendUids: [friends[0]!.uid, 'a1234', 'b1234', 'c1234'] });
    expect(many.status).toBe(400);
  });

  it('convidados aceitam (idempotente), um recusa; o dono inicia a partida', async () => {
    const { host, friends } = await crew(3);
    const { code } = await friendRoom(h, host, friends);
    const [a, b, c] = friends as [TestUser, TestUser, TestUser];
    const acc = await h.http.post(`/v1/invites/${code}/respond`).set('authorization', a.auth).send({ accept: true }).expect(200);
    expect(acc.body.data).toMatchObject({ code, sessionId: null });
    await h.http.post(`/v1/invites/${code}/respond`).set('authorization', a.auth).send({ accept: true }).expect(200);
    await h.http.post(`/v1/rooms/${code}/join`).set('authorization', b.auth).expect(200); // pelo código também usa a reserva
    await h.http.post(`/v1/invites/${code}/respond`).set('authorization', c.auth).send({ accept: false }).expect(200);
    const r = await room(h, host, code);
    expect(r.players[a.uid]).toMatchObject({ seat: 1, ready: true });
    expect(r.players[b.uid]).toMatchObject({ seat: 2, ready: true });
    expect(r.invites[c.uid].status).toBe('DECLINED');
    expect(await inbox(h, a)).toHaveLength(0);
    expect(await inbox(h, c)).toHaveLength(0);

    const notFull = await h.http.post(`/v1/rooms/${code}/start`).set('authorization', host.auth);
    expect(notFull.body.error.code).toBe('ROOM_NOT_READY');
    await h.http.post(`/v1/rooms/${code}/fill-bots`).set('authorization', host.auth).expect(200);
    const start = await h.http.post(`/v1/rooms/${code}/start`).set('authorization', host.auth).expect(200);
    const matchId = start.body.data.sessionId;
    const snap = await snapshot(h, a, matchId);
    expect(snap.seat).toBe(1);
    const late = await h.http.post(`/v1/invites/${code}/respond`).set('authorization', c.auth).send({ accept: true });
    expect(late.status).toBe(412);
    expect(late.body.error).toMatchObject({ code: 'ROOM_STARTED', message: 'A partida já começou.' });
  });

  it('fim da espera: o servidor completa com IA e começa sozinho; convidado atrasado assume no ponto seguro', async () => {
    const { host, friends } = await crew(2);
    const [a, late] = friends as [TestUser, TestUser];
    const { code } = await friendRoom(h, host, friends);
    await h.http.post(`/v1/invites/${code}/respond`).set('authorization', a.auth).send({ accept: true }).expect(200);

    const early = await h.http.post(`/v1/rooms/${code}/lobby-timeout`).set('authorization', host.auth);
    expect(early.body.error.code).toBe('ROOM_WAITING_INVITES');

    advanceClock(31_000);
    await h.scheduler.runOnce(); // agendador do servidor, sem ninguém pedir
    const r = await room(h, host, code);
    expect(r.status).toBe('in_match');
    const matchId = r.sessionId as string;
    const lateSeat = Object.values(r.players as Record<string, { seat: number; bot: boolean; reservedFor: string | null }>).find(
      (p) => p.reservedFor === late.uid,
    );
    expect(lateSeat).toMatchObject({ bot: true, seat: 2 });
    expect(r.invites[late.uid].status).toBe('AI_FILLED');
    // Ainda na caixa de entrada: pode entrar atrasado.
    expect((await inbox(h, late)).map((i) => i.code)).toEqual([code]);

    const join = await h.http.post(`/v1/invites/${code}/respond`).set('authorization', late.auth).send({ accept: true }).expect(200);
    expect(join.body.data).toMatchObject({ code, sessionId: matchId, pending: true });

    // Até o ponto seguro ele fica pendente; depois assume a vaga.
    let status = 'pending';
    for (let i = 0; i < 400 && status !== 'seated'; i++) {
      const claim = await h.http.post(`/v1/matches/${matchId}/claim-seat`).set('authorization', late.auth).expect(200);
      status = claim.body.data.status;
      if (status === 'seated') break;
      for (const u of [host, a]) {
        const s = await snapshot(h, u, matchId);
        const v = s.view!;
        const act = v.availableActions.includes('FINISH_SHUFFLE')
          ? { type: 'FINISH_SHUFFLE', seat: v.seat }
          : v.availableActions.includes('FINISH_CUT')
            ? { type: 'FINISH_CUT', seat: v.seat }
            : v.availableActions.includes('PLAY_CARD')
              ? { type: 'PLAY_CARD', seat: v.seat, cardId: v.playableCardIds[0] }
              : v.availableActions.includes('ACCEPT_MAO_DE_ONZE')
                ? { type: 'ACCEPT_MAO_DE_ONZE', seat: v.seat }
                : null;
        if (act)
          await h.http
            .post(`/v1/matches/${matchId}/actions`)
            .set('authorization', u.auth)
            .send({ action: act, actionId: `late_${v.version}_${u.uid}` });
      }
      await h.prisma.match.update({ where: { id: matchId }, data: { nextTickAt: new Date(Date.now() - 1) } });
      await h.scheduler.runOnce();
    }
    expect(status).toBe('seated');
    const snap = await snapshot(h, late, matchId);
    expect(snap.seat).toBe(2);
    expect(snap.meta.players['2']).toMatchObject({ uid: late.uid, bot: false, controller: 'HUMAN' });
    const after = await room(h, host, code);
    expect(after.players[late.uid]).toMatchObject({ seat: 2, bot: false });
    expect(after.invites[late.uid].status).toBe('ACCEPTED');
    // Só existe um controlador por assento.
    const seats = await h.prisma.matchParticipant.findMany({ where: { matchId } });
    expect(new Set(seats.map((s) => s.seat)).size).toBe(4);

    await playToEnd(h, matchId, [host, a, late]);
    expect(await h.prisma.matchResult.count({ where: { matchId } })).toBe(3);
  });

  it('dono sai antes de começar: sala cancelada e convites somem', async () => {
    const { host, friends } = await crew(1);
    const { code } = await friendRoom(h, host, friends);
    await h.http.post(`/v1/rooms/${code}/leave`).set('authorization', host.auth).expect(200);
    const r = await room(h, host, code);
    expect(r).toMatchObject({ status: 'closed', closedReason: 'cancelled' });
    expect(await inbox(h, friends[0]!)).toHaveLength(0);
    const accept = await h.http.post(`/v1/invites/${code}/respond`).set('authorization', friends[0]!.auth).send({ accept: true });
    expect(accept.body.error).toMatchObject({ code: 'ROOM_CANCELLED', message: 'Esta sala foi cancelada.' });
  });

  it('dono troca convidado: remove um e convida outro na mesma vaga', async () => {
    const { host, friends } = await crew(2);
    const [a, b] = friends as [TestUser, TestUser];
    const { code } = await friendRoom(h, host, [a]);
    await h.http.delete(`/v1/rooms/${code}/invites/${a.uid}`).set('authorization', host.auth).expect(200);
    expect(await inbox(h, a)).toHaveLength(0);
    await h.http.post(`/v1/rooms/${code}/invites`).set('authorization', host.auth).send({ friendUid: b.uid }).expect(200);
    // Reenviar não duplica.
    await h.http.post(`/v1/rooms/${code}/invites`).set('authorization', host.auth).send({ friendUid: b.uid }).expect(200);
    const r = await room(h, host, code);
    expect(Object.keys(r.invites)).toEqual([b.uid]);
    expect(r.invites[b.uid].seat).toBe(1);
    const notHost = await h.http.post(`/v1/rooms/${code}/invites`).set('authorization', b.auth).send({ friendUid: host.uid });
    expect(notHost.body.error.code).toBe('ROOM_NOT_HOST');
  });

  it('convite direto para contato da agenda (não amigo) → aceite ocupa assento livre', async () => {
    const host = newUser('dh');
    const contact = newUser('dc');
    await onboard(h, host);
    await onboard(h, contact);
    const code = (await h.http.post('/v1/rooms').set('authorization', host.auth).send({}).expect(200)).body.data.code;
    const denied = await h.http.post(`/v1/rooms/${code}/invites/direct`).set('authorization', host.auth).send({ friendUid: contact.uid });
    expect(denied.body.error.code).toBe('NOT_FRIENDS');
    const wrongPhone = await h.http
      .post(`/v1/rooms/${code}/invites/direct`)
      .set('authorization', host.auth)
      .send({ friendUid: contact.uid, phones: ['+5531900000000'] });
    expect(wrongPhone.body.error.code).toBe('NOT_FRIENDS');
    await h.http
      .post(`/v1/rooms/${code}/invites/direct`)
      .set('authorization', host.auth)
      .send({ friendUid: contact.uid, phones: [contact.phone] })
      .expect(200);
    expect((await inbox(h, contact)).map((i) => i.code)).toEqual([code]);
    const res = await h.http.post(`/v1/invites/${code}/respond`).set('authorization', contact.auth).send({ accept: true }).expect(200);
    expect(res.body.data.code).toBe(code);
    const r = await room(h, host, code);
    expect(r.players[contact.uid]).toMatchObject({ seat: 1, bot: false });
  });

  it('sala cheia e sala inexistente devolvem erros previsíveis', async () => {
    const users = Array.from({ length: 5 }, () => newUser('cheia'));
    for (const u of users) await onboard(h, u);
    const code = (await h.http.post('/v1/rooms').set('authorization', users[0]!.auth).send({}).expect(200)).body.data.code;
    for (const u of users.slice(1, 4)) await h.http.post(`/v1/rooms/${code}/join`).set('authorization', u.auth).expect(200);
    const full = await h.http.post(`/v1/rooms/${code}/join`).set('authorization', users[4]!.auth);
    expect(full.status).toBe(429);
    expect(full.body.error.code).toBe('ROOM_FULL');
    const missing = await h.http.post('/v1/rooms/ZZZZZZ/join').set('authorization', users[4]!.auth);
    expect(missing.body.error.code).toBe('ROOM_NOT_FOUND');
    const invalid = await h.http.post('/v1/rooms/abc/join').set('authorization', users[4]!.auth);
    expect(invalid.status).toBe(400);
  });

  it('FCM fora do ar não corrompe a sala', async () => {
    const { host, friends } = await crew(1);
    pushSpy.mockRejectedValue(new Error('FCM indisponível'));
    const { code } = await friendRoom(h, host, friends);
    const r = await room(h, host, code);
    expect(r.status).toBe('waiting');
    expect(Object.keys(r.invites)).toEqual([friends[0]!.uid]);
    await h.http.post(`/v1/invites/${code}/respond`).set('authorization', friends[0]!.auth).send({ accept: true }).expect(200);
  });

  it('em outra partida: não pode criar sala de amigos', async () => {
    const { host, friends } = await crew(1);
    const code = (await h.http.post('/v1/rooms').set('authorization', host.auth).send({}).expect(200)).body.data.code;
    await h.http.post(`/v1/rooms/${code}/fill-bots`).set('authorization', host.auth).expect(200);
    await h.http.post(`/v1/rooms/${code}/ready`).set('authorization', host.auth).send({ ready: true }).expect(200);
    await h.http.post(`/v1/rooms/${code}/start`).set('authorization', host.auth).expect(200);
    const busy = await h.http.post('/v1/rooms/friends').set('authorization', host.auth).send({ friendUids: [friends[0]!.uid] });
    expect(busy.body.error.code).toBe('ALREADY_IN_MATCH');
  });

  it('limpeza: lobby esquecido expira e sala fechada antiga é apagada', async () => {
    const { host, friends } = await crew(1);
    const { code } = await friendRoom(h, host, friends);
    await h.prisma.room.update({ where: { code }, data: { updatedAt: new Date(Date.now() - 11 * 60_000), fillPolicy: null } });
    const rooms = h.app.get((await import('../../src/rooms/rooms.service')).RoomsService);
    const swept = await rooms.sweep();
    expect(swept.expired).toBe(1);
    expect((await room(h, host, code)).closedReason).toBe('expired');
    await h.prisma.$executeRaw`UPDATE "Room" SET "updatedAt" = now() - interval '2 hours' WHERE code = ${code}`;
    const again = await rooms.sweep();
    expect(again.removed).toBe(1);
    await h.http.get(`/v1/rooms/${code}`).set('authorization', host.auth).expect(404);
  });

  it('dono exclui a conta no meio da partida: a sala passa para outro humano e a partida segue', async () => {
    const host = newUser('delhost');
    const guest = newUser('delguest');
    await onboard(h, host);
    await onboard(h, guest);
    const created = await h.http.post('/v1/rooms').set('authorization', host.auth).send({}).expect(200);
    const code = created.body.data.code as string;
    await h.http.post(`/v1/rooms/${code}/join`).set('authorization', guest.auth).expect(200);
    await h.http.post(`/v1/rooms/${code}/fill-bots`).set('authorization', host.auth).expect(200);
    for (const u of [host, guest]) await h.http.post(`/v1/rooms/${code}/ready`).set('authorization', u.auth).send({ ready: true }).expect(200);
    const started = await h.http.post(`/v1/rooms/${code}/start`).set('authorization', host.auth).expect(200);
    const matchId = started.body.data.sessionId as string;
    await h.http.delete('/v1/me').set('authorization', host.auth).expect(200);
    const guestId = (await h.prisma.user.findUniqueOrThrow({ where: { firebaseUid: guest.uid } })).id;
    const r = await h.prisma.room.findUniqueOrThrow({ where: { code } });
    expect(r.hostUserId).toBe(guestId);
    const match = await h.prisma.match.findUniqueOrThrow({ where: { id: matchId } });
    expect(match).toMatchObject({ status: 'PLAYING', roomId: r.id });
    const snap = await snapshot(h, guest, matchId);
    expect(snap.meta.status).toBe('playing');
  });
});
