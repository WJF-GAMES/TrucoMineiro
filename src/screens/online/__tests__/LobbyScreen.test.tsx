import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LobbyScreen } from '../LobbyScreen';
import type { Room, RoomPlayer, RoomSeatInvite } from '@/domain/model/types';

/**
 * Lobby da sala com amigos: contagem da espera, estado de cada convidado, IA ao fim do prazo,
 * troca de convidado, cancelamento e o convidado atrasado aguardando a vaga da IA.
 */

jest.mock('@/services/api', () => ({
  ...(() => {
  class ApiError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  }
  const ok = () => Promise.resolve({ ok: true });
  return {
    ApiError,
    claimReservedSeat: jest.fn(() => Promise.resolve({ status: 'pending' })),
    fillRoomWithBots: jest.fn(ok),
    inviteToRoom: jest.fn(ok),
    leaveRoom: jest.fn(ok),
    removeRoomInvite: jest.fn(ok),
    resolveLobbyTimeout: jest.fn(() => Promise.resolve({ sessionId: 's1' })),
    setReady: jest.fn(ok),
    startMatch: jest.fn(() => Promise.resolve({ sessionId: 's1' })),
  };
})(),
  ...(() => ({
  subscribeRoom: (_code: string, cb: (r: Room | null) => void) => {
    mockEmitRoom = cb;
    return () => undefined;
  },
}))(),
}));
const fns = jest.requireMock<Record<string, jest.Mock>>('@/services/api');

let mockEmitRoom: ((r: Room | null) => void) | null = null;

jest.mock('@/services/firebase/perf', () => ({ traced: (_n: string, fn: () => unknown) => fn() }));
jest.mock('@/services/firebase/analytics', () => ({ logEvent: jest.fn() }));
jest.mock('@/ads', () => ({ useMatchmakingGuard: () => undefined }));
jest.mock('@/stores/toastStore', () => ({
  toast: { info: jest.fn(), success: jest.fn(), error: jest.fn() },
}));
let mockUid = 'will';
jest.mock('@/stores/authStore', () => ({
  useAuthStore: (sel: (s: { user: { uid: string } }) => unknown) => sel({ user: { uid: mockUid } }),
}));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
}));
jest.mock('@/screens/friends/components/FriendPickerSheet', () => {
  const { Pressable, Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    FriendPickerSheet: ({ visible, onPick }: { visible: boolean; onPick: (u: string) => void }) =>
      visible ? (
        <Pressable testID="picker-dani" onPress={() => onPick('dani')}>
          <Text>dani</Text>
        </Pressable>
      ) : null,
  };
});
const { toast } = jest.requireMock<{ toast: Record<string, jest.Mock> }>('@/stores/toastStore');

const player = (uid: string, seat: number, over: Partial<RoomPlayer> = {}): RoomPlayer => ({
  uid,
  seat,
  nickname: uid[0]!.toUpperCase() + uid.slice(1),
  avatarId: 'joao',
  ready: true,
  bot: false,
  joinedAt: 0,
  connected: true,
  ...over,
});
const invite = (uid: string, seat: number, status: RoomSeatInvite['status']): RoomSeatInvite => ({
  uid,
  seat,
  nickname: uid[0]!.toUpperCase() + uid.slice(1),
  avatarId: 'maria',
  status,
  invitedAt: 0,
});

const T0 = Date.parse('2026-09-16T20:00:00Z');

function friendRoom(over: Partial<Room> = {}): Room {
  return {
    code: 'ABC123',
    hostUid: 'will',
    status: 'waiting',
    maxPlayers: 4,
    players: { will: player('will', 0) },
    sessionId: null,
    createdAt: T0,
    updatedAt: T0,
    source: 'private',
    fillWithAi: 'on_timeout',
    inviteExpiresAt: T0 + 30_000,
    invites: {
      ana: invite('ana', 1, 'PENDING'),
      bruno: invite('bruno', 2, 'PENDING'),
      carlos: invite('carlos', 3, 'PENDING'),
    },
    ...over,
  };
}

const navigation = { replace: jest.fn(), navigate: jest.fn(), goBack: jest.fn() };

async function open(room: Room) {
  const view = await render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 360, height: 740 },
        insets: { top: 0, left: 0, right: 0, bottom: 0 },
      }}
    >
      <LobbyScreen
        navigation={navigation as never}
        route={{ key: 'Lobby', name: 'Lobby', params: { code: 'ABC123' } } as never}
      />
    </SafeAreaProvider>,
  );
  await act(async () => mockEmitRoom?.(room));
  return view;
}

const text = (view: Awaited<ReturnType<typeof open>>, id: string) =>
  view.getByTestId(id).props.children;

beforeEach(() => {
  jest.useFakeTimers({ now: T0 });
  jest.clearAllMocks();
  mockUid = 'will';
  mockEmitRoom = null;
});
afterEach(() => {
  jest.useRealTimers();
});

describe('LobbyScreen — sala com amigos', () => {
  it('mostra "Aguardando jogadores" com a contagem e o estado de cada convidado', async () => {
    const view = await open(friendRoom());
    expect(view.getByText('Aguardando jogadores')).toBeTruthy();
    expect(text(view, 'lobby-countdown-clock')).toBe('00:30');
    await act(async () => {
      jest.advanceTimersByTime(6_000);
    });
    expect(text(view, 'lobby-countdown-clock')).toBe('00:24');
    expect(text(view, 'lobby-seat-status-1')).toBe('Convidado · aguardando');

    // Ana entra, Bruno recusa: o dono vê na hora.
    await act(async () =>
      mockEmitRoom?.(
        friendRoom({
          players: { will: player('will', 0), ana: player('ana', 1) },
          invites: {
            ana: invite('ana', 1, 'ACCEPTED'),
            bruno: invite('bruno', 2, 'DECLINED'),
            carlos: invite('carlos', 3, 'PENDING'),
          },
        }),
      ),
    );
    expect(text(view, 'lobby-seat-status-1')).toBe('Entrou');
    expect(text(view, 'lobby-seat-status-2')).toBe('Recusou');
    expect(toast.success).toHaveBeenCalledWith('Ana entrou na sala.');
    expect(toast.info).toHaveBeenCalledWith('Bruno não vai jogar.');
    // Faltam jogadores: "Começar" travado, "Completar com IA" disponível.
    expect(view.getByTestId('lobby-start').props.accessibilityState).toMatchObject({
      disabled: true,
    });
    expect(view.getByTestId('lobby-fill-bots')).toBeTruthy();
  });

  it('teste 1: todos entraram → "Começar partida" liberado na hora', async () => {
    const view = await open(
      friendRoom({
        players: {
          will: player('will', 0),
          ana: player('ana', 1),
          bruno: player('bruno', 2),
          carlos: player('carlos', 3),
        },
        invites: {
          ana: invite('ana', 1, 'ACCEPTED'),
          bruno: invite('bruno', 2, 'ACCEPTED'),
          carlos: invite('carlos', 3, 'ACCEPTED'),
        },
      }),
    );
    const startBtn = view.getByTestId('lobby-start');
    expect(startBtn.props.accessibilityState).toMatchObject({ disabled: false });
    await act(async () => {
      fireEvent.press(startBtn);
    });
    expect(fns.startMatch).toHaveBeenCalledWith('ABC123');
  });

  it('teste 2/4: tempo esgotado → pede ao servidor para completar com IA e começar', async () => {
    await open(friendRoom());
    expect(fns.resolveLobbyTimeout).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(31_000);
    });
    expect(fns.resolveLobbyTimeout).toHaveBeenCalledTimes(1);
    expect(fns.resolveLobbyTimeout).toHaveBeenCalledWith('ABC123');
  });

  it('"Completar com IA" não espera o relógio', async () => {
    const view = await open(friendRoom());
    await act(async () => {
      fireEvent.press(view.getByTestId('lobby-fill-bots'));
    });
    expect(fns.fillRoomWithBots).toHaveBeenCalledWith('ABC123');
    expect(fns.startMatch).toHaveBeenCalledWith('ABC123');
  });

  it('dono troca um convidado por outro amigo antes de começar', async () => {
    const view = await open(friendRoom());
    await act(async () => {
      fireEvent.press(view.getByTestId('lobby-seat-action-2'));
    });
    await act(async () => {
      fireEvent.press(view.getByTestId('picker-dani'));
    });
    expect(fns.removeRoomInvite).toHaveBeenCalledWith('ABC123', 'bruno');
    expect(fns.inviteToRoom).toHaveBeenCalledWith('ABC123', 'dani');
  });

  it('teste 15: cancelar a sala avisa que os convites deixam de valer', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const view = await open(friendRoom());
    await act(async () => {
      fireEvent.press(view.getByTestId('lobby-leave'));
    });
    const [title, message, buttons] = alert.mock.calls[0]!;
    expect(title).toBe('Cancelar a sala?');
    expect(message).toBe('Os convites enviados deixam de valer.');
    await act(async () => {
      await (buttons as { onPress?: () => Promise<void> }[])[1]!.onPress?.();
    });
    expect(fns.leaveRoom).toHaveBeenCalledWith('ABC123');
  });

  it('convidado vê a sala cancelada e volta', async () => {
    mockUid = 'ana';
    await open(friendRoom({ players: { will: player('will', 0), ana: player('ana', 1) } }));
    await act(async () =>
      mockEmitRoom?.(friendRoom({ status: 'closed', closedReason: 'cancelled' })),
    );
    expect(toast.info).toHaveBeenCalledWith('Sala encerrada', 'Esta sala foi cancelada.');
    expect(navigation.replace).toHaveBeenCalledWith('Main', { screen: 'Play' });
  });

  it('partida começou com todos dentro → vai para a mesa', async () => {
    mockUid = 'ana';
    await open(
      friendRoom({
        status: 'in_match',
        sessionId: 's1',
        players: { will: player('will', 0), ana: player('ana', 1) },
      }),
    );
    expect(navigation.replace).toHaveBeenCalledWith('Game', { mode: 'online', sessionId: 's1' });
  });

  it('teste 8: convidado atrasado espera a vaga da IA e entra quando o servidor troca', async () => {
    mockUid = 'carlos';
    const started = friendRoom({
      status: 'in_match',
      sessionId: 's1',
      players: {
        will: player('will', 0),
        ana: player('ana', 1),
        bruno: player('bruno', 2),
        bot_3: player('bot_3', 3, { bot: true, reservedFor: 'carlos' }),
      },
      invites: { carlos: invite('carlos', 3, 'AI_FILLED') },
    });
    const view = await open(started);
    expect(view.getByTestId('lobby-late-pending')).toBeTruthy();
    expect(fns.claimReservedSeat).toHaveBeenCalledWith('s1');
    expect(navigation.replace).not.toHaveBeenCalledWith('Game', expect.anything());

    fns.claimReservedSeat!.mockResolvedValueOnce({ status: 'seated' });
    await act(async () => {
      jest.advanceTimersByTime(3_000);
    });
    expect(navigation.replace).toHaveBeenCalledWith('Game', { mode: 'online', sessionId: 's1' });
  });

  it('partida começou sem vaga para mim', async () => {
    mockUid = 'dani';
    const view = await open(
      friendRoom({
        status: 'in_match',
        sessionId: 's1',
        players: { will: player('will', 0), bot_1: player('bot_1', 1, { bot: true }) },
      }),
    );
    expect(view.getByTestId('lobby-started')).toBeTruthy();
    expect(fns.claimReservedSeat).not.toHaveBeenCalled();
  });
});
