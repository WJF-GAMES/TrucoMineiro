import { act, renderHook, waitFor } from '@testing-library/react-native';
import { usePhoneLogin, LOGIN_MESSAGES } from '../usePhoneLogin';
import { useNetworkStore } from '@/stores/networkStore';
import { useAuthStore } from '@/stores/authStore';

jest.mock('@/services/firebase/auth', () => {
  // Só o formato importa aqui: o hook testa `instanceof` e lê a mensagem.
  class AuthError extends Error {}
  return { AuthError, signInWithPhoneNumber: jest.fn() };
});
jest.mock('@/services/firebase/analytics', () => ({ logEvent: jest.fn() }));
jest.mock('@/utils/haptics', () => ({ haptic: { error: jest.fn(), light: jest.fn() } }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const auth = require('@/services/firebase/auth');
const signIn = auth.signInWithPhoneNumber as jest.Mock;
const AuthError = auth.AuthError as new (message: string) => Error;

const VALID = '61996289726';
const CONFIRMATION = { confirm: jest.fn() };

const login = (onCodeSent = jest.fn()) => renderHook(() => usePhoneLogin(onCodeSent));

beforeEach(() => {
  jest.clearAllMocks();
  signIn.mockResolvedValue(CONFIRMATION);
  useNetworkStore.setState({ connected: true, wasConnected: true });
  useAuthStore.setState({ pendingPhone: null, confirmation: null });
});

describe('usePhoneLogin', () => {
  it('starts empty and keeps the button disabled', async () => {
    const { result } = await login();
    expect(result.current.phone).toBe('');
    expect(result.current.canContinue).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('masks while typing and only enables with a complete number', async () => {
    const { result } = await login();

    await act(async () => result.current.changePhone('61996'));
    expect(result.current.phone).toBe('(61) 9.96');
    expect(result.current.canContinue).toBe(false);

    await act(async () => result.current.changePhone(VALID));
    expect(result.current.phone).toBe('(61) 9.9628-9726');
    expect(result.current.canContinue).toBe(true);
  });

  it('clears the field when the country changes', async () => {
    const { result } = await login();
    await act(async () => result.current.changePhone(VALID));
    await act(async () =>
      result.current.changeCountry({ code: 'PT', name: 'Portugal', dial: '+351', flag: '' }),
    );
    expect(result.current.phone).toBe('');
    expect(result.current.country.code).toBe('PT');
  });

  it('refuses an incomplete number without calling Firebase', async () => {
    const { result } = await login();
    await act(async () => result.current.changePhone('619962'));
    await act(async () => {
      await result.current.submit();
    });
    expect(result.current.error).toBe(LOGIN_MESSAGES.invalid);
    expect(signIn).not.toHaveBeenCalled();
  });

  it('sends the SMS in E.164 and hands the confirmation to the OTP screen', async () => {
    const onCodeSent = jest.fn();
    const { result } = await login(onCodeSent);
    await act(async () => result.current.changePhone(VALID));
    await act(async () => {
      await result.current.submit();
    });

    expect(signIn).toHaveBeenCalledWith('+5561996289726');
    expect(useAuthStore.getState().confirmation).toBe(CONFIRMATION);
    expect(useAuthStore.getState().pendingPhone).toBe('+5561996289726');
    expect(onCodeSent).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBeNull();
  });

  it('does not send after losing a connection it had', async () => {
    useNetworkStore.setState({ connected: false, wasConnected: true });
    const { result } = await login();
    await act(async () => result.current.changePhone(VALID));
    await act(async () => {
      await result.current.submit();
    });

    expect(signIn).not.toHaveBeenCalled();
    expect(result.current.error).toBe(LOGIN_MESSAGES.offline);
  });

  it('still tries when the connection was never established', async () => {
    // Sem RTDB (firewall/emulador) o app nunca marca "online"; bloquear aqui impediria o login.
    useNetworkStore.setState({ connected: false, wasConnected: false });
    const { result } = await login();
    await act(async () => result.current.changePhone(VALID));
    await act(async () => {
      await result.current.submit();
    });
    expect(signIn).toHaveBeenCalledWith('+5561996289726');
  });

  it('shows the human message of an AuthError', async () => {
    signIn.mockRejectedValueOnce(new AuthError('Muitas tentativas. Aguarde.'));
    const { result } = await login();
    await act(async () => result.current.changePhone(VALID));
    await act(async () => {
      await result.current.submit();
    });

    expect(result.current.error).toBe('Muitas tentativas. Aguarde.');
    expect(result.current.loading).toBe(false);
  });

  it('never leaks an unexpected error to the user', async () => {
    signIn.mockRejectedValueOnce(new Error('auth/internal-error'));
    const { result } = await login();
    await act(async () => result.current.changePhone(VALID));
    await act(async () => {
      await result.current.submit();
    });

    expect(result.current.error).toBe(LOGIN_MESSAGES.unknown);
  });

  it('ignores a double tap: one SMS per press', async () => {
    let release: (v: unknown) => void = () => undefined;
    signIn.mockReturnValueOnce(new Promise((resolve) => (release = resolve)));
    const { result } = await login();
    await act(async () => result.current.changePhone(VALID));

    await act(async () => {
      void result.current.submit();
      void result.current.submit();
    });
    expect(signIn).toHaveBeenCalledTimes(1);
    expect(result.current.loading).toBe(true);
    expect(result.current.canContinue).toBe(false);

    await act(async () => {
      release(CONFIRMATION);
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
  });
});
