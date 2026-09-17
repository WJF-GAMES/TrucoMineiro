import { bootstrap, Harness, makeFriends, newUser, onboard, resetDb, startHarness } from '../helpers/harness';
import { AUTO_CONNECT_DAILY_LIMIT, MATCH_DAILY_CALLS } from '../../src/contacts/contacts.service';
import { AppConfig, CONFIG } from '../../src/config/env';
import { FirebaseAdminService } from '../../src/firebase/firebase-admin.service';

describe('Amigos, contatos e bloqueios', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => h.close());
  beforeEach(async () => resetDb(h));

  const friendsOf = async (auth: string) =>
    (await h.http.get('/v1/friends').set('authorization', auth).expect(200)).body.data.friends as {
      uid: string;
      source: string;
      presence: { state: string };
    }[];

  it('solicitação → aceite → amizade única (uma linha por par)', async () => {
    const [a, b] = [newUser('fa'), newUser('fb')];
    await onboard(h, a);
    await onboard(h, b);
    await h.http.post('/v1/friends/requests').set('authorization', a.auth).send({ toUid: b.uid }).expect(200);
    const dup = await h.http.post('/v1/friends/requests').set('authorization', a.auth).send({ toUid: b.uid });
    expect(dup.body.error.code).toBe('FRIEND_REQUEST_EXISTS');
    const reqs = await h.http.get('/v1/friends/requests').set('authorization', b.auth).expect(200);
    expect(reqs.body.data.incoming).toHaveLength(1);
    expect(reqs.body.data.incoming[0]).toMatchObject({ from: a.uid, to: b.uid, fromNickname: a.nickname, status: 'pending' });
    const out = await h.http.get('/v1/friends/requests').set('authorization', a.auth).expect(200);
    expect(out.body.data.outgoing[0]).toMatchObject({ to: b.uid, toNickname: b.nickname });

    // Só o destinatário responde.
    const wrong = await h.http
      .post(`/v1/friends/requests/${reqs.body.data.incoming[0].id}/respond`)
      .set('authorization', a.auth)
      .send({ accept: true });
    expect(wrong.body.error.code).toBe('FRIEND_REQUEST_NOT_YOURS');
    await h.http
      .post(`/v1/friends/requests/${reqs.body.data.incoming[0].id}/respond`)
      .set('authorization', b.auth)
      .send({ accept: true })
      .expect(200);
    expect((await friendsOf(a.auth)).map((f) => f.uid)).toEqual([b.uid]);
    expect((await friendsOf(b.auth)).map((f) => f.uid)).toEqual([a.uid]);
    expect(await h.prisma.friendship.count()).toBe(1);
    const again = await h.http.post('/v1/friends/requests').set('authorization', b.auth).send({ toUid: a.uid });
    expect(again.body.error.code).toBe('FRIEND_ALREADY');
  });

  it('solicitações cruzadas simultâneas viram uma amizade só', async () => {
    const [a, b] = [newUser(), newUser()];
    await onboard(h, a);
    await onboard(h, b);
    await Promise.all([
      h.http.post('/v1/friends/requests').set('authorization', a.auth).send({ toUid: b.uid }),
      h.http.post('/v1/friends/requests').set('authorization', b.auth).send({ toUid: a.uid }),
    ]);
    const pending = await h.prisma.friendRequest.count({ where: { status: 'PENDING' } });
    const friends = await h.prisma.friendship.count();
    // Ou os dois pedidos viraram amizade, ou sobrou exatamente um pendente (nunca os dois).
    expect(pending + friends).toBe(1);
    if (pending === 1) {
      const second = await h.http.post('/v1/friends/requests').set('authorization', b.auth).send({ toUid: a.uid });
      expect(second.status).toBe(200);
      expect(await h.prisma.friendship.count()).toBe(1);
    }
  });

  it('remover suprime a reconexão pela agenda; aceitar à mão reativa', async () => {
    const [a, b] = [newUser('ra'), newUser('rb')];
    await onboard(h, a);
    await onboard(h, b);
    await makeFriends(h, a, b);
    await h.http.delete(`/v1/friends/${b.uid}`).set('authorization', a.auth).expect(200);
    expect(await friendsOf(a.auth)).toHaveLength(0);
    // B sincroniza a agenda com o número de A: não reconecta.
    const sync = await h.http.post('/v1/contacts/sync').set('authorization', b.auth).send({ phones: [a.phone] }).expect(200);
    expect(sync.body.data).toMatchObject({ connected: 0, suppressed: 1 });
    expect(sync.body.data.matches[0]).toMatchObject({ uid: a.uid, relation: 'none' });
    expect(await h.prisma.friendship.count()).toBe(0);
    // Voltam a ser amigos à mão → supressão sai.
    await makeFriends(h, b, a);
    expect(await h.prisma.friendshipSuppression.count()).toBe(0);
  });

  it('agenda: telefone verificado + contato = amizade automática, sem expor números', async () => {
    const [me, x, y, z] = [newUser('me'), newUser('cx'), newUser('cy'), newUser('cz')];
    for (const u of [me, x, y]) await onboard(h, u);
    await bootstrap(h, z); // sem apelido: não aparece
    const unknown = '+5511988887777';
    const res = await h.http
      .post('/v1/contacts/sync')
      .set('authorization', me.auth)
      .send({ phones: [x.phone, unknown, y.phone, x.phone, z.phone, me.phone] })
      .expect(200);
    const data = res.body.data;
    expect(data.connected).toBe(2);
    expect(JSON.stringify(data)).not.toContain(x.phone);
    expect(JSON.stringify(data)).not.toContain(unknown);
    const indexes = data.matches.map((m: { index: number }) => m.index).sort();
    expect(indexes).toEqual([0, 2, 3, 5]);
    expect(data.matches.find((m: { index: number }) => m.index === 5)).toMatchObject({ uid: me.uid, relation: 'self' });
    expect(data.matches.find((m: { index: number }) => m.index === 0)).toMatchObject({ uid: x.uid, relation: 'friend', autoConnected: true });
    const friends = await friendsOf(me.auth);
    expect(friends.map((f) => f.uid).sort()).toEqual([x.uid, y.uid].sort());
    expect(friends.every((f) => f.source === 'phone_contact')).toBe(true);
    // O outro lado também vê.
    expect((await friendsOf(x.auth)).map((f) => f.uid)).toEqual([me.uid]);
    // Repetir é idempotente.
    const again = await h.http.post('/v1/contacts/sync').set('authorization', me.auth).send({ phones: [x.phone] }).expect(200);
    expect(again.body.data.connected).toBe(0);
    expect(again.body.data.matches[0].relation).toBe('friend');
    expect(await h.prisma.friendship.count()).toBe(2);
  });

  it('agenda: bloqueio (em qualquer sentido) omite o jogador e impede a conexão', async () => {
    const [me, blocker] = [newUser('bm'), newUser('bb')];
    await onboard(h, me);
    await onboard(h, blocker);
    await h.http.post('/v1/blocks').set('authorization', blocker.auth).send({ targetUid: me.uid }).expect(200);
    const res = await h.http.post('/v1/contacts/sync').set('authorization', me.auth).send({ phones: [blocker.phone] }).expect(200);
    expect(res.body.data.matches).toHaveLength(0);
    expect(await h.prisma.friendship.count()).toBe(0);
    const req = await h.http.post('/v1/friends/requests').set('authorization', me.auth).send({ toUid: blocker.uid });
    expect(req.body.error.code).toBe('FRIEND_BLOCKED');
    // Quem bloqueou vê a lista; quem foi bloqueado não sabe.
    const list = await h.http.get('/v1/blocks').set('authorization', blocker.auth).expect(200);
    expect(list.body.data.blocked.map((b: { uid: string }) => b.uid)).toEqual([me.uid]);
    const mine = await h.http.get('/v1/blocks').set('authorization', me.auth).expect(200);
    expect(mine.body.data.blocked).toHaveLength(0);
    // Desbloquear não reconecta sozinho.
    await h.http.delete(`/v1/blocks/${me.uid}`).set('authorization', blocker.auth).expect(200);
    const after = await h.http.post('/v1/contacts/sync').set('authorization', me.auth).send({ phones: [blocker.phone] }).expect(200);
    expect(after.body.data).toMatchObject({ connected: 0, suppressed: 1 });
  });

  it('bloqueio esconde o jogador na busca, no perfil público e na presença; só amigo vê a partida', async () => {
    const [me, blocker, friend, stranger] = [newUser('vzme'), newUser('vzbl'), newUser('vzfr'), newUser('vzst')];
    for (const u of [me, blocker, friend, stranger]) await onboard(h, u);
    await makeFriends(h, me, friend);
    await h.http.post('/v1/blocks').set('authorization', blocker.auth).send({ targetUid: me.uid }).expect(200);
    const search = await h.http.get('/v1/players/search').query({ term: 'vz' }).set('authorization', me.auth).expect(200);
    const found = search.body.data.players.map((p: { id: string }) => p.id);
    expect(found).toEqual(expect.arrayContaining([friend.uid, stranger.uid]));
    expect(found).not.toContain(blocker.uid);
    const hidden = await h.http.get(`/v1/players/${blocker.uid}`).set('authorization', me.auth);
    expect(hidden.body.error.code).toBe('PLAYER_NOT_FOUND');
    await h.http.get(`/v1/players/${stranger.uid}`).set('authorization', me.auth).expect(200);
    // Presença com partida em andamento: amigo vê o sessionId, desconhecido não.
    const fakeMatch = '00000000-0000-4000-8000-000000000001';
    for (const u of [friend, stranger]) {
      const id = (await h.prisma.user.findUniqueOrThrow({ where: { firebaseUid: u.uid } })).id;
      await h.prisma.userPresence.upsert({
        where: { userId: id },
        create: { userId: id, state: 'IN_MATCH', matchId: fakeMatch },
        update: { state: 'IN_MATCH', matchId: fakeMatch },
      });
    }
    const pres = await h.http
      .post('/v1/presence/query')
      .set('authorization', me.auth)
      .send({ uids: [friend.uid, stranger.uid, blocker.uid] })
      .expect(200);
    const map = pres.body.data.presence;
    expect(map[friend.uid]).toMatchObject({ state: 'in_match', sessionId: fakeMatch });
    expect(map[stranger.uid]).toMatchObject({ state: 'in_match', sessionId: null });
    expect(map[blocker.uid]).toBeUndefined();
  });

  it('agenda: validação E.164, lote máximo e cota diária', async () => {
    const me = newUser();
    await onboard(h, me);
    const bad = await h.http.post('/v1/contacts/sync').set('authorization', me.auth).send({ phones: ['31999990000'] });
    expect(bad.status).toBe(400);
    const tooMany = await h.http
      .post('/v1/contacts/sync')
      .set('authorization', me.auth)
      .send({ phones: Array.from({ length: 201 }, (_, i) => `+55319${String(10000000 + i)}`) });
    expect(tooMany.status).toBe(400);
    const user = await h.prisma.user.findUniqueOrThrow({ where: { firebaseUid: me.uid } });
    await h.prisma.contactSyncQuota.create({
      data: { userId: user.id, windowStart: new Date(), calls: MATCH_DAILY_CALLS, numbers: 10 },
    });
    const limited = await h.http.post('/v1/contacts/sync').set('authorization', me.auth).send({ phones: ['+5531999990000'] });
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('CONTACTS_QUOTA_EXCEEDED');
    expect(AUTO_CONNECT_DAILY_LIMIT).toBe(150);
  });

  it('bloquear desfaz amizade e solicitações', async () => {
    const [a, b, c] = [newUser(), newUser(), newUser()];
    for (const u of [a, b, c]) await onboard(h, u);
    await makeFriends(h, a, b);
    await h.http.post('/v1/friends/requests').set('authorization', c.auth).send({ toUid: a.uid }).expect(200);
    await h.http.post('/v1/blocks').set('authorization', a.auth).send({ targetUid: b.uid }).expect(200);
    await h.http.post('/v1/blocks').set('authorization', a.auth).send({ targetUid: c.uid }).expect(200);
    expect(await h.prisma.friendship.count()).toBe(0);
    expect(await h.prisma.friendRequest.count()).toBe(0);
    const self = await h.http.post('/v1/blocks').set('authorization', a.auth).send({ targetUid: a.uid });
    expect(self.body.error.code).toBe('FRIEND_SELF');
  });

  it('convite por QR: token opaco estável, resolve para o dono', async () => {
    const [a, b] = [newUser(), newUser()];
    await onboard(h, a);
    await onboard(h, b);
    const t1 = await h.http.post('/v1/friends/invite-token').set('authorization', a.auth).expect(200);
    const t2 = await h.http.post('/v1/friends/invite-token').set('authorization', a.auth).expect(200);
    expect(t1.body.data.token).toBe(t2.body.data.token);
    expect(t1.body.data.link).toBe(`trucomineiro://add-friend?token=${t1.body.data.token}`);
    expect(t1.body.data.token).not.toContain(a.uid);
    const resolved = await h.http
      .post('/v1/friends/invite-token/resolve')
      .set('authorization', b.auth)
      .send({ token: t1.body.data.token })
      .expect(200);
    expect(resolved.body.data.uid).toBe(a.uid);
    const bad = await h.http
      .post('/v1/friends/invite-token/resolve')
      .set('authorization', b.auth)
      .send({ token: 'x'.repeat(22) });
    expect(bad.body.error.code).toBe('INVITE_TOKEN_INVALID');
  });

  it('presença consultável por lista de uids', async () => {
    const [a, b] = [newUser(), newUser()];
    await onboard(h, a);
    await onboard(h, b);
    const res = await h.http.post('/v1/presence/query').set('authorization', a.auth).send({ uids: [b.uid] }).expect(200);
    expect(res.body.data.presence[b.uid]).toMatchObject({ state: 'offline' });
    const friendsList = await h.http.get('/v1/stats/online').set('authorization', a.auth).expect(200);
    expect(friendsList.body.data.count).toBe(0);
  });

  it('FCM lento ou fora não atrasa a solicitação; o status do push fica na notificação', async () => {
    const config = h.app.get<AppConfig>(CONFIG);
    const firebase = h.app.get(FirebaseAdminService);
    const [a, b] = [newUser('fcma'), newUser('fcmb')];
    await onboard(h, a);
    await onboard(h, b);
    await h.http.post('/v1/me/devices').set('authorization', b.auth).send({ token: 'device-token-0123456789', platform: 'android' }).expect(200);
    let release: () => void = () => undefined;
    const spy = jest.spyOn(firebase, 'sendMulticast').mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ successCount: 0, failureCount: 1, responses: [{ success: false, error: { code: 'app/invalid-credential' } }] } as never);
        }),
    );
    config.pushEnabled = true;
    try {
      const started = Date.now();
      await h.http.post('/v1/friends/requests').set('authorization', a.auth).send({ toUid: b.uid }).expect(200);
      expect(Date.now() - started).toBeLessThan(2_000);
      const row = await h.prisma.notification.findFirstOrThrow({ where: { type: 'FRIEND_REQUEST' } });
      expect(row.pushStatus).toBe('PENDING');
      release();
      let status = row.pushStatus;
      for (let i = 0; i < 40 && status === 'PENDING'; i++) {
        await new Promise((r) => setTimeout(r, 50));
        status = (await h.prisma.notification.findUniqueOrThrow({ where: { id: row.id } })).pushStatus;
      }
      expect(status).toBe('FAILED');
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      config.pushEnabled = false;
      spy.mockRestore();
    }
  });

  it('notificações: solicitação de amizade gera notificação lida/não lida', async () => {
    const [a, b] = [newUser(), newUser()];
    await onboard(h, a);
    await onboard(h, b);
    await h.http.post('/v1/friends/requests').set('authorization', a.auth).send({ toUid: b.uid }).expect(200);
    const list = await h.http.get('/v1/notifications').set('authorization', b.auth).expect(200);
    expect(list.body.data.unread).toBe(1);
    const n = list.body.data.items[0];
    expect(n).toMatchObject({ type: 'FRIEND_REQUEST', read: false });
    // Sem aparelho registrado, o push fica NO_DEVICE (em teste o envio é desligado: SKIPPED).
    const row = await h.prisma.notification.findUniqueOrThrow({ where: { id: n.id } });
    expect(['NO_DEVICE', 'SKIPPED']).toContain(row.pushStatus);
    await h.http.patch(`/v1/notifications/${n.id}/read`).set('authorization', b.auth).expect(200);
    const after = await h.http.get('/v1/notifications').set('authorization', b.auth).expect(200);
    expect(after.body.data.unread).toBe(0);
    await h.http.patch(`/v1/notifications/${n.id}/read`).set('authorization', a.auth).expect(404);
  });
});
