import { useEffect } from 'react';
import { AppState } from 'react-native';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { devLog } from '@/utils/devLog';

const TAG = 'truco-match';

/**
 * Tela acesa durante a partida: enquanto `active`, o aparelho não bloqueia por inatividade
 * (o jogador pode estar só olhando a mesa e o relógio da vez). Fora da partida — resultado, Home,
 * mesa desmontada — o comportamento normal do sistema volta.
 *
 * Em background o sistema decide; ao voltar para o app a trava é reaplicada se a partida continua.
 */
export function useMatchKeepAwake(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const activate = () =>
      activateKeepAwakeAsync(TAG).catch((e) => devLog('KEEP_AWAKE', 'indisponível', String(e)));
    void activate();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void activate();
    });
    return () => {
      sub.remove();
      deactivateKeepAwake(TAG).catch(() => undefined);
    };
  }, [active]);
}
