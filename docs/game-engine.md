# Game Engine — Truco Mineiro

Pasta `src/domain/game/` — TypeScript puro, sem React/React Native/Firebase (regra de lint em `eslint.config.js`).

## Regras implementadas

- Baralho de 40 cartas (4,5,6,7,Q,J,K,A,2,3 × ♣♥♠♦). Embaralhamento Fisher-Yates com PRNG determinístico (mulberry32).
- Força: manilhas fixas **Zap (4♣) > 7♥ > Espadilha (A♠) > 7♦**, depois 3 > 2 > A > K > J > Q > 7 > 6 > 5 > 4. Cartas iguais (não manilha) empatam.
- 4 jogadores em duplas: assentos 0 e 2 (time 0) contra 1 e 3 (time 1). Assento 0 é o jogador local.
- Mão = melhor de 3 rodadas. Empates: 1ª empatada → 2ª decide; 1ª ganha + 2ª empatada → vencedor da 1ª; 3ª empatada → vencedor da 1ª; tudo empatado → ninguém pontua.
- Vencedor da rodada lidera a próxima (em empate, o líder anterior).
- Apostas: 1 → Truco (3) → Seis (6) → Nove (9) → Doze (12). Quem fez o último aumento aceito não pode pedir de novo; o time que responde pode **aceitar**, **aumentar** ou **correr** (correr entrega o valor atual).
- Mão de onze: time com 11 pontos decide jogar valendo 3 ou entregar 1. Ambos com 11: mão normal sem truco.
- Partida até 12 pontos; `dealerSeat` gira a cada mão.
- **Cerimônia real**: a mão começa em `SHUFFLING` com o baralho já embaralhado uma vez pelo motor
  (`deck`, `deckVersion: 0`, `shuffleCount: 0`, ninguém com cartas). O dealer pode `SHUFFLE`
  quantas vezes quiser (cada uma reembaralha **o baralho atual** com o PRNG e sobe
  `deckVersion`/`shuffleCount`) e fecha com `FINISH_SHUFFLE` (nada é reembaralhado escondido).
  Em `CUTTING` o assento seguinte faz `CUT` com `depth` (`high`/`middle`/`low` = 10/20/30 cartas
  de cima vão para baixo, `deckVersion` sobe de novo) e o motor distribui na mesma ação
  (`HAND_DEALT`). Só então vem `MAO_DE_ONZE`/`PLAY`. `skipCeremony(state)` é um helper de
  teste/ferramenta. Determinístico pelo seed: o replay no servidor reproduz misturas e corte.

## API

```ts
createMatch(seed, targetScore = 12): MatchState
getAvailableActions(state, seat): ActionType[]      // a UI só renderiza o que vier daqui
applyAction(state, action): MatchState              // lança InvalidActionError
viewForSeat(state, seat): SeatView                  // esconde as mãos dos outros; expõe dealerSeat
seatsToAct(state): Seat[]
decideHand(results): Team | null | undefined
```

Ações: `SHUFFLE`, `FINISH_SHUFFLE`, `CUT`, `PLAY_CARD`, `REQUEST_TRUCO`, `ACCEPT_TRUCO`, `RAISE`, `RUN`, `ACCEPT_MAO_DE_ONZE`, `DECLINE_MAO_DE_ONZE`.
Eventos (`state.events`): HAND_STARTED, SHUFFLE_PERFORMED, SHUFFLE_FINALIZED, CUT_DONE, HAND_DEALT, CARD_PLAYED, ROUND_ENDED, TRUCO_REQUESTED/ACCEPTED/RAISED, RAN, MAO_DE_ONZE_*, HAND_ENDED, MATCH_ENDED.

A IA decide a cerimônia em `ceremonyDecision` (igual nas três dificuldades): mistura de 1 a 3
vezes (alvo sorteado no mesmo RNG, logo replicável no servidor) e corta em profundidade aleatória.

## IA (`ai/`)

- `AIObservation` = projeção do `SeatView`: só as próprias cartas, contagens, cartas jogadas, placar, valor, ações disponíveis.
- `easy`: aleatória com pouca agressividade. `normal`: heurística (força da mão, parceiro ganhando, carta mínima que vence). `hard`: heurística + blefe (12%) + leitura de placar (aceita truco "desesperado" quando correr perde a partida).
- `runAITurns` / `nextAIAction` conduzem os assentos de IA; o RNG da IA é separado (`aiSeed`) para replay no servidor.

## Testes

`npm run test:engine` — 34 testes (baralho, força, empates, truco, mão de onze, views, IA válida em 900 partidas).
`npm run test:sim -- 3000` — simulação em massa: 9.000 partidas (3 dificuldades) sem deadlock/loop/estado impossível; ~60–90 ações por partida; win rate ~50%.

## Cerimônia de início de mão (UI)

Embaralhar → cortar → distribuir, agora **dirigida pelo motor** (não é mais só apresentação):

- `src/features/game/useCeremony.ts` deriva o estágio de `view.phase` (`SHUFFLING` → shuffle,
  `CUTTING` → cut) e mantém um único estágio local, "deal", por `CEREMONY_TIMING.dealMs` depois do
  `CUT_DONE`. Quem age vem de `dealerSeat`/`cutterSeatOf`. "EMBARALHAR NOVAMENTE" envia `SHUFFLE`
  (um por vez: o botão trava até `shuffleCount` mudar ou 1,2 s), "ESTÁ BOM" envia
  `FINISH_SHUFFLE` (só com ≥ 1 mistura), "CONFIRMAR CORTE" envia `CUT` com a profundidade
  escolhida.
- Prazo: `useTurnTimer` com `turnDurationMs(phase)` — 10 s para embaralhar (um prazo para o
  estágio inteiro, as misturas não o reiniciam), 8 s para cortar, 25 s para jogar. Ao estourar,
  `timeoutAction` fecha o embaralhamento com o baralho como está / corta no meio. O prazo é local
  ao ator; o servidor ainda não publica prazos (pendência).
- Tela: `src/screens/game/TableCeremony.tsx` — no embaralho, título/subtítulo, card "Tempo para
  embaralhar" com anel, `ShuffleAnimation` (dois montes, cartas trançando, setas), card "Mistura do
  baralho" (● ● ● + contador + feedback), botões e rodapé; quem assiste vê a mesma animação a cada
  `SHUFFLE_PERFORMED`. No corte, `CutDeck` + `CutOptions` (alto/meio/baixo). A distribuição roda
  na mesa (`DealOverlay`): cada carta pousa no montinho ou no slot real e as do jogador viram no
  lugar.
- Abertura da partida: `MatchCountdown` ("3, 2, 1, Valendo!") antes do primeiro embaralho.
- `src/domain/game` não sabe de animação nenhuma; mas o baralho, as misturas e o corte são dele.

## Apresentação da vaza (UI)

O motor resolve a vaza **no mesmo `applyAction`** da quarta carta: `currentRound` chega à UI já
vazio e, quando a mão termina, a view seguinte já é de outra mão. Desenhar só `currentRound` fazia
a última carta nunca aparecer e a mesa esvaziar antes de alguém entender quem levou.

- `src/domain/game/rules/strength.ts#leadingPlay` — carta que está ganhando numa vaza parcial
  (mesma comparação do `resolveRound`; marca empate entre adversários).
- `src/features/game/trickPresentation.ts` — reducer puro: reconstrói as quatro cartas a partir de
  `ROUND_ENDED` + `view.rounds` (mão continua) ou do lote de `CARD_PLAYED` (mão acabou), segura a
  vaza (`holdMs`), recolhe (`collectMs`) e limpa. `TRICK_RESOLVE_PAUSE_MS` é o tempo que os bots
  (IA local e `advanceBots` online) esperam depois de uma vaza fechar.
- `useTrickPresentation.ts` — deriva a apresentação no render em que view/lote mudam (deduplica
  lotes repetidos por `view.version`) e só usa timers para o relógio segurar → recolher → vazio.
- `src/screens/game/TrickCard.tsx` — a carta voa do assento de quem jogou, recebe "Ganhando"
  (verde) ou "Vencedora" (dourado + troféu), as perdedoras escurecem, e todas recolhem na direção
  de quem levou.
- Enquanto a vaza fechada está na mesa (`isHolding`), o jogador não joga, a cerimônia da mão nova
  espera e as cartas novas ficam escondidas.
- `useAiGame` publica **view e eventos no mesmo estado**: a mesa nunca vê uma view sem o lote dela.

## Relógio de turno (UI)

`src/features/game/turnTimer.ts` + `useTurnTimer.ts`: 25 s por decisão (carta, resposta ao truco,
mão de onze), prazo absoluto derivado de `view.version` (sobrevive a re-render e background). Ao
estourar, o cliente faz **pelo próprio assento** a jogada mais conservadora entre as
`availableActions` — carta mais fraca, correr, entregar a mão de onze — e o motor/servidor valida
como qualquer ação. Anel + "12s" só no jogador local; os outros assentos não mostram relógio falso.
