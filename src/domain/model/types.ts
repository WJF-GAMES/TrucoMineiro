/**
 * Persistent data model shared by the app and Cloud Functions (kept framework-free).
 * Firestore documents carry their id in `id` after being read.
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

export type LeagueId = 'bronze' | 'prata' | 'ouro' | 'diamante';

export interface Profile {
  id: string;
  nickname: string;
  nicknameLower: string;
  avatarId: AvatarId;
  level: number;
  xp: number;
  xpToNext: number;
  leagueId: LeagueId;
  leaguePoints: number;
  coins: number;
  gems: number;
  ownedItems?: string[];
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

export interface League {
  id: LeagueId;
  name: string;
  order: number;
  minPoints: number;
  maxPoints: number | null;
  nextLeagueId: LeagueId | null;
  rewardCoins: number;
}

export interface Season {
  id: string;
  name: string;
  subtitle: string;
  startsAt: number;
  endsAt: number;
}

export interface Friendship {
  id: string; // friend uid
  since: number;
}

export interface FriendRequest {
  id: string;
  from: string;
  to: string;
  fromNickname: string;
  fromAvatarId: AvatarId;
  status: 'pending' | 'accepted' | 'declined';
  createdAt: number;
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
}

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
  coinsGained: number;
  leaguePointsDelta: number;
  leveledUp: boolean;
  newLevel: number;
  newLeagueId: LeagueId;
  promoted: boolean;
}

export const LEVEL_XP_BASE = 300;
export function xpForLevel(level: number): number {
  return LEVEL_XP_BASE + (level - 1) * 100;
}
