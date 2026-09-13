# Analytics

`services/firebase/analytics.ts` — `logEvent(name, params)` com nomes tipados. Screen views automáticos via `NavigationContainer.onStateChange`.

| Evento | Quando | Params |
|---|---|---|
| app_open | bootstrap | — |
| intro_viewed | Introdução montada | — |
| phone_login_started | Login montado | — |
| otp_sent | SMS enviado / reenviado | resend |
| login_completed | OTP confirmado | — |
| profile_created | Cadastro concluído | avatar |
| home_viewed | Principal montada | — |
| play_clicked | card/CTA de jogar | source, mode |
| ai_selected | Iniciar partida IA | difficulty |
| online_selected | Jogo rápido / criar sala | entry |
| matchmaking_started / matchmaking_cancelled | fila | seconds |
| room_created / room_joined | salas | source / via |
| match_started | mesa aberta | mode, difficulty, source |
| card_played | carta jogada | mode |
| truco_requested / truco_accepted / truco_rejected | apostas | mode |
| match_completed / match_won / match_lost | resultado | mode, difficulty, won |
| rematch_clicked | "Jogar novamente" | mode |
| store_viewed | Loja | tab |
| reward_claimed | recompensa diária | coins |
| friends_screen_viewed | abertura da aba Amigos | — |
| friends_search_used | busca por apelido | — |
| friend_request_sent / friend_request_accepted | Amigos | source? |
| friend_request_declined / friend_request_cancelled | Solicitações | — |
| friend_profile_viewed | ficha do amigo (folha) | — |
| friend_removed / friend_blocked / friend_unblocked | ficha do amigo e folha de bloqueados | — |
| room_invite_sent | "Jogar" com um amigo (sala + convite) | — |
| room_invite_received / room_invite_accepted / room_invite_declined | convite de sala recebido | — |
| friend_invite_shared / contact_invite_shared | share sheet | source |
| friend_qr_opened | Meu QR Code | — |
| contacts_sync_started | toque em "Sincronizar contatos" | — |
| contacts_permission_granted / contacts_permission_denied | diálogo do sistema | state (no denied) |
| contacts_sync_completed | fim da sincronização | contacts, matches |
| contacts_sync_failed | erro na sincronização | reason |
| contact_match_found | alguém da agenda já joga | count |

Nunca enviar telefone ou OTP. `setUserId(uid)` após login; `setUserId(null)` ao sair.

Os eventos de contatos mandam **apenas contagens** (`contacts`, `matches`, `count`) e o tipo do erro
(`reason`): nenhum telefone, hash ou nome da agenda. O mesmo vale para o Crashlytics, que recebe só
o nome do erro (`contacts_sync_<tipo>`).
