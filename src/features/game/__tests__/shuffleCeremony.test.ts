import {
  CEREMONY_TIMING,
  SHUFFLE_SWIPES_TO_ARM,
  SHUFFLE_SWIPES_TO_COMPLETE,
  actorSeatFor,
  canFinishShuffle,
  cutterSeat,
  formatSeatClock,
  isShuffleComplete,
  isUrgent,
  remainingMs,
  seatStatus,
  shuffleProgress,
  shufflerSeat,
  stageDurationMs,
} from '../shuffleCeremony';
import { teamOf, type Seat } from '@/domain/game';

const SEATS: Seat[] = [0, 1, 2, 3];

describe('quem embaralha e quem corta', () => {
  it('quem dá as cartas embaralha', () => {
    SEATS.forEach((s) => expect(shufflerSeat(s)).toBe(s));
  });

  it('quem corta é sempre um adversário de quem embaralhou', () => {
    SEATS.forEach((dealer) => {
      const cutter = cutterSeat(dealer);
      expect(cutter).not.toBe(dealer);
      expect(teamOf(cutter)).not.toBe(teamOf(dealer));
    });
  });

  it('o assento que age muda com o estágio e some na distribuição', () => {
    expect(actorSeatFor('shuffle', 3)).toBe(3);
    expect(actorSeatFor('cut', 3)).toBe(0);
    expect(actorSeatFor('deal', 3)).toBeNull();
    expect(actorSeatFor('done', 3)).toBeNull();
  });

  it('marca quem corta em seguida enquanto o baralho ainda está sendo embaralhado', () => {
    expect(seatStatus(3, 'shuffle', 3)).toBe('acting');
    expect(seatStatus(0, 'shuffle', 3)).toBe('next');
    expect(seatStatus(1, 'shuffle', 3)).toBe('waiting');
    // No corte, quem embaralhou volta a ser só mais um esperando.
    expect(seatStatus(0, 'cut', 3)).toBe('acting');
    expect(seatStatus(3, 'cut', 3)).toBe('waiting');
  });
});

describe('progresso do embaralhamento', () => {
  it('libera o botão na metade e fecha sozinho no fim', () => {
    expect(canFinishShuffle(SHUFFLE_SWIPES_TO_ARM - 1)).toBe(false);
    expect(canFinishShuffle(SHUFFLE_SWIPES_TO_ARM)).toBe(true);
    expect(isShuffleComplete(SHUFFLE_SWIPES_TO_COMPLETE - 1)).toBe(false);
    expect(isShuffleComplete(SHUFFLE_SWIPES_TO_COMPLETE)).toBe(true);
  });

  it('nunca passa de 1 nem cai abaixo de 0', () => {
    expect(shuffleProgress(0)).toBe(0);
    expect(shuffleProgress(SHUFFLE_SWIPES_TO_COMPLETE)).toBe(1);
    expect(shuffleProgress(99)).toBe(1);
    expect(shuffleProgress(-3)).toBe(0);
  });
});

describe('relógio', () => {
  it('não conta tempo negativo', () => {
    expect(remainingMs(1000, 1500)).toBe(0);
    expect(remainingMs(2000, 1500)).toBe(500);
    expect(remainingMs(null, 1500)).toBeNull();
  });

  it('arredonda para cima: só chega a 00:00 quando o tempo realmente acabou', () => {
    expect(formatSeatClock(8200)).toBe('00:09');
    expect(formatSeatClock(1)).toBe('00:01');
    expect(formatSeatClock(0)).toBe('00:00');
    expect(formatSeatClock(65_000)).toBe('01:05');
  });

  it('vira alerta nos últimos segundos', () => {
    expect(isUrgent(CEREMONY_TIMING.warningMs + 1)).toBe(false);
    expect(isUrgent(CEREMONY_TIMING.warningMs)).toBe(true);
    expect(isUrgent(null)).toBe(false);
  });

  it('só os estágios com ação têm prazo', () => {
    expect(stageDurationMs('shuffle')).toBe(CEREMONY_TIMING.shuffleMs);
    expect(stageDurationMs('cut')).toBe(CEREMONY_TIMING.cutMs);
    expect(stageDurationMs('deal')).toBeNull();
    expect(stageDurationMs('done')).toBeNull();
  });
});
