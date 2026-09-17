# Autenticação

Único método: **número de telefone** (Firebase Authentication Phone). Sem Google/Apple/Facebook/e-mail/anônimo/magic link.
O backend **não** tem OTP, senha nem sessão própria: a identidade é sempre o Firebase ID Token.

## Fluxo no app
Introdução → Login (país + DDI + telefone, formatado com libphonenumber e convertido para E.164) → `signInWithPhoneNumber`
→ OTP (6 dígitos, autofill SMS, reenvio com contador crescente 45/90/135 s e limite de 3, "Alterar telefone", estados enviando/enviado/inválido/expirado/reenvio/throttling)
→ `confirmation.confirm(code)` → `onAuthStateChanged` → `POST /v1/me/bootstrap` (`bootstrapUser`: cria usuário, perfil e estatísticas se não existem, indexa o telefone verificado, garante a liga e devolve `onboarded`, perfil, convites e partida ativa)
→ Cadastro (apelido 3–16 chars + avatar → `PATCH /v1/me/profile`) → Principal.

- O telefone nunca é chave: o usuário interno tem UUID e o identificador público é o **UID do Firebase**
  (`User.firebaseUid`). O telefone pendente vive só em memória no `authStore` durante o OTP.
- O backend só conhece o telefone pelo claim `phone_number` do token; guarda apenas o HMAC dele
  (`User.phoneHash`, ver docs/security.md).
- Telefone de teste `+5561996289726 / 123456` deve ser cadastrado no Console (Authentication → Sign-in method → Phone numbers for testing). Não existe bypass no código do app.
- Erros mapeados para mensagens humanas em `services/firebase/auth.ts`.
- Sair: `signOut` (Mais → Sair da conta) — antes de sair, `POST /v1/me/devices/remove` desliga o push do aparelho para esta conta.

## ID Token → backend

**REST.** `services/api/client.ts` anexa `Authorization: Bearer <ID Token>` (de `getIdToken()`) e,
quando houver, `x-firebase-appcheck`. No backend o `FirebaseAuthGuard` (`backend/src/auth`) é
**global**: toda rota exige token, exceto as marcadas `@Public()` (health, webhooks, admin — que tem
o próprio `AdminGuard`).

1. `AuthService.extractBearer` lê o cabeçalho (`AUTH_TOKEN_MISSING` se faltar).
2. `FirebaseAdminService.verifyIdToken` valida com o Admin SDK. Resultado válido fica em cache por
   instância (chave = SHA-256 do token) até perto de expirar. Erros: `AUTH_TOKEN_EXPIRED`,
   `AUTH_TOKEN_REVOKED` (revogado ou conta desativada), `AUTH_TOKEN_INVALID`; falha do Firebase vira
   `SERVICE_UNAVAILABLE`.
3. `verifyAppCheck` confere `x-firebase-appcheck` quando `ENFORCE_APP_CHECK=true` (`APP_CHECK_INVALID`).
4. `AuthService.resolve` traduz `firebaseUid` → usuário interno (cache por instância). Sem usuário,
   só rotas `@AllowUnregistered()` passam (`POST /v1/me/bootstrap`, `PATCH /v1/me/profile`); as demais
   respondem `USER_NOT_FOUND`.

Todos os `AUTH_TOKEN_*` e `APP_CHECK_INVALID` respondem **401**.

**Renovação no cliente.** O SDK renova o token sozinho. Se o backend responder 401 com
`AUTH_TOKEN_*`, `request()` pede `getIdToken(true)` e repete a chamada **uma vez** (seguro: nada foi
executado). Outros erros seguem a política normal (repetição só para GET ou POST com
`Idempotency-Key`).

**WebSocket.** `services/api/realtime.ts` manda o token no handshake (`auth: { token, appCheck }`),
calculado a cada (re)conexão; o servidor também aceita `Authorization` no handshake. O gateway
(`backend/src/realtime/realtime.gateway.ts`) valida token + App Check + usuário no middleware do
namespace `/rt` e nunca aceita `userId` vindo do cliente. Falha de autenticação chega em
`connect_error` com `data.code`; `AUTH_TOKEN_EXPIRED`/`INVALID` fazem o cliente forçar a renovação
na próxima tentativa.
- A cada 45 min o app renova o token e envia `session.refresh { token }`; o servidor exige o mesmo
  UID e atualiza a validade do socket.
- Sockets com token vencido há mais de 5 min sem `session.refresh` recebem `session.error`
  (`AUTH_TOKEN_EXPIRED`) e são desconectados; o cliente reconecta com token novo.

## AUTH_MODE=test (só desenvolvimento e testes)
`AUTH_MODE=test` troca a verificação do Firebase por tokens `test:<uid>:<telefone E.164 ou vazio>`,
usados pelos testes de integração, pelo teste de carga e pelo smoke local (`--test-token`).
`loadConfig` (`backend/src/config/env.ts`) **derruba o boot** se `AUTH_MODE=test` ou
`FIREBASE_AUTH_EMULATOR_HOST` estiverem definidos com `NODE_ENV=staging|production`. Nesse modo as
contas "existem" no Auth com o telefone do token (não há consulta real ao Firebase).

## Desenvolvimento com o Auth Emulator
```
npm run emulators                              # só Auth (9099) + UI (4000)
EXPO_PUBLIC_USE_EMULATORS=1 npx expo start --dev-client
```
No backend, `FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099` faz o Admin SDK aceitar os tokens do
emulador (sem credencial). O número de teste do Console **não** vale no emulador: o código aparece em
`http://127.0.0.1:4000/auth` ou em
`curl http://127.0.0.1:9099/emulator/v1/projects/truco-mineiro-wjf/verificationCodes`.

## Exclusão de conta
Configurações → Excluir conta → `DELETE /v1/me` (`deleteAccount`, limite de 3/min). O servidor:
abandona a partida online em andamento, sai das salas que hospeda, solta reservas/trocas pendentes em
partidas, sai do grupo da liga da semana, apaga o usuário (cascata para perfil, estatísticas,
aparelhos, presença, amizades, bloqueios, convites, notificações…) e por fim remove a conta do
Firebase Auth. O histórico das partidas dos outros jogadores é mantido.

**Conta apagada fora do app** (Console do Firebase, suporte): o antigo trigger `onAuthUserDeleted`
foi substituído pelo job `accounts.reconcile` (diário, 04:00 America/Sao_Paulo, com `JobLock`), que
percorre os usuários em lotes, consulta o Auth de 100 em 100 e apaga os dados de quem não existe
mais. Também pode ser disparado por `POST /v1/admin/jobs/accounts.reconcile` ou pelo webhook do
Cloud Scheduler (ver docs/webhooks.md).
