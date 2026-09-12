import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, Share, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, radius, spacing } from '@/design-system';
import { images } from '@/assets';
import {
  AppText,
  Chips,
  GameHeader,
  PillButton,
  PlayerAvatar,
  PrimaryButton,
  Screen,
  SearchField,
  StateView,
  Surface,
} from '@/components';
import { useAuthStore } from '@/stores/authStore';
import {
  getProfile,
  searchProfiles,
  subscribeFriends,
  subscribeIncomingRequests,
} from '@/services/firebase/firestore';
import { subscribePresence } from '@/services/firebase/rtdb';
import {
  respondFriendRequest,
  sendFriendRequest,
  removeFriend,
  createRoom,
  inviteFriendToRoom,
  FunctionsError,
} from '@/services/firebase/functions';
import type { FriendRequest, Presence, Profile } from '@/domain/model/types';
import { toast } from '@/stores/toastStore';
import { logEvent } from '@/services/firebase/analytics';
import type { TabScreenProps } from '@/navigation/types';

type Tab = 'friends' | 'requests' | 'search';

interface FriendRow {
  profile: Profile;
  presence: Presence | null;
}

const STATUS_LABEL = { online: 'Online', in_match: 'Na partida', offline: 'Offline' } as const;

export function FriendsScreen({ navigation, route }: TabScreenProps<'Friends'>) {
  const uid = useAuthStore((s) => s.user?.uid);
  const [tab, setTab] = useState<Tab>(route.params?.tab ?? 'friends');
  const [friendIds, setFriendIds] = useState<string[] | null>(null);
  const [friends, setFriends] = useState<Record<string, FriendRow>>({});
  const [requests, setRequests] = useState<FriendRequest[]>([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Profile[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Adjust the selected tab when navigated with a new param (derived-state pattern).
  const [prevParamTab, setPrevParamTab] = useState(route.params?.tab);
  if (route.params?.tab !== prevParamTab) {
    setPrevParamTab(route.params?.tab);
    if (route.params?.tab) setTab(route.params.tab);
  }

  useEffect(() => {
    if (!uid) return;
    const unsubF = subscribeFriends(
      uid,
      (list) => setFriendIds(list.map((f) => f.id)),
      (e) => setError(e.message),
    );
    const unsubR = subscribeIncomingRequests(uid, setRequests);
    return () => {
      unsubF();
      unsubR();
    };
  }, [uid]);

  useEffect(() => {
    if (!friendIds) return;
    const unsubs: (() => void)[] = [];
    friendIds.forEach((id) => {
      getProfile(id).then((p) => {
        if (!p) return;
        setFriends((prev) => ({
          ...prev,
          [id]: { profile: p, presence: prev[id]?.presence ?? null },
        }));
      });
      unsubs.push(
        subscribePresence(id, (presence) =>
          setFriends((prev) => (prev[id] ? { ...prev, [id]: { ...prev[id]!, presence } } : prev)),
        ),
      );
    });
    return () => unsubs.forEach((u) => u());
  }, [friendIds]);

  const rows = useMemo(
    () =>
      (friendIds ?? [])
        .map((id) => friends[id])
        .filter((r): r is FriendRow => Boolean(r))
        .filter((r) =>
          tab === 'friends' && query
            ? r.profile.nickname.toLowerCase().includes(query.toLowerCase())
            : true,
        )
        .sort((a, b) => rank(a.presence) - rank(b.presence)),
    [friendIds, friends, query, tab],
  );

  const doSearch = async () => {
    setSearching(true);
    try {
      const r = await searchProfiles(query);
      setResults(r.filter((p) => p.id !== uid));
    } catch (e) {
      toast.error('Busca falhou', (e as Error).message);
    } finally {
      setSearching(false);
    }
  };

  const invite = async () => {
    try {
      const { code } = await createRoom();
      logEvent('room_created', { source: 'friends' });
      await Share.share({
        message: `Bora um truco? Entre na minha sala no Truco Mineiro com o código ${code}`,
      });
      navigation.navigate('Lobby', { code });
    } catch (e) {
      toast.error(
        'Não foi possível criar a sala',
        e instanceof FunctionsError ? e.message : undefined,
      );
    }
  };

  const playWith = async (friendUid: string) => {
    setBusy(friendUid);
    try {
      const { code } = await createRoom();
      await inviteFriendToRoom(friendUid, code);
      toast.success('Convite enviado', 'Seu amigo receberá o código da sala.');
      navigation.navigate('Lobby', { code });
    } catch (e) {
      toast.error('Não foi possível convidar', e instanceof FunctionsError ? e.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  const request = async (toUid: string) => {
    setBusy(toUid);
    try {
      await sendFriendRequest(toUid);
      logEvent('friend_request_sent');
      toast.success('Solicitação enviada');
    } catch (e) {
      toast.error('Não foi possível enviar', e instanceof FunctionsError ? e.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  const respond = async (req: FriendRequest, accept: boolean) => {
    setBusy(req.id);
    try {
      await respondFriendRequest(req.id, accept);
      toast.success(accept ? 'Agora vocês são amigos!' : 'Solicitação recusada');
    } catch (e) {
      toast.error('Não deu certo', e instanceof FunctionsError ? e.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen scroll testID="screen-friends">
      <GameHeader variant="title" title="Amigos" />
      <View style={styles.chips}>
        <Chips<Tab>
          testID="friends-tab"
          options={[
            { key: 'friends', label: 'Meus Amigos' },
            { key: 'requests', label: 'Solicitações', badge: requests.length },
            { key: 'search', label: 'Buscar' },
          ]}
          value={tab}
          onChange={setTab}
        />
      </View>

      <SearchField
        placeholder="Buscar por nome ou número..."
        value={query}
        onChangeText={setQuery}
        onSubmitEditing={tab === 'search' ? doSearch : undefined}
        testID="friends-search"
      />

      {tab === 'friends' ? (
        <>
          <Surface style={styles.banner} padding={0}>
            <View style={styles.bannerText}>
              <AppText variant="h3">Jogue com seus amigos</AppText>
              <AppText variant="caption" color={colors.textSecondary}>
                Chame sua turma e faça aquela resenha!
              </AppText>
              <PrimaryButton
                label="Convidar amigos"
                icon="share-social"
                size="sm"
                onPress={invite}
                style={styles.bannerCta}
                testID="friends-invite"
              />
            </View>
            <Image source={images.bannerAmigos} style={styles.bannerImage} contentFit="cover" />
          </Surface>

          <AppText variant="h3" style={styles.section}>
            Meus Amigos ({friendIds?.length ?? 0})
          </AppText>
          {error ? (
            <StateView kind="error" message={error} compact />
          ) : friendIds === null ? (
            <StateView kind="loading" compact />
          ) : rows.length === 0 ? (
            <StateView
              kind="empty"
              title="Nenhum amigo ainda"
              message="Busque jogadores pelo apelido ou convide sua turma."
              actionLabel="Buscar amigos"
              onAction={() => setTab('search')}
              compact
            />
          ) : (
            <Surface padding={0}>
              {rows.map((r, i) => {
                const st = r.presence?.state ?? 'offline';
                return (
                  <View
                    key={r.profile.id}
                    style={[styles.friendRow, i < rows.length - 1 && styles.divider]}
                  >
                    <PlayerAvatar
                      avatarId={r.profile.avatarId}
                      size={50}
                      status={st}
                      badge="coin"
                    />
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <AppText variant="h3" numberOfLines={1}>
                        {r.profile.nickname}
                      </AppText>
                      <View style={styles.statusRow}>
                        <AppText
                          variant="small"
                          color={
                            st === 'online'
                              ? colors.online
                              : st === 'in_match'
                                ? colors.textSecondary
                                : colors.textMuted
                          }
                        >
                          {STATUS_LABEL[st]}
                        </AppText>
                        <View
                          style={[
                            styles.dot,
                            {
                              backgroundColor:
                                st === 'online'
                                  ? colors.online
                                  : st === 'in_match'
                                    ? colors.away
                                    : colors.offline,
                            },
                          ]}
                        />
                      </View>
                    </View>
                    {st === 'online' ? (
                      <PillButton
                        label="Jogar"
                        onPress={() => playWith(r.profile.id)}
                        disabled={busy === r.profile.id}
                      />
                    ) : st === 'in_match' ? (
                      <PillButton
                        label="Assistir"
                        variant="muted"
                        onPress={() =>
                          toast.info('Em breve', 'Assistir partidas chega na próxima versão.')
                        }
                      />
                    ) : (
                      <PillButton
                        label="Convidar"
                        onPress={() => playWith(r.profile.id)}
                        disabled={busy === r.profile.id}
                      />
                    )}
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Mais opções"
                      hitSlop={8}
                      onPress={() =>
                        removeFriend(r.profile.id)
                          .then(() => toast.info('Amigo removido'))
                          .catch(() => toast.error('Não deu certo'))
                      }
                      style={styles.more}
                    >
                      <Ionicons name="ellipsis-vertical" size={20} color={colors.text} />
                    </Pressable>
                  </View>
                );
              })}
            </Surface>
          )}
        </>
      ) : tab === 'requests' ? (
        <View style={styles.section}>
          {requests.length === 0 ? (
            <StateView
              kind="empty"
              title="Nenhuma solicitação"
              message="Quando alguém te adicionar, aparece aqui."
              compact
            />
          ) : (
            <Surface padding={0}>
              {requests.map((req, i) => (
                <View
                  key={req.id}
                  style={[styles.friendRow, i < requests.length - 1 && styles.divider]}
                >
                  <PlayerAvatar avatarId={req.fromAvatarId} size={50} />
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <AppText variant="h3" numberOfLines={1}>
                      {req.fromNickname}
                    </AppText>
                    <AppText variant="small" color={colors.textSecondary}>
                      quer ser seu amigo
                    </AppText>
                  </View>
                  <PillButton
                    label="Aceitar"
                    onPress={() => respond(req, true)}
                    disabled={busy === req.id}
                  />
                  <PillButton
                    label="Recusar"
                    variant="muted"
                    onPress={() => respond(req, false)}
                    disabled={busy === req.id}
                    style={{ marginLeft: 6 }}
                  />
                </View>
              ))}
            </Surface>
          )}
        </View>
      ) : (
        <View style={styles.section}>
          {searching ? (
            <StateView kind="loading" compact />
          ) : results === null ? (
            <StateView
              kind="empty"
              icon="search"
              title="Buscar jogadores"
              message="Digite um apelido e toque em buscar no teclado."
              actionLabel="Buscar"
              onAction={doSearch}
              compact
            />
          ) : results.length === 0 ? (
            <StateView
              kind="empty"
              title="Ninguém encontrado"
              message="Confira o apelido e tente de novo."
              compact
            />
          ) : (
            <Surface padding={0}>
              {results.map((p, i) => (
                <View
                  key={p.id}
                  style={[styles.friendRow, i < results.length - 1 && styles.divider]}
                >
                  <PlayerAvatar avatarId={p.avatarId} size={50} />
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <AppText variant="h3" numberOfLines={1}>
                      {p.nickname}
                    </AppText>
                    <AppText variant="small" color={colors.textSecondary}>
                      Nível {p.level}
                    </AppText>
                  </View>
                  <PillButton
                    label={friendIds?.includes(p.id) ? 'Amigo' : 'Adicionar'}
                    variant={friendIds?.includes(p.id) ? 'muted' : 'primary'}
                    disabled={friendIds?.includes(p.id) || busy === p.id}
                    onPress={() => request(p.id)}
                  />
                </View>
              ))}
            </Surface>
          )}
        </View>
      )}
    </Screen>
  );
}

function rank(p: Presence | null): number {
  return p?.state === 'online' ? 0 : p?.state === 'in_match' ? 1 : 2;
}

const styles = StyleSheet.create({
  chips: { marginBottom: spacing.md },
  banner: { flexDirection: 'row', marginTop: spacing.lg, overflow: 'hidden', minHeight: 132 },
  bannerText: { flex: 1.15, padding: 12, justifyContent: 'center' },
  bannerCta: { marginTop: 10, alignSelf: 'flex-start', minWidth: 170 },
  bannerImage: { flex: 1, height: '100%' },
  section: { marginTop: spacing.lg, marginBottom: spacing.sm },
  friendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.divider },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  more: { paddingLeft: 10, paddingVertical: 6 },
  radius: { borderRadius: radius.card },
});
