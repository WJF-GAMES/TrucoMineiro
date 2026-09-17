# Modelo de dados

A fonte de verdade é o **PostgreSQL 17** do backend (`backend/prisma/schema.prisma`, acessado por
Prisma 6). Este documento resume o modelo; colunas, índices, migrations, conexão local e rotinas de
banco estão em **docs/database.md**. Firestore e Realtime Database não guardam mais nada (regras
*deny-all*, ver docs/firebase.md).

Os tipos que o app e o servidor trocam continuam em `src/domain/model/types.ts` (compartilhados com
o backend pela cópia `backend/src/domain`). A API converte as linhas relacionais nesses tipos: o app
não conhece UUIDs internos nem enums em maiúsculas.

## Identidade
- `User.id` é UUID interno; o identificador público exposto pela API é o **UID do Firebase**
  (`User.firebaseUid`, campo `uid` nos payloads). Todo o resto referencia o UUID.
- `User.phoneHash` = `HMAC-SHA256(CONTACTS_PEPPER, E.164)` do telefone verificado no Auth — nunca o número.
- `User.inviteToken` / `inviteTokenExpiresAt`: token opaco do QR de amizade (sem telefone, sem uid).
- Apagar o `User` apaga em cascata o que é só dele; partidas dos outros mantêm o histórico
  (`MatchParticipant.userId` vira nulo).

## Tabelas (resumo)

| Grupo | Tabelas | Observações |
|---|---|---|
| Usuário | `User`, `UserProfile`, `PlayerStatistics`, `UserDevice` | Perfil: nickname/nicknameLower, avatarId, level, xp, xpToNext, `leagueId` (espelho de `LeagueProgress`), leaguePoints. `UserDevice.token` (FCM) é único: trocar de conta move o token. |
| Presença | `UserPresence`, `BackendInstance` | Estado atual por usuário (`ONLINE`, `IN_ROOM`, `IN_MATCH`, `BACKGROUND`, `RECONNECTING`, `OFFLINE`) + instância dona; escrito só em mudança. `BackendInstance` = heartbeat de cada instância (30 s). |
| Amigos | `Friendship`, `FriendRequest`, `BlockedUser`, `FriendshipSuppression`, `ContactSyncQuota` | `Friendship` tem **uma linha por par** (`userAId < userBId`) e `source` (`MANUAL` \| `PHONE_CONTACT`). `FriendRequest` é único por (de, para), com `resolvedBy` quando a agenda conectou. Supressão = "não reconectar pela agenda" (`REMOVED` \| `BLOCKED`). |
| Salas | `Room`, `RoomSeat`, `RoomInvite`, `MatchmakingTicket` | Sala com código de 6 caracteres, `status`, `source` (`PRIVATE` \| `MATCHMAKING`), `fillPolicy`, `inviteExpiresAt`, `lateJoinUntil`, `currentMatchId`, `version`. Assento: humano ou IA (`isBot`, `botKey`), `reservedForUserId`. `RoomInvite` é também a caixa de entrada do convidado (até `dismissedAt`); `seat` preenchido = vaga reservada. |
| Partidas | `Match`, `MatchParticipant`, `GameAction`, `GameHand`, `GameTrick`, `MatchEvent`, `MatchResult`, `MatchSeries` | `Match.state` (JSONB) é o estado privado do motor e **nunca sai do servidor**; `turnStartedAt`/`turnDeadlineAt` (relógio) e `nextTickAt` (agendador). Participante: `controller` (`HUMAN` \| `AI_TEMPORARY` \| `AI_PERMANENT`) + `controllerVersion`, `connected`/`disconnectedAt`, `reservedForUserId`, `pendingUserId`, `replacedUserId`. `GameAction` é único por (partida, `clientActionId`) e por (partida, `sequence`). `MatchResult` (chave + usuário) é a trava de idempotência da progressão. `MatchSeries` está reservado para "melhor de 3". |
| Conquistas | `Achievement`, `UserAchievement` | Catálogo semeado por `npm --prefix backend run seed`. |
| Ligas | `League`, `LeagueSeason`, `LeagueGroup`, `LeagueMembership`, `LeagueProgress`, `LeagueScore`, `LeagueWeekResult` | Ver docs/leagues.md. `LeagueMembership` é único por (usuário, semana); `LeagueScore.key` é a idempotência dos pontos. |
| Operação | `Notification`, `WebhookEvent`, `IdempotencyKey`, `JobLock`, `RateLimitBucket`, `MigrationRecord` | Notificações (e status do push), eventos de webhook (únicos por provedor + id externo), respostas de `Idempotency-Key` (24 h), travas de job, janelas de rate limit por usuário e o controle da migração do Firebase. |

Datas são `timestamptz` (ms). Limpeza periódica (`maintenance.prune`): chaves de idempotência
vencidas, janelas de rate limit com mais de 2 dias, notificações com mais de 90 dias, eventos de
webhook com mais de 30 dias e travas vencidas.

## Tipos do domínio (`src/domain/model/types.ts`)
- `Profile`, `PlayerStats`, `Achievement`, `UserAchievements`, `MatchHistoryEntry`,
  `ProgressionResult` (XP ganho, pontos de liga, subiu de nível, liga nova). `xpForLevel` define a
  curva (`LEVEL_XP_BASE = 300`).
- `Presence` expõe só três estados ao app: `online`, `in_match`, `offline` (o detalhe do servidor
  — sala, segundo plano, reconectando — conta como `online`).
- `Room`, `RoomPlayer`, `RoomSeatInvite` (status `PENDING`, `ACCEPTED`, `DECLINED`, `EXPIRED`,
  `AI_FILLED`, `CANCELLED`), `RoomInvite`, `MatchmakingEntry`: o formato da sala e da fila como a UI
  os lê; o servidor monta a partir de `Room`/`RoomSeat`/`RoomInvite`.
- `SessionMeta` / `SessionPlayer`: metadados públicos da partida online (humanos pelo uid, IA pelo
  `botKey`). A view de cada assento é o `SeatView` do motor (docs/game-engine.md).
- Ligas: `LeagueDefinition`, `PlayerProgress`, `WeeklyLeagueGroup`, `WeeklyLeagueMember`,
  `LeagueHistoryEntry`, `LeagueScreenSnapshot`, `LeagueRankingMember`, `GlobalRankingEntry`
  (docs/leagues.md).
- Amigos e agenda: `Friendship` (`source`: `manual` \| `phone_contact`), `FriendRequest`,
  `BlockedUser`, `FriendRelation`, `ContactMatch`, `MatchPhoneContactsResult`, `FriendInviteToken`.

O sistema de ligas semanais (escada de 20 ligas, grupos, virada, promoção/rebaixamento) está
detalhado em `docs/leagues.md`.

### Diretório de telefones (busca de contatos)
O app **nunca** envia a agenda: manda só números em E.164, em lotes de até 200, para
`POST /v1/contacts/sync` (`syncPhoneContacts` no app). O servidor calcula
`HMAC-SHA256(CONTACTS_PEPPER, e164)` e procura em `User.phoneHash`; a resposta traz o *índice* do
número na lista enviada, nunca o número.
O pepper vive só no ambiente do backend (Secret Manager em staging/produção, `backend/.env` no
desenvolvimento) — não existe salt embutido no APK, então nem um vazamento do banco nem uma cópia do
app permitem reverter os hashes. `phoneHash` é gravado no bootstrap a partir do telefone do
**token do Firebase Auth**, nunca de um payload do cliente.
Limites por usuário: 200 números/chamada, 40 chamadas, 3.000 números e 150 conexões automáticas por dia
(`ContactSyncQuota`: windowStart, calls, numbers, connected).

**Conexão automática.** Cada dono encontrado no índice é conferido com `auth.getUsers` (lotes de
100): só conecta se a conta existe, não está desativada e o `phoneNumber` do Auth ainda gera o mesmo
hash (índice velho é apagado e registrado em log, sem telefone). Quem sincroniza também precisa ter
telefone no token. A amizade é criada numa transação que relê bloqueio, amizade e supressão e fecha
as solicitações pendentes do par (`accepted`, `resolvedBy: PHONE_CONTACT`), sem push. Como o par é
uma linha só (`userAId < userBId`) e a transação pega um advisory lock do par, sincronizações
simultâneas de A e B disputam a mesma chave e o resultado é uma amizade só.
Remover amizade e bloquear gravam a supressão; ela só sai quando os dois voltam a ser amigos à mão.
Não há backfill: só conecta quem sincroniza a própria agenda com permissão.
Nome, e-mail e foto dos contatos ficam no aparelho; o cache local (`trucox.contacts.sync.v1.{uid}`)
guarda nome + uid + um hash de 32 bits da agenda, nunca telefones.

## Estado efêmero (fora do banco)
- Sockets conectados por usuário: memória de cada instância (`PresenceService`).
- Salas do Socket.IO (`user:`, `room:`, `match:`, `match:…:seat:N`, `presence:`, `league:`):
  memória da instância, distribuídas pelo adapter Redis quando `REDIS_URL` está definido.
- Caches de token e de `firebaseUid → id`: por instância, com validade.
