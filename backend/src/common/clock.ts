/** Relógio com deslocamento controlável: os testes avançam o tempo sem fake timers no Prisma. */
let offsetMs = 0;

export const now = (): number => Date.now() + offsetMs;
export const nowDate = (): Date => new Date(now());

export function advanceClock(ms: number) {
  offsetMs += ms;
}

export function resetClock() {
  offsetMs = 0;
}

export const msOf = (d: Date | null | undefined): number | null => (d ? d.getTime() : null);
