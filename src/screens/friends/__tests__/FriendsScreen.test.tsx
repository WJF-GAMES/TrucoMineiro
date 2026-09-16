import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { FriendsScreen } from '../FriendsScreen';
import type { FriendRequest, Presence, Profile, RoomInvite } from '@/domain/model/types';

/**
 * A tela Amigos é onde toda ação social do app acontece, e nenhuma delas pode ser decorativa:
 * cada botão aqui tem que chamar a Cloud Function certa (ou o RTDB certo) e refletir o resultado.
 * Estes testes cobrem exatamente isso, incluindo os caminhos que antes não existiam —
 * convite de sala recebido, ficha do amigo, bloqueio e desbloqueio.
 */

// --- Mocks ------------------------------------------------------------------

// As fábricas de `jest.mock` rodam antes do corpo do arquivo, então os mocks nascem dentro
// delas e são recuperados com `requireMock` — nunca por variável de fora.
jest.mock('@/services/firebase/functions', () => {
  class FunctionsError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  }
  const ok = () => Promise.resolve({ ok: true });
  return {
    FunctionsError,
    sendFriendRequest: jest.fn(ok),
    respondFriendRequest: jest.fn(ok),
    cancelFriendRequest: jest.fn(ok),
    removeFriend: jest.fn(ok),
    blockUser: jest.fn(ok),
    unblockUser: jest.fn(ok),
    inviteFriendToRoom: jest.fn(ok),
    createRoom: jest.fn(() => Promise.resolve({ code: 'ZZZ999' })),
    joinRoom: jest.fn(() => Promise.resolve({ code: 'ABC123' })),
    createFriendInviteToken: jest.fn(() =>
      Promise.resolve({ token: 't', link: 'trucomineiro://add-friend?token=t', expiresAt: 0 }),
    ),
    resolveFriendInviteToken: jest.fn(() => Promise.resolve({ uid: 'other' })),
  };
});

const fns = jest.requireMock<Record<string, jest.Mock>>('@/services/firebase/functions');

const mockSearchProfiles = jest.fn<Promise<Profile[]>, [string]>();

/** Prefixo `mock` é o que libera o uso dentro das fábricas de `jest.mock`. */
function mockProfileOf(uid: string) {
  return { ...baseProfile(uid), nickname: uid === 'blk' ? 'Chatão' : uid };
}
const mockEmit = {
  friends: null as ((ids: { id: string }[]) => void) | null,
  blocked: null as ((ids: string[]) => void) | null,
  incoming: null as ((r: FriendRequest[]) => void) | null,
  outgoing: null as ((r: FriendRequest[]) => void) | null,
  invites: null as ((i: RoomInvite[]) => void) | null,
  presence: {} as Record<string, (p: Presence | null) => void>,
};

jest.mock('@/services/firebase/firestore', () => ({
  searchProfiles: (term: string) => mockSearchProfiles(term),
  // Perfil público de qualquer uid: o apelido é o próprio uid, menos o bloqueado do teste.
  getProfile: (uid: string) => Promise.resolve(mockProfileOf(uid)),
  subscribeFriends: (_uid: string, cb: (ids: { id: string }[]) => void) => {
    mockEmit.friends = cb;
    return () => undefined;
  },
  subscribeBlockedUsers: (_uid: string, cb: (ids: string[]) => void) => {
    mockEmit.blocked = cb;
    return () => undefined;
  },
  subscribeIncomingRequests: (_uid: string, cb: (r: FriendRequest[]) => void) => {
    mockEmit.incoming = cb;
    return () => undefined;
  },
  subscribeOutgoingRequests: (_uid: string, cb: (r: FriendRequest[]) => void) => {
    mockEmit.outgoing = cb;
    return () => undefined;
  },
  subscribeStats: (_uid: string, cb: (s: unknown) => void) => {
    cb({ id: _uid, matches: 10, wins: 7, losses: 3, winRate: 70 });
    return () => undefined;
  },
}));

jest.mock('@/services/firebase/rtdb', () => ({
  subscribePresence: (uid: string, cb: (p: Presence | null) => void) => {
    mockEmit.presence[uid] = cb;
    return () => undefined;
  },
  subscribeRoomInvites: (_uid: string, cb: (i: RoomInvite[]) => void) => {
    mockEmit.invites = cb;
    return () => undefined;
  },
  deleteRoomInvite: jest.fn(() => Promise.resolve()),
}));

// O GameHeader chama `useNavigation`; a tela recebe a navegação por prop, então basta o mínimo.
// `useFocusEffect` roda como um efeito de montagem: a tela "ganha foco" ao aparecer.
jest.mock('@react-navigation/native', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  return {
    useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
    useFocusEffect: (cb: () => void | (() => void)) => useEffect(cb, [cb]),
  };
});

// O card de anúncio do rodapé puxa o SDK nativo do AdMob: fora do escopo desta tela.
jest.mock('@/ads', () => ({ NativeAdCard: () => null }));

// expo-contacts é módulo nativo; a tela só usa "abrir configurações" dele.
const mockContactPhones = jest.fn((..._args: unknown[]) => Promise.resolve(['(31) 98877-6655']));
jest.mock('@/services/contacts', () => ({
  openAppSettings: jest.fn(),
  readContactPhones: (...args: unknown[]) => mockContactPhones(...args),
}));

const mockFlag = jest.fn(() => true);
jest.mock('@/services/firebase/remoteConfig', () => ({ flag: () => mockFlag() }));
jest.mock('@/services/firebase/analytics', () => ({ logEvent: jest.fn() }));
// O toast de verdade agenda um timer de 3,2s por mensagem e deixaria o Jest pendurado.
jest.mock('@/stores/toastStore', () => ({
  toast: { info: jest.fn(), success: jest.fn(), error: jest.fn() },
}));
jest.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ user: { uid: 'me', phoneNumber: '+5531988887777' } }),
}));
jest.mock('@/stores/profileStore', () => ({
  useProfileStore: (selector: (s: unknown) => unknown) =>
    selector({ profile: { nickname: 'EuMesmo' } }),
}));

// A agenda tem o seu próprio conjunto de testes; aqui ela fica parada para não competir
// com o que está sendo verificado.
const mockSetRelation = jest.fn();
const mockSync = jest.fn(() => Promise.resolve());
/** Estado da agenda que cada teste pode trocar (por padrão: nunca sincronizada). */
const mockAgenda = {
  permission: 'undetermined' as string,
  result: { matched: [] as unknown[], unmatched: [] as unknown[] },
  syncedAt: null as number | null,
  contactCount: 0,
};
jest.mock('@/features/friends/useContactsSync', () => ({
  useContactsSync: () => ({
    ...mockAgenda,
    stale: false,
    syncing: false,
    progress: { phase: 'idle', ratio: null },
    error: null,
    sync: (...args: unknown[]) => mockSync(...(args as [])),
    refreshPermission: jest.fn(),
    setRelation: (...args: unknown[]) => mockSetRelation(...args),
    forget: jest.fn(),
  }),
}));

// --- Fixtures ---------------------------------------------------------------

function baseProfile(id: string, over: Partial<Profile> = {}): Profile {
  return {
    id,
    nickname: id,
    nicknameLower: id.toLowerCase(),
    avatarId: 'joao',
    countryCode: 'BR',
    level: 4,
    xp: 10,
    xpToNext: 300,
    leagueId: 'gold',
    leaguePoints: 1200,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

function request(over: Partial<FriendRequest> = {}): FriendRequest {
  return {
    id: 'other_me',
    from: 'other',
    to: 'me',
    fromNickname: 'Tião',
    fromAvatarId: 'joao',
    toNickname: 'EuMesmo',
    toAvatarId: 'maria',
    status: 'pending',
    createdAt: 1,
    ...over,
  };
}

const navigate = jest.fn();
const navigation = { navigate, goBack: jest.fn() } as never;
const route = { key: 'Friends', name: 'Friends', params: undefined } as never;

const SAFE_AREA = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const renderScreen = () =>
  render(
    <SafeAreaProvider initialMetrics={SAFE_AREA}>
      <FriendsScreen navigation={navigation} route={route} />
    </SafeAreaProvider>,
  );

/** Liga os snapshots do backend (amigos, presença, solicitações, bloqueios e convites). */
async function seed(
  options: {
    friends?: string[];
    presence?: Record<string, Presence['state']>;
    incoming?: FriendRequest[];
    outgoing?: FriendRequest[];
    blocked?: string[];
    invites?: RoomInvite[];
  } = {},
) {
  const view = await renderScreen();
  await act(async () => {
    mockEmit.friends?.((options.friends ?? []).map((id) => ({ id })));
    mockEmit.incoming?.(options.incoming ?? []);
    mockEmit.outgoing?.(options.outgoing ?? []);
    mockEmit.blocked?.(options.blocked ?? []);
    mockEmit.invites?.(options.invites ?? []);
  });
  await act(async () => {
    Object.entries(options.presence ?? {}).forEach(([uid, state]) =>
      mockEmit.presence[uid]?.({ state, lastChanged: 0 }),
    );
  });
  return view;
}

/** Responde ao Alert.alert escolhendo o botão de rótulo dado (as confirmações destrutivas). */
function autoConfirm(label: string) {
  return jest.spyOn(Alert, 'alert').mockImplementation(((
    _t: string,
    _m?: string,
    buttons?: { text?: string; onPress?: () => void }[],
  ) => {
    buttons?.find((b) => b.text === label)?.onPress?.();
  }) as unknown as typeof Alert.alert);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFlag.mockReturnValue(true);
  mockEmit.presence = {};
  mockAgenda.permission = 'undetermined';
  mockAgenda.result = { matched: [], unmatched: [] };
  mockAgenda.syncedAt = null;
  mockAgenda.contactCount = 0;
});

afterEach(() => jest.restoreAllMocks());

// --- Testes -----------------------------------------------------------------

describe('FriendsScreen — amigos', () => {
  it('lista amigos com a presença que veio do RTDB', async () => {
    const view = await seed({
      friends: ['zeh', 'maria'],
      presence: { zeh: 'online', maria: 'in_match' },
    });

    expect(await view.findByText('zeh')).toBeTruthy();
    expect(view.getByText('Online')).toBeTruthy();
    expect(view.getByText('Na partida')).toBeTruthy();
  });

  it('"Jogar" cria a sala, convida o amigo e vai para o lobby', async () => {
    const view = await seed({ friends: ['zeh'], presence: { zeh: 'online' } });

    await act(async () => {
      fireEvent.press(view.getByTestId('friend-play-zeh'));
    });

    expect(fns.createRoom).toHaveBeenCalled();
    // Amigo: sem prova de agenda.
    expect(fns.inviteFriendToRoom).toHaveBeenCalledWith('zeh', 'ZZZ999', undefined);
    expect(navigate).toHaveBeenCalledWith('Lobby', { code: 'ZZZ999' });
  });

  it('amigo em partida também pode ser convidado (nada de botão sem ação)', async () => {
    const view = await seed({ friends: ['maria'], presence: { maria: 'in_match' } });

    expect(view.getByTestId('friend-play-maria')).toBeTruthy();
    expect(view.queryByText('Assistir')).toBeNull();
  });

  it('a ficha do amigo mostra liga e números e remove a amizade com confirmação', async () => {
    const view = await seed({ friends: ['zeh'], presence: { zeh: 'online' } });
    await act(async () => {
      fireEvent.press(view.getByTestId('friend-more-zeh'));
    });

    expect(await view.findByTestId('sheet-friend')).toBeTruthy();
    expect(view.getByText('Liga Ouro')).toBeTruthy();
    expect(view.getByText('70%')).toBeTruthy();

    autoConfirm('Remover');
    await act(async () => {
      fireEvent.press(view.getByTestId('friend-sheet-remove'));
    });

    expect(fns.removeFriend).toHaveBeenCalledWith('zeh');
    // A linha da agenda volta para "adicionar" sem precisar re-sincronizar a agenda.
    expect(mockSetRelation).toHaveBeenCalledWith('zeh', 'none');
  });

  it('bloquear pela ficha chama o backend e pede confirmação antes', async () => {
    const view = await seed({ friends: ['zeh'], presence: { zeh: 'online' } });
    await act(async () => {
      fireEvent.press(view.getByTestId('friend-more-zeh'));
    });

    const alert = autoConfirm('Cancelar');
    await act(async () => {
      fireEvent.press(view.getByTestId('friend-sheet-block'));
    });
    // Cancelou: nada acontece.
    expect(alert).toHaveBeenCalled();
    expect(fns.blockUser).not.toHaveBeenCalled();

    autoConfirm('Bloquear');
    await act(async () => {
      fireEvent.press(view.getByTestId('friend-sheet-block'));
    });
    expect(fns.blockUser).toHaveBeenCalledWith('zeh');
  });
});

describe('FriendsScreen — solicitações', () => {
  it('aceita e recusa solicitação recebida pela própria solicitação', async () => {
    const view = await seed({ incoming: [request()] });
    await act(async () => {
      fireEvent.press(view.getByTestId('friends-tab-requests'));
    });

    expect(await view.findByText('Tião')).toBeTruthy();
    await act(async () => {
      fireEvent.press(view.getByTestId('request-accept-other_me'));
    });
    expect(fns.respondFriendRequest).toHaveBeenCalledWith('other_me', true);
  });

  it('cancela a solicitação enviada pelo uid do destinatário', async () => {
    const sent = request({ id: 'me_alvo', from: 'me', to: 'alvo', toNickname: 'Alvo' });
    const view = await seed({ outgoing: [sent] });
    await act(async () => {
      fireEvent.press(view.getByTestId('friends-tab-requests'));
    });

    await act(async () => {
      fireEvent.press(view.getByTestId('request-cancel-me_alvo'));
    });
    expect(fns.cancelFriendRequest).toHaveBeenCalledWith('alvo');
  });

  it('mostra carregando antes do primeiro snapshot, não "nenhuma solicitação"', async () => {
    const view = await renderScreen();
    await act(async () => {
      fireEvent.press(view.getByTestId('friends-tab-requests'));
    });
    expect(view.queryByText('Nenhuma solicitação')).toBeNull();

    await act(async () => {
      mockEmit.incoming?.([]);
      mockEmit.outgoing?.([]);
    });
    expect(await view.findByText('Nenhuma solicitação')).toBeTruthy();
  });
});

describe('FriendsScreen — busca', () => {
  it('esconde quem eu bloqueei e envia solicitação para o resto', async () => {
    mockSearchProfiles.mockResolvedValue([
      baseProfile('blk', { nickname: 'Chatão' }),
      baseProfile('novo', { nickname: 'Novato' }),
    ]);
    const view = await seed({ blocked: ['blk'] });
    await act(async () => {
      fireEvent.press(view.getByTestId('friends-tab-search'));
    });
    await act(async () => {
      fireEvent.changeText(view.getByTestId('friends-search'), 'no');
    });
    await act(async () => {
      fireEvent(view.getByTestId('friends-search'), 'submitEditing');
    });

    await waitFor(() => expect(view.queryByText('Novato')).toBeTruthy());
    expect(view.queryByText('Chatão')).toBeNull();

    await act(async () => {
      fireEvent.press(view.getByTestId('contact-add-novo'));
    });
    expect(fns.sendFriendRequest).toHaveBeenCalledWith('novo');
  });

  it('quem já me mandou solicitação aparece como "Aceitar"', async () => {
    mockSearchProfiles.mockResolvedValue([baseProfile('other', { nickname: 'Tião' })]);
    const view = await seed({ incoming: [request()] });
    await act(async () => {
      fireEvent.press(view.getByTestId('friends-tab-search'));
    });
    await act(async () => {
      fireEvent.changeText(view.getByTestId('friends-search'), 'ti');
    });
    await act(async () => {
      fireEvent(view.getByTestId('friends-search'), 'submitEditing');
    });

    expect(await view.findByText('Aceitar')).toBeTruthy();
    await act(async () => {
      fireEvent.press(view.getByTestId('contact-add-other'));
    });
    // Enviar a solicitação inversa é o que o backend cruza para virar amizade na hora.
    expect(fns.sendFriendRequest).toHaveBeenCalledWith('other');
  });
});

describe('FriendsScreen — convites de sala', () => {
  it('convite recebido entra na sala e vai para o lobby', async () => {
    const view = await seed({
      invites: [{ code: 'ABC123', from: 'zeh', fromNickname: 'Zé Truco', createdAt: Date.now() }],
    });

    expect(await view.findByText('Convites para jogar')).toBeTruthy();
    expect(view.getByText('te chamou para a sala ABC123')).toBeTruthy();

    await act(async () => {
      fireEvent.press(view.getByTestId('room-invite-accept-ABC123'));
    });
    expect(fns.joinRoom).toHaveBeenCalledWith('ABC123');
    expect(navigate).toHaveBeenCalledWith('Lobby', { code: 'ABC123' });
  });
});

describe('FriendsScreen — bloqueados', () => {
  it('só mostra a entrada quando existe alguém bloqueado, e desbloqueia de lá', async () => {
    const view = await seed({ blocked: [] });
    expect(view.queryByTestId('friends-blocked')).toBeNull();

    await act(async () => {
      mockEmit.blocked?.(['blk']);
    });
    expect(await view.findByTestId('friends-blocked')).toBeTruthy();

    await act(async () => {
      fireEvent.press(view.getByTestId('friends-blocked'));
    });
    expect(await view.findByTestId('sheet-blocked')).toBeTruthy();
    expect(await view.findByText('Chatão')).toBeTruthy();

    await act(async () => {
      fireEvent.press(view.getByTestId('unblock-blk'));
    });
    expect(fns.unblockUser).toHaveBeenCalledWith('blk');
  });
});

describe('FriendsScreen — flag desligada', () => {
  it('não oferece ação nenhuma quando friends_enabled é falso', async () => {
    mockFlag.mockReturnValue(false);
    const view = await renderScreen();

    expect(view.getByTestId('friends-disabled')).toBeTruthy();
    expect(view.queryByTestId('friends-search')).toBeNull();
    expect(view.queryByTestId('quick-sync')).toBeNull();
  });
});

describe('FriendsScreen — lista única de amigos e contatos', () => {
  const syncedAgenda = () => {
    mockAgenda.permission = 'granted';
    mockAgenda.syncedAt = 1;
    mockAgenda.contactCount = 4;
    mockAgenda.result = {
      matched: [
        // Contato que já é amigo: vira a linha do amigo, com o nome da agenda.
        {
          contactId: 'c1',
          contactName: 'Zé da Padaria',
          uid: 'ze',
          nickname: 'ze',
          avatarId: 'joao',
          level: 3,
          relation: 'friend',
        },
        {
          contactId: 'c2',
          contactName: 'Prima Ana',
          uid: 'ana',
          nickname: 'ana',
          avatarId: 'maria',
          level: 2,
          relation: 'none',
        },
        // O mesmo jogador salvo em dois contatos: uma linha só.
        {
          contactId: 'c3',
          contactName: 'Ana (trabalho)',
          uid: 'ana',
          nickname: 'ana',
          avatarId: 'maria',
          level: 2,
          relation: 'none',
        },
      ],
      unmatched: [{ contactId: 'c4', contactName: 'Tio Beto' }],
    };
  };

  it('mostra amigos, contatos que jogam e contatos para convidar numa listagem só', async () => {
    syncedAgenda();
    const view = await seed({ friends: ['ze'] });
    expect(view.getByText('Amigos e contatos')).toBeTruthy();
    expect(view.queryByText('Contatos da sua agenda')).toBeNull();
    expect(view.queryByText('Convide para jogar')).toBeNull();
    // Três pessoas: o amigo (uma vez), a Ana (uma vez) e o Tio Beto.
    expect(view.getByText('3')).toBeTruthy();
    expect(view.getAllByTestId(/^friend-ze$/)).toHaveLength(1);
    expect(view.getByText('· Zé da Padaria')).toBeTruthy();
    expect(view.queryByTestId('contact-match-c1')).toBeNull();
    expect(view.getAllByTestId(/^contact-match-c[23]$/)).toHaveLength(1);
    expect(view.getByTestId('contact-invite-c4')).toBeTruthy();
  });

  it('o campo de busca filtra pelo apelido e pelo nome da agenda', async () => {
    syncedAgenda();
    const view = await seed({ friends: ['ze'] });
    await act(async () => {
      fireEvent.changeText(view.getByTestId('friends-search'), 'padaria');
    });
    expect(view.getByTestId('friend-ze')).toBeTruthy();
    expect(view.queryByTestId('contact-invite-c4')).toBeNull();
    expect(view.queryByTestId('contact-match-c2')).toBeNull();
  });

  it('sem agenda sincronizada a lista mostra só os amigos', async () => {
    const view = await seed({ friends: ['ze'] });
    expect(view.getByText('Meus amigos')).toBeTruthy();
    expect(view.getByTestId('friend-ze')).toBeTruthy();
  });

  it('sincroniza a agenda sozinho toda vez que a tela abre (e ela pede a permissão)', async () => {
    await seed();
    expect(mockSync).toHaveBeenCalledTimes(1);
    // Sem `force`: se a agenda não mudou, a sincronização não vai ao servidor.
    expect(mockSync).toHaveBeenCalledWith();
  });
});

describe('FriendsScreen — jogar com contato da agenda', () => {
  const agendaWithPlayer = () => {
    mockAgenda.permission = 'granted';
    mockAgenda.syncedAt = 1;
    mockAgenda.contactCount = 1;
    mockAgenda.result = {
      matched: [
        {
          contactId: 'c9',
          contactName: 'Primo Rafa',
          uid: 'rafa',
          nickname: 'rafa',
          avatarId: 'galo',
          level: 2,
          relation: 'none',
        },
      ],
      unmatched: [],
    };
  };

  it('contato que joga e está online: "Jogar" lê os números da agenda, chama e vai ao lobby', async () => {
    agendaWithPlayer();
    const view = await seed({ presence: { rafa: 'online' } });
    expect(view.getByText('Online · @rafa')).toBeTruthy();
    expect(view.queryByTestId('contact-add-c9')).toBeNull();
    await act(async () => {
      fireEvent.press(view.getByTestId('contact-play-c9'));
    });
    expect(mockContactPhones).toHaveBeenCalledWith('c9');
    expect(fns.createRoom).toHaveBeenCalled();
    // Número normalizado (E.164) como prova do vínculo; nada é guardado.
    expect(fns.inviteFriendToRoom).toHaveBeenCalledWith('rafa', 'ZZZ999', ['+5531988776655']);
    expect(navigate).toHaveBeenCalledWith('Lobby', { code: 'ZZZ999' });
  });

  it('contato que joga e está offline: sem "Jogar" e sem "Convidar" — oferece adicionar', async () => {
    agendaWithPlayer();
    const view = await seed({ presence: { rafa: 'offline' } });
    expect(view.queryByTestId('contact-play-c9')).toBeNull();
    expect(view.getByTestId('contact-add-c9')).toBeTruthy();
    expect(view.getByText('Já joga · @rafa')).toBeTruthy();
    expect(view.queryByTestId('contact-invite-c9')).toBeNull();
  });

  it('amigo offline não mostra botão de convidar', async () => {
    const view = await seed({ friends: ['zeh'], presence: { zeh: 'offline' } });
    expect(view.getByTestId('friend-zeh')).toBeTruthy();
    expect(view.queryByTestId('friend-play-zeh')).toBeNull();
  });
});
