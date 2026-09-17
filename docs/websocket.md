# WebSocket (Socket.IO)

Tempo real do backend NestJS. Contrato em `backend/src/realtime/events.ts` (espelhado no app em
`src/services/api/realtime.ts`, constante `WS`). Gateway: `backend/src/realtime/realtime.gateway.ts`.
REST em [api.md](api.md).

## Conexão

| Item | Valor |
|---|---|
| Namespace | `/rt` (URL do app: `${wsUrl}/rt`) |
| Transportes | servidor aceita `websocket` e `polling`; o app usa só `websocket` |
| Heartbeat | `pingInterval` 20 s, `pingTimeout` 20 s |
| Mensagem máxima | 64 kB (`maxHttpBufferSize`) |
| CORS | `CORS_ORIGINS`; vazio = qualquer origem |

### Handshake

```ts
io(`${wsUrl}/rt`, {
  transports: ['websocket'],
  auth: (cb) => cb({ token: '<Firebase ID Token>', appCheck: '<token App Check, opcional>' }),
});
```

- O token vem de `auth.token`. Sem ele, o servidor aceita `Authorization: Bearer …` nos headers do
  handshake.
- O middleware do namespace verifica o token (Admin SDK), o App Check (`auth.appCheck`, exigido só
  com `ENFORCE_APP_CHECK=true`) e resolve o usuário interno. O cliente nunca informa `userId`.
- Falha: `connect_error` com `err.message = <code>` e `err.data = { code, kind, message, requestId }`
  (mesmo formato de erro da API). Códigos possíveis: `AUTH_TOKEN_MISSING`, `AUTH_TOKEN_INVALID`,
  `AUTH_TOKEN_EXPIRED`, `AUTH_TOKEN_REVOKED`, `APP_CHECK_INVALID`, `USER_NOT_FOUND` (conta sem
  bootstrap) e `SERVICE_UNAVAILABLE`. O app força um token novo quando recebe
  `AUTH_TOKEN_EXPIRED`/`AUTH_TOKEN_INVALID`.
- Conectado, o socket entra na sala `user:<userId>`, a presença vira `ONLINE` e o servidor emite
  `session.ready`.

### Renovação do token

- O ID Token do Firebase dura 1 h. O app chama `session.refresh` a cada 45 min com um token novo:
  `{ token }` → ack `{ expiresAt }`. O token precisa ser da mesma conta (`AUTH_TOKEN_INVALID` se
  não for).
- A cada 60 s o servidor desconecta os sockets cujo token venceu há mais de 5 min: emite
  `session.error` `{ code: 'AUTH_TOKEN_EXPIRED', message }` e chama `disconnect(true)`.
- O app trata `disconnect` com motivo `io server disconnect` reconectando com token renovado.

### Ack

Todo evento cliente → servidor responde por ack:

```ts
type Ack = { ok: true; data: unknown } | { ok: false; error: { code; kind; message; requestId?; details? } };
```

O `error` é o mesmo objeto da API REST (`toErrorBody`). O app usa `emitWithAck` com timeout de 10 s
e transforma `ok: false` em `ApiError(kind, message, code)`.

### Rate limit por socket

Balde de fichas em memória por socket: capacidade 60, reposição de 30 fichas/s, 1 ficha por evento.
Balde vazio: ack `{ ok: false, error: { code: 'RATE_LIMITED', kind: 'resource-exhausted', message } }`
sem executar o handler. `presence.subscribe` também limita a 300 uids assinados por socket.

## Salas do Socket.IO

| Sala | Quem entra | Uso |
|---|---|---|
| `user:<userId>` | todo socket do usuário, na conexão | eventos pessoais |
| `presence:<firebaseUid>` | `presence.subscribe` | `presence.changed` do jogador |
| `room:<code>` | `room.subscribe`, `room.join`, `room.invite.accept` | `room.updated` |
| `match:<matchId>` | `game.join`/`game.reconnect`/`game.sync`/`game.claim-seat` | `game.meta` |
| `match:<matchId>:seat:<n>` | idem, só para quem tem assento | `game.view` e `game.result` do assento |
| `league:<groupId>` | `league.subscribe` | `league.members` |

O servidor também move sockets entre salas (`socketsJoin`/`socketsLeave`, distribuídos pelo
adapter): quando a vaga passa para a IA (`abandon`) ou quando um convidado atrasado assume a vaga.

## Cliente → servidor

Campos comuns: `matchId` é UUID; `code` tem 6 caracteres `[A-Z0-9]` (o servidor converte para
maiúsculas); `actionId` tem de 4 a 120 caracteres. Payload que não é objeto dá `VALIDATION_FAILED`.

### Sessão e presença

| Evento | Payload | Ack `data` |
|---|---|---|
| `ping` | — | `{ serverTime }` (não passa pelo rate limit) |
| `session.refresh` | `{ token }` | `{ expiresAt }` |
| `presence.set` | `{ state, matchId? }`; `state` ∈ `ONLINE`, `IN_ROOM`, `IN_MATCH`, `BACKGROUND`, `RECONNECTING` (sem diferenciar maiúsculas) | `{ state }` |
| `presence.subscribe` | `{ uids: string[] }` (até 200) | `{ presence: { [uid]: { state, lastChanged, sessionId } } }` — bloqueados (em qualquer sentido) não entram nem são assinados; `sessionId` só para amigos; `presence.changed` nunca leva `sessionId` |
| `presence.unsubscribe` | `{ uids: string[] }` | `{ ok: true }` |

`presence.set` só guarda `matchId` com `IN_MATCH`. O app manda `BACKGROUND` quando vai para segundo
plano e reenvia o estado a cada reconexão.

### Salas e convites

| Evento | Payload | Ack `data` | Equivalente REST |
|---|---|---|---|
| `room.subscribe` | `{ code }` | `{ room }` (`null` se não existe) | `GET /v1/rooms/:code` |
| `room.unsubscribe` | `{ code }` | `{ ok: true }` | — |
| `room.sync` | `{ code }` | `{ room }` | `GET /v1/rooms/:code` |
| `room.join` | `{ code }` | `{ code, … }` | `POST /v1/rooms/:code/join` |
| `room.leave` | `{ code }` | `{ ok: true }` | `POST /v1/rooms/:code/leave` |
| `room.ready` | `{ code, ready }` | `{ ok: true }` | `POST /v1/rooms/:code/ready` |
| `room.invite` | `{ code, friendUid }` | resultado do convite | `POST /v1/rooms/:code/invites` |
| `room.invite.accept` | `{ code }` | `{ code, sessionId }` | `POST /v1/invites/:code/respond` (`accept: true`) |
| `room.invite.decline` | `{ code }` | `{ code }` | idem (`accept: false`) |

### Liga e matchmaking

| Evento | Payload | Ack `data` |
|---|---|---|
| `league.subscribe` | `{ groupId }` (`^\d{4}-W\d{2}__[a-z_]{3,24}__\d{3}$`) | `{ groupId, members }` |
| `league.unsubscribe` | `{ groupId }` | `{ ok: true }` |
| `matchmaking.subscribe` | — | `{ entry }` (ticket atual; não entra em sala, os avisos chegam por `user:`) |

### Partida

| Evento | Payload | Ação enviada ao motor | Ack `data` |
|---|---|---|---|
| `game.join` | `{ matchId }` | — | retrato `{ meta, view, seat, result }` |
| `game.reconnect` | `{ matchId }` | — | idem (mesmo handler de `game.join`) |
| `game.sync` | `{ matchId }` | — | retrato, lido sem trava |
| `game.leave-view` | `{ matchId }` | — | `{ ok: true }` |
| `game.action` | `{ matchId, actionId, action: { type, seat, cardId?, depth? } }` | a própria `action` | `{ version, status, duplicate? }` |
| `game.play-card` | `{ matchId, actionId, cardId }` | `PLAY_CARD` | idem |
| `game.play-covered-card` | `{ matchId, actionId, cardId }` | `PLAY_CARD_COVERED` | idem |
| `game.truco.request` | `{ matchId, actionId }` | `REQUEST_TRUCO` | idem |
| `game.truco.respond` | `{ matchId, actionId, response: 'ACCEPT' \| 'RAISE' \| 'RUN' }` | `ACCEPT_TRUCO` / `RAISE` / `RUN` | idem |
| `game.shuffle` | `{ matchId, actionId, finish? }` | `SHUFFLE` ou `FINISH_SHUFFLE` (`finish: true`) | idem |
| `game.cut` | `{ matchId, actionId, depth?, finish? }` | `CUT` (com `depth`) ou `FINISH_CUT` | idem |
| `game.hand-of-eleven` | `{ matchId, actionId, accept }` | `ACCEPT_MAO_DE_ONZE` / `DECLINE_MAO_DE_ONZE` | idem |
| `game.advance-bots` | `{ matchId }` | um passo da IA, se couber | `{ version, status }` |
| `game.abandon` | `{ matchId }` | — | `{ ok: true }` |
| `game.claim-seat` | `{ matchId }` | — | `{ status: 'seated' \| 'pending' \| 'unavailable' }` |

- Nos atalhos (`game.play-card` etc.) o servidor preenche `seat` com o assento do usuário. Em
  `game.action`, `action.seat` diferente do assento dá `NOT_YOUR_SEAT`.
- A forma da ação é validada por `parseAction` (`VALIDATION_FAILED`); a regra é do motor
  (`NOT_YOUR_TURN`, `INVALID_ACTION`, `INVALID_CARD`, `MATCH_FINISHED`).
- Idempotência: a chave gravada é `userId:actionId` (tabela `GameAction`). Repetir a mesma jogada
  (pelo WebSocket ou por `POST /v1/matches/:id/actions`) devolve `duplicate: true` sem aplicar de novo.
- `game.join` marca o assento como conectado (e devolve a vaga ao humano, ver abaixo) e, com a
  partida em andamento, põe a presença em `IN_MATCH`. `game.sync` só relê o estado e acerta as
  salas do socket.
- `game.leave-view` sai das salas da partida e, se o usuário não tiver outro socket nelas, põe a
  presença em `ONLINE`. Não abandona a partida.
- `game.advance-bots` só joga se a IA tem vez e se passaram pelo menos 250 ms desde a última ação.
  O agendador do servidor joga pela IA de qualquer forma; o pedido do cliente só acerta o ritmo com
  a animação.

## Servidor → cliente

| Evento | Destino | Payload | Quando |
|---|---|---|---|
| `session.ready` | socket | `{ uid, serverTime, activeMatch, onlineCount }` | logo após conectar (com erro interno: `activeMatch: null`, `onlineCount: 0`) |
| `session.error` | socket | `{ code: 'AUTH_TOKEN_EXPIRED', message }` | antes de desconectar socket com token vencido |
| `presence.changed` | `presence:<uid>` | `{ uid, presence: { state: 'online' \| 'in_match' \| 'offline', lastChanged, sessionId, detail } }` | a cada mudança de estado gravada (`detail` = estado completo do banco) |
| `stats.online` | todos | `{ count }` | a cada 10 s, só se o número mudou |
| `room.updated` | `room:<code>` | `{ code, room }` (`room: null` se sumiu) | qualquer mudança na sala |
| `invites.updated` | `user:` | `{ invites }` | caixa de convites de sala mudou |
| `friends.changed` | `user:` | `{ at }` ou `{ reason: 'phone_contact' }` | amizade criada/removida |
| `friend-requests.changed` | `user:` | `{ at }` | solicitações mudaram |
| `blocks.changed` | `user:` | `{ at }` | bloqueios mudaram |
| `user.profile` | `user:` | `{ profile, stats }` | progressão aplicada (XP, nível, estatísticas) |
| `user.active-match` | `user:` | `{ matchId }` / `{ matchId: null }` | partida começou, humano assumiu vaga, saiu (abandono) ou partida terminou |
| `user.notification` | `user:` | `{ id, type, title, body, data, createdAt }` | notificação criada (antes do push FCM) |
| `matchmaking.updated` | `user:` | `{ entry }` | ticket mudou |
| `league.members` | `league:<groupId>` | `{ groupId, members }` | ranking do grupo recalculado (com debounce) |
| `game.meta` | `match:<id>` | `MatchMeta` | estado ou controladores da partida mudaram |
| `game.view` | `match:<id>:seat:<n>` | `SeatViewPayload` | a cada ação aplicada, uma projeção por assento |
| `game.result` | `match:<id>:seat:<n>` | `{ matchId, seat, result }` | fim da partida, para cada humano com progressão |

Os eventos de amizade são só avisos: o app busca a lista pela API ao recebê-los.

### `game.meta` (`MatchMeta`, `backend/src/game/game-views.ts`)

`{ id, roomCode, mode: 'online', status: 'preparing' | 'playing' | 'finished' | 'abandoned',
players, createdAt, updatedAt, winnerTeam, abandonedBy, turnStartedAt, turnDeadlineAt, serverTime }`.
`players` é indexado pelo assento (`"0"`–`"3"`): `{ uid, seat, nickname, avatarId, bot, connected,
disconnectedAt, reservedFor, pendingUid, replacedUid, controller, controllerVersion }`. Humanos
aparecem pelo Firebase UID; IA permanente pelo `botKey`.

### `game.view` (`SeatViewPayload`)

Projeção do motor (`viewForSeat`) mais `matchId`, `recentEvents`, `turnStartedAt`,
`turnDeadlineAt` e `serverTime`. Campos principais: `seat`, `team`, `scores`, `status`, `phase`,
`turnSeat`, `myCards`, `playableCardIds`, `availableActions`, `cardCounts`, `currentRound`,
`rounds`, `handValue`, `proposedValue`, `version`.

Cada assento recebe só o que pode ver:

- mãos dos outros não saem; só `cardCounts`;
- carta jogada coberta (`covered: true`) chega com `card: null` para os outros assentos, tanto em
  `currentRound`/`rounds` (`playForSeat`) quanto em `recentEvents` (`eventsForSeat`);
- o estado privado (`Match.state`: baralho, rng) nunca sai do servidor.

## Prazos de jogada

- O servidor não manda tique por segundo. Cada `game.view`/`game.meta` traz `turnStartedAt`,
  `turnDeadlineAt` e `serverTime` (ms epoch), gravados em `Match`.
- O app converte o prazo para o próprio relógio (`turnDeadlineAt - serverTime + hora do
  recebimento`, em `useOnlineGame`) e o `useTurnTimer` usa o **menor** entre esse prazo e o local
  (que nasce quando a vez aparece na tela, depois das animações): a diferença de relógio do
  aparelho não importa e o anel nunca passa do prazo oficial.
- Prazos (`TURN_TIMING`): 30 s para jogar ou responder, 15 s para embaralhar, 12 s para cortar. O
  prazo reinicia a cada decisão nova; no embaralho/corte vale para o estágio inteiro.
- O servidor só aplica a jogada automática (`timeoutAction`, ator `TIMEOUT`) depois de
  `turnDeadlineAt + 6 s` (`serverGraceMs`), para cobrir animação e rede.
- O agendador (`GameSchedulerService`) guarda o próximo evento em `Match.nextTickAt`, usa timer
  local para prazos de até 60 s e varre o banco a cada `SCHEDULER_POLL_MS` (padrão 1 s), pegando os
  vencidos com `FOR UPDATE SKIP LOCKED`.

## Reconexão e ressincronização

- O cliente reconecta sozinho (backoff de 0,5 s a 8 s). Em cada `connect` ele refaz as assinaturas
  registradas com `whileConnected`: `presence.set`, `presence.subscribe`, `room.subscribe`,
  `league.subscribe`, `game.join` e a leitura do matchmaking.
- `game.join` devolve o retrato completo (`meta`, `view`, `seat`, `result`): depois de uma queda a
  mesa nunca fica com estado velho. Sem socket, o app lê `GET /v1/matches/:id`.
- `view.version` é o contador monotônico de ações do motor. Eventos podem chegar fora de ordem: o
  app descarta `game.view` com `version` menor que a atual. Na dúvida, `game.sync` relê o estado.
- Jogada sem socket: `POST /v1/matches/:id/actions` com o mesmo `actionId`.
- `session.ready.activeMatch` e `GET /v1/me/active-match` permitem voltar para a mesa depois de
  reiniciar o app.

## Queda, IA temporária e retomada

1. Ao desconectar, se o usuário não tem outro socket na sala da partida, o servidor grava
   `connected = false` e `disconnectedAt` no assento (`MatchParticipant`). O `game.meta` mostra o
   jogador como desconectado.
2. Depois de `DISCONNECT_AI_GRACE_SECONDS` (padrão 8 s), o agendador troca o controlador para
   `AI_TEMPORARY` e incrementa `controllerVersion`. A IA joga a vez dele no ritmo de mesa
   (`BOT_FALLBACK_SECONDS`, padrão 3 s): a partida nunca fica parada.
3. Na volta (`game.join`/`game.reconnect`, `POST /v1/matches/:id/rejoin` ou qualquer jogada do
   humano), o controlador volta para `HUMAN`, `controllerVersion` incrementa de novo e o assento
   fica conectado.
4. Toda troca acontece dentro da transação com `SELECT … FOR UPDATE` na linha da partida, e a chave
   da jogada da IA inclui a versão (`bot_<version>_<seat>_<controllerVersion>`): não existe troca no
   meio de uma jogada nem jogada da IA aplicada depois que o humano reassumiu.

Outros controladores:

- `AI_PERMANENT`: vaga de quem abandonou (`replacedUid`) ou IA de preenchimento.
- Convidado atrasado com vaga reservada (`reservedFor`): `game.claim-seat` marca `pendingUid`; a
  troca IA → humano só acontece num ponto seguro (começo de mão, antes de carta ou truco). O
  servidor move os sockets do usuário para as salas do assento e emite `user.active-match`.

## Várias instâncias

- Com `REDIS_URL`, o `AppIoAdapter` usa `@socket.io/redis-adapter` (pub/sub): `emit` para salas,
  `socketsJoin` e `socketsLeave` valem em todas as instâncias. Obrigatório com mais de uma instância.
- Sem Redis, cada instância só atende os próprios sockets: serve para uma instância só (ou Cloud Run
  com session affinity e `max-instances=1`).
- Presença: cada instância conta os sockets de cada usuário em memória e só grava no PostgreSQL
  (`UserPresence`) quando o estado muda. Cada instância grava heartbeat em `BackendInstance` a cada
  30 s; presença de instância sem heartbeat há mais de 95 s vira `OFFLINE` (heartbeat das outras e
  job `presence.reap`). No desligamento, a instância põe offline o que segurava.
- Decisões que dependem de "o usuário ainda tem socket?" consultam **o cluster** (`allSockets()`
  no adapter Redis, que troca só ids entre instâncias):
  - sair da partida/cair: o assento só vira desconectado se não houver outro socket do usuário na
    sala `user:<userId>:match:<matchId>` em nenhuma instância;
  - presença: se o usuário ainda tem socket em outra instância, esta não o marca offline e manda
    `presence.reclaim` (`serverSideEmit`); a instância que ainda o atende assume a linha;
  - busca de partida: sem nenhum socket por `MATCHMAKING_DISCONNECT_GRACE_SECONDS` (15 s), a busca
    é cancelada.
  Se o Redis estiver lento/fora, a consulta cai para os sockets locais.
- Redis fora com o sistema no ar: REST e sockets continuam; eventos entre instâncias se perdem
  até ele voltar (reconexão automática). No boot, Redis inacessível derruba a instância em
  `REDIS_BOOT_TIMEOUT_MS`.
- Jogadas, IA e prazos são serializados pelo banco (trava da linha `Match` e `SKIP LOCKED` no
  agendador), não pelo Socket.IO.
