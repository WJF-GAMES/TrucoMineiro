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

Os ids são estáveis e em inglês (chave no Firestore e no mapa de assets); o nome exibido é em
português. Bronze é piso e Lenda de Minas é teto — nunca se pula liga.

**Brasões:** `assetKey` é sempre `shield_<id>` e resolve para `assets/images/icons/<assetKey>.png`
via `LEAGUE_SHIELDS` em `src/assets/index.ts`. O Firestore guarda só a chave, **nunca** um caminho
local. Os arquivos já existem — não gerar arte nova. `coin`, `coins_*` e `gem` não são ligas.

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

## Coleções

| Caminho | Conteúdo |
|---------|----------|
| `leagueDefinitions/{leagueId}` | catálogo das 20 ligas (seed idempotente) |
| `playerProgress/{uid}` | liga, divisão, semana, grupo, pontos da semana e da temporada |
| `weeklyLeagueGroups/{groupId}` | grupo da semana; id determinístico `2026-W37__gold__001` |
| `weeklyLeagueGroups/{groupId}/members/{uid}` | apelido, avatar, bandeira, pontos, posição |
| `leagueHistory/{uid}/weeks/{weekKey}` | resultado fechado da semana |
| `processedLeagueEvents/{eventId}` | idempotência de pontuação (`matchId__uid__eventType`) |
| `leagueProcessingLocks/{lockId}` | trava lógica com expiração |

`status` do grupo: `forming` → `active` → `finalizing` → `finalized`.

## Cloud Functions

**Chamáveis pelo app**

- `bootstrapLeagueSystemForUser` / `ensureUserLeagueAssignment` — garante liga + grupo válidos.
- `getLeagueScreenSnapshot` — payload consolidado da aba "Minha Liga" (conserta antes de responder).
- `getGlobalLeagueRanking` — classificação da temporada, já ordenada pelo servidor.

**Agendadas** (`America/Sao_Paulo`)

- `finalizeWeeklyLeagues` — segunda 00:05: fecha a semana e monta a seguinte.
- `refreshLeagueRankings` — diária 03:00: atualiza `currentRank`/`previousRank` dos grupos ativos.

**Administrativas** — `leagueAdmin?op=…` (header `x-seed-secret`, liberado no emulador):
`seed`, `repair`, `finalize`, `prepare`, `rebalance`, `rank`.

**Internas** — `ensureAssignment`, `assignToGroup`, `rebalanceLeague`, `addWeeklyLeaguePoints`,
`recomputeWeeklyLeagueRanking`, `finalizeWeek`, `prepareNextWeekGroups`, `repairLeagueSystem`,
`leaveCurrentLeagueGroup`, `seedLeagueDefinitionsInternal`.

### Pontuação

`processProgression` chama `addWeeklyLeaguePoints` no fim de cada partida. Os pontos são sempre
**não negativos** (o ranking semanal só acumula): online 25/8, difícil 15/5, normal 10/3, fácil 5/1
(vitória/derrota). Subir ou descer de liga acontece **somente** na virada semanal — nunca por
partida.

### Idempotência

| Operação | Chave |
|----------|-------|
| pontuar | `processedLeagueEvents/{matchId}__{uid}__{eventType}` |
| atribuir grupo | id determinístico do grupo + documento de membro |
| fechar semana | `leagueHistory/{uid}/weeks/{weekKey}` + `lastProcessedWeekKey` |
| criar grupo | `groupIdFor(weekKey, leagueId, division)` |
| seed | `leagueDefinitions/{id}` com `set` |

Rodar qualquer uma duas vezes (ou retomar depois de uma falha no meio) dá o mesmo resultado: sem XP
dobrado, promoção dupla ou histórico duplicado.

### Escala

O caminho normal consulta sempre por `leagueId + weekKey` — nada de full scan (só o `repair`
administrativo varre). A virada usa `count()` + paginação por cursor e escreve em lotes.

Contas **dormentes** (sem pontos na semana que fechou) não são pré-alocadas para a semana seguinte:
a liga fica guardada em `playerProgress` e `ensureAssignment` recoloca a pessoa num grupo assim que
ela abre o app. É isso que mantém a virada viável com muitos usuários sem violar a regra absoluta.

## Segurança

O cliente **lê** `leagueDefinitions`, o próprio `playerProgress`, o grupo da semana com seus membros
(ranking ao vivo) e o próprio `leagueHistory`. O cliente **não escreve nada**: `weeklyPoints`,
`currentRank`, `currentLeagueId`, `currentLeagueGroupId` e o resultado da semana só mudam via
Functions. `processedLeagueEvents` e `leagueProcessingLocks` são invisíveis para o app.

## Índices

- `weeklyLeagueGroups`: (`leagueId`, `weekKey`, `memberCount`) e (`weekKey`, `status`)
- `playerProgress`: (`currentLeagueId`, `lastProcessedWeekKey`, `lastActiveWeekKey`, `__name__`) e
  (`seasonPoints` desc, `__name__`)
- `weeks` (grupo de coleção): `processedAt` desc

## Testes

```
npm test -- src/domain/model            # escada, semana ISO, balanceamento, zonas, resultados
npm test -- src/screens/league          # tela: zonas, 21º jogador, topo/piso, estados
npm test -- src/assets                  # os 20 brasões existem e mapeiam certo
npm --prefix functions test             # motor completo sobre um Firestore em memória
node scripts/league-e2e.js              # fumaça contra o Emulator Suite (apaga dados do emulador)
```
