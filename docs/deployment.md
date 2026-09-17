# Deploy — backend (Cloud Run) e app

## Ambientes

| | dev (local) | produção |
|---|---|---|
| Backend | `npm run backend:dev` (porta 3000) | Cloud Run `api-truco-mineiro`, projeto `wjf-games`, região `us-east1` |
| URL | http://localhost:3000 | https://truco-api.wjfdeveloper.com.br |
| Banco | PostgreSQL 17 local compartilhado (`127.0.0.1:5432`, `truco_mineiro_db`) | PostgreSQL 17 **fora do GCP** (VPS em `db.wjfdeveloper.com.br:32768`, banco `truco_mineiro_db`) |
| Auth | Auth Emulator ou `AUTH_MODE=test` | Firebase Auth do projeto `truco-mineiro-wjf` |
| Jobs | `JOBS_MODE=cron` | `JOBS_MODE=cron` + Cloud Scheduler (OIDC) para o que precisa rodar com o jogo vazio |
| Várias instâncias | não | não (máximo 1 instância; mais que isso exige Redis) |
| App | `EXPO_PUBLIC_API_URL` vazio (10.0.2.2 / localhost) | `EXPO_PUBLIC_API_URL` no `eas.json` (perfis `preview` e `production`) |

Não existe ambiente de staging no GCP: o `preview` do EAS aponta para a mesma API de produção.
Ao criar um staging, ele precisa de **banco e segredos próprios** e nunca deve apontar para o banco
de produção.

### Por que us-east1
O banco está num VPS nos EUA (região de Boston). Uma requisição do backend faz várias consultas em
sequência, então a distância **backend ↔ banco** pesa muito mais que **jogador ↔ backend**: em
`us-east1` cada consulta leva ~20-30 ms, contra ~130 ms se o backend estivesse em São Paulo (a
mesma tela levaria segundos). O jogador brasileiro paga ~120 ms por ação, uma vez.
Se um dia o banco mudar para o Brasil, mover o serviço para `southamerica-east1` junto.

## Garantias do boot (`backend/src/config/env.ts`)

Em `NODE_ENV=staging|production` o processo **não sobe** se:
- faltar `DATABASE_URL` ou `FIREBASE_PROJECT_ID`;
- `CONTACTS_PEPPER` ou `ADMIN_SECRET` tiverem menos de 32 caracteres;
- `AUTH_MODE=test` ou `FIREBASE_AUTH_EMULATOR_HOST` estiverem definidos;
- `WEBHOOK_SCHEDULER_SECRET` definido com menos de 32 caracteres;
- `JOBS_MODE=external` sem `WEBHOOK_SCHEDULER_SECRET` e sem OIDC (`WEBHOOK_SCHEDULER_OIDC_AUDIENCE` +
  `WEBHOOK_SCHEDULER_SERVICE_ACCOUNT`, que vão juntas).

O CI confere que `NODE_ENV=production` sem segredos falha no boot.

## Imagem

`backend/Dockerfile` (multi-stage, Node 22, usuário sem privilégio, `tini`, `HEALTHCHECK`):

| Target | Uso |
|---|---|
| `runtime` | serviço (`node dist/main.js`, porta 8080) |
| `migrate` | Cloud Run Job: `prisma migrate deploy` + seed estrutural (20 ligas, 7 conquistas) |

O contexto é a pasta `backend/`; a cópia do domínio (`backend/src/domain`) é versionada e o CI
confere que está igual a `src/domain`.

```bash
node backend/scripts/sync-domain.js
docker build backend --target runtime -t truco-backend
docker build backend --target migrate -t truco-backend-migrate
```

## Infra de produção (já criada)

| Recurso | Valor |
|---|---|
| Projeto | `wjf-games` (número 636596425561) |
| Região | `us-east1` |
| Serviço | `api-truco-mineiro` (público; a autenticação é o ID Token do Firebase) |
| Imagens | Artifact Registry `us-east1-docker.pkg.dev/wjf-games/truco` |
| Conta de serviço (runtime) | `truco-backend@wjf-games.iam.gserviceaccount.com` |
| Conta de serviço (jobs) | `truco-scheduler@wjf-games.iam.gserviceaccount.com` |
| Segredos | `truco-prod-database-url`, `truco-prod-contacts-pepper`, `truco-prod-admin-secret` |
| Banco | VPS próprio (não é Cloud SQL): sem Cloud SQL, sem conector VPC, sem Redis |

Variáveis do serviço: `NODE_ENV=production`, `FIREBASE_PROJECT_ID=truco-mineiro-wjf`,
`AUTH_MODE=firebase`, `JOBS_MODE=cron`, `PUSH_ENABLED=false`, `ENFORCE_APP_CHECK=false`,
`LOG_LEVEL=info`, `SWAGGER_ENABLED=false`, `WEBHOOK_SCHEDULER_OIDC_AUDIENCE` (URL do serviço) e
`WEBHOOK_SCHEDULER_SERVICE_ACCOUNT`.

### Configuração escolhida (custo baixo sem perder qualidade)

| Ajuste | Valor | Por quê |
|---|---|---|
| Faturamento | por requisição | só paga enquanto atende; com o jogo vazio o custo vai a ~zero |
| Instâncias | mínimo 0, máximo 1 | sem Redis, uma instância só mantém salas, presença e partidas coerentes; 0 no mínimo evita pagar o jogo parado |
| Concorrência | 200 por instância | cabe bem acima do público atual; a carga medida foi ~500 jogadores por instância |
| CPU / memória | 1 vCPU / 1 GiB | 512 MiB arrisca ficar sem memória com muitos sockets (derrubaria todo mundo) |
| Startup CPU boost | ligado | cold start medido em ~0,5 s (sem custo extra) |
| Tempo limite | 3600 s | WebSocket precisa de conexão longa |
| Afinidade de sessão | ligada | mantém o socket na mesma instância |

Enquanto o máximo for 1 instância, **não** ligue Redis: ele só é necessário a partir da segunda.
Para crescer: subir `--max-instances`, criar o Redis (Memorystore) e preencher `REDIS_URL`.

### Jobs (Cloud Scheduler)

O serviço roda os jobs frequentes sozinho (`JOBS_MODE=cron`) enquanto existe instância viva — que é
justamente quando há gente jogando. O que precisa acontecer mesmo com o jogo vazio fica no Cloud
Scheduler, chamando `POST /webhooks/scheduler` com token OIDC (sem segredo para girar):

| Job | Quando (America/Sao_Paulo) |
|---|---|
| `truco-league-rollover` → `league.weekly-rollover` | segunda, 00:05 |
| `truco-league-rankings` → `league.refresh-rankings` | a cada 6 h |
| `truco-maintenance-prune` → `maintenance.prune` | 04:30 |
| `truco-accounts-reconcile` → `accounts.reconcile` | 04:45 |

### Entrega contínua

`cloudbuild.yaml` (raiz): constrói a imagem do backend, aplica migrations e seed, e publica a
revisão. O gatilho do Cloud Build observa a `main` e só dispara quando o commit toca `backend/`
(mudança só de app não gera deploy). Deploy manual quando precisar: `./scripts/deploy.sh`.

### Desligamento e várias instâncias

- `SIGTERM` → `/health/ready` passa a 503 → drena (`SHUTDOWN_DRAIN_MS`) → fecha sockets, jobs e
  Prisma. Os clientes reconectam em outra instância e ressincronizam pela versão.
- Timers de partida ficam no banco (`Match.nextTickAt`) e qualquer instância assume
  (`FOR UPDATE SKIP LOCKED`), então uma instância que morre não trava a mesa.
- Jobs usam `JobLock`: dois disparos simultâneos executam uma vez só.

### Saúde e métricas

| Rota | Uso |
|---|---|
| `GET /health` | liveness (processo de pé) |
| `GET /health/ready` | readiness (banco acessível e não está desligando) |
| `GET /metrics` | Prometheus; exige `x-admin-secret` |

Logs são JSON no formato do Cloud Logging (`severity`, `requestId`, sem token/telefone/cartas).

### Rollback do backend

`gcloud run services update-traffic truco-backend-<ambiente> --to-revisions <revisão-anterior>=100`.
Migrations precisam ser compatíveis com a revisão anterior (expandir → migrar → contrair); se uma
migration precisar ser desfeita, restaure pelo backup do banco (VPS)
(nunca `prisma migrate reset` fora do dev).

## App (EAS)

- `EXPO_PUBLIC_API_URL` (e opcionalmente `EXPO_PUBLIC_WS_URL`) por ambiente nas variáveis do EAS.
- `app.config.js` recusa build de staging/produção sem URL HTTPS, com URL local, com URL de staging
  em produção ou com `EXPO_PUBLIC_ALLOW_INSECURE_API`.
- Android local: `./scripts/build-apk.sh` (ver `CLAUDE.md`). A pasta `android/` é mantida à mão
  (assinatura de release) — nunca `expo prebuild --clean`.

## Dev local

```bash
cp backend/.env.example backend/.env        # preencher credenciais do PostgreSQL local
npm --prefix backend ci
npm --prefix backend run prisma:migrate && npm --prefix backend run seed
npm run emulators                            # Auth Emulator
npm run backend:dev                          # http://localhost:3000, Swagger em /docs
EXPO_PUBLIC_USE_EMULATORS=1 npm start
```

Testes de integração: `backend/.env.test` com `TEST_DATABASE_URL` apontando para um **schema
dedicado** (`?schema=integration_test`) — os testes fazem TRUNCATE.
