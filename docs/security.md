# Segurança

## Princípios
- **Servidor autoritativo.** O cliente **nunca** altera XP, vitórias, derrotas, liga, ranking,
  recompensas ou resultado. Só o backend NestJS escreve no PostgreSQL; o app manda *intenções*
  (jogar esta carta, criar sala, convidar) e o servidor valida autenticação, formato, dono
  (usuário vs. assento/sala/solicitação), estado (`status`, `phase`, `getAvailableActions`) e
  concorrência (transações, `SELECT … FOR UPDATE`, advisory locks).
- **Firebase sem dados de domínio.** `firestore.rules` e `database.rules.json` negam tudo
  (*deny-all*, publicadas na virada — docs/firebase.md); `storage.rules` é *deny by default*.
- Nenhum segredo no repositório nem no app. Em staging/produção os segredos vêm do **Secret
  Manager** (injetados no Cloud Run); no desenvolvimento, de `backend/.env` / `backend/.env.test`,
  que ficam fora do Git. Documentação usa sempre placeholders.

## Autenticação e App Check
- Toda rota REST passa pelo `FirebaseAuthGuard` global (exceto `@Public()`: health, webhooks e as
  rotas administrativas, que têm guard próprio). O ID Token é verificado pelo Admin SDK; o usuário
  interno é resolvido pelo `firebaseUid` do token — o app nunca informa `userId`.
- O WebSocket autentica no handshake com o mesmo token (namespace `/rt`), renova por
  `session.refresh` (só para o mesmo UID) e derruba sockets com token vencido há mais de 5 min.
- `AUTH_MODE=test` e `FIREBASE_AUTH_EMULATOR_HOST` são **proibidos** em staging/produção: o boot
  falha (`backend/src/config/env.ts`). Também falha sem `DATABASE_URL`, `CONTACTS_PEPPER` e
  `ADMIN_SECRET` (os dois últimos com pelo menos 32 caracteres), ou com `JOBS_MODE=external` sem
  `WEBHOOK_SCHEDULER_SECRET`. A CI confere que o build de produção não sobe sem segredos.
- **App Check**: com `ENFORCE_APP_CHECK=true` o backend exige `x-firebase-appcheck` (REST) ou
  `auth.appCheck` (WebSocket) e verifica com o Admin SDK (`APP_CHECK_INVALID`, 401). O
  `scripts/deploy.sh` sobe com `true` por padrão; antes disso o App Check precisa estar configurado
  no Console (Play Integrity com os SHA, App Attest, debug token dos builds de desenvolvimento),
  senão **todo** o app é recusado. Detalhes em docs/authentication.md.

## Superfície HTTP (`backend/src/main.ts`)
- **Helmet** (sem CSP — a API não serve HTML; `Cross-Origin-Resource-Policy: same-site`),
  `x-powered-by` desligado, ETag desligado (respostas por usuário), `trust proxy` para o IP real
  atrás do balanceador, corpo JSON limitado a 256 KB.
- **CORS**: o app móvel não manda `Origin`; a lista `CORS_ORIGINS` vale para ferramentas web. Sem
  lista, produção nega origens cruzadas; fora de produção aceita qualquer uma. Métodos
  `GET/POST/PATCH/DELETE`, cabeçalhos `authorization`, `content-type`, `idempotency-key`,
  `x-request-id`, `x-firebase-appcheck`.
- **Validação**: `ValidationPipe` com `whitelist` + `forbidNonWhitelisted` (campo desconhecido é
  erro) e DTOs com regex (uid, código de sala, E.164, ids de carta). Ações de jogo passam ainda por
  `action-parser.ts`; a regra em si é do motor.
- **Swagger** (`/docs`) só fora de produção (ou com `SWAGGER_ENABLED=true`).
- Erros saem sempre como `{ error: { code, kind, message, requestId } }`, sem stack.

## Rate limiting
| Camada | Onde | Como |
|---|---|---|
| HTTP global | `SessionThrottlerGuard` (`common/throttler.guard.ts`) | `HTTP_RATE_LIMIT` (padrão 300) por minuto, contado **por sessão** (hash do `Authorization`), não por IP — jogadores atrás do mesmo NAT de operadora não se atrapalham. Sem token (webhooks) conta o IP. Rotas sensíveis têm `@Throttle` próprio (ex.: bootstrap 20/min, perfil 10/min, excluir conta 3/min, jogada REST 120/min, partida IA 30/min, matchmaking 20/min, agenda 20/min, webhooks 120/min). O contador é em memória por instância. |
| Por usuário e ação | `RateLimitService` (`common/rate-limit.service.ts`) | Janela fixa em `RateLimitBucket` (UPSERT atômico, vale entre instâncias): 10 salas/min, 6 salas com amigos/min, 20 convites/min; `cooldown` garante um push por convite a cada 15 s. |
| Agenda | `ContactsService` | Cota diária em `ContactSyncQuota` (ver abaixo). |
| WebSocket | `RealtimeGateway` | *Token bucket* por socket: 60 eventos de capacidade, reposição de 30/s (`RATE_LIMITED`); até 300 assinaturas de presença por socket e 200 uids por pedido; mensagens de até 64 KB. |

## Idempotência
| Operação | Mecanismo |
|---|---|
| Partida contra a IA (`POST /v1/matches/ai`) | `Match.externalKey` = `{uid}_{matchId}` + `MatchResult (key, userId)` na mesma transação — segunda chamada devolve `alreadyProcessed` |
| Progressão online | `MatchResult` com chave `{matchId}` (ou `{matchId}_left_{uid}` para quem saiu) |
| Jogada online | `GameAction (matchId, clientActionId)` — o servidor usa `{userId}:{actionId}`; IA e timeout têm chaves próprias por versão do estado |
| Pontos da liga | `LeagueScore.key` = `{matchKey}__{userId}__{evento}` |
| POST/PATCH/DELETE repetíveis | cabeçalho `Idempotency-Key` → `IdempotencyKey` (mesma resposta por 24 h; reutilizar a chave em outra rota é erro) |
| Webhooks | `WebhookEvent (provider, externalEventId)` |
| Entrar em sala / aceitar convite | já-membro / convite já aceito devolvem o mesmo resultado |

## Anti-trapaça no modo IA
O cliente envia `seed`, `aiSeed`, `difficulty` e a lista de ações (máx. 2.000). O servidor re-executa
a partida com o mesmo engine (`replayAiMatch`) e exige que cada ação de IA seja idêntica à decisão
determinística da IA e que cada ação humana esteja em `getAvailableActions` — qualquer divergência
(`AI_REPLAY_MISMATCH`), partida sem fim (`MATCH_NOT_FINISHED`) ou longa demais (`MATCH_TOO_LONG`)
rejeita a partida.

## Cartas escondidas (mãos e carta virada)
- O estado completo (`Match.state`, JSONB) **nunca** sai do servidor. `GameAction.payload` (que
  guarda a carta real de uma jogada virada) também não é exposto.
- Cada assento recebe `game.view` numa sala Socket.IO própria (`match:{id}:seat:{n}`), montada por
  `buildView` → `viewForSeat`: só as próprias cartas (`myCards`) e contagens das outras mãos. O
  servidor decide o assento pelo usuário autenticado; trocar de dono (IA ↔ humano) esvazia a sala do
  assento antes de pôr o novo dono.
- **Carta virada**: a identidade só aparece na view e nos eventos de quem a jogou (`playForSeat`,
  `eventsForSeat` por assento); os outros recebem `card: null`. `MatchEvent` (auditoria) não guarda
  carta secreta. Cobertura: `src/domain/game/__tests__/covered.test.ts` e os testes de integração
  do jogo.
- As mãos só são mostradas a todos quando a mão de onze é recusada (`HAND_REVEALED`), depois de a
  mão estar decidida.

## Dados sensíveis e logs
- Analytics e Crashlytics nunca recebem telefone, OTP, tokens ou credenciais.
- Service Account não existe no app; `google-services.json` contém apenas chaves públicas do cliente.
- A agenda do aparelho nunca sai dele: nome, e-mail e foto dos contatos ficam locais.
- **Logs** (`backend/src/common/logger.ts`): JSON de uma linha por evento, com **redação** antes de
  escrever — chaves como `authorization`, `token`, `idToken`, `password`, `otp`, `secret`, `phone*`,
  `hands`, `deck`, `state`, `privateKey`, `fcmToken` e `x-firebase-appcheck` viram `[redacted]`;
  telefones E.164 soltos em texto ficam só com os 4 últimos dígitos e `Bearer …` é mascarado.
  Arrays são cortados em 50 itens e objetos em 5 níveis.

## Busca de contatos — anti-enumeração

`POST /v1/contacts/sync` é o único caminho para descobrir se um telefone tem conta, e é desenhado para
**não** virar um oráculo de "esse número usa o app?":

| Camada | O quê |
|---|---|
| Autenticação | ID Token obrigatório — sem login não há chamada |
| App Check | mesma flag `ENFORCE_APP_CHECK` das demais rotas |
| Formato | só E.164 (`/^\+[1-9]\d{6,14}$/`); qualquer outra coisa é rejeitada antes de tocar o banco |
| Lote | máximo 200 números por chamada |
| Cota diária | 40 chamadas **e** 3.000 números por usuário (`ContactSyncQuota`, UPSERT atômico) + 20 chamadas/min no throttler |
| Resposta | devolve o *índice* do número na lista enviada, nunca o número; só apelido, avatar e nível |
| Bloqueio | quem bloqueou e quem foi bloqueado somem do resultado, nos dois sentidos |
| Perfil incompleto | quem não terminou o cadastro não aparece |

O diretório (`User.phoneHash`, `backend/src/contacts/phone-directory.service.ts`) guarda **apenas**
`HMAC-SHA256(CONTACTS_PEPPER, e164)`. O pepper fica no Secret Manager (ou `backend/.env` no
desenvolvimento) e nunca é enviado ao app — por isso o app manda o número em claro (sobre TLS) e o
servidor hasheia. A alternativa "hashear no cliente" exigiria um salt dentro do APK, que qualquer um
extrai para montar um dicionário offline de todos os telefones do Brasil; aqui, sem o pepper, um
dump do banco não reverte para número nenhum. Trocar `CONTACTS_PEPPER` invalida o diretório
inteiro — cada usuário volta a ser indexado no próximo bootstrap.

O índice é gravado a partir do claim `phone_number` do **ID Token** (telefone verificado por OTP),
**nunca** de um payload do cliente: ninguém se cadastra no diretório com o telefone de outra pessoa.
Se o mesmo hash aparece em outra conta, o índice antigo é removido (o Auth não permite duas contas
com o mesmo telefone).

Não existe busca livre por telefone na UI (só por apelido): um campo de número seria exatamente
o endpoint de enumeração que essas camadas evitam. O convite de sala para contato que ainda não é
amigo (`POST /v1/rooms/:code/invites/direct`) exige que o número informado pertença ao convidado.

### Conexão automática pela agenda
A sincronização cria amizade sem solicitação, então o "match" tem efeito social. Camadas extras:
- telefone verificado é a fonte de verdade: o índice é reconferido no Firebase Auth a cada match
  (conta apagada/desativada ou número trocado não conecta, e o índice velho sai);
- quem sincroniza precisa ter telefone verificado no token; conta sem telefone só enxerga os matches;
- teto de 150 conexões automáticas por dia por usuário (além das cotas de números/chamadas);
- bloqueio (qualquer sentido) e supressão (amizade removida) vencem sempre, relidos na transação
  sob advisory lock do par;
- o outro lado vê só o perfil público (apelido, avatar, nível): nenhum telefone, nome da agenda ou
  indicação de "veio da agenda" é exposto;
- `FriendshipSuppression` não é exposta por nenhuma rota.

### Bloqueio
`GET /v1/blocks` devolve só quem **eu** bloqueei. Quem me bloqueou não é exposto por nenhuma rota —
saber que foi bloqueado é justamente o que o bloqueio evita; o servidor consulta `BlockedUser` nos
dois sentidos (`blockedSet`) para filtrar a agenda, os convites e as solicitações.

### Convite por QR
`User.inviteToken` guarda um token opaco com validade de 30 dias (reaproveitado enquanto válido). O
QR carrega `trucomineiro://add-friend?token=...` — sem telefone e sem o uid interno — e o link só
vira solicitação depois de o usuário confirmar o diálogo no app (link é conteúdo externo, nunca ação
automática). Resolver token tem limite de 30/min.

## Convites de sala e push
- Só o servidor envia push (`notifications/push.service.ts`, depois do commit — falha de FCM nunca
  desfaz a sala); o cliente manda a intenção. O convite em grupo só aceita **amigos**, sem bloqueio
  em nenhum sentido.
- O payload do push leva só `type`, `code` e `inviteId`. O servidor confere prazo, reserva e status
  da sala em toda aceitação — o push/link é só um atalho.
- Tokens FCM recusados (`registration-token-not-registered` etc.) são apagados de `UserDevice`.

## Visibilidade entre jogadores
- Bloqueio vale nos dois sentidos para busca (`/v1/players/search`), perfil público
  (`/v1/players/:uid` responde `PLAYER_NOT_FOUND`), presença (`/v1/presence/query` e
  `presence.subscribe`), solicitações de amizade e agenda.
- Em qual partida alguém está (`sessionId`) só aparece para amigos; o evento `presence.changed`
  (sala que qualquer um pode assinar) nunca leva esse dado.

## Webhooks
`POST /webhooks/:provider` é público, mas todo evento precisa de credencial (docs/webhooks.md):
- HMAC: `x-webhook-signature: v1=hex(HMAC_SHA256(WEBHOOK_SCHEDULER_SECRET, "<timestamp>.<id>.<corpo cru>"))`
  com `x-webhook-timestamp` (janela de 5 min) e `x-webhook-id` (assinado: trocar o id invalida);
  comparação em tempo constante; segredo com ≥ 32 caracteres em staging/produção;
- ou token OIDC do Cloud Scheduler (audiência `WEBHOOK_SCHEDULER_OIDC_AUDIENCE`, e-mail verificado
  igual a `WEBHOOK_SCHEDULER_SERVICE_ACCOUNT`) + `x-cloudscheduler-scheduletime` dentro de 60 min;
- o corpo só é lido depois da autenticação; só nomes de job conhecidos são aceitos;
- id externo único por provedor (`WebhookEvent`): replay/retry não reprocessa (só reprocessa se a
  tentativa anterior falhou ou ficou presa em `PROCESSING` por mais de 15 min).

## Operações administrativas
`/v1/admin/*` (seed, ligas, jobs, diagnóstico) e `/metrics` exigem `x-admin-secret` igual a
`ADMIN_SECRET` (comparação em tempo constante, `AdminGuard`). O segredo tem pelo menos 32
caracteres fora do desenvolvimento e vive no Secret Manager.

## Assinatura do APK

`android/app/build.gradle` lê as credenciais de **`android/keystore.properties`** e, quando o arquivo
existe, assina a variante `release` com o keystore de produção. Sem o arquivo, o `release` cai no
`android/app/debug.keystore` do template Expo — build local descartável, nunca para a loja.

Keystore de produção: `F:/WJF_GAMES/KeyAndroid/key_android`, alias `wjf_games`, RSA 2048 / SHA256withRSA,
`CN=William Fernandes, O=WJF SOFTWARE DEVELOPMENT LTDA - ME`. Impressões atuais:

| | |
|---|---|
| SHA-1 | `38:AC:65:55:E1:2F:76:05:1E:57:53:76:DF:5A:23:28:A3:0B:DE:9D` |
| SHA-256 | `A2:F3:B2:31:3B:74:4F:FB:20:C9:10:77:18:2A:C2:61:6C:96:77:8C:54:0F:31:83:4A:2D:9D:15:E9:F9:FD:72` |

**O keystore e o `keystore.properties` ficam fora do Git** (`/android` é gerado pelo prebuild e está no
`.gitignore`; o keystore mora fora do repositório). Consequências operacionais:

- `expo prebuild --clean` apaga `android/keystore.properties` — recriar antes do próximo build de release.
- Perder `key_android` ou a senha significa perder a capacidade de publicar atualizações do app na Play
  Store sob o mesmo `applicationId`. Manter backup offline do arquivo e da senha.
- Publicando com **Play App Signing**, essa chave vira a *upload key* e o Google passa a assinar o que é
  entregue ao usuário — nesse caso o SHA-1 da chave do Google também vai para o Firebase Console.

Para conferir a assinatura real de um APK (fonte de verdade — não presuma o keystore):
```
"$ANDROID_HOME/build-tools/37.0.0/apksigner.bat" verify --print-certs dist/truco-mineiro-1.1.0.apk
keytool -printcert -jarfile dist/truco-mineiro-1.1.0.aab
```

## Build do app
- Release exige `EXPO_PUBLIC_API_URL` em `https://`; `app.config.js` recusa build de
  staging/produção sem ela, com URL local ou apontando para outro ambiente, e recusa
  `EXPO_PUBLIC_ALLOW_INSECURE_API` fora de QA local.
- A imagem Docker do backend roda como usuário sem privilégio (verificado na CI).

## Pendências
- Registrar no Console o SHA-1/SHA-256 acima (necessário para Phone Auth fora do emulador) e baixar
  de novo o `google-services.json` — o atual ainda está com `oauth_client: []`.
- Configurar o App Check no Console antes de subir o backend com `ENFORCE_APP_CHECK=true`.
- Publicar as regras *deny-all* do Firestore/RTDB na virada e apagar os dados antigos depois do
  período de rollback (docs/production-runbook.md).
