/**
 * Teste de carga do backend (REST + WebSocket + partidas).
 * Usa tokens de teste: o alvo precisa rodar com AUTH_MODE=test (ambiente de carga, nunca produção).
 *
 *   npx ts-node --transpile-only scripts/load-test.ts --url http://localhost:3200 --users 500 --matches 25 --duration 60
 *
 * Mede p50/p95/p99 e taxa de erro por operação, sockets conectados, ações de jogo por segundo e,
 * via /metrics e pg_stat_activity, CPU/RAM do processo e conexões do banco.
 */
import { performance } from 'perf_hooks';
import { io, Socket } from 'socket.io-client';
import { PrismaClient } from '@prisma/client';

const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1]! : def;
};
const URL = arg('url', 'http://localhost:3200');
const USERS = Number(arg('users', '100'));
const MATCHES = Number(arg('matches', '10'));
const DURATION = Number(arg('duration', '30')) * 1000;
// Variável própria: o PrismaClient carrega backend/.env e sobrescreveria um ADMIN_SECRET genérico.
const ADMIN = arg('admin-secret', process.env.LOAD_ADMIN_SECRET || 'load-admin-secret');
const RUN = Math.random().toString(36).slice(2, 7);
// Faixa de telefones própria de cada execução (evita reatribuir o índice de telefones).
const PHONE_BASE = 10_000_000 + Math.floor(Math.random() * 80) * 1_000_000;

type Stat = { lat: number[]; errors: number; codes: Record<string, number> };
const stats = new Map<string, Stat>();
function record(op: string, ms: number, ok: boolean, code = 'ok') {
  let s = stats.get(op);
  if (!s) stats.set(op, (s = { lat: [], errors: 0, codes: {} }));
  s.lat.push(ms);
  if (!ok) s.errors++;
  s.codes[code] = (s.codes[code] ?? 0) + 1;
}
const pct = (arr: number[], p: number) => {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  return (
    Math.round(sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]! * 10) /
    10
  );
};

async function http(op: string, token: string, method: string, path: string, body?: unknown) {
  const t0 = performance.now();
  try {
    const res = await fetch(`${URL}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await res.json().catch(() => null)) as {
      data?: unknown;
      error?: { code: string };
    } | null;
    record(
      op,
      performance.now() - t0,
      res.ok,
      res.ok ? 'ok' : (json?.error?.code ?? String(res.status)),
    );
    return json?.data as never;
  } catch (e) {
    const cause = (e as { cause?: { code?: string; message?: string } }).cause;
    record(op, performance.now() - t0, false, cause?.code ?? cause?.message ?? (e as Error).name);
    return null as never;
  }
}

interface VUser {
  i: number;
  token: string;
  socket?: Socket;
}

const tokenOf = (i: number) => `test:load${RUN}u${i}:+55319${String(PHONE_BASE + i)}`;

async function prepareUser(i: number): Promise<VUser> {
  const token = tokenOf(i);
  await http('bootstrap', token, 'POST', '/v1/me/bootstrap', {});
  await http('profile.update', token, 'PATCH', '/v1/me/profile', {
    nickname: `Carga ${i}`,
    avatarId: 'galo',
  });
  return { i, token };
}

function connect(u: VUser): Promise<void> {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const s = io(`${URL}/rt`, {
      transports: ['websocket'],
      auth: { token: u.token },
      reconnection: true,
      forceNew: true,
    });
    const done = (ok: boolean, code: string) => {
      record('ws.connect', performance.now() - t0, ok, code);
      resolve();
    };
    s.once('session.ready', () => done(true, 'ok'));
    s.once('connect_error', (e) => done(false, e.message));
    u.socket = s;
  });
}

async function ack(op: string, s: Socket, event: string, payload: unknown) {
  const t0 = performance.now();
  try {
    const r = (await s.timeout(15_000).emitWithAck(event, payload)) as {
      ok: boolean;
      data?: unknown;
      error?: { code: string };
    };
    record(op, performance.now() - t0, r.ok, r.ok ? 'ok' : (r.error?.code ?? 'err'));
    return r;
  } catch {
    record(op, performance.now() - t0, false, 'timeout');
    return { ok: false } as { ok: boolean; data?: unknown };
  }
}

const strength = '4567QJKA23';
function pick(v: { seat: number; availableActions: string[]; playableCardIds: string[] }) {
  const a = v.availableActions;
  const seat = v.seat;
  if (a.includes('FINISH_SHUFFLE')) return { type: 'FINISH_SHUFFLE', seat };
  if (a.includes('FINISH_CUT')) return { type: 'FINISH_CUT', seat };
  if (a.includes('ACCEPT_TRUCO')) return { type: 'ACCEPT_TRUCO', seat };
  if (a.includes('ACCEPT_MAO_DE_ONZE')) return { type: 'ACCEPT_MAO_DE_ONZE', seat };
  if (a.includes('PLAY_CARD') && v.playableCardIds.length) {
    const c = [...v.playableCardIds].sort(
      (x, y) => strength.indexOf(x[0]!) - strength.indexOf(y[0]!),
    )[0]!;
    return { type: 'PLAY_CARD', seat, cardId: c };
  }
  return null;
}

let finishedMatches = 0;
let gameActions = 0;

/** Um humano com 3 IAs, jogando pelo WebSocket até o fim (ou até acabar o tempo). */
async function playMatch(u: VUser, deadline: number) {
  const s = u.socket!;
  const room = (await http('rooms.create', u.token, 'POST', '/v1/rooms', {})) as {
    code: string;
  } | null;
  if (!room) return;
  await http('rooms.fill', u.token, 'POST', `/v1/rooms/${room.code}/fill-bots`);
  await http('rooms.ready', u.token, 'POST', `/v1/rooms/${room.code}/ready`, { ready: true });
  const start = (await http('rooms.start', u.token, 'POST', `/v1/rooms/${room.code}/start`)) as {
    sessionId: string;
  } | null;
  if (!start) return;
  const matchId = start.sessionId;
  type View = {
    version: number;
    seat: number;
    status: string;
    availableActions: string[];
    playableCardIds: string[];
  };
  let view = null as View | null;
  s.on('game.view', (v: View | null) => {
    if (v && (!view || v.version >= view.version)) view = v;
  });
  const joined = await ack('ws.game.join', s, 'game.join', { matchId });
  view = (joined.data as { view: View | null } | undefined)?.view ?? null;
  while (Date.now() < deadline) {
    if (view?.status === 'FINISHED') {
      finishedMatches++;
      return;
    }
    const action = view ? pick(view) : null;
    if (action) {
      const r = await ack('ws.game.action', s, 'game.action', {
        matchId,
        action,
        actionId: `ld_${view!.version}_${u.i}`,
      });
      if (r.ok) gameActions++;
      await new Promise((res) => setTimeout(res, 150));
    } else {
      await ack('ws.game.advance', s, 'game.advance-bots', { matchId });
      await new Promise((res) => setTimeout(res, 250));
    }
  }
}

async function metrics() {
  try {
    const text = await fetch(`${URL}/metrics`, { headers: { 'x-admin-secret': ADMIN } }).then((r) =>
      r.text(),
    );
    const lines = text.split('\n');
    const get = (k: string) =>
      Number(lines.find((l) => l.startsWith(`${k} `))?.slice(k.length + 1) ?? NaN);
    return {
      rssMb: Math.round(get('process_resident_memory_bytes') / 1e6),
      heapMb: Math.round(get('process_heap_used_bytes') / 1e6),
      cpuSeconds: get('process_cpu_seconds_total'),
      sockets: get('ws_connected_sockets'),
      // Contador só aparece depois da primeira consulta lenta.
      slowQueries: Number.isNaN(get('db_slow_queries_total')) ? 0 : get('db_slow_queries_total'),
    };
  } catch {
    return null;
  }
}

async function main() {
  console.log(`carga: ${USERS} usuários, ${MATCHES} partidas, ${DURATION / 1000}s → ${URL}`);
  const prisma = process.env.DATABASE_URL ? new PrismaClient() : null;
  const before = await metrics();
  const t0 = Date.now();

  // 1) Cadastro em lotes (bootstrap + perfil).
  const users: VUser[] = [];
  for (let i = 0; i < USERS; i += 50) {
    users.push(
      ...(await Promise.all(
        Array.from({ length: Math.min(50, USERS - i) }, (_, k) => prepareUser(i + k)),
      )),
    );
  }
  // 2) Todos conectam o WebSocket.
  for (let i = 0; i < users.length; i += 100)
    await Promise.all(users.slice(i, i + 100).map(connect));
  const connected = users.filter((u) => u.socket?.connected).length;
  console.log(
    `  ${connected}/${USERS} sockets conectados em ${Math.round((Date.now() - t0) / 1000)}s`,
  );

  // 3) Presença + REST de leitura + partidas, durante DURATION.
  const deadline = Date.now() + DURATION;
  const matchPlayers = users.slice(0, MATCHES);
  const others = users.slice(MATCHES);
  let peakDb = 0;
  const sampler = setInterval(async () => {
    if (!prisma) return;
    const rows = await prisma.$queryRaw<
      { n: bigint }[]
    >`SELECT count(*) AS n FROM pg_stat_activity WHERE datname = current_database()`;
    peakDb = Math.max(peakDb, Number(rows[0]?.n ?? 0));
  }, 1000);
  const readers = others.map(async (u) => {
    await ack('ws.presence.subscribe', u.socket!, 'presence.subscribe', {
      uids: [`load${RUN}u${(u.i + 1) % USERS}`],
    });
    while (Date.now() < deadline) {
      const r = Math.random();
      if (r < 0.3) await http('bootstrap', u.token, 'POST', '/v1/me/bootstrap', {});
      else if (r < 0.55) await http('friends.list', u.token, 'GET', '/v1/friends');
      else if (r < 0.8) await http('league.me', u.token, 'GET', '/v1/leagues/me');
      else await http('matches.history', u.token, 'GET', '/v1/matches?limit=20');
      await new Promise((res) => setTimeout(res, 800 + Math.random() * 1200));
    }
  });
  await Promise.all([...readers, ...matchPlayers.map((u) => playMatch(u, deadline))]);
  clearInterval(sampler);
  const after = await metrics();
  const elapsed = (Date.now() - t0) / 1000;

  const rows = [...stats.entries()].map(([op, s]) => ({
    op,
    n: s.lat.length,
    p50: pct(s.lat, 50),
    p95: pct(s.lat, 95),
    p99: pct(s.lat, 99),
    erros: s.errors,
    errPct: Math.round((s.errors / s.lat.length) * 10000) / 100,
    codigos: Object.entries(s.codes)
      .filter(([c]) => c !== 'ok')
      .map(([c, n]) => `${c}:${n}`)
      .join(' '),
  }));
  console.table(rows);
  const total = rows.reduce((a, r) => a + r.n, 0);
  const errors = rows.reduce((a, r) => a + r.erros, 0);
  const summary = {
    users: USERS,
    socketsConnected: connected,
    elapsedSec: Math.round(elapsed),
    requests: total,
    rps: Math.round(total / elapsed),
    errorRatePct: Math.round((errors / Math.max(1, total)) * 10000) / 100,
    matchesStarted: MATCHES,
    matchesFinished: finishedMatches,
    gameActionsPerSec: Math.round((gameActions / (DURATION / 1000)) * 10) / 10,
    server: {
      before,
      after,
      cpuSecondsUsed:
        after && before ? Math.round((after.cpuSeconds - before.cpuSeconds) * 10) / 10 : null,
    },
    peakDbConnections: peakDb,
  };
  console.log(JSON.stringify(summary, null, 2));
  for (const u of users) u.socket?.disconnect();
  await prisma?.$disconnect();
  process.exit(summary.errorRatePct > 1 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
