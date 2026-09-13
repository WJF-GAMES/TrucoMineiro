import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { Seat } from '@/domain/game';
import type { TablePlayer } from '@/features/game/types';
import { CEREMONY_TIMING, type CeremonyStage } from '@/features/game/shuffleCeremony';
import type { ShuffleCeremony } from '@/features/game/useShuffleCeremony';
import { TableCeremony } from '../TableCeremony';

jest.mock('@/utils/haptics', () => ({
  haptic: { light: jest.fn(), medium: jest.fn(), success: jest.fn(), selection: jest.fn() },
}));

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const PLAYERS: TablePlayer[] = [
  { seat: 0, nickname: 'Você', avatarId: 'joao', isYou: true, bot: false, connected: true },
  { seat: 1, nickname: 'Tião', avatarId: 'tiao', isYou: false, bot: true, connected: true },
  { seat: 2, nickname: 'Maria', avatarId: 'maria', isYou: false, bot: true, connected: true },
  { seat: 3, nickname: 'Seu Antônio', avatarId: 'seu_antonio', isYou: false, bot: true, connected: true },
];

const ceremony = (patch: Partial<ShuffleCeremony> = {}): ShuffleCeremony => ({
  active: true,
  stage: 'shuffle',
  dealerSeat: 0 as Seat,
  actorSeat: 0 as Seat,
  iAmActor: true,
  progress: 0,
  canFinish: false,
  celebrating: false,
  timedOut: false,
  deadlineAt: Date.now() + CEREMONY_TIMING.shuffleMs,
  stageTotalMs: CEREMONY_TIMING.shuffleMs,
  bump: jest.fn(),
  finish: jest.fn(),
  ...patch,
});

const show = (c: ShuffleCeremony, reconnecting = false) =>
  render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <TableCeremony ceremony={c} players={PLAYERS} mySeat={0} reconnecting={reconnecting} />
    </SafeAreaProvider>,
  );

describe('TableCeremony', () => {
  it('pede o gesto e segura o botão até o embaralhamento mínimo', async () => {
    await show(ceremony());
    expect(screen.getByText('Sua vez de')).toBeOnTheScreen();
    expect(screen.getByText('embaralhar o baralho.')).toBeOnTheScreen();
    expect(screen.getByText('Toque ou arraste para embaralhar e preparar o corte.')).toBeOnTheScreen();
    expect(screen.getByTestId('ceremony-finish')).toBeDisabled();
    expect(screen.getByTestId('ceremony-clock')).toBeOnTheScreen();
  });

  it('libera o botão quando já dá para finalizar', async () => {
    await show(ceremony({ progress: 0.5, canFinish: true }));
    expect(screen.getByTestId('ceremony-finish')).toBeEnabled();
  });

  it('quando é outro que embaralha, bloqueia a ação e diz de quem se espera', async () => {
    await show(ceremony({ actorSeat: 3 as Seat, dealerSeat: 3 as Seat, iAmActor: false }));
    expect(screen.getByText('Aguardando Seu Antônio embaralhar o baralho.')).toBeOnTheScreen();
    expect(screen.getByText('Aguardando Seu Antônio embaralhar...')).toBeOnTheScreen();
    expect(screen.queryByTestId('ceremony-finish')).toBeNull();
    // Sem prazo do lado de cá: o relógio é do outro jogador.
    expect(screen.queryByTestId('ceremony-clock')).toBeNull();
  });

  it('anuncia o próximo passo ao concluir o embaralhamento', async () => {
    await show(ceremony({ celebrating: true, progress: 1 }));
    expect(screen.getByText('Baralho embaralhado!')).toBeOnTheScreen();
    expect(screen.getByText('Agora é hora de cortar o baralho.')).toBeOnTheScreen();
  });

  it('explica o tempo esgotado sem culpar o jogador', async () => {
    await show(ceremony({ celebrating: true, timedOut: true }));
    expect(screen.getByText('Tempo esgotado.')).toBeOnTheScreen();
    expect(screen.getByText('Embaralhamos por você.')).toBeOnTheScreen();
  });

  it('troca o gesto e o texto no corte', async () => {
    await show(ceremony({ stage: 'cut', stageTotalMs: CEREMONY_TIMING.cutMs, canFinish: false }));
    expect(screen.getByText('cortar o baralho.')).toBeOnTheScreen();
    // O corte é um gesto único: o botão nunca fica travado.
    expect(screen.getByTestId('ceremony-finish')).toBeEnabled();
  });

  it('na reconexão troca a ação pelo aviso de sincronização', async () => {
    await show(ceremony({ deadlineAt: null }), true);
    expect(screen.getByText('Sincronizando com a mesa...')).toBeOnTheScreen();
    expect(screen.queryByTestId('ceremony-finish')).toBeNull();
  });

  it('renderiza a distribuição sem pedir nada ao jogador', async () => {
    const stage: CeremonyStage = 'deal';
    await show(ceremony({ stage, actorSeat: null, iAmActor: false, deadlineAt: null, stageTotalMs: null }));
    expect(screen.getByText('Distribuindo')).toBeOnTheScreen();
    expect(screen.getByText('as cartas.')).toBeOnTheScreen();
    expect(screen.queryByTestId('ceremony-finish')).toBeNull();
  });

  it('mostra os três jogadores da mesa com o status de cada um', async () => {
    await show(ceremony());
    expect(screen.getByTestId('ceremony-seat-1')).toBeOnTheScreen();
    expect(screen.getByTestId('ceremony-seat-2')).toBeOnTheScreen();
    expect(screen.getByTestId('ceremony-seat-3')).toBeOnTheScreen();
    // Dealer 0 embaralha, então quem corta em seguida é o assento 1.
    expect(screen.getByText('Corta em seguida')).toBeOnTheScreen();
    expect(screen.getAllByText('Aguardando...')).toHaveLength(2);
  });
});
