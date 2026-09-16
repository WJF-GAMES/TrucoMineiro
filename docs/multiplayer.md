# Multiplayer

## Fluxos
**Jogo rápido**: `startMatchmaking` → `matchmaking/queue/{uid}` (searching) → trigger `onMatchmakingJoin` tenta formar mesa de 4 →
`rooms/{code}` (source: matchmaking) + `createSession` → entrada recebe `status: ready` + `sessionId` → app navega para a Mesa.
Após `matchmaking_bot_fill_seconds` (Remote Config, padrão 20 s) o app chama `startMatchmaking({allowBots:true})` e o servidor
completa a mesa com IA. Após `matchmaking_timeout_seconds` (90 s) a busca expira (`cancelMatchmaking`). O usuário pode cancelar a qualquer momento.
Estados na UI: idle · searching · players_found · preparing · ready · cancelled · timeout · error (todos com texto humano).

**Criar sala**: `createRoom` → código de 6 caracteres (alfabeto sem 0/O/1/I) → Lobby (código, compartilhar/copiar, 4 assentos, pronto, host, "Completar com IA", iniciar).
`startMatch` (host, 4 jogadores prontos) → `createSession` → `rooms/{code}.status = in_match` → todos navegam para a Mesa.

**Entrar em sala**: `joinRoom(code)` valida: código inválido (`invalid-argument`), inexistente (`not-found`), cheia (`resource-exhausted`),
já iniciada (`failed-precondition`), encerrada (`status closed`), erro de rede (`unavailable`). Mensagens específicas na tela.

## Sessão
- `gameSessions/{id}/state`: `MatchState` + `appliedActionIds` (idempotência) + `aiRngState` + contagem de trucos. Sem leitura por clientes.
- `gameSessions/{id}/views/{seat}`: projeção por assento com `recentEvents`. Regra RTDB: só o uid do assento lê.
- Toda ação passa por `submitGameAction` (transação no state → reescreve as 4 views). `requestTruco`/`respondTruco` são wrappers.
- Bots: `advanceBots` aplica **uma** ação de bot por chamada; os clientes chamam após 0,9–1,5 s quando é a vez de um bot.
- Fim de partida: `finishIfNeeded` → `processProgression` (idempotente por `matchHistory/{sessionId}`) → meta `finished`, sala `closed`, `userSessions/{uid}/active = null`.

## Presença, reconexão e abandono
- `presence/{uid}` com `onDisconnect`; `stats/onlineCount` mantido por trigger.
- Em sessão: `gameSessions/{id}/meta/players/{seat}/connected` (onDisconnect → false). A mesa mostra ícone de desconectado no assento.
- Cliente observa `.info/connected`: banner "Reconectando..." e status `reconnecting` na mesa; ao voltar chama `rejoinMatch`.
- `userSessions/{uid}/active` permite restaurar a partida após reinício do app.
- **IA temporária**: a queda grava `connected=false` e `disconnectedAt` (onDisconnect). Depois de
  `DISCONNECT_AI_GRACE_SECONDS` (padrão 8 s) o assento conta como IA (`isAiControlled`) e
  `advanceBots` joga a vez dele — a partida nunca fica parada. Ao voltar (`rejoinMatch`), a vez é do
  humano de novo; como cada ação é uma transação, não existe troca no meio de uma jogada.
- `abandonMatch`: com outro humano na mesa, a vaga de quem saiu passa para a IA (`replacedUid`) e a
  partida continua; só quem saiu leva a derrota (`matchHistory/{sessionId}_left_{uid}`). Se era o
  último humano, a dupla dele entrega a partida (adversários recebem 12) e a sessão vira `abandoned`.
  A troca é uma transação em `meta/players`: duas saídas simultâneas nunca deixam assento vazio.

## Armadilha do Realtime Database (corrigida)

O RTDB **não guarda array vazio, objeto vazio nem null** — ele remove a chave. Um estado gravado como
`{ currentRound: [], rounds: [], truco: null, appliedActionIds: {} }` volta sem essas chaves, e o engine
quebrava com "spread of undefined" dentro da transação: toda jogada online era recusada e a mesa
travava com `TypeError: Cannot convert undefined value to object`.

Por isso tudo que vem do RTDB passa por um normalizador antes de ser usado:
- servidor: `functions/src/lib/rtdbState.ts` (`normalizeStoredState`), aplicado em `submitGameAction`,
  `advanceBots` e `abandonMatch`;
- cliente: `src/features/game/normalizeSeatView.ts` (`normalizeSeatView`, `normalizeSessionMeta`).

Ambos têm testes que reproduzem o round-trip removendo as chaves vazias
(`functions/test/rtdbState.test.ts`, `src/features/game/__tests__/normalizeSeatView.test.ts`).

## Recompensas no fim da partida online

`finishIfNeeded` grava a progressão de cada humano em `gameSessions/{id}/results/{seat}` (regra do RTDB
limita a leitura ao dono do assento). O app assina esse nó e leva XP / pontos de liga para a
tela de resultado — no modo IA os mesmos números vêm da resposta de `finalizeMatch`.

## Convite de sala para um amigo

Fluxo completo dos dois lados:

1. Na aba Amigos, "Jogar" (ou "Convidar", se o amigo estiver offline ou em partida) chama `createRoom`
   e em seguida `inviteFriendToRoom`, que só aceita amizade existente. A Function grava
   `invites/{amigo}/{code}` = `{code, from, fromNickname, createdAt}` e manda push.
2. Quem recebe escuta esse nó ao vivo (`useRoomInvites`). Na aba Amigos ele aparece como
   "Convites para jogar"; em qualquer outra tela, `useRoomInvitePrompt` abre um diálogo — exceto
   durante Matchmaking/Lobby/Partida/Resultado, quando o convite fica guardado e é oferecido ao sair.
3. "Entrar" chama `joinRoom(code)` e navega para o lobby. Entrar, recusar, ou passar de 15 minutos
   apaga o nó; sala cheia ou partida já iniciada também apagam (o convite não serve mais). Sem
   conexão o convite é mantido para uma segunda tentativa.

As regras do RTDB deixam o dono apenas **ler e apagar** os seus convites (`".write"` só com
`!newData.exists()`): ninguém cria convite para si mesmo nem escreve na caixa de outro.

## Sala com até 3 amigos (convite em grupo)

Na aba Amigos, "Jogar com amigos" abre a seleção (até 3; o 4º fica travado até desmarcar alguém;
online primeiro; "Em partida agora" continua selecionável). "Criar sala" chama `createFriendRoom`.
O "Jogar" de um amigo usa o mesmo caminho com um só convidado; contato da agenda que ainda não é
amigo continua em `createRoom` + `inviteFriendToRoom` (com a prova de telefone).

**Servidor (`functions/src/rooms.ts`, regras puras em `lib/roomLogic.ts`)**

1. `createFriendRoom(friendUids)`: valida 1–3 amigos (amizade + bloqueio nos dois sentidos),
   limite de 6 salas/min, e grava a sala **antes** de qualquer convite:
   dono no assento 0 (já pronto), amigos nos assentos 1, 2 e 3 na ordem da escolha
   (times: dono + 2º contra 1º + 3º), `invites/{uid} = {seat, status: PENDING, ...}`,
   `inviteExpiresAt` (espera do lobby), `lateJoinUntil` (validade do convite) e
   `fillWithAi: 'on_timeout'`. Só então grava `invites/{amigo}/{code}` (`inviteId = {code}_{uid}`,
   `expiresAt`) e manda o push.
2. Status do convite: `PENDING`, `ACCEPTED`, `DECLINED`, `EXPIRED`, `AI_FILLED`, `CANCELLED`.
   Vaga de convite pendente não é tomada por quem entra pelo código (`freeSeat` pula reservas).
3. `respondRoomInvite(code, accept)` (e `joinRoom` para quem tem convite): aceitar é idempotente
   (push aberto duas vezes / dois aparelhos → um assento), ocupa a vaga reservada já pronto e recusa
   se o usuário está em outra partida. Recusar marca `DECLINED` na hora (o dono vê "Recusou").
   Mensagens: "Este convite não está mais disponível.", "Esta sala foi cancelada.",
   "A sala já está completa.", "A partida já começou.", "Você já está em uma partida."
4. `inviteToRoom` / `removeRoomInvite`: o dono troca quem não entrou antes de começar
   (o convidado novo ganha a espera inteira).
5. `fillRoomWithBots`: completa com IA; vaga de convidado pendente vira IA **com reserva**
   (`reservedFor`, convite `AI_FILLED`). `resolveLobbyTimeout`: qualquer um na sala pede ao fim da
   espera; o servidor só aceita depois de `inviteExpiresAt`, completa com IA e começa.
   `startMatch` exige 4 assentos distintos, todos prontos ou IA.
6. `leaveRoom` do dono antes de começar: sala `closed` (`closedReason: 'cancelled'`), convites
   pendentes `CANCELLED` e retirados da caixa de entrada. Convidado saindo vira `DECLINED`.
7. `sweepRooms` (a cada 5 min): sala de amigos parada no lobby por 10 min fecha como `expired`;
   sala fechada há 1 h é apagada.

**Entrada tardia**: aceitar depois do início, com a vaga ainda reservada e dentro de
`lateJoinUntil`, marca `pendingUid` no assento da IA (`requestSeatReclaim`). A troca acontece em
`trySeatSwaps` só num **ponto seguro** (`isSafeSwapPoint`: embaralhamento, ou início da mão sem
carta na mesa, truco ou desempate) — nunca no meio de vaza, resposta de truco ou resolução. O cliente
pergunta com `claimReservedSeat` a cada 3 s (o lobby mostra "Você assume no início da próxima
mão"); `advanceBots` também aplica a troca. Cada troca é uma transação no assento.

**Prazos** (`functions/.env`, padrões em `friendRoomConfig.ts`): `PRIVATE_ROOM_WAIT_SECONDS=30`,
`ROOM_INVITE_TTL_SECONDS=600`, `DISCONNECT_AI_GRACE_SECONDS=8`. O tempo do lobby é independente do
relógio de 30 s da jogada.

**Cliente**
- Lobby (`LobbyScreen`, leitura pura em `features/friends/lobbyState.ts`): "Aguardando jogadores"
  com `00:24`, estado de cada assento (Entrou / Convidado · aguardando / Recusou / IA / Offline),
  "Trocar" e "Convidar" nas vagas, "Começar partida" assim que todos entraram,
  "Completar com IA e começar" sem esperar o relógio, "Cancelar sala". Avisos curtos para o dono:
  "Ana entrou na sala." / "Bruno não vai jogar."
- Push (`lib/push.ts`): título "{dono} te chamou para uma partida de Truco!", corpo
  "Toque para entrar na sala.", dados `{type: 'room_invite', code, inviteId}` (nada sensível),
  `collapseKey`/`apns-collapse-id` = `inviteId` (reenvio substitui a notificação), TTL = validade do
  convite, intervalo mínimo de 15 s por convite. Tokens recusados pelo FCM são apagados.
- Toque no push (`subscribePushOpens`: `getInitialNotification` + `onNotificationOpenedApp`) ou
  link `trucomineiro://room?code=XXXXXX` → `usePendingInviteStore` (persistido) →
  `usePendingRoomInvite` retoma quando a sessão está válida e o cadastro concluído → sala.
  Com o app aberto o FCM não mostra a notificação do sistema: o convite aparece pelo aviso interno
  ("{dono} convidou você para jogar Truco Mineiro." · Entrar na sala / Agora não), e o convite já
  aberto pelo push não é oferecido de novo.
- Logout (`signOut`): `unregisterDevice` + `deleteToken` antes de sair.
- **1x1 não existe**: motor, salas e views são de 4 assentos; a seleção é sempre para a mesa 2x2.

## Limitações conhecidas
- Humano **conectado** que não joga só é destravado pelo relógio local dele (`turnTimer`); a IA
  temporária cobre quem **caiu**.
- Assistir partidas de amigos não existe (nem no cliente nem no servidor): amigo em partida aparece
  como "Na partida" e o botão dele convida para uma sala, que é o que o backend sabe fazer hoje.
- **Testado com 1 humano + 3 bots** (criar sala → completar com IA → iniciar → partida até 12 pontos,
  com o servidor aplicando cada ação). Uma mesa com 2+ humanos reais exige dois dispositivos e ainda
  não foi exercitada; o matchmaking de 4 humanos também não (a fila precisa de 4 contas simultâneas).
