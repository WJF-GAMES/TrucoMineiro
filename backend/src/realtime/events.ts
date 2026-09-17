/**
 * Contrato do WebSocket (Socket.IO, namespace `/rt`). Documentado em docs/websocket.md.
 * Cliente → servidor sempre com ack `{ ok: true, data } | { ok: false, error }`.
 */
export const WS_NAMESPACE = '/rt';

export const C2S = {
  sessionRefresh: 'session.refresh',
  presenceSet: 'presence.set',
  presenceSubscribe: 'presence.subscribe',
  presenceUnsubscribe: 'presence.unsubscribe',
  roomSubscribe: 'room.subscribe',
  roomUnsubscribe: 'room.unsubscribe',
  roomJoin: 'room.join',
  roomLeave: 'room.leave',
  roomReady: 'room.ready',
  roomInvite: 'room.invite',
  roomInviteAccept: 'room.invite.accept',
  roomInviteDecline: 'room.invite.decline',
  roomSync: 'room.sync',
  leagueSubscribe: 'league.subscribe',
  leagueUnsubscribe: 'league.unsubscribe',
  matchmakingSubscribe: 'matchmaking.subscribe',
  gameJoin: 'game.join',
  gameLeaveView: 'game.leave-view',
  gameSync: 'game.sync',
  gameAction: 'game.action',
  gamePlayCard: 'game.play-card',
  gamePlayCoveredCard: 'game.play-covered-card',
  gameTrucoRequest: 'game.truco.request',
  gameTrucoRespond: 'game.truco.respond',
  gameShuffle: 'game.shuffle',
  gameCut: 'game.cut',
  gameHandOfEleven: 'game.hand-of-eleven',
  gameAdvanceBots: 'game.advance-bots',
  gameReconnect: 'game.reconnect',
  gameAbandon: 'game.abandon',
  gameClaimSeat: 'game.claim-seat',
  ping: 'ping',
} as const;

export const S2C = {
  ready: 'session.ready',
  error: 'session.error',
  presenceChanged: 'presence.changed',
  onlineCount: 'stats.online',
  roomUpdated: 'room.updated',
  invitesUpdated: 'invites.updated',
  friendsChanged: 'friends.changed',
  friendRequestsChanged: 'friend-requests.changed',
  blocksChanged: 'blocks.changed',
  profileUpdated: 'user.profile',
  activeMatch: 'user.active-match',
  notification: 'user.notification',
  matchmakingUpdated: 'matchmaking.updated',
  leagueMembers: 'league.members',
  gameMeta: 'game.meta',
  gameView: 'game.view',
  gameResult: 'game.result',
} as const;

export const rooms = {
  user: (userId: string) => `user:${userId}`,
  presence: (firebaseUid: string) => `presence:${firebaseUid}`,
  room: (code: string) => `room:${code}`,
  match: (matchId: string) => `match:${matchId}`,
  matchSeat: (matchId: string, seat: number) => `match:${matchId}:seat:${seat}`,
  /** Sockets de um usuário vendo uma partida (em qualquer instância). */
  userMatch: (userId: string, matchId: string) => `user:${userId}:match:${matchId}`,
  league: (groupId: string) => `league:${groupId}`,
};

/** Mensagens entre instâncias (`serverSideEmit`, via adapter Redis). */
export const SERVER_EVENTS = {
  presenceReclaim: 'presence.reclaim',
} as const;
