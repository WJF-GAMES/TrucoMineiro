import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { TextField } from '../Inputs';

/**
 * O rótulo do campo é um `Text` desenhado acima dele, não um `<label>` ligado ao input.
 * Quem não vê a tela só recebe o que estiver no próprio campo — por isso o rótulo (e a
 * mensagem de erro, que também mora fora do campo) precisam ser anunciados por ele.
 */
describe('TextField', () => {
  it('anuncia o rótulo do campo, não o placeholder', async () => {
    await render(<TextField label="Seu apelido" placeholder="João da Serra" testID="f" />);
    expect(screen.getByTestId('f').props.accessibilityLabel).toBe('Seu apelido');
    // Regressão: antes o campo só tinha o placeholder, e o leitor anunciava "João da Serra".
    expect(screen.queryByLabelText('João da Serra')).toBeNull();
    expect(screen.getByLabelText('Seu apelido')).toBeOnTheScreen();
  });

  it('leva a dica e, quando existe, o erro para a descrição do campo', async () => {
    const { rerender } = await render(
      <TextField label="Código da sala" hint="6 caracteres" testID="f" />,
    );
    expect(screen.getByTestId('f').props.accessibilityHint).toBe('6 caracteres');

    await rerender(
      <TextField label="Código da sala" hint="6 caracteres" error="Sala não encontrada" testID="f" />,
    );
    expect(screen.getByTestId('f').props.accessibilityHint).toBe('Sala não encontrada');
  });

  it('deixa a tela sobrescrever o rótulo quando precisa de um mais específico', async () => {
    await render(<TextField label="Apelido" accessibilityLabel="Apelido do amigo" testID="f" />);
    expect(screen.getByTestId('f').props.accessibilityLabel).toBe('Apelido do amigo');
  });
});
