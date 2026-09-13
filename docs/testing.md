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

## Ainda não exercitado
- Mesa com 2+ humanos reais (exige dois dispositivos/contas).
- Matchmaking com 4 humanos na fila.
- Reconexão real no meio de uma partida online (o caminho de código existe e o banner aparece quando
  `.info/connected` cai, mas não foi forçado num teste).
- Testes de Security Rules com `@firebase/rules-unit-testing`.
