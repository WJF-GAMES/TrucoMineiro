import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { parseCardId } from '@/domain/game';
import { HandCard } from '../HandCard';

jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));

/** Jogar é um toque: sem arraste, sem ponto de soltura. */
describe('HandCard', () => {
  const card = parseCardId('3O');

  it('um toque joga a carta', async () => {
    const onPlay = jest.fn();
    const view = await render(<HandCard card={card} width={82} onPlay={onPlay} />);
    fireEvent.press(view.getByTestId('hand-3O'));
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(view.getByTestId('hand-3O').props.accessibilityLabel).toBe('Jogar 3 de ouros');
  });

  it('carta indisponível não responde e informa o estado', async () => {
    const view = await render(<HandCard card={card} width={82} dimmed />);
    const el = view.getByTestId('hand-3O');
    fireEvent.press(el);
    expect(el.props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('com o modo virada armado, anuncia e mostra que a carta sai virada', async () => {
    const onPlay = jest.fn();
    const view = await render(<HandCard card={card} width={82} onPlay={onPlay} coverArmed />);
    expect(view.getByText('VIRADA')).toBeTruthy();
    expect(view.getByTestId('hand-3O').props.accessibilityLabel).toBe('Jogar 3 de ouros virada');
    fireEvent.press(view.getByTestId('hand-3O'));
    expect(onPlay).toHaveBeenCalledTimes(1);
  });

  it('carta obrigatória do desempate tem selo e dica acessível', async () => {
    const view = await render(<HandCard card={card} width={82} onPlay={jest.fn()} required />);
    expect(view.getByText('MAIOR')).toBeTruthy();
    expect(view.getByTestId('hand-3O').props.accessibilityHint).toBe(
      'Esta é a maior carta e deve ser jogada no desempate.',
    );
  });
});
