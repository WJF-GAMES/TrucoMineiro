# Multiplayer

O backend NestJS é a autoridade de salas, fila, partida, relógio e IA. O app fala com ele por REST
(`/v1`, docs/api.md) e por Socket.IO (namespace `/rt`, docs/websocket.md). Toda mudança de sala ou
partida acontece numa transação com trava da linha (`SELECT … FOR UPDATE`); eventos WebSocket e push
só saem **depois do commit**.

## Fluxos
**Jogo rápido**: `POST /v1/matchmaking` (`startMatchmaking`) → `MatchmakingTicket` `SEARCHING` →
`tryFormTable` junta os 4 mais antigos da fila numa transação (`FOR UPDATE SKIP LOCKED`: duas
instâncias nunca pegam o mesmo jogador), cria `Room` (`source: MATCHMAKING`), assentos e a `Match`,
e marca os tickets `READY` com `matchId` + `roomCode` → o app recebe `matchmaking.updated` e
`user.active-match` e navega para a Mesa. A formação roda a cada entrada na fila e também no ciclo do
agendador.
Após `matchmaking_bot_fill_seconds` (Remote Config, padrão 20 s) o app chama
`startMatchmaking(true)` e o servidor completa a mesa de quem pediu com IA. Após
`matchmaking_timeout_seconds` (90 s) o app cancela (`DELETE /v1/matchmaking`). O usuário pode
cancelar a qualquer momento. Quem já está em outra partida online recebe `ALREADY_IN_MATCH`.
Estados na UI: idle · searching · players_found · preparing · ready · cancelled · timeout · error (todos com texto humano).
Tickets encerrados somem depois de 1 min (`matchmaking.cleanup`).

**Criar sala**: `POST /v1/rooms` (`createRoom`, repetível com `Idempotency-Key`) → código de 6 caracteres (alfabeto sem 0/O/1/I) → Lobby (código, compartilhar/copiar, 4 assentos, pronto, host, "Completar com IA", iniciar).
`POST /v1/rooms/:code/start` (host, 4 jogadores prontos) → cria a `Match` na mesma transação → sala `IN_MATCH` → todos recebem `room.updated` / `user.active-match` e navegam para a Mesa.

**Entrar em sala**: `POST /v1/rooms/:code/join` (ou `room.join`) valida: código inválido
(`VALIDATION_FAILED`), inexistente (`ROOM_NOT_FOUND`), cheia (`ROOM_FULL`), já iniciada/encerrada
(`ROOM_STARTED`), erro de rede (`unavailable` no cliente). Já estar na sala devolve sucesso
(idempotente). Mensagens específicas na tela. O lobby acompanha a sala por `room.subscribe` →
`room.updated`.

## Partida no servidor
- `Match.state` (JSONB): `MatchState` do motor + `aiRngState`, eventos da última ação, chave do
  prazo, sequência. Nunca sai do servidor.
- Cada assento recebe `game.view` (`SeatView` + `recentEvents` + `turnStartedAt`/`turnDeadlineAt` +
  `serverTime`) na sala `match:{id}:seat:{n}`; todos recebem `game.meta` (jogadores, controlador,
  conexão, placar, status). `game.join` / `game.reconnect` / `game.sync` devolvem o retrato completo
  (`meta`, `view`, `seat`, `result`).
- Toda ação passa por `game.action` (ou atalhos `game.play-card`, `game.truco.request`… e o
  REST `POST /v1/matches/:id/actions`): o servidor confere que o assento é do usuário
  (`NOT_YOUR_SEAT`), que a ação está em `getAvailableActions` (`NOT_YOUR_TURN` / `INVALID_ACTION`),
  aplica no motor e grava `GameAction`. Idempotente por `actionId` (`duplicate: true` na repetição).
  Detalhes do motor no servidor em docs/game-engine.md.
- Fim de partida: `finishInTx` aplica a progressão na mesma transação (idempotente por
  `MatchResult`), fecha a sala (`FINISHED`), expira convites pendentes e, depois do commit, manda
  `game.result` para cada assento humano e `user.active-match { matchId: null }`.

## Agendador (relógio, IA e trocas)
`GameSchedulerService` é o relógio das partidas. Cada partida guarda `nextTickAt`, calculado a cada
mudança como o mais cedo entre:
- vez da IA: última ação + `BOT_FALLBACK_SECONDS` (padrão 3 s);
- humano desconectado: `disconnectedAt` + `DISCONNECT_AI_GRACE_SECONDS`;
- vez de humano: `turnDeadlineAt` + folga do servidor (`TURN_TIMING.serverGraceMs`, 6 s);
- troca pendente (convidado atrasado) num ponto seguro: agora.

A instância que calculou agenda um timer local (baixa latência) e todas varrem o banco a cada
`SCHEDULER_POLL_MS` (1 s), "alugando" ticks vencidos por 15 s com `FOR UPDATE SKIP LOCKED` — tick de
instância que caiu é retomado por outra e nenhum roda duas vezes. No mesmo ciclo o agendador fecha
lobbies vencidos (a cada 2 ciclos) e tenta formar mesas (a cada 3). Um tick (`processTick`): aplica
trocas pendentes → converte desconectados em IA temporária → joga a vez da IA → ou, com o prazo
vencido, faz a jogada automática do humano (`timeoutAction`: fecha o embaralho, corta, corre do
truco, entrega a mão de onze ou joga a carta mais fraca; ator `TIMEOUT`).

**Bots**: a IA roda só no servidor, vendo apenas a observação do próprio assento (dificuldade
`normal` na mesa online). O app ainda chama `game.advance-bots` depois de mostrar a jogada anterior
(ritmo da mesa); o servidor só aceita se é mesmo a vez de uma IA e passou o intervalo mínimo (250 ms).
Se ninguém pedir, o agendador joga sozinho.

## Presença, reconexão e abandono
- Presença: memória por instância + `UserPresence` só em mudança (docs/architecture.md). O app
  informa o que está fazendo com `presence.set` (`ONLINE`, `IN_ROOM`, `IN_MATCH`, `BACKGROUND`,
  `RECONNECTING`); entrar na partida marca `IN_MATCH` automaticamente. Contador global por
  `stats.online`.
- Queda do socket: se o usuário não tem outro socket na partida, o assento vira `connected=false`
  com `disconnectedAt`. A mesa mostra ícone de desconectado.
- O app observa a conexão do socket: banner "Reconectando..." e status `reconnecting` na mesa; ao
  voltar, o socket reexecuta `game.join` sozinho (retrato completo, nada de estado velho) e o app
  pode chamar `POST /v1/matches/:id/rejoin`.
- **IA temporária**: depois de `DISCONNECT_AI_GRACE_SECONDS` (padrão 8 s) o agendador troca o
  controlador do assento para `AI_TEMPORARY` e incrementa `controllerVersion`; a IA passa a jogar a
  vez dele — a partida nunca fica parada. Quando o humano volta (`game.join`, `rejoin` ou qualquer
  jogada dele), o assento volta a `HUMAN` com nova `controllerVersion`. Como toda ação acontece sob a
  trava da partida, nunca existe troca no meio de uma jogada, e uma decisão da IA calculada para a
  versão antiga não é aplicada.
- **Reabrir o app**: o bootstrap (`POST /v1/me/bootstrap`) e o `session.ready` trazem `activeMatch`;
  `useResumeActiveMatch` leva o jogador direto para a mesa. `GET /v1/me/active-match` também existe.
- `POST /v1/matches/:id/abandon` (`game.abandon`): com outro humano na mesa, a vaga de quem saiu
  passa para a IA (`AI_PERMANENT`, `replacedUid`, apelido "(IA)") e a partida continua; só quem saiu
  leva a derrota (progressão com chave `{matchId}_left_{uid}`). Se era o último humano, a dupla dele
  entrega a partida (adversários recebem 12), a partida vira `ABANDONED` e a sala fecha.

## Recompensas no fim da partida online
A progressão de cada humano chega em `game.result` (só para o assento dele) e também no retrato da
partida (`result`), para quem reconectar depois do fim. No modo IA os mesmos números vêm da resposta
de `POST /v1/matches/ai`.

## Normalização da view no cliente
O antigo problema do Realtime Database (chaves vazias sumindo) não existe mais no PostgreSQL/JSON,
mas `src/features/game/normalizeSeatView.ts` (`normalizeSeatView`, `normalizeSessionMeta`) continua
na entrada da mesa online como defesa contra payload incompleto
(`src/features/game/__tests__/normalizeSeatView.test.ts`).

## Convite de sala para um amigo

Fluxo completo dos dois lados:

1. Na aba Amigos, "Jogar" (ou "Convidar", se o amigo estiver offline ou em partida) cria a sala e
   convida. Amigo: `POST /v1/rooms/:code/invites`. Contato da agenda que ainda não é amigo:
   `POST /v1/rooms/:code/invites/direct` com o telefone, que o servidor confere no diretório (prova
   de telefone). O servidor grava `RoomInvite` e, depois do commit, emite `invites.updated` para o
   convidado e manda push.
2. Quem recebe acompanha a caixa de entrada ao vivo (`useRoomInvites`: `GET /v1/invites` +
   `invites.updated`). Na aba Amigos ele aparece como "Convites para jogar"; em qualquer outra tela,
   `useRoomInvitePrompt` abre um diálogo — exceto durante Matchmaking/Lobby/Partida/Resultado, quando
   o convite fica guardado e é oferecido ao sair.
3. "Entrar" (`room.invite.accept` ou `POST /v1/invites/:code/respond`) ocupa a vaga e navega para o
   lobby. Recusar, dispensar (`DELETE /v1/invites/:code`) ou passar da validade tira o convite da
   caixa; sala cheia ou partida já iniciada também (o convite não serve mais). Sem conexão o convite
   é mantido para uma segunda tentativa.

Só o convidado vê a própria caixa de entrada; ninguém cria convite para si mesmo (`FRIEND_SELF`) nem
convida quem não é amigo/contato (`NOT_FRIENDS`).

## Sala com até 3 amigos (convite em grupo)

Na aba Amigos, "Jogar com amigos" abre a seleção (até 3; o 4º fica travado até desmarcar alguém;
online primeiro; "Em partida agora" continua selecionável). "Criar sala" chama
`POST /v1/rooms/friends` (`createFriendRoom`). O "Jogar" de um amigo usa o mesmo caminho com um só
convidado; contato da agenda que ainda não é amigo usa `createRoom` + convite direto (com a prova de
telefone).

**Servidor (`backend/src/rooms/rooms.service.ts`, regras puras em `room-logic.ts`)**

1. `createFriendRoom(friendUids)`: valida 1–3 amigos (amizade + bloqueio nos dois sentidos),
   limite de 6 salas/min, e grava a sala **antes** de qualquer convite:
   dono no assento 0 (já pronto), amigos nos assentos 1, 2 e 3 na ordem da escolha
   (times: dono + 2º contra 1º + 3º), `RoomInvite` com `seat` e status `PENDING`,
   `inviteExpiresAt` (espera do lobby), `lateJoinUntil` (validade do convite) e
   `fillPolicy: ON_TIMEOUT`. Depois do commit publica a caixa de entrada de cada amigo
   (`inviteId = {code}_{uid}`) e manda o push.
2. Status do convite: `PENDING`, `ACCEPTED`, `DECLINED`, `EXPIRED`, `AI_FILLED`, `CANCELLED`.
   Vaga de convite pendente não é tomada por quem entra pelo código (`freeSeat` pula reservas).
3. `respondInvite(code, accept)` (e `joinRoom` para quem tem convite): aceitar é idempotente
   (push aberto duas vezes / dois aparelhos → um assento), ocupa a vaga reservada já pronto e recusa
   se o usuário está em outra partida. Recusar marca `DECLINED` na hora (o dono vê "Recusou").
   Mensagens: "Este convite não está mais disponível.", "Esta sala foi cancelada.",
   "A sala já está completa.", "A partida já começou.", "Você já está em uma partida."
4. `inviteToRoom` / `removeInvite` (`POST /v1/rooms/:code/invites`, `DELETE …/invites/:uid`): o dono
   troca quem não entrou antes de começar (o convidado novo ganha a espera inteira).
5. `fillWithBots` (`POST …/fill-bots`): completa com IA; vaga de convidado pendente vira IA **com
   reserva** (`reservedForUserId`, convite `AI_FILLED`). `resolveLobbyTimeout`
   (`POST …/lobby-timeout`): qualquer um na sala pede ao fim da espera; o servidor só aceita depois de
   `inviteExpiresAt`, completa com IA e começa. O agendador faz o mesmo sozinho para salas
   `ON_TIMEOUT` vencidas. `startMatch` exige 4 assentos distintos, todos prontos ou IA.
6. `leaveRoom` do dono antes de começar: sala `CLOSED` (`closedReason: CANCELLED`), convites
   pendentes `CANCELLED` e retirados da caixa de entrada. Convidado saindo vira `DECLINED`.
7. Job `rooms.sweep` (a cada 5 min): sala parada no lobby por 10 min fecha como `EXPIRED`;
   sala fechada há 1 h é apagada (libera o código).

**Entrada tardia**: aceitar depois do início, com a vaga ainda reservada e dentro de
`lateJoinUntil`, marca `pendingUserId` no assento da IA (`requestSeatReclaim`) e antecipa o próximo
tick. A troca acontece em `trySeatSwaps` só num **ponto seguro** (`isSafeSwapPoint`: embaralhamento,
ou início da mão sem carta na mesa, truco ou desempate) — nunca no meio de vaza, resposta de truco
ou resolução. O cliente pergunta com `claimReservedSeat` (`POST /v1/matches/:id/claim-seat`,
`seated` / `pending` / `unavailable`) a cada 3 s (o lobby mostra "Você assume no início da próxima
mão"); o agendador e `advance-bots` também aplicam a troca. Na troca, a sala do assento no Socket.IO
é esvaziada e o humano entra nela; o assento da sala (`RoomSeat`) e o convite (`ACCEPTED`) são
atualizados na mesma transação.

**Prazos** (ambiente do backend, `backend/src/config/env.ts`): `PRIVATE_ROOM_WAIT_SECONDS=30`,
`ROOM_INVITE_TTL_SECONDS=600`, `DISCONNECT_AI_GRACE_SECONDS=8`, `BOT_FALLBACK_SECONDS=3`,
`SCHEDULER_POLL_MS=1000`. O tempo do lobby é independente do relógio da jogada
(`src/domain/game/rules/timing.ts`).

**Cliente**
- Lobby (`LobbyScreen`, leitura pura em `features/friends/lobbyState.ts`): "Aguardando jogadores"
  com `00:24`, estado de cada assento (Entrou / Convidado · aguardando / Recusou / IA / Offline),
  "Trocar" e "Convidar" nas vagas, "Começar partida" assim que todos entraram,
  "Completar com IA e começar" sem esperar o relógio, "Cancelar sala". Avisos curtos para o dono:
  "Ana entrou na sala." / "Bruno não vai jogar."
- Push (`backend/src/notifications/push.service.ts`): título "{dono} te chamou para uma partida de
  Truco!", corpo "Toque para entrar na sala.", dados `{type: 'room_invite', code, inviteId}` (nada
  sensível), `collapseKey`/`apns-collapse-id` = `inviteId` (reenvio substitui a notificação), TTL =
  validade do convite, intervalo mínimo de 15 s por convite. A notificação também é gravada
  (`Notification`) e avisada ao app aberto por `user.notification`. Tokens recusados pelo FCM são
  apagados.
- Toque no push (`subscribePushOpens`: `getInitialNotification` + `onNotificationOpenedApp`) ou
  link `trucomineiro://room?code=XXXXXX` → `usePendingInviteStore` (persistido) →
  `usePendingRoomInvite` retoma quando a sessão está válida e o cadastro concluído → sala.
  Com o app aberto o FCM não mostra a notificação do sistema: o convite aparece pelo aviso interno
  ("{dono} convidou você para jogar Truco Mineiro." · Entrar na sala / Agora não), e o convite já
  aberto pelo push não é oferecido de novo.
- Logout (`signOut`): `POST /v1/me/devices/remove` + `deleteToken` antes de sair.
- **1x1 não existe**: motor, salas e views são de 4 assentos; a seleção é sempre para a mesa 2x2.

## Eventos WebSocket
Cliente → servidor (sempre com ack `{ ok, data | error }`): `presence.*`, `room.subscribe`,
`room.join`, `room.leave`, `room.ready`, `room.invite`, `room.invite.accept`,
`room.invite.decline`, `room.sync`, `league.subscribe`, `matchmaking.subscribe`, `game.join`,
`game.reconnect`, `game.sync`, `game.leave-view`, `game.action` e atalhos, `game.advance-bots`,
`game.abandon`, `game.claim-seat`, `session.refresh`, `ping`.
Servidor → cliente: `session.ready`, `session.error`, `presence.changed`, `stats.online`,
`room.updated`, `invites.updated`, `friends.changed`, `friend-requests.changed`, `blocks.changed`,
`user.profile`, `user.active-match`, `user.notification`, `matchmaking.updated`,
`league.members`, `game.meta`, `game.view`, `game.result`.
Contrato completo (payloads, salas, limites, erros) em **docs/websocket.md**.

## Várias instâncias
Com `REDIS_URL`, o adapter Redis do Socket.IO distribui salas e eventos entre instâncias
(`socketsJoin`/`emit`). Sem Redis, cada instância só atende os próprios sockets — adequado para uma
instância. Travas e filas (partida, sala, fila de matchmaking, jobs) estão no PostgreSQL e valem
entre instâncias em qualquer caso.

## Limitações conhecidas
- O relógio exibido na mesa é calculado no aparelho a partir da mesma regra
  (`TURN_TIMING`/`turnDurationMs`); o servidor só age depois do próprio prazo + 6 s de folga, então
  o aparelho normalmente antecipa a jogada automática.
- Assistir partidas de amigos não existe (nem no cliente nem no servidor): amigo em partida aparece
  como "Na partida" e o botão dele convida para uma sala, que é o que o backend sabe fazer hoje.
- Uma mesa com 2+ humanos reais e o matchmaking com 4 humanos são cobertos pelos testes de
  integração e de carga do backend (contas de teste), mas ainda não foram exercitados com aparelhos
  reais.
