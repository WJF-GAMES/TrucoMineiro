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
| friend_request_sent | Amigos | — |

Nunca enviar telefone ou OTP. `setUserId(uid)` após login; `setUserId(null)` ao sair.
