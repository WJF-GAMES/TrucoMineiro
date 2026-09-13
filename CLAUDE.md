# Truco Mineiro (TrucoX)

App mobile de Truco Mineiro em React Native + Expo (dev-client) com backend 100% Firebase.

## Comandos
```
npm start                 # Metro (dev client). EXPO_PUBLIC_USE_EMULATORS=1 aponta para o Emulator Suite
npm run android           # build + run no device/emulador
npm run check             # lint + typecheck + testes
npm test                  # jest (engine, IA, utils)
npm run test:sim -- 3000  # 9.000 partidas IA x IA (deadlock/loop/estado impossível)
npm run emulators         # auth 9099, functions 5001, firestore 8080, database 9000
./scripts/build-apk.sh    # APK release em dist/ (sem argumento = todas as ABIs; "x86_64" = só emulador)
./scripts/deploy.sh       # deploy de rules, indexes, functions, remote config + seed
./scripts/qa.sh <cmd>     # QA no emulador Android (launch, shot, tap, errors, otp_code)
python scripts/visual-diff.py   # comparações com references/
```

## Regras do projeto
- **`referencia.png` é a fonte de verdade visual.** Recortes individuais em `references/`.
  Assets de UI saem de lá via `scripts/extract-assets.py` — não gerar arte nova sem necessidade.
- **Design System primeiro**: tudo em `src/design-system/`. Nada de cor/tamanho solto nas telas.
- **Ícones só de `src/design-system/icons.ts`** (Ionicons). Emoji nunca é asset.
- **`src/domain/game` é puro**: não pode importar react/react-native/firebase (regra de lint).
  O mesmo domínio roda nas Functions (copiado por `functions/scripts/sync-domain.js` no build).
- **A UI não decide regra**: as ações vêm de `getAvailableActions` / `view.availableActions`.
- **Dados do mockup não são dados reais**: tudo vem de Firestore/RTDB.
- **Cliente nunca é autoridade**: XP, moedas, liga, vitórias e resultado só mudam via Cloud Functions.
- Não commitar sem pedido explícito.

## Estrutura
Ver `docs/architecture.md`. Documentação por tema em `docs/` (firebase, game-engine, multiplayer,
authentication, data-model, security, analytics, testing, design-system, asset-manifest, visual-regression).
