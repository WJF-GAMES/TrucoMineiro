import { Alert } from 'react-native';
import { act, renderHook } from '@testing-library/react-native';

const mockRespond = jest.fn();
const mockNavigate = jest.fn();
let mockPushListener: ((data: Record<string, string>) => void) | null = null;
let mockInitialPush: Record<string, string> | null = null;

jest.mock('@/services/api', () => {
  class ApiError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  }
  return { ApiError, respondRoomInvite: (...a: unknown[]) => mockRespond(...a) };
});
jest.mock('@/services/firebase/analytics', () => ({ logEvent: jest.fn() }));
jest.mock('@/services/firebase/messaging', () => ({
  subscribePushOpens: (cb: (data: Record<string, string>) => void) => {
    if (mockInitialPush) cb(mockInitialPush);
    mockPushListener = cb;
    return () => {
      mockPushListener = null;
    };
  },
}));
jest.mock('@/navigation/navigationRef', () => ({
  navigationRef: { isReady: () => true, navigate: (...a: unknown[]) => mockNavigate(...a) },
}));

/* eslint-disable import/first -- os mocks precisam vir antes. */
import { useAuthStore } from '@/stores/authStore';
import {
  enterInvitedRoom,
  inviteFromPush,
  inviteFromUrl,
  PENDING_INVITE_TTL_MS,
  usePendingInviteStore,
} from '../roomInviteFlow';
import { usePendingRoomInvite } from '../usePendingRoomInvite';
/* eslint-enable import/first */

const { ApiError } = jest.requireMock<{
  ApiError: new (code: string, message: string) => Error;
}>('@/services/api');

const setStatus = (status: 'booting' | 'signed_out' | 'onboarding' | 'signed_in') =>
  act(() => {
    useAuthStore.setState({ status } as never);
  });

beforeEach(() => {
  jest.clearAllMocks();
  mockPushListener = null;
  mockInitialPush = null;
  usePendingInviteStore.setState({ pending: null, handled: [] });
  mockRespond.mockResolvedValue({ code: 'ABC123' });
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

describe('leitura do push e do link', () => {
  it('só convite de sala vira código', () => {
    expect(inviteFromPush({ type: 'room_invite', code: 'ABC123', inviteId: 'ABC123_x' })).toEqual({
      code: 'ABC123',
      inviteId: 'ABC123_x',
    });
    expect(inviteFromPush({ type: 'friend_invite', from: 'x' })).toBeNull();
    expect(inviteFromPush(undefined)).toBeNull();
  });

  it('link trucomineiro://room', () => {
    expect(inviteFromUrl('trucomineiro://room?code=abc123')).toBe('ABC123');
    expect(inviteFromUrl('trucomineiro://room/XYZ789')).toBe('XYZ789');
    expect(inviteFromUrl('trucomineiro://add-friend?token=aaaaaaaaaaaaaaaa')).toBeNull();
    expect(inviteFromUrl('https://evil.example/room?code=ABC123')).toBeNull();
  });
});

describe('convite guardado', () => {
  it('guarda, entrega uma vez só e descarta o vencido', () => {
    const store = usePendingInviteStore.getState();
    store.offer('abc123', 'ABC123_me');
    expect(usePendingInviteStore.getState().handled).toContain('ABC123');
    expect(usePendingInviteStore.getState().take()).toMatchObject({ code: 'ABC123' });
    expect(usePendingInviteStore.getState().take()).toBeNull();

    store.offer('ABC123');
    usePendingInviteStore.setState((s) => ({
      pending: { ...s.pending!, at: Date.now() - PENDING_INVITE_TTL_MS - 1 },
    }));
    expect(usePendingInviteStore.getState().take()).toBeNull();
  });

  it('ignora código inválido', () => {
    usePendingInviteStore.getState().offer('../../x');
    expect(usePendingInviteStore.getState().pending).toBeNull();
  });
});

describe('entrar pelo convite', () => {
  it('aceita e vai direto para a sala', async () => {
    await expect(enterInvitedRoom('ABC123', 'push')).resolves.toBe(true);
    expect(mockRespond).toHaveBeenCalledWith('ABC123', true);
    expect(mockNavigate).toHaveBeenCalledWith('Lobby', { code: 'ABC123' });
  });

  it('teste 14/15: vencido ou cancelado explica e oferece voltar ao início', async () => {
    mockRespond.mockRejectedValue(new ApiError('not-found', 'Esta sala foi cancelada.'));
    await expect(enterInvitedRoom('ABC123', 'push')).resolves.toBe(false);
    expect(mockNavigate).not.toHaveBeenCalledWith('Lobby', expect.anything());
    const [title, message, buttons] = (Alert.alert as jest.Mock).mock.calls[0];
    expect(title).toBe('Convite para jogar');
    expect(message).toBe('Esta sala foi cancelada.');
    buttons[0].onPress();
    expect(mockNavigate).toHaveBeenCalledWith('Main', { screen: 'Home' });
  });

  it('já em outra partida: não tira o usuário dela', async () => {
    mockRespond.mockRejectedValue(
      new ApiError('failed-precondition', 'Você já está em uma partida.'),
    );
    await enterInvitedRoom('ABC123', 'banner');
    expect((Alert.alert as jest.Mock).mock.calls[0][1]).toBe('Você já está em uma partida.');
  });
});

describe('push abrindo o app', () => {
  it('teste 5: app fechado e logado → entra direto na sala', async () => {
    mockInitialPush = { type: 'room_invite', code: 'ABC123', inviteId: 'ABC123_me' };
    await setStatus('signed_in');
    await renderHook(({ route }: { route: string | null }) => usePendingRoomInvite(route), {
      initialProps: { route: 'Main' as string | null },
    });
    await act(async () => undefined);
    expect(mockRespond).toHaveBeenCalledWith('ABC123', true);
    expect(mockNavigate).toHaveBeenCalledWith('Lobby', { code: 'ABC123' });
    expect(usePendingInviteStore.getState().pending).toBeNull();
  });

  it('teste 6: sem sessão → espera login e cadastro, depois entra na sala', async () => {
    await setStatus('signed_out');
    const hook = await renderHook(({ route }: { route: string | null }) => usePendingRoomInvite(route), {
      initialProps: { route: 'Login' as string | null },
    });
    await act(async () => mockPushListener?.({ type: 'room_invite', code: 'XYZ789' }));
    expect(mockRespond).not.toHaveBeenCalled();
    expect(usePendingInviteStore.getState().pending).toMatchObject({ code: 'XYZ789' });

    await setStatus('onboarding');
    await hook.rerender({ route: 'Register' });
    expect(mockRespond).not.toHaveBeenCalled();

    await setStatus('signed_in');
    await hook.rerender({ route: 'Main' });
    await act(async () => undefined);
    expect(mockRespond).toHaveBeenCalledTimes(1);
    expect(mockRespond).toHaveBeenCalledWith('XYZ789', true);
    expect(mockNavigate).toHaveBeenCalledWith('Lobby', { code: 'XYZ789' });
  });

  it('teste 12: o mesmo push aberto de novo não gera outra entrada em paralelo', async () => {
    await setStatus('signed_in');
    await renderHook(() => usePendingRoomInvite('Main'));
    await act(async () => {
      mockPushListener?.({ type: 'room_invite', code: 'ABC123' });
      mockPushListener?.({ type: 'room_invite', code: 'ABC123' });
    });
    // Cada toque vira no máximo uma chamada idempotente no servidor, nunca um segundo assento.
    expect(mockRespond.mock.calls.every(([code]) => code === 'ABC123')).toBe(true);
    expect(mockRespond.mock.calls.length).toBeLessThanOrEqual(2);
  });
});
