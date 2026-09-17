/**
 * Modelo de dados compartilhado pelo app e pelo backend (sem dependência de framework).
 * Entidades trazem o identificador público em `id` (o uid do Firebase Auth para jogadores).
 */

export type AvatarId = 'joao' | 'maria' | 'cachorro' | 'galo' | 'seu_ze' | 'seu_antonio' | 'tiao';

export const AVATAR_IDS: AvatarId[] = [
  'joao',
  'maria',
  'cachorro',
  'galo',
  'seu_ze',
  'seu_antonio',
  'tiao',
];

export type AIDifficultyId = 'easy' | 'normal' | 'hard';

/** Ids estáveis das 20 ligas, na ordem oficial da escada (ver `leagues.ts`). */
export type LeagueId =
  | 'bronze'
  | 'silver'
  | 'gold'
  | 'platinum'
  | 'quartz'
  | 'topaz'
  | 'amethyst'
  | 'aquamarine'
  | 'tourmaline'
  | 'emerald'
  | 'sapphire'
  | 'ruby'
  | 'opal'
  | 'onyx'
  | 'obsidian'
  | 'diamond'
  | 'black_diamond'
  | 'imperial'
  | 'legendary'
  | 'legend_of_minas';

export interface Profile {
  id: string;
  nickname: string;
  nicknameLower: string;
  avatarId: AvatarId;
  /** ISO 3166-1 alpha-2, deduzido do telefone no cadastro. Só decora o ranking. */
  countryCode: string;
  level: number;
  xp: number;
  xpToNext: number;
  /** Espelho de `playerProgress.currentLeagueId` — quem manda é o sistema de ligas. */
  leagueId: LeagueId;
  leaguePoints: number;
  createdAt: number;
  updatedAt: number;
}

export interface PlayerStats {
  id: string;
  matches: number;
  wins: number;
  losses: number;
  winRate: number; // 0..100
  aiMatches: number;
  onlineMatches: number;
  trucosCalled: number;
  trucosAccepted: number;
  bestStreak: number;
  currentStreak: number;
  hardWins: number;
  updatedAt: number;
}

// --- Sistema de ligas semanais -------------------------------------------------------------

/** Documento de `leagueDefinitions/{leagueId}`. Catálogo estático, semeado pelas Functions. */
export interface LeagueDefinition {
  id: LeagueId;
  order: number; // 1..20
  displayName: string;
  /** Chave do brasão (`shield_gold`). O caminho local nunca vai para o servidor. */
  assetKey: string;
  previousLeagueId: LeagueId | null;
  nextLeagueId: LeagueId | null;
  isFirst: boolean;
  isLast: boolean;
  active: boolean;
}

export type WeeklyGroupStatus = 'forming' | 'active' | 'finalizing' | 'finalized';

export type WeeklyResult = 'promoted' | 'stayed' | 'relegated' | 'top_league' | 'bottom_league';

/** Documento de `playerProgress/{uid}` — estado do jogador no sistema de ligas. */
export interface PlayerProgress {
  id: string;
  uid: string;
  currentLeagueId: LeagueId;
  /** Índice 1-based do grupo dentro da liga naquela semana (exibido como "Divisão I"). */
  currentDivision: number;
  currentWeekKey: string;
  currentLeagueGroupId: string;
  weeklyPoints: number;
  seasonPoints: number;
  lastWeeklyResult: WeeklyResult | null;
  lastWeeklyRank: number | null;
  lastProcessedWeekKey: string | null;
  /** Última semana em que o jogador pontuou — usada para não carregar contas dormentes. */
  lastActiveWeekKey: string | null;
  updatedAt: number;
}

/** Documento de `weeklyLeagueGroups/{groupId}`. */
export interface WeeklyLeagueGroup {
  id: string;
  groupId: string;
  leagueId: LeagueId;
  weekKey: string;
  division: number;
  status: WeeklyGroupStatus;
  memberCount: number;
  targetSize: number;
  promotionCount: number;
  relegationCount: number;
  startAt: number;
  endAt: number;
  createdAt: number;
  updatedAt: number;
  finalizedAt: number | null;
}

/** Documento de `weeklyLeagueGroups/{groupId}/members/{uid}`. */
export interface WeeklyLeagueMember {
  id: string;
  uid: string;
  nickname: string;
  avatarId: AvatarId;
  countryCode: string;
  weeklyPoints: number;
  wins: number;
  matches: number;
  tiebreakScore: number;
  currentRank: number;
  previousRank: number;
  joinedAt: number;
  updatedAt: number;
}

/** Documento de `leagueHistory/{uid}/weeks/{weekKey}`. */
export interface LeagueHistoryEntry {
  id: string;
  weekKey: string;
  leagueId: LeagueId;
  division: number;
  groupId: string;
  groupSize: number;
  finalRank: number;
  weeklyPoints: number;
  result: WeeklyResult;
  previousLeagueId: LeagueId;
  nextLeagueId: LeagueId;
  processedAt: number;
}

/** Payload consolidado da aba "Minha Liga" (`getLeagueScreenSnapshot`). */
export interface LeagueScreenSnapshot {
  weekKey: string;
  startAt: number;
  endAt: number;
  /** Relógio do servidor no momento da resposta — o countdown nunca usa o do aparelho. */
  serverTime: number;
  currentLeague: LeagueDefinition;
  previousLeague: LeagueDefinition | null;
  nextLeague: LeagueDefinition | null;
  division: number;
  groupId: string;
  groupSize: number;
  promotionCount: number;
  relegationCount: number;
  promotionStart: number;
  promotionEnd: number;
  relegationStart: number;
  relegationEnd: number;
  userRank: number;
  userWeeklyPoints: number;
  members: LeagueRankingMember[];
  lastWeeklyResult: WeeklyResult | null;
  lastWeeklyRank: number | null;
}

export interface LeagueRankingMember {
  uid: string;
  nickname: string;
  avatarId: AvatarId;
  countryCode: string;
  weeklyPoints: number;
  wins: number;
  rank: number;
  tiebreakScore: number;
  joinedAt: number;
  isMe: boolean;
}

export interface GlobalRankingEntry {
  uid: string;
  rank: number;
  nickname: string;
  avatarId: AvatarId;
  countryCode: string;
  leagueId: LeagueId;
  seasonPoints: number;
  isMe: boolean;
}

export interface Season {
  id: string;
  name: string;
  subtitle: string;
  startsAt: number;
  endsAt: number;
}

/**
 * Como a amizade surgiu. Só para auditoria/analytics — a tela não diferencia.
 * `phone_contact`: conexão automática (o telefone verificado de um estava na agenda do outro).
 */
export type FriendshipSource = 'manual' | 'phone_contact';

export interface Friendship {
  id: string; // friend uid
  since: number;
  /** Ausente nas amizades gravadas antes da conexão automática (todas manuais). */
  source?: FriendshipSource;
}

export interface FriendRequest {
  id: string;
  from: string;
  to: string;
  fromNickname: string;
  fromAvatarId: AvatarId;
  /** Perfil público do destinatário, para a lista "enviadas" não precisar de outra leitura. */
  toNickname?: string;
  toAvatarId?: AvatarId;
  status: 'pending' | 'accepted' | 'declined';
  createdAt: number;
  /** Quando a solicitação foi encerrada por uma conexão automática da agenda. */
  resolvedBy?: FriendshipSource;
}

export interface MatchHistoryEntry {
  id: string;
  mode: 'ai' | 'online';
  difficulty?: 'easy' | 'normal' | 'hard';
  playerIds: string[];
  players: { uid: string; seat: number; nickname: string; avatarId: AvatarId; bot: boolean }[];
  scores: [number, number];
  winnerTeam: 0 | 1;
  handsPlayed: number;
  finishedAt: number;
}

export interface Achievement {
  id: string;
  order: number;
  title: string;
  description: string;
  icon: string;
  target: number;
  stat: keyof PlayerStats;
}

export interface UserAchievements {
  id: string;
  unlocked: Record<string, number>; // achievementId -> unlockedAt
}

export type PresenceState = 'online' | 'in_match' | 'offline';

export interface Presence {
  state: PresenceState;
  lastChanged: number;
  sessionId?: string | null;
}

export type RoomStatus = 'waiting' | 'starting' | 'in_match' | 'closed';

export interface RoomPlayer {
  uid: string;
  seat: number;
  nickname: string;
  avatarId: AvatarId;
  ready: boolean;
  bot: boolean;
  joinedAt: number;
  connected?: boolean;
  /** IA ocupando a vaga de um convidado que ainda não entrou: ele pode assumir depois. */
  reservedFor?: string | null;
}

/**
 * Situação do convite de um amigo para uma sala privada.
 * `AI_FILLED`: a vaga foi completada por IA (o convidado ainda pode assumir enquanto valer).
 */
export type RoomInviteStatus =
  'PENDING' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED' | 'AI_FILLED' | 'CANCELLED';

/** Convidado de uma sala, com a vaga reservada para ele (`rooms/{code}/invites/{uid}`). */
export interface RoomSeatInvite {
  uid: string;
  seat: number;
  nickname: string;
  avatarId: AvatarId;
  status: RoomInviteStatus;
  invitedAt: number;
  respondedAt?: number | null;
}

/** Por que a sala fechou — a tela do convidado mostra a mensagem certa. */
export type RoomClosedReason = 'cancelled' | 'finished' | 'abandoned' | 'expired';

export interface Room {
  code: string;
  hostUid: string;
  status: RoomStatus;
  maxPlayers: 4;
  players: Record<string, RoomPlayer>;
  sessionId: string | null;
  createdAt: number;
  updatedAt: number;
  source: 'private' | 'matchmaking';
  /** Sala montada a partir da lista de amigos: convidados com vaga reservada. */
  invites?: Record<string, RoomSeatInvite>;
  /** Fim da espera do lobby: depois disso as vagas restantes são completadas por IA. */
  inviteExpiresAt?: number | null;
  /** Até quando um convidado ainda pode entrar (inclusive assumindo a vaga da IA). */
  lateJoinUntil?: number | null;
  /** `on_timeout`: ao fim da espera a sala completa com IA e começa sozinha. */
  fillWithAi?: 'on_timeout' | 'manual';
  closedReason?: RoomClosedReason | null;
}

/**
 * Convite de sala que um amigo enviou (caixa de entrada: `GET /v1/invites` + evento `room.invites`).
 * Escrito pelas Functions (`inviteFriendToRoom`); o destinatário só pode ler e apagar o seu.
 */
export interface RoomInvite {
  code: string;
  from: string;
  fromNickname: string;
  createdAt: number;
  /** Idempotente por sala + convidado (`{code}_{uid}`). */
  inviteId?: string;
  /** Depois disso o convite some (o servidor também recusa). */
  expiresAt?: number;
}

export type MatchmakingStatus =
  'searching' | 'found' | 'preparing' | 'ready' | 'cancelled' | 'timeout' | 'error';

export interface MatchmakingEntry {
  uid: string;
  nickname: string;
  avatarId: AvatarId;
  joinedAt: number;
  status: MatchmakingStatus;
  sessionId?: string | null;
  roomCode?: string | null;
}

export type SessionStatus = 'preparing' | 'playing' | 'finished' | 'abandoned';

export interface SessionPlayer {
  uid: string;
  seat: number;
  nickname: string;
  avatarId: AvatarId;
  bot: boolean;
  connected: boolean;
  /** Quando o humano caiu (a IA assume a vez dele depois de um curto período). */
  disconnectedAt?: number | null;
  /** IA segurando a vaga de um convidado que ainda pode entrar. */
  reservedFor?: string | null;
  /** Convidado que já entrou e assume a vaga no próximo ponto seguro (início de mão). */
  pendingUid?: string | null;
  /** Humano que saiu no meio e cuja vaga passou para a IA. */
  replacedUid?: string | null;
  /**
   * Quem controla o assento agora: o humano, a IA temporária (humano caiu) ou a IA definitiva
   * (vaga de bot ou de quem saiu). Decidido só pelo servidor.
   */
  controller?: 'HUMAN' | 'AI_TEMPORARY' | 'AI_PERMANENT';
  /** Incrementa a cada troca de controlador (proteção contra corrida humano × IA). */
  controllerVersion?: number;
}

export interface SessionMeta {
  id: string;
  roomCode: string | null;
  mode: 'online';
  status: SessionStatus;
  players: Record<string, SessionPlayer>; // key = seat as string
  createdAt: number;
  updatedAt: number;
  winnerTeam: 0 | 1 | null;
  abandonedBy?: string | null;
}

export interface ProgressionResult {
  xpGained: number;
  /** Pontos somados ao ranking da semana (nunca negativo — pontos semanais só acumulam). */
  leaguePointsDelta: number;
  leveledUp: boolean;
  newLevel: number;
  /** Liga atual. Promoção/rebaixamento acontecem só na virada da semana, nunca por partida. */
  newLeagueId: LeagueId;
}

export const LEVEL_XP_BASE = 300;
export function xpForLevel(level: number): number {
  return LEVEL_XP_BASE + (level - 1) * 100;
}

// --- Amigos: contatos, bloqueios e convite por QR ----------------------------

/** Relação do usuário logado com um jogador encontrado na agenda ou na busca. */
export type FriendRelation = 'self' | 'friend' | 'request_sent' | 'request_received' | 'none';

/**
 * Jogador encontrado a partir de um telefone da agenda.
 * `index` é a posição do número na lista enviada — o servidor nunca devolve o telefone,
 * então o app faz a correspondência com o contato local sem que o número trafegue de volta.
 */
export interface ContactMatch {
  index: number;
  uid: string;
  nickname: string;
  avatarId: AvatarId;
  level: number;
  relation: FriendRelation;
  /** A amizade foi criada agora, por esta sincronização (sem solicitação). */
  autoConnected?: boolean;
}

export interface MatchPhoneContactsResult {
  matches: ContactMatch[];
  /** Quantos números ainda cabem na cota diária do usuário. */
  remainingQuota: number;
  /** Jogadores conectados automaticamente nesta chamada (sem repetir). */
  connected?: number;
  /** Encontrados que não conectaram porque a amizade tinha sido removida (só a contagem). */
  suppressed?: number;
}

/** Documento de `blocks/{uid}/blocked/{otherUid}`. */
export interface BlockedUser {
  id: string;
  since: number;
}

/** Convite por QR Code / link. O token nunca carrega telefone, só um id opaco. */
export interface FriendInviteToken {
  token: string;
  /** Deep link pronto para o QR Code: `trucomineiro://add-friend?token=...`. */
  link: string;
  expiresAt: number;
}
