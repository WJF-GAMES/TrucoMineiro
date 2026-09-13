import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AgendaMatchResult } from './contactsMatch';

/**
 * Cache local da última sincronização.
 *
 * O que NÃO é guardado: nenhum telefone, em lugar nenhum. Só ficam no disco o nome que já
 * estava na agenda do próprio aparelho, o uid público de quem deu match, o horário da
 * sincronização e a impressão digital dos números (um hash de 32 bits, do qual não dá
 * para voltar aos números). Assim a tela abre instantânea sem reler a agenda — e sem virar
 * uma segunda cópia da agenda (regra 22).
 */

const KEY = 'trucox.contacts.sync.v1';
/** Depois disso a sincronização é considerada velha e a tela oferece atualizar. */
export const SYNC_STALE_MS = 7 * 86_400_000;

export interface ContactsSyncCache {
  syncedAt: number;
  /** Hash dos números normalizados — muda quando a agenda muda. */
  fingerprint: string;
  /** Quantos contatos com telefone foram considerados. */
  contactCount: number;
  result: AgendaMatchResult;
}

/** A chave do cache inclui o uid: trocar de conta no mesmo aparelho não herda o resultado. */
const keyFor = (uid: string) => `${KEY}.${uid}`;

export async function loadContactsSync(uid: string): Promise<ContactsSyncCache | null> {
  try {
    const raw = await AsyncStorage.getItem(keyFor(uid));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ContactsSyncCache;
    if (!parsed?.result?.matched || !parsed.result.unmatched) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function saveContactsSync(uid: string, cache: ContactsSyncCache): Promise<void> {
  try {
    await AsyncStorage.setItem(keyFor(uid), JSON.stringify(cache));
  } catch {
    // Cache é otimização: se o disco falhar, a tela só sincroniza de novo.
  }
}

/**
 * Quem estiver mostrando o resultado precisa saber que ele foi apagado.
 * A tela Amigos é uma aba que continua montada enquanto o usuário vai em Configurações,
 * então sem este aviso ela seguiria exibindo contatos que o cache não tem mais.
 */
const listeners = new Set<(uid: string) => void>();

export function onContactsSyncCleared(listener: (uid: string) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export async function clearContactsSync(uid: string): Promise<void> {
  await AsyncStorage.removeItem(keyFor(uid)).catch(() => undefined);
  listeners.forEach((l) => l(uid));
}

export function isStale(cache: ContactsSyncCache | null, now = Date.now()): boolean {
  return !cache || now - cache.syncedAt > SYNC_STALE_MS;
}
