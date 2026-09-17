# Testes

| Tipo | Comando | Cobertura |
|---|---|---|
| Unit — Game Engine | `npm run test:engine` | baralho, shuffle determinístico, distribuição, força/manilhas, turno, rodadas e empates, Truco/Seis/Nove/Doze (aceitar, aumentar, correr), mão de onze, fim de partida, views sem vazamento, relógio da jogada (`timing.test.ts`) |
| Unit — IA | idem | ações sempre válidas, nunca carta inexistente, nunca fora de turno, nunca vê cartas escondidas, 900 partidas terminam |
| Simulação em massa | `npm run test:sim -- 3000` | 9.000 partidas IA×IA: deadlock, loop, contagem de cartas impossível, término garantido |
| App (unit + component) | `npm test` (jest-expo) | `src/**/__tests__` (componentes usam mocks dos módulos nativos em `jest.setup.ts`); ignora `backend/` |
| Backend — unit | `npm --prefix backend test` | projeto `unit`: config (boot falha sem segredo), redação do logger, erros padronizados, parser de ações e replay da partida IA, estado privado e views, KeyedMutex, `room-logic`, e os testes do domínio copiado (`backend/src/domain/**/__tests__`) — sem banco |
| Backend — integração | `npm --prefix backend run test:integration` | projeto `integration` (+ `test/e2e`): API e WebSocket reais sobre PostgreSQL, em série (`--runInBand`) |
| Carga | `backend/scripts/load-test.ts` | REST + WebSocket + partidas simultâneas; p50/p95/p99, erros, sockets, ações/s, CPU/RAM e conexões do banco |
| Smoke pós-deploy | `backend/scripts/smoke-test.ts` | liveness/readiness, cabeçalhos de segurança, REST sem token/token inválido (401), `/metrics` protegido, WS sem token recusado; com token: bootstrap, leituras e `session.ready` |
| E2E manual/QA | roteiro em docs/visual-regression.md | Introdução → Login → OTP → Cadastro → Principal → Jogar → IA → Mesa → Resultado; Online → Jogo rápido → Mesa; Criar sala → Lobby |

Ciclo por feature: implementar → `npm run format` → `npm run lint` → `npm run typecheck` → `npm test` → build → executar → QA funcional → QA visual → corrigir.
`npm run check` na raiz roda lint + tipos + testes do app **e** `npm --prefix backend run check`
(lint, tipos, unitários e build do backend). Os scripts do backend rodam `sync-domain` antes —
o domínio testado no servidor é sempre a cópia atual de `src/domain`.

## Backend — integração

Precisa de um PostgreSQL 17 e de um **schema dedicado**. Os testes fazem `TRUNCATE` no schema da URL,
então nunca apontam para dev, staging ou produção.

- URL: `TEST_DATABASE_URL` no ambiente ou em `backend/.env.test` (fora do Git), por exemplo
  `postgresql://<usuario>:<senha>@127.0.0.1:5432/truco_mineiro_db?schema=integration_test&connection_limit=15`.
  No desenvolvimento local é o PostgreSQL compartilhado da máquina (banco `truco_mineiro_db`,
  schema `integration_test`); credenciais só nos arquivos `.env` (docs/database.md).
- `test/setup/test-env.ts` recusa URL sem schema, com `schema=public` ou com "prod"/"staging" no
  endereço, e força `NODE_ENV=test`, `AUTH_MODE=test` (tokens `test:<uid>:<telefone>`),
  `JOBS_MODE=off`, segredos de teste e prazos curtos (tolerância de desconexão 1 s, IA 50 ms).
- `global-setup.ts` aplica as migrations (`prisma migrate deploy`) e o seed estrutural no schema de
  teste antes da suíte.
- Roda em série (`--runInBand`): as suítes compartilham o schema.

| Suíte | Cobre |
|---|---|
| `test/integration/auth-users.spec.ts` | token ausente/inválido, `USER_NOT_FOUND` antes do bootstrap, bootstrap idempotente → cadastro → Bronze + grupo, telefone indexado só como hash, validação de apelido/avatar, cliente não altera XP/liga/vitórias, busca, aparelhos FCM, exclusão de conta, `Idempotency-Key`, health/readiness, OpenAPI |
| `test/integration/game.spec.ts` | 1 humano × 3 IA até 12 com progressão aplicada uma vez; 2x2 com quatro humanos (cada um vê só a própria mão); `actionId` repetido e jogada fora da vez; carta virada não chega aos adversários; IA temporária e retomada; abandono com outro humano; timeout do servidor; truco pelo motor |
| `test/integration/rooms.spec.ts` | sala com 3 amigos (reservas, caixa de entrada, push), só amigos e no máximo 3, aceite idempotente/recusa/início, fim da espera com IA e convidado atrasado no ponto seguro, dono cancelando, troca de convidado, convite direto para contato, sala cheia/inexistente, FCM fora do ar, jogador em outra partida, limpeza |
| `test/integration/social.spec.ts` | amizade única por par (inclusive solicitações cruzadas simultâneas), supressão ao remover, agenda com conexão automática sem expor números, bloqueio nos dois sentidos, validação E.164/lote/cota, QR, presença por lista, notificações |
| `test/integration/leagues-matchmaking.spec.ts` | liga exige cadastro, snapshot com zonas, pontos idempotentes, virada semanal idempotente, rebalanceamento (30 → 15 + 15), matchmaking (4 humanos e 1 + IA), partida contra IA re-executada e fraude recusada |
| `test/integration/webhooks-resilience.spec.ts` | evento assinado processado uma vez (replay = duplicado), assinatura/carimbo/provedor/job inválidos, admin exige segredo, banco indisponível (503 controlado), rate limit 429 |
| `test/integration/migration.spec.ts` | migração Firebase → PostgreSQL (idempotência por documento) |
| `test/e2e/websocket.spec.ts` | Socket.IO `/rt`: recusa sem token/token inválido/sem cadastro, presença em tempo real, convite ao vivo, 2x2 com quatro clientes (views privadas, queda e reconexão), IA jogando pelo agendador |

## Carga e smoke

```
# alvo com AUTH_MODE=test (ambiente local ou de carga — nunca produção)
npm --prefix backend run load:test -- --url http://localhost:3200 --users 500 --matches 25 --duration 60
npm --prefix backend run smoke -- --url http://localhost:3000 --test-token
SMOKE_ID_TOKEN=<ID token de uma conta de teste> npm --prefix backend run smoke -- --url https://<api-staging>
```
- O teste de carga usa tokens de teste, então **exige** um backend com `AUTH_MODE=test` (que não sobe
  em staging/produção). O segredo de admin para ler `/metrics` vai em `--admin-secret` ou
  `LOAD_ADMIN_SECRET`. A soma dos `connection_limit` (backend + testes + carga) precisa caber no
  limite de conexões do usuário do banco local.
- O smoke só lê (o bootstrap do usuário de smoke é idempotente) e sai com código 1 na primeira
  falha. Sem `SMOKE_ID_TOKEN` roda só as verificações públicas; `SMOKE_ADMIN_SECRET` libera as
  verificações administrativas.

### Várias instâncias
`backend/scripts/multi-instance-check.ts`: duas instâncias (`AUTH_MODE=test`) no mesmo banco e no
mesmo Redis; o mesmo usuário conecta nas duas e entra na mesma partida. Cair numa conexão não
pode deixá-lo offline nem desconectar o assento enquanto a outra vive; cair a última, sim.

```
DATABASE_URL=<banco das instâncias> npx ts-node --transpile-only backend/scripts/multi-instance-check.ts   --a http://localhost:3001 --a-instance backend-B --b http://localhost:3002
```

### Resiliência (feito à mão em 17/09/2026)
| Cenário | Como | Resultado |
|---|---|---|
| Banco fora | proxy TCP entre uma instância e o PostgreSQL, derrubado e religado (o servidor compartilhado não é parado) | `/health` 200, `/health/ready` 503, rotas `503 SERVICE_UNAVAILABLE`; volta sozinho |
| Redis fora (em execução) | `docker stop` do Redis com duas instâncias no ar | REST e sockets seguem; eventos entre instâncias param e voltam sozinhos |
| Redis fora (no boot) | instância com `REDIS_URL` e Redis parado | `boot_failed` em `REDIS_BOOT_TIMEOUT_MS` (código 1) |
| FCM indisponível | instância sem credencial do FCM, solicitação de amizade com aparelho registrado; e FCM travado (dublê) no teste de integração | 200 sem esperar o FCM, `Notification.pushStatus` `PENDING` → `FAILED`, log `fcm_send_failed` com os códigos |
| Backend reiniciado | processo morto com o app aberto | app reconecta e ressincroniza sozinho |
| App morto na partida | processo do app encerrado | IA temporária assume; ao reabrir, volta à mesa e retoma o assento |

## CI (`.github/workflows/ci.yml`)
Roda em todo pull request e em push para `main` e `backend`; nenhum segredo é necessário.

| Job | Passos |
|---|---|
| **App (Expo)** | `npm ci` → lint → typecheck → `npm test -- --ci` → falha se `@react-native-firebase/(firestore\|database\|functions)` ou `httpsCallable` reaparecer em `src`, `app.config.js` ou `package.json` |
| **Backend (NestJS + PostgreSQL)** | serviço `postgres:17` (fuso `America/Sao_Paulo` de propósito); `npm ci` → `sync-domain` e falha se `backend/src/domain` divergir da versão commitada → `prisma generate` / `validate` → migrations do zero (`migrate deploy`) e `migrate diff` contra o schema (sem drift) → `seed` → lint → typecheck → unitários → integração (`TEST_DATABASE_URL` com `schema=integration_test`) → build → confere que `NODE_ENV=production` **não** sobe sem segredos |
| **Imagem do backend** | depois do job do backend: build das imagens `runtime` e `migrate` e checagem de que o contêiner não roda como root |

## Amigos e contatos (app)

| Suíte | Cobre |
|---|---|
| `src/features/friends/__tests__/contactsMatch.test.ts` | normalização E.164, dedupe dentro e entre contatos, agendas de 0/1/100/1.000/10.000, contato sem telefone, vários números por contato, ordenação por utilidade, fingerprint, e a garantia de que **nenhum telefone aparece no resultado** |
| `src/features/friends/__tests__/useContactsSync.test.ts` | os cinco estados de permissão, um request por lote de 200 (nunca por contato), reposicionamento dos índices entre lotes, cache que evita rede quando a agenda não mudou, tradução dos erros do servidor, e que nem telemetria nem disco recebem telefone |
| `src/services/__tests__/contacts.test.ts` | mapeamento dos estados nativos (incluindo `limited` do iOS 18), leitura paginada, só os campos nome+telefones, agenda vazia e falha nativa |
| `src/features/friends/__tests__/useRoomInvites.test.ts` | convite de sala: lista ao vivo, descarte do convite vencido, entrar (joinRoom + limpeza), sala cheia/partida começada (limpa) versus offline (mantém para nova tentativa), recusar |
| `src/screens/friends/__tests__/FriendsScreen.test.tsx` | cada botão da tela chamando a operação certa do backend: jogar/convidar (inclusive amigo em partida), ficha do amigo (liga, números, remover, bloquear com confirmação), aceitar/recusar/cancelar solicitação, estado de carregando das solicitações, busca escondendo bloqueados e oferecendo "Aceitar" para quem já me convidou, convite de sala recebido, desbloqueio, e a flag `friends_enabled` desligada |
| `src/services/api/__tests__/client.test.ts` | URLs (release exige https; dev usa o backend local), ID Token + App Check nos cabeçalhos, renovação no 401, `ApiError` com família e código, repetição só para GET ou POST com `Idempotency-Key`, sem sessão não chama o servidor |

O lado do servidor (HMAC determinístico, teto de 200 por lote, rejeição de tudo que não é E.164,
conexão automática) é coberto por `backend/test/integration/social.spec.ts`.

## Mesa e cerimônia (app)

| Suíte | Cobre |
|---|---|
| `src/domain/game/__tests__/engine.test.ts` (cerimônia) | a mão começa em `SHUFFLING` sem cartas; cada `SHUFFLE` muda a ordem de verdade e sobe `deckVersion`/`shuffleCount` sempre sobre o baralho atual; só o dealer embaralha e só na fase certa; `FINISH_SHUFFLE` não reembaralha escondido; `CUT` gira o baralho e a distribuição consome exatamente a versão final; timeout sem mistura ainda dá baralho embaralhado; mão de onze só depois da distribuição; determinismo por seed (replay) |
| `src/features/game/__tests__/shuffleCeremony.test.ts` | quem embaralha/corta, formato do relógio, profundidades do corte |
| `src/features/game/__tests__/turnTimer.test.ts` | jogada automática por timeout (carta mais fraca — nunca a manilha —, correr do truco, entregar mão de onze, fechar embaralho/corte, nada fora da vez); prazo por fase (`TURN_TIMING`); formato do relógio |
| `src/features/game/__tests__/trickPresentation.test.ts` | a vaza fechada fica na mesa com as quatro cartas e a vencedora (qualquer assento fechando, inclusive o local), reconstrução da última vaza quando a view já é da mão seguinte, fast-forward na reconexão, segurar → recolher → vazio pelo relógio, lote repetido não reinicia |
| `src/features/game/__tests__/normalizeSeatView.test.ts` | view/meta incompletas vindas da rede não quebram a mesa |
| `src/domain/game/__tests__/engine.test.ts` (`leadingPlay`) | 1ª vence, 2ª/3ª/4ª assumem, 1ª permanece, manilhas, empate entre adversários vs. parceiros |
| `src/screens/game/__tests__/TableCeremony.test.tsx` | a tela do embaralho (título, card de tempo, contador e qualidade da mistura, ESTÁ BOM travado até a primeira mistura, EMBARALHAR NOVAMENTE travado enquanto a mistura não volta), outro jogador embaralhando (sem botões), corte com as três opções, reconexão e distribuição |
| `src/screens/online/__tests__/LobbyScreen.test.tsx` | lobby da sala com amigos |

A redação da carta virada por assento é coberta por
`src/domain/game/__tests__/covered.test.ts` e por `backend/test/integration/game.spec.ts`.

Pendente de teste manual em aparelho: o diálogo do sistema de contatos em Android e iOS
(o Jest cobre o mapeamento, não o diálogo nativo), o QR lido por um segundo aparelho e o convite de
sala entre duas contas reais (o caminho é coberto por teste, mas o push em si precisa de aparelho).

## Histórico
A última rodada E2E em aparelho documentada (12/09, APK release) foi feita ainda com o backend em
Firebase (Functions/Firestore/RTDB). O fluxo equivalente contra o backend NestJS — login → cadastro →
partida contra a IA com progressão vinda de `POST /v1/matches/ai` → sala com IA → mesa online até
12 pontos → resultado — precisa ser refeito em aparelho depois da virada (docs/production-runbook.md).

## Ainda não exercitado
- Cerimônia de embaralhar num aparelho real: o gesto, o borrão das cartas e a fluidez das animações
  do Reanimated não são observáveis sob Jest (o runtime de worklets é mockado) — os testes cobrem
  estados, textos e transições, não o movimento.
- Mesa com 2+ humanos reais e matchmaking com 4 humanos **em aparelhos** (no servidor, ambos são
  cobertos pela integração e pelo teste de carga com contas de teste).
- Reconexão real no meio de uma partida online num aparelho (o caminho é coberto no servidor pelo
  teste de IA temporária; no app o banner aparece quando o socket cai).
- Vários backends atrás do adapter Redis (a integração roda com uma instância).

## QA no emulador (mesa)

- `scripts/qa.sh launch` (com `DEV_CLIENT=1`) refaz o `adb reverse tcp:8081` — ele some sempre
  que o emulador reinicia e, sem ele, o dev client mostra "Failed to connect to localhost:8081".
  O backend local é alcançado pelo emulador em `http://10.0.2.2:3000` (padrão de desenvolvimento).
- `scripts/qa-record.sh <nome> <segundos> [x y ...]` grava a tela (`screenrecord`) enquanto toca e
  gera uma folha de contato dos quadros em `artifacts/screenshots/<nome>.png`. Atenção: o
  `screenrecord` só emite quadros quando a tela muda, então pausas longas *parecem* mais longas
  no vídeo — para medir tempo use os logs `[table]` (`adb logcat | grep table`).
- `scripts/qa-autoplay.sh` joga uma partida contra a IA no automático (toca no baralho da
  cerimônia e numa carta a cada ciclo) até o log registrar `MATCH_ENDED`.
- Logs de desenvolvimento da mesa (`src/utils/devLog.ts`, só em `__DEV__`): `PLAY_CARD`,
  `EVENTS`, `TRICK_RESOLVED`, `TURN_CHANGED`, `TIMEOUT`, `CEREMONY_STAGE`, `CEREMONY_COMPLETE`.
