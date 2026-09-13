import {
  getContactsPermission,
  readDeviceContacts,
  requestContactsPermission,
} from '../contacts';

jest.mock('expo-contacts', () => ({
  ContactField: { FULL_NAME: 'fullName', PHONES: 'phones' },
  Contact: { getCount: jest.fn(), getAllDetails: jest.fn() },
  addContactsChangeListener: jest.fn(),
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
}));

const contacts = jest.requireMock('expo-contacts');

beforeEach(() => jest.clearAllMocks());

/** Resposta do expo-modules-core, nos formatos que cada estado do sistema produz. */
const response = (over: Record<string, unknown>) => ({
  granted: false,
  canAskAgain: true,
  expires: 'never',
  ...over,
});

describe('mapeamento dos estados de permissão', () => {
  it.each([
    ['ainda não perguntado', { status: 'undetermined' }, 'undetermined'],
    ['concedido', { status: 'granted', granted: true }, 'granted'],
    ['negado, dá para perguntar de novo', { status: 'denied' }, 'denied'],
    ['negado definitivamente', { status: 'denied', canAskAgain: false }, 'blocked'],
  ])('%s -> %s', async (_label, raw, expected) => {
    contacts.getPermissionsAsync.mockResolvedValue(response(raw));
    await expect(getContactsPermission()).resolves.toBe(expected);
  });

  it('trata o acesso parcial do iOS 18 como acesso concedido', async () => {
    contacts.getPermissionsAsync.mockResolvedValue(
      response({ status: 'denied', accessPrivileges: 'limited' }),
    );
    await expect(getContactsPermission()).resolves.toBe('granted');
  });

  it('cai em "restricted" quando o módulo nativo falha (política do aparelho)', async () => {
    contacts.getPermissionsAsync.mockRejectedValue(new Error('restricted by policy'));
    await expect(getContactsPermission()).resolves.toBe('restricted');
  });

  it('a solicitação usa o mesmo mapeamento', async () => {
    contacts.requestPermissionsAsync.mockResolvedValue(
      response({ status: 'denied', canAskAgain: false }),
    );
    await expect(requestContactsPermission()).resolves.toBe('blocked');
  });
});

describe('leitura da agenda', () => {
  const page = (n: number, offset = 0) =>
    Array.from({ length: n }, (_, i) => ({
      id: `c${offset + i}`,
      fullName: `Pessoa ${offset + i}`,
      phones: [{ number: `619${String(90000000 + offset + i)}` }],
    }));

  it('pede só nome e telefones — nunca o contato inteiro', async () => {
    contacts.Contact.getCount.mockResolvedValue(1);
    contacts.Contact.getAllDetails.mockResolvedValue(page(1));
    await readDeviceContacts();
    const [fields] = contacts.Contact.getAllDetails.mock.calls[0];
    expect([...fields].sort()).toEqual(['fullName', 'phones']);
  });

  it('lê em páginas em vez de segurar a agenda inteira de uma vez', async () => {
    contacts.Contact.getCount.mockResolvedValue(1_100);
    contacts.Contact.getAllDetails
      .mockResolvedValueOnce(page(500, 0))
      .mockResolvedValueOnce(page(500, 500))
      .mockResolvedValueOnce(page(100, 1000));
    const result = await readDeviceContacts();
    expect(result).toHaveLength(1_100);
    expect(contacts.Contact.getAllDetails).toHaveBeenCalledTimes(3);
    expect(contacts.Contact.getAllDetails.mock.calls.map((c: [unknown, { offset: number }]) =>
      c[1].offset,
    )).toEqual([0, 500, 1000]);
  });

  it('informa o progresso para a tela não parecer travada', async () => {
    contacts.Contact.getCount.mockResolvedValue(600);
    contacts.Contact.getAllDetails
      .mockResolvedValueOnce(page(500, 0))
      .mockResolvedValueOnce(page(100, 500));
    const progress: number[] = [];
    await readDeviceContacts((loaded, total) => progress.push(loaded / total));
    expect(progress).toHaveLength(2);
    expect(progress[progress.length - 1]).toBeCloseTo(1);
  });

  it('descarta contato sem telefone', async () => {
    contacts.Contact.getCount.mockResolvedValue(3);
    contacts.Contact.getAllDetails.mockResolvedValue([
      { id: '1', fullName: 'Sem número', phones: [] },
      { id: '2', fullName: 'Null', phones: null },
      { id: '3', fullName: 'Com número', phones: [{ number: '61996289726' }] },
    ]);
    const result = await readDeviceContacts();
    expect(result.map((c) => c.id)).toEqual(['3']);
  });

  it('aceita agenda vazia sem erro', async () => {
    contacts.Contact.getCount.mockResolvedValue(0);
    contacts.Contact.getAllDetails.mockResolvedValue([]);
    await expect(readDeviceContacts()).resolves.toEqual([]);
  });

  it('transforma falha nativa em ContactsReadError', async () => {
    contacts.Contact.getCount.mockResolvedValue(10);
    contacts.Contact.getAllDetails.mockRejectedValue(new Error('native boom'));
    await expect(readDeviceContacts()).rejects.toThrow('Não foi possível ler os contatos');
  });
});
