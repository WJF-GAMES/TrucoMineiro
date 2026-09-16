# Game Engine — Truco Mineiro

Pasta `src/domain/game/` — TypeScript puro, sem React/React Native/Firebase (regra de lint em `eslint.config.js`).

## Regras implementadas

- Baralho de 40 cartas (4,5,6,7,Q,J,K,A,2,3 × ♣♥♠♦). Embaralhamento Fisher-Yates com PRNG determinístico (mulberry32).
- Força: manilhas fixas **Zap (4♣) > 7♥ > Espadilha (A♠) > 7♦**, depois 3 > 2 > A > K > J > Q > 7 > 6 > 5 > 4. Cartas iguais (não manilha) cangam (empatam) — só entre adversários: duas iguais da mesma dupla não são cango.
- 4 jogadores em duplas: assentos 0 e 2 (time 0) contra 1 e 3 (time 1). Assento 0 é o jogador local.
- Mão em até 3 vazas, **não** "melhor de três": a ordem dos resultados importa. Vencedor da vaza abre a próxima.
- **Cango** (regra central em `rules/hand.ts`: `resolveTrick`, `resolveHand`, `highestCards`):
  - 1ª cangada → **desempate** (`hand.tieBreak`): quem cangou abre a 2ª, e todos, na ordem da
    mesa, são obrigados a jogar a **maior carta** (o motor recusa outra com
    `MUST_PLAY_HIGHEST_CARD`). Quem vencer a 2ª leva a mão (`decidedBy: 'CANGO_TIE_BREAK'`).
  - 1ª e 2ª cangadas → a 3ª continua em desempate, aberta por quem cangou a 2ª.
  - 1ª com vencedor + 2ª cangada → vence quem ganhou a 1ª, sem 3ª vaza (`FIRST_TRICK_ADVANTAGE`).
  - 1ª e 2ª com vencedores diferentes + 3ª cangada → vence quem ganhou a 1ª (`FIRST_TRICK_ADVANTAGE`).
  - As três cangadas → `ALL_THREE_TRICKS_TIED_POLICY = 'NO_POINTS'`: ninguém pontua (único caso
    que depende de variante local; a decisão está isolada nessa constante).
  - Quem cangou = o primeiro jogador cuja carta igualou a maior carta do time adversário. Um igual
    posterior não troca o autor; uma carta maior desfaz o cango.
  - No desempate a carta virada é proibida (`PLAY_CARD_COVERED` some de `availableActions` e o
    motor recusa): o desempate é sempre de cartas abertas.
  - Truco continua permitido no desempate pelas regras normais; o valor da mão não muda a resolução.
  - `tieBreak` volta a `null` quando a mão acaba (qualquer motivo) e em toda mão nova.
- **Carta virada ("no escuro")**: ação `PLAY_CARD_COVERED` (liberada em `availableActions` em
  qualquer vaza normal da vez **a partir da segunda rodada da mão** — nunca na primeira rodada e
  nunca no desempate). A carta sai da mão normalmente, mas vale
  `COVERED_CARD_STRENGTH = 0` (`playStrength`), abaixo de qualquer carta aberta — inclusive manilha
  virada perde para um 4 aberto. Viradas de times opostos como maiores forças cangam pela regra
  normal; a identidade real nunca desempata. O estado guarda a carta real (`PlayedCard.covered`);
  views e eventos usam `TablePlay` e **só quem jogou** vê a identidade (`playForSeat`,
  `eventsForSeat` — usados pelo servidor por assento e pela mesa local). A carta segue secreta depois
  da vaza e da mão.
- **Mão de onze recusada ("correr")**: o motor emite `HAND_REVEALED` (as 12 cartas das mãos) antes
  de `HAND_ENDED`. É só apresentação: a mão já está decidida e pontuada; a mesa mostra
  `HandRevealOverlay` por `REVEAL_MS` (1,8 s) e segura cerimônia e bots enquanto isso
  (`useHandReveal`; reconexão com o lote já gravado segue direto, sem revelar de novo).
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
playableCards(state, seat): Card[]                  // no desempate, só a(s) maior(es)
canPlayCovered(state): boolean                       // carta virada liberada (2ª rodada em diante, fora do desempate)
playForSeat(play, seat) / eventsForSeat(events, seat) // redação da carta virada por assento
resolveTrick(plays): { outcome: Team | 'TIE', winnerSeat, tieCausedBySeat }
resolveHand(outcomes): CONTINUE (tieBreak?) | WINNER (decidedBy) | ALL_TIED
```

`SeatView` traz `playableCardIds` (a mesa habilita só essas cartas) e `tieBreak`
(`{ causedBySeat, round }` ou `null`). Em `rounds`, `winner: null` é sempre cango (a vaza em
andamento fica em `currentRound`) e, no cango, `winnerSeat` é quem cangou. `HandResult.decidedBy`
diz como as vazas decidiram a mão.

Ações: `SHUFFLE`, `FINISH_SHUFFLE`, `CUT`, `PLAY_CARD`, `PLAY_CARD_COVERED`, `REQUEST_TRUCO`, `ACCEPT_TRUCO`, `RAISE`, `RUN`, `ACCEPT_MAO_DE_ONZE`, `DECLINE_MAO_DE_ONZE`.
Eventos (`state.events`): HAND_STARTED, SHUFFLE_PERFORMED, SHUFFLE_FINALIZED, CUT_DONE, HAND_DEALT, CARD_PLAYED (`covered`), ROUND_ENDED, TIE_BREAK_STARTED (`round`, `leadSeat`, `continued`), TRUCO_REQUESTED/ACCEPTED/RAISED, RAN, MAO_DE_ONZE_*, HAND_REVEALED, HAND_ENDED, MATCH_ENDED.

A IA decide a cerimônia em `ceremonyDecision` (igual nas três dificuldades): mistura de 1 a 3
vezes (alvo sorteado no mesmo RNG, logo replicável no servidor) e corta em profundidade aleatória.

## IA (`ai/`)

- `AIObservation` = projeção do `SeatView`: só as próprias cartas, contagens, cartas jogadas, placar, valor, ações disponíveis.
- `easy`: aleatória com pouca agressividade. `normal`: heurística (força da mão, parceiro ganhando, carta mínima que vence). `hard`: heurística + blefe (12%) + leitura de placar (aceita truco "desesperado" quando correr perde a partida).
- Carta virada (`withCover`): `normal` (25%) e `hard` (50%) viram só quando a carta escolhida já não
  muda a vaza (fica abaixo da mesa, sem empatar), nunca ao abrir a vaza nem no desempate; `easy`
  nunca vira.
- Desempate por cango (`tieBreakDecision`, nas três dificuldades): sem estratégia, blefe ou pedido de truco — joga a maior carta.
- `runAITurns` / `nextAIAction` conduzem os assentos de IA; o RNG da IA é separado (`aiSeed`) para replay no servidor.

## Testes

`npm run test:engine` — 34 testes (baralho, força, empates, truco, mão de onze, views, IA válida em 900 partidas).
`src/domain/game/__tests__/cango.test.ts` — matrizes de `resolveHand`, quem cangou, maior carta, fluxo de cada cenário no motor (com valores 1/3/6/9/12), quem abre em cada assento, truco no desempate, IA.
`npm run test:sim -- 3000` — simulação em massa: 9.000 partidas (3 dificuldades) sem deadlock/loop/estado impossível; também confere que toda carta de desempate é a maior e que o desempate nunca vaza para outra fase/mão.

## Cerimônia de início de mão (UI)

Embaralhar → cortar → distribuir, agora **dirigida pelo motor** (não é mais só apresentação):

- `src/features/game/useCeremony.ts` deriva o estágio de `view.phase` (`SHUFFLING` → shuffle,
  `CUTTING` → cut) e mantém um único estágio local, "deal", por `CEREMONY_TIMING.dealMs` depois do
  `HAND_DEALT` (não do `CUT_DONE`: o corte é repetível e só o `FINISH_CUT` distribui). Quem age vem de `dealerSeat`/`cutterSeatOf`. "EMBARALHAR NOVAMENTE" envia `SHUFFLE`
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
  (é a mesma função que `resolveTrick` usa; marca cango entre adversários e quem cangou).
- **Cango na mesa**: vaza cangada não tem carta vencedora (nem "Vencedora", nem destaque); a
  linha de status mostra `CANGO_COPY[resolved.cango]`, lido dos eventos do motor
  (`TIE_BREAK_STARTED` / `HAND_ENDED.result`): "Cangou! Agora todos jogam a maior carta.",
  "Cangou de novo! A terceira decide.", "Cangou! Vale a primeira." ou "Cangou tudo! Ninguém
  pontua.". As cartas continuam na mesa pelo mesmo `holdMs` e são recolhidas para quem cangou.
  Depois, no desempate, a linha diz quem abre / de quem é a vez ("Vale a maior carta"), a mão só
  habilita `view.playableCardIds` (a maior carta ganha o selo "MAIOR" e dica no leitor de tela; as
  outras ficam apagadas e desabilitadas) e o timeout joga a maior carta.
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

## Mão do jogador (UI)

- Jogar é **um toque** (`HandCard`): não há arraste nem ponto de soltura; a trajetória até o slot é
  da mesa (`TrickCard`, sempre do assento de quem jogou). Retorno imediato (afunda + háptico) e
  trava de jogada dupla até a view mudar (`playLock`, liberada em 2,5 s se a jogada for recusada).
- "Jogar virada" (só quando `PLAY_CARD_COVERED` está em `availableActions`) arma o modo: as cartas
  mostram o véu "VIRADA", a linha de status orienta e o próximo toque envia `PLAY_CARD_COVERED`.
  Na mesa a carta aparece só pelo verso ("Carta virada"), do voo ao recolhimento, e nunca como
  "Ganhando".
- Tela acesa: `useMatchKeepAwake` (expo-keep-awake, tag `truco-match`) enquanto a mesa está em
  jogo/reconectando; desliga no fim, na saída e ao desmontar; reaplica ao voltar do background.
