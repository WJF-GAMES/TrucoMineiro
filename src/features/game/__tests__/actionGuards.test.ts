import { act, renderHook } from '@testing-library/react-native';
import {
  applyAction,
  createMatch,
  cutterSeatOf,
  getAvailableActions,
  viewForSeat,
  type GameEvent,
  type MatchState,
  type SeatView,
  type Seat,
} from '@/domain/game';
import { useAiGame } from '../useAiGame';
import { useCeremony } from '../useCeremony';

jest.mock('@/services/firebase/analytics', () => ({ logEvent: jest.fn() }));
jest.mock('@/services/firebase/crashlytics', () => ({ setCrashContext: jest.fn() }));
jest.mock('@/stores/profileStore', () => ({
  useProfileStore: (sel: (s: { profile: null }) => unknown) => sel({ profile: null }),
}));
jest.mock('@/utils/haptics', () => ({
  haptic: { light: jest.fn(), medium: jest.fn(), heavy: jest.fn() },
}));

/** A mesa só existe depois do primeiro snapshot; nos testes ela sempre já está montada. */
function viewOf(controller: { view: SeatView | null }): SeatView {
  if (!controller.view) throw new Error('a mesa deveria estar montada neste ponto do teste');
  return controller.view;
}

/**
 * Guards contra ações atrasadas (toque entregue depois de a fase mudar, timer velho, closure de
 * um render antigo). Antes, o motor lançava dentro do updater de estado e a mesa inteira caía.
 */
describe('useAiGame', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('ignora ação que a mesa não aceita em vez de derrubar a árvore', async () => {
    const onFinished = jest.fn();
    const { result } = await renderHook(() => useAiGame('normal', 7, onFinished));
    const before = viewOf(result.current).version;
    expect(result.current.availableActions).not.toContain('CUT');
    await expect(
      act(async () => {
        result.current.act({ type: 'CUT', seat: 0, depth: 'middle' });
      }),
    ).resolves.toBeUndefined();
    expect(viewOf(result.current).version).toBe(before);
    expect(result.current.status).toBe('playing');
  });

  it('aplica a mesma ação uma vez só quando ela chega duplicada', async () => {
    const onFinished = jest.fn();
    const { result } = await renderHook(() => useAiGame('normal', 7, onFinished));
    const mine = result.current.availableActions;
    // Com o seed 7 pode ser ou não a vez do humano na cerimônia: só o caso "sou o dealer" testa.
    if (!mine.includes('SHUFFLE')) return;
    const before = viewOf(result.current).version;
    await act(async () => {
      result.current.act({ type: 'SHUFFLE', seat: 0 });
      result.current.act({ type: 'FINISH_SHUFFLE', seat: 0 });
      // Chegou atrasado: a fase já é CUTTING.
      result.current.act({ type: 'FINISH_SHUFFLE', seat: 0 });
    });
    expect(viewOf(result.current).version).toBe(before + 2);
  });
});

function stateAtCutting(seed: number): { state: MatchState; cutter: Seat } {
  let state = createMatch(seed);
  const dealer = state.hand.dealerSeat;
  state = applyAction(state, { type: 'SHUFFLE', seat: dealer });
  state = applyAction(state, { type: 'FINISH_SHUFFLE', seat: dealer });
  expect(state.hand.phase).toBe('CUTTING');
  return { state, cutter: cutterSeatOf(dealer) };
}

// Na mesa o lote de eventos é estável entre renders; um array novo por render dispararia a
// derivação da distribuição a cada render.
const NO_EVENTS: GameEvent[] = [];

describe('useCeremony.finish', () => {
  it('fecha o corte uma vez só, mesmo chamado de novo pela closure antiga', async () => {
    const { state, cutter } = stateAtCutting(3);
    const view = viewForSeat(state, cutter);
    expect(getAvailableActions(state, cutter)).toContain('CUT');
    const actFn = jest.fn();
    const { result } = await renderHook(() =>
      useCeremony({
        view,
        mySeat: cutter,
        recentEvents: NO_EVENTS,
        deadlineAt: null,
        act: actFn,
        held: false,
      }),
    );
    const { finish } = result.current;
    await act(async () => {
      finish();
      finish();
    });
    expect(actFn).toHaveBeenCalledTimes(1);
    expect(actFn).toHaveBeenCalledWith({ type: 'CUT', seat: cutter, depth: 'middle' });
  });

  it('manda a profundidade escolhida no CUT', async () => {
    const { state, cutter } = stateAtCutting(3);
    const view = viewForSeat(state, cutter);
    const actFn = jest.fn();
    const { result } = await renderHook(() =>
      useCeremony({
        view,
        mySeat: cutter,
        recentEvents: NO_EVENTS,
        deadlineAt: null,
        act: actFn,
        held: false,
      }),
    );
    await act(async () => result.current.setCutDepth('high'));
    await act(async () => result.current.finish());
    expect(actFn).toHaveBeenCalledWith({ type: 'CUT', seat: cutter, depth: 'high' });
  });

  it('não corta quando a view viva já saiu de CUTTING', async () => {
    const { state, cutter } = stateAtCutting(3);
    const cutting = viewForSeat(state, cutter);
    const dealt = viewForSeat(
      applyAction(state, { type: 'CUT', seat: cutter, depth: 'middle' }),
      cutter,
    );
    const actFn = jest.fn();
    const { result, rerender } = await renderHook<
      ReturnType<typeof useCeremony>,
      { view: SeatView }
    >(
      ({ view }) =>
        useCeremony({
          view,
          mySeat: cutter,
          recentEvents: NO_EVENTS,
          deadlineAt: null,
          act: actFn,
          held: false,
        }),
      { initialProps: { view: cutting } },
    );
    const staleFinish = result.current.finish;
    await rerender({ view: dealt });
    await act(async () => staleFinish());
    expect(actFn).not.toHaveBeenCalled();
  });
});
