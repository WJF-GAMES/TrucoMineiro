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
- `abandonMatch`: quem sai perde (adversários recebem 12); sessão marcada `abandoned`, demais jogadores são avisados.

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

## Limitações conhecidas
- Não há timeout automático de turno para humanos ausentes (somente abandono explícito ou desconexão visível).
- Assistir partidas de amigos não existe (nem no cliente nem no servidor): amigo em partida aparece
  como "Na partida" e o botão dele convida para uma sala, que é o que o backend sabe fazer hoje.
- **Testado com 1 humano + 3 bots** (criar sala → completar com IA → iniciar → partida até 12 pontos,
  com o servidor aplicando cada ação). Uma mesa com 2+ humanos reais exige dois dispositivos e ainda
  não foi exercitada; o matchmaking de 4 humanos também não (a fila precisa de 4 contas simultâneas).
