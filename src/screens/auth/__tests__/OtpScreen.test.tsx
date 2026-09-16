import React, { type ComponentProps } from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { OtpScreen } from '../OtpScreen';
import { useAuthStore } from '@/stores/authStore';
import { AuthError, confirmCode } from '@/services/firebase/auth';

jest.mock('@/services/firebase/auth', () => {
  class MockAuthError extends Error {
    constructor(mockCode: string, mockMessage: string) {
      super(mockMessage);
      Object.assign(this, { code: mockCode });
    }
  }
  return {
    AuthError: MockAuthError,
    confirmCode: jest.fn(),
    signInWithPhoneNumber: jest.fn(),
  };
});
jest.mock('@/services/firebase/app', () => ({ USE_EMULATORS: false }));
jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const confirm = confirmCode as jest.Mock;
/** Com o carregamento aberto o resto da tela fica fora da acessibilidade (overlay modal). */
const HIDDEN = { includeHiddenElements: true };

function setup() {
  const navigation = { replace: jest.fn(), goBack: jest.fn(), navigate: jest.fn() };
  useAuthStore.setState({
    status: 'signed_out',
    user: null,
    pendingPhone: '+5511900000000',
    confirmation: { confirm: jest.fn() } as never,
  });
  const props = { navigation, route: { key: 'Otp', name: 'Otp' } } as unknown as ComponentProps<
    typeof OtpScreen
  >;
  return { navigation, props };
}

async function typeCode(view: Awaited<ReturnType<typeof render>>) {
  await act(async () => {
    fireEvent.changeText(view.getByTestId('otp-input'), '123456');
  });
}

describe('OtpScreen — carregamento ao confirmar', () => {
  beforeEach(() => confirm.mockReset());

  it('mostra o carregamento bloqueante e só confirma uma vez, mesmo com toque duplo', async () => {
    let resolve: () => void = () => undefined;
    confirm.mockImplementation(() => new Promise<void>((r) => (resolve = r)));
    const { props } = setup();
    const view = await render(<OtpScreen {...props} />);
    await typeCode(view);

    await act(async () => {
      fireEvent.press(view.getByTestId('otp-confirm', HIDDEN));
      fireEvent.press(view.getByTestId('otp-confirm', HIDDEN));
    });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(view.getByTestId('otp-loading').props.accessibilityLabel).toBe(
      'Validando seu acesso...',
    );
    // O overlay é modal: o resto da tela sai da árvore acessível enquanto processa.
    expect(view.queryByTestId('otp-confirm')).toBeNull();

    await act(async () => resolve());
    // Código aceito: continua travado até a navegação trocar (o app busca o perfil).
    expect(view.getByTestId('otp-loading').props.accessibilityLabel).toBe('Entrando...');
    await act(async () => {
      fireEvent.press(view.getByTestId('otp-confirm', HIDDEN));
    });
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('não volta para o Login quando o telefone pendente é limpo depois do acerto', async () => {
    confirm.mockResolvedValue({});
    const { props, navigation } = setup();
    const view = await render(<OtpScreen {...props} />);
    await typeCode(view);
    await act(async () => {
      fireEvent.press(view.getByTestId('otp-confirm', HIDDEN));
    });
    await act(async () => {
      // O bootstrap decide o usuário e limpa o pendente (a navegação troca de pilha sozinha).
      useAuthStore.getState().setUser({ uid: 'u1' } as never, false);
    });
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  it('código inválido remove o carregamento, reabilita e mostra o erro', async () => {
    confirm.mockRejectedValue(new AuthError('invalid-code', 'Código inválido ou expirado.'));
    const { props } = setup();
    const view = await render(<OtpScreen {...props} />);
    await typeCode(view);
    await act(async () => {
      fireEvent.press(view.getByTestId('otp-confirm', HIDDEN));
    });
    expect(view.queryByTestId('otp-loading')).toBeNull();
    expect(view.getByText('Código inválido ou expirado.')).toBeTruthy();

    // Pode tentar de novo.
    confirm.mockReset();
    confirm.mockResolvedValue({});
    await typeCode(view);
    await act(async () => {
      fireEvent.press(view.getByTestId('otp-confirm', HIDDEN));
    });
    expect(confirm).toHaveBeenCalledTimes(1);
  });
});
