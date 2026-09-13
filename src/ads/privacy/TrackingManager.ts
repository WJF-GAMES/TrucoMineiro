import { Platform } from 'react-native';
import { adLog } from '../log';

/**
 * App Tracking Transparency (iOS).
 *
 * O prompt do ATT depende de um módulo nativo que ainda **não** faz parte do projeto
 * (`expo-tracking-transparency`) e de validação em macOS — ver a pendência em
 * `docs/ADMOB_MONETIZATION.md`. Para não deixar o resto do módulo esperando por isso, o serviço
 * existe com um provider plugável: quando o pacote entrar, basta registrar o provider no boot e
 * nada mais muda.
 *
 * Regras que já valem: o app nunca é bloqueado se o usuário recusar, e o prompt nunca sobe no
 * primeiro frame — quem chama decide o momento, depois de um contexto explicativo.
 */

export type TrackingStatus = 'unavailable' | 'not_determined' | 'denied' | 'authorized' | 'restricted';

export interface TrackingProvider {
  getStatus: () => Promise<TrackingStatus>;
  request: () => Promise<TrackingStatus>;
}

let provider: TrackingProvider | null = null;

export function setTrackingProvider(next: TrackingProvider | null) {
  provider = next;
}

export const TrackingManager = {
  /** ATT só existe no iOS; no Android a resposta é sempre `unavailable`. */
  isSupported(): boolean {
    return Platform.OS === 'ios' && provider !== null;
  },

  async getTrackingStatus(): Promise<TrackingStatus> {
    if (!TrackingManager.isSupported() || !provider) return 'unavailable';
    try {
      return await provider.getStatus();
    } catch {
      return 'unavailable';
    }
  },

  /**
   * Só deve ser chamado depois de o usuário ver a tela de contexto. Recusa não desliga nada:
   * o app segue funcionando e os anúncios passam a ser não personalizados.
   */
  async requestTrackingPermission(): Promise<TrackingStatus> {
    if (!TrackingManager.isSupported() || !provider) return 'unavailable';
    try {
      const status = await provider.request();
      adLog('Tracking', `status=${status}`);
      return status;
    } catch {
      return 'unavailable';
    }
  },
};
