# API REST (backend NestJS)

Backend autoritativo em `backend/` (NestJS + PostgreSQL/Prisma + Socket.IO). Substitui as callables
das Cloud Functions. Tempo real em [websocket.md](websocket.md); banco em [database.md](database.md);
jobs e webhooks em [webhooks.md](webhooks.md).

## Convenções

| Item | Valor |
|---|---|
| Base | `https://<host>` (dev: `http://localhost:3000`, `PORT`) |
| Versão | prefixo `/v1` em todas as rotas de produto. Fora do prefixo: `/health`, `/health/ready`, `/metrics`, `/webhooks/:provider` |
| Corpo | JSON, limite de 256 kB (`useBodyParser('json', { limit: '256kb' })`) |
| Validação | `ValidationPipe` global com `whitelist` + `forbidNonWhitelisted` + `transform`: campo desconhecido é erro |
| Swagger | `/docs` (UI) e `/docs/openapi.json`. Desligado com `NODE_ENV=production`, a não ser que `SWAGGER_ENABLED=true` |
| CORS | `CORS_ORIGINS` (lista separada por vírgula). Vazio: tudo liberado fora de produção, nada em produção. O app nativo não envia `Origin` |
| ETag | desligado (`app.set('etag', false)`): nunca há resposta 304 |

### Autenticação

- Toda rota exige `Authorization: Bearer <Firebase ID Token>`, exceto as marcadas `@Public()`
  (health, métricas, admin e webhooks, que têm a própria credencial).
- O `FirebaseAuthGuard` (guard global) valida o token com o Admin SDK (`verifyIdToken`), confere o
  App Check e anexa o usuário interno à requisição. O `userId` nunca vem do cliente.
- App Check: header opcional `x-firebase-appcheck`. Só é exigido com `ENFORCE_APP_CHECK=true`
  (sem ele ou com token inválido: `APP_CHECK_INVALID`).
- Token válido de uma conta que ainda não existe no banco dá `USER_NOT_FOUND`, exceto nas rotas
  `@AllowUnregistered()`: `POST /v1/me/bootstrap` e `PATCH /v1/me/profile`.
- Tokens verificados ficam em cache por instância até expirarem; o mapa `firebaseUid → id` interno
  fica em cache por 10 min.
- `AUTH_MODE=test` aceita tokens `test:<uid>:<telefone E.164 ou vazio>`. O boot falha se isso for
  configurado em `staging`/`production`.
- Admin e `/metrics`: header `x-admin-secret` (comparação em tempo constante com `ADMIN_SECRET`).

### Envelope de resposta

Sucesso (todas as rotas, exceto health e métricas):

```json
{ "data": { "...": "..." } }
```

Handler que devolve `undefined` vira `{ "data": null }`. `/health`, `/health/ready` e `/metrics`
respondem sem envelope (`@RawResponse()`).

Erro:

```json
{ "error": { "code": "ROOM_FULL", "kind": "resource-exhausted", "message": "A sala já está completa.", "requestId": "…", "details": {} } }
```

- `code` é estável e específico: o app decide por ele. `kind` é a família (mesma semântica das
  antigas callables) e define o status HTTP.
- `message` é em português e pode ser exibida ao jogador. Stack e SQL nunca saem.
- `details` é opcional (erros de validação trazem `{ field, reason }`).
- Traduções automáticas feitas pelo filtro global:
  - rate limit do throttler → `RATE_LIMITED` (429);
  - `HttpException` 400 → `VALIDATION_FAILED`, 404 (rota inexistente) → `NOT_FOUND`;
  - banco fora (Prisma `P1001`, `P1002`, `P1008`, `P1017`, `P2024`, erro de conexão) → `SERVICE_UNAVAILABLE` (503);
  - conflito de escrita (Prisma `P2034`/`P2002` não tratado) → `CONFLICT` (409);
  - qualquer outra exceção → `INTERNAL_ERROR` (500, registrada no log com `requestId`).

### Status por `kind` (`KIND_STATUS`)

| kind | HTTP |
|---|---|
| `invalid-argument` | 400 |
| `unauthenticated` | 401 |
| `permission-denied` | 403 |
| `not-found` | 404 |
| `already-exists` | 409 |
| `aborted` | 409 |
| `failed-precondition` | 412 |
| `resource-exhausted` | 429 |
| `internal` | 500 |
| `unavailable` | 503 |

### Códigos de erro (`backend/src/common/errors.ts`)

| code | kind | HTTP |
|---|---|---|
| `VALIDATION_FAILED` | invalid-argument | 400 |
| `NOT_FOUND` | not-found | 404 |
| `AUTH_TOKEN_MISSING` | unauthenticated | 401 |
| `AUTH_TOKEN_INVALID` | unauthenticated | 401 |
| `AUTH_TOKEN_EXPIRED` | unauthenticated | 401 |
| `AUTH_TOKEN_REVOKED` | unauthenticated | 401 |
| `APP_CHECK_INVALID` | unauthenticated | 401 |
| `ADMIN_FORBIDDEN` | permission-denied | 403 |
| `USER_NOT_FOUND` | not-found | 404 |
| `PROFILE_INCOMPLETE` | failed-precondition | 412 |
| `NICKNAME_INVALID` | invalid-argument | 400 |
| `PLAYER_NOT_FOUND` | not-found | 404 |
| `RATE_LIMITED` | resource-exhausted | 429 |
| `CONTACTS_QUOTA_EXCEEDED` | resource-exhausted | 429 |
| `CONTACTS_UNAVAILABLE` | failed-precondition | 412 |
| `FRIEND_SELF` | invalid-argument | 400 |
| `FRIEND_ALREADY` | already-exists | 409 |
| `FRIEND_REQUEST_EXISTS` | already-exists | 409 |
| `FRIEND_REQUEST_NOT_FOUND` | not-found | 404 |
| `FRIEND_REQUEST_NOT_YOURS` | permission-denied | 403 |
| `FRIEND_BLOCKED` | permission-denied | 403 |
| `NOT_FRIENDS` | permission-denied | 403 |
| `INVITE_TOKEN_INVALID` | not-found | 404 |
| `LEAGUE_UNAVAILABLE` | unavailable | 503 |
| `ROOM_NOT_FOUND` | not-found | 404 |
| `ROOM_FULL` | resource-exhausted | 429 |
| `ROOM_STARTED` | failed-precondition | 412 |
| `ROOM_STARTING` | failed-precondition | 412 |
| `ROOM_NOT_WAITING` | failed-precondition | 412 |
| `ROOM_NOT_HOST` | permission-denied | 403 |
| `ROOM_NOT_MEMBER` | permission-denied | 403 |
| `ROOM_NOT_READY` | failed-precondition | 412 |
| `ROOM_WAITING_INVITES` | failed-precondition | 412 |
| `ROOM_CODE_EXHAUSTED` | internal | 500 |
| `ROOM_CANCELLED` | not-found | 404 |
| `ROOM_FRIENDS_INVALID` | invalid-argument | 400 |
| `INVITE_NOT_FOUND` | not-found | 404 |
| `INVITE_EXPIRED` | not-found | 404 |
| `ALREADY_IN_MATCH` | failed-precondition | 412 |
| `MATCHMAKING_FAILED` | internal | 500 |
| `MATCH_NOT_FOUND` | not-found | 404 |
| `MATCH_FINISHED` | failed-precondition | 412 |
| `NOT_IN_MATCH` | permission-denied | 403 |
| `NOT_YOUR_SEAT` | permission-denied | 403 |
| `NOT_YOUR_TURN` | failed-precondition | 412 |
| `INVALID_ACTION` | failed-precondition | 412 |
| `INVALID_CARD` | failed-precondition | 412 |
| `AI_REPLAY_MISMATCH` | invalid-argument | 400 |
| `MATCH_NOT_FINISHED` | failed-precondition | 412 |
| `MATCH_TOO_LONG` | invalid-argument | 400 |
| `WEBHOOK_UNKNOWN_PROVIDER` | not-found | 404 |
| `WEBHOOK_SIGNATURE_INVALID` | unauthenticated | 401 |
| `WEBHOOK_TIMESTAMP_INVALID` | unauthenticated | 401 |
| `WEBHOOK_REPLAY` | already-exists | 409 |
| `CONFLICT` | aborted | 409 |
| `FORBIDDEN` | permission-denied | 403 |
| `SERVICE_UNAVAILABLE` | unavailable | 503 |
| `INTERNAL_ERROR` | internal | 500 |

`CONTACTS_UNAVAILABLE`, `MATCHMAKING_FAILED` e `WEBHOOK_REPLAY` estão no catálogo, mas nenhum
código os lança hoje.

Erros do próprio framework (corpo acima do limite → 413, rota inexistente → 404/405, 403 genérico)
saem com código genérico da família: `VALIDATION_FAILED` (`invalid-argument`), `NOT_FOUND`,
`FORBIDDEN`, `RATE_LIMITED` ou `INTERNAL_ERROR`.

### Idempotency-Key

- Header opcional `Idempotency-Key` em `POST`/`PATCH`/`DELETE` de usuário autenticado (em `GET`, em
  rota pública ou em conta ainda não cadastrada ele é ignorado).
- Formato `^[\w:.-]{8,120}$`; fora disso: `VALIDATION_FAILED`.
- A chave é **reservada antes de executar** (linha em `IdempotencyKey`, PK `userId + key`,
  validade de 24 h). A resposta de **sucesso** é gravada nela antes de sair; repetir a chave na
  mesma rota devolve a resposta gravada sem executar de novo, com o header
  `idempotent-replay: true`.
- Requisição simultânea com a mesma chave (a primeira ainda executando): `CONFLICT` (409). O
  cliente do app repete sozinho nesse caso. Reserva sem resposta há mais de 60 s (instância caiu)
  é descartada e a requisição executa.
- Mesma chave em outra rota: `VALIDATION_FAILED`. Erros não são gravados: a reserva é liberada e o
  retry executa de novo. A jogada tem idempotência própria (`actionId`, ver Partidas).

### Rate limit

- Throttler global: `HTTP_RATE_LIMIT` requisições por minuto (padrão 300). O rastreador é o hash do
  header `Authorization` (por sessão, não por IP); sem token, vale o IP. O contador fica em memória,
  então vale por instância.
- Algumas rotas têm limite próprio (`@Throttle`, coluna "Limite" abaixo). Health e métricas não
  entram na conta.
- Limites por usuário compartilhados entre instâncias (tabela `RateLimitBucket`, janela fixa):
  criar sala 10/min, sala com amigos 6/min, convites de sala 20/min. Cota diária da agenda: 40
  chamadas e 3.000 números por dia (`ContactSyncQuota`).
- Estourou: `RATE_LIMITED` ou `CONTACTS_QUOTA_EXCEEDED` (429).

### Request id

- O header `x-request-id` do cliente é aceito se casar com `^[\w-]{8,64}$`; senão o servidor gera
  um UUID. O valor volta sempre no header `x-request-id` da resposta e em `error.requestId`.
- O log de acesso (JSON) não registra a query string, que pode ter token de convite.

## Rotas

Legenda de parâmetros: `:uid` = Firebase UID (`^[\w-]{4,128}$`); `:code` = código de sala de 6
caracteres `[A-Z0-9]` (convertido para maiúsculas); `:id` = UUID. Sem código de status
indicado, `POST` responde 200 e as demais rotas também.

### Conta e jogadores (`users.controller.ts`)

| Método | Rota | Finalidade | Corpo / query | Limite | Erros típicos |
|---|---|---|---|---|---|
| POST | `/v1/me/bootstrap` | Login: cria/localiza o usuário, indexa o telefone, garante liga e devolve o resumo inicial (`uid`, `onboarded`, `profile`, `stats`, `league`, `activeMatch`, `invites`, `unreadNotifications`, `unlockedAchievements`, `serverTime`) | `{ device?: { token, platform } }` | 20/min | `AUTH_TOKEN_*` |
| GET | `/v1/me/profile` | Perfil + estatísticas | — | | `USER_NOT_FOUND` |
| PATCH | `/v1/me/profile` | Cadastro/edição de nome e avatar; entra na liga no primeiro cadastro | `{ nickname (1–40, regra final 3–16), avatarId }` | 10/min | `NICKNAME_INVALID`, `LEAGUE_UNAVAILABLE` |
| GET | `/v1/me/achievements` | Conquistas do usuário | — | | |
| GET | `/v1/me/active-match` | Partida online em andamento (`{ matchId, roomCode }` ou `null`) | — | | |
| POST | `/v1/me/devices` | Registra token FCM | `{ token (10–4096), platform (1–20) }` | | |
| POST | `/v1/me/devices/remove` | Logout: remove o token FCM desta conta | `{ token }` | | |
| DELETE | `/v1/me` | Exclui a conta (dados + Firebase Auth) | — | 3/min | |
| GET | `/v1/players/search` | Busca por apelido (`{ players }`); omite quem bloqueou/foi bloqueado | `?term=` (1–40) | 30/min | |
| GET | `/v1/players/:uid` | Perfil público + estatísticas (bloqueio em qualquer sentido → não encontrado) | — | | `PLAYER_NOT_FOUND` |

### Amigos, bloqueios, presença e agenda (`friends.controller.ts`)

| Método | Rota | Finalidade | Corpo / query | Limite | Erros típicos |
|---|---|---|---|---|---|
| GET | `/v1/friends` | Amigos com perfil e presença (`{ friends }`) | — | | |
| DELETE | `/v1/friends/:uid` | Desfaz amizade (uid inexistente responde `{ ok: true }`) | — | | `FRIEND_SELF` |
| GET | `/v1/friends/requests` | Solicitações recebidas/enviadas | — | | |
| POST | `/v1/friends/requests` | Envia solicitação | `{ toUid }` | 30/min | `FRIEND_SELF`, `FRIEND_ALREADY`, `FRIEND_REQUEST_EXISTS`, `FRIEND_BLOCKED`, `PLAYER_NOT_FOUND`, `PROFILE_INCOMPLETE` |
| POST | `/v1/friends/requests/:id/respond` | Aceita/recusa | `{ accept: boolean }` | | `FRIEND_REQUEST_NOT_FOUND`, `FRIEND_REQUEST_NOT_YOURS` |
| DELETE | `/v1/friends/requests/to/:uid` | Cancela solicitação enviada | — | | |
| GET | `/v1/blocks` | Bloqueados (`{ blocked }`) | — | | |
| POST | `/v1/blocks` | Bloqueia | `{ targetUid }` | | `FRIEND_SELF`, `PLAYER_NOT_FOUND` |
| DELETE | `/v1/blocks/:uid` | Desbloqueia | — | | |
| POST | `/v1/presence/query` | Presença de até 200 jogadores (`{ presence }`); bloqueados ficam de fora e `sessionId` só vem para amigos | `{ uids: string[] }` | | |
| POST | `/v1/contacts/sync` | Telefones E.164 → jogadores encontrados + amizade automática | `{ phones: string[] }` (até 200) | 20/min | `VALIDATION_FAILED`, `CONTACTS_QUOTA_EXCEEDED` |
| POST | `/v1/friends/invite-token` | Token opaco do QR de amizade (`{ token, link, expiresAt }`, 30 dias) | — | | |
| POST | `/v1/friends/invite-token/resolve` | Token → `{ uid }` | `{ token }` (16–64, `[\w-]`) | 30/min | `INVITE_TOKEN_INVALID` |

### Salas e convites (`rooms.controller.ts`)

| Método | Rota | Finalidade | Corpo | Limite | Erros típicos |
|---|---|---|---|---|---|
| POST | `/v1/rooms` | Cria sala privada (`{ code }`) | — | | `RATE_LIMITED`, `PROFILE_INCOMPLETE`, `ROOM_CODE_EXHAUSTED` |
| POST | `/v1/rooms/friends` | Sala com 1 a 3 amigos: reserva vagas, convida e envia push | `{ friendUids: string[] }` | 10/min | `ROOM_FRIENDS_INVALID`, `NOT_FRIENDS`, `FRIEND_SELF`, `ALREADY_IN_MATCH`, `PROFILE_INCOMPLETE`, `RATE_LIMITED` |
| GET | `/v1/rooms/:code` | Estado da sala | — | | `ROOM_NOT_FOUND` |
| POST | `/v1/rooms/:code/join` | Entra na sala (idempotente; convidado usa a vaga reservada) | — | 30/min | `ROOM_NOT_FOUND`, `ROOM_FULL`, `ROOM_STARTED`, `PROFILE_INCOMPLETE`; convidado: os mesmos de `invites/:code/respond` |
| POST | `/v1/rooms/:code/leave` | Sai da sala; o host cancela a sala. Sala inexistente ou já iniciada: `{ ok: true }` sem efeito | — | | |
| POST | `/v1/rooms/:code/ready` | Marca/desmarca pronto | `{ ready: boolean }` | | `ROOM_NOT_FOUND`, `ROOM_NOT_MEMBER` |
| POST | `/v1/rooms/:code/fill-bots` | Host completa as vagas com IA | — | | `ROOM_NOT_HOST` |
| POST | `/v1/rooms/:code/start` | Host inicia a partida | — | | `ROOM_NOT_HOST`, `ROOM_NOT_WAITING`, `ROOM_NOT_READY` |
| POST | `/v1/rooms/:code/lobby-timeout` | Fim da espera do lobby: IA completa e a partida começa | — | | `ROOM_NOT_FOUND`, `ROOM_NOT_MEMBER`, `ROOM_WAITING_INVITES` |
| POST | `/v1/rooms/:code/invites` | Host convida um amigo para uma vaga (reserva + push) | `{ friendUid }` | 30/min | `ROOM_NOT_HOST`, `ROOM_STARTED`, `ROOM_FULL`, `NOT_FRIENDS`, `FRIEND_SELF`, `RATE_LIMITED` |
| POST | `/v1/rooms/:code/invites/direct` | Convite simples (amigo ou contato da agenda) | `{ friendUid, phones?: string[] (até 5, prova de vínculo, não gravados) }` | 30/min | `FRIEND_SELF`, `NOT_FRIENDS`, `INVITE_EXPIRED`, `RATE_LIMITED` |
| DELETE | `/v1/rooms/:code/invites/:uid` | Cancela convite/reserva | — | | `ROOM_NOT_HOST`, `ROOM_STARTED` |
| GET | `/v1/invites` | Caixa de entrada de convites (`{ invites }`) | — | | |
| POST | `/v1/invites/:code/respond` | Aceita/recusa convite | `{ accept: boolean }` | | `INVITE_NOT_FOUND`, `INVITE_EXPIRED`, `ROOM_CANCELLED`, `ROOM_STARTING`, `ROOM_STARTED`, `ROOM_FULL`, `ALREADY_IN_MATCH`, `PROFILE_INCOMPLETE` |
| DELETE | `/v1/invites/:code` | Dispensa o convite da caixa | — | | |

### Partidas e matchmaking (`matches.controller.ts`)

| Método | Rota | Finalidade | Corpo / query | Limite | Erros típicos |
|---|---|---|---|---|---|
| GET | `/v1/matches` | Histórico (cursor) | `?limit=1..100 (30)&cursor=` | | |
| GET | `/v1/matches/:id` | Retrato para o assento do usuário: `{ meta, view, seat, result }` | — | | `MATCH_NOT_FOUND`, `NOT_IN_MATCH` |
| GET | `/v1/matches/:id/snapshot` | Alias da rota anterior | — | | idem |
| POST | `/v1/matches/:id/actions` | Jogada (alternativa REST ao WebSocket). Resposta `{ version, status, duplicate? }` | `{ action: { type, seat, cardId?, depth? }, actionId (4–120) }` | 120/min | `NOT_YOUR_SEAT`, `NOT_YOUR_TURN`, `INVALID_ACTION`, `INVALID_CARD`, `MATCH_FINISHED`, `NOT_IN_MATCH` |
| POST | `/v1/matches/:id/advance-bots` | Pede um passo da IA (o servidor decide se cabe) | — | | `NOT_IN_MATCH` |
| POST | `/v1/matches/:id/rejoin` | Marca o assento como conectado (`{ ok: true }`) | — | | `MATCH_NOT_FOUND` |
| POST | `/v1/matches/:id/abandon` | Sai da partida (vaga vai para a IA ou a dupla entrega) | — | | `NOT_IN_MATCH` |
| POST | `/v1/matches/:id/claim-seat` | Convidado atrasado pede a vaga reservada: `{ status: 'seated' \| 'pending' \| 'unavailable' }` | — | | `MATCH_NOT_FOUND` |
| POST | `/v1/matches/ai` | Registra partida contra a IA; o servidor re-executa e valida | `{ matchId (4–80), seed, aiSeed, difficulty: easy\|normal\|hard, actions[] (até 2000) }` | 30/min | `AI_REPLAY_MISMATCH`, `MATCH_NOT_FINISHED`, `MATCH_TOO_LONG` |
| GET | `/v1/matchmaking` | Ticket atual (`{ entry }`) | — | | |
| POST | `/v1/matchmaking` | Entra na fila; `allowBots` completa a mesa com IA | `{ allowBots?: boolean }` | 20/min | `PROFILE_INCOMPLETE`, `ALREADY_IN_MATCH` |
| DELETE | `/v1/matchmaking` | Cancela a busca | — | | |

Detalhes das jogadas:

- `action.type`: `SHUFFLE`, `FINISH_SHUFFLE`, `CUT`, `FINISH_CUT`, `PLAY_CARD`, `PLAY_CARD_COVERED`,
  `REQUEST_TRUCO`, `ACCEPT_TRUCO`, `RAISE`, `RUN`, `ACCEPT_MAO_DE_ONZE`, `DECLINE_MAO_DE_ONZE`.
  `cardId` casa com `^[4-7QJKA23][PCEO]$`; `depth` do corte: `high`, `middle` ou `low`.
- `action.seat` precisa ser o assento do usuário (`NOT_YOUR_SEAT`). A regra é do motor.
- A idempotência é por `userId:actionId` (tabela `GameAction`, única por partida). O REST e o
  WebSocket usam a mesma chave, então o app pode repetir pelo outro canal sem jogar duas vezes.
- Partida contra a IA: a chave é `{uid}_{matchId}` (`Match.externalKey` + `MatchResult`). Reenviar
  devolve o mesmo resultado.

### Ligas (`leagues.controller.ts`)

| Método | Rota | Finalidade | Query | Erros típicos |
|---|---|---|---|---|
| GET | `/v1/leagues` | As 20 ligas (`{ leagues }`) | — | |
| GET | `/v1/leagues/me` | Aba "Minha Liga" (conserta vínculo faltando antes de responder) | — | `PROFILE_INCOMPLETE` |
| POST | `/v1/leagues/me/ensure` | Garante liga/grupo da semana e devolve o resumo | — | `PROFILE_INCOMPLETE` |
| GET | `/v1/leagues/me/history` | Histórico semanal (cursor) | `?limit=1..100 (20)&cursor=` | |
| GET | `/v1/leagues/ranking/global` | Ranking global (`{ entries }`) | `?limit=1..100 (50)` | |
| GET | `/v1/leagues/groups/:id/ranking` | Membros do grupo (`{ groupId, members }`); `:id` casa com `^\d{4}-W\d{2}__[a-z_]{3,24}__\d{3}$` | — | `VALIDATION_FAILED` |

### Notificações (`notifications.controller.ts`)

| Método | Rota | Finalidade | Corpo / query | Erros típicos |
|---|---|---|---|---|
| GET | `/v1/notifications` | `{ items, unread, nextCursor }`; `items[]` = `{ id, type, title, body, data, read, createdAt }` | `?limit=1..100 (30)&cursor=<id>` | |
| PATCH | `/v1/notifications/:id/read` | Marca uma como lida (idempotente) | — | `NOT_FOUND` |
| POST | `/v1/notifications/read-all` | Marca todas (`{ ok, updated }`) | — | |

### Estatísticas

| Método | Rota | Finalidade | Autenticação |
|---|---|---|---|
| GET | `/v1/stats/online` | Jogadores online (`{ count }`, cache de 5 s por instância) | Bearer |

### Health e métricas (`health.controller.ts`, fora do Swagger)

| Método | Rota | Finalidade | Autenticação |
|---|---|---|---|
| GET | `/health` | Liveness: `{ status: 'ok', instance, uptimeSec }` | pública |
| GET | `/health/ready` | Readiness: 200 `ready` ou 503 `unavailable`, com `checks: { database, websocket, shuttingDown }` e `latencyMs`. Depois de SIGTERM responde 503 durante `SHUTDOWN_DRAIN_MS` (padrão 3 s) | pública |
| GET | `/metrics` | Métricas Prometheus (`text/plain; version=0.0.4`) | `x-admin-secret` |

### Admin (`admin.controller.ts`)

Todas com `x-admin-secret` (sem ele ou com valor errado: `ADMIN_FORBIDDEN`, 403). Não usam Bearer.

| Método | Rota | Finalidade | Query |
|---|---|---|---|
| POST | `/v1/admin/seed` | Seed estrutural (20 ligas + conquistas), idempotente | — |
| POST | `/v1/admin/leagues/:op` | `op` = `seed`, `repair`, `finalize`, `prepare`, `rebalance` ou `rank` | `weekKey` (`AAAA-Www`, padrão = semana atual), `leagueId` (para `rebalance`), `groupId` (obrigatório para `rank`) |
| POST | `/v1/admin/jobs/:job` | Roda um job agora, com a mesma trava (`JobLock`) do agendador. Nomes em [webhooks.md](webhooks.md) | — |
| POST | `/v1/admin/diagnostics` | Diagnóstico do banco/catálogo | — |

### Webhooks (`webhooks.controller.ts`)

| Método | Rota | Finalidade | Autenticação | Resposta |
|---|---|---|---|---|
| POST | `/webhooks/:provider` | Evento assinado de um provedor (hoje só `scheduler`). `:provider` casa com `^[a-z][a-z0-9-]{1,39}$` | HMAC ou OIDC (ver [webhooks.md](webhooks.md)) | 202 `{ data: { accepted, duplicate, eventId } }` |

Limite: 120/min. Erros: `WEBHOOK_UNKNOWN_PROVIDER`, `WEBHOOK_SIGNATURE_INVALID`,
`WEBHOOK_TIMESTAMP_INVALID`, `VALIDATION_FAILED`.
