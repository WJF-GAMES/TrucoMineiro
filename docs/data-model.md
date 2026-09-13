# Modelo de dados

Tipos em `src/domain/model/types.ts` (compartilhados com Functions).

## Firestore (persistente)
| Coleção | Doc | Campos principais | Escrita |
|---|---|---|---|
| users/{uid} | privado | createdAt, lastSeenAt, fcmTokens{token:{platform,updatedAt}}, phoneHash, inviteToken, inviteTokenExpiresAt | Functions |
| profiles/{uid} | público | nickname, nicknameLower, avatarId, countryCode, level, xp, xpToNext, leagueId (espelho de playerProgress), leaguePoints, coins, gems, ownedItems[], createdAt, updatedAt | Functions |
| playerStats/{uid} | público | matches, wins, losses, winRate, aiMatches, onlineMatches, trucosCalled, trucosAccepted, bestStreak, currentStreak, hardWins | Functions (progressão) |
| matchHistory/{matchId} | | mode, difficulty?, playerIds[], players[], scores, winnerTeam, handsPlayed, finishedAt — **lock de idempotência** | Functions |
| leagueDefinitions/{leagueId} | catálogo das 20 ligas | order, displayName, assetKey (`shield_<id>`), previousLeagueId, nextLeagueId, isFirst, isLast, active | seedCatalog / leagueAdmin |
| playerProgress/{uid} | privado do dono | currentLeagueId, currentDivision, currentWeekKey, currentLeagueGroupId, weeklyPoints, seasonPoints, lastWeeklyResult, lastWeeklyRank, lastProcessedWeekKey, lastActiveWeekKey | Functions (ligas) |
| weeklyLeagueGroups/{groupId} | id `2026-W37__gold__001` | leagueId, weekKey, division, status, memberCount, targetSize, promotionCount, relegationCount, startAt, endAt, finalizedAt | Functions (ligas) |
| weeklyLeagueGroups/{groupId}/members/{uid} | ranking da semana | nickname, avatarId, countryCode, weeklyPoints, wins, matches, tiebreakScore, currentRank, previousRank, joinedAt | Functions (ligas) |
| leagueHistory/{uid}/weeks/{weekKey} | privado do dono | leagueId, division, groupId, groupSize, finalRank, weeklyPoints, result, previousLeagueId, nextLeagueId, processedAt | Functions (ligas) |
| processedLeagueEvents/{matchId}__{uid}__{eventType} | ilegível por regra | **lock de idempotência** da pontuação semanal | Functions (ligas) |
| leagueProcessingLocks/{lockId} | ilegível por regra | token, acquiredAt, expiresAt (finalize / rebalance / repair) | Functions (ligas) |
| seasons/current | | name, subtitle, startsAt, endsAt | seedCatalog |
| achievements/{id} | catálogo | order, title, description, icon, target, stat | seedCatalog |
| userAchievements/{uid} | | unlocked{achievementId: unlockedAt} | Functions |
| friendships/{uid}/friends/{friendUid} | | since | Functions |
| friendRequests/{from}_{to} | id determinístico | from, to, fromNickname, fromAvatarId, toNickname, toAvatarId, status, createdAt | Functions |
| blocks/{uid}/blocked/{targetUid} | privado do dono | since | Functions |
| blockedBy/{uid}/users/{otherUid} | espelho, ilegível por regra | since | Functions |
| phoneIndex/{hmac} | ilegível por regra | uid, updatedAt — HMAC-SHA256(CONTACTS_PEPPER, E.164) | Functions |
| contactSync/{uid} | ilegível por regra | windowStart, calls, numbers (cota diária do match) | Functions |
| friendInviteTokens/{token} | ilegível por regra | uid, createdAt, expiresAt (QR / link de convite) | Functions |
| rewards/{uid}_{rewardId} | lock | coins, claimedAt | Functions |
| purchases/{uid}_{itemId} | | priceCoins, purchasedAt | Functions |

Índices: `firestore.indexes.json` (matchHistory playerIds+finishedAt; friendRequests to+status /
from+status; weeklyLeagueGroups leagueId+weekKey+memberCount e weekKey+status; playerProgress
currentLeagueId+lastProcessedWeekKey+lastActiveWeekKey e seasonPoints desc; weeks processedAt desc).

O sistema de ligas semanais (escada de 20 ligas, grupos, virada, promoção/rebaixamento) está
detalhado em `docs/leagues.md`.

### Diretório de telefones (busca de contatos)
O app **nunca** envia a agenda: manda só números em E.164, em lotes de até 200, para
`matchPhoneContacts`. O servidor calcula `HMAC-SHA256(CONTACTS_PEPPER, e164)` e consulta
`phoneIndex`; a resposta traz o *índice* do número na lista enviada, nunca o número.
O pepper vive só em `functions/.env` — não existe salt embutido no APK, então nem um vazamento
do Firestore nem uma cópia do app permitem reverter os hashes. `phoneIndex` é gravado no
`bootstrapUser` a partir do telefone do **Firebase Auth**, nunca de um payload do cliente.
Limites por usuário: 200 números/chamada, 40 chamadas e 3.000 números por dia.
Nome, e-mail e foto dos contatos ficam no aparelho; o cache local (`trucox.contacts.sync.v1.{uid}`)
guarda nome + uid + um hash de 32 bits da agenda, nunca telefones.

## Realtime Database (alta frequência / efêmero)
```
presence/{uid}                     {state: online|in_match|offline, lastChanged, sessionId?}   (cliente escreve o próprio; onDisconnect)
stats/onlineCount                  número (mantido pelo trigger onPresenceWritten)
matchmaking/queue/{uid}            {uid, nickname, avatarId, joinedAt, status, sessionId?, roomCode?}
rooms/{code}                       {code, hostUid, status, maxPlayers, players{uid:{seat,nickname,avatarId,ready,bot,joinedAt,connected}}, sessionId, source}
userRooms/{uid}                    código da sala atual
userSessions/{uid}/active          id da sessão em andamento (restaurar após reconexão)
invites/{uid}/{code}               {code, from, fromNickname, createdAt} — convite de sala de um amigo (dono lê e apaga; só Functions escrevem)
gameSessions/{id}/meta             {roomCode, mode, status, players{seat:{uid,seat,nickname,avatarId,bot,connected}}, winnerTeam, abandonedBy}
gameSessions/{id}/state            MatchState completo + appliedActionIds + aiRngState + trucos — SEM leitura por cliente
gameSessions/{id}/views/{seat}     SeatView (cartas do próprio assento, contagens dos demais, ações disponíveis, recentEvents)
```
