import { AppState } from 'react-native';
import { act, renderHook } from '@testing-library/react-native';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useMatchKeepAwake } from '../useMatchKeepAwake';

const activate = activateKeepAwakeAsync as jest.Mock;
const deactivate = deactivateKeepAwake as jest.Mock;

describe('useMatchKeepAwake', () => {
  beforeEach(() => {
    activate.mockClear();
    deactivate.mockClear();
  });

  it('mantém a tela acesa só enquanto a partida está ativa', async () => {
    const hook = await renderHook(({ active }: { active: boolean }) => useMatchKeepAwake(active), {
      initialProps: { active: true },
    });
    expect(activate).toHaveBeenCalledWith('truco-match');
    await act(async () => hook.rerender({ active: false }));
    expect(deactivate).toHaveBeenCalledWith('truco-match');
    await hook.unmount();
  });

  it('não liga fora da partida e desliga ao sair da tela', async () => {
    const idle = await renderHook(() => useMatchKeepAwake(false));
    expect(activate).not.toHaveBeenCalled();
    await idle.unmount();
    const live = await renderHook(() => useMatchKeepAwake(true));
    await live.unmount();
    expect(deactivate).toHaveBeenCalledTimes(1);
  });

  it('falha do módulo (web sem Wake Lock) não quebra a partida', async () => {
    activate.mockRejectedValueOnce(new Error('sem wake lock'));
    await expect(renderHook(() => useMatchKeepAwake(true))).resolves.toBeDefined();
  });
  it('reaplica ao voltar do background', async () => {
    const listeners: ((s: string) => void)[] = [];
    const spy = jest.spyOn(AppState, 'addEventListener').mockImplementation((_e, cb) => {
      listeners.push(cb as (s: string) => void);
      return { remove: jest.fn() } as never;
    });
    const hook = await renderHook(() => useMatchKeepAwake(true));
    expect(activate).toHaveBeenCalledTimes(1);
    await act(async () => listeners.forEach((l) => l('active')));
    expect(activate).toHaveBeenCalledTimes(2);
    await hook.unmount();
    spy.mockRestore();
  });
});
