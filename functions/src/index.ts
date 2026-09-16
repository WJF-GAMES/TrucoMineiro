import { setGlobalOptions } from 'firebase-functions/v2';
import { REGION } from './lib/admin';

setGlobalOptions({ region: REGION, maxInstances: 20 });

export {
  bootstrapUser,
  updateProfile,
  registerDevice,
  unregisterDevice,
  deleteAccount,
  onAuthUserDeleted,
  searchPlayers,
} from './users';
export {
  createRoom,
  createFriendRoom,
  joinRoom,
  respondRoomInvite,
  leaveRoom,
  setReady,
  fillRoomWithBots,
  startMatch,
  resolveLobbyTimeout,
  inviteToRoom,
  removeRoomInvite,
  sweepRooms,
} from './rooms';
export { startMatchmaking, cancelMatchmaking, onMatchmakingJoin } from './matchmaking';
export {
  submitGameAction,
  requestTruco,
  respondTruco,
  advanceBots,
  abandonMatch,
  rejoinMatch,
  claimReservedSeat,
} from './sessions';
export { finalizeMatch } from './matches';
export {
  sendFriendRequest,
  respondFriendRequest,
  cancelFriendRequest,
  removeFriend,
  blockUser,
  unblockUser,
  inviteFriendToRoom,
  onPresenceWritten,
} from './social';
export { matchPhoneContacts, createFriendInviteToken, resolveFriendInviteToken } from './contacts';
export {
  bootstrapLeagueSystemForUser,
  ensureUserLeagueAssignment,
  getLeagueScreenSnapshot,
  getGlobalLeagueRanking,
  leagueAdmin,
  finalizeWeeklyLeagues,
  refreshLeagueRankings,
} from './leagues';
export { seedCatalog, diagnostics } from './seed';
