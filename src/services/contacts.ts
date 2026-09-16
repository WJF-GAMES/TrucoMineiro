import { Linking, Platform } from 'react-native';
import {
  Contact,
  ContactField,
  addContactsChangeListener,
  getPermissionsAsync,
  requestPermissionsAsync,
  type ContactsPermissionResponse,
} from 'expo-contacts';
import type { DeviceContact } from '@/features/friends/contactsMatch';

/**
 * Acesso à agenda do aparelho.
 *
 * Tudo que sai daqui fica no aparelho: o único dado que o app envia ao servidor são os números
 * normalizados (ver `matchPhoneContacts`). Nome, e-mail, foto e endereço nunca sobem.
 * Por isso a leitura pede só dois campos — nome e telefones — em vez do contato inteiro.
 */

export type ContactsPermission =
  | 'undetermined' // ainda não perguntamos
  | 'granted'
  | 'denied' // negou, mas dá para perguntar de novo
  | 'blocked' // negou definitivamente: só nas configurações do sistema
  | 'restricted'; // controle parental / política do dispositivo

function toPermission(status: ContactsPermissionResponse): ContactsPermission {
  // 'limited' (iOS 18+) é acesso concedido a alguns contatos: para nós é acesso concedido.
  if (status.granted || status.accessPrivileges === 'limited') return 'granted';
  if (status.status === 'undetermined') return 'undetermined';
  // `canAskAgain: false` é o "não perguntar de novo" do Android e o segundo "não" do iOS.
  return status.canAskAgain ? 'denied' : 'blocked';
}

export async function getContactsPermission(): Promise<ContactsPermission> {
  try {
    return toPermission(await getPermissionsAsync());
  } catch {
    return 'restricted';
  }
}

/**
 * Pede a permissão do sistema. Só deve ser chamada depois de a tela explicar o motivo
 * (regra 14: primeiro o benefício, depois o diálogo do sistema).
 */
export async function requestContactsPermission(): Promise<ContactsPermission> {
  try {
    return toPermission(await requestPermissionsAsync());
  } catch {
    return 'restricted';
  }
}

/** Abre a tela de permissões do app (usada quando a permissão está bloqueada). */
export async function openAppSettings(): Promise<void> {
  await Linking.openSettings().catch(() => undefined);
}

export class ContactsReadError extends Error {
  constructor(cause?: unknown) {
    super('Não foi possível ler os contatos do aparelho.');
    this.name = 'ContactsReadError';
    this.cause = cause;
  }
}

/** Contatos por página. Agendas grandes viram várias chamadas curtas à ponte nativa. */
const PAGE_SIZE = 500;
/** Teto de segurança: além disso a agenda deixou de ser uma lista de conhecidos. */
const MAX_CONTACTS = 20_000;

/** Só o que a funcionalidade precisa. Pedir menos campos é mais rápido E mais privado. */
const FIELDS = [ContactField.FULL_NAME, ContactField.PHONES] as const;

/**
 * Lê a agenda em páginas, devolvendo só id, nome e telefones.
 *
 * Pagina de propósito: numa agenda de milhares de contatos, uma leitura única segura a ponte
 * nativa por segundos. Entre as páginas o `await` devolve o controle ao JS, então a tela
 * continua respondendo e o `onProgress` consegue atualizar o feedback.
 */
export async function readDeviceContacts(
  onProgress?: (loaded: number, total: number) => void,
): Promise<DeviceContact[]> {
  try {
    const total = Math.min(await Contact.getCount().catch(() => 0), MAX_CONTACTS);
    const out: DeviceContact[] = [];
    for (let offset = 0; offset < MAX_CONTACTS; offset += PAGE_SIZE) {
      const page = await Contact.getAllDetails(FIELDS, { limit: PAGE_SIZE, offset });
      for (const c of page) {
        const phones = (c.phones ?? [])
          .map((p) => p.number)
          .filter((n): n is string => typeof n === 'string' && n.length > 0);
        // Contato sem telefone não serve nem para encontrar nem para convidar.
        if (phones.length === 0) continue;
        out.push({ id: c.id, name: c.fullName ?? '', phones });
      }
      onProgress?.(Math.min(offset + page.length, total || offset + page.length), total);
      if (page.length < PAGE_SIZE) break;
    }
    return out;
  } catch (e) {
    throw new ContactsReadError(e);
  }
}

/**
 * Números de UM contato, lidos na hora (nada disso fica guardado). Usado para provar ao servidor
 * o vínculo da agenda quando o usuário chama um contato que ainda não é amigo para jogar.
 */
export async function readContactPhones(contactId: string): Promise<string[]> {
  try {
    const phones = await new Contact(contactId).getPhones();
    return phones
      .map((p) => p.number)
      .filter((n): n is string => typeof n === 'string' && n.length > 0);
  } catch (e) {
    throw new ContactsReadError(e);
  }
}

/**
 * Avisa quando a agenda muda, para marcar a sincronização como desatualizada.
 *
 * Só no iOS: no Android o evento vem de um `ContentObserver` que atrasa 5-7 segundos e
 * dispara duas vezes por alteração — ali a atualização fica manual (pull-to-refresh).
 */
export function subscribeContactsChanged(onChange: () => void): () => void {
  if (Platform.OS !== 'ios') return () => undefined;
  try {
    const sub = addContactsChangeListener(onChange);
    return () => sub.remove();
  } catch {
    return () => undefined;
  }
}
