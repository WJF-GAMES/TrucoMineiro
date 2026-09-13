import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { OtpInput } from '../Inputs';

/**
 * O que importa aqui é o contrato que faz o autofill do SMS funcionar:
 * um único campo real, do tamanho das células, com as props que Android e iOS
 * usam para oferecer o código recebido.
 */
const setup = async (value = '', props = {}) => {
  const onChange = jest.fn();
  const view = await render(
    <OtpInput value={value} onChange={onChange} autoFocus={false} {...props} />,
  );
  return { onChange, view, input: view.getByTestId('otp-input') };
};

describe('OtpInput', () => {
  it('exposes a single field with the autofill props of both platforms', async () => {
    const { input } = await setup();
    expect(input.props.autoComplete).toBe('sms-otp'); // Android
    expect(input.props.textContentType).toBe('oneTimeCode'); // iOS
    expect(input.props.importantForAutofill).toBe('yes');
    expect(input.props.keyboardType).toBe('number-pad');
    expect(input.props.maxLength).toBe(6);
    expect(input.props.accessibilityLabel).toBe('Código de verificação de 6 dígitos');
  });

  it('fills the whole cell area instead of hiding in a 1x1 corner', async () => {
    // Um campo 1x1 com opacity 0 é ignorado pelo autofill: ele precisa do tamanho real.
    const { input } = await setup();
    const style = Array.isArray(input.props.style)
      ? Object.assign({}, ...input.props.style.filter(Boolean))
      : input.props.style;
    expect(style.width).toBe('100%');
    expect(style.height).toBe('100%');
    expect(style.color).toBe('transparent');
    expect(style.opacity).toBeUndefined();
  });

  it('fills every digit when the system pastes the whole code', async () => {
    const { onChange, input } = await setup();
    await fireEvent.changeText(input, '123456');
    expect(onChange).toHaveBeenCalledWith('123456');
  });

  it('sanitizes what autofill or paste may bring along', async () => {
    const { onChange, input } = await setup();
    await fireEvent.changeText(input, '123 456');
    expect(onChange).toHaveBeenCalledWith('123456');

    await fireEvent.changeText(input, '1234567');
    expect(onChange).toHaveBeenLastCalledWith('123456');

    await fireEvent.changeText(input, '12a3');
    expect(onChange).toHaveBeenLastCalledWith('123');
  });

  it('handles backspace', async () => {
    const { onChange, input } = await setup('123456');
    await fireEvent.changeText(input, '12345');
    expect(onChange).toHaveBeenCalledWith('12345');
  });

  it('renders one cell per digit typed', async () => {
    const { view } = await setup('12');
    // As células ficam fora da árvore de acessibilidade de propósito (o leitor de tela
    // anuncia um campo só), por isso a busca precisa incluir elementos ocultos.
    const hidden = { includeHiddenElements: true };
    expect(view.getByText('1', hidden)).toBeTruthy();
    expect(view.getByText('2', hidden)).toBeTruthy();
  });
});
