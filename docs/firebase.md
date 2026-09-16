# Firebase — configuração e uso

Projeto: `truco-mineiro-wjf` · RTDB `https://truco-mineiro-wjf-default-rtdb.firebaseio.com` · Storage `gs://truco-mineiro-wjf.firebasestorage.app`.

| Serviço | Onde | Uso |
|---|---|---|
| Authentication | `services/firebase/auth.ts` | Somente telefone (E.164) + OTP. Número de teste: `+5561996289726 / 123456` (configurado no Console; nunca há bypass local). |
| Firestore | `services/firebase/firestore.ts` | Dados persistentes (ver docs/data-model.md). Cliente só lê. |
| Realtime Database | `services/firebase/rtdb.ts` | Presença, matchmaking, salas, sessões, views por assento, conexão. |
| Cloud Functions | `functions/src` | Toda escrita crítica (ver lista em docs/multiplayer.md e docs/security.md). Região `southamerica-east1`. |
| Storage | `storage.rules` | Reservado para upload de avatar (futuro). O SDK cliente (`@react-native-firebase/storage`) não está instalado — adicionar junto com a feature. |
| Cloud Messaging | `services/firebase/messaging.ts` + `registerDevice` | Convites de amigos/salas, recompensas, liga, temporada, novidades. |
| Remote Config | `services/firebase/remoteConfig.ts` + `remoteconfig.template.json` | Flags: maintenance_mode, minimum_supported_version, ai_*_enabled, online_enabled, matchmaking_enabled, friends_enabled, league_enabled, store_enabled, daily_reward_enabled, xp_multiplier, matchmaking_bot_fill_seconds, matchmaking_timeout_seconds. |
| App Check | `services/firebase/appCheck.ts` | Play Integrity / App Attest em produção; Debug Provider em `__DEV__` (`EXPO_PUBLIC_APPCHECK_DEBUG_TOKEN`). Functions exigem token fora do emulador. |
| Analytics | `services/firebase/analytics.ts` | Taxonomia em docs/analytics.md. |
| Crashlytics | `services/firebase/crashlytics.ts` | Contexto permitido: matchId, screen, gameMode, appVersion, state. |
| Performance | `services/firebase/perf.ts` | Traces: app_startup, login_flow, home_load, matchmaking, room_join, match_start, profile_load, match_result. |

## Arquivos nativos
- `google-services.json` (Android) e `GoogleService-Info.plist` (iOS) foram gerados a partir do config fornecido.
  **Pendência**: o `mobilesdk_app_id`/`GOOGLE_APP_ID` são placeholders — registre os apps Android (`com.mooby.trucomineiro`, com SHA-1/SHA-256)
  e iOS no Console e substitua os arquivos pelos baixados. Sem isso, Phone Auth em dispositivo real (Play Integrity/reCAPTCHA) não funciona.
- Nunca há Service Account no app.

## Emuladores
```
npm run emulators                 # auth 9099, functions 5001, firestore 8080, database 9000, storage 9199, UI 4000
EXPO_PUBLIC_USE_EMULATORS=1 npx expo start --dev-client
curl http://127.0.0.1:5001/truco-mineiro-wjf/southamerica-east1/seedCatalog   # seed ligas/conquistas/temporada
```
No emulador de Auth, o código OTP aparece no log do emulador (`http://127.0.0.1:4000/auth`).

## Deploy (requer `firebase login`)
```
firebase deploy --only firestore:rules,database,storage,functions,remoteconfig
```

## Estado do projeto em produção (12/09)

Publicado com `firebase deploy` (CLI autenticada):

| Item | Estado |
|---|---|
| Firestore (default, FIRESTORE_NATIVE) | criado; **rules e índices publicados** |
| Realtime Database rules | publicadas |
| Storage rules | publicadas |
| Cloud Functions | **28 funções ativas** — 26 callables/HTTP em `southamerica-east1` + `onMatchmakingJoin` e `onPresenceWritten` em `us-central1` |
| Remote Config | template publicado (14 parâmetros) |
| Catálogo (leagues, achievements, seasons/current) | semeado via `seedCatalog` |

> Triggers de Realtime Database (Eventarc) ainda **não existem em southamerica-east1** — o deploy falha com
> `cannot create a trigger in region southamerica-east1 (not yet revealed)`. Por isso as duas funções
> disparadas por banco rodam em `us-central1` (`DB_TRIGGER_REGION` em `functions/src/lib/admin.ts`).

O segredo do `seedCatalog` fica em `functions/.env` (`SEED_SECRET`, fora do Git). Para rodar de novo:
```
curl -H "x-seed-secret: <segredo>" https://southamerica-east1-truco-mineiro-wjf.cloudfunctions.net/seedCatalog
```

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
5. (Opcional agora) Habilitar a **Firebase App Check API** e registrar o debug token impresso no logcat.

Enquanto isso, o desenvolvimento usa o **Emulator Suite**: `EXPO_PUBLIC_USE_EMULATORS=1`. Nele o número de teste
do Console **não** vale — o Auth Emulator gera um código próprio, visível em
`http://127.0.0.1:4000/auth` ou via
`curl http://127.0.0.1:9099/emulator/v1/projects/truco-mineiro-wjf/verificationCodes`.
A tela de OTP mostra esse aviso automaticamente quando está em modo emulador.
