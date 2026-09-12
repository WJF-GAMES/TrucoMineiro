# Autenticação

Único método: **número de telefone** (Firebase Authentication Phone). Sem Google/Apple/Facebook/e-mail/anônimo/magic link.

Fluxo: Introdução → Login (país + DDI + telefone, formatado com libphonenumber e convertido para E.164) → `signInWithPhoneNumber`
→ OTP (6 dígitos, autofill SMS, reenvio com contador crescente 45/90/135 s e limite de 3, "Alterar telefone", estados enviando/enviado/inválido/expirado/reenvio/throttling)
→ `confirmation.confirm(code)` → `onAuthStateChanged` → `bootstrapUser` (cria users/profiles/playerStats se não existem, devolve `onboarded`)
→ Cadastro (apelido 3–16 chars + avatar → `updateProfile`) → Principal.

- O telefone nunca é persistido como chave: os documentos usam o **UID**. O telefone pendente vive só em memória no `authStore` durante o OTP.
- Telefone de teste `+5561996289726 / 123456` deve ser cadastrado no Console (Authentication → Sign-in method → Phone numbers for testing). Não existe bypass no código.
- Erros mapeados para mensagens humanas em `services/firebase/auth.ts`.
- Sair: `signOut` (Mais → Sair da conta). Excluir conta: `deleteAccount` (Configurações) apaga documentos, presença e a conta.
