import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useRoomInvites, INVITE_TTL_MS } from '../useRoomInvites';
import type { RoomInvite } from '@/domain/model/types';

const mockRespond = jest.fn();
const mockDelete = jest.fn((..._args: unknown[]) => Promise.resolve());
const mockLogEvent = jest.fn();
const mockToastError = jest.fn();

let emit: ((invites: RoomInvite[]) => void) | null = null;

jest.mock('@/services/api', () => ({
  ...(() => ({
  subscribeRoomInvites: (_uid: string, cb: (invites: RoomInvite[]) => void) => {
    emit = cb;
    return () => {
      emit = null;
    };
  },
  deleteRoomInvite: (...args: unknown[]) => mockDelete(...args),
}))(),
  ...(() => {
  // Sem "parameter property" (`public code`): o Babel proíbe isso dentro da fábrica do mock,
  // e a classe precisa nascer aqui — a fábrica roda antes do corpo do arquivo de teste.
  class ApiError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  }
  return { ApiError, respondRoomInvite: (...args: unknown[]) => mockRespond(...args) };
})(),
}));

jest.mock('@/services/firebase/analytics', () => ({
  logEvent: (...a: unknown[]) => mockLogEvent(...a),
}));
jest.mock('@/stores/toastStore', () => ({
  toast: { error: (...a: unknown[]) => mockToastError(...a), success: jest.fn(), info: jest.fn() },
}));

// `renderHook` da v14 devolve Promise: sem o await, `result` vem indefinido.
const { ApiError } = jest.requireMock<{
  ApiError: new (code: string, message: string) => Error;
}>('@/services/api');

const invite = (over: Partial<RoomInvite> = {}): RoomInvite => ({
  code: 'ABC123',
  from: 'friend-1',
  fromNickname: 'Zé Truco',
  createdAt: Date.now(),
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockRespond.mockResolvedValue({ code: 'ABC123' });
});

describe('useRoomInvites', () => {
  it('entrega os convites recebidos', async () => {
    const { result } = await renderHook(() => useRoomInvites('me'));
    await act(async () => emit?.([invite()]));
    await waitFor(() => expect(result.current.invites).toHaveLength(1));
    expect(result.current.invites[0]).toMatchObject({ code: 'ABC123', fromNickname: 'Zé Truco' });
  });

  it('descarta e apaga convite vencido em vez de mostrar sala morta', async () => {
    const { result } = await renderHook(() => useRoomInvites('me'));
    await act(async () =>
      emit?.([invite({ code: 'OLD123', createdAt: Date.now() - INVITE_TTL_MS - 1000 })]),
    );
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('me', 'OLD123'));
    expect(result.current.invites).toHaveLength(0);
  });

  it('usa o prazo que o servidor mandou', async () => {
    const { result } = await renderHook(() => useRoomInvites('me'));
    await act(async () =>
      emit?.([invite({ code: 'NEW123', createdAt: Date.now(), expiresAt: Date.now() - 1 })]),
    );
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('me', 'NEW123'));
    expect(result.current.invites).toHaveLength(0);
  });

  it('aceitar entra na sala (o servidor apaga o convite) e avisa quem chamou o hook', async () => {
    const onJoined = jest.fn();
    const { result } = await renderHook(() => useRoomInvites('me', onJoined));
    await act(async () => emit?.([invite()]));
    await waitFor(() => expect(result.current.invites).toHaveLength(1));

    await act(async () => {
      await result.current.accept(result.current.invites[0]!);
    });

    expect(mockRespond).toHaveBeenCalledWith('ABC123', true);
    expect(onJoined).toHaveBeenCalledWith('ABC123');
    expect(mockLogEvent).toHaveBeenCalledWith('room_invite_accepted');
  });

  it('sala cheia: mostra o erro e limpa o convite que não serve mais', async () => {
    mockRespond.mockRejectedValue(
      new ApiError('resource-exhausted', 'A sala já está completa.'),
    );
    const onJoined = jest.fn();
    const { result } = await renderHook(() => useRoomInvites('me', onJoined));
    await act(async () => emit?.([invite()]));
    await waitFor(() => expect(result.current.invites).toHaveLength(1));

    await act(async () => {
      await result.current.accept(result.current.invites[0]!);
    });

    expect(onJoined).not.toHaveBeenCalled();
    expect(mockToastError).toHaveBeenCalledWith(
      'Não foi possível entrar',
      'A sala já está completa.',
    );
    expect(mockDelete).toHaveBeenCalledWith('me', 'ABC123');
  });

  it('sem conexão o convite continua lá para uma segunda tentativa', async () => {
    mockRespond.mockRejectedValue(new ApiError('unavailable', 'offline'));
    const { result } = await renderHook(() => useRoomInvites('me'));
    await act(async () => emit?.([invite()]));
    await waitFor(() => expect(result.current.invites).toHaveLength(1));

    await act(async () => {
      await result.current.accept(result.current.invites[0]!);
    });

    expect(mockDelete).not.toHaveBeenCalled();
    expect(result.current.invites).toHaveLength(1);
  });

  it('recusar avisa o servidor (o dono vê a recusa na hora)', async () => {
    const { result } = await renderHook(() => useRoomInvites('me'));
    await act(async () => emit?.([invite()]));
    await waitFor(() => expect(result.current.invites).toHaveLength(1));

    await act(async () => {
      await result.current.decline(result.current.invites[0]!);
    });

    expect(mockRespond).toHaveBeenCalledWith('ABC123', false);
    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockLogEvent).toHaveBeenCalledWith('room_invite_declined');
  });

  it('recusar sem conexão pelo menos tira o convite da lista', async () => {
    mockRespond.mockRejectedValue(new ApiError('unavailable', 'offline'));
    const { result } = await renderHook(() => useRoomInvites('me'));
    await act(async () => emit?.([invite()]));
    await waitFor(() => expect(result.current.invites).toHaveLength(1));
    await act(async () => {
      await result.current.decline(result.current.invites[0]!);
    });
    expect(mockDelete).toHaveBeenCalledWith('me', 'ABC123');
  });

  it('sem usuário não escuta nada', async () => {
    await renderHook(() => useRoomInvites(undefined));
    expect(emit).toBeNull();
  });
});
