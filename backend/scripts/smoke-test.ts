/**
 * Smoke test pós-deploy (staging/produção ou local). Só leitura, exceto o bootstrap do usuário
 * de smoke (idempotente). Sai com código 1 na primeira verificação que falhar.
 *
 *   npm run smoke -- --url https://api-staging.exemplo.com
 *   SMOKE_ID_TOKEN=<ID token do Firebase de uma conta de teste> npm run smoke -- --url ...
 *
 * Sem SMOKE_ID_TOKEN, só as verificações públicas rodam (saúde, recusa sem token, WS sem token).
 * Em ambiente AUTH_MODE=test (local), `--test-token` gera um token de teste.
 */
import { io } from 'socket.io-client';

const arg = (name: string, def = '') => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? '') : def;
};
const URL_BASE = arg('url', process.env.SMOKE_URL || 'http://localhost:3000').replace(/\/$/, '');
const TOKEN = process.argv.includes('--test-token')
  ? 'test:smoke-user:+5531900000001'
  : process.env.SMOKE_ID_TOKEN || '';
const ADMIN = process.env.SMOKE_ADMIN_SECRET || '';

let failures = 0;
async function check(name: string, fn: () => Promise<string | void>) {
  const t0 = Date.now();
  try {
    const note = await fn();
    console.log(`ok    ${name} (${Date.now() - t0}ms)${note ? ` — ${note}` : ''}`);
  } catch (e) {
    failures++;
    console.log(`FALHA ${name} (${Date.now() - t0}ms) — ${(e as Error).message}`);
  }
}
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function call(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {},
) {
  const res = await fetch(`${URL_BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      ...opts.headers,
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    signal: AbortSignal.timeout(10_000),
  });
  const text = await res.text();
  let json: { data?: unknown; error?: { code: string } } | null = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* texto puro (ex.: /metrics) */
  }
  return { status: res.status, headers: res.headers, json, text };
}

function wsConnect(
  token: string | null,
): Promise<{ ok: boolean; detail: string; close: () => void }> {
  return new Promise((resolve) => {
    const s = io(`${URL_BASE}/rt`, {
      transports: ['websocket'],
      auth: token ? { token } : {},
      reconnection: false,
      timeout: 10_000,
    });
    const done = (ok: boolean, detail: string) =>
      resolve({ ok, detail, close: () => s.disconnect() });
    s.once('session.ready', (p: { onlineCount?: number }) =>
      done(true, `online=${p?.onlineCount ?? '?'}`),
    );
    s.once('connect_error', (e) => done(false, e.message));
    s.once('disconnect', (reason) => done(false, `disconnect: ${reason}`));
    setTimeout(() => done(false, 'timeout'), 12_000);
  });
}

async function main() {
  console.log(`smoke → ${URL_BASE}${TOKEN ? ' (autenticado)' : ' (só público)'}`);

  await check('GET /health', async () => {
    const r = await call('GET', '/health');
    assert(r.status === 200, `status ${r.status}`);
  });
  await check('GET /health/ready (banco acessível)', async () => {
    const r = await call('GET', '/health/ready');
    assert(r.status === 200, `status ${r.status}: ${r.text.slice(0, 200)}`);
  });
  await check('cabeçalhos de segurança', async () => {
    const r = await call('GET', '/health');
    assert(r.headers.get('x-content-type-options') === 'nosniff', 'sem x-content-type-options');
    assert(!r.headers.get('x-powered-by'), 'x-powered-by exposto');
  });
  await check('REST sem token → 401 AUTH_TOKEN_MISSING', async () => {
    const r = await call('POST', '/v1/me/bootstrap', { body: {} });
    assert(r.status === 401, `status ${r.status}`);
    assert(r.json?.error?.code === 'AUTH_TOKEN_MISSING', `code ${r.json?.error?.code}`);
  });
  await check('REST com token inválido → 401', async () => {
    const r = await call('POST', '/v1/me/bootstrap', { token: 'invalido', body: {} });
    assert(r.status === 401, `status ${r.status}`);
  });
  await check('/metrics protegido', async () => {
    const r = await call('GET', '/metrics');
    assert(r.status === 401 || r.status === 403, `status ${r.status}`);
  });
  await check('WebSocket sem token é recusado', async () => {
    const r = await wsConnect(null);
    r.close();
    assert(!r.ok, 'conectou sem token');
    return r.detail;
  });
  if (ADMIN) {
    await check('/metrics com segredo', async () => {
      const r = await call('GET', '/metrics', { headers: { 'x-admin-secret': ADMIN } });
      assert(r.status === 200 && r.text.includes('process_uptime_seconds'), `status ${r.status}`);
    });
  }

  if (TOKEN) {
    await check('POST /v1/me/bootstrap', async () => {
      const r = await call('POST', '/v1/me/bootstrap', { token: TOKEN, body: {} });
      assert(r.status === 200, `status ${r.status} ${r.json?.error?.code ?? ''}`);
      const d = r.json?.data as { uid: string; onboarded: boolean; serverTime: number };
      assert(d?.uid && typeof d.serverTime === 'number', 'resposta sem uid/serverTime');
      return `onboarded=${d.onboarded}`;
    });
    for (const path of [
      '/v1/me/profile',
      '/v1/friends',
      '/v1/leagues/me',
      '/v1/matches?limit=5',
      '/v1/stats/online',
    ]) {
      await check(`GET ${path}`, async () => {
        const r = await call('GET', path, { token: TOKEN });
        // A liga exige cadastro completo: conta de smoke sem apelido recebe 412.
        assert(
          r.status === 200 || (path === '/v1/leagues/me' && r.status === 412),
          `status ${r.status} ${r.json?.error?.code ?? ''}`,
        );
      });
    }
    await check('WebSocket autenticado (session.ready)', async () => {
      const r = await wsConnect(TOKEN);
      r.close();
      assert(r.ok, r.detail);
      return r.detail;
    });
  }

  console.log(failures ? `\n${failures} verificação(ões) falharam.` : '\nSmoke OK.');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
