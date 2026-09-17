import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  FlatList,
  Platform,
  RefreshControl,
  Share,
  StyleSheet,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Image } from 'expo-image';
import { colors, radius, spacing } from '@/design-system';
import { images } from '@/assets';
import {
  AppText,
  Chips,
  GameHeader,
  MenuGroup,
  MenuItem,
  PillButton,
  PrimaryButton,
  Screen,
  SearchField,
  StateView,
  Surface,
} from '@/components';
import { useAuthStore } from '@/stores/authStore';
import { useProfileStore } from '@/stores/profileStore';
import {
  blockUser,
  cancelFriendRequest,
  createFriendInviteToken,
  createFriendRoom,
  createRoom,
  ApiError,
  inviteFriendToRoom,
  removeFriend,
  respondFriendRequest,
  searchPlayers,
  sendFriendRequest,
} from '@/services/api';
import { flag } from '@/services/firebase/remoteConfig';
import { openAppSettings, readContactPhones } from '@/services/contacts';
import { logEvent } from '@/services/firebase/analytics';
import { NativeAdCard } from '@/ads';
import { toast } from '@/stores/toastStore';
import { countryOf, normalizePhoneNumber } from '@/utils/phone';
import { useFriendRequests, useFriends } from '@/features/friends/useFriends';
import { useContactsSync } from '@/features/friends/useContactsSync';
import { useRoomInvites } from '@/features/friends/useRoomInvites';
import { syncFeedback, type MatchedContact } from '@/features/friends/contactsMatch';
import { buildFriendsDirectory, type DirectoryEntry } from '@/features/friends/friendsDirectory';
import { usePresenceMap } from '@/features/friends/usePresenceMap';
import { isSelectionLocked, toggleFriend } from '@/features/friends/friendSelection';
import type { FriendRequest, Profile, RoomInvite } from '@/domain/model/types';
import type { TabScreenProps } from '@/navigation/types';
import { FriendsQuickActions } from './components/FriendsQuickActions';
import { ContactsPrivacyNote } from './components/ContactsCards';
import { ContactsSyncSheet } from './components/ContactsSyncSheet';
import {
  ContactMatchRow,
  FriendRequestRow,
  FriendRow,
  InviteContactRow,
  RoomInviteRow,
} from './components/Rows';
import { MyQrCodeSheet } from './components/MyQrCodeSheet';
import { AddManuallySheet } from './components/AddManuallySheet';
import { FriendSheet } from './components/FriendSheet';
import { BlockedSheet } from './components/BlockedSheet';
import { FriendSelectionBar } from './components/FriendSelectionBar';

type Tab = 'friends' | 'requests' | 'search';

type SectionAction = { label: string; onPress: () => void; testID: string };

/** Cada linha da FlatList. Seções e cards viajam na mesma lista para nada sair da virtualização. */
type Item =
  | {
      kind: 'section';
      key: string;
      title: string;
      trailing?: string;
      action?: SectionAction;
    }
  | { kind: 'node'; key: string; node: React.ReactNode }
  /** Uma pessoa da lista única: amigo, contato que já joga ou contato para convidar. */
  | { kind: 'person'; key: string; person: DirectoryEntry; first: boolean; last: boolean }
  | { kind: 'room-invite'; key: string; invite: RoomInvite; first: boolean; last: boolean }
  | {
      kind: 'request';
      key: string;
      request: FriendRequest;
      direction: 'incoming' | 'outgoing';
      first: boolean;
      last: boolean;
    }
  | { kind: 'result'; key: string; profile: Profile; first: boolean; last: boolean };

/** Quantos contatos "ainda não jogam" a lista mostra antes do botão "ver mais". */
const INVITE_PAGE = 30;

export function FriendsScreen({ navigation, route }: TabScreenProps<'Friends'>) {
  const user = useAuthStore((s) => s.user);
  const uid = user?.uid;
  const profile = useProfileStore((s) => s.profile);
  const [tab, setTab] = useState<Tab>(route.params?.tab ?? 'friends');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Profile[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [blockedOpen, setBlockedOpen] = useState(false);
  /** Amigo com a ficha aberta. O dado sai sempre da lista ao vivo, não de uma cópia. */
  const [openFriendUid, setOpenFriendUid] = useState<string | null>(null);
  /** Montando uma partida: amigos marcados, na ordem da escolha (ela define os assentos). */
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [creatingRoom, setCreatingRoom] = useState(false);
  const [inviteLimit, setInviteLimit] = useState(INVITE_PAGE);
  const inviteLink = useRef<string | null>(null);
  const friendsEnabled = flag('friends_enabled');

  const { friends, friendIdSet, blockedIds, loading: friendsLoading, error } = useFriends(uid);
  const { incoming, outgoing, pendingToUids, loading: requestsLoading } = useFriendRequests(uid);
  const contacts = useContactsSync(uid, countryOf(user?.phoneNumber), user?.phoneNumber);
  // Desestruturado de propósito: `accept`/`decline` são estáveis e `busy` é primitivo, então o
  // `renderItem` da FlatList não é recriado a cada render (senão as linhas visíveis re-renderizam).
  const {
    invites: roomInvites,
    busy: roomInviteBusy,
    accept: acceptRoomInvite,
    decline: declineRoomInvite,
  } = useRoomInvites(uid, (code) => navigation.navigate('Lobby', { code }));
  const blockedSet = useMemo(() => new Set(blockedIds), [blockedIds]);
  /** Quem me mandou solicitação: a busca oferece "Aceitar" em vez de mandar outra solicitação. */
  const incomingFromUids = useMemo(() => new Set(incoming.map((r) => r.from)), [incoming]);

  // Troca de aba quando a navegação chega com um parâmetro novo (padrão de estado derivado).
  const [prevParamTab, setPrevParamTab] = useState(route.params?.tab);
  if (route.params?.tab !== prevParamTab) {
    setPrevParamTab(route.params?.tab);
    if (route.params?.tab) setTab(route.params.tab);
  }

  useEffect(() => {
    logEvent('friends_screen_viewed');
  }, []);

  const directory = useMemo(
    () =>
      buildFriendsDirectory(friends, contacts.result, tab === 'friends' ? query : '', {
        // A amizade ao vivo decide quem é amigo; o cache da agenda pode estar atrasado.
        friendIds: friendsLoading ? null : friendIdSet,
        blockedIds: blockedSet,
      }),
    [friends, contacts.result, query, tab, friendsLoading, friendIdSet, blockedSet],
  );

  /** Presença dos contatos que já jogam (os amigos já vêm com a deles). */
  const contactPresence = usePresenceMap(
    useMemo(() => directory.players.map((p) => p.contact.uid), [directory.players]),
  );

  /**
   * Sincroniza e avisa, uma vez, quantos contatos viraram amigos. A lista em si se atualiza
   * sozinha: as amizades novas chegam pelo evento de amigos do WebSocket.
   */
  const runSync = useCallback(
    async (manual: boolean) => {
      // Automático sem `force`: com a agenda igual e consulta recente, nem vai ao servidor.
      const outcome = await (manual ? contacts.sync({ force: true }) : contacts.sync());
      if (!outcome) return;
      const message = syncFeedback(outcome.connected, manual);
      if (!message) return;
      if (outcome.connected > 0) toast.success('Amigos da agenda', message);
      else toast.info(message);
    },
    [contacts],
  );

  /**
   * Agenda sempre em dia: toda vez que a tela ganha foco (e quando o app volta ao primeiro plano
   * com ela aberta) a sincronização roda sozinha. Sem permissão, ela mesma pede o diálogo do
   * sistema; se a agenda não mudou, não vai ao servidor. Só no aparelho — a web não tem agenda.
   */
  const syncContacts = useRef(runSync);
  useEffect(() => {
    syncContacts.current = runSync;
  }, [runSync]);
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS === 'web' || !friendsEnabled || !uid) return;
      void syncContacts.current(false);
      const sub = AppState.addEventListener('change', (state) => {
        if (state === 'active') void syncContacts.current(false);
      });
      return () => sub.remove();
    }, [friendsEnabled, uid]),
  );

  const openFriendEntry = useMemo(
    () => friends.find((f) => f.profile.id === openFriendUid) ?? null,
    [friends, openFriendUid],
  );

  // --- Ações ------------------------------------------------------------------

  const ensureInviteLink = useCallback(async () => {
    if (inviteLink.current) return inviteLink.current;
    try {
      const { link } = await createFriendInviteToken();
      inviteLink.current = link;
      return link;
    } catch {
      // Sem link o convite continua valendo: o texto sozinho já leva ao app.
      return null;
    }
  }, []);

  const shareInvite = useCallback(
    async (source: 'banner' | 'contact' | 'shortcut', name?: string) => {
      const link = await ensureInviteLink();
      const hello = name ? `${name.split(' ')[0]}, bora` : 'Bora';
      await Share.share({
        message: link
          ? `${hello} jogar Truco Mineiro comigo? Baixe o app e entre na resenha: ${link}`
          : `${hello} jogar Truco Mineiro comigo? Baixe o app e entre na resenha!`,
      });
      logEvent(source === 'contact' ? 'contact_invite_shared' : 'friend_invite_shared', { source });
    },
    [ensureInviteLink],
  );

  const doSearch = useCallback(async () => {
    const term = query.trim();
    if (term.length < 2) {
      toast.info('Digite pelo menos 2 letras');
      return;
    }
    setSearching(true);
    logEvent('friends_search_used');
    try {
      const found = await searchPlayers(term);
      // Eu mesmo e quem eu bloqueei ficam fora: nenhum dos dois tem ação possível aqui.
      setResults(found.filter((p) => p.id !== uid && !blockedSet.has(p.id)));
    } catch {
      toast.error('Busca falhou', 'Verifique sua conexão e tente de novo.');
    } finally {
      setSearching(false);
    }
  }, [query, uid, blockedSet]);

  const addFriend = useCallback(
    async (targetUid: string, label: string) => {
      setBusy(targetUid);
      try {
        await sendFriendRequest(targetUid);
        logEvent('friend_request_sent');
        // A linha da agenda reflete a mudança na hora, sem re-sincronizar a agenda inteira.
        contacts.setRelation(targetUid, 'request_sent');
        toast.success('Solicitação enviada', `${label} vai receber seu convite.`);
      } catch (e) {
        toast.error('Não foi possível enviar', e instanceof ApiError ? e.message : undefined);
        throw e;
      } finally {
        setBusy(null);
      }
    },
    [contacts],
  );

  /** Aceitar quem já me mandou solicitação: o backend cruza as duas e a amizade sai direto. */
  const acceptFrom = useCallback(
    async (targetUid: string, label: string) => {
      setBusy(targetUid);
      try {
        await sendFriendRequest(targetUid);
        contacts.setRelation(targetUid, 'friend');
        logEvent('friend_request_accepted');
        toast.success('Agora vocês são amigos!', label);
      } catch (e) {
        toast.error('Não deu certo', e instanceof ApiError ? e.message : undefined);
      } finally {
        setBusy(null);
      }
    },
    [contacts],
  );

  const onContactAdd = useCallback(
    async (contact: MatchedContact) => {
      if (contact.relation === 'request_received') {
        await acceptFrom(contact.uid, contact.contactName);
        return;
      }
      await addFriend(contact.uid, contact.contactName).catch(() => undefined);
    },
    [acceptFrom, addFriend],
  );

  const respond = useCallback(
    async (request: FriendRequest, accept: boolean) => {
      setBusy(request.id);
      try {
        await respondFriendRequest(request.id, accept);
        logEvent(accept ? 'friend_request_accepted' : 'friend_request_declined');
        // A agenda mostra a mesma pessoa: a linha lá acompanha a decisão tomada aqui.
        contacts.setRelation(request.from, accept ? 'friend' : 'none');
        toast.success(accept ? 'Agora vocês são amigos!' : 'Solicitação recusada');
      } catch (e) {
        toast.error('Não deu certo', e instanceof ApiError ? e.message : undefined);
      } finally {
        setBusy(null);
      }
    },
    [contacts],
  );

  const cancel = useCallback(
    async (request: FriendRequest) => {
      setBusy(request.id);
      try {
        await cancelFriendRequest(request.to);
        contacts.setRelation(request.to, 'none');
        logEvent('friend_request_cancelled');
        toast.info('Solicitação cancelada');
      } catch (e) {
        toast.error('Não deu certo', e instanceof ApiError ? e.message : undefined);
      } finally {
        setBusy(null);
      }
    },
    [contacts],
  );

  const country = countryOf(user?.phoneNumber);

  /**
   * Sala com amigos: o servidor grava a sala com as vagas reservadas e só então manda os convites
   * (lista + push). Quem não entrar a tempo vira IA.
   */
  const inviteFriends = useCallback(
    async (friendUids: string[]) => {
      if (friendUids.length === 0 || creatingRoom) return;
      setCreatingRoom(true);
      if (friendUids.length === 1) setBusy(friendUids[0]!);
      try {
        const { code } = await createFriendRoom(friendUids);
        logEvent('game_invite_created', { friends: friendUids.length });
        logEvent('game_invite_sent', { friends: friendUids.length });
        logEvent('room_invite_sent', { source: 'friend' });
        setOpenFriendUid(null);
        setSelecting(false);
        setSelected([]);
        toast.success(
          friendUids.length === 1 ? 'Convite enviado' : 'Convites enviados',
          'Quem não entrar a tempo é substituído pela IA.',
        );
        navigation.navigate('Lobby', { code });
      } catch (e) {
        toast.error(
          'Não foi possível convidar',
          e instanceof ApiError ? e.message : undefined,
        );
      } finally {
        setCreatingRoom(false);
        setBusy(null);
      }
    },
    [navigation, creatingRoom],
  );

  const toggleSelected = useCallback((friendUid: string) => {
    setSelected((current) => {
      const { next, limited } = toggleFriend(current, friendUid);
      if (limited) toast.info('Máximo de 3 amigos', 'Desmarque alguém para escolher outro.');
      return next;
    });
  }, []);

  const startSelecting = useCallback(() => {
    setSelected([]);
    setSelecting(true);
    setQuery('');
  }, []);

  /**
   * Cria a sala, chama o jogador e vai para o lobby. `contactId` vem quando é um contato da agenda
   * que ainda não é amigo: os números dele são lidos da agenda agora (nada fica guardado) e o
   * servidor confere com eles o vínculo.
   */
  const playWith = useCallback(
    async (friendUid: string, contactId?: string) => {
      // Amigo: mesma sala dos convites em grupo (vaga reservada, push, IA se não entrar).
      if (!contactId) return inviteFriends([friendUid]);
      setBusy(friendUid);
      try {
        let phones: string[] | undefined;
        if (contactId) {
          const raw = await readContactPhones(contactId);
          phones = [
            ...new Set(
              raw
                .map((n) => normalizePhoneNumber(n, country))
                .filter((n): n is string => Boolean(n)),
            ),
          ].slice(0, 5);
        }
        const { code } = await createRoom();
        await inviteFriendToRoom(friendUid, code, phones);
        logEvent('room_invite_sent', { source: contactId ? 'contact' : 'friend' });
        setOpenFriendUid(null);
        toast.success('Chamado para jogar', 'Ele recebe o convite para a sua sala.');
        navigation.navigate('Lobby', { code });
      } catch (e) {
        toast.error(
          'Não foi possível convidar',
          e instanceof ApiError ? e.message : undefined,
        );
      } finally {
        setBusy(null);
      }
    },
    [navigation, country, inviteFriends],
  );

  const unfriend = useCallback(
    async (friendUid: string, nickname: string) => {
      setBusy(friendUid);
      try {
        await removeFriend(friendUid);
        logEvent('friend_removed');
        contacts.setRelation(friendUid, 'none');
        setOpenFriendUid(null);
        toast.info('Amizade removida', `${nickname} saiu da sua lista.`);
      } catch (e) {
        toast.error('Não deu certo', e instanceof ApiError ? e.message : undefined);
      } finally {
        setBusy(null);
      }
    },
    [contacts],
  );

  const block = useCallback(
    async (targetUid: string, nickname: string) => {
      setBusy(targetUid);
      try {
        await blockUser(targetUid);
        logEvent('friend_blocked');
        contacts.setRelation(targetUid, 'none');
        setOpenFriendUid(null);
        toast.info('Jogador bloqueado', `${nickname} não aparece mais para você.`);
      } catch (e) {
        toast.error('Não deu certo', e instanceof ApiError ? e.message : undefined);
      } finally {
        setBusy(null);
      }
    },
    [contacts],
  );

  const openFriend = useCallback((friendUid: string) => {
    setOpenFriendUid(friendUid);
    logEvent('friend_profile_viewed');
  }, []);

  // --- Montagem da lista ------------------------------------------------------

  const synced = contacts.syncedAt !== null;

  const data = useMemo<Item[]>(() => {
    const items: Item[] = [];
    const pushRows = <T,>(list: T[], make: (item: T, first: boolean, last: boolean) => Item) =>
      list.forEach((entry, i) => items.push(make(entry, i === 0, i === list.length - 1)));

    if (tab === 'requests') {
      // O campo de busca vale nas três abas; aqui ele filtra pelo apelido de quem aparece.
      const term = query.trim().toLowerCase();
      const byName = (r: FriendRequest) =>
        !term ||
        (r.fromNickname ?? '').toLowerCase().includes(term) ||
        (r.toNickname ?? '').toLowerCase().includes(term);
      const incomingShown = incoming.filter(byName);
      const outgoingShown = outgoing.filter(byName);
      if (incomingShown.length === 0 && outgoingShown.length === 0) {
        items.push({
          kind: 'node',
          key: 'requests-empty',
          node: requestsLoading ? (
            // Sem isto a tela pisca "Nenhuma solicitação" antes do primeiro snapshot chegar.
            <StateView kind="loading" compact />
          ) : (
            <StateView
              kind="empty"
              icon="mail-open"
              title={term ? 'Nada com esse nome' : 'Nenhuma solicitação'}
              message={term ? 'Tente outro apelido.' : 'Quando alguém te adicionar, aparece aqui.'}
              compact
            />
          ),
        });
        return items;
      }
      if (incomingShown.length > 0) {
        items.push({
          kind: 'section',
          key: 's-in',
          title: 'Recebidas',
          trailing: `${incomingShown.length}`,
        });
        pushRows(incomingShown, (request, first, last) => ({
          kind: 'request',
          key: `in-${request.id}`,
          request,
          direction: 'incoming',
          first,
          last,
        }));
      }
      if (outgoingShown.length > 0) {
        items.push({
          kind: 'section',
          key: 's-out',
          title: 'Enviadas',
          trailing: `${outgoingShown.length}`,
        });
        pushRows(outgoingShown, (request, first, last) => ({
          kind: 'request',
          key: `out-${request.id}`,
          request,
          direction: 'outgoing',
          first,
          last,
        }));
      }
      return items;
    }

    if (tab === 'search') {
      if (searching) {
        items.push({ kind: 'node', key: 'searching', node: <StateView kind="loading" compact /> });
      } else if (results === null) {
        items.push({
          kind: 'node',
          key: 'search-hint',
          node: (
            <StateView
              kind="empty"
              icon="search"
              title="Buscar jogadores"
              message="Digite um apelido e toque em buscar no teclado."
              actionLabel="Buscar"
              onAction={doSearch}
              compact
            />
          ),
        });
      } else if (results.length === 0) {
        items.push({
          kind: 'node',
          key: 'search-empty',
          node: (
            <StateView
              kind="empty"
              title="Ninguém encontrado"
              message="Confira o apelido e tente de novo."
              compact
            />
          ),
        });
      } else {
        items.push({
          kind: 'section',
          key: 's-results',
          title: 'Resultados',
          trailing: `${results.length}`,
        });
        pushRows(results, (p, first, last) => ({
          kind: 'result',
          key: `r-${p.id}`,
          profile: p,
          first,
          last,
        }));
      }
      return items;
    }

    // --- Aba "Meus Amigos" ---

    // Montando uma partida: só amigos (o convite para a sala é deles), online primeiro.
    // Amigos conectados pela agenda entram aqui como qualquer outro.
    if (selecting) {
      const friendsOnly = [...directory.online, ...directory.offline];
      items.push({
        kind: 'section',
        key: 's-select',
        title: 'Escolha até 3 amigos',
        trailing: `${selected.length}/3`,
      });
      if (friendsOnly.length === 0) {
        items.push({
          kind: 'node',
          key: 'select-empty',
          node: (
            <StateView
              kind="empty"
              icon="people"
              title={query ? 'Nada com esse nome' : 'Nenhum amigo ainda'}
              message="Só amigos podem ser chamados para a sua sala."
              compact
            />
          ),
        });
      }
      pushRows(friendsOnly, (person, first, last) => ({
        kind: 'person',
        key: person.key,
        person,
        first,
        last,
      }));
      return items;
    }

    // Convites de sala vêm primeiro: são o único item da tela com prazo para responder.
    if (roomInvites.length > 0) {
      items.push({
        kind: 'section',
        key: 's-room-invites',
        title: 'Convites para jogar',
        trailing: `${roomInvites.length}`,
      });
      pushRows(roomInvites, (invite, first, last) => ({
        kind: 'room-invite',
        key: `ri-${invite.code}`,
        invite,
        first,
        last,
      }));
    }

    // --- Amigos e agenda em seções: ONLINE → AMIGOS → JÁ JOGAM → CONVIDAR ---
    // Cada pessoa aparece uma vez. Quem está na agenda e tem conta já vira amigo sozinho (a
    // sincronização conecta no servidor); "já jogam" só guarda quem teve a amizade removida ou
    // tem solicitação pendente. Permissão, progresso e erro da agenda vivem no diálogo de
    // "Sincronizar contatos" (atalho no topo).
    const contactsShown = contacts.permission === 'granted' && synced;
    const invites = contactsShown ? directory.invites : [];
    const visibleInvites = invites.slice(0, inviteLimit);
    const friendCount = directory.online.length + directory.offline.length;
    // Atalho para montar a partida com até 3 amigos de uma vez: fica na primeira seção de amigos.
    const selectAction =
      friendCount > 0
        ? { label: 'Jogar com amigos', onPress: startSelecting, testID: 'friends-select-start' }
        : undefined;

    if (contacts.syncing && contacts.permission === 'granted') {
      // Carregamento local: os amigos continuam na tela enquanto a agenda atualiza.
      items.push({
        kind: 'node',
        key: 'contacts-syncing',
        node: (
          <AppText
            variant="small"
            color={colors.textSecondary}
            style={styles.syncing}
            testID="contacts-syncing"
          >
            Atualizando sua agenda...
          </AppText>
        ),
      });
    }

    const pushSection = (
      key: string,
      title: string,
      rows: DirectoryEntry[],
      action?: SectionAction,
    ) => {
      if (rows.length === 0) return;
      items.push({ kind: 'section', key, title, trailing: `${rows.length}`, action });
      pushRows(rows, (person, first, last) => ({
        kind: 'person',
        key: person.key,
        person,
        first,
        last,
      }));
    };

    const empty = friendCount + directory.players.length + invites.length === 0;
    if (error) {
      items.push({
        kind: 'node',
        key: 'friends-error',
        node: <StateView kind="error" message={error} compact />,
      });
    } else if (friendsLoading && empty) {
      items.push({
        kind: 'node',
        key: 'friends-loading',
        node: <StateView kind="loading" compact />,
      });
    } else if (empty) {
      items.push({
        kind: 'section',
        key: 's-people',
        title: contactsShown ? 'Amigos e contatos' : 'Meus amigos',
        trailing: '0',
      });
      items.push({
        kind: 'node',
        key: 'friends-empty',
        node: (
          <StateView
            kind="empty"
            icon="people"
            title={
              query
                ? 'Nada com esse nome'
                : contactsShown
                  ? 'Ninguém por aqui ainda'
                  : 'Nenhum amigo ainda'
            }
            message={
              query
                ? 'Tente outro nome ou apelido.'
                : contactsShown
                  ? 'Chame sua turma: o truco fica melhor com gente conhecida.'
                  : 'Busque jogadores pelo apelido ou encontre sua turma na agenda.'
            }
            actionLabel={query ? undefined : contactsShown ? 'Convidar amigos' : 'Buscar amigos'}
            onAction={
              query
                ? undefined
                : contactsShown
                  ? () => void shareInvite('shortcut')
                  : () => setTab('search')
            }
            compact
          />
        ),
      });
    } else {
      pushSection('s-online', 'Online', directory.online, selectAction);
      pushSection(
        's-friends',
        'Amigos',
        directory.offline,
        directory.online.length === 0 ? selectAction : undefined,
      );
      pushSection('s-players', 'Contatos que já jogam', directory.players);
      if (invites.length > 0) {
        items.push({
          kind: 'section',
          key: 's-invites',
          title: 'Convidar',
          trailing: `${invites.length}`,
        });
        items.push({
          kind: 'node',
          key: 'contacts-privacy',
          node: <ContactsPrivacyNote style={styles.privacy} />,
        });
        pushRows(visibleInvites, (person, first, last) => ({
          kind: 'person',
          key: person.key,
          person,
          first,
          last,
        }));
      }
      if (invites.length > visibleInvites.length) {
        items.push({
          kind: 'node',
          key: 'invite-more',
          node: (
            <PrimaryButton
              label={`Ver mais ${Math.min(INVITE_PAGE, invites.length - visibleInvites.length)} contatos`}
              size="sm"
              onPress={() => setInviteLimit((n) => n + INVITE_PAGE)}
              style={styles.more}
              testID="contacts-more"
            />
          ),
        });
      }
    }

    // Bloqueio precisa de caminho de volta, e o lugar dele é no fim: só interessa a quem foi lá.
    if (blockedIds.length > 0) {
      items.push({
        kind: 'node',
        key: 'blocked-entry',
        node: (
          <MenuGroup style={styles.blocked}>
            <MenuItem
              icon="ban"
              iconColor={colors.dangerSoft}
              title="Jogadores bloqueados"
              value={`${blockedIds.length}`}
              onPress={() => setBlockedOpen(true)}
              testID="friends-blocked"
            />
          </MenuGroup>
        ),
      });
    }
    return items;
  }, [
    tab,
    incoming,
    outgoing,
    requestsLoading,
    searching,
    results,
    doSearch,
    query,
    friendsLoading,
    error,
    synced,
    contacts,
    directory,
    inviteLimit,
    shareInvite,
    roomInvites,
    blockedIds,
    selecting,
    selected.length,
    startSelecting,
  ]);

  const renderItem = useCallback(
    ({ item }: { item: Item }) => {
      switch (item.kind) {
        case 'section':
          return (
            <View style={styles.sectionRow} testID={`section-${item.key}`}>
              <View style={styles.sectionTitleRow}>
                <AppText variant="h3" style={styles.sectionTitle} numberOfLines={1}>
                  {item.title}
                </AppText>
                {item.action && item.trailing ? (
                  <AppText variant="small" color={colors.textSecondary}>
                    {item.trailing}
                  </AppText>
                ) : null}
              </View>
              {item.action ? (
                <PillButton
                  label={item.action.label}
                  onPress={item.action.onPress}
                  testID={item.action.testID}
                />
              ) : item.trailing ? (
                <AppText variant="small" color={colors.textSecondary}>
                  {item.trailing}
                </AppText>
              ) : null}
            </View>
          );
        case 'node':
          return <View>{item.node}</View>;
        case 'person': {
          const person = item.person;
          return (
            <Group first={item.first} last={item.last}>
              {person.kind === 'friend' ? (
                <FriendRow
                  entry={person.entry}
                  contactName={person.contactName}
                  busy={busy === person.entry.profile.id}
                  divider={!item.last}
                  onPlay={playWith}
                  onOpen={openFriend}
                  selection={
                    selecting
                      ? {
                          selected: selected.includes(person.entry.profile.id),
                          locked: isSelectionLocked(selected, person.entry.profile.id),
                          onToggle: toggleSelected,
                        }
                      : undefined
                  }
                />
              ) : person.kind === 'match' ? (
                <ContactMatchRow
                  contact={person.contact}
                  busy={busy === person.contact.uid}
                  divider={!item.last}
                  onAdd={(c) => void onContactAdd(c)}
                  presence={contactPresence[person.contact.uid]}
                  onPlay={(c) => void playWith(c.uid, c.contactId)}
                />
              ) : (
                <InviteContactRow
                  contact={person.contact}
                  divider={!item.last}
                  onInvite={(c) => void shareInvite('contact', c.contactName)}
                />
              )}
            </Group>
          );
        }
        case 'room-invite':
          return (
            <Group first={item.first} last={item.last}>
              <RoomInviteRow
                invite={item.invite}
                busy={roomInviteBusy === item.invite.code}
                divider={!item.last}
                onAccept={(i) => void acceptRoomInvite(i)}
                onDecline={(i) => void declineRoomInvite(i)}
              />
            </Group>
          );
        case 'request':
          return (
            <Group first={item.first} last={item.last}>
              <FriendRequestRow
                request={item.request}
                direction={item.direction}
                busy={busy === item.request.id}
                divider={!item.last}
                onAccept={(r) => void respond(r, true)}
                onReject={(r) => void respond(r, false)}
                onCancel={(r) => void cancel(r)}
              />
            </Group>
          );
        case 'result': {
          const p = item.profile;
          const isFriend = friendIdSet.has(p.id);
          const sent = pendingToUids.has(p.id);
          const received = incomingFromUids.has(p.id);
          return (
            <Group first={item.first} last={item.last}>
              <ContactMatchRow
                contact={{
                  contactId: p.id,
                  contactName: p.nickname,
                  uid: p.id,
                  nickname: p.nickname,
                  avatarId: p.avatarId,
                  level: p.level,
                  relation: isFriend
                    ? 'friend'
                    : received
                      ? 'request_received'
                      : sent
                        ? 'request_sent'
                        : 'none',
                }}
                busy={busy === p.id}
                divider={!item.last}
                onAdd={(c) =>
                  received
                    ? void acceptFrom(c.uid, c.nickname)
                    : void addFriend(c.uid, c.nickname).catch(() => undefined)
                }
              />
            </Group>
          );
        }
      }
    },
    [
      busy,
      playWith,
      openFriend,
      respond,
      cancel,
      onContactAdd,
      shareInvite,
      friendIdSet,
      pendingToUids,
      incomingFromUids,
      acceptFrom,
      addFriend,
      roomInviteBusy,
      acceptRoomInvite,
      declineRoomInvite,
      contactPresence,
      selecting,
      selected,
      toggleSelected,
    ],
  );

  const header = (
    <View>
      <GameHeader variant="title" title="Amigos" />
      <AppText variant="small" center color={colors.textSecondary} style={styles.subtitle}>
        Sua turma, suas partidas.
      </AppText>
      <View style={styles.chips}>
        <Chips<Tab>
          testID="friends-tab"
          options={[
            { key: 'friends', label: 'Meus Amigos' },
            { key: 'requests', label: 'Solicitações', badge: incoming.length },
            { key: 'search', label: 'Buscar' },
          ]}
          value={tab}
          onChange={(t) => {
            setTab(t);
            setQuery('');
            setResults(null);
            setSelecting(false);
            setSelected([]);
          }}
        />
      </View>
      <SearchField
        placeholder={
          tab === 'search'
            ? 'Buscar jogadores por apelido...'
            : tab === 'requests'
              ? 'Filtrar solicitações...'
              : 'Buscar nos amigos e contatos...'
        }
        value={query}
        onChangeText={setQuery}
        onSubmitEditing={tab === 'search' ? doSearch : undefined}
        testID="friends-search"
      />
      {tab === 'friends' ? (
        <>
          <FriendsQuickActions
            actions={[
              {
                key: 'sync',
                icon: contacts.stale ? 'refresh' : 'sync',
                label: synced ? 'Atualizar contatos' : 'Sincronizar contatos',
                onPress: () => setSyncOpen(true),
                loading: contacts.syncing,
                highlight: !synced || contacts.stale,
                testID: 'quick-sync',
              },
              {
                key: 'qr',
                icon: 'qr-code',
                label: 'Meu QR Code',
                onPress: () => setQrOpen(true),
                testID: 'quick-qr',
              },
              {
                key: 'invite',
                icon: 'share-social',
                label: 'Convidar amigos',
                onPress: () => void shareInvite('shortcut'),
                testID: 'quick-invite',
              },
              {
                key: 'manual',
                icon: 'person-add',
                label: 'Adicionar manual',
                onPress: () => setAddOpen(true),
                testID: 'quick-manual',
              },
            ]}
          />
          {/* Banner só quando a agenda ainda não trouxe ninguém: com a lista cheia ele só empurra
              o conteúdo para baixo e repete um CTA que já existe nos atalhos (regra 73). */}
          {contacts.result.matched.length === 0 ? (
            <Surface style={styles.banner} padding={0}>
              <View style={styles.bannerText}>
                <AppText variant="h3">Jogue com seus amigos</AppText>
                <AppText variant="caption" color={colors.textSecondary}>
                  O Truco fica ainda mais divertido com a sua turma!
                </AppText>
                {/* Sem ícone: ao lado da arte sobra pouca largura e "CONVIDAR AMIGOS"
                    quebrava em duas linhas. O texto sozinho já diz o que o botão faz. */}
                <PrimaryButton
                  label="Convidar amigos"
                  size="sm"
                  onPress={() => void shareInvite('banner')}
                  style={styles.bannerCta}
                  testID="friends-invite"
                />
              </View>
              <Image source={images.bannerAmigos} style={styles.bannerImage} contentFit="cover" />
            </Surface>
          ) : null}
        </>
      ) : null}
    </View>
  );

  // A flag desliga a funcionalidade inteira (inclusive os atalhos): sem ela, tudo aqui depende de
  // rotas de amigos do backend que também estariam desligadas.
  if (!friendsEnabled) {
    return (
      <Screen withTabBar testID="screen-friends">
        <GameHeader variant="title" title="Amigos" />
        <StateView
          kind="empty"
          icon="people"
          title="Amigos indisponível"
          message="Estamos ajustando essa parte do app. Tente de novo mais tarde."
          testID="friends-disabled"
        />
      </Screen>
    );
  }

  return (
    <Screen withTabBar testID="screen-friends" contentStyle={styles.screen}>
      <FlatList
        data={data}
        keyExtractor={(item) => item.key}
        renderItem={renderItem}
        ListHeaderComponent={header}
        // Rodapé da lista: nunca entre o nome de um contato e o botão de adicionar.
        ListFooterComponent={<NativeAdCard placement="friends_native_footer" />}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        // Agendas grandes: a virtualização precisa ser agressiva para a rolagem não travar.
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        windowSize={9}
        removeClippedSubviews
        refreshControl={
          !selecting && tab === 'friends' && contacts.permission === 'granted' && synced ? (
            <RefreshControl
              refreshing={contacts.syncing}
              onRefresh={() => void runSync(true)}
              tintColor={colors.primaryBright}
              colors={[colors.primary]}
              progressBackgroundColor={colors.cardSolid}
            />
          ) : undefined
        }
      />
      {selecting && tab === 'friends' ? (
        <FriendSelectionBar
          count={selected.length}
          busy={creatingRoom}
          onConfirm={() => void inviteFriends(selected)}
          onCancel={() => {
            setSelecting(false);
            setSelected([]);
          }}
        />
      ) : null}
      <ContactsSyncSheet
        visible={syncOpen}
        onClose={() => setSyncOpen(false)}
        permission={contacts.permission}
        syncing={contacts.syncing}
        progress={contacts.progress}
        error={contacts.error}
        matchCount={synced ? contacts.result.matched.length : null}
        onSync={() => void runSync(true)}
        onOpenSettings={() => {
          void openAppSettings();
          // Ao voltar das configurações a permissão pode ter mudado.
          setTimeout(() => void contacts.refreshPermission(), 1200);
        }}
      />
      <MyQrCodeSheet
        visible={qrOpen}
        onClose={() => setQrOpen(false)}
        nickname={profile?.nickname ?? ''}
      />
      <AddManuallySheet
        visible={addOpen}
        onClose={() => setAddOpen(false)}
        onAdd={(targetUid, nickname) => addFriend(targetUid, nickname)}
      />
      <FriendSheet
        entry={openFriendEntry}
        busy={busy === openFriendUid}
        onClose={() => setOpenFriendUid(null)}
        onPlay={(friendUid) => void playWith(friendUid)}
        onRemove={(friendUid, nickname) => void unfriend(friendUid, nickname)}
        onBlock={(friendUid, nickname) => void block(friendUid, nickname)}
      />
      <BlockedSheet
        visible={blockedOpen}
        onClose={() => setBlockedOpen(false)}
        blockedIds={blockedIds}
      />
    </Screen>
  );
}

/** Reproduz o card translúcido do Design System em linhas que vivem dentro da FlatList. */
function Group({
  first,
  last,
  children,
}: {
  first: boolean;
  last: boolean;
  children: React.ReactNode;
}) {
  return (
    <View style={[styles.group, first && styles.groupFirst, last && styles.groupLast]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { paddingHorizontal: 0 },
  list: { paddingHorizontal: spacing.screen, paddingBottom: spacing.xl },
  subtitle: { marginTop: -spacing.xs, marginBottom: spacing.md },
  chips: { marginBottom: spacing.md },
  banner: { flexDirection: 'row', marginTop: spacing.md, overflow: 'hidden', minHeight: 128 },
  // O texto leva a maior fatia: o CTA tem ícone + rótulo em caixa alta e quebrava em duas
  // linhas quando a coluna era só um pouco maior que a da arte.
  bannerText: { flex: 1.45, padding: 12, justifyContent: 'center' },
  bannerCta: { marginTop: 10, alignSelf: 'stretch' },
  bannerImage: { flex: 1, height: '100%' },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  sectionTitle: { fontSize: 17, flexShrink: 1 },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
    marginRight: spacing.sm,
  },
  privacy: { marginBottom: spacing.sm },
  syncing: { marginBottom: spacing.sm },
  more: { marginTop: spacing.md, alignSelf: 'center', minWidth: 220 },
  blocked: { marginTop: spacing.lg },
  group: {
    backgroundColor: colors.card,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: colors.cardBorder,
  },
  groupFirst: {
    borderTopWidth: 1,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
  },
  groupLast: {
    borderBottomWidth: 1,
    borderBottomLeftRadius: radius.card,
    borderBottomRightRadius: radius.card,
  },
});
