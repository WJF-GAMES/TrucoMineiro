import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { Seat } from '@/domain/game';
import type { TablePlayer } from '@/features/game/types';
import { CEREMONY_TIMING, type CeremonyStage } from '@/features/game/shuffleCeremony';
import type { ShuffleCeremony } from '@/features/game/useCeremony';
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
  {
    seat: 3,
    nickname: 'Seu Antônio',
    avatarId: 'seu_antonio',
    isYou: false,
    bot: true,
    connected: true,
  },
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
  shuffleCount: 0,
  shuffleBusy: false,
  bump: jest.fn(),
  finish: jest.fn(),
  cutDepth: 'middle',
  setCutDepth: jest.fn(),
  ...patch,
});

const show = (c: ShuffleCeremony, reconnecting = false) =>
  render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <TableCeremony ceremony={c} players={PLAYERS} mySeat={0} reconnecting={reconnecting} />
    </SafeAreaProvider>,
  );

describe('TableCeremony', () => {
  it('explica a etapa, mostra o relógio e segura ESTÁ BOM até a primeira mistura', async () => {
    await show(ceremony());
    expect(screen.getByText('Embaralhar o Baralho')).toBeOnTheScreen();
    expect(
      screen.getByText('Você pode embaralhar quantas vezes quiser dentro do tempo.'),
    ).toBeOnTheScreen();
    expect(screen.getByText('Tempo para embaralhar')).toBeOnTheScreen();
    expect(screen.getByTestId('shuffle-clock')).toBeOnTheScreen();
    expect(screen.getByText('Nenhuma mistura ainda')).toBeOnTheScreen();
    expect(screen.getByTestId('ceremony-finish')).toBeDisabled();
    expect(screen.getByTestId('ceremony-shuffle')).toBeEnabled();
  });

  it('EMBARALHAR NOVAMENTE pede uma mistura real e trava enquanto ela não volta', async () => {
    const bump = jest.fn();
    await show(ceremony({ bump }));
    fireEvent.press(screen.getByTestId('ceremony-shuffle'));
    expect(bump).toHaveBeenCalledTimes(1);
  });

  it('enquanto a mistura não volta do motor os botões ficam travados', async () => {
    await show(ceremony({ shuffleBusy: true, shuffleCount: 1, canFinish: true }));
    expect(screen.getByTestId('ceremony-shuffle')).toBeDisabled();
    expect(screen.getByTestId('ceremony-finish')).toBeDisabled();
  });

  it('libera ESTÁ BOM depois da primeira mistura e conta as misturas', async () => {
    const finish = jest.fn();
    await show(ceremony({ shuffleCount: 1, progress: 1 / 3, canFinish: true, finish }));
    expect(screen.getByText('1 mistura realizada')).toBeOnTheScreen();
    expect(screen.getByText('O baralho começou a ser misturado.')).toBeOnTheScreen();
    expect(screen.getByTestId('ceremony-finish')).toBeEnabled();
    fireEvent.press(screen.getByTestId('ceremony-finish'));
    expect(finish).toHaveBeenCalledTimes(1);
  });

  it('com três misturas o baralho está ótimo', async () => {
    await show(ceremony({ shuffleCount: 3, progress: 1, canFinish: true }));
    expect(screen.getByText('3 misturas realizadas')).toBeOnTheScreen();
    expect(screen.getByText('O baralho está ótimo!')).toBeOnTheScreen();
  });

  it('quando é outro que embaralha, bloqueia a ação e diz de quem se espera', async () => {
    await show(
      ceremony({ actorSeat: 3 as Seat, dealerSeat: 3 as Seat, iAmActor: false, deadlineAt: null }),
    );
    expect(screen.getByText('Aguardando Seu Antônio embaralhar o baralho.')).toBeOnTheScreen();
    expect(screen.queryByTestId('ceremony-shuffle')).toBeNull();
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
    expect(screen.getByText('Cortar o Baralho')).toBeOnTheScreen();
    expect(
      screen.getByText('Arraste a parte superior para escolher onde cortar.'),
    ).toBeOnTheScreen();
    // As três opções de corte, o meio selecionado por padrão, e a escolha vai para a cerimônia
    // (é ela quem manda a profundidade no `CUT` para o motor).
    const c = ceremony({ stage: 'cut', stageTotalMs: CEREMONY_TIMING.cutMs, canFinish: false });
    await show(c);
    expect(screen.getByTestId('cut-options')).toBeOnTheScreen();
    expect(screen.getByTestId('cut-middle')).toBeSelected();
    await act(async () => {
      fireEvent.press(screen.getByTestId('cut-high'));
    });
    expect(c.setCutDepth).toHaveBeenCalledWith('high');
    await show(ceremony({ ...c, cutDepth: 'high' }));
    expect(screen.getByTestId('cut-high')).toBeSelected();
    // O corte é um gesto único: o botão nunca fica travado.
    expect(screen.getByTestId('ceremony-finish')).toBeEnabled();
  });

  it('quem não corta não vê as opções de corte', async () => {
    await show(ceremony({ stage: 'cut', actorSeat: 1 as Seat, iAmActor: false, deadlineAt: null }));
    expect(screen.queryByTestId('cut-options')).toBeNull();
  });

  it('na reconexão troca a ação pelo aviso de sincronização', async () => {
    await show(ceremony({ deadlineAt: null }), true);
    expect(screen.getByText('Sincronizando com a mesa...')).toBeOnTheScreen();
    expect(screen.queryByTestId('ceremony-finish')).toBeNull();
  });

  it('renderiza a distribuição sem pedir nada ao jogador', async () => {
    const stage: CeremonyStage = 'deal';
    await show(
      ceremony({ stage, actorSeat: null, iAmActor: false, deadlineAt: null, stageTotalMs: null }),
    );
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
