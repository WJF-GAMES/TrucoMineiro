import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LeagueScreen } from '../LeagueScreen';
import { leagueById } from '@/domain/model/leagues';
import { zonesForGroupSize } from '@/domain/model/leagueGroups';
import type { LeagueRankingMember, LeagueScreenSnapshot } from '@/domain/model/types';

/**
 * A tela não pode inventar regra: quem sobe, quem desce e o texto da regra vêm do snapshot do
 * backend. Estes testes checam justamente isso — inclusive o caso do grupo com 21 jogadores,
 * em que o 21º TEM que aparecer na lista.
 */

const mockSnapshot = jest.fn();
const mockSubscribe = jest.fn(
  (..._args: unknown[]) =>
    () =>
      undefined,
);

const mockSendFriendRequest = jest.fn((..._args: unknown[]) => Promise.resolve({ ok: true }));
/** Relação com os outros jogadores na ficha: amigos e pedidos que chegam pelos snapshots. */
const mockSocial = {
  friends: [] as { id: string }[],
  incoming: [] as { from: string; to: string; createdAt: number }[],
  outgoing: [] as { from: string; to: string; createdAt: number }[],
};
jest.mock('@/services/firebase/functions', () => ({
  getLeagueScreenSnapshot: (...args: unknown[]) => mockSnapshot(...args),
  getGlobalLeagueRanking: jest.fn(() => Promise.resolve({ entries: [] })),
  sendFriendRequest: (...args: unknown[]) => mockSendFriendRequest(...args),
  FunctionsError: class extends Error {},
}));
jest.mock('@/services/firebase/firestore', () => ({
  subscribeGroupMembers: (groupId: string, cb: unknown, onError: unknown) =>
    mockSubscribe(groupId, cb, onError),
  getLeagueHistory: jest.fn(() => Promise.resolve([])),
  // Ficha do jogador: perfil completo e números.
  getProfile: (uid: string) =>
    Promise.resolve({
      id: uid,
      nickname: `Perfil ${uid}`,
      avatarId: 'galo',
      countryCode: 'BR',
      level: 7,
      leagueId: 'gold',
      leaguePoints: 1500,
    }),
  subscribeStats: (_uid: string, cb: (s: unknown) => void) => {
    cb({ matches: 10, wins: 6 });
    return () => undefined;
  },
  subscribeFriends: (_uid: string, cb: (list: { id: string }[]) => void) => {
    cb(mockSocial.friends);
    return () => undefined;
  },
  subscribeBlockedUsers: (_uid: string, cb: (ids: string[]) => void) => {
    cb([]);
    return () => undefined;
  },
  subscribeIncomingRequests: (_uid: string, cb: (r: unknown[]) => void) => {
    cb(mockSocial.incoming);
    return () => undefined;
  },
  subscribeOutgoingRequests: (_uid: string, cb: (r: unknown[]) => void) => {
    cb(mockSocial.outgoing);
    return () => undefined;
  },
}));
jest.mock('@/services/firebase/rtdb', () => ({
  subscribePresence: () => () => undefined,
}));
jest.mock('@/stores/toastStore', () => ({
  toast: { info: jest.fn(), success: jest.fn(), error: jest.fn() },
}));
jest.mock('@/services/firebase/analytics', () => ({ logEvent: jest.fn() }));
jest.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) => selector({ user: { uid: 'me' } }),
}));

const SERVER_TIME = Date.parse('2026-09-11T09:28:00-03:00');

function member(rank: number, over: Partial<LeagueRankingMember> = {}): LeagueRankingMember {
  return {
    uid: `u${rank}`,
    nickname: `Jogador ${rank}`,
    avatarId: 'joao',
    countryCode: 'BR',
    weeklyPoints: (30 - rank) * 100,
    wins: 0,
    rank,
    tiebreakScore: 0,
    joinedAt: 0,
    isMe: false,
    ...over,
  };
}

function snapshotWith(groupSize: number, over: Partial<LeagueScreenSnapshot> = {}) {
  const zones = zonesForGroupSize(groupSize);
  const members = Array.from({ length: groupSize }, (_, i) =>
    member(i + 1, i === 6 ? { isMe: true, nickname: 'Eu Mesmo' } : {}),
  );
  const snapshot: LeagueScreenSnapshot = {
    weekKey: '2026-W37',
    startAt: Date.parse('2026-09-07T00:00:00-03:00'),
    endAt: Date.parse('2026-09-14T00:00:00-03:00'),
    serverTime: SERVER_TIME,
    currentLeague: leagueById('gold'),
    previousLeague: leagueById('silver'),
    nextLeague: leagueById('platinum'),
    division: 1,
    groupId: '2026-W37__gold__001',
    groupSize,
    promotionCount: zones.promotionCount,
    relegationCount: zones.relegationCount,
    promotionStart: zones.promotionStart,
    promotionEnd: zones.promotionEnd,
    relegationStart: zones.relegationStart,
    relegationEnd: zones.relegationEnd,
    userRank: 7,
    userWeeklyPoints: members[6]?.weeklyPoints ?? 0,
    members,
    lastWeeklyResult: null,
    lastWeeklyRank: null,
    ...over,
  };
  return snapshot;
}

const navigation = { navigate: jest.fn(), goBack: jest.fn() } as never;
const route = { key: 'League', name: 'League' } as never;

const SAFE_AREA = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const renderScreen = () =>
  render(
    <SafeAreaProvider initialMetrics={SAFE_AREA}>
      <LeagueScreen navigation={navigation} route={route} />
    </SafeAreaProvider>,
  );

// Nada de mexer no relógio: o valor inicial do countdown sai de `endAt - serverTime`, ou seja,
// do próprio snapshot. Congelar `Date.now()` quebraria o agendador do React.
beforeEach(() => {
  jest.clearAllMocks();
  mockSocial.friends = [];
  mockSocial.incoming = [];
  mockSocial.outgoing = [];
});

describe('LeagueScreen', () => {
  it('mostra liga, divisão, countdown e as zonas vindas do backend', async () => {
    mockSnapshot.mockResolvedValue(snapshotWith(20));
    const view = await renderScreen();

    expect(await view.findByText('OURO')).toBeTruthy();
    expect(view.getByText('Divisão I')).toBeTruthy();
    // Título no singular, igual ao rótulo da aba na Bottom Navigation (vocabulário único).
    expect(view.getByText('Liga')).toBeTruthy();
    expect(view.getByText('Jogue, pontue e suba de liga!')).toBeTruthy();
    // Faltam 2d 14h 32min para 14/09 00:00 a partir de 11/09 09:28.
    expect(view.getByText('2d 14h 32min')).toBeTruthy();
    expect(view.getByText('1º - 5º')).toBeTruthy();
    expect(view.getByText('16º - 20º')).toBeTruthy();
    expect(view.getByText('Platina')).toBeTruthy();
    expect(view.getByText('Prata')).toBeTruthy();
  });

  it('lista TODOS os jogadores do grupo, inclusive o 21º', async () => {
    mockSnapshot.mockResolvedValue(snapshotWith(21));
    const view = await renderScreen();

    expect(await view.findByText('Jogador 1')).toBeTruthy();
    // A FlatList só monta as primeiras linhas (virtualização), então o que garante que ninguém é
    // escondido é a lista COMPLETA chegar nela — o 21º aparece ao rolar.
    const list = view.getByTestId('league-ranking-list');
    const data = list.props.data as { rank: number; nickname: string }[];
    expect(data).toHaveLength(21);
    expect(data[20]).toMatchObject({ rank: 21, nickname: 'Jogador 21' });
    // E a zona de rebaixamento acompanha o tamanho real do grupo.
    expect(view.getByText('17º - 21º')).toBeTruthy();
  });

  it('usa o texto de regra derivado dos números do backend, não um texto fixo', async () => {
    mockSnapshot.mockResolvedValue(snapshotWith(12));
    const view = await renderScreen();

    expect(
      await view.findByText(/Os 3 primeiros sobem de liga e os 3 últimos descem/),
    ).toBeTruthy();
    expect(view.getByText('1º - 3º')).toBeTruthy();
    expect(view.getByText('10º - 12º')).toBeTruthy();
  });

  it('avisa quando o grupo é pequeno demais para promoção e rebaixamento', async () => {
    mockSnapshot.mockResolvedValue(snapshotWith(1));
    const view = await renderScreen();

    expect(await view.findByText(/pequeno demais/)).toBeTruthy();
    expect(view.getAllByText('—')).toHaveLength(2);
  });

  it('no topo da escada não promete próxima liga', async () => {
    mockSnapshot.mockResolvedValue(
      snapshotWith(20, {
        currentLeague: leagueById('legend_of_minas'),
        previousLeague: leagueById('legendary'),
        nextLeague: null,
      }),
    );
    const view = await renderScreen();

    expect(await view.findByText('Liga máxima')).toBeTruthy();
    expect(view.getByText('Você chegou ao topo!')).toBeTruthy();
  });

  it('no piso da escada avisa que é a primeira liga', async () => {
    mockSnapshot.mockResolvedValue(
      snapshotWith(20, {
        currentLeague: leagueById('bronze'),
        previousLeague: null,
        nextLeague: leagueById('silver'),
      }),
    );
    const view = await renderScreen();

    expect(await view.findByText('Liga inicial')).toBeTruthy();
    expect(view.getByText('Você está na primeira liga')).toBeTruthy();
  });

  it('mostra o CTA de jogar com o subtexto da referência', async () => {
    mockSnapshot.mockResolvedValue(snapshotWith(20));
    const view = await renderScreen();

    expect(await view.findByTestId('league-play-now')).toBeTruthy();
    expect(view.getByText('Ganhe pontos e suba de liga!')).toBeTruthy();
  });

  it('enquanto carrega diz que está preparando a liga — nunca "você não tem liga"', async () => {
    mockSnapshot.mockReturnValue(new Promise(() => undefined));
    const view = await renderScreen();

    expect(await view.findByText('Preparando sua liga...')).toBeTruthy();
  });

  it('em erro oferece tentar de novo, sem mostrar erro técnico', async () => {
    mockSnapshot.mockRejectedValue(new Error('INTERNAL 500 firestore/xyz'));
    const view = await renderScreen();

    expect(await view.findByText('Não foi possível carregar sua liga.')).toBeTruthy();
    expect(view.getByText('Tentar novamente')).toBeTruthy();
    expect(view.queryByText(/INTERNAL/)).toBeNull();
  });

  it('assina o grupo para manter o ranking vivo', async () => {
    mockSnapshot.mockResolvedValue(snapshotWith(20));
    await renderScreen();

    await waitFor(() =>
      expect(mockSubscribe).toHaveBeenCalledWith(
        '2026-W37__gold__001',
        expect.any(Function),
        expect.any(Function),
      ),
    );
  });

  it('dá nome acessível a cada linha do ranking', async () => {
    mockSnapshot.mockResolvedValue(snapshotWith(20));
    const view = await renderScreen();

    expect(await view.findByLabelText('1º lugar, Jogador 1, 2.900 pontos')).toBeTruthy();
    expect(view.getByLabelText('7º lugar, Eu Mesmo, 2.300 pontos, você')).toBeTruthy();
  });
});

describe('LeagueScreen — ficha do jogador', () => {
  async function openPlayer(uid: string, snapshot = snapshotWith(10)) {
    mockSnapshot.mockResolvedValue(snapshot);
    const view = await renderScreen();
    await view.findByText('Jogador 1');
    await act(async () => {
      fireEvent.press(view.getByTestId(`ranking-row-${uid}`));
    });
    return view;
  }

  it('tocar num jogador abre a ficha com liga e números, como em Amigos', async () => {
    const view = await openPlayer('u2');
    expect(view.getByTestId('sheet-player')).toBeTruthy();
    expect(await view.findByText('@Perfil u2')).toBeTruthy();
    expect(view.getByText('Nível 7')).toBeTruthy();
    expect(view.getByText('Liga Ouro')).toBeTruthy();
    expect(view.getByText('60%')).toBeTruthy();
  });

  it('adiciona como amigo a partir da ficha', async () => {
    const view = await openPlayer('u2');
    await act(async () => {
      fireEvent.press(await view.findByTestId('player-sheet-add'));
    });
    expect(mockSendFriendRequest).toHaveBeenCalledWith('u2');
    expect(view.getByTestId('player-relation-sent')).toBeTruthy();
  });

  it('com pedido dele pendente oferece aceitar', async () => {
    mockSocial.incoming = [{ from: 'u3', to: 'me', createdAt: 1 }];
    const view = await openPlayer('u3');
    expect(await view.findByText('Aceitar pedido de amizade')).toBeTruthy();
  });

  it('amigo e o próprio usuário não têm botão de adicionar', async () => {
    mockSocial.friends = [{ id: 'u4' }];
    const friendView = await openPlayer('u4');
    expect(await friendView.findByTestId('player-relation-friend')).toBeTruthy();
    expect(friendView.queryByTestId('player-sheet-add')).toBeNull();
    await friendView.unmount();

    // Na vida real a linha "sou eu" tem o uid do usuário logado.
    const mine = snapshotWith(10);
    mine.members = mine.members.map((m) => (m.isMe ? { ...m, uid: 'me' } : m));
    const meView = await openPlayer('me', mine);
    expect(await meView.findByTestId('player-relation-me')).toBeTruthy();
  });
});
