import React from 'react';
import { render } from '@testing-library/react-native';
import { parseCardId, type Seat } from '@/domain/game';
import type { TablePlayer } from '@/features/game/types';
import { HandRevealOverlay } from '../HandRevealOverlay';

jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));

const players: TablePlayer[] = (['Eu', 'Zé', 'Maria', 'Tião'] as const).map((nickname, seat) => ({
  seat: seat as Seat,
  nickname,
  avatarId: 'joao',
  isYou: seat === 0,
  bot: seat !== 0,
  connected: true,
}));

const hands = [
  ['3O', '4E', '5C'],
  ['4P', '6O', 'KE'],
  ['7C', 'QO', 'JP'],
  ['AE', '2C', '6P'],
].map((h) => h.map(parseCardId));

describe('HandRevealOverlay', () => {
  it('mostra as 12 cartas, cada grupo com o dono certo', async () => {
    const view = await render(<HandRevealOverlay hands={hands} players={players} mySeat={0} />);
    expect(view.getByTestId('reveal-0').props.accessibilityLabel).toBe(
      'Você: 3 de ouros, 4 de espadas, 5 de copas',
    );
    expect(view.getByTestId('reveal-1').props.accessibilityLabel).toBe(
      'Zé: 4 de paus, 6 de ouros, K de espadas',
    );
    expect(view.getByTestId('reveal-2').props.accessibilityLabel).toBe(
      'Maria: 7 de copas, Q de ouros, J de paus',
    );
    expect(view.getByTestId('reveal-3').props.accessibilityLabel).toBe(
      'Tião: A de espadas, 2 de copas, 6 de paus',
    );
    expect(view.getAllByTestId(/^card-/)).toHaveLength(12);
  });

  it('assento sem cartas não quebra a revelação', async () => {
    const view = await render(
      <HandRevealOverlay
        hands={[hands[0]!, [], hands[2]!, hands[3]!]}
        players={players}
        mySeat={2}
      />,
    );
    expect(view.getByTestId('reveal-1').props.accessibilityLabel).toBe('Zé: sem cartas');
    expect(view.getByTestId('reveal-2').props.accessibilityLabel).toMatch(/^Você:/);
  });
});
