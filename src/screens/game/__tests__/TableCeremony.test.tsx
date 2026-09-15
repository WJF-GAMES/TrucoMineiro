import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
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
  cutCount: 0,
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
    // Uma linha só para o progresso: a contagem e a "qualidade" diziam a mesma coisa duas vezes.
    expect(screen.getByText('O baralho começou a ser misturado.')).toBeOnTheScreen();
    expect(screen.queryByText('1 mistura realizada')).toBeNull();
    expect(screen.getByTestId('ceremony-finish')).toBeEnabled();
    fireEvent.press(screen.getByTestId('ceremony-finish'));
    expect(finish).toHaveBeenCalledTimes(1);
  });

  it('com três misturas o baralho está ótimo', async () => {
    await show(ceremony({ shuffleCount: 3, progress: 1, canFinish: true }));
    expect(screen.getByText('O baralho está ótimo!')).toBeOnTheScreen();
    expect(screen.queryByText('3 misturas realizadas')).toBeNull();
  });

  it('o prazo e o progresso dividem um único cartão, sem nota repetindo os botões', async () => {
    await show(ceremony({ shuffleCount: 0 }));
    const card = screen.getByTestId('shuffle-status');
    // O relógio do estágio vive dentro do mesmo cartão do progresso.
    expect(within(card).getByTestId('shuffle-clock')).toBeOnTheScreen();
    expect(within(card).getByText('Nenhuma mistura ainda')).toBeOnTheScreen();
    // E o texto "Mistura do baralho" some: o cartão já está no contexto do embaralhamento.
    expect(screen.queryByText('Mistura do baralho')).toBeNull();
    expect(screen.queryByText('Toque em EMBARALHAR para misturar o baralho.')).toBeNull();
    expect(screen.queryByText('Continue embaralhando ou toque em ESTÁ BOM.')).toBeNull();
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

  const cutStage = (patch: Partial<ShuffleCeremony> = {}) =>
    ceremony({ stage: 'cut', stageTotalMs: CEREMONY_TIMING.cutMs, canFinish: true, ...patch });

  it('troca o gesto e o texto no corte', async () => {
    await show(cutStage());
    expect(screen.getByText('Cortar o Baralho')).toBeOnTheScreen();
    expect(screen.getByText('Você pode cortar quantas vezes quiser dentro do tempo.')).toBeOnTheScreen();
    // O corte tem prazo próprio na tela: é dentro dele que o gesto pode ser repetido.
    expect(screen.getByText('Tempo para cortar')).toBeOnTheScreen();
    // As três opções de corte, o meio selecionado por padrão, e a escolha vai para a cerimônia
    // (é ela quem manda a profundidade no `CUT` para o motor).
    const c = cutStage();
    await show(c);
    expect(screen.getByTestId('cut-options')).toBeOnTheScreen();
    expect(screen.getByTestId('cut-middle')).toBeSelected();
    await act(async () => {
      fireEvent.press(screen.getByTestId('cut-high'));
    });
    expect(c.setCutDepth).toHaveBeenCalledWith('high');
    await show(ceremony({ ...c, cutDepth: 'high' }));
    expect(screen.getByTestId('cut-high')).toBeSelected();
  });

  it('CORTAR pede um corte real e conta os cortes; CONFIRMAR fecha o estágio', async () => {
    const c = cutStage();
    await show(c);
    expect(screen.getByText('Nenhum corte ainda')).toBeOnTheScreen();
    await act(async () => {
      fireEvent.press(screen.getByTestId('ceremony-cut'));
    });
    expect(c.bump).toHaveBeenCalledTimes(1);
    expect(c.finish).not.toHaveBeenCalled();

    await show(cutStage({ cutCount: 1 }));
    expect(screen.getByText('1 corte realizado')).toBeOnTheScreen();

    const c3 = cutStage({ cutCount: 3 });
    await show(c3);
    expect(screen.getByText('3 cortes realizados')).toBeOnTheScreen();
    // Cortar de novo continua liberado: o prazo é o único limite.
    expect(screen.getByTestId('ceremony-cut')).toBeEnabled();
    await act(async () => {
      fireEvent.press(screen.getByTestId('ceremony-finish'));
    });
    expect(c3.finish).toHaveBeenCalledTimes(1);
  });

  it('enquanto um corte não volta do motor os dois botões ficam travados', async () => {
    await show(cutStage({ cutCount: 1, shuffleBusy: true }));
    expect(screen.getByTestId('ceremony-cut')).toBeDisabled();
    expect(screen.getByTestId('ceremony-finish')).toBeDisabled();
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
