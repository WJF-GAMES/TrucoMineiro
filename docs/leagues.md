# Sistema de Ligas

Competição semanal no estilo Duolingo, adaptada ao Truco Mineiro: o jogador compete durante a
semana num **grupo** da sua **liga**; no fim da semana os primeiros sobem, o meio permanece e os
últimos descem.

> **Regra absoluta:** nenhum usuário ativo pode ficar sem liga. Toda leitura da tela passa por
> `ensureAssignment`, que detecta e conserta o vínculo antes de responder — nunca existe o estado
> "você ainda não está em uma liga".

## Liga x grupo

- **Liga** é o nível competitivo (Bronze … Lenda de Minas). São 20, em ordem fixa.
- **Grupo** é o conjunto de jogadores daquela liga competindo naquela semana
  (`Liga Ouro` pode ter `Ouro 001`, `Ouro 002`, …). A UI chama o índice do grupo de **Divisão**
  (`Divisão I`, `Divisão II`).

## A escada

| # | id | Nome | # | id | Nome |
|---|----|------|---|----|------|
| 1 | `bronze` | Bronze | 11 | `sapphire` | Safira |
| 2 | `silver` | Prata | 12 | `ruby` | Rubi |
| 3 | `gold` | Ouro | 13 | `opal` | Opala |
| 4 | `platinum` | Platina | 14 | `onyx` | Ônix |
| 5 | `quartz` | Quartzo | 15 | `obsidian` | Obsidiana |
| 6 | `topaz` | Topázio | 16 | `diamond` | Diamante |
| 7 | `amethyst` | Ametista | 17 | `black_diamond` | Diamante Negro |
| 8 | `aquamarine` | Água-marinha | 18 | `imperial` | Imperial |
| 9 | `tourmaline` | Turmalina | 19 | `legendary` | Lendária |
| 10 | `emerald` | Esmeralda | 20 | `legend_of_minas` | Lenda de Minas |

Os ids são estáveis e em inglês (chave no banco — `League.id` — e no mapa de assets); o nome exibido é em
português. Bronze é piso e Lenda de Minas é teto — nunca se pula liga.

**Brasões:** `assetKey` é sempre `shield_<id>` e resolve para `assets/images/icons/<assetKey>.png`
via `LEAGUE_SHIELDS` em `src/assets/index.ts`. O banco guarda só a chave, **nunca** um caminho
local. Os arquivos já existem — não gerar arte nova.

## Semana

`weekKey` é a semana ISO no fuso `America/Sao_Paulo` (`2026-W37`), começando segunda 00:00. O
cálculo é puro e compartilhado (`src/domain/model/leagueWeek.ts`) usando UTC-3 fixo — o Brasil
aboliu o horário de verão em 2019. **A virada nunca depende do relógio do aparelho:** o backend
manda `startAt`, `endAt` e `serverTime`, e o app só desconta o tempo decorrido.

## Tamanho dos grupos

`TARGET_GROUP_SIZE = 20` é **alvo, não teto**. `MIN_GROUP_SIZE = 15`; acima de
`MAX_GROUP_SIZE = 29` o sistema avalia redistribuir.

`planGroupSizes(total)` escolhe a melhor configuração: ninguém de fora, nenhum grupo abaixo do
mínimo (salvo grupo único), menor distância média do alvo, menor diferença entre grupos, menos
grupos. Exemplos: `21 → [21]` (nunca `20 + 1`), `30 → [15,15]`, `45 → [23,22]`, `61 → [21,20,20]`,
`1000 → 50 × 20`.

**Durante a semana vale estabilidade:** quem chega entra sempre no menor grupo, mesmo passando de
20. Só quando a distribuição sai do plano (`needsRebalance`) é que `rebalanceLeague` redistribui — e
`planRebalance` mantém cada grupo como âncora, movendo o mínimo de gente. Ligas acima de
`REBALANCE_MAX_MEMBERS` (5.000) não são redistribuídas no meio da semana: ali um grupo novo é aberto
quando todos estão cheios, e a virada semanal reconstrói tudo.

## Zonas de promoção/rebaixamento

Adaptativas ao tamanho real do grupo e **nunca sobrepostas** (`zonesForGroupSize`):

| Tamanho | Sobem | Descem |
|---------|-------|--------|
| ≥ 15 | 5 | 5 |
| 10–14 | 3 | 3 |
| 5–9 | 2 | 2 |
| < 5 | 1 | 1 (limitado a metade do grupo) |

Num grupo de 21 a zona de baixo é 17º–21º — o 21º **aparece** na lista, nada é escondido. O
frontend nunca calcula isso: recebe `promotionCount`, `relegationCount`, `promotionStart/End` e
`relegationStart/End` no snapshot, e o texto da regra sai de `weeklyRuleText`.

**Trava anti-inatividade:** quem terminou a semana com 0 ponto não sobe de liga
(`MIN_WEEKLY_POINTS_FOR_PROMOTION`), senão um grupo pequeno e parado promoveria gente que não jogou.
A zona continua posicional; a trava só rebaixa o resultado para `stayed`.

## Ordenação do ranking

`compareMembers` (puro, compartilhado): pontos da semana ↓, desempate acumulado ↓, vitórias ↓,
quem chegou primeiro ↑, uid ↑. O servidor grava `currentRank`; o app reordena a lista ao vivo com
**o mesmo comparador**, então nunca divergem — o cliente exibe, nunca decide.

## Tabelas (PostgreSQL)

| Tabela | Conteúdo |
|--------|----------|
| `League` | catálogo das 20 ligas (seed idempotente) |
| `LeagueSeason` | uma semana (`weekKey`): janela, `status` (`ACTIVE` → `FINALIZING` → `FINALIZED`), `finalizedAt`, `preparedAt` |
| `LeagueProgress` | por usuário: liga, divisão, semana, grupo, pontos da semana e da temporada, último resultado/posição, `lastProcessedWeekKey`, `lastActiveWeekKey` |
| `LeagueGroup` | grupo da semana; id determinístico `2026-W37__gold__001`, único por (semana, liga, divisão) |
| `LeagueMembership` | membro do grupo: pontos, vitórias, partidas, desempate, posição atual/anterior; **único por (usuário, semana)** |
| `LeagueScore` | livro-razão de pontos; `key` única = idempotência |
| `LeagueWeekResult` | resultado fechado da semana (histórico), chave (usuário, semana) |
| `JobLock` | trava lógica com expiração (virada semanal) |

`status` do grupo: `FORMING` → `ACTIVE` → `FINALIZING` → `FINALIZED` (o app recebe em minúsculas).
`UserProfile.leagueId` é só um espelho de `LeagueProgress.currentLeagueId` para as telas que
mostram a liga sem abrir a aba. Modelo completo em docs/database.md.

## Backend (`backend/src/leagues/leagues.service.ts`)

**Rotas do app** (`LeaguesController`, `/v1/leagues`)

- `GET /v1/leagues` — as 20 ligas.
- `GET /v1/leagues/me` (`getLeagueScreenSnapshot`) — payload consolidado da aba "Minha Liga"
  (conserta o vínculo antes de responder).
- `POST /v1/leagues/me/ensure` (`ensureUserLeagueAssignment`) — garante liga + grupo válidos e
  devolve o resumo. O bootstrap do app já faz isso uma vez após o login.
- `GET /v1/leagues/me/history` — histórico semanal (cursor).
- `GET /v1/leagues/ranking/global` (`getGlobalLeagueRanking`) — classificação da temporada, já
  ordenada pelo servidor (`seasonPoints` ↓, até 100).
- `GET /v1/leagues/groups/:id/ranking` — membros de um grupo.
- Ao vivo: `league.subscribe { groupId }` no WebSocket devolve os membros e passa a receber
  `league.members` quando alguém pontua (envio agrupado em 750 ms por grupo).

Só entra em grupo quem já tem apelido (`PROFILE_INCOMPLETE` antes do cadastro): ninguém aparece sem
nome no ranking.

**Jobs** (`backend/src/jobs/jobs.service.ts`, fuso `America/Sao_Paulo`; com `JOBS_MODE=cron` a
própria instância agenda, com `JOBS_MODE=external` o Cloud Scheduler chama o webhook — docs/webhooks.md)

- `league.weekly-rollover` — segunda 00:05: fecha a semana anterior e monta a seguinte.
- `league.refresh-rankings` — diária 03:00: atualiza `currentRank`/`previousRank` dos grupos ativos.
- `league.repair` — diária 04:30: varredura de consistência (abaixo).

Cada execução pega a trava `job:{nome}` em `JobLock`; se outra instância já está rodando, a
execução é pulada (`skipped`).

**Administrativas** — `POST /v1/admin/leagues/:op` (header `x-admin-secret`), com `weekKey`,
`leagueId` e `groupId` opcionais na query: `seed`, `repair`, `finalize`, `prepare`, `rebalance`,
`rank`. Jobs sob demanda: `POST /v1/admin/jobs/:job`.

**Internas** — `ensureAssignment`, `assignToGroup`, `rebalanceLeague`, `addWeeklyPoints`,
`recomputeRanking`, `finalizeWeek`, `prepareNextWeekGroups`, `weeklyRollover`, `refreshRankings`,
`repair`, `leaveCurrentGroup`, `seedDefinitions`.

### Atribuição e concorrência

`ensureAssignment` lê em paralelo o progresso e o vínculo da semana; se tudo bate (mesma semana,
mesmo grupo, mesma liga, grupo `FORMING`/`ACTIVE`) responde sem escrever. Senão chama
`assignToGroup`, que:

1. garante a `LeagueSeason` da semana;
2. entra numa fila **em processo** por chave `league:{semana}:{liga}` (`KeyedMutex`) — N requisições
   simultâneas da mesma liga não abrem N transações paradas no banco segurando conexões do pool;
3. abre a transação e pega o **advisory lock** do PostgreSQL com a mesma chave
   (`pg_advisory_xact_lock`), que vale entre instâncias;
4. relê o vínculo: se está num grupo errado (liga mudou, grupo fechado) sai dele e recalcula a
   contagem; senão escolhe o grupo ativo com menos gente (ou cria o primeiro; acima de
   `REBALANCE_MAX_MEMBERS` com todos cheios, abre um novo), cria o `LeagueMembership` com
   `currentRank = memberCount + 1`, recalcula a contagem e as zonas, e ativa o grupo;
5. atualiza `LeagueProgress` (semana nova zera `weeklyPoints`);
6. depois do commit, se a distribuição saiu do plano (`needsRebalance`) e a liga cabe no limite,
   chama `rebalanceLeague`.

`rebalanceLeague` usa a mesma fila + advisory lock, aplica `planRebalance` (move o mínimo de gente,
cria grupos com a próxima divisão livre, apaga os que sobraram), recalcula contagens e reordena os
grupos afetados. Sair da liga (exclusão de conta) também passa pelo advisory lock.

### Pontuação

`ProgressionService` chama `addWeeklyPoints` no fim de cada partida (online, contra a IA ou saída
antecipada). Os pontos são sempre **não negativos** (o ranking semanal só acumula): online 25/8,
difícil 15/5, normal 10/3, fácil 5/1 (vitória/derrota; `backend/src/progression/rewards.ts`). Subir
ou descer de liga acontece **somente** na virada semanal — nunca por partida.

`addWeeklyPoints` garante o vínculo e, numa transação, insere a linha de `LeagueScore` com
`createMany(skipDuplicates)`: se a chave já existe, nada muda. Só quando a linha é nova incrementa
`weeklyPoints`/`wins`/`matches`/`tiebreakScore` do membro e `weeklyPoints`/`seasonPoints`/
`lastActiveWeekKey` do progresso, e agenda o envio do ranking ao vivo.

### Ranking

`recomputeRanking(groupId)` ordena os membros com `rankMembers` (o mesmo comparador do app) e grava
`currentRank`/`previousRank` só de quem mudou, num único `UPDATE … FROM (VALUES …)`. Roda no envio
ao vivo, no rebalanceamento e no job diário. A leitura (`groupMembers`) sempre traz apelido/avatar
atuais do perfil — não há cópia desatualizada no membro.

### Virada semanal

`weeklyRollover` roda dentro da trava do job e de uma trava própria `league-finalize:{semana}` (30 min):

1. `seedDefinitions` (idempotente);
2. `finalizeWeek(semana anterior)`: se a `LeagueSeason` já está `FINALIZED`, devolve
   `alreadyFinalized`. Senão marca `FINALIZING` e percorre os grupos não finalizados em páginas de
   200. Para cada grupo: `FINALIZING` → `resolveWeeklyOutcomes` → em lotes de 50, numa transação,
   pula quem já tem `LeagueWeekResult` da semana e, para os demais, grava o resultado, move a liga
   em `LeagueProgress` (zera a semana, `lastWeeklyResult`, `lastWeeklyRank`,
   `lastProcessedWeekKey`), espelha em `UserProfile.leagueId` e congela a posição → grupo
   `FINALIZED`. No fim, semana `FINALIZED`;
3. `prepareNextWeekGroups`: para cada liga, pega quem foi processado **e** jogou na semana que
   fechou e, sob o advisory lock da liga na semana nova, distribui com `planGroupSizes` em grupos
   `FORMING`. Liga que já tem grupos na semana nova é pulada. Marca `preparedAt`.

### Idempotência

| Operação | Chave |
|----------|-------|
| pontuar | `LeagueScore.key` = `{matchKey}__{userId}__{evento}` |
| atribuir grupo | `LeagueMembership (userId, weekKey)` único + advisory lock da liga na semana |
| criar grupo | `groupIdFor(weekKey, leagueId, division)` + `upsert` |
| fechar semana | `LeagueSeason.status` + `LeagueWeekResult (userId, weekKey)` + `lastProcessedWeekKey` |
| preparar semana | grupos já existentes na semana nova → liga pulada; `createMany(skipDuplicates)` |
| seed | `League` com `upsert` |
| execução do job | `JobLock` com expiração (instância que morreu não trava o sistema) |

Rodar qualquer uma duas vezes (ou retomar depois de uma falha no meio) dá o mesmo resultado: sem
ponto dobrado, promoção dupla ou histórico duplicado.

### Escala

O caminho normal consulta sempre por `leagueId + weekKey` (índice `LeagueGroup (weekKey, leagueId,
status)`) — nada de full scan (só o `repair` varre, em páginas). A virada pagina por cursor e grava
em lotes.

Contas **dormentes** (sem pontos na semana que fechou) não são pré-alocadas para a semana seguinte:
a liga fica guardada em `LeagueProgress` e `ensureAssignment` recoloca a pessoa num grupo assim que
ela abre o app. É isso que mantém a virada viável com muitos usuários sem violar a regra absoluta.

### Repair

`repair` (job diário e admin): na semana atual apaga grupos vazios não finalizados e corrige
`memberCount`; depois percorre `LeagueProgress` (até 5.000 por execução) normalizando liga inválida
e reatribuindo quem aponta para um grupo do qual não é membro.

## Segurança

O app só **lê** pela API: as ligas, o próprio snapshot/histórico, o ranking global e os membros do
grupo. Nenhuma rota escreve pontos, posição, liga ou resultado: `weeklyPoints`, `currentRank`,
`currentLeagueId`, `currentGroupId` e o resultado da semana só mudam dentro do backend (partidas
validadas, jobs e rotas administrativas com `x-admin-secret`). `LeagueScore` e `JobLock` não são
expostos.

## Índices

- `LeagueGroup`: único (`weekKey`, `leagueId`, `division`) e (`weekKey`, `leagueId`, `status`)
- `LeagueMembership`: únicos (`userId`, `weekKey`) e (`groupId`, `userId`)
- `LeagueProgress`: (`seasonPoints` desc, `userId`) e (`currentLeagueId`, `lastProcessedWeekKey`,
  `lastActiveWeekKey`)
- `LeagueScore`: `key` único e (`userId`, `weekKey`)
- `LeagueWeekResult`: (`userId`, `processedAt` desc)

## Testes

```
npm test -- src/domain/model            # escada, semana ISO, balanceamento, zonas, resultados
npm test -- src/screens/league          # tela: zonas, 21º jogador, topo/piso, estados
npm test -- src/assets                  # os 20 brasões existem e mapeiam certo
npm --prefix backend run test:integration -- leagues-matchmaking
                                        # cadastro obrigatório, snapshot, pontos idempotentes,
                                        # virada idempotente, rebalanceamento (PostgreSQL real)
```
