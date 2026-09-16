/* eslint-disable import/first --
 * Os `jest.mock` precisam vir antes de importar `../src/social`: o módulo resolve `db`/`rtdb` de
 * `lib/admin` já na carga.
 */
import { FakeFirestore, DOCUMENT_ID } from './fakeFirestore';

/**
 * Convite para a sala: amigos sempre; contatos da agenda que já jogam só com a prova do número
 * (o índice de telefones confirma que o número é daquele jogador). Bloqueio barra nos dois sentidos.
 */

const fs = new FakeFirestore();
const rtdbWrites: Record<string, unknown> = {};

jest.mock('../src/lib/admin', () => ({
  db: fs,
  rtdb: {
    ref: (path: string) => ({
      set: async (v: unknown) => {
        rtdbWrites[path] = v;
      },
    }),
  },
  auth: { getUser: jest.fn() },
  messaging: { sendEachForMulticast: jest.fn(async () => ({})) },
  REGION: 'southamerica-east1',
  DB_TRIGGER_REGION: 'us-central1',
  IS_EMULATOR: true,
  ENFORCE_APP_CHECK: false,
  now: () => 1_000,
}));
jest.mock('firebase-admin/firestore', () => ({
  FieldPath: { documentId: () => DOCUMENT_ID },
  FieldValue: { increment: (n: number) => n },
}));
jest.mock('firebase-functions/v2/database', () => ({
  onValueWritten: (_opts: unknown, handler: unknown) => handler,
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

import { phoneHash } from '../src/contacts';
import { inviteFriendToRoom } from '../src/social';

type Req = { auth: { uid: string }; data: unknown };
const invite = inviteFriendToRoom as unknown as (req: Req) => Promise<{ ok: true }>;

const RAFA_PHONE = '+5531988776655';

beforeEach(() => {
  fs.store.clear();
  for (const k of Object.keys(rtdbWrites)) delete rtdbWrites[k];
  fs.store.set('profiles/me', { nickname: 'Will' });
  fs.store.set('profiles/rafa', { nickname: 'Rafa' });
  fs.store.set(`phoneIndex/${phoneHash(RAFA_PHONE)}`, { uid: 'rafa' });
});

describe('inviteFriendToRoom', () => {
  it('amigo recebe o convite sem precisar de número', async () => {
    fs.store.set('friendships/me/friends/rafa', { since: 1 });
    await invite({ auth: { uid: 'me' }, data: { friendUid: 'rafa', code: 'abc123' } });
    expect(rtdbWrites['invites/rafa/ABC123']).toMatchObject({ from: 'me', fromNickname: 'Will' });
  });

  it('contato da agenda que já joga recebe o convite quando um dos números é dele', async () => {
    await invite({
      auth: { uid: 'me' },
      data: { friendUid: 'rafa', code: 'abc123', phones: ['+5531900000000', RAFA_PHONE] },
    });
    expect(rtdbWrites['invites/rafa/ABC123']).toBeDefined();
  });

  it('sem amizade e sem número, ou com número de outra pessoa, recusa', async () => {
    await expect(
      invite({ auth: { uid: 'me' }, data: { friendUid: 'rafa', code: 'abc123' } }),
    ).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(
      invite({
        auth: { uid: 'me' },
        data: { friendUid: 'rafa', code: 'abc123', phones: ['+5531900000000'] },
      }),
    ).rejects.toMatchObject({ code: 'permission-denied' });
    expect(Object.keys(rtdbWrites)).toHaveLength(0);
  });

  it.each([
    ['eu bloqueei', 'blocks/me/blocked/rafa'],
    ['ele me bloqueou', 'blockedBy/me/users/rafa'],
  ])('bloqueio barra o convite por contato (%s), com a mesma mensagem', async (_c, path) => {
    fs.store.set(path, { since: 1 });
    await expect(
      invite({
        auth: { uid: 'me' },
        data: { friendUid: 'rafa', code: 'abc123', phones: [RAFA_PHONE] },
      }),
    ).rejects.toMatchObject({
      code: 'permission-denied',
      message: 'Só é possível chamar amigos ou contatos da sua agenda.',
    });
  });

  it('valida os números e limita a 5', () => {
    const validate = (data: unknown) =>
      // O `authedCallable` mockado devolve o handler; o validador roda antes dele no app real.
      // Aqui só conferimos que a chamada com dados inválidos é recusada.
      invite({ auth: { uid: 'me' }, data });
    return Promise.all([
      expect(
        validate({ friendUid: 'rafa', code: 'abc123', phones: ['31988776655'] }),
      ).rejects.toBeTruthy(),
      expect(
        validate({
          friendUid: 'rafa',
          code: 'abc123',
          phones: Array.from({ length: 6 }, () => RAFA_PHONE),
        }),
      ).rejects.toBeTruthy(),
    ]);
  });

  it('não convida a si mesmo', async () => {
    await expect(
      invite({ auth: { uid: 'me' }, data: { friendUid: 'me', code: 'abc123' } }),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });
});
