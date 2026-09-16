import type { FriendEntry } from './useFriends';
import type { AgendaMatchResult, MatchedContact, UnmatchedContact } from './contactsMatch';

/**
 * A lista única da aba "Meus Amigos": amigos e contatos da agenda numa só listagem.
 *
 * Cada pessoa aparece uma vez. Um contato que já é amigo vira a linha do amigo (com o nome da
 * agenda junto, que é como o usuário reconhece a pessoa); vários contatos com o mesmo jogador
 * viram uma linha só. A ordem segue a utilidade: amigos (a lista já chega com online primeiro),
 * depois quem joga e ainda não é amigo, por último quem ainda não joga.
 */
export type DirectoryEntry =
  | { kind: 'friend'; key: string; entry: FriendEntry; contactName: string | null }
  | { kind: 'match'; key: string; contact: MatchedContact }
  | { kind: 'invite'; key: string; contact: UnmatchedContact };

export interface FriendsDirectory {
  /** Amigos + contatos que já jogam, na ordem de exibição. */
  people: DirectoryEntry[];
  /** Contatos que ainda não jogam (a tela pagina estes). */
  invites: DirectoryEntry[];
  /** Total de pessoas na lista (para o contador do título). */
  total: number;
}

const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

export function buildFriendsDirectory(
  friends: readonly FriendEntry[],
  agenda: AgendaMatchResult | null,
  query = '',
): FriendsDirectory {
  const term = norm(query);
  const matches = (...names: (string | null | undefined)[]) =>
    !term || names.some((n) => n && norm(n).includes(term));

  const friendIds = new Set(friends.map((f) => f.profile.id));
  /** Nome da agenda de cada amigo (o primeiro contato encontrado). */
  const contactNameByUid = new Map<string, string>();
  const matchedByUid = new Map<string, MatchedContact>();
  for (const m of agenda?.matched ?? []) {
    if (m.relation === 'self') continue;
    if (friendIds.has(m.uid) || m.relation === 'friend') {
      if (!contactNameByUid.has(m.uid)) contactNameByUid.set(m.uid, m.contactName);
      continue;
    }
    // Dois contatos com o mesmo jogador: uma linha só (a lista chega ordenada por relação).
    if (!matchedByUid.has(m.uid)) matchedByUid.set(m.uid, m);
  }

  const people: DirectoryEntry[] = [];
  for (const entry of friends) {
    const contactName = contactNameByUid.get(entry.profile.id) ?? null;
    if (!matches(entry.profile.nickname, contactName)) continue;
    people.push({ kind: 'friend', key: `f-${entry.profile.id}`, entry, contactName });
  }
  for (const contact of matchedByUid.values()) {
    if (!matches(contact.contactName, contact.nickname)) continue;
    people.push({ kind: 'match', key: `m-${contact.uid}`, contact });
  }

  const invites: DirectoryEntry[] = (agenda?.unmatched ?? [])
    .filter((c) => matches(c.contactName))
    .map((contact) => ({ kind: 'invite', key: `i-${contact.contactId}`, contact }));

  return { people, invites, total: people.length + invites.length };
}
