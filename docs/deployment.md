# Deploy — backend (Cloud Run) e app

## Ambientes

| | dev (local) | staging | production |
|---|---|---|---|
| Backend | `npm run backend:dev` (porta 3000) | Cloud Run `truco-backend-staging` | Cloud Run `truco-backend-production` |
| Banco | PostgreSQL 17 local compartilhado (`127.0.0.1:5432`, banco `truco_mineiro_db`) | Cloud SQL próprio | Cloud SQL próprio (backups automáticos + PITR) |
| Auth | Auth Emulator (`FIREBASE_AUTH_EMULATOR_HOST`) ou `AUTH_MODE=test` | Firebase Auth real | Firebase Auth real |
| Jobs | `JOBS_MODE=cron` | `JOBS_MODE=external` (Cloud Scheduler) | `JOBS_MODE=external` |
| Várias instâncias | não | Redis (Memorystore) | Redis (Memorystore) |
| App | `EXPO_PUBLIC_API_URL` vazio (10.0.2.2 / localhost) | EAS env `staging` | EAS env `production` |

Cada ambiente tem **banco e segredos próprios**. Staging nunca aponta para o banco de produção.

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

## Infra no Google Cloud (uma vez por ambiente)

1. **Artifact Registry**: repositório Docker `truco` em `southamerica-east1`.
2. **Cloud SQL** PostgreSQL 17: instância, banco `truco`, usuário da aplicação sem superusuário.
   Ative backups automáticos e point-in-time recovery em produção. Conexões: a soma de
   `connection_limit` (na `DATABASE_URL`) × instâncias máximas precisa caber no limite do banco
   (ex.: 10 × 10 instâncias = 100).
3. **Memorystore (Redis)** + **conector VPC** (Socket.IO entre instâncias).
4. **Secret Manager** (`truco-<ambiente>-…`):
   - `database-url` — `postgresql://<usuario>:<senha>@localhost/truco?host=/cloudsql/<instância>&connection_limit=10`
   - `contacts-pepper` — ≥ 32 caracteres, **nunca muda** depois de gerado (invalida os hashes)
   - `admin-secret` — ≥ 32 caracteres
   - `webhook-secret` — ≥ 32 caracteres
5. **Service account** `truco-backend@<projeto>`: Cloud SQL Client, Secret Manager Secret Accessor,
   Firebase Authentication Admin (verificar token, listar/apagar usuário), Firebase Cloud Messaging
   API Admin, Firebase App Check (verificação de token). Nenhuma chave JSON: o Cloud Run usa a
   identidade do serviço.
6. **Cloud Scheduler** chamando `POST <url>/webhooks/scheduler` com OIDC — comandos em
   `docs/webhooks.md`.

## Deploy

```bash
export SQL_INSTANCE=<projeto>:southamerica-east1:<instância>
export VPC_CONNECTOR=<conector>
export REDIS_URL=redis://<ip-memorystore>:6379
ENVIRONMENT=staging ./scripts/deploy.sh
ENVIRONMENT=production ./scripts/deploy.sh --confirm-production
```

O script: `npm --prefix backend run check` → build/push das duas imagens (tag = commit; produção
recusa árvore suja) → Cloud Run Job de migração (`--wait`) → deploy do serviço → smoke test →
Remote Config (só em produção: staging usa o mesmo projeto Firebase do app, então o deploy de
staging nunca publica Remote Config nem regras). `--lockdown-firebase-rules` (só produção) publica
as regras deny-all de Firestore/RTDB — **só na virada** (`docs/production-runbook.md`).

Parâmetros do serviço: porta 8080, `--timeout 3600` (WebSocket), `--session-affinity`,
`--concurrency 250`, 1 vCPU / 1 GiB, mínimo de 1 instância em produção (sockets e timers de partida
não gostam de cold start), `--allow-unauthenticated` (a autenticação é o ID token do Firebase).

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
migration precisar ser desfeita, restaure pelo PITR do Cloud SQL
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
