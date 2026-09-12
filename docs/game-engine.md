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

## API
```ts
createMatch(seed, targetScore = 12): MatchState
getAvailableActions(state, seat): ActionType[]      // a UI só renderiza o que vier daqui
applyAction(state, action): MatchState              // lança InvalidActionError
viewForSeat(state, seat): SeatView                  // esconde as mãos dos outros
seatsToAct(state): Seat[]
decideHand(results): Team | null | undefined
```
Ações: `PLAY_CARD`, `REQUEST_TRUCO`, `ACCEPT_TRUCO`, `RAISE`, `RUN`, `ACCEPT_MAO_DE_ONZE`, `DECLINE_MAO_DE_ONZE`.
Eventos (`state.events`): HAND_STARTED, CARD_PLAYED, ROUND_ENDED, TRUCO_REQUESTED/ACCEPTED/RAISED, RAN, MAO_DE_ONZE_*, HAND_ENDED, MATCH_ENDED.

## IA (`ai/`)
- `AIObservation` = projeção do `SeatView`: só as próprias cartas, contagens, cartas jogadas, placar, valor, ações disponíveis.
- `easy`: aleatória com pouca agressividade. `normal`: heurística (força da mão, parceiro ganhando, carta mínima que vence). `hard`: heurística + blefe (12%) + leitura de placar (aceita truco "desesperado" quando correr perde a partida).
- `runAITurns` / `nextAIAction` conduzem os assentos de IA; o RNG da IA é separado (`aiSeed`) para replay no servidor.

## Testes
`npm run test:engine` — 34 testes (baralho, força, empates, truco, mão de onze, views, IA válida em 900 partidas).
`npm run test:sim -- 3000` — simulação em massa: 9.000 partidas (3 dificuldades) sem deadlock/loop/estado impossível; ~60–90 ações por partida; win rate ~50%.
