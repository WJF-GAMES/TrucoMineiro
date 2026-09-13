import { adLog } from '../log';

/**
 * Teto para a espera do fechamento de um anúncio full-screen.
 *
 * Se o SDK não emitir `CLOSED` (crash do processo do anúncio, evento perdido), a promessa ficaria
 * pendurada para sempre e `isFullScreenAdShowing` travaria em `true` — o que bloquearia **todos**
 * os anúncios seguintes. Este teto garante que o estado sempre volte ao normal.
 */
export const FULL_SCREEN_CLOSE_TIMEOUT_MS = 3 * 60 * 1000;

export function withCloseTimeout(promise: Promise<void>, scope: string): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      adLog(scope, 'close event não chegou — liberando o estado por segurança');
      resolve();
    }, FULL_SCREEN_CLOSE_TIMEOUT_MS);
    promise.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      () => {
        clearTimeout(timer);
        resolve();
      },
    );
  });
}
