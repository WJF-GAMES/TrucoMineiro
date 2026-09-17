import { bootstrap, Harness, newUser, onboard, resetDb, startHarness } from '../helpers/harness';
import { weekKeyFor } from '../../src/domain/model/leagueWeek';

describe('Auth + usuários (API real, banco de teste)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => h.close());
  beforeEach(async () => resetDb(h));

  it('rejeita requisição sem token com erro padronizado', async () => {
    const res = await h.http.get('/v1/me/profile').expect(401);
    expect(res.body.error).toMatchObject({ code: 'AUTH_TOKEN_MISSING', kind: 'unauthenticated' });
    expect(res.body.error.requestId).toBeTruthy();
  });

  it('rejeita token inválido', async () => {
    const res = await h.http.get('/v1/me/profile').set('authorization', 'Bearer lixo').expect(401);
    expect(res.body.error.code).toBe('AUTH_TOKEN_INVALID');
  });

  it('usuário sem bootstrap recebe USER_NOT_FOUND', async () => {
    const u = newUser();
    const res = await h.http.get('/v1/me/profile').set('authorization', u.auth).expect(404);
    expect(res.body.error.code).toBe('USER_NOT_FOUND');
  });

  it('novo usuário: bootstrap → onboarding pendente → cadastro → Bronze + grupo semanal', async () => {
    const u = newUser('novo');
    const first = await bootstrap(h, u);
    expect(first).toMatchObject({ uid: u.uid, onboarded: false, league: null });
    expect(first.profile.countryCode).toBe('BR');

    // Sem apelido ainda não entra na liga (ninguém aparece sem nome no ranking).
    expect(await h.prisma.leagueMembership.count()).toBe(0);

    const done = await onboard(h, u);
    expect(done.profile).toMatchObject({ nickname: u.nickname, avatarId: 'joao', leagueId: 'bronze' });

    const user = await h.prisma.user.findUniqueOrThrow({ where: { firebaseUid: u.uid } });
    const progress = await h.prisma.leagueProgress.findUniqueOrThrow({ where: { userId: user.id } });
    expect(progress.currentLeagueId).toBe('bronze');
    expect(progress.currentWeekKey).toBe(weekKeyFor(Date.now()));
    const membership = await h.prisma.leagueMembership.findFirstOrThrow({ where: { userId: user.id } });
    expect(membership.groupId).toBe(progress.currentGroupId);

    const again = await bootstrap(h, u);
    expect(again.onboarded).toBe(true);
    expect(again.league).toMatchObject({ leagueId: 'bronze', groupId: progress.currentGroupId });
  });

  it('usuário existente não passa pelo onboarding de novo e o bootstrap é idempotente', async () => {
    const u = newUser('velho');
    await onboard(h, u);
    const results = await Promise.all([bootstrap(h, u), bootstrap(h, u), bootstrap(h, u)]);
    expect(results.every((r) => r.onboarded)).toBe(true);
    expect(await h.prisma.user.count()).toBe(1);
    expect(await h.prisma.userProfile.count()).toBe(1);
    expect(await h.prisma.leagueMembership.count()).toBe(1);
  });

  it('indexa o telefone verificado (hash, nunca o número)', async () => {
    const u = newUser('fone');
    await bootstrap(h, u);
    const user = await h.prisma.user.findUniqueOrThrow({ where: { firebaseUid: u.uid } });
    expect(user.phoneHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(user)).not.toContain(u.phone.slice(3));
  });

  it('valida apelido e avatar', async () => {
    const u = newUser();
    await bootstrap(h, u);
    const short = await h.http.patch('/v1/me/profile').set('authorization', u.auth).send({ nickname: 'ab', avatarId: 'joao' });
    expect(short.status).toBe(400);
    expect(short.body.error.code).toBe('NICKNAME_INVALID');
    const avatar = await h.http.patch('/v1/me/profile').set('authorization', u.auth).send({ nickname: 'Valido', avatarId: 'hacker' });
    expect(avatar.status).toBe(400);
    expect(avatar.body.error.code).toBe('VALIDATION_FAILED');
    const extra = await h.http
      .patch('/v1/me/profile')
      .set('authorization', u.auth)
      .send({ nickname: 'Valido', avatarId: 'joao', xp: 999999 });
    expect(extra.status).toBe(400);
  });

  it('cliente não consegue alterar XP/liga/vitórias pela API', async () => {
    const u = newUser();
    await onboard(h, u);
    const res = await h.http.get('/v1/me/profile').set('authorization', u.auth).expect(200);
    expect(res.body.data.stats.wins).toBe(0);
    const routes = await h.http.patch('/v1/me/stats').set('authorization', u.auth).send({ wins: 10 });
    expect(res.body.data.profile.xp).toBe(0);
    expect(routes.status).toBe(404);
  });

  it('busca jogadores por prefixo sem retornar a si mesmo nem perfis incompletos', async () => {
    const a = newUser('busca', 'Tiozao');
    const b = newUser('busca', 'Tiozinho');
    const c = newUser('busca');
    await onboard(h, a);
    await onboard(h, b);
    await bootstrap(h, c);
    const res = await h.http.get('/v1/players/search?term=tio').set('authorization', a.auth).expect(200);
    expect(res.body.data.players.map((p: { nickname: string }) => p.nickname)).toEqual(['Tiozinho']);
    const player = await h.http.get(`/v1/players/${b.uid}`).set('authorization', a.auth).expect(200);
    expect(player.body.data.profile.nickname).toBe('Tiozinho');
    await h.http.get(`/v1/players/${c.uid}`).set('authorization', a.auth).expect(404);
  });

  it('registra e remove aparelho (token FCM muda de dono ao trocar de conta)', async () => {
    const a = newUser();
    const b = newUser();
    await onboard(h, a);
    await onboard(h, b);
    const token = 'fcm-token-'.padEnd(40, 'x');
    await h.http.post('/v1/me/devices').set('authorization', a.auth).send({ token, platform: 'android' }).expect(200);
    await h.http.post('/v1/me/devices').set('authorization', b.auth).send({ token, platform: 'android' }).expect(200);
    const device = await h.prisma.userDevice.findUniqueOrThrow({ where: { token }, include: { user: true } });
    expect(device.user.firebaseUid).toBe(b.uid);
    await h.http.post('/v1/me/devices/remove').set('authorization', b.auth).send({ token }).expect(200);
    expect(await h.prisma.userDevice.count()).toBe(0);
  });

  it('exclusão de conta apaga os dados e sai do grupo da liga', async () => {
    const a = newUser();
    const b = newUser();
    await onboard(h, a);
    await onboard(h, b);
    const group = await h.prisma.leagueGroup.findFirstOrThrow();
    expect(group.memberCount).toBe(2);
    await h.http.delete('/v1/me').set('authorization', a.auth).expect(200);
    expect(await h.prisma.user.count({ where: { firebaseUid: a.uid } })).toBe(0);
    const after = await h.prisma.leagueGroup.findUniqueOrThrow({ where: { id: group.id } });
    expect(after.memberCount).toBe(1);
    await h.http.get('/v1/me/profile').set('authorization', a.auth).expect(404);
  });

  it('Idempotency-Key devolve a mesma resposta sem executar de novo', async () => {
    const u = newUser();
    await onboard(h, u);
    const send = () =>
      h.http.post('/v1/rooms').set('authorization', u.auth).set('idempotency-key', 'create-room-key-1').send({});
    const first = await send().expect(200);
    const second = await send().expect(200);
    expect(second.body.data.code).toBe(first.body.data.code);
    expect(second.headers['idempotent-replay']).toBe('true');
    expect(await h.prisma.room.count()).toBe(1);
  });

  it('Idempotency-Key: requisições simultâneas com a mesma chave executam uma vez só', async () => {
    const u = newUser();
    await onboard(h, u);
    const send = () =>
      h.http.post('/v1/rooms').set('authorization', u.auth).set('idempotency-key', 'parallel-room-key').send({});
    const results = await Promise.all(Array.from({ length: 6 }, send));
    expect(await h.prisma.room.count()).toBe(1);
    const ok = results.filter((r) => r.status === 200);
    const busy = results.filter((r) => r.status === 409);
    expect(ok.length + busy.length).toBe(6);
    expect(new Set(ok.map((r) => r.body.data.code)).size).toBe(1);
    for (const r of busy) expect(r.body.error.code).toBe('CONFLICT');
    // Depois de concluída, a chave responde com a mesma sala.
    const again = await send().expect(200);
    expect(again.headers['idempotent-replay']).toBe('true');
    // Erro não fica gravado: a mesma chave pode ser usada de novo depois de uma falha.
    const bad = () =>
      h.http.post('/v1/rooms/ZZZZZZ/join').set('authorization', u.auth).set('idempotency-key', 'failing-join-key').send({});
    const firstFail = await bad();
    expect(firstFail.status).toBeGreaterThanOrEqual(400);
    const secondFail = await bad();
    expect(secondFail.headers['idempotent-replay']).toBeUndefined();
    expect(await h.prisma.idempotencyKey.count({ where: { key: 'failing-join-key' } })).toBe(0);
  });

  it('health e readiness respondem', async () => {
    await h.http.get('/health').expect(200);
    const ready = await h.http.get('/health/ready').expect(200);
    expect(ready.body.checks).toMatchObject({ database: 'up', websocket: 'up' });
    await h.http.get('/metrics').expect(403);
    const metrics = await h.http.get('/metrics').set('x-admin-secret', 'test-admin-secret').expect(200);
    expect(metrics.text).toContain('http_requests_total');
  });

  it('OpenAPI (Swagger) é gerado', async () => {
    const res = await h.http.get('/docs/openapi.json').expect(200);
    expect(Object.keys(res.body.paths)).toEqual(expect.arrayContaining(['/v1/me/bootstrap', '/v1/rooms/friends', '/v1/contacts/sync']));
  });
});
