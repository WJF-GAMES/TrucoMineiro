import { act, renderHook } from '@testing-library/react-native';
import type { Seat } from '@/domain/game';
import { CEREMONY_TIMING, SHUFFLE_SWIPES_TO_COMPLETE } from '../shuffleCeremony';
import { useShuffleCeremony, type ShuffleCeremonyOptions } from '../useShuffleCeremony';

jest.mock('@/utils/haptics', () => ({
  haptic: {
    light: jest.fn(),
    medium: jest.fn(),
    heavy: jest.fn(),
    success: jest.fn(),
    error: jest.fn(),
    selection: jest.fn(),
  },
}));

/** Assento 0 é o jogador local. Dealer 0 = ele embaralha; dealer 3 = o adversário embaralha. */
const options = (patch: Partial<ShuffleCeremonyOptions> = {}): ShuffleCeremonyOptions => ({
  handNumber: 1,
  dealerSeat: 0 as Seat,
  mySeat: 0 as Seat,
  eligible: true,
  ...patch,
});

const mount = (props = options()) =>
  renderHook((p: ShuffleCeremonyOptions) => useShuffleCeremony(p), { initialProps: props });

const advance = (ms: number) =>
  act(async () => {
    jest.advanceTimersByTime(ms);
  });

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe('useShuffleCeremony', () => {
  it('não abre a cerimônia numa mão já em andamento', async () => {
    const { result } = await mount(options({ eligible: false }));
    expect(result.current.active).toBe(false);
    expect(result.current.stage).toBe('done');
  });

  it('abre em "embaralhar" com quem dá as cartas como responsável', async () => {
    const { result } = await mount(options({ dealerSeat: 0 }));
    expect(result.current.active).toBe(true);
    expect(result.current.stage).toBe('shuffle');
    expect(result.current.actorSeat).toBe(0);
    expect(result.current.iAmActor).toBe(true);
    expect(result.current.canFinish).toBe(false);
    expect(result.current.deadlineAt).not.toBeNull();
  });

  it('libera o botão só depois de embaralhar o mínimo', async () => {
    const { result } = await mount();
    await act(async () => result.current.finish()); // cedo demais: ignorado
    expect(result.current.stage).toBe('shuffle');
    expect(result.current.celebrating).toBe(false);

    await act(async () => result.current.bump());
    expect(result.current.canFinish).toBe(false);
    await act(async () => result.current.bump());
    expect(result.current.canFinish).toBe(true);
    expect(result.current.progress).toBeCloseTo(2 / SHUFFLE_SWIPES_TO_COMPLETE);

    await act(async () => result.current.finish());
    expect(result.current.celebrating).toBe(true);
    expect(result.current.timedOut).toBe(false);
  });

  it('fecha sozinho quando o jogador embaralha o bastante', async () => {
    const { result } = await mount();
    for (let i = 0; i < SHUFFLE_SWIPES_TO_COMPLETE; i++) {
      await act(async () => result.current.bump());
    }
    expect(result.current.celebrating).toBe(true);
    expect(result.current.progress).toBe(1);
  });

  it('percorre embaralhar → cortar → distribuir → mesa', async () => {
    const { result } = await mount();
    for (let i = 0; i < SHUFFLE_SWIPES_TO_COMPLETE; i++) {
      await act(async () => result.current.bump());
    }

    await advance(CEREMONY_TIMING.handoffMs);
    expect(result.current.stage).toBe('cut');
    // Quem corta é o assento seguinte, então aqui o jogador local só assiste.
    expect(result.current.actorSeat).toBe(1);
    expect(result.current.iAmActor).toBe(false);

    await advance(CEREMONY_TIMING.remoteCutMs);
    expect(result.current.celebrating).toBe(true);

    await advance(CEREMONY_TIMING.successMs);
    expect(result.current.stage).toBe('deal');

    await advance(CEREMONY_TIMING.dealMs);
    expect(result.current.active).toBe(false);
  });

  it('conclui sozinho quando o tempo acaba, sem travar a mão', async () => {
    const { result } = await mount();
    await advance(CEREMONY_TIMING.shuffleMs);
    expect(result.current.celebrating).toBe(true);
    expect(result.current.timedOut).toBe(true);

    await advance(CEREMONY_TIMING.handoffMs);
    expect(result.current.stage).toBe('cut');
  });

  it('encena o embaralhamento de quem está do outro lado da mesa', async () => {
    const { result } = await mount(options({ dealerSeat: 3 }));
    expect(result.current.iAmActor).toBe(false);
    expect(result.current.actorSeat).toBe(3);

    // O gesto do jogador local não pode mexer no baralho de outro.
    await act(async () => result.current.bump());
    expect(result.current.progress).toBe(0);

    await advance(CEREMONY_TIMING.remoteShuffleMs);
    expect(result.current.celebrating).toBe(true);

    await advance(CEREMONY_TIMING.handoffMs);
    // Dealer 3 → quem corta é o assento 0, o jogador local.
    expect(result.current.stage).toBe('cut');
    expect(result.current.iAmActor).toBe(true);
  });

  it('congela o relógio na reconexão e devolve o tempo que faltava', async () => {
    const { result, rerender } = await mount();
    await advance(3_000);
    await act(async () => rerender(options({ paused: true })));
    expect(result.current.deadlineAt).toBeNull();

    // Enquanto pausado o tempo não corre: passar o prazo inteiro não encerra nada.
    await advance(CEREMONY_TIMING.shuffleMs);
    expect(result.current.celebrating).toBe(false);

    await act(async () => rerender(options({ paused: false })));
    expect(result.current.deadlineAt).not.toBeNull();
    await advance(CEREMONY_TIMING.shuffleMs - 3_000);
    expect(result.current.celebrating).toBe(true);
    expect(result.current.timedOut).toBe(true);
  });

  it('recomeça a cada nova mão', async () => {
    const { result, rerender } = await mount(options({ handNumber: 1, dealerSeat: 0 }));
    for (let i = 0; i < SHUFFLE_SWIPES_TO_COMPLETE; i++) {
      await act(async () => result.current.bump());
    }
    await advance(CEREMONY_TIMING.handoffMs + CEREMONY_TIMING.remoteCutMs);
    await advance(CEREMONY_TIMING.successMs + CEREMONY_TIMING.dealMs);
    expect(result.current.active).toBe(false);

    await act(async () => rerender(options({ handNumber: 2, dealerSeat: 1 })));
    expect(result.current.active).toBe(true);
    expect(result.current.stage).toBe('shuffle');
    expect(result.current.actorSeat).toBe(1);
  });

  it('cancela a cerimônia se a mesa sair do ar no meio dela', async () => {
    const { result, rerender } = await mount();
    expect(result.current.active).toBe(true);
    await act(async () => rerender(options({ eligible: false })));
    expect(result.current.active).toBe(false);
  });
});
