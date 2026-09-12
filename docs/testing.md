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
