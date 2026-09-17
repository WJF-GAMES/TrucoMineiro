import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'net';
import request from 'supertest';
import { io, Socket } from 'socket.io-client';
import { createApp } from '../../src/main';
import { PrismaService } from '../../src/prisma/prisma.service';
import { GameSchedulerService } from '../../src/game/game-scheduler.service';
import { GameService } from '../../src/game/game.service';
import { resetClock } from '../../src/common/clock';
import type { SeatViewPayload } from '../../src/game/game-views';
import { timeoutAction, type GameAction, type Seat } from '../../src/domain/game';

export interface Harness {
  app: INestApplication;
  url: string;
  prisma: PrismaService;
  http: ReturnType<typeof request>;
  scheduler: GameSchedulerService;
  game: GameService;
  close: () => Promise<void>;
}

export async function startHarness(): Promise<Harness> {
  const { app, adapter } = await createApp();
  await app.listen(0, '127.0.0.1');
  const port = (app.getHttpServer().address() as AddressInfo).port;
  const url = `http://127.0.0.1:${port}`;
  return {
    app,
    url,
    prisma: app.get(PrismaService),
    http: request(app.getHttpServer()),
    scheduler: app.get(GameSchedulerService),
    game: app.get(GameService),
    close: async () => {
      await app.close();
      await adapter.closeRedis();
      resetClock();
    },
  };
}

const KEEP = new Set(['League', 'Achievement', '_prisma_migrations']);

/** Esvazia o banco de teste (mantém o seed estrutural). Aceita o harness para aquietar o agendador. */
export async function resetDb(target: PrismaService | Harness) {
  const prisma = 'prisma' in target && !(target instanceof PrismaService) ? target.prisma : (target as PrismaService);
  if ('scheduler' in target && !(target instanceof PrismaService)) await target.scheduler.quiesce();
  await sleep(30);
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = current_schema()`;
  const names = tables.map((t) => t.tablename).filter((t) => !KEEP.has(t));
  if (names.length === 0) return;
  const sql = `TRUNCATE ${names.map((n) => `"${n}"`).join(', ')} RESTART IDENTITY CASCADE`;
  for (let attempt = 0; ; attempt++) {
    try {
      await prisma.$executeRawUnsafe(sql);
      break;
    } catch (e) {
      if (attempt >= 5) throw e;
      await sleep(100 * (attempt + 1));
    }
  }
  resetClock();
}

export const bearer = (uid: string, phone = '') => `Bearer test:${uid}:${phone}`;

export interface TestUser {
  uid: string;
  phone: string;
  auth: string;
  nickname: string;
}

let seq = 0;
export function newUser(prefix = 'user', nickname?: string): TestUser {
  seq++;
  const uid = `${prefix}${String(seq).padStart(4, '0')}${Math.random().toString(36).slice(2, 6)}`;
  const phone = `+55319${String(10_000_000 + seq * 7919 + Math.floor(Math.random() * 1000)).slice(0, 8)}`;
  return { uid, phone, auth: bearer(uid, phone), nickname: nickname ?? `${prefix.slice(0, 8)}${seq}` };
}

export async function bootstrap(h: Harness, u: TestUser) {
  const res = await h.http.post('/v1/me/bootstrap').set('authorization', u.auth).send({});
  if (res.status !== 200) throw new Error(`bootstrap ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data;
}

/** Login + cadastro (Nome/Avatar). */
export async function onboard(h: Harness, u: TestUser) {
  await bootstrap(h, u);
  const res = await h.http
    .patch('/v1/me/profile')
    .set('authorization', u.auth)
    .send({ nickname: u.nickname, avatarId: 'joao' });
  if (res.status !== 200) throw new Error(`profile ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data;
}

export async function makeFriends(h: Harness, a: TestUser, b: TestUser) {
  await h.http.post('/v1/friends/requests').set('authorization', a.auth).send({ toUid: b.uid }).expect(200);
  const reqs = await h.http.get('/v1/friends/requests').set('authorization', b.auth).expect(200);
  const id = reqs.body.data.incoming.find((r: { from: string }) => r.from === a.uid).id;
  await h.http
    .post(`/v1/friends/requests/${id}/respond`)
    .set('authorization', b.auth)
    .send({ accept: true })
    .expect(200);
}

export async function snapshot(h: Harness, u: TestUser, matchId: string) {
  const res = await h.http.get(`/v1/matches/${matchId}`).set('authorization', u.auth);
  if (res.status !== 200) throw new Error(`snapshot ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data as {
    meta: { status: string; players: Record<string, { uid: string; bot: boolean; controller: string; connected: boolean }> };
    view: SeatViewPayload | null;
    seat: number | null;
    result: unknown;
  };
}

/** Escolhe uma jogada legal para o humano (a mais conservadora, como o timeout faria). */
export function pickAction(view: SeatViewPayload): GameAction | null {
  if (view.availableActions.length === 0) return null;
  const seat = view.seat as Seat;
  const auto = timeoutAction(view, seat);
  if (auto) return auto;
  const first = view.availableActions[0]!;
  if (first === 'PLAY_CARD' || first === 'PLAY_CARD_COVERED') {
    const cardId = view.playableCardIds[0];
    return cardId ? ({ type: first, seat, cardId } as GameAction) : null;
  }
  return { type: first, seat } as GameAction;
}

/**
 * Joga a partida até o fim: humanos agem pela REST, bots pelo agendador do servidor.
 * Devolve o número de ações humanas.
 */
export async function playToEnd(h: Harness, matchId: string, humans: TestUser[], maxSteps = 4000) {
  let humanActions = 0;
  for (let step = 0; step < maxSteps; step++) {
    const match = await h.prisma.match.findUniqueOrThrow({ where: { id: matchId }, select: { status: true } });
    if (match.status !== 'PLAYING') return humanActions;
    let acted = false;
    for (const u of humans) {
      const snap = await snapshot(h, u, matchId);
      if (!snap.view || snap.meta.status !== 'playing') continue;
      const action = pickAction(snap.view);
      if (!action) continue;
      const res = await h.http
        .post(`/v1/matches/${matchId}/actions`)
        .set('authorization', u.auth)
        .send({ action, actionId: `t_${snap.view.version}_${u.uid}` });
      if (res.status === 200) {
        acted = true;
        humanActions++;
      }
    }
    if (!acted) {
      await h.prisma.match.update({ where: { id: matchId }, data: { nextTickAt: new Date(Date.now() - 1) } });
      await h.scheduler.runOnce();
    }
  }
  throw new Error('partida não terminou');
}

export function connectSocket(h: Harness, u: TestUser, opts: { reconnection?: boolean } = {}): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = io(`${h.url}/rt`, {
      transports: ['websocket'],
      auth: { token: u.auth.replace('Bearer ', '') },
      reconnection: opts.reconnection ?? false,
      forceNew: true,
    });
    const timer = setTimeout(() => reject(new Error('socket timeout')), 8000);
    socket.once('session.ready', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('connect_error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

export function emitAck<T = unknown>(socket: Socket, event: string, payload: unknown): Promise<{ ok: boolean; data?: T; error?: { code: string; message: string } }> {
  return socket.timeout(10_000).emitWithAck(event, payload);
}

export function waitFor<T>(socket: Socket, event: string, predicate: (p: T) => boolean = () => true, timeoutMs = 10_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`timeout esperando ${event}`));
    }, timeoutMs);
    const handler = (p: T) => {
      if (!predicate(p)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(p);
    };
    socket.on(event, handler);
  });
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
