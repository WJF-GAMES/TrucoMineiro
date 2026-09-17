-- CreateEnum
CREATE TYPE "FriendshipSource" AS ENUM ('MANUAL', 'PHONE_CONTACT');

-- CreateEnum
CREATE TYPE "FriendRequestStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED');

-- CreateEnum
CREATE TYPE "SuppressionReason" AS ENUM ('REMOVED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "PresenceState" AS ENUM ('ONLINE', 'OFFLINE', 'IN_ROOM', 'IN_MATCH', 'BACKGROUND', 'RECONNECTING');

-- CreateEnum
CREATE TYPE "RoomStatus" AS ENUM ('WAITING', 'STARTING', 'IN_MATCH', 'CLOSED');

-- CreateEnum
CREATE TYPE "RoomSource" AS ENUM ('PRIVATE', 'MATCHMAKING');

-- CreateEnum
CREATE TYPE "RoomClosedReason" AS ENUM ('CANCELLED', 'FINISHED', 'ABANDONED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "RoomFillPolicy" AS ENUM ('ON_TIMEOUT', 'MANUAL');

-- CreateEnum
CREATE TYPE "RoomInviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'AI_FILLED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MatchmakingStatus" AS ENUM ('SEARCHING', 'FOUND', 'PREPARING', 'READY', 'CANCELLED', 'TIMEOUT', 'ERROR');

-- CreateEnum
CREATE TYPE "MatchMode" AS ENUM ('ONLINE', 'AI');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('PREPARING', 'PLAYING', 'FINISHED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "SeatController" AS ENUM ('HUMAN', 'AI_TEMPORARY', 'AI_PERMANENT');

-- CreateEnum
CREATE TYPE "AiDifficulty" AS ENUM ('EASY', 'NORMAL', 'HARD');

-- CreateEnum
CREATE TYPE "ActorKind" AS ENUM ('HUMAN', 'AI', 'TIMEOUT');

-- CreateEnum
CREATE TYPE "LeagueGroupStatus" AS ENUM ('FORMING', 'ACTIVE', 'FINALIZING', 'FINALIZED');

-- CreateEnum
CREATE TYPE "LeagueSeasonStatus" AS ENUM ('ACTIVE', 'FINALIZING', 'FINALIZED');

-- CreateEnum
CREATE TYPE "WeeklyResult" AS ENUM ('PROMOTED', 'STAYED', 'RELEGATED', 'TOP_LEAGUE', 'BOTTOM_LEAGUE');

-- CreateEnum
CREATE TYPE "LeagueScoreEvent" AS ENUM ('MATCH_WIN', 'MATCH_LOSS', 'BONUS');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('FRIEND_REQUEST', 'ROOM_INVITE', 'REWARD', 'LEAGUE', 'SYSTEM');

-- CreateEnum
CREATE TYPE "PushStatus" AS ENUM ('PENDING', 'SENT', 'NO_DEVICE', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "WebhookStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED', 'REJECTED');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "firebaseUid" VARCHAR(128) NOT NULL,
    "phoneHash" CHAR(64),
    "countryCode" VARCHAR(2) NOT NULL DEFAULT 'BR',
    "inviteToken" VARCHAR(64),
    "inviteTokenExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserProfile" (
    "userId" UUID NOT NULL,
    "nickname" VARCHAR(16) NOT NULL DEFAULT '',
    "nicknameLower" VARCHAR(16) NOT NULL DEFAULT '',
    "avatarId" VARCHAR(24) NOT NULL DEFAULT 'joao',
    "level" INTEGER NOT NULL DEFAULT 1,
    "xp" INTEGER NOT NULL DEFAULT 0,
    "xpToNext" INTEGER NOT NULL DEFAULT 300,
    "leagueId" VARCHAR(24) NOT NULL DEFAULT 'bronze',
    "leaguePoints" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserProfile_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "PlayerStatistics" (
    "userId" UUID NOT NULL,
    "matches" INTEGER NOT NULL DEFAULT 0,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "winRate" INTEGER NOT NULL DEFAULT 0,
    "aiMatches" INTEGER NOT NULL DEFAULT 0,
    "onlineMatches" INTEGER NOT NULL DEFAULT 0,
    "trucosCalled" INTEGER NOT NULL DEFAULT 0,
    "trucosAccepted" INTEGER NOT NULL DEFAULT 0,
    "bestStreak" INTEGER NOT NULL DEFAULT 0,
    "currentStreak" INTEGER NOT NULL DEFAULT 0,
    "hardWins" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayerStatistics_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "UserDevice" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "token" VARCHAR(4096) NOT NULL,
    "platform" VARCHAR(20) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPresence" (
    "userId" UUID NOT NULL,
    "state" "PresenceState" NOT NULL DEFAULT 'OFFLINE',
    "matchId" UUID,
    "roomCode" VARCHAR(6),
    "instanceId" VARCHAR(64),
    "sockets" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPresence_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "BackendInstance" (
    "id" VARCHAR(64) NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "heartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BackendInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Friendship" (
    "userAId" UUID NOT NULL,
    "userBId" UUID NOT NULL,
    "source" "FriendshipSource" NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Friendship_pkey" PRIMARY KEY ("userAId","userBId")
);

-- CreateTable
CREATE TABLE "FriendRequest" (
    "id" UUID NOT NULL,
    "fromUserId" UUID NOT NULL,
    "toUserId" UUID NOT NULL,
    "status" "FriendRequestStatus" NOT NULL DEFAULT 'PENDING',
    "resolvedBy" "FriendshipSource",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FriendRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlockedUser" (
    "blockerId" UUID NOT NULL,
    "blockedId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BlockedUser_pkey" PRIMARY KEY ("blockerId","blockedId")
);

-- CreateTable
CREATE TABLE "FriendshipSuppression" (
    "userId" UUID NOT NULL,
    "otherUserId" UUID NOT NULL,
    "reason" "SuppressionReason" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FriendshipSuppression_pkey" PRIMARY KEY ("userId","otherUserId")
);

-- CreateTable
CREATE TABLE "ContactSyncQuota" (
    "userId" UUID NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "calls" INTEGER NOT NULL DEFAULT 0,
    "numbers" INTEGER NOT NULL DEFAULT 0,
    "connected" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContactSyncQuota_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "Room" (
    "id" UUID NOT NULL,
    "code" CHAR(6) NOT NULL,
    "hostUserId" UUID NOT NULL,
    "status" "RoomStatus" NOT NULL DEFAULT 'WAITING',
    "source" "RoomSource" NOT NULL DEFAULT 'PRIVATE',
    "fillPolicy" "RoomFillPolicy",
    "closedReason" "RoomClosedReason",
    "inviteExpiresAt" TIMESTAMP(3),
    "lateJoinUntil" TIMESTAMP(3),
    "currentMatchId" UUID,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoomSeat" (
    "roomId" UUID NOT NULL,
    "seat" SMALLINT NOT NULL,
    "userId" UUID,
    "botKey" VARCHAR(64),
    "nickname" VARCHAR(40) NOT NULL,
    "avatarId" VARCHAR(24) NOT NULL,
    "ready" BOOLEAN NOT NULL DEFAULT false,
    "isBot" BOOLEAN NOT NULL DEFAULT false,
    "connected" BOOLEAN NOT NULL DEFAULT true,
    "reservedForUserId" UUID,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoomSeat_pkey" PRIMARY KEY ("roomId","seat")
);

-- CreateTable
CREATE TABLE "RoomInvite" (
    "id" UUID NOT NULL,
    "roomId" UUID NOT NULL,
    "inviteeUserId" UUID NOT NULL,
    "inviterUserId" UUID NOT NULL,
    "seat" SMALLINT,
    "status" "RoomInviteStatus" NOT NULL DEFAULT 'PENDING',
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "dismissedAt" TIMESTAMP(3),
    "pushSentAt" TIMESTAMP(3),

    CONSTRAINT "RoomInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchmakingTicket" (
    "userId" UUID NOT NULL,
    "status" "MatchmakingStatus" NOT NULL DEFAULT 'SEARCHING',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "matchId" UUID,
    "roomCode" VARCHAR(6),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MatchmakingTicket_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "MatchSeries" (
    "id" UUID NOT NULL,
    "bestOf" SMALLINT NOT NULL DEFAULT 1,
    "winsTeam0" SMALLINT NOT NULL DEFAULT 0,
    "winsTeam1" SMALLINT NOT NULL DEFAULT 0,
    "winner" SMALLINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MatchSeries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Match" (
    "id" UUID NOT NULL,
    "mode" "MatchMode" NOT NULL,
    "status" "MatchStatus" NOT NULL DEFAULT 'PLAYING',
    "difficulty" "AiDifficulty",
    "roomId" UUID,
    "seriesId" UUID,
    "seriesGame" SMALLINT NOT NULL DEFAULT 1,
    "state" JSONB,
    "stateVersion" INTEGER NOT NULL DEFAULT 0,
    "targetScore" SMALLINT NOT NULL DEFAULT 12,
    "scoreTeam0" SMALLINT NOT NULL DEFAULT 0,
    "scoreTeam1" SMALLINT NOT NULL DEFAULT 0,
    "winnerTeam" SMALLINT,
    "handsPlayed" INTEGER NOT NULL DEFAULT 0,
    "abandonedByUserId" UUID,
    "externalKey" VARCHAR(160),
    "seed" BIGINT,
    "aiSeed" BIGINT,
    "turnStartedAt" TIMESTAMP(3),
    "turnDeadlineAt" TIMESTAMP(3),
    "nextTickAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "Match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchParticipant" (
    "matchId" UUID NOT NULL,
    "seat" SMALLINT NOT NULL,
    "team" SMALLINT NOT NULL,
    "userId" UUID,
    "botKey" VARCHAR(64),
    "nickname" VARCHAR(40) NOT NULL,
    "avatarId" VARCHAR(24) NOT NULL,
    "controller" "SeatController" NOT NULL DEFAULT 'HUMAN',
    "controllerVersion" INTEGER NOT NULL DEFAULT 0,
    "connected" BOOLEAN NOT NULL DEFAULT true,
    "disconnectedAt" TIMESTAMP(3),
    "reservedForUserId" UUID,
    "pendingUserId" UUID,
    "replacedUserId" UUID,
    "trucosCalled" INTEGER NOT NULL DEFAULT 0,
    "trucosAccepted" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MatchParticipant_pkey" PRIMARY KEY ("matchId","seat")
);

-- CreateTable
CREATE TABLE "GameAction" (
    "id" BIGSERIAL NOT NULL,
    "matchId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "clientActionId" VARCHAR(200) NOT NULL,
    "seat" SMALLINT NOT NULL,
    "actor" "ActorKind" NOT NULL,
    "userId" UUID,
    "type" VARCHAR(32) NOT NULL,
    "payload" JSONB,
    "stateVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameHand" (
    "matchId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "dealerSeat" SMALLINT NOT NULL,
    "value" SMALLINT NOT NULL,
    "winnerTeam" SMALLINT,
    "points" SMALLINT NOT NULL DEFAULT 0,
    "reason" VARCHAR(32),
    "scoreTeam0" SMALLINT NOT NULL DEFAULT 0,
    "scoreTeam1" SMALLINT NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "GameHand_pkey" PRIMARY KEY ("matchId","number")
);

-- CreateTable
CREATE TABLE "GameTrick" (
    "matchId" UUID NOT NULL,
    "handNumber" INTEGER NOT NULL,
    "round" SMALLINT NOT NULL,
    "winnerTeam" SMALLINT,
    "winnerSeat" SMALLINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameTrick_pkey" PRIMARY KEY ("matchId","handNumber","round")
);

-- CreateTable
CREATE TABLE "MatchEvent" (
    "id" BIGSERIAL NOT NULL,
    "matchId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "type" VARCHAR(32) NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchResult" (
    "id" UUID NOT NULL,
    "key" VARCHAR(200) NOT NULL,
    "matchId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "seat" SMALLINT NOT NULL,
    "won" BOOLEAN NOT NULL,
    "forfeit" BOOLEAN NOT NULL DEFAULT false,
    "scoreTeam0" SMALLINT NOT NULL,
    "scoreTeam1" SMALLINT NOT NULL,
    "winnerTeam" SMALLINT NOT NULL,
    "xpGained" INTEGER NOT NULL,
    "leaguePointsDelta" INTEGER NOT NULL,
    "leveledUp" BOOLEAN NOT NULL DEFAULT false,
    "newLevel" INTEGER NOT NULL,
    "newLeagueId" VARCHAR(24) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Achievement" (
    "id" VARCHAR(40) NOT NULL,
    "order" INTEGER NOT NULL,
    "title" VARCHAR(80) NOT NULL,
    "description" VARCHAR(200) NOT NULL,
    "icon" VARCHAR(40) NOT NULL,
    "target" INTEGER NOT NULL,
    "stat" VARCHAR(40) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Achievement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserAchievement" (
    "userId" UUID NOT NULL,
    "achievementId" VARCHAR(40) NOT NULL,
    "unlockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserAchievement_pkey" PRIMARY KEY ("userId","achievementId")
);

-- CreateTable
CREATE TABLE "League" (
    "id" VARCHAR(24) NOT NULL,
    "order" INTEGER NOT NULL,
    "displayName" VARCHAR(40) NOT NULL,
    "assetKey" VARCHAR(40) NOT NULL,
    "previousLeagueId" VARCHAR(24),
    "nextLeagueId" VARCHAR(24),
    "isFirst" BOOLEAN NOT NULL DEFAULT false,
    "isLast" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "League_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeagueSeason" (
    "weekKey" VARCHAR(8) NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "status" "LeagueSeasonStatus" NOT NULL DEFAULT 'ACTIVE',
    "finalizedAt" TIMESTAMP(3),
    "preparedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeagueSeason_pkey" PRIMARY KEY ("weekKey")
);

-- CreateTable
CREATE TABLE "LeagueGroup" (
    "id" VARCHAR(48) NOT NULL,
    "weekKey" VARCHAR(8) NOT NULL,
    "leagueId" VARCHAR(24) NOT NULL,
    "division" INTEGER NOT NULL,
    "status" "LeagueGroupStatus" NOT NULL DEFAULT 'ACTIVE',
    "memberCount" INTEGER NOT NULL DEFAULT 0,
    "targetSize" INTEGER NOT NULL DEFAULT 20,
    "promotionCount" INTEGER NOT NULL DEFAULT 0,
    "relegationCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "finalizedAt" TIMESTAMP(3),

    CONSTRAINT "LeagueGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeagueMembership" (
    "id" UUID NOT NULL,
    "groupId" VARCHAR(48) NOT NULL,
    "userId" UUID NOT NULL,
    "weekKey" VARCHAR(8) NOT NULL,
    "weeklyPoints" INTEGER NOT NULL DEFAULT 0,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "matches" INTEGER NOT NULL DEFAULT 0,
    "tiebreakScore" INTEGER NOT NULL DEFAULT 0,
    "currentRank" INTEGER NOT NULL DEFAULT 0,
    "previousRank" INTEGER NOT NULL DEFAULT 0,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeagueMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeagueProgress" (
    "userId" UUID NOT NULL,
    "currentLeagueId" VARCHAR(24) NOT NULL DEFAULT 'bronze',
    "currentDivision" INTEGER NOT NULL DEFAULT 1,
    "currentWeekKey" VARCHAR(8) NOT NULL,
    "currentGroupId" VARCHAR(48),
    "weeklyPoints" INTEGER NOT NULL DEFAULT 0,
    "seasonPoints" INTEGER NOT NULL DEFAULT 0,
    "lastWeeklyResult" "WeeklyResult",
    "lastWeeklyRank" INTEGER,
    "lastProcessedWeekKey" VARCHAR(8),
    "lastActiveWeekKey" VARCHAR(8),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeagueProgress_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "LeagueScore" (
    "id" BIGSERIAL NOT NULL,
    "key" VARCHAR(240) NOT NULL,
    "userId" UUID NOT NULL,
    "groupId" VARCHAR(48) NOT NULL,
    "weekKey" VARCHAR(8) NOT NULL,
    "matchId" VARCHAR(160),
    "event" "LeagueScoreEvent" NOT NULL,
    "points" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeagueScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeagueWeekResult" (
    "userId" UUID NOT NULL,
    "weekKey" VARCHAR(8) NOT NULL,
    "leagueId" VARCHAR(24) NOT NULL,
    "division" INTEGER NOT NULL,
    "groupId" VARCHAR(48) NOT NULL,
    "groupSize" INTEGER NOT NULL,
    "finalRank" INTEGER NOT NULL,
    "weeklyPoints" INTEGER NOT NULL,
    "result" "WeeklyResult" NOT NULL,
    "previousLeagueId" VARCHAR(24) NOT NULL,
    "nextLeagueId" VARCHAR(24) NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeagueWeekResult_pkey" PRIMARY KEY ("userId","weekKey")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "body" VARCHAR(400) NOT NULL,
    "data" JSONB,
    "collapseKey" VARCHAR(160),
    "pushStatus" "PushStatus" NOT NULL DEFAULT 'PENDING',
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" UUID NOT NULL,
    "provider" VARCHAR(40) NOT NULL,
    "externalEventId" VARCHAR(200) NOT NULL,
    "type" VARCHAR(80) NOT NULL,
    "status" "WebhookStatus" NOT NULL DEFAULT 'RECEIVED',
    "attemptCount" INTEGER NOT NULL DEFAULT 1,
    "error" VARCHAR(500),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyKey" (
    "key" VARCHAR(120) NOT NULL,
    "userId" UUID NOT NULL,
    "route" VARCHAR(160) NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "response" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("userId","key")
);

-- CreateTable
CREATE TABLE "JobLock" (
    "id" VARCHAR(120) NOT NULL,
    "token" VARCHAR(80) NOT NULL,
    "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobLock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimitBucket" (
    "userId" UUID NOT NULL,
    "key" VARCHAR(160) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "windowStart" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("userId","key")
);

-- CreateTable
CREATE TABLE "MigrationRecord" (
    "source" VARCHAR(60) NOT NULL,
    "sourceId" VARCHAR(300) NOT NULL,
    "checksum" CHAR(64) NOT NULL,
    "migratedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MigrationRecord_pkey" PRIMARY KEY ("source","sourceId")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_firebaseUid_key" ON "User"("firebaseUid");

-- CreateIndex
CREATE UNIQUE INDEX "User_phoneHash_key" ON "User"("phoneHash");

-- CreateIndex
CREATE UNIQUE INDEX "User_inviteToken_key" ON "User"("inviteToken");

-- CreateIndex
CREATE INDEX "UserProfile_nicknameLower_idx" ON "UserProfile"("nicknameLower");

-- CreateIndex
CREATE UNIQUE INDEX "UserDevice_token_key" ON "UserDevice"("token");

-- CreateIndex
CREATE INDEX "UserDevice_userId_idx" ON "UserDevice"("userId");

-- CreateIndex
CREATE INDEX "UserPresence_state_idx" ON "UserPresence"("state");

-- CreateIndex
CREATE INDEX "UserPresence_instanceId_idx" ON "UserPresence"("instanceId");

-- CreateIndex
CREATE INDEX "Friendship_userBId_idx" ON "Friendship"("userBId");

-- CreateIndex
CREATE INDEX "FriendRequest_toUserId_status_idx" ON "FriendRequest"("toUserId", "status");

-- CreateIndex
CREATE INDEX "FriendRequest_fromUserId_status_idx" ON "FriendRequest"("fromUserId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "FriendRequest_fromUserId_toUserId_key" ON "FriendRequest"("fromUserId", "toUserId");

-- CreateIndex
CREATE INDEX "BlockedUser_blockedId_idx" ON "BlockedUser"("blockedId");

-- CreateIndex
CREATE INDEX "FriendshipSuppression_otherUserId_idx" ON "FriendshipSuppression"("otherUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Room_code_key" ON "Room"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Room_currentMatchId_key" ON "Room"("currentMatchId");

-- CreateIndex
CREATE INDEX "Room_status_updatedAt_idx" ON "Room"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "Room_hostUserId_idx" ON "Room"("hostUserId");

-- CreateIndex
CREATE INDEX "RoomSeat_userId_idx" ON "RoomSeat"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "RoomSeat_roomId_userId_key" ON "RoomSeat"("roomId", "userId");

-- CreateIndex
CREATE INDEX "RoomInvite_inviteeUserId_dismissedAt_idx" ON "RoomInvite"("inviteeUserId", "dismissedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RoomInvite_roomId_inviteeUserId_key" ON "RoomInvite"("roomId", "inviteeUserId");

-- CreateIndex
CREATE INDEX "MatchmakingTicket_status_joinedAt_idx" ON "MatchmakingTicket"("status", "joinedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Match_externalKey_key" ON "Match"("externalKey");

-- CreateIndex
CREATE INDEX "Match_status_nextTickAt_idx" ON "Match"("status", "nextTickAt");

-- CreateIndex
CREATE INDEX "Match_roomId_idx" ON "Match"("roomId");

-- CreateIndex
CREATE INDEX "MatchParticipant_userId_idx" ON "MatchParticipant"("userId");

-- CreateIndex
CREATE INDEX "MatchParticipant_pendingUserId_idx" ON "MatchParticipant"("pendingUserId");

-- CreateIndex
CREATE UNIQUE INDEX "GameAction_matchId_clientActionId_key" ON "GameAction"("matchId", "clientActionId");

-- CreateIndex
CREATE UNIQUE INDEX "GameAction_matchId_sequence_key" ON "GameAction"("matchId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "MatchEvent_matchId_sequence_key" ON "MatchEvent"("matchId", "sequence");

-- CreateIndex
CREATE INDEX "MatchResult_userId_createdAt_idx" ON "MatchResult"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "MatchResult_matchId_idx" ON "MatchResult"("matchId");

-- CreateIndex
CREATE UNIQUE INDEX "MatchResult_key_userId_key" ON "MatchResult"("key", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Achievement_order_key" ON "Achievement"("order");

-- CreateIndex
CREATE UNIQUE INDEX "League_order_key" ON "League"("order");

-- CreateIndex
CREATE INDEX "LeagueGroup_weekKey_leagueId_status_idx" ON "LeagueGroup"("weekKey", "leagueId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "LeagueGroup_weekKey_leagueId_division_key" ON "LeagueGroup"("weekKey", "leagueId", "division");

-- CreateIndex
CREATE UNIQUE INDEX "LeagueMembership_userId_weekKey_key" ON "LeagueMembership"("userId", "weekKey");

-- CreateIndex
CREATE UNIQUE INDEX "LeagueMembership_groupId_userId_key" ON "LeagueMembership"("groupId", "userId");

-- CreateIndex
CREATE INDEX "LeagueProgress_seasonPoints_userId_idx" ON "LeagueProgress"("seasonPoints" DESC, "userId");

-- CreateIndex
CREATE INDEX "LeagueProgress_currentLeagueId_lastProcessedWeekKey_lastAct_idx" ON "LeagueProgress"("currentLeagueId", "lastProcessedWeekKey", "lastActiveWeekKey");

-- CreateIndex
CREATE UNIQUE INDEX "LeagueScore_key_key" ON "LeagueScore"("key");

-- CreateIndex
CREATE INDEX "LeagueScore_userId_weekKey_idx" ON "LeagueScore"("userId", "weekKey");

-- CreateIndex
CREATE INDEX "LeagueWeekResult_userId_processedAt_idx" ON "LeagueWeekResult"("userId", "processedAt" DESC);

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "WebhookEvent_status_receivedAt_idx" ON "WebhookEvent"("status", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_provider_externalEventId_key" ON "WebhookEvent"("provider", "externalEventId");

-- CreateIndex
CREATE INDEX "IdempotencyKey_expiresAt_idx" ON "IdempotencyKey"("expiresAt");

-- AddForeignKey
ALTER TABLE "UserProfile" ADD CONSTRAINT "UserProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserProfile" ADD CONSTRAINT "UserProfile_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerStatistics" ADD CONSTRAINT "PlayerStatistics_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserDevice" ADD CONSTRAINT "UserDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPresence" ADD CONSTRAINT "UserPresence_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Friendship" ADD CONSTRAINT "Friendship_userAId_fkey" FOREIGN KEY ("userAId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Friendship" ADD CONSTRAINT "Friendship_userBId_fkey" FOREIGN KEY ("userBId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FriendRequest" ADD CONSTRAINT "FriendRequest_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FriendRequest" ADD CONSTRAINT "FriendRequest_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlockedUser" ADD CONSTRAINT "BlockedUser_blockerId_fkey" FOREIGN KEY ("blockerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlockedUser" ADD CONSTRAINT "BlockedUser_blockedId_fkey" FOREIGN KEY ("blockedId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FriendshipSuppression" ADD CONSTRAINT "FriendshipSuppression_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FriendshipSuppression" ADD CONSTRAINT "FriendshipSuppression_otherUserId_fkey" FOREIGN KEY ("otherUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactSyncQuota" ADD CONSTRAINT "ContactSyncQuota_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Room" ADD CONSTRAINT "Room_hostUserId_fkey" FOREIGN KEY ("hostUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Room" ADD CONSTRAINT "Room_currentMatchId_fkey" FOREIGN KEY ("currentMatchId") REFERENCES "Match"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomSeat" ADD CONSTRAINT "RoomSeat_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomSeat" ADD CONSTRAINT "RoomSeat_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomSeat" ADD CONSTRAINT "RoomSeat_reservedForUserId_fkey" FOREIGN KEY ("reservedForUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomInvite" ADD CONSTRAINT "RoomInvite_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomInvite" ADD CONSTRAINT "RoomInvite_inviteeUserId_fkey" FOREIGN KEY ("inviteeUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomInvite" ADD CONSTRAINT "RoomInvite_inviterUserId_fkey" FOREIGN KEY ("inviterUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchmakingTicket" ADD CONSTRAINT "MatchmakingTicket_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "MatchSeries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchParticipant" ADD CONSTRAINT "MatchParticipant_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchParticipant" ADD CONSTRAINT "MatchParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameAction" ADD CONSTRAINT "GameAction_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameHand" ADD CONSTRAINT "GameHand_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameTrick" ADD CONSTRAINT "GameTrick_matchId_handNumber_fkey" FOREIGN KEY ("matchId", "handNumber") REFERENCES "GameHand"("matchId", "number") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchEvent" ADD CONSTRAINT "MatchEvent_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchResult" ADD CONSTRAINT "MatchResult_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchResult" ADD CONSTRAINT "MatchResult_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAchievement" ADD CONSTRAINT "UserAchievement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAchievement" ADD CONSTRAINT "UserAchievement_achievementId_fkey" FOREIGN KEY ("achievementId") REFERENCES "Achievement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueGroup" ADD CONSTRAINT "LeagueGroup_weekKey_fkey" FOREIGN KEY ("weekKey") REFERENCES "LeagueSeason"("weekKey") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueGroup" ADD CONSTRAINT "LeagueGroup_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueMembership" ADD CONSTRAINT "LeagueMembership_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "LeagueGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueMembership" ADD CONSTRAINT "LeagueMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueProgress" ADD CONSTRAINT "LeagueProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueProgress" ADD CONSTRAINT "LeagueProgress_currentLeagueId_fkey" FOREIGN KEY ("currentLeagueId") REFERENCES "League"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueScore" ADD CONSTRAINT "LeagueScore_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueWeekResult" ADD CONSTRAINT "LeagueWeekResult_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdempotencyKey" ADD CONSTRAINT "IdempotencyKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateLimitBucket" ADD CONSTRAINT "RateLimitBucket_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
