# Segurança

## Princípios
- Cliente **nunca** altera XP, vitórias, derrotas, liga, ranking, recompensas, moedas ou resultado. Somente Functions (Admin SDK).
- Regras **deny by default** em Firestore (`firestore.rules`), RTDB (`database.rules.json`) e Storage (`storage.rules`).
- Functions críticas (`authedCallable`) validam: Authentication, App Check (fora do emulador), payload (validadores explícitos), ownership (uid vs. assento/sala/solicitação), estado (`status`, `phase`, `availableActions`) e concorrência (transações Firestore/RTDB).

## Idempotência
| Operação | Mecanismo |
|---|---|
| finalizeMatch / progressão online | `matchHistory/{matchId}` criado na mesma transação que atualiza perfil/stats — segunda chamada devolve `alreadyProcessed` |
| claimReward | `rewards/{uid}_{rewardId}` |
| purchaseItem | `ownedItems` verificado dentro da transação |
| submitGameAction | `appliedActionIds[clientActionId]` no state da sessão |
| joinRoom / startMatch | transação RTDB; já-membro / já-iniciada retornam o mesmo resultado |

## Anti-trapaça no modo IA
O cliente envia `seed`, `aiSeed`, `difficulty` e a lista de ações. O servidor re-executa a partida com o mesmo engine e exige que cada ação de IA seja
idêntica à decisão determinística da IA — qualquer divergência ou ação humana inválida rejeita a partida.

## Dados sensíveis
- Analytics e Crashlytics nunca recebem telefone, OTP, tokens ou credenciais.
- Service Account não existe no app; `google-services.json` contém apenas chaves públicas do cliente.

## App Check — estado atual

O enforcement é **controlado por `ENFORCE_APP_CHECK`** (`functions/.env`, hoje `false`) e lido em
`functions/src/lib/admin.ts`. Motivo: com `enforceAppCheck: true` antes do App Check estar configurado
no projeto, **todas as callables rejeitam o cliente**:

```
Failed to validate AppCheck token. FirebaseAppCheckError: Decoding App Check token failed.
{"verifications":{"app":"INVALID","auth":"VALID"},"message":"Callable request verification failed"}
```

Isso aconteceu no primeiro deploy: o login funcionava, mas `bootstrapUser`/`updateProfile` eram
recusados e nenhum perfil era criado (Firestore ficava vazio). Com a flag desligada o log passa a
dizer `Allowing request with invalid AppCheck token because enforcement is disabled` e tudo funciona.

Para ligar (recomendado antes de publicar nas lojas):
1. Console → App Check → habilitar a API e registrar o app Android com **Play Integrity** (exige os SHA).
2. Registrar o debug token (impresso no logcat) para os builds de desenvolvimento.
3. `ENFORCE_APP_CHECK=true` em `functions/.env` e redeploy das functions.

## Diagnóstico

`diagnostics` (HTTP, mesmo `SEED_SECRET` do `seedCatalog`) devolve a contagem de `profiles`, `users`,
`playerStats`, `leagues` e `seasons` e os primeiros perfis — serve para conferir, de fora do app, se as
Functions realmente escreveram:
```
curl -H "x-seed-secret: <segredo>" https://southamerica-east1-truco-mineiro-wjf.cloudfunctions.net/diagnostics
```

## Assinatura do APK

`android/app/build.gradle` usa `signingConfig signingConfigs.debug` também na variante `release`, e esse
config aponta para **`android/app/debug.keystore`** (o keystore genérico do template Expo, o mesmo em
qualquer projeto criado por ele). Impressões atuais:

| | |
|---|---|
| SHA-1 | `5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25` |
| SHA-256 | `FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C` |

**Isso não pode ir para a loja**: como o keystore é público, qualquer um consegue assinar um APK com a
mesma identidade e passar pela verificação de impressão digital do Firebase (Phone Auth, App Check).
Antes de publicar, gerar um keystore próprio, guardá-lo fora do Git, apontar `signingConfigs.release`
para ele e registrar o novo SHA-1/SHA-256 no Console.

Para conferir a assinatura real de um APK (fonte de verdade — não presuma o keystore):
```
"$ANDROID_HOME/build-tools/36.1.0/apksigner.bat" verify --print-certs dist/truco-mineiro-1.0.0.apk
```

## Pendências
- Registrar no Console o SHA-1/SHA-256 acima (necessário para Phone Auth fora do emulador).
- Criar o keystore de release próprio e registrar o SHA dele antes da publicação.
- Ligar o App Check (passos acima) antes da publicação.
