import { setGlobalOptions } from 'firebase-functions/v2';
import { REGION } from './lib/admin';

setGlobalOptions({ region: REGION, maxInstances: 20 });

export { bootstrapUser, updateProfile, registerDevice, deleteAccount } from './users';
export { createRoom, joinRoom, leaveRoom, setReady, fillRoomWithBots, startMatch } from './rooms';
export { startMatchmaking, cancelMatchmaking, onMatchmakingJoin } from './matchmaking';
export {
  submitGameAction,
  requestTruco,
  respondTruco,
  advanceBots,
  abandonMatch,
  rejoinMatch,
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
