# Firebase — configuração e uso

Projeto: `truco-mineiro-wjf`.

Desde a migração para o backend NestJS (docs/migration.md), o Firebase **não guarda dados de domínio
nem executa regra de jogo**. Ele continua responsável por identidade, push, telemetria, flags,
anúncios e atestado do app. Perfis, amigos, salas, partidas, ligas e presença estão no PostgreSQL
(docs/data-model.md).

## O que continua em uso

| Serviço | Onde | Uso |
|---|---|---|
| Authentication | `services/firebase/auth.ts` (app) · `backend/src/firebase/firebase-admin.service.ts` | Somente telefone (E.164) + OTP. O app manda o ID Token ao backend (`Authorization: Bearer`), que verifica com o Admin SDK. O backend também consulta contas (`getUsers`, telefone verificado na agenda e reconciliação) e apaga a conta na exclusão. Número de teste: `+5561996289726 / 123456` (configurado no Console; nunca há bypass no app). Ver docs/authentication.md. |
| Cloud Messaging | `services/firebase/messaging.ts` (token do aparelho → `POST /v1/me/devices`) · `backend/src/notifications/push.service.ts` | Só o backend envia push (Admin SDK): convites de sala, amizade, liga. Tokens recusados pelo FCM são apagados de `UserDevice`. |
| App Check | `services/firebase/appCheck.ts` | Play Integrity / App Attest em produção; Debug Provider em `__DEV__` (`EXPO_PUBLIC_APPCHECK_DEBUG_TOKEN`). O token vai no cabeçalho `x-firebase-appcheck` (REST) e em `auth.appCheck` (WebSocket); o backend exige quando `ENFORCE_APP_CHECK=true`. |
| Remote Config | `services/firebase/remoteConfig.ts` + `remoteconfig.template.json` | Sem mudança. Flags do jogo: maintenance_mode, minimum_supported_version, ai_easy/normal/hard_enabled, online_enabled, matchmaking_enabled, friends_enabled, league_enabled, xp_multiplier, matchmaking_bot_fill_seconds, matchmaking_timeout_seconds; e as de anúncios (`ads_enabled`, `interstitial_*`, `rewarded_*`, `native_*`, `app_open_*` — ver docs/ADMOB_MONETIZATION.md). |
| Analytics | `services/firebase/analytics.ts` | Sem mudança. Taxonomia em docs/analytics.md. |
| Crashlytics | `services/firebase/crashlytics.ts` | Sem mudança. Contexto permitido: matchId, screen, gameMode, appVersion, state. |
| Performance | `services/firebase/perf.ts` | Traces: app_startup, login_flow, home_load, matchmaking, room_join, match_start, profile_load, match_result. |
| AdMob | `src/ads` (Google Mobile Ads) | Sem mudança (docs/ADMOB_MONETIZATION.md). |

Pacotes nativos no app: `@react-native-firebase/{app, auth, app-check, messaging, analytics,
crashlytics, perf, remote-config}`.

## O que foi removido

| Antes | Agora |
|---|---|
| Cloud Functions (`functions/`, callables, triggers de RTDB/Auth, agendadas) | Backend NestJS: REST `/v1`, WebSocket `/rt`, jobs (`backend/src/jobs`) e webhooks. `seedCatalog`/`leagueAdmin`/`diagnostics` viraram `/v1/admin/*`. O trigger `onAuthUserDeleted` virou o job `accounts.reconcile`. |
| Firestore | PostgreSQL. `firestore.rules` nega tudo; `firestore.indexes.json` foi apagado. |
| Realtime Database (presença, salas, sessões, views por assento, convites) | PostgreSQL + Socket.IO. `database.rules.json` nega tudo. |
| `@react-native-firebase/firestore`, `database`, `functions` | Removidos do app; a CI falha se voltarem (ou se `httpsCallable` reaparecer). No lugar: `socket.io-client` e `src/services/api`. |

As Cloud Functions antigas e os dados do Firestore/RTDB só são apagados no Console depois do período
de rollback (docs/production-runbook.md).

## Storage
Não é usado. Nenhum código do app nem do backend fala com o Cloud Storage: o SDK
`@react-native-firebase/storage` não está instalado e o backend não usa `firebase-admin/storage`
(as ocorrências de "storage" em `src/` são armazenamento local com AsyncStorage — configurações,
cache de contatos, convite pendente e frequência de anúncios; no backend, só `AsyncLocalStorage` do
Node para o contexto da requisição). `storage.rules` continua no repositório
com *deny by default* e uma exceção reservada para um futuro upload de avatar (`avatars/{uid}/…`,
só o dono, imagem até 2 MB); essa exceção não é usada por nenhuma tela.

## Regras (deny-all)
`firestore.rules` e `database.rules.json` negam **qualquer** leitura e escrita. Elas só são
publicadas na virada para o backend novo, junto com a versão do app que não usa mais esses bancos:
```
ENVIRONMENT=production ./scripts/deploy.sh --confirm-production --lockdown-firebase-rules
# (equivale a: firebase deploy --only firestore:rules,database)
```
Publicar antes da virada quebra as versões antigas do app ainda instaladas — ver
docs/production-runbook.md.

## Arquivos nativos
- `google-services.json` (Android) e `GoogleService-Info.plist` (iOS) foram gerados a partir do config fornecido.
  **Pendência**: o `mobilesdk_app_id`/`GOOGLE_APP_ID` são placeholders — registre os apps Android (`com.mooby.trucomineiro`, com SHA-1/SHA-256)
  e iOS no Console e substitua os arquivos pelos baixados. Sem isso, Phone Auth em dispositivo real (Play Integrity/reCAPTCHA) não funciona.
- Nunca há Service Account no app. O backend usa a identidade do serviço no Cloud Run
  (`FIREBASE_SERVICE_ACCOUNT_JSON` só fora dele, vindo do ambiente — nunca do repositório).

## Emuladores
Só o **Auth Emulator** (`firebase.json`: `auth` 9099 + UI 4000, `singleProjectMode`).
```
npm run emulators                                    # firebase emulators:start --only auth
EXPO_PUBLIC_USE_EMULATORS=1 npx expo start --dev-client
npm run backend:dev                                  # backend com FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 no backend/.env
npm --prefix backend run seed                        # ligas + conquistas no banco local
```
No emulador de Auth, o código OTP aparece em `http://127.0.0.1:4000/auth` ou em
`curl http://127.0.0.1:9099/emulator/v1/projects/truco-mineiro-wjf/verificationCodes`. A tela de OTP
mostra esse aviso automaticamente quando está em modo emulador. O número de teste do Console **não**
vale no emulador. `FIREBASE_AUTH_EMULATOR_HOST` é proibido em staging/produção (o backend não sobe).

## Deploy
`scripts/deploy.sh` publica o backend no Cloud Run e o template do Remote Config
(`firebase deploy --only remoteconfig`, requer `firebase login`); regras só com
`--lockdown-firebase-rules`. Passo a passo em docs/deployment.md.

## Pendências no Console (bloqueio externo — exigem acesso do dono do projeto)

Reproduzido no emulador Android em 12/09 com o `google-services.json` do projeto:

```
E FirebaseAuth: SMS verification code request failed: unknown status code: 17006
D FirebaseAuth: ... error - This operation is not allowed. This may be because the given
                sign-in provider is disabled for this Firebase project.
E zza: Failed to initialize reCAPTCHA config: No Recaptcha Enterprise siteKey configured
W LocalRequestInterceptor: Error getting App Check token ... 403 Firebase App Check API has not been used
```

Para o login por telefone funcionar em produção (inclusive com o número de teste):

1. ~~Authentication → Sign-in method → Phone: habilitar~~ — **feito**. O erro mudou para o item 1b.
1b. **Authentication → Settings → SMS region policy: permitir o Brasil (+55).** Esse é o bloqueio atual:
   `SMS unable to be sent until this region enabled by the app developer` (status 17006). A política de
   região é avaliada **antes** da lista de números de teste, então nem o `+55 61 99628-9726 / 123456` passa.
2. **Project settings → Your apps → Android (`com.mooby.trucomineiro`) → adicionar impressões digitais SHA**
   (sem elas o Play Integrity/reCAPTCHA não valida o app; o `google-services.json` atual está com `oauth_client: []`):
   - **O keystore de release é `F:/WJF_GAMES/KeyAndroid/key_android`, alias `wjf_games`**, declarado em
     `android/keystore.properties` (não versionado — ver `docs/security.md`). Conferir sempre pelo APK,
     nunca pelo keystore presumido:
     ```
     "$ANDROID_HOME/build-tools/37.0.0/apksigner.bat" verify --print-certs dist/truco-mineiro-1.1.0.apk
     ```
     - SHA-1: `38:AC:65:55:E1:2F:76:05:1E:57:53:76:DF:5A:23:28:A3:0B:DE:9D`
     - SHA-256: `A2:F3:B2:31:3B:74:4F:FB:20:C9:10:77:18:2A:C2:61:6C:96:77:8C:54:0F:31:83:4A:2D:9D:15:E9:F9:FD:72`
   - se o AAB for publicado com **Play App Signing**, esse par acima é o da *upload key*; o SHA-1 da chave
     de assinatura gerada pelo Google (Play Console → Configuração → Integridade do app) também precisa
     ser cadastrado aqui, senão o Phone Auth quebra nas instalações vindas da loja.
3. Baixar de novo o `google-services.json` depois de adicionar os SHA e substituir o da raiz.
4. **Authentication → Sign-in method → Phone numbers for testing**: confirmar `+55 61 99628-9726 → 123456`.
5. Habilitar a **Firebase App Check API** e registrar o debug token impresso no logcat — necessário
   antes de subir o backend com `ENFORCE_APP_CHECK=true` (padrão do `deploy.sh`).
