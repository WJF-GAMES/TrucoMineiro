import request from 'supertest';
import { Harness, newUser, resetDb, sleep, startHarness } from '../helpers/harness';
import { signWebhook } from '../../src/webhooks/webhooks.service';
import { TEST_DATABASE_URL } from '../setup/test-env';

const SECRET = 'test-webhook-secret';

function signed(h: Harness, body: object, opts: { id?: string; ts?: number; secret?: string } = {}) {
  const raw = JSON.stringify(body);
  const ts = opts.ts ?? Date.now();
  const id = opts.id ?? `evt-${Math.random().toString(36).slice(2)}`;
  return h.http
    .post('/webhooks/scheduler')
    .set('content-type', 'application/json')
    .set('x-webhook-id', id)
    .set('x-webhook-timestamp', String(ts))
    .set('x-webhook-signature', signWebhook(opts.secret ?? SECRET, ts, id, raw))
    .send(raw);
}

describe('Webhooks', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => h.close());
  beforeEach(async () => resetDb(h));

  it('evento assinado é aceito, registrado e processado uma vez (replay = duplicado)', async () => {
    const res = await signed(h, { job: 'maintenance.prune' }, { id: 'evt-fixed-1' }).expect(202);
    expect(res.body.data).toMatchObject({ accepted: true, duplicate: false });
    for (let i = 0; i < 50; i++) {
      const e = await h.prisma.webhookEvent.findFirstOrThrow();
      if (e.status === 'PROCESSED') break;
      await sleep(50);
    }
    const event = await h.prisma.webhookEvent.findFirstOrThrow();
    expect(event).toMatchObject({ provider: 'scheduler', externalEventId: 'evt-fixed-1', type: 'maintenance.prune', status: 'PROCESSED' });
    const replay = await signed(h, { job: 'maintenance.prune' }, { id: 'evt-fixed-1' }).expect(202);
    expect(replay.body.data.duplicate).toBe(true);
    const again = await h.prisma.webhookEvent.findFirstOrThrow();
    expect(again.attemptCount).toBe(2);
    expect(await h.prisma.webhookEvent.count()).toBe(1);
  });

  it('assinatura errada, carimbo velho, provedor desconhecido e job inválido são recusados', async () => {
    const bad = await signed(h, { job: 'maintenance.prune' }, { secret: 'outro' });
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe('WEBHOOK_SIGNATURE_INVALID');
    const old = await signed(h, { job: 'maintenance.prune' }, { ts: Date.now() - 10 * 60_000 });
    expect(old.body.error.code).toBe('WEBHOOK_TIMESTAMP_INVALID');
    const unknown = await h.http.post('/webhooks/stripe').send({});
    expect(unknown.body.error.code).toBe('WEBHOOK_UNKNOWN_PROVIDER');
    const job = await signed(h, { job: 'rm -rf' });
    expect(job.body.error.code).toBe('VALIDATION_FAILED');
    const unsigned = await h.http.post('/webhooks/scheduler').send({ job: 'maintenance.prune' });
    expect(unsigned.status).toBe(401);
    // Corpo adulterado depois de assinado.
    const ts = Date.now();
    const tampered = await h.http
      .post('/webhooks/scheduler')
      .set('content-type', 'application/json')
      .set('x-webhook-id', 'evt-tamper')
      .set('x-webhook-timestamp', String(ts))
      .set('x-webhook-signature', signWebhook(SECRET, ts, 'evt-tamper', JSON.stringify({ job: 'maintenance.prune' })))
      .send(JSON.stringify({ job: 'league.weekly-rollover' }));
    expect(tampered.body.error.code).toBe('WEBHOOK_SIGNATURE_INVALID');
    // Requisição capturada reenviada com outro id: a assinatura não bate.
    const raw = JSON.stringify({ job: 'maintenance.prune' });
    const replayed = await h.http
      .post('/webhooks/scheduler')
      .set('content-type', 'application/json')
      .set('x-webhook-id', 'evt-outro-id')
      .set('x-webhook-timestamp', String(ts))
      .set('x-webhook-signature', signWebhook(SECRET, ts, 'evt-original', raw))
      .send(raw);
    expect(replayed.body.error.code).toBe('WEBHOOK_SIGNATURE_INVALID');
    expect(await h.prisma.webhookEvent.count()).toBe(0);
  });

  it('evento preso em PROCESSING (instância morreu) é reprocessado no retry; recente não', async () => {
    await h.prisma.webhookEvent.create({
      data: {
        provider: 'scheduler',
        externalEventId: 'evt-stuck',
        type: 'maintenance.prune',
        status: 'PROCESSING',
        lastAttemptAt: new Date(Date.now() - 20 * 60_000),
      },
    });
    const retry = await signed(h, { job: 'maintenance.prune' }, { id: 'evt-stuck' }).expect(202);
    expect(retry.body.data.duplicate).toBe(false);
    for (let i = 0; i < 50; i++) {
      if ((await h.prisma.webhookEvent.findFirstOrThrow()).status === 'PROCESSED') break;
      await sleep(50);
    }
    expect((await h.prisma.webhookEvent.findFirstOrThrow()).status).toBe('PROCESSED');
    await h.prisma.webhookEvent.create({
      data: { provider: 'scheduler', externalEventId: 'evt-running', type: 'maintenance.prune', status: 'PROCESSING' },
    });
    const running = await signed(h, { job: 'maintenance.prune' }, { id: 'evt-running' }).expect(202);
    expect(running.body.data.duplicate).toBe(true);
  });

  it('admin: seed idempotente, jobs e diagnóstico exigem segredo', async () => {
    await h.http.post('/v1/admin/seed').expect(403);
    const seed = await h.http.post('/v1/admin/seed').set('x-admin-secret', 'test-admin-secret').expect(200);
    expect(seed.body.data).toMatchObject({ leagues: 20, achievements: 7 });
    await h.http.post('/v1/admin/seed').set('x-admin-secret', 'test-admin-secret').expect(200);
    expect(await h.prisma.league.count()).toBe(20);
    const job = await h.http.post('/v1/admin/jobs/rooms.sweep').set('x-admin-secret', 'test-admin-secret').expect(200);
    expect(job.body.data).toMatchObject({ expired: 0, removed: 0 });
    const diag = await h.http.post('/v1/admin/diagnostics').set('x-admin-secret', 'test-admin-secret').expect(200);
    expect(diag.body.data.users).toBe(0);
  });
});

describe('Banco indisponível', () => {
  it('backend sobe, liveness responde e as rotas falham de forma controlada (503)', async () => {
    const previous = process.env.DATABASE_URL;
    process.env.DATABASE_URL = 'postgresql://truco:x@127.0.0.1:1/nada?connect_timeout=2';
    const h = await startHarness();
    try {
      await h.http.get('/health').expect(200);
      const ready = await h.http.get('/health/ready');
      expect(ready.status).toBe(503);
      expect(ready.body.checks.database).toBe('down');
      const u = newUser();
      const res = await h.http.post('/v1/me/bootstrap').set('authorization', u.auth).send({});
      expect(res.status).toBe(503);
      expect(res.body.error).toMatchObject({ code: 'SERVICE_UNAVAILABLE', kind: 'unavailable' });
      expect(JSON.stringify(res.body)).not.toMatch(/127\.0\.0\.1|prisma|postgres/i);
    } finally {
      await h.close();
      process.env.DATABASE_URL = previous ?? TEST_DATABASE_URL;
    }
  });

  it('rate limit HTTP devolve 429 padronizado', async () => {
    const previous = process.env.HTTP_RATE_LIMIT;
    process.env.HTTP_RATE_LIMIT = '5';
    const h = await startHarness();
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 8; i++) statuses.push((await request(h.app.getHttpServer()).get('/v1/stats/online')).status);
      expect(statuses).toContain(429);
    } finally {
      await h.close();
      process.env.HTTP_RATE_LIMIT = previous;
    }
  });
});
