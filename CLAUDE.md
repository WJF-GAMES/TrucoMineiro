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
./scripts/build-apk.sh    # APK release em dist/ (sem argumento = ARM; "x86_64" = só emulador; "all" = 4 ABIs)
./scripts/deploy.sh       # deploy de rules, indexes, functions, remote config + seed
./scripts/qa.sh <cmd>     # QA no emulador Android (launch, shot, tap, errors, otp_code)
./scripts/qa-record.sh <nome> <s> [x y]  # grava a tela e gera folha de contato dos quadros
./scripts/qa-autoplay.sh  # joga uma partida contra a IA no automático até MATCH_ENDED
python scripts/visual-diff.py   # comparações com references/
python scripts/optimize-assets.py [--apply]  # PNG de assets/images -> WebP no tamanho de uso (relatório sem --apply)
python scripts/generate-app-icons.py     # ícones iOS/Android a partir de references/app-icon.png
python scripts/extract-screen-assets.py  # artes das telas a partir dos prints em references/
npx expo start --port 8081               # http://localhost:8081 abre a build web (inspeção rápida de tela)
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
- **Cliente nunca é autoridade**: XP, liga, vitórias e resultado só mudam via Cloud Functions.
- **Não existe moeda virtual**: nada de moedas, gemas, loja de itens ou recompensa em moeda (monetização só por anúncios).
- Não commitar sem pedido explícito.

## Estrutura
Ver `docs/architecture.md`. Documentação por tema em `docs/` (firebase, game-engine, multiplayer,
authentication, data-model, security, analytics, testing, design-system, asset-manifest,
visual-regression, leagues, ADMOB_MONETIZATION).
