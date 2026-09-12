# Modelo de dados

Tipos em `src/domain/model/types.ts` (compartilhados com Functions).

## Firestore (persistente)
| Coleção | Doc | Campos principais | Escrita |
|---|---|---|---|
| users/{uid} | privado | createdAt, lastSeenAt, fcmTokens{token:{platform,updatedAt}} | Functions |
| profiles/{uid} | público | nickname, nicknameLower, avatarId, level, xp, xpToNext, leagueId, leaguePoints, coins, gems, ownedItems[], createdAt, updatedAt | Functions |
| playerStats/{uid} | público | matches, wins, losses, winRate, aiMatches, onlineMatches, trucosCalled, trucosAccepted, bestStreak, currentStreak, hardWins | Functions (progressão) |
| matchHistory/{matchId} | | mode, difficulty?, playerIds[], players[], scores, winnerTeam, handsPlayed, finishedAt — **lock de idempotência** | Functions |
| leagues/{id} | catálogo | name, order, minPoints, maxPoints, nextLeagueId, rewardCoins | seedCatalog |
| seasons/current | | name, subtitle, startsAt, endsAt | seedCatalog |
| achievements/{id} | catálogo | order, title, description, icon, target, stat | seedCatalog |
| userAchievements/{uid} | | unlocked{achievementId: unlockedAt} | Functions |
| friendships/{uid}/friends/{friendUid} | | since | Functions |
| friendRequests/{id} | | from, to, fromNickname, fromAvatarId, status, createdAt | Functions |
| rewards/{uid}_{rewardId} | lock | coins, claimedAt | Functions |
| purchases/{uid}_{itemId} | | priceCoins, purchasedAt | Functions |

Índices: `firestore.indexes.json` (matchHistory playerIds+finishedAt; friendRequests to+status / from+to+status).

## Realtime Database (alta frequência / efêmero)
```
presence/{uid}                     {state: online|in_match|offline, lastChanged, sessionId?}   (cliente escreve o próprio; onDisconnect)
stats/onlineCount                  número (mantido pelo trigger onPresenceWritten)
matchmaking/queue/{uid}            {uid, nickname, avatarId, joinedAt, status, sessionId?, roomCode?}
rooms/{code}                       {code, hostUid, status, maxPlayers, players{uid:{seat,nickname,avatarId,ready,bot,joinedAt,connected}}, sessionId, source}
userRooms/{uid}                    código da sala atual
userSessions/{uid}/active          id da sessão em andamento (restaurar após reconexão)
invites/{uid}/{code}               convites de sala
gameSessions/{id}/meta             {roomCode, mode, status, players{seat:{uid,seat,nickname,avatarId,bot,connected}}, winnerTeam, abandonedBy}
gameSessions/{id}/state            MatchState completo + appliedActionIds + aiRngState + trucos — SEM leitura por cliente
gameSessions/{id}/views/{seat}     SeatView (cartas do próprio assento, contagens dos demais, ações disponíveis, recentEvents)
```
