import type { FriendEntry } from './useFriends';
import type { AgendaMatchResult, MatchedContact, UnmatchedContact } from './contactsMatch';

/**
 * A lista da aba "Meus Amigos": amigos e contatos da agenda, sem repetir ninguém.
 *
 * Seções, nesta ordem:
 *   ONLINE    amigos online ou em partida;
 *   AMIGOS    amigos offline (manuais e conectados pela agenda, sem diferença visual);
 *   JÁ JOGAM  contatos com conta que NÃO viraram amigos automaticamente — só sobra quem teve a
 *             amizade removida (a agenda não reconecta) ou tem solicitação pendente;
 *   CONVIDAR  contatos da agenda sem conta.
 *
 * Cada pessoa aparece uma vez. Um contato que é amigo vira a linha do amigo (com o nome da
 * agenda como detalhe); vários contatos com o mesmo jogador viram uma linha só.
 *
 * A amizade vale pelo que o backend diz AGORA (`friendIds`), não pelo que o cache da agenda
 * lembrava: um contato marcado como "amigo" no cache mas que não é mais (a outra pessoa removeu)
 * volta para "já jogam" em vez de sumir das duas listas.
 */
export type DirectoryEntry =
  | { kind: 'friend'; key: string; entry: FriendEntry; contactName: string | null }
  | { kind: 'match'; key: string; contact: MatchedContact }
  | { kind: 'invite'; key: string; contact: UnmatchedContact };

type FriendDirectoryEntry = Extract<DirectoryEntry, { kind: 'friend' }>;
type MatchDirectoryEntry = Extract<DirectoryEntry, { kind: 'match' }>;
type InviteDirectoryEntry = Extract<DirectoryEntry, { kind: 'invite' }>;

export interface FriendsDirectory {
  online: FriendDirectoryEntry[];
  /** Amigos offline. */
  offline: FriendDirectoryEntry[];
  /** Contatos que jogam e não são amigos (removidos ou com solicitação pendente). */
  players: MatchDirectoryEntry[];
  /** Contatos que ainda não jogam (a tela pagina estes). */
  invites: InviteDirectoryEntry[];
  /** online + offline + players, na ordem de exibição. */
  people: DirectoryEntry[];
  /** Total de pessoas na lista (para o contador do título). */
  total: number;
}

export interface DirectoryOptions {
  /**
   * Ids de amizade ao vivo (inclui quem ainda está com o perfil carregando).
   * `null` enquanto a primeira leitura não chegou.
   */
  friendIds?: ReadonlySet<string> | null;
  /** Quem o usuário bloqueou: não aparece em lugar nenhum da agenda. */
  blockedIds?: ReadonlySet<string>;
}

const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

export function buildFriendsDirectory(
  friends: readonly FriendEntry[],
  agenda: AgendaMatchResult | null,
  query = '',
  options: DirectoryOptions = {},
): FriendsDirectory {
  const term = norm(query);
  const matches = (...names: (string | null | undefined)[]) =>
    !term || names.some((n) => n && norm(n).includes(term));

  const shownFriendIds = new Set(friends.map((f) => f.profile.id));
  const liveFriendIds = options.friendIds === undefined ? shownFriendIds : options.friendIds;
  const blocked = options.blockedIds;
  /** Nome da agenda de cada amigo (o primeiro contato encontrado). */
  const contactNameByUid = new Map<string, string>();
  const matchedByUid = new Map<string, MatchedContact>();
  for (const m of agenda?.matched ?? []) {
    if (m.relation === 'self' || blocked?.has(m.uid)) continue;
    if (shownFriendIds.has(m.uid)) {
      if (!contactNameByUid.has(m.uid)) contactNameByUid.set(m.uid, m.contactName);
      continue;
    }
    // Amizade ainda carregando (lista ou perfil): a linha do amigo aparece em instantes.
    if (liveFriendIds === null || liveFriendIds.has(m.uid)) continue;
    // O cache dizia "amigo", mas a amizade não existe mais: volta a ser um jogador da agenda.
    const contact: MatchedContact = m.relation === 'friend' ? { ...m, relation: 'none' } : m;
    // Dois contatos com o mesmo jogador: uma linha só (a lista chega ordenada por relação).
    if (!matchedByUid.has(m.uid)) matchedByUid.set(m.uid, contact);
  }

  const online: FriendDirectoryEntry[] = [];
  const offline: FriendDirectoryEntry[] = [];
  for (const entry of friends) {
    if (blocked?.has(entry.profile.id)) continue;
    const contactName = contactNameByUid.get(entry.profile.id) ?? null;
    if (!matches(entry.profile.nickname, contactName)) continue;
    const row: FriendDirectoryEntry = {
      kind: 'friend',
      key: `f-${entry.profile.id}`,
      entry,
      contactName,
    };
    // `friends` já chega ordenado: online → em partida → offline, e A-Z dentro de cada grupo.
    if ((entry.presence?.state ?? 'offline') === 'offline') offline.push(row);
    else online.push(row);
  }

  const players: MatchDirectoryEntry[] = [];
  for (const contact of matchedByUid.values()) {
    if (!matches(contact.contactName, contact.nickname)) continue;
    players.push({ kind: 'match', key: `m-${contact.uid}`, contact });
  }

  const invites: InviteDirectoryEntry[] = (agenda?.unmatched ?? [])
    .filter((c) => matches(c.contactName))
    .map((contact) => ({ kind: 'invite', key: `i-${contact.contactId}`, contact }));

  const people: DirectoryEntry[] = [...online, ...offline, ...players];
  return { online, offline, players, invites, people, total: people.length + invites.length };
}
