# Segurança

## Princípios
- Cliente **nunca** altera XP, vitórias, derrotas, liga, ranking, recompensas ou resultado. Somente Functions (Admin SDK).
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
- A agenda do aparelho nunca sai dele: nome, e-mail e foto dos contatos ficam locais.

## Busca de contatos — anti-enumeração

`matchPhoneContacts` é o único caminho para descobrir se um telefone tem conta, e é desenhado para
**não** virar um oráculo de "esse número usa o app?":

| Camada | O quê |
|---|---|
| Autenticação | `authedCallable` — sem login não há chamada |
| App Check | mesma flag `ENFORCE_APP_CHECK` das demais callables |
| Formato | só E.164 (`/^\+[1-9]\d{6,14}$/`); qualquer outra coisa é rejeitada antes de tocar o banco |
| Lote | máximo 200 números por chamada |
| Cota diária | 40 chamadas **e** 3.000 números por usuário (`contactSync/{uid}`, transação) |
| Resposta | devolve o *índice* do número na lista enviada, nunca o número; só apelido, avatar e nível |
| Bloqueio | quem bloqueou e quem foi bloqueado somem do resultado, nos dois sentidos |
| Perfil incompleto | quem não terminou o cadastro não aparece |

O diretório (`phoneIndex/{hmac}`) guarda **apenas** `HMAC-SHA256(CONTACTS_PEPPER, e164)`. O pepper
fica em `functions/.env` e nunca é enviado ao app — por isso o app manda o número em claro (sobre TLS)
e o servidor hasheia. A alternativa "hashear no cliente" exigiria um salt dentro do APK, que qualquer
um extrai para montar um dicionário offline de todos os telefones do Brasil; aqui, sem o pepper, o
`phoneIndex` vazado não reverte para número nenhum. Trocar `CONTACTS_PEPPER` invalida o diretório
inteiro — cada usuário volta a ser indexado no próximo `bootstrapUser`.

O índice é gravado a partir de `auth.getUser(uid).phoneNumber` (registro do Firebase Auth), **nunca**
de um payload do cliente: ninguém se cadastra no diretório com o telefone de outra pessoa.

Não existe busca livre por telefone na UI (só por apelido): um campo de número seria exatamente
o endpoint de enumeração que essas camadas evitam.

### Bloqueio
`blocks/{uid}/blocked/{alvo}` é legível pelo dono. O espelho `blockedBy/{alvo}/users/{uid}` é
**ilegível por regra** para todos — saber que foi bloqueado é justamente o que o bloqueio evita —
e existe para o match resolver "quem me bloqueou" com uma leitura, em vez de uma por contato.

### Convite por QR
`friendInviteTokens/{token}` guarda um token opaco de 22 caracteres com validade de 30 dias. O QR
carrega `trucomineiro://add-friend?token=...` — sem telefone e sem o uid interno — e o link só vira
solicitação depois de o usuário confirmar o diálogo no app (link é conteúdo externo, nunca ação
automática).

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

`android/app/build.gradle` lê as credenciais de **`android/keystore.properties`** e, quando o arquivo
existe, assina a variante `release` com o keystore de produção. Sem o arquivo, o `release` cai no
`android/app/debug.keystore` do template Expo — build local descartável, nunca para a loja.

Keystore de produção: `F:/WJF_GAMES/KeyAndroid/key_android`, alias `wjf_games`, RSA 2048 / SHA256withRSA,
`CN=William Fernandes, O=WJF SOFTWARE DEVELOPMENT LTDA - ME`. Impressões atuais:

| | |
|---|---|
| SHA-1 | `38:AC:65:55:E1:2F:76:05:1E:57:53:76:DF:5A:23:28:A3:0B:DE:9D` |
| SHA-256 | `A2:F3:B2:31:3B:74:4F:FB:20:C9:10:77:18:2A:C2:61:6C:96:77:8C:54:0F:31:83:4A:2D:9D:15:E9:F9:FD:72` |

**O keystore e o `keystore.properties` ficam fora do Git** (`/android` é gerado pelo prebuild e está no
`.gitignore`; o keystore mora fora do repositório). Consequências operacionais:

- `expo prebuild --clean` apaga `android/keystore.properties` — recriar antes do próximo build de release.
- Perder `key_android` ou a senha significa perder a capacidade de publicar atualizações do app na Play
  Store sob o mesmo `applicationId`. Manter backup offline do arquivo e da senha.
- Publicando com **Play App Signing**, essa chave vira a *upload key* e o Google passa a assinar o que é
  entregue ao usuário — nesse caso o SHA-1 da chave do Google também vai para o Firebase Console.

Para conferir a assinatura real de um APK (fonte de verdade — não presuma o keystore):
```
"$ANDROID_HOME/build-tools/37.0.0/apksigner.bat" verify --print-certs dist/truco-mineiro-1.1.0.apk
keytool -printcert -jarfile dist/truco-mineiro-1.1.0.aab
```

## Pendências
- Registrar no Console o SHA-1/SHA-256 acima (necessário para Phone Auth fora do emulador) e baixar
  de novo o `google-services.json` — o atual ainda está com `oauth_client: []`.
- Ligar o App Check (passos acima) antes da publicação.

## Cartas escondidas (mãos e carta virada)

- O estado completo da partida (`gameSessions/{id}/state`) é ilegível para clientes (regra RTDB
  `.read: false`); cada assento lê só a própria view.
- A view de cada assento leva apenas as próprias cartas (`myCards`) e contagens das outras mãos.
- **Carta virada**: a identidade só aparece na view e nos eventos de quem a jogou. `buildViews`
  monta um lote de `recentEvents` por assento com `eventsForSeat`, e `viewForSeat` projeta a mesa
  com `playForSeat` — não basta esconder na UI: o payload dos outros assentos vem com `card: null`
  (coberto por `functions/test/rtdbState.test.ts` e `src/domain/game/__tests__/covered.test.ts`).
- As mãos só são mostradas a todos quando a mão de onze é recusada (`HAND_REVEALED`), depois de a
  mão estar decidida.
