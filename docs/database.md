# Banco de dados (PostgreSQL + Prisma)

PostgreSQL é a fonte de verdade do domínio (substitui Firestore e Realtime Database). Schema em
`backend/prisma/schema.prisma`, migrations em `backend/prisma/migrations/`, seed em
`backend/prisma/seed.ts`. A identidade continua no Firebase Auth (telefone). API em [api.md](api.md).

## Convenções

- **PK** interna UUID (`@default(uuid()) @db.Uuid`). Exceções com chave natural: `League.id`
  (`bronze`…), `Achievement.id`, `LeagueSeason.weekKey` (`2026-W37`), `LeagueGroup.id`
  (`2026-W37__gold__001`), `JobLock.id`, `BackendInstance.id`; tabelas de junção usam PK composta;
  `GameAction`, `MatchEvent` e `LeagueScore` usam `BigInt` autoincremento.
- **Identidade pública**: `User.firebaseUid` (único, até 128) é o `uid` exposto pela API e pelo
  WebSocket. O UUID interno nunca sai do servidor.
- **Telefone**: não é gravado. `User.phoneHash` = HMAC-SHA256(`CONTACTS_PEPPER`, E.164), único.
- **Datas**: todas `TIMESTAMPTZ(3)` (`@db.Timestamptz(3)`). A API expõe ms epoch.
- **Enums** do Postgres para estados (`RoomStatus`, `MatchStatus`, `SeatController`,
  `PresenceState`, `WebhookStatus` …).
- **Exclusão**: quase toda FK para `User` é `onDelete: Cascade`; excluir a conta apaga os dados.
  `MatchParticipant.userId` é `SetNull` (a partida dos outros continua íntegra).
- **Estado privado**: `Match.state` (JSON com mãos, baralho e rng) e `GameAction.payload` (carta
  coberta) nunca saem do servidor.

### Migration `20260917160000_timestamptz`

A migration inicial criou as datas como `TIMESTAMP(3)` (sem fuso). O servidor PostgreSQL local
compartilhado roda com `TimeZone = America/Sao_Paulo`: com `TIMESTAMP` sem fuso, os defaults
`now()` preenchidos pelo banco saíam em horário local (3 h de diferença), enquanto o Prisma grava
em UTC. A migration converte todas as colunas para `TIMESTAMPTZ(3)` com
`USING "<coluna>" AT TIME ZONE 'UTC'` (os valores existentes foram gravados pelo Prisma em UTC).
Desde então o valor não depende do fuso da sessão. Toda coluna nova de data deve usar
`@db.Timestamptz(3)`.

## Modelos

### Usuário, perfil e presença

| Modelo | Chave / únicos | Índices | Finalidade |
|---|---|---|---|
| `User` | `id`; únicos `firebaseUid`, `phoneHash`, `inviteToken` | — | Conta interna; `inviteToken` + `inviteTokenExpiresAt` = QR de amizade; `lastSeenAt` |
| `UserProfile` | `userId` | `nicknameLower` | Apelido (até 16; vazio até o cadastro), avatar, nível/XP, espelho de liga (`leagueId`, `leaguePoints`) |
| `PlayerStatistics` | `userId` | — | Partidas, vitórias, sequência, trucos, `hardWins` |
| `UserDevice` | `id`; único `token` | `userId` | Token FCM; um aparelho pertence a uma conta por vez |
| `UserPresence` | `userId` | `state`, `instanceId` | Estado atual; escrito só quando muda, com a instância dona |
| `BackendInstance` | `id` | — | Heartbeat (30 s) de cada instância; presença de instância morta é limpa |

### Amigos e agenda

| Modelo | Chave / únicos | Índices | Finalidade |
|---|---|---|---|
| `Friendship` | PK (`userAId`, `userBId`), sempre `userAId < userBId` | `userBId` | Uma linha por par; `source` = `MANUAL` ou `PHONE_CONTACT` |
| `FriendRequest` | `id`; único (`fromUserId`, `toUserId`) | (`toUserId`, `status`), (`fromUserId`, `status`) | Solicitação `PENDING`/`ACCEPTED`/`DECLINED` |
| `BlockedUser` | PK (`blockerId`, `blockedId`) | `blockedId` | Bloqueios |
| `FriendshipSuppression` | PK (`userId`, `otherUserId`) | `otherUserId` | "Não reconectar pela agenda" (`REMOVED`/`BLOCKED`) |
| `ContactSyncQuota` | `userId` | — | Cota diária da sincronização de agenda (chamadas, números, conexões) |

### Salas e matchmaking

| Modelo | Chave / únicos | Índices | Finalidade |
|---|---|---|---|
| `Room` | `id`; únicos `code` (6), `currentMatchId` | (`status`, `updatedAt`), `hostUserId` | Sala privada ou de matchmaking; `version`, `inviteExpiresAt`, `lateJoinUntil`, `fillPolicy`, `closedReason` |
| `RoomSeat` | PK (`roomId`, `seat`); único (`roomId`, `userId`) | `userId` | Assentos 0–3; `userId` nulo = IA; `reservedForUserId` = IA segurando vaga de convidado |
| `RoomInvite` | `id`; único (`roomId`, `inviteeUserId`) | (`inviteeUserId`, `dismissedAt`) | Convite (com `seat` = vaga reservada); caixa de entrada enquanto `dismissedAt` é nulo |
| `MatchmakingTicket` | `userId` | (`status`, `joinedAt`) | Fila do jogo rápido |

### Partidas

| Modelo | Chave / únicos | Índices | Finalidade |
|---|---|---|---|
| `MatchSeries` | `id` | — | Série (`bestOf`); hoje o produto joga melhor de 1 |
| `Match` | `id`; único `externalKey` | (`status`, `nextTickAt`), `roomId` | Partida `ONLINE` ou `AI`; `state` privado, `stateVersion`, placar, `turnStartedAt`/`turnDeadlineAt`, `nextTickAt` do agendador |
| `MatchParticipant` | PK (`matchId`, `seat`) | `userId`, `pendingUserId` | Assento: `controller` (`HUMAN`/`AI_TEMPORARY`/`AI_PERMANENT`), `controllerVersion`, `connected`, `disconnectedAt`, `reservedForUserId`, `pendingUserId`, `replacedUserId` |
| `GameAction` | `id`; únicos (`matchId`, `clientActionId`), (`matchId`, `sequence`) | — | Toda ação aplicada; `clientActionId` é a chave de idempotência; ator `HUMAN`/`AI`/`TIMEOUT` |
| `GameHand` | PK (`matchId`, `number`) | — | Mãos (valor, vencedor, placar) |
| `GameTrick` | PK (`matchId`, `handNumber`, `round`) | — | Vazas (`winnerTeam` nulo = cangou) |
| `MatchEvent` | `id`; único (`matchId`, `sequence`) | — | Eventos públicos para auditoria (sem carta secreta) |
| `MatchResult` | `id`; único (`key`, `userId`) | (`userId`, `createdAt desc`), `matchId` | Resultado de um humano; trava de idempotência da progressão. `key` = `{matchId}`, `{matchId}_left_{uid}` ou `{uid}_{matchId do cliente}` (IA) |

### Conquistas e ligas

| Modelo | Chave / únicos | Índices | Finalidade |
|---|---|---|---|
| `Achievement` | `id`; único `order` | — | Catálogo (seed) |
| `UserAchievement` | PK (`userId`, `achievementId`) | — | Desbloqueios |
| `League` | `id`; único `order` | — | As 20 ligas (seed) |
| `LeagueSeason` | `weekKey` | — | Semana; `status` é a trava de idempotência do fechamento |
| `LeagueGroup` | `id` determinístico; único (`weekKey`, `leagueId`, `division`) | (`weekKey`, `leagueId`, `status`) | Grupo semanal (tamanho alvo 20, promoções/rebaixamentos) |
| `LeagueMembership` | `id`; únicos (`userId`, `weekKey`), (`groupId`, `userId`) | — | Participação na semana: ninguém fica em dois grupos |
| `LeagueProgress` | `userId` | (`seasonPoints desc`, `userId`), (`currentLeagueId`, `lastProcessedWeekKey`, `lastActiveWeekKey`) | Liga atual, pontos, último resultado semanal |
| `LeagueScore` | `id`; único `key` (`{matchId}__{uid}__{evento}`) | (`userId`, `weekKey`) | Livro-razão de pontos (idempotente por `key`) |
| `LeagueWeekResult` | PK (`userId`, `weekKey`) | (`userId`, `processedAt desc`) | Histórico semanal da aba Liga |

### Infraestrutura

| Modelo | Chave / únicos | Índices | Finalidade |
|---|---|---|---|
| `Notification` | `id` | (`userId`, `createdAt desc`), (`userId`, `readAt`) | Notificação in-app + `pushStatus` do FCM; apagada após 90 dias |
| `WebhookEvent` | `id`; único (`provider`, `externalEventId`) | (`status`, `receivedAt`) | Registro/idempotência de webhooks; apagado após 30 dias |
| `IdempotencyKey` | PK (`userId`, `key`) | `expiresAt` | Respostas de `Idempotency-Key` (24 h) |
| `JobLock` | `id` | — | Trava lógica entre instâncias com `token` e `expiresAt` |
| `RateLimitBucket` | PK (`userId`, `key`) | — | Janela fixa por usuário e ação |
| `MigrationRecord` | PK (`source`, `sourceId`) | — | Controle da importação Firebase → PostgreSQL (`checksum`) |

Limpeza periódica: job `maintenance.prune` (ver [webhooks.md](webhooks.md)).

## Concorrência

Transações interativas passam por `PrismaService.tx()`: isolamento `READ COMMITTED`, `maxWait` 5 s,
timeout 15 s e até 3 novas tentativas em `P2034`/deadlock/"could not serialize".

| Padrão | Onde | Para quê |
|---|---|---|
| `SELECT … FOR UPDATE` na linha `Match` | `GameService.withMatch` | Serializa jogadas, IA, timeout, queda/retomada e troca de controlador entre instâncias. Publicações no WebSocket só depois do commit |
| `SELECT … FOR UPDATE` na linha `Room` (por `code`) | `RoomRepository.lock` | Toda mutação de sala |
| `SELECT … FOR UPDATE` em `UserProfile`, ordenado por `userId` | `ProgressionService` | Duas partidas terminando juntas não se atropelam (ordem fixa evita deadlock) |
| `FOR UPDATE SKIP LOCKED` + lease em `nextTickAt` (15 s) | `GameSchedulerService` | Cada tick vencido é processado por uma instância só; tick de instância morta volta a vencer |
| `FOR UPDATE SKIP LOCKED` em `MatchmakingTicket` | `MatchmakingService.tryFormTable` | Duas instâncias nunca pegam o mesmo jogador |
| `pg_advisory_xact_lock(hash)` (`PrismaService.advisoryLock`) | amizade (`friend:<a>:<b>`), ligas (`league:<weekKey>:<leagueId>`) | Exclusão por chave lógica até o fim da transação. `lockKey` = primeiros 64 bits do SHA-256 do nome |
| `KeyedMutex` | `LeaguesService` | Fila por chave dentro do processo antes do advisory lock, para não prender várias conexões do pool esperando o mesmo lock |
| `JobLock` (`INSERT … ON CONFLICT DO UPDATE … WHERE expiresAt < now`) | `JobLockService.withLock` | Um job por vez entre instâncias (`job:<nome>`, `league-finalize:<semana>`); trava vencida é reaproveitada |
| `createMany({ skipDuplicates: true })` | bootstrap (`UserProfile`, `PlayerStatistics`), `UserAchievement`, `LeagueScore`, `LeagueMembership` | Inserção idempotente; em `LeagueScore`, `count === 0` indica ponto já contado |
| Único + `P2002` | `User.firebaseUid` (bootstrap simultâneo), `Room.code` (até 3 novas tentativas), `WebhookEvent`, `MatchResult` (partida contra IA) | Quem perde a corrida relê o que o outro gravou |
| `GameAction` único (`matchId`, `clientActionId`) | `GameService.applyLocked` | Jogada repetida devolve `duplicate: true` |
| `MatchResult` único (`key`, `userId`) | `ProgressionService`, `finalizeAiMatch` | XP, estatísticas, conquistas e liga aplicados uma vez por partida |
| `IdempotencyKey` | `IdempotencyInterceptor` | Replay de requisição REST mutável |
| `RateLimitBucket` / `ContactSyncQuota` (`INSERT … ON CONFLICT DO UPDATE … RETURNING`) | `RateLimitService`, `ContactsService` | Contador atômico compartilhado entre instâncias |

## Migrations

```
cd backend
npx prisma migrate deploy      # aplica as pendentes (npm run prisma:migrate)
npx prisma generate            # cliente
npx prisma migrate dev         # cria migration nova (npm run prisma:migrate:dev)
```

- `migrate deploy` é o único comando para staging/produção. O `Dockerfile` tem o estágio `migrate`
  (`prisma migrate deploy` + seed estrutural) para rodar como Cloud Run Job antes do deploy.
- `migrate dev` exige `SHADOW_DATABASE_URL` (declarado no `datasource`): o usuário da aplicação não
  tem permissão para criar bancos, então o banco-sombra já precisa existir.
- Nunca editar migration já aplicada; mudanças vão em migration nova.

## Seed

`npm run seed` (ou `POST /v1/admin/seed`) grava por upsert as **20 ligas** e as **7 conquistas**.
É estrutural e idempotente: nunca cria usuários, perfis ou partidas. Os testes de integração rodam o
mesmo seed no `globalSetup`.

## Ambientes

| Ambiente | Banco | Observações |
|---|---|---|
| Desenvolvimento | PostgreSQL 17 local compartilhado em `127.0.0.1:5432`, banco `truco_mineiro_db`, schema `public` | `DATABASE_URL` em `backend/.env` |
| Banco-sombra | `truco_mineiro_shadow_db` na mesma instância | só para `prisma migrate dev` |
| Testes de integração | schema `integration_test` em `truco_mineiro_db` | `TEST_DATABASE_URL` ou `backend/.env.test` |
| Teste de carga | schema `load_test` em `truco_mineiro_db` | alvo com `AUTH_MODE=test` |
| Staging / produção | bancos separados (Cloud SQL) | credenciais pelo Secret Manager, nunca por arquivo |

Formato da URL (valores de exemplo; nunca versionar credenciais):

```
DATABASE_URL="postgresql://<usuario>:<senha>@127.0.0.1:5432/truco_mineiro_db?schema=public&connection_limit=10&pool_timeout=10"
SHADOW_DATABASE_URL="postgresql://<usuario>:<senha>@127.0.0.1:5432/truco_mineiro_shadow_db?schema=public"
TEST_DATABASE_URL="postgresql://<usuario>:<senha>@127.0.0.1:5432/truco_mineiro_db?schema=integration_test"
```

### Testes de integração

- Os testes fazem `TRUNCATE … RESTART IDENTITY CASCADE` em todas as tabelas do schema atual, exceto
  `League`, `Achievement` e `_prisma_migrations` (`test/helpers/harness.ts`).
- Por isso `test/setup/test-env.ts` recusa a URL sem `?schema=`, com `schema=public` ou com `prod`/
  `staging` no texto. **Nunca** apontar os testes para `public`.
- O `globalSetup` roda `prisma migrate deploy` e o seed no schema de teste.

### Pool de conexões

- O pool é configurado na própria URL (`connection_limit`, `pool_timeout`).
- O usuário da aplicação no servidor local tem limite de 40 conexões. A soma dos
  `connection_limit` de todos os processos locais (backend, testes de integração, teste de carga) precisa
  ficar abaixo disso; o `.env.example` usa 10 para o backend.
- Queries acima de `SLOW_QUERY_MS` (padrão 200 ms) contam em `db_slow_queries_total` e, fora de
  produção, vão para o log.
- Sem banco o processo sobe mesmo assim: `/health/ready` responde 503 e as rotas devolvem
  `SERVICE_UNAVAILABLE` até a conexão voltar.

## Migração do Firebase

`npm run migrate:firebase -- export|import|validate|all` (`backend/scripts/migrate-firebase-to-postgres.ts`)
exporta o Firestore em modo somente leitura, importa de forma idempotente (`MigrationRecord`) e
confere origem × destino. Requer o mesmo `CONTACTS_PEPPER` das Functions, para os hashes de
telefone continuarem válidos. Rodar em staging primeiro.
