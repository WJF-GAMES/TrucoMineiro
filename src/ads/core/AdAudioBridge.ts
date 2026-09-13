import mobileAds from 'react-native-google-mobile-ads';
import { useSettingsStore } from '@/stores/settingsStore';
import { adLog } from '../log';

/**
 * Áudio durante anúncios full-screen.
 *
 * Duas responsabilidades:
 *  1. informar ao SDK o estado de som do app (quem jogou no mudo não leva vídeo com áudio);
 *  2. pausar/retomar qualquer som contínuo do jogo.
 *
 * O app ainda não toca música de fundo, então (2) hoje não tem nada para pausar — mas o ponto de
 * plugue já existe, para quando o áudio entrar não haver caça a chamadas espalhadas. A retomada
 * nunca "liga" o som: ela restaura exatamente o estado anterior.
 */

export interface AudioSink {
  pause: () => void;
  resume: () => void;
}

const sinks = new Set<AudioSink>();

export function registerAudioSink(sink: AudioSink): () => void {
  sinks.add(sink);
  return () => {
    sinks.delete(sink);
  };
}

function applySdkVolume(muted: boolean) {
  try {
    mobileAds().setAppMuted(muted);
    mobileAds().setAppVolume(muted ? 0 : 1);
  } catch (e) {
    adLog('Audio', 'setAppMuted failed', e);
  }
}

export const AdAudioBridge = {
  /** Reflete a preferência de som do usuário no SDK (chamado no boot e quando a preferência muda). */
  syncUserPreference() {
    applySdkVolume(!useSettingsStore.getState().sound);
  },

  onFullScreenAdOpened() {
    sinks.forEach((s) => {
      try {
        s.pause();
      } catch {
        // Um sink quebrado não pode impedir o anúncio de abrir.
      }
    });
    applySdkVolume(!useSettingsStore.getState().sound);
  },

  onFullScreenAdClosed() {
    sinks.forEach((s) => {
      try {
        s.resume();
      } catch {
        // idem
      }
    });
  },
};
