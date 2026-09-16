/* eslint-disable import/first --
 * Os `jest.mock` precisam vir antes de importar os módulos das Functions (ver onboarding.test.ts).
 */
import { FakeFirestore, DOCUMENT_ID } from './fakeFirestore';
import { FakeRtdb } from './fakeRtdb';

/**
 * Sala montada a partir da lista de amigos: convites com vaga reservada, push, espera do lobby,
 * IA completando a mesa, convidado atrasado assumindo a vaga da IA, desconexão e saída no meio.
 * Os números dos testes seguem a especificação da feature (176–192).
 */

const fs = new FakeFirestore();
const rtdb = new FakeRtdb();
let clock = Date.parse('2026-09-16T20:00:00-03:00');
const pushes: { tokens: string[]; data: Record<string, string>; title: string }[] = [];

jest.mock('../src/lib/admin', () => ({
  db: fs,
  rtdb,
  auth: {},
  messaging: {
    sendEachForMulticast: jest.fn(
      async (m: {
        tokens: string[];
        data: Record<string, string>;
        notification: { title: string };
      }) => {
        pushes.push({ tokens: m.tokens, data: m.data, title: m.notification.title });
        return { responses: m.tokens.map(() => ({ success: true })) };
      },
    ),
  },
  REGION: 'southamerica-east1',
  DB_TRIGGER_REGION: 'us-central1',
  IS_EMULATOR: true,
  ENFORCE_APP_CHECK: false,
  now: () => clock,
}));
jest.mock('firebase-admin/firestore', () => ({
  FieldPath: { documentId: () => DOCUMENT_ID },
  FieldValue: { increment: (n: number) => n, delete: () => undefined },
}));
jest.mock('firebase-functions/v2', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('firebase-functions/v2/https', () => ({
  onRequest: (_opts: unknown, handler: unknown) => handler,
  onCall: (_opts: unknown, handler: unknown) => handler,
  HttpsError: class extends Error {
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message);
    }
  },
}));
jest.mock('firebase-functions/v2/scheduler', () => ({
  onSchedule: (_opts: unknown, handler: unknown) => handler,
}));
jest.mock('firebase-functions/v2/database', () => ({
  onValueWritten: (_opts: unknown, handler: unknown) => handler,
}));
const mockProgression = jest.fn(async (..._args: unknown[]) => ({
  alreadyProcessed: false,
  byUid: {},
}));
jest.mock('../src/progression', () => ({
  processProgression: (...args: unknown[]) => mockProgression(...args),
}));

import * as rooms from '../src/rooms';
import * as sessions from '../src/sessions';
import { applyAction, skipCeremony } from '../src/domain/game';
import type { Room, SessionMeta } from '../src/domain/model/types';
import { DISCONNECT_AI_GRACE_MS, LOBBY_WAIT_MS } from '../src/friendRoomConfig';
import { normalizeStoredState, type StoredState } from '../src/lib/rtdbState';

type Fn<T, R = unknown> = (req: { auth: { uid: string }; data: T }) => Promise<R>;
const call = <T, R>(fn: unknown, uid: string, data: T) => (fn as Fn<T, R>)({ auth: { uid }, data });

const createFriendRoom = (uid: string, friendUids: string[]) =>
  call<{ friendUids: string[] }, { code: string; inviteExpiresAt: number }>(
    rooms.createFriendRoom,
    uid,
    { friendUids },
  );
const respond = (uid: string, code: string, accept: boolean) =>
  call<{ code: string; accept: boolean }, rooms.JoinResult>(rooms.respondRoomInvite, uid, {
    code,
    accept,
  });
const timeout = (uid: string, code: string) =>
  call<{ code: string }, { sessionId: string | null }>(rooms.resolveLobbyTimeout, uid, { code });
const start = (uid: string, code: string) =>
  call<{ code: string }, { sessionId: string }>(rooms.startMatch, uid, { code });

const room = (code: string) => rtdb.read(`rooms/${code}`) as Room;
const meta = (id: string) => rtdb.read(`gameSessions/${id}/meta`) as SessionMeta;
const seats = (id: string) =>
  [0, 1, 2, 3].map((s) => {
    const p = meta(id).players[String(s)]!;
    return p.bot ? 'IA' : p.uid;
  });

function user(uid: string, friends: string[] = []) {
  fs.store.set(`profiles/${uid}`, {
    nickname: uid[0]!.toUpperCase() + uid.slice(1),
    avatarId: 'joao',
  });
  fs.store.set(`users/${uid}`, { fcmTokens: { [`tok-${uid}`]: { platform: 'android' } } });
  for (const f of friends) {
    fs.store.set(`friendships/${uid}/friends/${f}`, { since: 1 });
    fs.store.set(`friendships/${f}/friends/${uid}`, { since: 1 });
  }
}

beforeEach(() => {
  fs.store.clear();
  rtdb.root = null;
  pushes.length = 0;
  mockProgression.mockClear();
  clock += 3_600_000; // janelas de rate limit sempre novas
  user('will', ['anabel', 'bruno', 'carlos', 'dani']);
  user('anabel');
  user('bruno');
  user('carlos');
  user('dani');
  user('estranho');
});

describe('criar sala com amigos', () => {
  it('grava a sala com as vagas reservadas antes de mandar convite e push', async () => {
    const { code, inviteExpiresAt } = await createFriendRoom('will', ['anabel', 'bruno', 'carlos']);
    const r = room(code);
    expect(r.status).toBe('waiting');
    expect(r.hostUid).toBe('will');
    expect(r.players.will).toMatchObject({ seat: 0, ready: true });
    expect(Object.values(r.invites!).map((i) => [i.uid, i.seat, i.status])).toEqual([
      ['anabel', 1, 'PENDING'],
      ['bruno', 2, 'PENDING'],
      ['carlos', 3, 'PENDING'],
    ]);
    expect(inviteExpiresAt).toBe(clock + LOBBY_WAIT_MS);
    expect(r.fillWithAi).toBe('on_timeout');
    for (const f of ['anabel', 'bruno', 'carlos']) {
      expect(rtdb.read(`invites/${f}/${code}`)).toMatchObject({
        code,
        from: 'will',
        inviteId: `${code}_${f}`,
      });
    }
    expect(pushes.map((p) => p.data)).toEqual(
      ['anabel', 'bruno', 'carlos'].map((f) => ({
        type: 'room_invite',
        code,
        inviteId: `${code}_${f}`,
      })),
    );
    expect(pushes[0]!.title).toBe('Will te chamou para uma partida de Truco!');
  });

  it('aceita no máximo 3 amigos e nunca desconhecidos', async () => {
    await expect(
      createFriendRoom('will', ['anabel', 'bruno', 'carlos', 'dani']),
    ).rejects.toMatchObject({
      code: 'invalid-argument',
    });
    await expect(createFriendRoom('will', [])).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(createFriendRoom('will', ['estranho'])).rejects.toMatchObject({
      code: 'permission-denied',
    });
    expect(pushes).toHaveLength(0);
  });

  it('não convida quem está bloqueado, em qualquer sentido', async () => {
    fs.store.set('blockedBy/will/users/anabel', { since: 1 });
    await expect(createFriendRoom('will', ['anabel'])).rejects.toMatchObject({
      code: 'permission-denied',
    });
    fs.store.delete('blockedBy/will/users/anabel');
    fs.store.set('blocks/will/blocked/bruno', { since: 1 });
    await expect(createFriendRoom('will', ['bruno'])).rejects.toMatchObject({
      code: 'permission-denied',
    });
  });

  it('teste 11: convites repetidos esbarram no limite', async () => {
    for (let i = 0; i < 6; i++) await createFriendRoom('will', ['anabel']);
    await expect(createFriendRoom('will', ['anabel'])).rejects.toMatchObject({
      code: 'resource-exhausted',
    });
  });

  it('o mesmo convite reenviado não dispara outro push dentro do intervalo', async () => {
    const { code } = await createFriendRoom('will', ['anabel', 'bruno']);
    await respond('bruno', code, false);
    pushes.length = 0;
    await call(rooms.inviteToRoom, 'will', { code, friendUid: 'anabel' });
    expect(pushes).toHaveLength(0);
  });
});

describe('entrada, recusa e preenchimento por IA', () => {
  it('teste 1: os 3 entram → 4 humanos, e o dono pode começar na hora', async () => {
    const { code } = await createFriendRoom('will', ['anabel', 'bruno', 'carlos']);
    for (const f of ['anabel', 'bruno', 'carlos']) await respond(f, code, true);
    expect(Object.values(room(code).invites!).every((i) => i.status === 'ACCEPTED')).toBe(true);
    expect(rtdb.read(`invites/anabel/${code}`)).toBeNull();
    const { sessionId } = await start('will', code);
    expect(seats(sessionId)).toEqual(['will', 'anabel', 'bruno', 'carlos']);
    // Times: dono + Bruno (0 e 2) contra Ana + Carlos (1 e 3).
    expect(room(code).status).toBe('in_match');
  });

  it('teste 2: 2 entram, 1 some → no tempo esgotado, 3 humanos + 1 IA com a vaga reservada', async () => {
    const { code } = await createFriendRoom('will', ['anabel', 'bruno', 'carlos']);
    await respond('anabel', code, true);
    await respond('bruno', code, true);
    await expect(start('will', code)).rejects.toMatchObject({ code: 'failed-precondition' });
    await expect(timeout('anabel', code)).rejects.toMatchObject({ code: 'failed-precondition' });
    clock += LOBBY_WAIT_MS;
    const { sessionId } = await timeout('anabel', code);
    expect(seats(sessionId!)).toEqual(['will', 'anabel', 'bruno', 'IA']);
    expect(meta(sessionId!).players['3']).toMatchObject({ bot: true, reservedFor: 'carlos' });
    expect(room(code).invites!.carlos!.status).toBe('AI_FILLED');
  });

  it('teste 3: 1 amigo em 2x2 → 2 humanos + 2 IA', async () => {
    const { code } = await createFriendRoom('will', ['anabel']);
    await respond('anabel', code, true);
    await call(rooms.fillRoomWithBots, 'will', { code });
    const { sessionId } = await start('will', code);
    expect(seats(sessionId)).toEqual(['will', 'anabel', 'IA', 'IA']);
  });

  it('teste 4: ninguém entra → dono + 3 IA', async () => {
    const { code } = await createFriendRoom('will', ['anabel', 'bruno', 'carlos']);
    clock += LOBBY_WAIT_MS;
    const { sessionId } = await timeout('will', code);
    expect(seats(sessionId!)).toEqual(['will', 'IA', 'IA', 'IA']);
    expect(Object.values(meta(sessionId!).players).filter((p) => p.reservedFor)).toHaveLength(3);
  });

  it('teste 7: recusa aparece na hora e a vaga vira IA comum', async () => {
    const { code } = await createFriendRoom('will', ['anabel', 'bruno']);
    await respond('bruno', code, false);
    expect(room(code).invites!.bruno!.status).toBe('DECLINED');
    expect(rtdb.read(`invites/bruno/${code}`)).toBeNull();
    await respond('anabel', code, true);
    await call(rooms.fillRoomWithBots, 'will', { code });
    const { sessionId } = await start('will', code);
    expect(meta(sessionId).players['2']).toMatchObject({ bot: true });
    expect(meta(sessionId).players['2']!.reservedFor ?? null).toBeNull();
  });

  it('dono troca quem recusou por outro amigo', async () => {
    const { code } = await createFriendRoom('will', ['anabel', 'bruno', 'carlos']);
    await respond('bruno', code, false);
    await call(rooms.removeRoomInvite, 'will', { code, friendUid: 'bruno' });
    await call(rooms.inviteToRoom, 'will', { code, friendUid: 'dani' });
    expect(room(code).invites!.dani).toMatchObject({ seat: 2, status: 'PENDING' });
    expect(room(code).invites!.bruno).toBeUndefined();
    await respond('dani', code, true);
    expect(room(code).players.dani!.seat).toBe(2);
  });

  it('nunca passa de 4 lugares nem aceita convite depois de começar', async () => {
    const { code } = await createFriendRoom('will', ['anabel', 'bruno', 'carlos']);
    await expect(
      call(rooms.inviteToRoom, 'will', { code, friendUid: 'dani' }),
    ).rejects.toMatchObject({
      code: 'resource-exhausted',
    });
  });

  it('vaga reservada não é tomada por quem entra pelo código', async () => {
    user('visitante');
    const { code } = await createFriendRoom('will', ['anabel', 'bruno', 'carlos']);
    await expect(call(rooms.joinRoom, 'visitante', { code })).rejects.toMatchObject({
      code: 'resource-exhausted',
    });
  });
});

describe('idempotência e validade', () => {
  it('testes 12 e 13: mesmo push aberto duas vezes / dois aparelhos → um assento só', async () => {
    const { code } = await createFriendRoom('will', ['anabel']);
    await Promise.all([respond('anabel', code, true), respond('anabel', code, true)]);
    await respond('anabel', code, true);
    const humans = Object.values(room(code).players).filter((p) => p.uid === 'anabel');
    expect(humans).toHaveLength(1);
  });

  it('teste 14: convite vencido', async () => {
    const { code } = await createFriendRoom('will', ['anabel']);
    clock += 60 * 60_000;
    await expect(respond('anabel', code, true)).rejects.toMatchObject({
      message: 'Este convite não está mais disponível.',
    });
  });

  it('teste 15: sala cancelada invalida os convites', async () => {
    const { code } = await createFriendRoom('will', ['anabel', 'bruno']);
    await call(rooms.leaveRoom, 'will', { code });
    expect(room(code)).toMatchObject({ status: 'closed', closedReason: 'cancelled' });
    expect(room(code).invites!.anabel!.status).toBe('CANCELLED');
    expect(rtdb.read(`invites/anabel/${code}`)).toBeNull();
    await expect(respond('anabel', code, true)).rejects.toMatchObject({
      message: 'Esta sala foi cancelada.',
    });
  });

  it('convidado em outra partida não é tirado dela', async () => {
    rtdb.write('userSessions/anabel/active', 'outra');
    rtdb.write('gameSessions/outra/meta', { status: 'playing', roomCode: 'ZZZZZZ', players: {} });
    const { code } = await createFriendRoom('will', ['anabel']);
    await expect(respond('anabel', code, true)).rejects.toMatchObject({
      message: 'Você já está em uma partida.',
    });
  });

  it('sala sem dono no lobby é fechada pela limpeza', async () => {
    const { code } = await createFriendRoom('will', ['anabel']);
    clock += 11 * 60_000;
    await (rooms.sweepRooms as unknown as () => Promise<void>)();
    expect(room(code)).toMatchObject({ status: 'closed', closedReason: 'expired' });
    expect(rtdb.read(`invites/anabel/${code}`)).toBeNull();
  });
});

/** Estado da sessão com a mão numa fase qualquer (para testar o ponto seguro de troca). */
function setState(id: string, mutate: (s: StoredState) => StoredState) {
  const s = normalizeStoredState(rtdb.read(`gameSessions/${id}/state`))!;
  rtdb.write(`gameSessions/${id}/state`, mutate(s));
}

describe('entrada tardia e desconexão', () => {
  async function startedWithCarlosLate() {
    const { code } = await createFriendRoom('will', ['anabel', 'bruno', 'carlos']);
    await respond('anabel', code, true);
    await respond('bruno', code, true);
    clock += LOBBY_WAIT_MS;
    const { sessionId } = await timeout('will', code);
    return { code, sessionId: sessionId! };
  }

  it('teste 8: convidado atrasado assume a vaga da IA só num ponto seguro', async () => {
    const { code, sessionId } = await startedWithCarlosLate();
    // Meio de uma vaza: nada de troca.
    setState(sessionId, (s) => {
      const dealt = skipCeremony(s);
      const first = dealt.hand.turnSeat;
      const card = dealt.hand.hands[first]![0]!;
      return {
        ...(applyAction(dealt, {
          type: 'PLAY_CARD',
          seat: first,
          cardId: `${card.rank}${card.suit[0]!.toUpperCase()}`,
        }) as StoredState),
        appliedActionIds: {},
        aiRngState: 1,
        trucos: {},
      };
    });
    const joined = await respond('carlos', code, true);
    expect(joined).toMatchObject({ pending: true, sessionId });
    expect(meta(sessionId).players['3']).toMatchObject({ bot: true, pendingUid: 'carlos' });
    const claim = (uid: string) =>
      call<{ sessionId: string }, { status: string }>(sessions.claimReservedSeat, uid, {
        sessionId,
      });
    expect(await claim('carlos')).toEqual({ status: 'pending' });
    expect(await claim('dani')).toEqual({ status: 'unavailable' });

    // Começo de mão: troca feita, um controlador só.
    setState(sessionId, (s) => ({
      ...s,
      hand: { ...s.hand, phase: 'SHUFFLING', currentRound: [], rounds: [] },
    }));
    expect(await claim('carlos')).toEqual({ status: 'seated' });
    expect(seats(sessionId)).toEqual(['will', 'anabel', 'bruno', 'carlos']);
    expect(rtdb.read('userSessions/carlos/active')).toBe(sessionId);
    const r = room(code);
    expect(
      Object.values(r.players)
        .filter((p) => p.seat === 3)
        .map((p) => p.uid),
    ).toEqual(['carlos']);
    expect(r.invites!.carlos!.status).toBe('ACCEPTED');
    // Abrir o push de novo não cria outro assento.
    await respond('carlos', code, true);
    expect(seats(sessionId).filter((s) => s === 'carlos')).toHaveLength(1);
  });

  it('só o dono da reserva assume, e não depois do prazo do convite', async () => {
    const { code } = await startedWithCarlosLate();
    await expect(respond('dani', code, true)).rejects.toMatchObject({
      message: 'Este convite não está mais disponível.',
    });
    clock += 60 * 60_000;
    await expect(respond('carlos', code, true)).rejects.toMatchObject({
      message: 'Este convite não está mais disponível.',
    });
  });

  it('testes 9 e 10: quem cai vira IA depois da tolerância e retoma ao voltar', async () => {
    const { sessionId } = await startedWithCarlosLate();
    const p = meta(sessionId).players['1']!;
    expect(sessions.isAiControlled(p, clock)).toBe(false);
    rtdb.write(`gameSessions/${sessionId}/meta/players/1/connected`, false);
    rtdb.write(`gameSessions/${sessionId}/meta/players/1/disconnectedAt`, clock);
    const down = meta(sessionId).players['1']!;
    expect(sessions.isAiControlled(down, clock + 1_000)).toBe(false);
    expect(sessions.isAiControlled(down, clock + DISCONNECT_AI_GRACE_MS)).toBe(true);
    await call(sessions.rejoinMatch, 'anabel', { sessionId });
    expect(sessions.isAiControlled(meta(sessionId).players['1'], clock + 60_000)).toBe(false);
  });

  it('IA joga a vez de quem caiu (advanceBots)', async () => {
    const { sessionId } = await startedWithCarlosLate();
    setState(sessionId, (s) => skipCeremony(s) as StoredState);
    const state = normalizeStoredState(rtdb.read(`gameSessions/${sessionId}/state`))!;
    const turn = state.hand.turnSeat;
    const human = meta(sessionId).players[String(turn)]!;
    expect(human.bot).toBe(false);
    rtdb.write(`gameSessions/${sessionId}/meta/players/${turn}/connected`, false);
    rtdb.write(
      `gameSessions/${sessionId}/meta/players/${turn}/disconnectedAt`,
      clock - DISCONNECT_AI_GRACE_MS,
    );
    const other = Object.values(meta(sessionId).players).find((p) => !p.bot && p.seat !== turn)!;
    const before = state.version;
    const res = await call<{ sessionId: string }, { version: number }>(
      sessions.advanceBots,
      other.uid,
      {
        sessionId,
      },
    );
    expect(res.version).toBeGreaterThan(before);
  });

  it('testes 16 e 17: saídas no meio viram IA e a partida continua', async () => {
    const { code } = await createFriendRoom('will', ['anabel', 'bruno', 'carlos']);
    for (const f of ['anabel', 'bruno', 'carlos']) await respond(f, code, true);
    const { sessionId } = await start('will', code);
    const abandon = (uid: string) =>
      call<{ sessionId: string }, { ok: true }>(sessions.abandonMatch, uid, { sessionId });
    await Promise.all([abandon('anabel'), abandon('bruno')]);
    expect(meta(sessionId).status).toBe('playing');
    expect(seats(sessionId)).toEqual(['will', 'IA', 'IA', 'carlos']);
    expect(meta(sessionId).players['1']!.replacedUid).toBe('anabel');
    expect(rtdb.read('userSessions/anabel/active')).toBeNull();
    // Derrota registrada só para quem saiu.
    expect(mockProgression).toHaveBeenCalledTimes(2);
    await abandon('carlos');
    expect(meta(sessionId).status).toBe('playing');
    // Último humano sai: agora sim a partida acaba.
    await abandon('will');
    expect(meta(sessionId).status).toBe('abandoned');
    expect(room(code)).toMatchObject({ status: 'closed', closedReason: 'abandoned' });
  });

  it('todo assento da sessão tem exatamente um controlador', async () => {
    const { sessionId } = await startedWithCarlosLate();
    const players = Object.values(meta(sessionId).players);
    expect(players.map((p) => p.seat).sort()).toEqual([0, 1, 2, 3]);
    expect(new Set(players.map((p) => p.uid)).size).toBe(4);
  });
});
