import React from 'react';
import { act, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Sheet } from '../Sheet';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

const sheet = (visible: boolean) => (
  <SafeAreaProvider initialMetrics={METRICS}>
    <Sheet visible={visible} onClose={() => {}} title="Raiana" testID="s" />
  </SafeAreaProvider>
);

/**
 * Regressão: um segundo toque na linha que abriu a folha caía no botão que subia por baixo do
 * dedo (a ficha do amigo abria direto em "Remover amizade"). Enquanto a folha sobe, uma camada
 * transparente segura os toques.
 */
describe('Sheet', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('segura os toques só enquanto a folha está abrindo', async () => {
    const { rerender } = await render(sheet(true));
    const guard = screen.getByTestId('s-opening');
    expect(guard.props.onStartShouldSetResponder()).toBe(true);

    await act(async () => {
      jest.advanceTimersByTime(650);
    });
    expect(screen.queryByTestId('s-opening')).toBeNull();

    // Fechar e abrir de novo arma a proteção outra vez.
    await rerender(sheet(false));
    await rerender(sheet(true));
    expect(screen.getByTestId('s-opening')).toBeOnTheScreen();
  });
});
