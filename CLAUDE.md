# Truco Mineiro (TrucoX)

App mobile de Truco Mineiro em React Native + Expo (dev-client). Backend próprio em `backend/`
(NestJS + PostgreSQL/Prisma, REST + Socket.IO). Do Firebase ficam só Auth por telefone, FCM,
Analytics, Crashlytics, Remote Config, App Check e AdMob.

## Comandos
```
npm start                 # Metro (dev client). EXPO_PUBLIC_USE_EMULATORS=1 usa o Auth Emulator
npm run android           # build + run no device/emulador
npm run check             # lint + typecheck + testes (app e backend)
npm test                  # jest (engine, IA, utils)
npm run test:sim -- 3000  # 9.000 partidas IA x IA (deadlock/loop/estado impossível)
npm run emulators         # Firebase Auth Emulator (9099)
npm run backend:dev       # backend em http://localhost:3000 (usa backend/.env; Swagger em /docs)
npm --prefix backend run test:integration  # integração no PostgreSQL (backend/.env.test, schema próprio)
npm --prefix backend run prisma:migrate    # aplica migrations (banco local: 127.0.0.1:5432/truco_mineiro_db)
npm --prefix backend run smoke -- --url <api>  # smoke test pós-deploy
./scripts/build-apk.sh    # APK release em dist/ (sem argumento = ARM; "x86_64" = só emulador; "all" = 4 ABIs)
./scripts/deploy.sh       # backend no Cloud Run (migrations + deploy + smoke) e Remote Config — ver docs/deployment.md
npx eas-cli build -p ios --profile development   # dev client para iPhone (EAS; cadastrar o aparelho com `eas device:create`)
npx eas-cli build -p ios --profile production    # build de loja (EXPO_PUBLIC_* de produção vêm das variáveis do EAS)
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
  O mesmo domínio roda no backend (copiado para `backend/src/domain` por `backend/scripts/sync-domain.js`;
  a cópia é versionada — rode `npm --prefix backend run sync-domain` ao mudar o domínio).
- **A UI não decide regra**: as ações vêm de `getAvailableActions` / `view.availableActions`.
- **Dados do mockup não são dados reais**: tudo vem do backend (`src/services/api`).
- **Cliente nunca é autoridade**: XP, liga, vitórias, resultado, timers e IA online só mudam no backend.
- **App fala com o backend só por `src/services/api`** (cliente REST único + socket único). Nada de
  Firestore, Realtime Database ou Cloud Functions — foram removidos.
- **Banco**: segredos só em `backend/.env*` (fora do git). Testes de integração fazem TRUNCATE:
  nunca apontar `TEST_DATABASE_URL` para o schema `public`.
- **Não existe moeda virtual**: nada de moedas, gemas, loja de itens ou recompensa em moeda (monetização só por anúncios).
- Não commitar sem pedido explícito.

## Estrutura
Ver `docs/architecture.md`. Documentação por tema em `docs/` (api, websocket, database, webhooks,
migration, deployment, production-runbook, firebase, game-engine, multiplayer, authentication,
data-model, security, analytics, testing, design-system, asset-manifest, visual-regression, leagues,
ADMOB_MONETIZATION).
