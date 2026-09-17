# Runbook de produção — backend do Truco Mineiro

Guia operacional: virada do Firebase para o backend próprio, deploy do dia a dia, monitoramento,
incidentes e rollback. Infra e parâmetros em `docs/deployment.md`; dados em `docs/migration.md`.

## 1. Pré-virada (checklist)

- [ ] Staging publicado com `./scripts/deploy.sh` e smoke verde.
- [ ] Cloud Scheduler de staging chamando os jobs (`docs/webhooks.md`), `league.weekly-rollover`
      testado com `POST /v1/admin/jobs/league.weekly-rollover`.
- [ ] Ensaio de migração em staging com backup recente: `import` + `validate` OK e segunda execução
      sem novos registros.
- [ ] App de staging (EAS env `staging`) testado em aparelho real: cadastro novo, conta migrada,
      partida com 4 pessoas, queda de rede, app morto no meio da partida, reinício do backend, push.
- [ ] Carga em staging (ver seção 6) dentro do gate.
- [ ] Produção: Cloud SQL com backup automático + PITR, Memorystore, segredos criados
      (`contacts-pepper` definitivo), service account com os papéis de `docs/deployment.md`.
- [ ] `ENFORCE_APP_CHECK=true` só depois de confirmar que o app de produção envia o token.
- [ ] Versão nova do app aprovada nas lojas com **publicação manual**.
- [ ] Janela de virada comunicada (o app antigo para de jogar online no bloqueio).

## 2. Virada

| # | Passo | Comando / verificação | Se falhar |
|---|---|---|---|
| 1 | Publicar backend de produção | `ENVIRONMENT=production ./scripts/deploy.sh --confirm-production` | corrigir e repetir; nada foi exposto ainda |
| 2 | Ensaio no banco de produção | `export` novo → `import` → `validate` (flag `--i-know-this-is-production`) | investigar o relatório; repetir |
| 3 | **Backup final** do Firestore | `npm run migrate:firebase -- export --out migration-backups/<data>-final` + conferir `manifest.json` | não seguir sem backup |
| 4 | Bloquear escrita do app antigo | `ENVIRONMENT=production ./scripts/deploy.sh --confirm-production --lockdown-firebase-rules` | voltar regras (seção 5) |
| 5 | Exportar de novo (estado congelado) | `export --out migration-backups/<data>-frozen` | — |
| 6 | Importação final | `import --from …-frozen` e `validate` | rollback (seção 5) |
| 7 | Smoke autenticado | `SMOKE_ID_TOKEN=<conta de teste> npm --prefix backend run smoke -- --url <api>` | rollback |
| 8 | Publicar o app novo | liberar nas lojas (rollout gradual) | pausar rollout |
| 9 | Observar 24–72 h | seção 4 | seção 5 |
| 10 | Desligar as Cloud Functions | `firebase functions:delete <nomes> --project truco-mineiro-wjf` (lista no backup `firebase-legacy-*.tar.gz`) | republicar do backup |
| 11 | Arquivar dados antigos | só após o período de retenção, com backup guardado; **nunca antes do passo 10** | — |

Enquanto os passos 10 e 11 não forem feitos, o caminho de volta continua aberto.

## 3. Deploy do dia a dia

1. PR com CI verde (`.github/workflows/ci.yml`: app, backend com PostgreSQL real, imagem Docker).
2. `ENVIRONMENT=staging ./scripts/deploy.sh` → smoke → teste rápido no app de staging.
3. `ENVIRONMENT=production ./scripts/deploy.sh --confirm-production` (árvore limpa).
4. Migrations: sempre compatíveis com a revisão anterior (a revisão velha continua servindo até o
   tráfego virar). Remoção de coluna em duas entregas.
5. Mudou `src/domain`? Rode `npm --prefix backend run sync-domain` e versione a cópia; o CI barra
   se esquecer. Regra nova de jogo precisa sair no app e no backend juntos.

## 4. Monitoramento

| Sinal | Onde | Alerta sugerido |
|---|---|---|
| Disponibilidade | uptime check em `/health/ready` | 2 falhas seguidas |
| Erros 5xx | Cloud Run (métrica de requisições) / logs `severity>=ERROR` | > 1% por 5 min |
| Latência | Cloud Run p95 | > 500 ms por 10 min |
| Conexões de banco | Cloud SQL `num_backends` | > 80% do limite |
| Consultas lentas | `/metrics` `db_slow_queries_total`, logs `slow_query` (fora de produção) | tendência |
| Sockets | `/metrics` `ws_connected_sockets` | queda brusca (instâncias reiniciando) |
| Jobs | logs `job_done` / `job_failed`, tabela `JobLock` | `job_failed`; virada semanal sem `job_done` até 01:00 de segunda |
| Push | logs do contexto `push` (`fcm_send_failed`, `notify_failed`) | taxa de falha alta (token/credencial) |
| Webhooks | tabela `WebhookEvent` com erro | qualquer erro repetido |

`/metrics` exige `x-admin-secret`. Diagnóstico rápido: `POST /v1/admin/diagnostics` (mesmo segredo).

## 5. Incidentes

**Backend fora / 5xx em massa**
1. `gcloud run services describe` → revisão atual; logs por `requestId`.
2. Banco? `/health/ready` 503 → Cloud SQL (CPU, conexões, manutenção). O backend responde
   `503 SERVICE_UNAVAILABLE` e o app tenta de novo; nada se perde.
3. Deploy recente? `gcloud run services update-traffic truco-backend-production --to-revisions <anterior>=100`.

**Partidas travadas**
- Timers vivem em `Match.nextTickAt`; qualquer instância assume. Conferir se há instância viva e
  se `nextTickAt` está no passado há muito tempo (`SELECT id, "nextTickAt" FROM "Match" WHERE status='PLAYING' ORDER BY "nextTickAt" LIMIT 20`).
- Jogador sem controle da mesa: `POST /v1/matches/:id/rejoin` (o app faz isso sozinho ao voltar).

**Liga da semana não virou**
- `POST /v1/admin/jobs/league.weekly-rollover` (idempotente) e depois `POST /v1/admin/leagues/repair`.

**Push não chega**
- Logs `fcm_send_failed` / `notify_failed`; papel de FCM da service account; `PUSH_ENABLED=true`. Push nunca derruba nem
  atrasa a operação que o disparou: a notificação é gravada e vai pelo WebSocket na hora; o FCM
  roda em segundo plano e o resultado fica em `Notification.pushStatus` (`PENDING` → `SENT`/`FAILED`).

**Redis fora**
- Em execução (testado): REST, readiness e sockets continuam; só os eventos **entre instâncias**
  se perdem (ex.: jogador na instância A não vê em tempo real quem entrou na sala pela instância
  B). O cliente reconecta sozinho quando o Redis volta, sem reiniciar nada; logs `redis_error`.
  Mitigação durante a queda: `--max-instances 1` (com afinidade de sessão).
- No boot: com `REDIS_URL` definido e Redis inacessível, a instância falha em
  `REDIS_BOOT_TIMEOUT_MS` (padrão 10 s) com `boot_failed` — a revisão nova não recebe tráfego.

**Rollback da virada** (antes do passo 10)
1. Pausar o rollout do app novo.
2. Extrair `.migration-backup/firebase-legacy-*.tar.gz` num diretório temporário e publicar as
   regras e Functions antigas de lá (`firebase deploy --only firestore:rules,database,functions`).
3. Comunicar. Partidas/pontos feitos no backend novo depois da virada não voltam para o Firestore.

## 6. Capacidade (medido em 17/09/2026, 1 instância, PostgreSQL local)

Gerador: `backend/scripts/load-test.ts` (usuários virtuais fazendo bootstrap/amigos/liga/histórico a
cada 0,8–2 s, parte deles jogando partidas pelo WebSocket). Ver os relatórios em `backend/reports/`
(fora do git) e o resumo no relatório final da migração.

- 100 usuários: 0 erros; leituras p50 4–15 ms, p95 ≤ 65 ms; ações de jogo p95 ≈ 100 ms.
- 500 usuários: 0 erros de servidor (5 × 429 esperados do limite do bootstrap); bootstrap p50 48 ms /
  p95 340 ms; ações de jogo p95 ≈ 520 ms; ~150 req/s; RSS 470 MB; ≤ 18 conexões de banco.
- 1000 usuários numa única instância: satura (latências na casa de 1 s). Produção deve escalar
  horizontalmente (Redis + várias instâncias) bem antes disso — gate operacional: ~500 usuários
  ativos por instância.

Cadastro em rajada (50 simultâneos) fica serializado por liga (fila no processo + advisory lock):
p50 de 1,4 s com 100 usuários. Não é o padrão real de tráfego, mas é o ponto mais lento.
