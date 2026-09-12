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

## Limitações conhecidas
- Não há timeout automático de turno para humanos ausentes (somente abandono explícito ou desconexão visível).
- Assistir partidas de amigos ("Assistir") ainda não implementado (exibe aviso).
