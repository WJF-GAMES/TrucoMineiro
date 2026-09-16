import { act, renderHook } from '@testing-library/react-native';
import { applyAction, createMatch, parseCardId, skipCeremony } from '@/domain/game';
import type { GameEvent, MatchState } from '@/domain/game';
import { REVEAL_MS, revealFromBatch, useHandReveal } from '../handReveal';

function declinedBatch(): { batch: GameEvent[]; before: MatchState } {
  const m = createMatch(7);
  const before = skipCeremony({ ...m, scores: [11, 2], hand: { ...m.hand, maoDeOnzeTeam: 0 } });
  const after = applyAction(before, { type: 'DECLINE_MAO_DE_ONZE', seat: 0 });
  return { batch: after.events.slice(before.events.length), before };
}

describe('revealFromBatch', () => {
  it('pega as mãos do lote da mão de onze recusada', () => {
    const { batch, before } = declinedBatch();
    const r = revealFromBatch(batch, 1_000)!;
    expect(r.until).toBe(1_000 + REVEAL_MS);
    expect(r.hands).toEqual(before.hand.hands);
  });

  it('lote sem revelação não revela nada', () => {
    expect(revealFromBatch([], 0)).toBeNull();
  });

  it('tolera buracos do RTDB nos arrays', () => {
    const batch = [
      {
        type: 'HAND_REVEALED',
        reason: 'MAO_DE_ONZE_DECLINED',
        hands: [[parseCardId('3O'), null], undefined],
      },
    ] as unknown as GameEvent[];
    expect(revealFromBatch(batch, 0)!.hands).toEqual([[parseCardId('3O')], [], [], []]);
  });
});

describe('useHandReveal', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('revela por REVEAL_MS e depois libera a mesa', async () => {
    const { batch } = declinedBatch();
    const hook = await renderHook(
      ({ events, version }: { events: GameEvent[]; version: number }) =>
        useHandReveal(events, version),
      { initialProps: { events: [] as GameEvent[], version: 3 } },
    );
    expect(hook.result.current).toBeNull();
    await act(async () => hook.rerender({ events: batch, version: 4 }));
    expect(hook.result.current?.hands).toHaveLength(4);
    await act(async () => {
      jest.advanceTimersByTime(REVEAL_MS + 10);
    });
    expect(hook.result.current).toBeNull();
    // O mesmo lote de novo (snapshot repetido) não revela outra vez.
    await act(async () => hook.rerender({ events: [...batch], version: 4 }));
    expect(hook.result.current).toBeNull();
  });

  it('ao abrir/reconectar com o lote já gravado, não revela (segue direto)', async () => {
    const { batch } = declinedBatch();
    const hook = await renderHook(() => useHandReveal(batch, 9));
    expect(hook.result.current).toBeNull();
  });
});
