/* eslint-disable import/first --
 * Os `jest.mock` precisam vir antes de importar `../src/users`: o módulo resolve `db` e `now` de
 * `lib/admin` já na carga, então importá-lo primeiro pegaria o Firestore real.
 */
import { FakeFirestore, DOCUMENT_ID } from './fakeFirestore';

/**
 * Cadastro de um usuário novo contra um Firestore em memória:
 * login → `bootstrapUser` → cadastro (`updateProfile`) → liga Bronze com grupo semanal.
 */

const fs = new FakeFirestore();
const clock = Date.parse('2026-09-09T15:00:00-03:00');

jest.mock('../src/lib/admin', () => ({
  db: fs,
  rtdb: {},
  auth: { getUser: jest.fn(async () => ({ phoneNumber: '+5511900000000' })) },
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

import * as leagues from '../src/leagues';
import { bootstrapUser, updateProfile } from '../src/users';

type Callable<T, R> = (req: { auth: { uid: string }; data: T }) => Promise<R>;
const bootstrap = bootstrapUser as unknown as Callable<
  Record<string, never>,
  { onboarded: boolean }
>;
const register = updateProfile as unknown as Callable<
  { nickname: string; avatarId: string },
  { ok: true }
>;

const doc = (path: string) => fs.store.get(path) as Record<string, unknown> | undefined;

function memberDocs(uid: string) {
  return fs.docsIn('weeklyLeagueGroups').flatMap((g) =>
    fs
      .docsIn(`weeklyLeagueGroups/${g.id}/members`)
      .filter((m) => m.id === uid)
      .map((m) => ({ group: g, member: m })),
  );
}

beforeEach(() => {
  fs.store.clear();
  jest.restoreAllMocks();
});

describe('cadastro de usuário novo', () => {
  it('primeiro login cria os documentos, não está pronto, e ainda não entra na liga sem nome', async () => {
    const res = await bootstrap({ auth: { uid: 'novo' }, data: {} });
    expect(res).toEqual({ onboarded: false });
    expect(doc('users/novo')).toBeDefined();
    expect(doc('profiles/novo')).toMatchObject({ nickname: '', leagueId: 'bronze' });
    expect(doc('playerStats/novo')).toBeDefined();
    expect(memberDocs('novo')).toHaveLength(0);
  });

  it('o cadastro grava apelido + avatar e coloca o jogador na Bronze, num grupo da semana', async () => {
    await bootstrap({ auth: { uid: 'novo' }, data: {} });
    await register({ auth: { uid: 'novo' }, data: { nickname: 'Zé da Serra', avatarId: 'galo' } });

    expect(doc('profiles/novo')).toMatchObject({ nickname: 'Zé da Serra', avatarId: 'galo' });
    expect(doc('playerProgress/novo')).toMatchObject({ currentLeagueId: 'bronze' });
    const placements = memberDocs('novo');
    expect(placements).toHaveLength(1);
    expect(placements[0]!.group.data).toMatchObject({ leagueId: 'bronze' });
    // A linha do ranking já nasce com o nome e o avatar escolhidos.
    expect(placements[0]!.member.data).toMatchObject({ nickname: 'Zé da Serra', avatarId: 'galo' });
    // E o próximo login entra direto.
    expect(await bootstrap({ auth: { uid: 'novo' }, data: {} })).toEqual({ onboarded: true });
  });

  it('cadastro funciona mesmo se o primeiro bootstrap não rodou (conta parcial)', async () => {
    await register({ auth: { uid: 'parcial' }, data: { nickname: 'Parcial', avatarId: 'tiao' } });
    expect(doc('users/parcial')).toBeDefined();
    expect(doc('playerStats/parcial')).toBeDefined();
    expect(doc('profiles/parcial')).toMatchObject({ nickname: 'Parcial', avatarId: 'tiao' });
    expect(memberDocs('parcial')).toHaveLength(1);
  });

  it('se a liga falhar, o cadastro não termina (sem apelido) e a nova tentativa conclui', async () => {
    await bootstrap({ auth: { uid: 'falha' }, data: {} });
    const spy = jest
      .spyOn(leagues, 'ensureAssignment')
      .mockRejectedValueOnce(new Error('firestore indisponível'));
    await expect(
      register({ auth: { uid: 'falha' }, data: { nickname: 'Tentativa', avatarId: 'joao' } }),
    ).rejects.toMatchObject({ code: 'unavailable' });
    expect(doc('profiles/falha')).toMatchObject({ nickname: '' });
    spy.mockRestore();

    await register({ auth: { uid: 'falha' }, data: { nickname: 'Tentativa', avatarId: 'joao' } });
    expect(doc('profiles/falha')).toMatchObject({ nickname: 'Tentativa' });
    expect(memberDocs('falha')).toHaveLength(1);
  });

  it('repetir o cadastro não duplica perfil nem grupo', async () => {
    await bootstrap({ auth: { uid: 'dup' }, data: {} });
    await register({ auth: { uid: 'dup' }, data: { nickname: 'Dup', avatarId: 'maria' } });
    await register({ auth: { uid: 'dup' }, data: { nickname: 'Dup', avatarId: 'maria' } });
    await bootstrap({ auth: { uid: 'dup' }, data: {} });
    expect(memberDocs('dup')).toHaveLength(1);
    const group = memberDocs('dup')[0]!.group;
    expect(group.data.memberCount).toBe(1);
  });

  it('editar o perfil atualiza nome e avatar na liga', async () => {
    await register({ auth: { uid: 'edita' }, data: { nickname: 'Antes', avatarId: 'joao' } });
    await register({ auth: { uid: 'edita' }, data: { nickname: 'Depois', avatarId: 'cachorro' } });
    expect(memberDocs('edita')[0]!.member.data).toMatchObject({
      nickname: 'Depois',
      avatarId: 'cachorro',
    });
  });

  it('usuário antigo sem liga é consertado no próximo login', async () => {
    fs.store.set('profiles/antigo', { nickname: 'Antigo', avatarId: 'joao', countryCode: 'BR' });
    expect(await bootstrap({ auth: { uid: 'antigo' }, data: {} })).toEqual({ onboarded: true });
    expect(memberDocs('antigo')).toHaveLength(1);
  });

  it('recusa apelido inválido sem criar nada na liga', async () => {
    await expect(
      register({ auth: { uid: 'curto' }, data: { nickname: 'Zé', avatarId: 'joao' } }),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(memberDocs('curto')).toHaveLength(0);
  });
});
