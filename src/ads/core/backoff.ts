import { adLog } from '../log';

/** Degraus de retentativa após falha de carregamento. Depois do último, estabiliza em 60s. */
export const BACKOFF_STEPS_MS = [5_000, 15_000, 30_000, 60_000] as const;

/**
 * Agendador de retentativa com backoff exponencial. Existe para que uma falha de rede não vire
 * spam de requisições — o app offline simplesmente fica sem anúncio, em silêncio.
 */
export function createRetry(scope: string, run: () => void) {
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  return {
    schedule() {
      if (timer) return;
      const delay = BACKOFF_STEPS_MS[Math.min(attempt, BACKOFF_STEPS_MS.length - 1)]!;
      attempt += 1;
      adLog(scope, `retry in ${delay / 1000}s (attempt ${attempt})`);
      timer = setTimeout(() => {
        timer = null;
        run();
      }, delay);
    },
    reset() {
      attempt = 0;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
    cancel() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
