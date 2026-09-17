/**
 * Verificação com DUAS instâncias do backend ligadas ao mesmo Redis e ao mesmo banco (AUTH_MODE=test,
 * nunca produção): o mesmo usuário conectado nas duas; cair numa não pode marcá-lo offline nem
 * desconectar o assento da partida enquanto a outra conexão vive.
 *
 *   DATABASE_URL=<banco das instâncias> npx ts-node --transpile-only scripts/multi-instance-check.ts  *     --a http://localhost:3001 --b http://localhost:3002 --b-instance backend-C --a-instance backend-B
 */
import { io, Socket } from 'socket.io-client';
import { PrismaClient } from '@prisma/client';
const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1]! : def;
};
const B = arg('a', 'http://localhost:3001');
const C = arg('b', 'http://localhost:3002');
const A_INSTANCE = arg('a-instance', 'backend-B');
const run = Math.random().toString(36).slice(2, 6);
const T = `test:mi${run}:+5531958${String(Math.floor(Math.random() * 1e6)).padStart(6, '0')}`;
const prisma = new PrismaClient();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Data = { code?: string; sessionId?: string };
async function call(base: string, method: string, path: string, body?: unknown): Promise<Data> {
  const r = await fetch(base + path, {
    method,
    headers: { authorization: `Bearer ${T}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = (await r.json().catch(() => ({}))) as { data?: Data; error?: { code: string } };
  if (!r.ok) throw new Error(`${method} ${path} ${r.status} ${j.error?.code}`);
  return j.data ?? {};
}
const connect = (base: string) =>
  new Promise<Socket>((res, rej) => {
    const s = io(`${base}/rt`, {
      transports: ['websocket'],
      auth: { token: T },
      reconnection: false,
    });
    s.once('session.ready', () => res(s));
    s.once('connect_error', rej);
  });
async function state(userId: string, matchId: string) {
  const [p, part] = await Promise.all([
    prisma.userPresence.findUnique({ where: { userId } }),
    prisma.matchParticipant.findFirst({ where: { matchId, userId } }),
  ]);
  return {
    presence: p?.state,
    owner: p?.instanceId,
    seatConnected: part?.connected,
    controller: part?.controller,
  };
}
async function main() {
  await call(B, 'POST', '/v1/me/bootstrap', {});
  await call(B, 'PATCH', '/v1/me/profile', {
    nickname: 'Multi' + run.slice(0, 3),
    avatarId: 'galo',
  });
  const room = await call(B, 'POST', '/v1/rooms', {});
  await call(B, 'POST', `/v1/rooms/${room.code}/fill-bots`);
  await call(B, 'POST', `/v1/rooms/${room.code}/ready`, { ready: true });
  const started = await call(B, 'POST', `/v1/rooms/${room.code}/start`);
  const matchId = started.sessionId!;
  const user = await prisma.user.findUniqueOrThrow({ where: { firebaseUid: T.split(':')[1]! } });
  const s1 = await connect(B);
  await s1.timeout(5000).emitWithAck('game.join', { matchId });
  const s2 = await connect(C);
  await s2.timeout(5000).emitWithAck('game.join', { matchId });
  await sleep(500);
  const both = await state(user.id, matchId);
  s2.disconnect(); // cai a conexão da segunda instância (dona da presença)
  await sleep(1500);
  const afterC = await state(user.id, matchId);
  s1.disconnect(); // cai a última
  await sleep(1500);
  const afterAll = await state(user.id, matchId);
  console.log(JSON.stringify({ both, afterC, afterAll }, null, 1));
  const ok =
    afterC.presence !== 'OFFLINE' &&
    afterC.owner === A_INSTANCE &&
    afterC.seatConnected === true &&
    afterAll.presence === 'OFFLINE' &&
    afterAll.seatConnected === false;
  console.log(ok ? 'MULTI-INSTANCE OK' : 'MULTI-INSTANCE FALHOU');
  await call(B, 'POST', `/v1/matches/${matchId}/abandon`).catch(() => undefined);
  await prisma.$disconnect();
  process.exit(ok ? 0 : 1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
