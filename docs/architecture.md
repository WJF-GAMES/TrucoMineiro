# Arquitetura — Truco Mineiro / TrucoX

## Stack
- **Mobile**: React Native 0.86 + Expo SDK 57 (dev-client / prebuild, New Architecture), TypeScript strict.
- **Backend próprio**: NestJS 11 em `backend/` — REST (`/v1`), Socket.IO (namespace `/rt`),
  webhooks (`/webhooks/:provider`), jobs agendados (cron interno ou Cloud Scheduler via webhook),
  push por FCM e PostgreSQL 17 via Prisma 6. É a **única autoridade** de regra, resultado e progressão.
- **Firebase (só no que não é dado de domínio)**: Auth por telefone, Cloud Messaging, Analytics,
  Crashlytics, Performance, Remote Config, App Check e o Auth Emulator no desenvolvimento
  (ver docs/firebase.md). AdMob via Google Mobile Ads.
- **Removidos**: Cloud Functions (a pasta `functions/` não existe mais), Firestore e Realtime
  Database. As regras dos dois bancos ficam em *deny-all* até serem apagados
  (docs/migration.md, docs/production-runbook.md).

## Estrutura de pastas
```
src/
  bootstrap/        App raiz + useAppBootstrap (fontes, App Check, Remote Config, auth listener,
                    POST /v1/me/bootstrap, conexão do socket, perfil ao vivo, push)
  design-system/    tokens (colors, typography, spacing, radius, shadows, motion, icons)
  components/       componentes reutilizáveis (ver docs/design-system.md)
  navigation/       RootNavigator (stack), MainTabs + BottomNavigation (custom tab bar), types
  screens/          intro, auth, home, play, online, game, league, friends, more, profile, settings
  features/game/    controladores de mesa: useAiGame (local) e useOnlineGame (WebSocket + REST) →
                    TableController; useResumeActiveMatch (volta para a partida online após reiniciar)
  features/friends/ amigos, agenda e convites: contactsMatch (puro), contactsCache, useFriends,
                    useContactsSync, useFriendInviteLink (deep link do QR), useRoomInvites +
                    useRoomInvitePrompt (convites de sala pelo WebSocket), usePresenceMap
  features/league/  aba Minha Liga
  domain/
    game/           GAME ENGINE puro (cards, deck, rules, state, engine, ai) — não importa
                    react/react-native/firebase (lint proíbe)
    model/          tipos do modelo, ligas (escada, semana ISO, grupos, ranking) — compartilhados com o backend
  ads/              monetização por anúncios (Google Mobile Ads): AdService + frequência + placements
                    nomeados + consentimento (UMP). Nenhuma tela fala com o SDK — ver docs/ADMOB_MONETIZATION.md
  services/api/     client.ts (HTTP), realtime.ts (Socket.IO), backend.ts (todas as operações), config.ts (URLs)
  services/firebase/ wrappers tipados de Auth, App Check, Analytics, Crashlytics, Messaging, Perf,
                    Remote Config + switch do Auth Emulator (EXPO_PUBLIC_USE_EMULATORS=1)
  services/contacts.ts  agenda do aparelho (expo-contacts): permissão + leitura paginada de nome/telefones
  stores/           Zustand: auth, profile, settings (persistido), network, toast — stores pequenos e separados
  utils/            format, phone (E.164 + normalizePhoneNumber via libphonenumber-js), haptics
backend/            NestJS (ver abaixo). `scripts/sync-domain.js` copia src/domain → backend/src/domain
scripts/            extract-assets.py (recortes da referência), simulate-ai.ts (milhares de partidas), QA
references/         referências individuais recortadas de referencia.png
artifacts/          screenshots e comparações visuais (QA)
```

### Backend (`backend/`)
```
backend/
  prisma/           schema.prisma, migrations/, seed.ts (20 ligas + conquistas, idempotente)
  scripts/          sync-domain.js, load-test.ts, smoke-test.ts, migração Firebase → PostgreSQL
  src/
    main.ts         bootstrap: Helmet, CORS, ValidationPipe, Swagger (/docs fora de produção),
                    adapter Socket.IO (Redis opcional), desligamento ordenado (SIGTERM)
    app.module.ts   composição dos módulos (abaixo)
    config/         env.ts — configuração validada no boot (falta de segredo derruba o processo)
    prisma/         PrismaService (transações, advisory lock)
    auth/           FirebaseAuthGuard (global), AuthService, AdminGuard, decorators
    firebase/       FirebaseAdminService — ID Token, App Check, consulta/remoção de contas, FCM
    common/         erros, filtro de exceções, envelope de resposta, idempotência, rate limit,
                    throttler por sessão, logger JSON com redação, KeyedMutex, request id
    domain/         CÓPIA gerada de src/domain (não editar aqui)
    game/           GameService (partida autoritativa), GameSchedulerService (relógio/IA),
                    stored-state, game-views, action-parser, MatchesController
    rooms/          RoomsService, RoomRepository, room-logic (regras puras), RoomsController
    matchmaking/    MatchmakingService (fila de partida rápida)
    users/          UsersService (bootstrap, perfil, exclusão), UserLookupService, controllers /me e /players
    friends/        FriendsService, FriendshipRepository, FriendsController (amigos, bloqueios, agenda, QR)
    contacts/       ContactsService (sincronização da agenda), PhoneDirectoryService (HMAC)
    presence/       PresenceService (memória por instância + escrita só em mudança)
    leagues/        LeaguesService (atribuição, pontos, ranking, virada), LeaguesController
    progression/    ProgressionService (XP, nível, estatísticas, conquistas, pontos da liga)
    notifications/  PushService (FCM), NotificationsController
    realtime/       RealtimeGateway (/rt), RealtimeService (emissão), events.ts (contrato), Redis adapter
    jobs/           JobsService (jobs de manutenção), JobLockService (trava entre instâncias)
    webhooks/       WebhooksService / Controller (Cloud Scheduler assinado)
    admin/          AdminController (/v1/admin/*, `x-admin-secret`), SeedService
    health/         /health, /health/ready, /metrics (admin), /v1/stats/online
    metrics/        MetricsService (Prometheus)
  test/             unit/, integration/, e2e/ (ver docs/testing.md)
```

Módulos Nest (`app.module.ts`):

| Módulo | Conteúdo |
|---|---|
| `ConfigModule`, `PrismaModule`, `AuthModule` | configuração, banco, autenticação (globais) |
| `CoreModule` (global) | RealtimeService, RateLimitService, UserLookupService, JobLockService, PushService, FriendshipRepository, PhoneDirectoryService, PresenceService |
| `LeaguesModule` | LeaguesService, ProgressionService, LeaguesController |
| `PlayModule` | GameService, GameSchedulerService, RoomRepository, RoomsService, MatchmakingService, MatchesController, RoomsController |
| `SocialModule` | UsersService, FriendsService, ContactsService, controllers de /me, /players, amigos e notificações |
| `RealtimeModule` | RealtimeGateway |
| `OpsModule` | JobsService, WebhooksService, SeedService, controllers de webhooks, admin, health e stats |
| `ScheduleModule`, `ThrottlerModule` | cron interno e rate limit HTTP |

Provedores globais: `SessionThrottlerGuard` → `FirebaseAuthGuard` (guards), `ResponseInterceptor`
(envelope `{ data }`), `IdempotencyInterceptor` (`Idempotency-Key`), `AllExceptionsFilter`
(erro `{ error: { code, kind, message, requestId } }`).

Contratos: REST em docs/api.md, WebSocket em docs/websocket.md, banco em docs/database.md,
webhooks em docs/webhooks.md, implantação em docs/deployment.md.

## Fluxo de dados
```
UI (screens) → stores (Zustand) / hooks de feature → services/api ──REST /v1──────→ backend NestJS → PostgreSQL
                                                                   └─Socket.IO /rt─↗        │
                                                                                            ├→ Firebase Admin (ID Token, App Check, FCM)
                                                   domain/game (engine puro) ←── mesma cópia em backend/src/domain

No cliente, direto com o Firebase: Auth (telefone/OTP), FCM (token do aparelho), Analytics,
Crashlytics, Performance, Remote Config, App Check e AdMob.
```
- Nenhuma tela chama `fetch` nem o socket direto: tudo passa por `services/api/backend.ts`, que
  manteve os nomes das antigas callables (`bootstrapUser`, `submitGameAction`, `finalizeAiMatch`,
  `syncPhoneContacts`…). As assinaturas "ao vivo" (`subscribeRoom`, `subscribeMatch`,
  `subscribePresence`…) viraram eventos do WebSocket.
- `client.ts`: base URL por ambiente, `Authorization: Bearer <ID Token>` + `x-firebase-appcheck`,
  timeout de 12 s, 401 `AUTH_TOKEN_*` → renova o token e repete uma vez, repetição com backoff só
  para GET ou POST com `Idempotency-Key`, erro padronizado em `ApiError` (`code` = família,
  `errorCode` = código do servidor).
- `realtime.ts`: um socket por app, autenticado no handshake; reconecta com backoff e reexecuta as
  assinaturas registradas (`whileConnected`) — sala, partida, presença e liga nunca ficam velhas
  depois de uma queda. `emit` devolve o ack ou lança `ApiError` no mesmo formato do REST.
- `config.ts`: `EXPO_PUBLIC_API_URL` / `EXPO_PUBLIC_WS_URL` (WS padrão = mesma URL da API). Em
  desenvolvimento sem variável: `http://10.0.2.2:11002` no emulador Android e `http://localhost:11002`
  nos demais. Fora de desenvolvimento a URL precisa ser `https://` (exceto com
  `EXPO_PUBLIC_ALLOW_INSECURE_API=1`, só para QA local); `app.config.js` recusa build de
  staging/produção sem URL https própria do ambiente.
- **Abertura do app**: `useAppBootstrap` chama `POST /v1/me/bootstrap` uma vez após o login (cria ou
  localiza o usuário, garante liga, devolve perfil, estatísticas, convites, partida ativa) e conecta o
  socket. `useResumeActiveMatch` usa o `activeMatch` desse bootstrap para levar o jogador de volta à
  mesa online depois de o app ter sido fechado.

### Contra a IA
A partida roda **localmente** com o engine; cada decisão de IA vê apenas `AIObservation` (projeção do
`SeatView`). Ao final o cliente envia `{matchId, seed, aiSeed, difficulty, actions}` para
`POST /v1/matches/ai`. O servidor **re-executa** a partida inteira (`replayAiMatch`): cada ação humana
precisa estar em `getAvailableActions`, e cada ação de IA precisa ser idêntica à que a IA
determinística produziria com o mesmo RNG. Só então grava a partida (`Match` modo `AI`, ações,
participantes) e aplica XP/estatísticas/liga na mesma transação. Idempotente por
`{uid}_{matchId}` (`Match.externalKey` + `MatchResult`): repetir a chamada devolve
`alreadyProcessed` com o mesmo resultado.

### Online
O cliente nunca é autoridade. O estado completo fica em `Match.state` (JSONB, nunca sai do
servidor); cada assento recebe só a sua projeção (`game.view`, sala Socket.IO do assento). Ações vão
por `game.*` no WebSocket (ou `POST /v1/matches/:id/actions`), são validadas pelo motor dentro de uma
transação com `SELECT … FOR UPDATE` na partida e são idempotentes por `actionId`. Detalhes em
docs/multiplayer.md e docs/game-engine.md.

### Bots e relógio no servidor
IA, prazo de jogada, tolerância de desconexão e troca de controlador são do servidor
(`GameSchedulerService`): cada partida guarda `nextTickAt`; a instância agenda um timer local e
também varre o banco (`FOR UPDATE SKIP LOCKED`), então nenhum tick fica órfão nem roda duas vezes.
O cliente ainda pede `game.advance-bots` para dar ritmo à mesa, mas o servidor decide se cabe
(intervalo mínimo) e joga sozinho depois de `BOT_FALLBACK_SECONDS` se ninguém pedir. O prazo de cada
decisão vem de `src/domain/game/rules/timing.ts` e é publicado na view (`turnDeadlineAt`,
`serverTime`).

### Presença
`PresenceService` mantém em memória, por instância, quantos sockets cada usuário tem e só grava em
`UserPresence` quando o estado **muda** (conectou, caiu, entrou/saiu de partida, segundo plano) —
nunca em heartbeat por usuário. Cada instância grava um heartbeat próprio (`BackendInstance`, 30 s);
presença de instância morta é limpa pelas outras (`presence.reap`). O app assina a presença de
quem aparece na tela (`presence.subscribe`) e recebe `presence.changed`; o contador global chega por
`stats.online`. Com várias instâncias, o adapter Redis do Socket.IO (`REDIS_URL`) entrega eventos e
salas entre elas, e "o usuário ainda tem socket?" é consultado no cluster (docs/websocket.md).

### Amigos pela agenda (conexão automática)
`services/contacts` lê a agenda em páginas; `features/friends/contactsMatch` normaliza para E.164,
deduplica e fatia em lotes de 200; `POST /v1/contacts/sync` (`syncPhoneContacts`) calcula o HMAC de
cada número, confere no Firebase Auth que o dono ainda tem aquele telefone verificado e **cria a
amizade direto** (sem solicitação nem push), devolvendo quem tem conta pelo *índice* do número.
Prioridade (`FriendshipRepository`): bloqueio → já amigos → supressão (amizade removida) → conectar.
Os dois lados recebem `friends.changed` na hora. A aba Amigos mostra ONLINE → AMIGOS → contatos que
já jogam (só removidos/pendentes) → CONVIDAR. Nenhum nome sai do aparelho e nenhum telefone volta
(ver docs/security.md).

### Convite de sala entre amigos
"Jogar" cria a sala (`POST /v1/rooms` ou `POST /v1/rooms/friends`) e convida
(`POST /v1/rooms/:code/invites[/direct]`). O servidor grava `RoomInvite`, emite `invites.updated`
para o convidado e manda push (FCM) depois do commit. O convidado recebe a caixa de entrada ao vivo
(`useRoomInvites`): a aba Amigos mostra "Convites para jogar" e o resto do app um diálogo
(`useRoomInvitePrompt`, silencioso durante a partida). Entrar (`room.invite.accept` /
`POST /v1/invites/:code/respond`) leva ao lobby; recusar ou dispensar (`DELETE /v1/invites/:code`)
tira o convite da caixa. Detalhes em docs/multiplayer.md.

## Estados separados (performance)
GameState (engine/view) · UIState (telas/stores) · AnimationState (Reanimated local) · NetworkState
(`networkStore`, conexão do socket).

## Segurança
- Servidor autoritativo: XP, vitórias, liga, ranking e resultado só mudam no backend.
- Toda requisição e todo socket autenticam com o Firebase ID Token verificado pelo Admin SDK; App
  Check opcional (`ENFORCE_APP_CHECK`).
- Firestore/RTDB em *deny-all*; Storage *deny by default*.
- Idempotência: `MatchResult (key, userId)` para progressão; `GameAction (matchId, clientActionId)`
  para jogadas; `LeagueScore.key` para pontos semanais; `Idempotency-Key` para POSTs repetíveis.
- Detalhes em docs/security.md.

## Decisões
- Ladder de apostas 1 → 3 (Truco) → 6 → 9 → 12 conforme requisito funcional (Seis/Nove/Doze).
- Manilhas fixas do Truco Mineiro: Zap (4♣) > 7♥ > Espadilha (A♠) > 7♦.
- Mão de onze: time com 11 decide jogar (vale 3) ou entregar 1; 11×11 joga normal sem truco.
- Empate nas três rodadas: mão sem pontos.
- Um único domínio (`src/domain`) roda no app e no servidor; o backend recebe uma cópia gerada, e a
  CI falha se a cópia divergir.
- PostgreSQL como fonte de verdade (transações e travas reais) em vez de documentos + triggers.
