import type {
  Achievement,
  AIDifficultyId,
  AvatarId,
  FriendInviteToken,
  FriendRequest,
  Friendship,
  GlobalRankingEntry,
  LeagueHistoryEntry,
  LeagueRankingMember,
  LeagueScreenSnapshot,
  MatchHistoryEntry,
  MatchmakingEntry,
  MatchPhoneContactsResult,
  PlayerStats,
  Presence,
  PresenceState,
  Profile,
  ProgressionResult,
  Room,
  RoomInvite,
  SessionMeta,
  UserAchievements,
} from '@/domain/model/types';
import type { GameAction, GameEvent, SeatView } from '@/domain/game';
import { api, idempotencyKey } from './client';
import { realtime, WS } from './realtime';

/**
 * API do backend NestJS com os mesmos nomes que as telas já usavam. Tudo passa por aqui:
 * REST para consultas e comandos, WebSocket para o que é ao vivo.
 */

type Unsub = () => void;

// --- Sessão / perfil ----------------------------------------------------------------------

export interface BootstrapResult {
  uid: string;
  onboarded: boolean;
  profile: Profile;
  stats: PlayerStats;
  league: { leagueId: string; weekKey: string; groupId: string; division: number } | null;
  activeMatch: { matchId: string; roomCode: string | null } | null;
  invites: RoomInvite[];
  unreadNotifications: number;
  unlockedAchievements: Record<string, number>;
  serverTime: number;
}

let lastBootstrap: BootstrapResult | null = null;

export async function bootstrapUser(device?: { token: string; platform: string }): Promise<BootstrapResult> {
  const res = await api.post<BootstrapResult>('/v1/me/bootstrap', device ? { device } : {});
  lastBootstrap = res;
  profileListeners.forEach((l) => l({ profile: res.profile, stats: res.stats }));
  return res;
}

export const lastBootstrapResult = () => lastBootstrap;

export async function updateProfile(data: { nickname: string; avatarId: AvatarId }) {
  const res = await api.patch<{ ok: true; profile: Profile }>('/v1/me/profile', data);
  const current = lastProfile?.stats ?? null;
  if (current) profileListeners.forEach((l) => l({ profile: res.profile, stats: current }));
  return res;
}

export const getMyProfile = () => api.get<{ profile: Profile; stats: PlayerStats }>('/v1/me/profile');

/** Perfil do usuário logado direto do servidor (sem cache). */
export async function getProfileFromServer(_uid: string): Promise<Profile | null> {
  return (await getMyProfile()).profile;
}

type ProfilePush = { profile: Profile; stats: PlayerStats };
const profileListeners = new Set<(p: ProfilePush) => void>();
let lastProfile: ProfilePush | null = null;
realtime.on<ProfilePush>(WS.profileUpdated, (p) => {
  lastProfile = p;
  profileListeners.forEach((l) => l(p));
});

/**
 * Perfil + estatísticas ao vivo do usuário logado: carga inicial pela API, atualizações pelo
 * WebSocket (XP, liga e estatísticas mudam só no servidor) e nova leitura a cada reconexão.
 */
export function subscribeMyProfile(cb: (p: ProfilePush) => void, onError?: (e: Error) => void): Unsub {
  const listener = (p: ProfilePush) => {
    lastProfile = p;
    cb(p);
  };
  profileListeners.add(listener);
  const refresh = () => {
    getMyProfile()
      .then(listener)
      .catch((e: Error) => onError?.(e));
  };
  const unsubReconnect = realtime.whileConnected(refresh);
  if (!realtime.connected) refresh();
  return () => {
    profileListeners.delete(listener);
    unsubReconnect();
  };
}

const publicCache = new Map<string, { at: number; value: Promise<{ profile: Profile; stats: PlayerStats } | null> }>();
const PUBLIC_TTL_MS = 60_000;

function publicPlayer(uid: string) {
  const hit = publicCache.get(uid);
  if (hit && Date.now() - hit.at < PUBLIC_TTL_MS) return hit.value;
  const value = api
    .get<{ profile: Profile; stats: PlayerStats }>(`/v1/players/${encodeURIComponent(uid)}`)
    .catch(() => null);
  publicCache.set(uid, { at: Date.now(), value });
  return value;
}

export async function getProfile(uid: string): Promise<Profile | null> {
  if (lastProfile?.profile.id === uid) return lastProfile.profile;
  return (await publicPlayer(uid))?.profile ?? null;
}

/** Estatísticas de qualquer jogador (as minhas ficam ao vivo). */
export function subscribeStats(uid: string, cb: (s: PlayerStats | null) => void): Unsub {
  let active = true;
  if (lastProfile?.profile.id === uid) {
    cb(lastProfile.stats);
    const listener = (p: ProfilePush) => active && p.profile.id === uid && cb(p.stats);
    profileListeners.add(listener);
    return () => {
      active = false;
      profileListeners.delete(listener);
    };
  }
  publicPlayer(uid).then((p) => active && cb(p?.stats ?? null));
  return () => {
    active = false;
  };
}

export const searchPlayers = async (term: string): Promise<Profile[]> =>
  (await api.get<{ players: Profile[] }>('/v1/players/search', { term })).players;

export const registerDevice = (token: string, platform: string) =>
  api.post<{ ok: true }>('/v1/me/devices', { token, platform });
export const unregisterDevice = (token: string) => api.post<{ ok: true }>('/v1/me/devices/remove', { token });
export const deleteAccount = () => api.delete<{ ok: true }>('/v1/me');

export async function getAchievements(): Promise<Achievement[]> {
  return (await api.get<{ achievements: Achievement[] }>('/v1/me/achievements')).achievements;
}

/** Conquistas desbloqueadas; relidas quando o perfil muda (fim de partida). */
export function subscribeUserAchievements(uid: string, cb: (a: UserAchievements | null) => void): Unsub {
  let active = true;
  const load = () =>
    api
      .get<{ unlocked: Record<string, number> }>('/v1/me/achievements')
      .then((r) => active && cb({ id: uid, unlocked: r.unlocked }))
      .catch(() => undefined);
  void load();
  const listener = () => void load();
  profileListeners.add(listener);
  return () => {
    active = false;
    profileListeners.delete(listener);
  };
}

export async function getMatchHistory(_uid: string, max = 30): Promise<MatchHistoryEntry[]> {
  return (await api.get<{ items: MatchHistoryEntry[] }>('/v1/matches', { limit: max })).items;
}

// --- Presença / conexão -------------------------------------------------------------------

/** Liga o tempo real (presença incluída). Devolve o desligamento — usado no logout. */
export function connectPresence(_uid: string): Unsub {
  realtime.start();
  return () => realtime.stop();
}

const PRESENCE_STATE: Record<PresenceState, string> = {
  online: 'ONLINE',
  in_match: 'IN_MATCH',
  offline: 'BACKGROUND',
};

/** O que o app está fazendo (reenviado a cada reconexão e ao voltar do segundo plano). */
let presenceIntent: { state: string; matchId: string | null } = { state: 'ONLINE', matchId: null };
let appInBackground = false;
realtime.whileConnected(() => {
  const state = appInBackground ? 'BACKGROUND' : presenceIntent.state;
  void realtime.emit('presence.set', { state, matchId: presenceIntent.matchId }).catch(() => undefined);
});

export function setPresenceState(_uid: string, state: PresenceState, sessionId: string | null = null) {
  presenceIntent = { state: PRESENCE_STATE[state], matchId: sessionId };
  if (appInBackground) return Promise.resolve(null);
  return realtime.emit('presence.set', presenceIntent);
}

/** Segundo plano ↔ primeiro plano (AppState). */
export function setAppForeground(active: boolean) {
  appInBackground = !active;
  if (active) realtime.wake();
  if (!realtime.connected) return;
  const payload = active ? presenceIntent : { state: 'BACKGROUND', matchId: null };
  void realtime.emit('presence.set', payload).catch(() => undefined);
}

type PresencePush = { uid: string; presence: Presence };
const presenceWatchers = new Map<string, Set<(p: Presence | null) => void>>();
realtime.on<PresencePush>(WS.presenceChanged, (p) => presenceWatchers.get(p.uid)?.forEach((cb) => cb(p.presence)));

/** Presença ao vivo de um jogador (assinaturas agrupadas por uid). */
export function subscribePresence(uid: string, cb: (p: Presence | null) => void): Unsub {
  let set = presenceWatchers.get(uid);
  const first = !set;
  if (!set) {
    set = new Set();
    presenceWatchers.set(uid, set);
  }
  set.add(cb);
  const load = () =>
    realtime
      .emit<{ presence: Record<string, Presence> }>('presence.subscribe', { uids: [uid] })
      .then((r) => cb(r.presence[uid] ?? null))
      .catch(() => undefined);
  const unsub = first ? realtime.whileConnected(() => void load()) : (void load(), () => undefined);
  return () => {
    set!.delete(cb);
    unsub();
    if (set!.size === 0) {
      presenceWatchers.delete(uid);
      void realtime.emit('presence.unsubscribe', { uids: [uid] }).catch(() => undefined);
    }
  };
}

export const subscribeConnection = (cb: (connected: boolean) => void): Unsub => realtime.onConnection(cb);

export function subscribeOnlineCount(cb: (n: number) => void): Unsub {
  let active = true;
  api
    .get<{ count: number }>('/v1/stats/online')
    .then((r) => active && cb(r.count))
    .catch(() => undefined);
  const off = realtime.on<{ count: number }>(WS.onlineCount, (p) => cb(p.count));
  const offReady = realtime.on<{ onlineCount?: number }>(WS.ready, (p) => {
    if (typeof p.onlineCount === 'number') cb(p.onlineCount);
  });
  return () => {
    active = false;
    off();
    offReady();
  };
}

// --- Amigos -------------------------------------------------------------------------------

export interface FriendRow {
  uid: string;
  since: number;
  source: 'manual' | 'phone_contact';
  profile: Profile;
  presence: Presence;
}

export const listFriends = async () => (await api.get<{ friends: FriendRow[] }>('/v1/friends')).friends;

/** Lista viva: relida quando o servidor avisa (amizade nova, removida, agenda). */
function liveList<T>(event: string, load: () => Promise<T>, cb: (v: T) => void, onError?: (e: Error) => void): Unsub {
  let active = true;
  const run = () =>
    load()
      .then((v) => active && cb(v))
      .catch((e: Error) => active && onError?.(e));
  const off = realtime.on(event, () => void run());
  const offReconnect = realtime.whileConnected(() => void run());
  if (!realtime.connected) void run();
  return () => {
    active = false;
    off();
    offReconnect();
  };
}

export function subscribeFriendRows(_uid: string, cb: (f: FriendRow[]) => void, onError?: (e: Error) => void): Unsub {
  return liveList(WS.friendsChanged, listFriends, cb, onError);
}

export function subscribeFriends(uid: string, cb: (f: Friendship[]) => void, onError?: (e: Error) => void): Unsub {
  return subscribeFriendRows(uid, (rows) => cb(rows.map((r) => ({ id: r.uid, since: r.since, source: r.source }))), onError);
}

const loadRequests = () => api.get<{ incoming: FriendRequest[]; outgoing: FriendRequest[] }>('/v1/friends/requests');

export const subscribeIncomingRequests = (_uid: string, cb: (r: FriendRequest[]) => void, onError?: (e: Error) => void) =>
  liveList(WS.friendRequestsChanged, loadRequests, (r) => cb(r.incoming), onError);
export const subscribeOutgoingRequests = (_uid: string, cb: (r: FriendRequest[]) => void, onError?: (e: Error) => void) =>
  liveList(WS.friendRequestsChanged, loadRequests, (r) => cb(r.outgoing), onError);

export const subscribeBlockedUsers = (_uid: string, cb: (ids: string[]) => void): Unsub =>
  liveList(
    WS.blocksChanged,
    async () => (await api.get<{ blocked: { uid: string }[] }>('/v1/blocks')).blocked.map((b) => b.uid),
    cb,
    () => cb([]),
  );

export const sendFriendRequest = (toUid: string) => api.post<{ ok: true }>('/v1/friends/requests', { toUid });
export const respondFriendRequest = (requestId: string, accept: boolean) =>
  api.post<{ ok: true }>(`/v1/friends/requests/${encodeURIComponent(requestId)}/respond`, { accept });
export const cancelFriendRequest = (toUid: string) =>
  api.delete<{ ok: true }>(`/v1/friends/requests/to/${encodeURIComponent(toUid)}`);
export const removeFriend = (friendUid: string) => api.delete<{ ok: true }>(`/v1/friends/${encodeURIComponent(friendUid)}`);
export const blockUser = (targetUid: string) => api.post<{ ok: true }>('/v1/blocks', { targetUid });
export const unblockUser = (targetUid: string) => api.delete<{ ok: true }>(`/v1/blocks/${encodeURIComponent(targetUid)}`);

/**
 * Um lote de telefones E.164 → quem tem conta. O servidor já cria a amizade com quem tem o
 * telefone verificado. Nenhum nome sai do aparelho e nenhum número volta.
 */
export const syncPhoneContacts = (phones: string[]) =>
  api.post<MatchPhoneContactsResult>('/v1/contacts/sync', { phones });

export const createFriendInviteToken = () => api.post<FriendInviteToken>('/v1/friends/invite-token');
export const resolveFriendInviteToken = (token: string) =>
  api.post<{ uid: string }>('/v1/friends/invite-token/resolve', { token });

// --- Salas / convites ---------------------------------------------------------------------

export interface JoinRoomResult {
  code: string;
  sessionId?: string | null;
  pending?: boolean;
}

export const createRoom = () => api.post<{ code: string }>('/v1/rooms', {}, { idempotencyKey: idempotencyKey('room') });
export const createFriendRoom = (friendUids: string[]) =>
  api.post<{ code: string; inviteExpiresAt: number }>(
    '/v1/rooms/friends',
    { friendUids },
    { idempotencyKey: idempotencyKey('friend-room') },
  );
export const joinRoom = (code: string) => api.post<JoinRoomResult>(`/v1/rooms/${code}/join`);
export const respondRoomInvite = (code: string, accept: boolean) =>
  api.post<JoinRoomResult>(`/v1/invites/${code}/respond`, { accept });
export const inviteToRoom = (code: string, friendUid: string) =>
  api.post<{ ok: true }>(`/v1/rooms/${code}/invites`, { friendUid });
export const removeRoomInvite = (code: string, friendUid: string) =>
  api.delete<{ ok: true }>(`/v1/rooms/${code}/invites/${encodeURIComponent(friendUid)}`);
export const resolveLobbyTimeout = (code: string) =>
  api.post<{ sessionId: string | null }>(`/v1/rooms/${code}/lobby-timeout`);
export const leaveRoom = (code: string) => api.post<{ ok: true }>(`/v1/rooms/${code}/leave`);
export const setReady = (code: string, ready: boolean) => api.post<{ ok: true }>(`/v1/rooms/${code}/ready`, { ready });
export const fillRoomWithBots = (code: string) => api.post<{ ok: true }>(`/v1/rooms/${code}/fill-bots`);
export const startMatch = (code: string) => api.post<{ sessionId: string }>(`/v1/rooms/${code}/start`);
/** Para amigos e contatos da agenda (os números provam o vínculo e não são gravados). */
export const inviteFriendToRoom = (friendUid: string, code: string, phones?: string[]) =>
  api.post<{ ok: true }>(`/v1/rooms/${code}/invites/direct`, { friendUid, ...(phones?.length ? { phones } : {}) });

/** Sala ao vivo (o código é o segredo da sala). */
export function subscribeRoom(code: string, cb: (r: Room | null) => void, onError?: (e: Error) => void): Unsub {
  let active = true;
  const off = realtime.on<{ code: string; room: Room | null }>(WS.roomUpdated, (p) => {
    if (active && p.code === code) cb(p.room);
  });
  const load = () =>
    realtime
      .emit<{ room: Room | null }>('room.subscribe', { code })
      .then((r) => active && cb(r.room))
      .catch((e: Error) => {
        // Sem socket: cai para a leitura REST.
        api
          .get<Room>(`/v1/rooms/${code}`)
          .then((room) => {
            if (active) cb(room);
          })
          .catch((err: Error) => {
            if (!active) return;
            if ((err as { code?: string }).code === 'not-found') cb(null);
            else onError?.(e);
          });
      });
  const offReconnect = realtime.whileConnected(() => void load());
  if (!realtime.connected) void load();
  return () => {
    active = false;
    off();
    offReconnect();
    void realtime.emit('room.unsubscribe', { code }).catch(() => undefined);
  };
}

/** Convites de sala recebidos, ao vivo. */
export function subscribeRoomInvites(_uid: string, cb: (invites: RoomInvite[]) => void, onError?: (e: Error) => void): Unsub {
  let active = true;
  const sort = (list: RoomInvite[]) => [...list].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  const off = realtime.on<{ invites: RoomInvite[] }>(WS.invitesUpdated, (p) => active && cb(sort(p.invites)));
  const load = () =>
    api
      .get<{ invites: RoomInvite[] }>('/v1/invites')
      .then((r) => active && cb(sort(r.invites)))
      .catch((e: Error) => active && onError?.(e));
  const offReconnect = realtime.whileConnected(() => void load());
  if (!realtime.connected) void load();
  return () => {
    active = false;
    off();
    offReconnect();
  };
}

/** Some com o convite da caixa de entrada. */
export const deleteRoomInvite = (_uid: string, code: string) => api.delete<{ ok: true }>(`/v1/invites/${code}`);

// --- Matchmaking --------------------------------------------------------------------------

export const startMatchmaking = (allowBots = false) => api.post<{ ok: true }>('/v1/matchmaking', { allowBots });
export const cancelMatchmaking = () => api.delete<{ ok: true }>('/v1/matchmaking');

export function subscribeMatchmaking(
  _uid: string,
  cb: (m: MatchmakingEntry | null) => void,
  onError?: (e: Error) => void,
): Unsub {
  let active = true;
  const off = realtime.on<{ entry: MatchmakingEntry | null }>(WS.matchmakingUpdated, (p) => active && cb(p.entry));
  const load = () =>
    api
      .get<{ entry: MatchmakingEntry | null }>('/v1/matchmaking')
      .then((r) => active && cb(r.entry))
      .catch((e: Error) => active && onError?.(e));
  const offReconnect = realtime.whileConnected(() => void load());
  if (!realtime.connected) void load();
  return () => {
    active = false;
    off();
    offReconnect();
  };
}

// --- Partida online -----------------------------------------------------------------------

export interface SubmitActionResult {
  version: number;
  status: 'PLAYING' | 'FINISHED';
  duplicate?: boolean;
}

export interface RemoteSeatViewPayload extends SeatView {
  matchId: string;
  recentEvents: GameEvent[];
  turnStartedAt: number | null;
  turnDeadlineAt: number | null;
  serverTime: number;
}

export interface MatchSnapshot {
  meta: SessionMeta;
  view: RemoteSeatViewPayload | null;
  seat: number | null;
  result: ProgressionResult | null;
}

/**
 * A partida ao vivo: entra nas salas do assento, recebe meta/view/resultado e reentra sozinha a
 * cada reconexão (com o retrato completo — nada de estado velho depois de uma queda).
 */
export function subscribeMatch(
  matchId: string,
  handlers: {
    onSnapshot: (s: MatchSnapshot) => void;
    onMeta: (m: SessionMeta) => void;
    onView: (v: RemoteSeatViewPayload) => void;
    onResult: (r: ProgressionResult) => void;
    onError: (e: Error) => void;
  },
): Unsub {
  let active = true;
  const offMeta = realtime.on<SessionMeta>(WS.gameMeta, (m) => active && m.id === matchId && handlers.onMeta(m));
  const offView = realtime.on<RemoteSeatViewPayload>(WS.gameView, (v) => active && v.matchId === matchId && handlers.onView(v));
  const offResult = realtime.on<{ matchId: string; result: ProgressionResult }>(
    WS.gameResult,
    (r) => active && r.matchId === matchId && handlers.onResult(r.result),
  );
  const join = () =>
    realtime
      .emit<MatchSnapshot>('game.join', { matchId })
      .then((s) => active && handlers.onSnapshot(s))
      .catch((e: Error) => active && handlers.onError(e));
  const offReconnect = realtime.whileConnected(() => void join());
  if (!realtime.connected) {
    // Sem socket ainda: retrato pela API para a mesa não ficar em branco.
    api
      .get<MatchSnapshot>(`/v1/matches/${matchId}`)
      .then((s) => active && handlers.onSnapshot(s))
      .catch((e: Error) => active && handlers.onError(e));
  }
  return () => {
    active = false;
    offMeta();
    offView();
    offResult();
    offReconnect();
    void realtime.emit('game.leave-view', { matchId }).catch(() => undefined);
  };
}

/** Jogada: WebSocket quando conectado; senão, REST (mesma chave de idempotência). */
export async function submitGameAction(sessionId: string, action: GameAction, clientActionId: string) {
  if (realtime.connected)
    return realtime.emit<SubmitActionResult>('game.action', { matchId: sessionId, action, actionId: clientActionId });
  return api.post<SubmitActionResult>(`/v1/matches/${sessionId}/actions`, { action, actionId: clientActionId });
}

export const advanceBots = (sessionId: string) =>
  realtime.connected
    ? realtime.emit<SubmitActionResult>('game.advance-bots', { matchId: sessionId })
    : api.post<SubmitActionResult>(`/v1/matches/${sessionId}/advance-bots`);
export const abandonMatch = (sessionId: string) => api.post<{ ok: true }>(`/v1/matches/${sessionId}/abandon`);
export const rejoinMatch = (sessionId: string) => api.post<{ ok: true }>(`/v1/matches/${sessionId}/rejoin`);
export const claimReservedSeat = (sessionId: string) =>
  api.post<{ status: 'seated' | 'pending' | 'unavailable' }>(`/v1/matches/${sessionId}/claim-seat`);
export const getActiveMatch = () => api.get<{ matchId: string; roomCode: string | null } | null>('/v1/me/active-match');

export interface FinalizeAiMatchRequest {
  mode?: 'ai';
  matchId: string;
  seed: number;
  aiSeed: number;
  difficulty: AIDifficultyId;
  actions: GameAction[];
}
export interface FinalizeMatchResult {
  alreadyProcessed: boolean;
  winnerTeam: 0 | 1;
  progression: ProgressionResult | null;
}
/** Partida contra a IA: o servidor re-executa e só então concede XP/liga (repetível). */
export const finalizeAiMatch = (req: FinalizeAiMatchRequest) =>
  api.post<FinalizeMatchResult>(
    '/v1/matches/ai',
    { matchId: req.matchId, seed: req.seed, aiSeed: req.aiSeed, difficulty: req.difficulty, actions: req.actions },
    { idempotencyKey: `ai-${req.matchId}`.slice(0, 120), timeoutMs: 30_000 },
  );

// --- Ligas --------------------------------------------------------------------------------

export const ensureUserLeagueAssignment = () =>
  api.post<{ leagueId: string; weekKey: string; groupId: string }>('/v1/leagues/me/ensure');
export const getLeagueScreenSnapshot = () => api.get<LeagueScreenSnapshot>('/v1/leagues/me');
export const getGlobalLeagueRanking = (max = 50) =>
  api.get<{ entries: GlobalRankingEntry[] }>('/v1/leagues/ranking/global', { limit: max });

export async function getLeagueHistory(_uid: string, max = 20): Promise<LeagueHistoryEntry[]> {
  return (await api.get<{ items: LeagueHistoryEntry[] }>('/v1/leagues/me/history', { limit: max })).items;
}

/** Ranking do grupo ao vivo (o servidor manda a lista já ordenada). */
export function subscribeGroupMembers(
  groupId: string,
  cb: (members: LeagueRankingMember[]) => void,
  onError?: (e: Error) => void,
): Unsub {
  let active = true;
  const off = realtime.on<{ groupId: string; members: LeagueRankingMember[] }>(WS.leagueMembers, (p) => {
    if (active && p.groupId === groupId) cb(p.members);
  });
  const sub = () =>
    realtime
      .emit<{ members: LeagueRankingMember[] }>('league.subscribe', { groupId })
      .then((r) => active && cb(r.members))
      .catch((e: Error) => active && onError?.(e));
  const offReconnect = realtime.whileConnected(() => void sub());
  return () => {
    active = false;
    off();
    offReconnect();
    void realtime.emit('league.unsubscribe', { groupId }).catch(() => undefined);
  };
}
