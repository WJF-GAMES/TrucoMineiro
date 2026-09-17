import type { CountryCode } from 'libphonenumber-js';
import { normalizePhoneNumber } from '@/utils/phone';
import type { AvatarId, ContactMatch, FriendRelation } from '@/domain/model/types';

/**
 * Núcleo puro da sincronização de contatos: normalizar, deduplicar, fatiar em lotes e
 * juntar o que o servidor devolveu com o nome que está salvo no aparelho.
 *
 * Nada aqui importa React, Firebase ou expo-contacts — é onde ficam as regras que os testes
 * cobrem com 10.000 contatos sem precisar de emulador ou de permissão do sistema.
 */

/** Contato como o aparelho entrega (só o que a gente usa). */
export interface DeviceContact {
  id: string;
  name: string;
  /** Todos os números do contato: celular, casa, trabalho... */
  phones: string[];
}

/** Contato já normalizado. O nome NUNCA sai do aparelho. */
export interface NormalizedContact {
  id: string;
  name: string;
  /** Números em E.164, sem repetição, na ordem em que aparecem no contato. */
  phones: string[];
}

export interface NormalizedAgenda {
  contacts: NormalizedContact[];
  /** Lista única de números para enviar ao servidor, na ordem dos índices devolvidos. */
  phones: string[];
  /** Número (índice em `phones`) -> ids de contato que têm aquele número. */
  ownersByPhoneIndex: string[][];
  /** Contatos descartados por não ter nenhum telefone válido. */
  skipped: number;
}

/**
 * Normaliza a agenda inteira de uma vez.
 *
 * Deduplica em dois níveis: dentro do contato (mesmo número salvo como celular e trabalho)
 * e entre contatos (o mesmo número em dois cadastros). O servidor recebe cada número uma só vez.
 */
export function normalizeAgenda(
  contacts: DeviceContact[],
  defaultCountry: CountryCode = 'BR',
  /** Números a ignorar — o do próprio usuário, por exemplo. */
  exclude: readonly string[] = [],
): NormalizedAgenda {
  const excluded = new Set(exclude);
  // Cache por string bruta: em agendas grandes o mesmo formato se repete muito e
  // parsear com libphonenumber é a parte cara do processo.
  const cache = new Map<string, string | null>();
  const phoneIndex = new Map<string, number>();
  const phones: string[] = [];
  const ownersByPhoneIndex: string[][] = [];
  const normalized: NormalizedContact[] = [];
  let skipped = 0;

  for (const contact of contacts) {
    const seen = new Set<string>();
    for (const raw of contact.phones) {
      if (typeof raw !== 'string') continue;
      let e164 = cache.get(raw);
      if (e164 === undefined) {
        e164 = normalizePhoneNumber(raw, defaultCountry);
        cache.set(raw, e164);
      }
      if (!e164 || excluded.has(e164)) continue;
      seen.add(e164);
    }
    if (seen.size === 0) {
      skipped++;
      continue;
    }
    const name = contact.name.trim() || 'Contato';
    const contactPhones = [...seen];
    normalized.push({ id: contact.id, name, phones: contactPhones });
    for (const phone of contactPhones) {
      let index = phoneIndex.get(phone);
      if (index === undefined) {
        index = phones.length;
        phoneIndex.set(phone, index);
        phones.push(phone);
        ownersByPhoneIndex.push([]);
      }
      ownersByPhoneIndex[index]!.push(contact.id);
    }
  }
  return { contacts: normalized, phones, ownersByPhoneIndex, skipped };
}

/** Fatia a lista em lotes — uma requisição por lote, nunca uma por contato. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (size <= 0) throw new Error('chunk size must be positive');
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Contato da agenda que já joga. */
export interface MatchedContact {
  contactId: string;
  /** Nome salvo no aparelho — é o que o usuário reconhece. */
  contactName: string;
  uid: string;
  nickname: string;
  avatarId: AvatarId;
  level: number;
  relation: FriendRelation;
}

/** Contato da agenda que ainda não tem conta. */
export interface UnmatchedContact {
  contactId: string;
  contactName: string;
}

export interface AgendaMatchResult {
  matched: MatchedContact[];
  unmatched: UnmatchedContact[];
}

/**
 * Junta as respostas do servidor (por índice de número) com os contatos locais.
 *
 * O servidor devolve o índice, nunca o telefone: o número só sobe, não volta.
 * Um contato com dois números que apontam para o mesmo jogador aparece uma vez só.
 */
export function mergeMatches(
  agenda: NormalizedAgenda,
  matches: readonly ContactMatch[],
): AgendaMatchResult {
  const nameById = new Map(agenda.contacts.map((c) => [c.id, c.name]));
  const matched: MatchedContact[] = [];
  const seen = new Set<string>(); // contactId + uid
  const matchedContactIds = new Set<string>();

  for (const match of matches) {
    // 'self' é o próprio número do usuário na própria agenda: não é amigo em potencial.
    if (match.relation === 'self') {
      for (const contactId of agenda.ownersByPhoneIndex[match.index] ?? [])
        matchedContactIds.add(contactId);
      continue;
    }
    for (const contactId of agenda.ownersByPhoneIndex[match.index] ?? []) {
      const key = `${contactId}:${match.uid}`;
      if (seen.has(key)) continue;
      seen.add(key);
      matchedContactIds.add(contactId);
      matched.push({
        contactId,
        contactName: nameById.get(contactId) ?? match.nickname,
        uid: match.uid,
        nickname: match.nickname,
        avatarId: match.avatarId,
        level: match.level,
        relation: match.relation,
      });
    }
  }

  const unmatched = agenda.contacts
    .filter((c) => !matchedContactIds.has(c.id))
    .map((c) => ({ contactId: c.id, contactName: c.name }));

  return { matched: sortMatched(matched), unmatched: sortByName(unmatched) };
}

/**
 * Ordem que maximiza utilidade (regra 74): quem já joga e ainda não é amigo primeiro,
 * depois solicitações pendentes, por último quem já é amigo.
 */
const RELATION_ORDER: Record<FriendRelation, number> = {
  none: 0,
  request_received: 1,
  request_sent: 2,
  friend: 3,
  self: 4,
};

export function sortMatched(matched: MatchedContact[]): MatchedContact[] {
  return [...matched].sort(
    (a, b) =>
      RELATION_ORDER[a.relation] - RELATION_ORDER[b.relation] ||
      a.contactName.localeCompare(b.contactName, 'pt-BR'),
  );
}

function sortByName(list: UnmatchedContact[]): UnmatchedContact[] {
  return [...list].sort((a, b) => a.contactName.localeCompare(b.contactName, 'pt-BR'));
}

/**
 * Impressão digital da agenda, para saber se algo mudou sem guardar a agenda em lugar nenhum.
 * Hash de 32 bits (FNV-1a) sobre os números normalizados já ordenados.
 */
export function agendaFingerprint(phones: readonly string[]): string {
  let hash = 0x811c9dc5;
  for (const phone of [...phones].sort()) {
    for (let i = 0; i < phone.length; i++) {
      hash ^= phone.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    hash ^= 0x2c; // separador, para que ["1","23"] e ["12","3"] não colidam
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${phones.length.toString(36)}.${hash.toString(36)}`;
}

/** Filtro local das duas listas (a busca da aba "Meus Amigos" não vai ao servidor). */
export function filterAgenda(result: AgendaMatchResult, query: string): AgendaMatchResult {
  const term = query.trim().toLowerCase();
  if (!term) return result;
  return {
    matched: result.matched.filter(
      (m) => m.contactName.toLowerCase().includes(term) || m.nickname.toLowerCase().includes(term),
    ),
    unmatched: result.unmatched.filter((u) => u.contactName.toLowerCase().includes(term)),
  };
}

/**
 * Aviso discreto depois da sincronização: um só para o lote inteiro, nunca um por amigo.
 * `null` quando não há o que dizer (sincronização automática sem novidade).
 */
export function syncFeedback(connected: number, manual: boolean): string | null {
  if (connected === 1) return '1 contato que já joga foi adicionado aos seus amigos.';
  if (connected > 1) return `${connected} contatos que já jogam foram adicionados aos seus amigos.`;
  return manual ? 'Contatos atualizados.' : null;
}
