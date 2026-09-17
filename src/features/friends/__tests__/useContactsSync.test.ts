import { act, renderHook, waitFor } from '@testing-library/react-native';
import { RECHECK_MS, useContactsSync } from '../useContactsSync';
import { ContactsReadError, type ContactsPermission } from '@/services/contacts';
import { ApiError } from '@/services/api';
import type { DeviceContact } from '../contactsMatch';

jest.mock('@/services/contacts', () => {
  class ContactsReadError extends Error {}
  return {
    ContactsReadError,
    getContactsPermission: jest.fn(),
    requestContactsPermission: jest.fn(),
    readDeviceContacts: jest.fn(),
    subscribeContactsChanged: jest.fn(() => () => undefined),
    openAppSettings: jest.fn(),
  };
});

jest.mock('@/services/api', () => {
  // Sem "parameter property" (`public code`): o Babel proíbe isso dentro da fábrica do mock.
  class ApiError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  }
  return { ApiError, syncPhoneContacts: jest.fn() };
});

jest.mock('@/services/firebase/analytics', () => ({ logEvent: jest.fn() }));
jest.mock('@/services/firebase/crashlytics', () => ({ reportError: jest.fn() }));

// O prefixo `mock` é o que libera a variável dentro da fábrica do jest.mock.
const mockStore = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (k: string) => mockStore.get(k) ?? null),
  setItem: jest.fn(async (k: string, v: string) => void mockStore.set(k, v)),
  removeItem: jest.fn(async (k: string) => void mockStore.delete(k)),
}));

const contactsService = jest.requireMock('@/services/contacts');
const functionsService = jest.requireMock('@/services/api');
const analytics = jest.requireMock('@/services/firebase/analytics');

const setPermission = (p: ContactsPermission) => {
  contactsService.getContactsPermission.mockResolvedValue(p);
  contactsService.requestContactsPermission.mockResolvedValue(p);
};

const agendaOf = (n: number): DeviceContact[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `c${i}`,
    name: `Pessoa ${i}`,
    phones: [`619${String(90000000 + i)}`],
  }));

beforeEach(() => {
  jest.clearAllMocks();
  mockStore.clear();
  contactsService.readDeviceContacts.mockResolvedValue([]);
  functionsService.syncPhoneContacts.mockResolvedValue({ matches: [], remainingQuota: 3000 });
});

// `renderHook` da v14 devolve Promise: sem o await, `result` vem indefinido.
const setup = () => renderHook(() => useContactsSync('me', 'BR', '+5561900000000'));

describe('useContactsSync — permissões', () => {
  it('não toca na agenda antes de o usuário pedir', async () => {
    setPermission('undetermined');
    const { result } = await setup();
    await waitFor(() => expect(result.current.permission).toBe('undetermined'));
    expect(contactsService.readDeviceContacts).not.toHaveBeenCalled();
    expect(contactsService.requestContactsPermission).not.toHaveBeenCalled();
  });

  it('pede a permissão do sistema só quando a sincronização é acionada', async () => {
    setPermission('undetermined');
    contactsService.requestContactsPermission.mockResolvedValue('granted');
    contactsService.readDeviceContacts.mockResolvedValue(agendaOf(3));
    const { result } = await setup();
    await act(async () => {
      await result.current.sync();
    });
    expect(contactsService.requestContactsPermission).toHaveBeenCalledTimes(1);
    expect(result.current.permission).toBe('granted');
  });

  it.each<ContactsPermission>(['denied', 'blocked', 'restricted'])(
    'para no estado "%s" sem ler a agenda',
    async (perm) => {
      setPermission(perm);
      const { result } = await setup();
      await act(async () => {
        await result.current.sync();
      });
      expect(result.current.error).toBe('permission');
      expect(contactsService.readDeviceContacts).not.toHaveBeenCalled();
    },
  );

  it('não reabre o diálogo do sistema quando já está bloqueado', async () => {
    setPermission('blocked');
    const { result } = await setup();
    await act(async () => {
      await result.current.sync();
    });
    expect(contactsService.requestContactsPermission).not.toHaveBeenCalled();
  });

  it('esquece o resultado guardado se a permissão foi revogada fora do app', async () => {
    setPermission('granted');
    contactsService.readDeviceContacts.mockResolvedValue(agendaOf(2));
    const first = await setup();
    await act(async () => {
      await first.result.current.sync();
    });
    expect(first.result.current.syncedAt).not.toBeNull();

    setPermission('blocked');
    const second = await setup();
    await waitFor(() => expect(second.result.current.permission).toBe('blocked'));
    expect(second.result.current.syncedAt).toBeNull();
    expect(second.result.current.result.unmatched).toHaveLength(0);
  });
});

describe('useContactsSync — lotes', () => {
  beforeEach(() => setPermission('granted'));

  it('faz UMA requisição por lote de 200, nunca uma por contato', async () => {
    contactsService.readDeviceContacts.mockResolvedValue(agendaOf(450));
    const { result } = await setup();
    await act(async () => {
      await result.current.sync();
    });
    expect(functionsService.syncPhoneContacts).toHaveBeenCalledTimes(3); // 200 + 200 + 50
    const sizes = functionsService.syncPhoneContacts.mock.calls.map((c: [string[]]) => c[0].length);
    expect(sizes).toEqual([200, 200, 50]);
  });

  it('envia só números em E.164 — nenhum nome da agenda sobe', async () => {
    contactsService.readDeviceContacts.mockResolvedValue([
      { id: '1', name: 'João Faculdade', phones: ['(61) 9.9628-9726'] },
    ]);
    const { result } = await setup();
    await act(async () => {
      await result.current.sync();
    });
    const [payload] = functionsService.syncPhoneContacts.mock.calls[0] as [string[]];
    expect(payload).toEqual(['+5561996289726']);
    expect(JSON.stringify(payload)).not.toContain('João');
  });

  it('reposiciona os índices de cada lote na agenda inteira', async () => {
    contactsService.readDeviceContacts.mockResolvedValue(agendaOf(250));
    // O servidor responde com o índice DENTRO do lote; o segundo lote começa do zero de novo.
    functionsService.syncPhoneContacts
      .mockResolvedValueOnce({ matches: [], remainingQuota: 3000 })
      .mockResolvedValueOnce({
        matches: [
          { index: 0, uid: 'u1', nickname: 'Nick', avatarId: 'joao', level: 1, relation: 'none' },
        ],
        remainingQuota: 3000,
      });
    const { result } = await setup();
    await act(async () => {
      await result.current.sync();
    });
    // Índice 0 do segundo lote = contato 200 da agenda.
    expect(result.current.result.matched).toHaveLength(1);
    expect(result.current.result.matched[0]!.contactName).toBe('Pessoa 200');
  });

  it('não gasta rede quando a agenda não mudou', async () => {
    contactsService.readDeviceContacts.mockResolvedValue(agendaOf(5));
    const { result } = await setup();
    await act(async () => {
      await result.current.sync();
    });
    expect(functionsService.syncPhoneContacts).toHaveBeenCalledTimes(1);
    await act(async () => {
      await result.current.sync();
    });
    expect(functionsService.syncPhoneContacts).toHaveBeenCalledTimes(1);
  });

  it('ao reabrir a tela, a sincronização automática usa o cache e não vai ao servidor', async () => {
    contactsService.readDeviceContacts.mockResolvedValue(agendaOf(5));
    const first = await setup();
    await act(async () => {
      await first.result.current.sync();
    });
    expect(functionsService.syncPhoneContacts).toHaveBeenCalledTimes(1);
    await first.unmount();

    // Tela montada de novo e sincronização disparada logo no foco, antes do cache terminar de
    // carregar: ela espera o cache e reconhece que a agenda é a mesma.
    const second = await setup();
    await act(async () => {
      await second.result.current.sync();
    });
    expect(functionsService.syncPhoneContacts).toHaveBeenCalledTimes(1);
    expect(second.result.current.syncedAt).not.toBeNull();
  });

  it('refaz a busca quando a agenda muda', async () => {
    contactsService.readDeviceContacts.mockResolvedValue(agendaOf(5));
    const { result } = await setup();
    await act(async () => {
      await result.current.sync();
    });
    contactsService.readDeviceContacts.mockResolvedValue(agendaOf(6));
    await act(async () => {
      await result.current.sync();
    });
    expect(functionsService.syncPhoneContacts).toHaveBeenCalledTimes(2);
  });

  it('ignora uma segunda sincronização enquanto a primeira está rodando', async () => {
    let release: (v: DeviceContact[]) => void = () => undefined;
    contactsService.readDeviceContacts.mockReturnValue(
      new Promise<DeviceContact[]>((resolve) => {
        release = resolve;
      }),
    );
    const { result } = await setup();
    let first: Promise<unknown>;
    await act(async () => {
      first = result.current.sync();
      await act(async () => {
        await result.current.sync();
      }); // concorrente: deve ser descartada
      release(agendaOf(2));
      await act(async () => {
        await first;
      });
    });
    expect(contactsService.readDeviceContacts).toHaveBeenCalledTimes(1);
  });
});

describe('useContactsSync — erros', () => {
  beforeEach(() => setPermission('granted'));

  it('classifica falha de leitura da agenda', async () => {
    contactsService.readDeviceContacts.mockRejectedValue(new ContactsReadError());
    const { result } = await setup();
    await act(async () => {
      await result.current.sync();
    });
    expect(result.current.error).toBe('read');
    expect(result.current.syncing).toBe(false);
  });

  it.each([
    ['unavailable', 'offline'],
    ['resource-exhausted', 'rate_limit'],
    ['unauthenticated', 'app_check'],
    ['failed-precondition', 'unavailable'],
    ['internal', 'unknown'],
  ])('traduz o erro "%s" do servidor em "%s"', async (code, expected) => {
    contactsService.readDeviceContacts.mockResolvedValue(agendaOf(2));
    functionsService.syncPhoneContacts.mockRejectedValue(new ApiError(code as never, 'falhou'));
    const { result } = await setup();
    await act(async () => {
      await result.current.sync();
    });
    expect(result.current.error).toBe(expected);
  });

  it('nunca manda telefone para a telemetria', async () => {
    contactsService.readDeviceContacts.mockResolvedValue(agendaOf(3));
    const { result } = await setup();
    await act(async () => {
      await result.current.sync();
    });
    const logged = JSON.stringify(analytics.logEvent.mock.calls);
    expect(logged).not.toContain('+55');
    expect(logged).not.toContain('9000000');
  });
});

describe('useContactsSync — estado local', () => {
  beforeEach(() => setPermission('granted'));

  it('atualiza a relação de um contato sem re-sincronizar', async () => {
    contactsService.readDeviceContacts.mockResolvedValue(agendaOf(1));
    functionsService.syncPhoneContacts.mockResolvedValue({
      matches: [
        { index: 0, uid: 'alvo', nickname: 'Nick', avatarId: 'joao', level: 1, relation: 'none' },
      ],
      remainingQuota: 3000,
    });
    const { result } = await setup();
    await act(async () => {
      await result.current.sync();
    });
    expect(result.current.result.matched[0]!.relation).toBe('none');
    await act(async () => result.current.setRelation('alvo', 'request_sent'));
    expect(result.current.result.matched[0]!.relation).toBe('request_sent');
    expect(functionsService.syncPhoneContacts).toHaveBeenCalledTimes(1);
  });

  it('limpa tudo que foi guardado no aparelho', async () => {
    contactsService.readDeviceContacts.mockResolvedValue(agendaOf(2));
    const { result } = await setup();
    await act(async () => {
      await result.current.sync();
    });
    expect(mockStore.size).toBe(1);
    await act(async () => {
      await result.current.forget();
    });
    expect(mockStore.size).toBe(0);
    expect(result.current.syncedAt).toBeNull();
  });

  it('o que fica no disco não contém telefone nenhum', async () => {
    contactsService.readDeviceContacts.mockResolvedValue([
      { id: '1', name: 'João', phones: ['61996289726'] },
    ]);
    const { result } = await setup();
    await act(async () => {
      await result.current.sync();
    });
    const saved = [...mockStore.values()].join('');
    expect(saved).not.toContain('996289726');
    expect(saved).not.toContain('+55');
  });
});

describe('useContactsSync — apagado em Configurações', () => {
  beforeEach(() => setPermission('granted'));

  it('some da tela quando o cache é apagado por outra tela', async () => {
    contactsService.readDeviceContacts.mockResolvedValue(agendaOf(3));
    const { result } = await setup();
    await act(async () => {
      await result.current.sync();
    });
    expect(result.current.syncedAt).not.toBeNull();
    expect(result.current.result.unmatched).toHaveLength(3);

    // É o que a tela Configurações chama — a aba Amigos continua montada por trás.
    const { clearContactsSync } =
      jest.requireActual<typeof import('../contactsCache')>('../contactsCache');
    await act(async () => {
      await clearContactsSync('me');
    });
    expect(result.current.syncedAt).toBeNull();
    expect(result.current.result.unmatched).toHaveLength(0);
  });
});

describe('useContactsSync — conexão automática', () => {
  beforeEach(() => setPermission('granted'));

  const player = (index: number, uid: string, over: object = {}) => ({
    index,
    uid,
    nickname: uid,
    avatarId: 'joao',
    level: 1,
    relation: 'friend',
    ...over,
  });

  it('quem tem conta volta como amigo e só quem não tem fica para convidar', async () => {
    contactsService.readDeviceContacts.mockResolvedValue(agendaOf(3));
    functionsService.syncPhoneContacts.mockResolvedValue({
      matches: [player(0, 'b', { autoConnected: true })],
      remainingQuota: 3000,
      connected: 1,
    });
    const { result } = await setup();
    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.sync();
    });
    expect(outcome).toEqual({ skipped: false, connected: 1 });
    expect(result.current.result.matched).toMatchObject([{ uid: 'b', relation: 'friend' }]);
    expect(result.current.result.unmatched.map((u) => u.contactId)).toEqual(['c1', 'c2']);
    expect(analytics.logEvent).toHaveBeenCalledWith('auto_friend_connected', { count: 1 });
    expect(analytics.logEvent).toHaveBeenCalledWith('contact_without_account', { count: 2 });
  });

  it('soma as conexões de todos os lotes num único resultado (um aviso só)', async () => {
    contactsService.readDeviceContacts.mockResolvedValue(agendaOf(450));
    functionsService.syncPhoneContacts.mockResolvedValue({
      matches: [],
      remainingQuota: 3000,
      connected: 2,
    });
    const { result } = await setup();
    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.sync();
    });
    expect(outcome).toEqual({ skipped: false, connected: 6 });
  });

  it('com a agenda igual, volta ao servidor depois de um dia (quem instalou depois vira amigo)', async () => {
    contactsService.readDeviceContacts.mockResolvedValue(agendaOf(2));
    const realNow = Date.now;
    const { result } = await setup();
    await act(async () => {
      await result.current.sync();
    });
    expect(functionsService.syncPhoneContacts).toHaveBeenCalledTimes(1);

    functionsService.syncPhoneContacts.mockResolvedValue({
      matches: [player(1, 'carlos', { autoConnected: true })],
      remainingQuota: 3000,
      connected: 1,
    });
    const later = realNow() + RECHECK_MS + 1;
    Date.now = () => later;
    try {
      let outcome: unknown;
      await act(async () => {
        outcome = await result.current.sync();
      });
      expect(functionsService.syncPhoneContacts).toHaveBeenCalledTimes(2);
      expect(outcome).toEqual({ skipped: false, connected: 1 });
      // Carlos saiu de "convidar" e entrou nos matches como amigo.
      expect(result.current.result.unmatched.map((u) => u.contactId)).toEqual(['c0']);
      expect(result.current.result.matched[0]).toMatchObject({ uid: 'carlos', relation: 'friend' });
    } finally {
      Date.now = realNow;
    }
  });

  it('agenda igual e consulta recente: não vai ao servidor e avisa que pulou', async () => {
    contactsService.readDeviceContacts.mockResolvedValue(agendaOf(2));
    const { result } = await setup();
    await act(async () => {
      await result.current.sync();
    });
    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.sync();
    });
    expect(outcome).toEqual({ skipped: true, connected: 0 });
  });

  it('permissão negada: nada é lido, nada conecta; concedida depois, sincroniza', async () => {
    setPermission('denied');
    contactsService.readDeviceContacts.mockResolvedValue(agendaOf(1));
    const { result } = await setup();
    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.sync();
    });
    expect(outcome).toBeNull();
    expect(contactsService.readDeviceContacts).not.toHaveBeenCalled();
    expect(functionsService.syncPhoneContacts).not.toHaveBeenCalled();

    setPermission('granted');
    functionsService.syncPhoneContacts.mockResolvedValue({
      matches: [player(0, 'b', { autoConnected: true })],
      remainingQuota: 3000,
      connected: 1,
    });
    await act(async () => {
      outcome = await result.current.sync();
    });
    expect(outcome).toEqual({ skipped: false, connected: 1 });
  });

  it('sem internet: mantém o último resultado e deixa tentar de novo', async () => {
    contactsService.readDeviceContacts.mockResolvedValue(agendaOf(2));
    const { result } = await setup();
    await act(async () => {
      await result.current.sync();
    });
    functionsService.syncPhoneContacts.mockRejectedValue(new ApiError('unavailable', 'x'));
    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.sync({ force: true });
    });
    expect(outcome).toBeNull();
    expect(result.current.error).toBe('offline');
    expect(result.current.result.unmatched).toHaveLength(2);

    functionsService.syncPhoneContacts.mockResolvedValue({ matches: [], remainingQuota: 3000 });
    await act(async () => {
      outcome = await result.current.sync({ force: true });
    });
    expect(outcome).toEqual({ skipped: false, connected: 0 });
    expect(result.current.error).toBeNull();
  });

  it('falha ao consultar a permissão não apaga a agenda guardada', async () => {
    contactsService.readDeviceContacts.mockResolvedValue(agendaOf(2));
    const first = await setup();
    await act(async () => {
      await first.result.current.sync();
    });
    await first.unmount();

    // `getContactsPermission` devolve 'restricted' quando a ponte nativa falha.
    setPermission('restricted');
    const second = await setup();
    await waitFor(() => expect(second.result.current.permission).toBe('restricted'));
    setPermission('granted');
    const third = await setup();
    await waitFor(() => expect(third.result.current.syncedAt).not.toBeNull());
    expect(third.result.current.result.unmatched).toHaveLength(2);
  });
});
