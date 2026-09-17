# Webhooks e jobs

Jobs de manutenção do backend (substituem as Cloud Functions agendadas) e o endpoint que os recebe
de fora. Código: `backend/src/webhooks/`, `backend/src/jobs/`, `backend/src/config/env.ts`.
REST geral em [api.md](api.md); tabelas em [database.md](database.md).

O Firebase Auth não tem webhook: a autenticação é sempre pelo ID Token. Hoje o único provedor é o
**Cloud Scheduler** (`scheduler`).

## Endpoint

```
POST /webhooks/:provider        (sem prefixo /v1, sem Bearer do Firebase)
```

| Item | Valor |
|---|---|
| `:provider` | `^[a-z][a-z0-9-]{1,39}$`; só `scheduler` existe (outro: `WEBHOOK_UNKNOWN_PROVIDER`, 404) |
| Corpo | JSON `{ "job": "<nome>", "payload": { … } }` (`payload` opcional) |
| Resposta | **202** `{ "data": { "accepted": true, "duplicate": false, "eventId": "<uuid>" } }` |
| Limite | 120 requisições/min (throttler; rastreia pelo hash do `Authorization` quando há, senão pelo IP) |

Fluxo (`WebhooksService.receive`):

1. Autenticação por HMAC (se houver `x-webhook-signature`) ou por OIDC (caso contrário), com o
   carimbo de tempo dentro da janela (`WEBHOOK_TIMESTAMP_INVALID`, 401): ±5 min no HMAC, ±60 min
   no OIDC.
2. Só depois de autenticado o corpo é lido: `job` precisa ser um dos nomes de `JOB_NAMES` (senão
   `VALIDATION_FAILED`, 400).
3. Grava `WebhookEvent` (`status = PROCESSING`) com único (`provider`, `externalEventId`).
   - Já existe e o status não é `FAILED`: responde `duplicate: true` sem processar (só incrementa
     `attemptCount`).
   - Já existe com `FAILED`, ou em `PROCESSING` há mais de 15 min (`lastAttemptAt`; a instância
     morreu no meio): volta para `PROCESSING` e processa de novo. Só um retry concorrente assume.
4. Responde 202 na hora. O job roda em segundo plano; o resultado fica em `WebhookEvent.status`
   (`PROCESSED` com `processedAt`, ou `FAILED` com `error`, até 500 caracteres).

Métrica: `webhooks_total{provider, status=accepted|duplicate|rejected}`.

## Autenticação HMAC

| Header | Conteúdo |
|---|---|
| `x-webhook-signature` | `v1=<hex minúsculo de HMAC-SHA256(WEBHOOK_SCHEDULER_SECRET, "<timestamp>.<id>.<corpo cru>")>` |
| `x-webhook-timestamp` | epoch em **milissegundos** (inteiro), ±5 min |
| `x-webhook-id` | id único do evento (até 200 caracteres), chave de idempotência |

- O corpo assinado é o corpo cru (`rawBody`), byte a byte como foi enviado. Envie
  `content-type: application/json`.
- Sem `WEBHOOK_SCHEDULER_SECRET` configurado, toda requisição assinada é recusada
  (`WEBHOOK_SIGNATURE_INVALID`).
- Assinatura diferente ou sem `x-webhook-id`: `WEBHOOK_SIGNATURE_INVALID` (401, comparação em
  tempo constante).
- Use um `x-webhook-id` novo a cada execução: repetir o id faz o evento ser tratado como duplicado.
- O `x-webhook-id` entra na assinatura: reenviar uma requisição capturada com outro id invalida a
  assinatura, e com o mesmo id ela vira duplicada. Mesmo assim, mantenha o tráfego sob TLS.
- Em staging/produção o segredo precisa ter pelo menos 32 caracteres.
- Helper no código: `signWebhook(secret, timestamp, eventId, rawBody)` em `webhooks.service.ts`.

### Exemplo com openssl e curl

```bash
BASE="https://<servico>"
BODY='{"job":"rooms.sweep"}'
TS=$(( $(date +%s) * 1000 ))
ID="rooms.sweep-$TS"
SIG=$(printf '%s.%s.%s' "$TS" "$ID" "$BODY" | openssl dgst -sha256 -hmac "$WEBHOOK_SCHEDULER_SECRET" | sed 's/^.*= //')

curl -sS -X POST "$BASE/webhooks/scheduler" \
  -H 'content-type: application/json' \
  -H "x-webhook-signature: v1=$SIG" \
  -H "x-webhook-timestamp: $TS" \
  -H "x-webhook-id: $ID" \
  --data-raw "$BODY"
```

### Exemplo em Node (>= 22)

```js
import { createHmac, randomUUID } from 'node:crypto';

const base = 'https://<servico>';
const secret = process.env.WEBHOOK_SCHEDULER_SECRET;
const body = JSON.stringify({ job: 'league.refresh-rankings' });
const ts = Date.now();
const id = randomUUID();
const signature = 'v1=' + createHmac('sha256', secret).update(`${ts}.${id}.${body}`).digest('hex');

const res = await fetch(`${base}/webhooks/scheduler`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-webhook-signature': signature,
    'x-webhook-timestamp': String(ts),
    'x-webhook-id': id,
  },
  body, // a mesma string que foi assinada
});
console.log(res.status, await res.json()); // 202 { data: { accepted, duplicate, eventId } }
```

## Autenticação OIDC (Cloud Scheduler → Cloud Run)

Sem `x-webhook-signature`, o backend exige um token OIDC assinado pelo Google:

| Variável | Uso |
|---|---|
| `WEBHOOK_SCHEDULER_OIDC_AUDIENCE` | `audience` esperado no token (ex.: URL do serviço) |
| `WEBHOOK_SCHEDULER_SERVICE_ACCOUNT` | e-mail da service account do Scheduler; o token precisa ter `email` igual e `email_verified = true` |

- Header `Authorization: Bearer <token OIDC>` (verificado com `google-auth-library`).
- Falta a variável ou o header, ou o token é inválido: `WEBHOOK_SIGNATURE_INVALID`.
- O carimbo vem de `X-CloudScheduler-ScheduleTime`. As novas tentativas do Cloud Scheduler
  repetem o horário agendado, por isso a janela é de ±60 min (o token do Google já é assinado, tem
  audiência fixa e validade curta). O id do evento é `<X-CloudScheduler-JobName ou job>@<ScheduleTime>`:
  uma execução agendada é processada uma vez só.
- As duas variáveis vão juntas (o boot falha com só uma). Com `NODE_ENV` `staging`/`production` e
  `JOBS_MODE=external`, o boot exige `WEBHOOK_SCHEDULER_SECRET` **ou** o OIDC configurado.

## Jobs

`JOB_NAMES` e agenda em `jobs.service.ts` (fuso `America/Sao_Paulo`). Cada execução pega a trava
`JobLock` `job:<nome>` com validade `lockMs`. Se outra instância já tem a trava, a execução é pulada
(resultado `{ skipped: true }`, métrica `jobs_total{status="skipped"}`). Todos os jobs são
idempotentes.

| Job | Cron | Trava | O que faz |
|---|---|---|---|
| `league.weekly-rollover` | `5 0 * * 1` (segunda 00:05) | 30 min | Fecha a semana anterior (promoção/rebaixamento, `LeagueWeekResult`) e prepara os grupos da nova; trava extra `league-finalize:<semana>`. `payload.atMs` (número) força o instante de referência |
| `league.refresh-rankings` | `0 3 * * *` | 20 min | Recalcula as posições gravadas dos grupos ativos |
| `league.repair` | `30 4 * * *` | 20 min | Corrige contagens, grupos vazios, liga inválida e vínculos quebrados |
| `rooms.sweep` | `*/5 * * * *` | 4 min | Fecha lobby parado há mais de 10 min (`EXPIRED`) e apaga sala fechada há mais de 1 h |
| `matchmaking.cleanup` | `* * * * *` | 50 s | Apaga tickets encerrados há mais de 60 s |
| `maintenance.prune` | `17 * * * *` | 10 min | Apaga `IdempotencyKey` vencida, `RateLimitBucket` com mais de 2 dias, `Notification` com mais de 90 dias, `WebhookEvent` com mais de 30 dias e `JobLock` vencido há mais de 1 dia |
| `accounts.reconcile` | `0 4 * * *` | 50 min | Remove dados de contas apagadas direto no Firebase Auth (substitui `onAuthUserDeleted`) |
| `presence.reap` | `*/2 * * * *` | 100 s | Põe offline a presença de instâncias sem heartbeat há mais de 95 s |

Execução manual: `POST /v1/admin/jobs/<nome>` com `x-admin-secret` (mesma trava; responde o
resultado do job de forma síncrona).

Fora dos jobs, cada instância sempre roda: o agendador das partidas (IA, prazos, lobbies vencidos e
formação de mesa, a cada `SCHEDULER_POLL_MS`) e o heartbeat de presença (30 s). Eles não dependem
de `JOBS_MODE`.

## `JOBS_MODE`

| Valor | Comportamento | Uso |
|---|---|---|
| `cron` (padrão) | a instância registra os 8 `CronJob` no boot (nunca com `NODE_ENV=test`) | desenvolvimento, instância única. Com várias instâncias todas disparam e o `JobLock` deixa uma só executar |
| `external` | nenhum cron local; os jobs chegam por `POST /webhooks/scheduler` | Cloud Run com Cloud Scheduler |
| `off` | nenhum job | testes, carga |

Valor diferente derruba o boot (`JOBS_MODE inválido`). `JOBS_MODE` só controla o cron local: o
webhook e `POST /v1/admin/jobs/:job` executam jobs em qualquer modo.

## Cloud Scheduler

Um job do Scheduler por job do backend, com a mesma agenda e o fuso `America/Sao_Paulo`. Exemplo
com OIDC (valores entre `<>` são placeholders):

```bash
SERVICE_URL="https://<servico>.run.app"
SA="<scheduler-sa>@<projeto>.iam.gserviceaccount.com"

gcloud scheduler jobs create http truco-league-weekly-rollover \
  --project=<projeto> --location=<regiao> \
  --schedule="5 0 * * 1" --time-zone="America/Sao_Paulo" \
  --uri="$SERVICE_URL/webhooks/scheduler" --http-method=POST \
  --headers="Content-Type=application/json" \
  --message-body='{"job":"league.weekly-rollover"}' \
  --oidc-service-account-email="$SA" \
  --oidc-token-audience="$SERVICE_URL" \
  --attempt-deadline=60s --max-retry-attempts=3 --max-retry-duration=240s

gcloud scheduler jobs create http truco-rooms-sweep \
  --project=<projeto> --location=<regiao> \
  --schedule="*/5 * * * *" --time-zone="America/Sao_Paulo" \
  --uri="$SERVICE_URL/webhooks/scheduler" --http-method=POST \
  --headers="Content-Type=application/json" \
  --message-body='{"job":"rooms.sweep"}' \
  --oidc-service-account-email="$SA" \
  --oidc-token-audience="$SERVICE_URL"
```

Repita para os demais jobs da tabela, trocando nome, `--schedule` e `job`. No serviço:

```
JOBS_MODE=external
WEBHOOK_SCHEDULER_OIDC_AUDIENCE=https://<servico>.run.app   # igual ao --oidc-token-audience
WEBHOOK_SCHEDULER_SERVICE_ACCOUNT=<scheduler-sa>@<projeto>.iam.gserviceaccount.com
WEBHOOK_SCHEDULER_SECRET=<segredo de 32+ caracteres>          # obrigatório com JOBS_MODE=external em staging/produção
```

Observações:

- O 202 só confirma o recebimento. Para saber se o job terminou, consulte `WebhookEvent`
  (`status`, `error`) ou os logs `job_done` / `job_failed`.
- `accounts.reconcile` e `league.weekly-rollover` podem passar de alguns minutos; como o
  processamento é assíncrono, o `--attempt-deadline` curto não os interrompe.
- Se o serviço do Cloud Run exigir IAM na invocação, a service account também precisa de
  `roles/run.invoker`.
