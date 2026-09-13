# Testes

| Tipo | Comando | Cobertura |
|---|---|---|
| Unit — Game Engine | `npm run test:engine` | baralho, shuffle determinístico, distribuição, força/manilhas, turno, rodadas e empates, Truco/Seis/Nove/Doze (aceitar, aumentar, correr), mão de onze, fim de partida, views sem vazamento |
| Unit — IA | idem | ações sempre válidas, nunca carta inexistente, nunca fora de turno, nunca vê cartas escondidas, 900 partidas terminam |
| Simulação em massa | `npm run test:sim -- 3000` | 9.000 partidas IA×IA: deadlock, loop, contagem de cartas impossível, término garantido |
| Component | `npm test` (jest-expo) | `src/**/__tests__` (componentes usam mocks dos módulos nativos em `jest.setup.ts`) |
| Functions | `cd functions && npm test` | replay anti-trapaça, progressão idempotente, regras de sala |
| Security Rules | `firebase emulators:exec --only firestore,database "npm run test:rules"` | *(pendente: harness @firebase/rules-unit-testing)* |
| E2E manual/QA | roteiro em docs/visual-regression.md | Introdução → Login → OTP → Cadastro → Principal → Jogar → IA → Mesa → Resultado; Online → Jogo rápido → Mesa; Criar sala → Lobby |

Ciclo por feature: implementar → `npm run format` → `npm run lint` → `npm run typecheck` → `npm test` → build → executar → QA funcional → QA visual → corrigir.

## Resultado da última execução (12/09)

| Suíte | Resultado |
|---|---|
| `npm test` (app) | **47 testes, 6 suítes — passando** (engine, IA, driver de passo único, cards, telefone, normalização RTDB) |
| `cd functions && npm test` | **9 testes — passando** (replay anti-trapaça, round-trip do RTDB) |
| `npm run test:sim -- 3000` | 9.000 partidas IA×IA sem deadlock/loop/estado impossível |
| `npm run lint` / `typecheck` | 0 problemas |

## E2E executado no emulador Android (APK release, Firebase de produção)

1. Introdução → Login (`+55 61 9.9628-9726`) → OTP (`123456`) → Cadastro → Principal ✅
2. Principal → Jogar → Contra a IA (Normal) → Mesa → partida até 12 pontos → Resultado com
   XP/moedas/liga vindos de `finalizeMatch` ✅
3. Recompensa diária (`claimReward`), com botão virando "Resgatado" e saldo atualizado ✅
4. Jogar → Jogar Online → Criar Sala (código de 6 caracteres) → Completar com IA → Pronto →
   Iniciar partida → Mesa online (servidor autoritativo, uma ação por vez via `submitGameAction`
   e `advanceBots`) → partida até 12 pontos → Resultado com a progressão lida de
   `gameSessions/{id}/results/{seat}` ✅
5. Navegação completa: Principal, Jogar, Liga, Amigos, Mais, Loja, Perfil, Configurações ✅

Estado final no projeto real: 1 perfil, 5 partidas, 180 XP, 15 pontos de liga, 1 conquista desbloqueada.

## Amigos e contatos

| Suíte | Cobre |
|---|---|
| `src/features/friends/__tests__/contactsMatch.test.ts` | normalização E.164, dedupe dentro e entre contatos, agendas de 0/1/100/1.000/10.000, contato sem telefone, vários números por contato, ordenação por utilidade, fingerprint, e a garantia de que **nenhum telefone aparece no resultado** |
| `src/features/friends/__tests__/useContactsSync.test.ts` | os cinco estados de permissão, um request por lote de 200 (nunca por contato), reposicionamento dos índices entre lotes, cache que evita rede quando a agenda não mudou, tradução dos erros do servidor, e que nem telemetria nem disco recebem telefone |
| `src/services/__tests__/contacts.test.ts` | mapeamento dos estados nativos (incluindo `limited` do iOS 18), leitura paginada, só os campos nome+telefones, agenda vazia e falha nativa |
| `functions/test/contacts.test.ts` | determinismo do HMAC, teto de 200 por lote, rejeição de tudo que não é E.164, id determinístico da solicitação |
| `src/features/friends/__tests__/useRoomInvites.test.ts` | convite de sala: lista ao vivo, descarte do convite vencido, entrar (joinRoom + limpeza), sala cheia/partida começada (limpa) versus offline (mantém para nova tentativa), recusar |
| `src/screens/friends/__tests__/FriendsScreen.test.tsx` | cada botão da tela chamando a Function certa: jogar/convidar (inclusive amigo em partida), ficha do amigo (liga, números, remover, bloquear com confirmação), aceitar/recusar/cancelar solicitação, estado de carregando das solicitações, busca escondendo bloqueados e oferecendo "Aceitar" para quem já me convidou, convite de sala recebido, desbloqueio, e a flag `friends_enabled` desligada |
| `src/features/game/__tests__/shuffleCeremony.test.ts` | quem embaralha/corta (o cortador é sempre adversário do embaralhador), progresso do gesto, formato e limites do relógio |
| `src/features/game/__tests__/useShuffleCeremony.test.ts` | a máquina embaralhar→cortar→distribuir→mesa: botão travado até o mínimo, conclusão automática ao completar, estouro de tempo sem travar a mão, assento remoto encenado, relógio congelado na reconexão, recomeço a cada mão e cancelamento se a mesa cai |
| `src/features/game/__tests__/trickPresentation.test.ts` | a vaza fechada fica na mesa com as quatro cartas e a vencedora (qualquer assento fechando, inclusive o local), reconstrução da última vaza quando a view já é da mão seguinte, fast-forward na reconexão, segurar → recolher → vazio pelo relógio, lote repetido não reinicia |
| `src/features/game/__tests__/turnTimer.test.ts` | jogada automática por timeout: carta mais fraca (nunca a manilha), correr do truco, entregar mão de onze, nada fora da vez; formato do relógio |
| `src/domain/game/__tests__/engine.test.ts` (`leadingPlay`) | 1ª vence, 2ª/3ª/4ª assumem, 1ª permanece, manilhas, empate entre adversários vs. parceiros |
| `src/screens/game/__tests__/TableCeremony.test.tsx` | a tela em cada estado: gesto pedido, botão liberado, vez de outro jogador (sem ação nem relógio), sucesso, tempo esgotado, corte, reconexão e distribuição |

Pendente de teste manual em aparelho: o diálogo do sistema de contatos em Android e iOS
(o Jest cobre o mapeamento, não o diálogo nativo), o QR lido por um segundo aparelho e o convite de
sala entre duas contas reais (o caminho é coberto por teste, mas o push em si precisa de aparelho).

## Ainda não exercitado
- Cerimônia de embaralhar num aparelho real: o gesto, o borrão das cartas e a fluidez das animações
  do Reanimated não são observáveis sob Jest (o runtime de worklets é mockado) — os testes cobrem
  estados, textos e transições, não o movimento.
- Mesa com 2+ humanos reais (exige dois dispositivos/contas).
- Matchmaking com 4 humanos na fila.
- Reconexão real no meio de uma partida online (o caminho de código existe e o banner aparece quando
  `.info/connected` cai, mas não foi forçado num teste).
- Testes de Security Rules com `@firebase/rules-unit-testing`.

## QA no emulador (mesa)

- `scripts/qa.sh launch` (com `DEV_CLIENT=1`) refaz o `adb reverse tcp:8081` — ele some sempre
  que o emulador reinicia e, sem ele, o dev client mostra "Failed to connect to localhost:8081".
- `scripts/qa-record.sh <nome> <segundos> [x y ...]` grava a tela (`screenrecord`) enquanto toca e
  gera uma folha de contato dos quadros em `artifacts/screenshots/<nome>.png`. Atenção: o
  `screenrecord` só emite quadros quando a tela muda, então pausas longas *parecem* mais longas
  no vídeo — para medir tempo use os logs `[table]` (`adb logcat | grep table`).
- `scripts/qa-autoplay.sh` joga uma partida contra a IA no automático (toca no baralho da
  cerimônia e numa carta a cada ciclo) até o log registrar `MATCH_ENDED`.
- Logs de desenvolvimento da mesa (`src/utils/devLog.ts`, só em `__DEV__`): `PLAY_CARD`,
  `EVENTS`, `TRICK_RESOLVED`, `TURN_CHANGED`, `TIMEOUT`, `CEREMONY_STAGE`, `CEREMONY_COMPLETE`.
