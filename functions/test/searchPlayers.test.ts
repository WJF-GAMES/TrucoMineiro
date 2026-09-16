/* eslint-disable import/first --
 * Os `jest.mock` precisam vir antes de importar `../src/users` (ver onboarding.test.ts).
 */
import { FakeFirestore, DOCUMENT_ID } from './fakeFirestore';

/**
 * Busca de jogadores: perfis sem conta no Auth (conta apagada fora do app) apareciam como
 * resultados repetidos com o mesmo apelido. O servidor agora filtra esses órfãos.
 */

const fs = new FakeFirestore();
const clock = Date.parse('2026-09-16T15:00:00-03:00');
/** uids que existem no Firebase Auth; o resto é órfão. */
const authUids = new Set<string>();

jest.mock('../src/lib/admin', () => ({
  db: fs,
  rtdb: { ref: () => ({ remove: async () => undefined }) },
  auth: {
    getUser: jest.fn(async () => ({ phoneNumber: '+5511900000000' })),
    getUsers: jest.fn(async (ids: { uid: string }[]) => ({
      users: ids.filter((i) => authUids.has(i.uid)).map((i) => ({ uid: i.uid })),
      notFound: ids.filter((i) => !authUids.has(i.uid)),
    })),
    deleteUser: jest.fn(async () => undefined),
  },
  messaging: {},
  REGION: 'southamerica-east1',
  DB_TRIGGER_REGION: 'us-central1',
  IS_EMULATOR: true,
  ENFORCE_APP_CHECK: false,
  now: () => clock,
}));

jest.mock('firebase-admin/firestore', () => ({
  FieldPath: { documentId: () => DOCUMENT_ID },
  FieldValue: { increment: (n: number) => n },
}));
jest.mock('firebase-functions/v2', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('firebase-functions/v1', () => ({
  region: () => ({
    runWith: () => ({ auth: { user: () => ({ onDelete: (handler: unknown) => handler }) } }),
  }),
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

import { onAuthUserDeleted, searchPlayers } from '../src/users';

type Callable<T, R> = (req: { auth: { uid: string }; data: T }) => Promise<R>;
const search = searchPlayers as unknown as Callable<
  { term: string },
  { players: { id: string; nickname: string }[] }
>;
const onDeleted = onAuthUserDeleted as unknown as (user: { uid: string }) => Promise<void>;

function profile(uid: string, nickname: string, live = true) {
  fs.store.set(`profiles/${uid}`, {
    nickname,
    nicknameLower: nickname.toLowerCase(),
    avatarId: 'maria',
    level: 1,
  });
  if (live) authUids.add(uid);
}

beforeEach(() => {
  fs.store.clear();
  authUids.clear();
});

describe('searchPlayers', () => {
  it('não devolve perfis órfãos (conta apagada fora do app) com o mesmo apelido', async () => {
    profile('raiana-atual', 'Raiana');
    profile('raiana-antiga-1', 'Raiana', false);
    profile('raiana-antiga-2', 'Raiana', false);
    const { players } = await search({ auth: { uid: 'me' }, data: { term: 'Rai' } });
    expect(players.map((p) => p.id)).toEqual(['raiana-atual']);
  });

  it('mantém homônimos que são contas de verdade, sem repetir nenhuma', async () => {
    profile('a', 'Raiana');
    profile('b', 'Raiana');
    const { players } = await search({ auth: { uid: 'me' }, data: { term: 'raiana' } });
    expect(players.map((p) => p.id).sort()).toEqual(['a', 'b']);
  });

  it('ignora quem busca, perfis sem apelido e termos curtos', async () => {
    profile('me', 'Raimundo');
    profile('incompleto', '');
    profile('ok', 'Raimunda');
    const { players } = await search({ auth: { uid: 'me' }, data: { term: 'rai' } });
    expect(players.map((p) => p.id)).toEqual(['ok']);
    expect((await search({ auth: { uid: 'me' }, data: { term: 'r' } })).players).toEqual([]);
  });

  it('faz busca por prefixo, sem diferenciar maiúsculas', async () => {
    profile('x', 'Tião');
    profile('y', 'Raiana');
    const { players } = await search({ auth: { uid: 'me' }, data: { term: 'TI' } });
    expect(players.map((p) => p.nickname)).toEqual(['Tião']);
  });
});

describe('onAuthUserDeleted', () => {
  it('apaga os documentos do jogador quando a conta some do Auth', async () => {
    profile('fantasma', 'Raiana');
    fs.store.set('users/fantasma', { createdAt: clock });
    fs.store.set('playerStats/fantasma', { matches: 3 });
    await onDeleted({ uid: 'fantasma' });
    expect(fs.store.has('profiles/fantasma')).toBe(false);
    expect(fs.store.has('users/fantasma')).toBe(false);
    expect(fs.store.has('playerStats/fantasma')).toBe(false);
    // Rodar de novo (deleteAccount + trigger) não quebra.
    await expect(onDeleted({ uid: 'fantasma' })).resolves.toBeUndefined();
  });
});
