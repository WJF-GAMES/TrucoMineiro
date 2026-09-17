import { renderHook } from '@testing-library/react-native';
import { createMatch, skipCeremony, viewForSeat } from '@/domain/game';
import { useTurnTimer } from '../useTurnTimer';
import { turnDurationMs } from '../turnTimer';

jest.mock('@/utils/haptics', () => ({ haptic: { heavy: jest.fn() } }));

const NOW = 1_000_000;

describe('useTurnTimer — prazo do servidor', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });
  afterEach(() => jest.useRealTimers());

  const view = viewForSeat(skipCeremony(createMatch(7)), 0);
  const base = { view, mySeat: 0 as const, myMove: true, paused: false, act: jest.fn() };

  it('sem prazo do servidor, usa o tempo local da fase', async () => {
    const hook = await renderHook(() => useTurnTimer(base));
    expect(hook.result.current).toBe(NOW + turnDurationMs(view.phase));
    await hook.unmount();
  });

  it('prazo do servidor mais cedo (vez apareceu atrasada na tela) prevalece', async () => {
    const serverDeadline = { version: view.version, at: NOW + 4_000 };
    const hook = await renderHook(() => useTurnTimer({ ...base, serverDeadline }));
    expect(hook.result.current).toBe(NOW + 4_000);
    await hook.unmount();
  });

  it('prazo de outra versão da view é ignorado; prazo mais tarde não estica o local', async () => {
    const stale = await renderHook(() =>
      useTurnTimer({ ...base, serverDeadline: { version: view.version - 1, at: NOW + 1_000 } }),
    );
    expect(stale.result.current).toBe(NOW + turnDurationMs(view.phase));
    await stale.unmount();
    const later = await renderHook(() =>
      useTurnTimer({ ...base, serverDeadline: { version: view.version, at: NOW + 999_999 } }),
    );
    expect(later.result.current).toBe(NOW + turnDurationMs(view.phase));
    await later.unmount();
  });

  it('dispara a jogada automática no prazo do servidor', async () => {
    const act = jest.fn();
    const hook = await renderHook(() =>
      useTurnTimer({ ...base, act, serverDeadline: { version: view.version, at: NOW + 2_000 } }),
    );
    jest.advanceTimersByTime(1_999);
    expect(act).not.toHaveBeenCalled();
    jest.advanceTimersByTime(2);
    expect(act).toHaveBeenCalledWith(expect.objectContaining({ seat: 0 }));
    await hook.unmount();
  });
});
