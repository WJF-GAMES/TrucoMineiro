# Migração Firebase (Firestore/RTDB/Functions) → PostgreSQL

Como os dados do backend antigo (Firestore + Realtime Database + Cloud Functions) chegam ao
PostgreSQL do backend novo, sem perda e sem apagar nada no Firebase.

- Script: `backend/scripts/migrate-firebase-to-postgres.ts` (`npm --prefix backend run migrate:firebase`)
- Exportação: `backend/scripts/migration/firebase-export.ts` (API REST do Firestore, **somente leitura**)
- Importação e validação: `backend/scripts/migration/postgres-import.ts`
- Conferência de contas no Auth: `backend/scripts/migration/check-auth-accounts.ts` (somente leitura)
- Teste automatizado: `backend/test/integration/migration.spec.ts`

O **Firebase Auth não migra**: os usuários continuam no mesmo projeto e são identificados pelo
`firebaseUid` (único em `User`). Ninguém precisa entrar de novo.

## Regras de ouro

1. **Backup antes de tudo.** A exportação grava NDJSON + `manifest.json` (contagem e SHA-256 por
   arquivo). Sem backup conferido, não se importa nada.
2. **Nunca apagar no Firebase primeiro.** Firestore, RTDB e Functions ficam intactos até a
   virada estar validada. A remoção é o último passo do runbook, feita à mão.
3. **Staging antes de produção.** O importador recusa `DATABASE_URL` que contenha "prod" sem
   `--i-know-this-is-production` (dê nomes que deixem o ambiente evidente).
4. **Idempotente.** Cada documento vira uma linha em `MigrationRecord` (origem + id de origem +
   SHA-256 do conteúdo). Rodar de novo não duplica nada: o que já entrou aparece como "duplicado".
5. **Nada sensível em log.** O relatório traz contagens e ids; telefone nunca é impresso.

## Passo a passo

```bash
cd backend

# 1) Backup (somente leitura). Usa a sessão da Firebase CLI ou a credencial padrão do Google.
npm run migrate:firebase -- export --project truco-mineiro-wjf \
  --out migration-backups/<data> --use-firebase-cli-login

# 2) (opcional) Quais uids do backup ainda têm conta no Auth — só contagens e uids.
npx ts-node --transpile-only scripts/migration/check-auth-accounts.ts migration-backups/<data> --use-firebase-cli-login

# 3) Ensaio sem gravar
DATABASE_URL=<staging> npm run migrate:firebase -- import --from migration-backups/<data> --dry-run

# 4) Importação + validação (repetível)
DATABASE_URL=<staging> npm run migrate:firebase -- import   --from migration-backups/<data>
DATABASE_URL=<staging> npm run migrate:firebase -- validate --from migration-backups/<data>
```

O banco de destino precisa estar com as migrations aplicadas e o seed estrutural
(`npx prisma migrate deploy && npm run seed`). `migration-backups/` fica fora do git (contém dados
pessoais): guarde o backup em local protegido (bucket com acesso restrito) pelo prazo de retenção.

Cada execução grava `import-report-<ts>.json` e `validation-<ts>.json` na pasta do backup.

## O que migra e como

| Origem (Firestore) | Destino (PostgreSQL) | Regras |
|---|---|---|
| `users`, `profiles`, `playerStats`, `playerProgress` | `User`, `UserProfile`, `PlayerStatistics`, `LeagueProgress` | Só entra quem tem `users/{uid}`. Perfil/estatística sem `users/{uid}` é resto de conta apagada e é ignorado. Apelido é aparado para 16 caracteres e liga inválida vira `bronze` (marcado "corrigido"). |
| `userAchievements` | `UserAchievement` | Só conquistas do catálogo atual. |
| `friendships/*/friends` | `Friendship` | Par ordenado (`userAId < userBId`): as duas metades do Firestore viram uma linha (a segunda aparece como "duplicado"). |
| `friendRequests` | `FriendRequest` | Status pendente/aceita/recusada, só entre duas contas existentes. |
| `blocks/*/blocked` | `BlockedUser` | |
| `autoConnectSuppressed/*/users` | `FriendshipSuppression` | |
| `weeklyLeagueGroups` (+ `members`) | `LeagueGroup`, `LeagueMembership` | Mesmo id de grupo (`semana__liga__001`). |
| `leagueHistory/*/weeks` | `LeagueWeekResult` | |
| `processedLeagueEvents` | `LeagueScore` | Mantém as chaves de idempotência: partida já pontuada não pontua de novo. |
| `matchHistory` | `Match`, `MatchParticipant`, `MatchResult` | Partida só com contas apagadas é ignorada. Assento de conta apagada vira `AI_PERMANENT`. XP/pontos por partida não existiam no histórico antigo: são derivados da tabela de recompensas vigente e a linha sai como "corrigido". |
| `phoneIndex` | `User.phoneHash` | **Só com `--phone-pepper-matches`** (ver abaixo). |

### Não migra (transitório ou derivado)

| Origem | Motivo |
|---|---|
| `contactSync` | cota diária (janela de 24 h) — recomeça zerada |
| `blockedBy/*` | espelho derivado de `blocks` |
| `rateLimits` | janelas de rate limit |
| `leagueProcessingLocks` | travas transitórias |
| `seasons/current` | não era lido pelo app; `LeagueSeason` nasce sozinha |
| RTDB `presence`, `stats/onlineCount` | presença é efêmera e se refaz na conexão do socket |
| RTDB `matchmaking/queue` | fila efêmera |
| RTDB `rooms`, `userRooms`, `invites` | vivem minutos; a virada tem um congelamento curto |
| RTDB `gameSessions`, `userSessions` | partida em andamento não atravessa backends; as encerradas já estão em `matchHistory` |

### Diretório de telefones e `CONTACTS_PEPPER`

`phoneIndex` guarda HMAC do telefone com o pepper das Functions. O backend novo só consegue usar
esses hashes se `CONTACTS_PEPPER` for **o mesmo valor**. Se o valor antigo não estiver disponível,
importe sem `--phone-pepper-matches`: o backend reindexa o telefone de cada usuário a partir do
ID token no primeiro `POST /v1/me/bootstrap` depois da virada. Até lá, a "conexão automática pela
agenda" só encontra quem já abriu o app novo.

Em produção, o pepper das Functions não estava no ambiente local e o `phoneIndex` exportado veio
vazio (0 documentos) — a reindexação no login cobre o caso.

## Validação

`validate` compara origem × destino por entidade: usuários, pares de amizade, solicitações,
bloqueios, supressões, progresso de liga, grupos, vínculos, histórico de liga, histórico de
partidas (com dono ativo) e desbloqueios de conquistas. Qualquer divergência sai com código 1.

## Ensaio real (17/09/2026)

Backup de produção (`truco-mineiro-wjf`, exportado em 2026-09-17T14:46Z, 98 documentos, manifest
com SHA-256) importado em schema de ensaio no PostgreSQL 17 local, duas vezes:

| Entidade | Lidos | 1ª execução | 2ª execução | Observação |
|---|---:|---:|---:|---|
| users | 9 | 4 migrados, 5 ignorados | 4 duplicados | os 5 ignorados não têm `users/{uid}` nem conta no Auth (conferido) |
| userAchievements | 3 | 3 | 0 novos | 2 desbloqueios do catálogo atual |
| friendships | 2 | 1 (+1 duplicado) | 0 novos | 1 par |
| friendRequests | 5 | 2 (3 ignorados) | 0 novos | |
| leagueGroups / memberships / progress | 1 / 3 / 3 | 1 / 3 / 3 | 0 novos | |
| leagueScores | 9 | 9 | 0 novos | |
| matchHistory | 40 | 18 (22 ignorados) | 0 novos | 22 só com contas apagadas |

Validação: 11/11 entidades OK nas duas execuções. O mesmo ensaio passou no servidor Docker
antigo e no PostgreSQL local compartilhado (depois da migration `timestamptz`).

## Virada (resumo — detalhes em `docs/production-runbook.md`)

A importação **sobrescreve** perfil e estatísticas quando o documento de origem mudou. Por isso o
app novo só começa a gravar no backend **depois** da importação final; senão, progresso feito no
backend novo seria substituído pelo valor antigo do Firestore.

1. Staging: importar, validar, jogar com contas de teste, rodar smoke e carga.
2. Produção: publicar o backend (migrations + seed), importar um backup recente e validar
   (ensaio no próprio banco de produção; pode ser repetido).
3. Deixar a versão nova do app aprovada nas lojas, com publicação manual.
4. Janela de virada: backup final → bloquear Firestore/RTDB (`--lockdown-firebase-rules`) →
   importação final (idempotente, só aplica o que mudou) → validação → publicar o app novo.
   A partir do bloqueio, o app antigo não consegue mais jogar online (ele não tem tela de
   "atualize o app"); a janela deve ser curta e comunicada.
5. Observar. Só depois de validado: desligar as Cloud Functions e, bem depois, arquivar/apagar os
   dados antigos (com backup guardado).

Rollback: enquanto os dados do Firebase não forem apagados, voltar é republicar as regras e as
Functions anteriores a partir de `.migration-backup/firebase-legacy-*.tar.gz` e despublicar o app
novo. O que foi jogado no backend novo depois da virada não volta para o Firestore.
