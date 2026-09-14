# Design System — Truco Mineiro

Extraído de `referencia.png` **antes** de qualquer implementação (amostragem de pixels + análise de composição).
Tokens em `src/design-system/` — nenhuma tela usa valores arbitrários fora deles.

## Cores (`colors.ts`)
| Token | Valor | Uso na referência |
|---|---|---|
| bgTop / bgMid / bgBottom | `#00221a` / `#072d27` / `#0b302e` | Gradiente vertical de fundo em todas as telas |
| bgDeep | `#001713` | Bottom Navigation |
| card | `rgba(20,62,59,0.72)` + borda `rgba(120,200,170,0.22)` | Cards "vidro" (Mais, Liga, Perfil, Configurações) |
| input | `rgba(4,21,23,0.85)` | Campos de telefone, apelido, busca |
| primary / primaryBright / primaryDark / primaryDeep | `#05c875` / `#1ee38c` / `#03a25e` / `#006330` | CTA verde (gradiente claro→escuro), chips ativos, tab ativa, barras de progresso |
| gold | `#edbe0f` | "VER TODOS", troféu, valor da mão, ícones de destaque |
| danger | `#f00d17` | Derrotas, badge "Mais popular", "Sair da conta", "Excluir Conta" |
| blue / blueDeep | `#025bb3` / `#023f80` | Card "JOGAR CONTRA A IA" |
| orange / orangeDeep | `#be6824` / `#7a3a12` | Card "JOGAR ONLINE" |
| cream | `#f3e9d6` | Ícones monocromáticos de menus e tabs inativas |
| text / textSecondary / textMuted | `#fff` / `#cfe3dc` / `#8fb1a6` | Títulos / subtítulos / placeholders |

## Tipografia (`typography.ts`)
Fonte: **Nunito** (400–900) — sans geométrica arredondada mais próxima da referência; **Kaushan Script** para a tagline script da Introdução (embutida na arte).
- display 28/34 ExtraBold — "Bem-vindo de volta!", "Quase lá!"
- h1 22/28 ExtraBold — títulos de tela ("Amigos", "Mais", "Loja")
- h2 19/24 ExtraBold — "Escolha como jogar", "Liga Bronze"
- h3 16/21 Bold — títulos de card/lista
- body 14/19 Medium, small 12/16, caption 10.5/14
- button 16 ExtraBold, letterSpacing 0.6, caixa alta
- stat 22 ExtraBold — números dos cards de estatística
- tab 11 SemiBold — labels da Bottom Navigation

## Espaçamento e raio
Grid de 4pt. Padding horizontal de tela 14 (referência ≈ 14px em 300px de largura). Raio de cards/botões/inputs 16/16/14, chips pill.

## Componentes base (`src/components`)
Screen (gradiente), Surface (card vidro), PrimaryButton (gradiente verde + brilho), SecondaryButton, DangerButton, PillButton, IconButton,
GameHeader (variantes `logo` e `title`), BottomNavigation (custom tab bar com indicador superior), MenuItem/MenuGroup/MenuCard,
StatsRow, ProgressBar, Chips (segmented pills), TextField/SearchField/PhoneInput/OtpInput, PlayerAvatar (anel verde + status/badge),
CurrencyBadge, StateView (loading/empty/error/offline), SectionTitle, Sheet (folha inferior com backdrop),
Toast (+ banner "Reconectando...").
Componentes de jogo: PlayingCard (frente nativa / verso vermelho), GameTable, GameModeCard e ActionRow (Jogar).

## Regras
- Ícones somente de `icons.ts` (Ionicons). Nada de emoji como asset.
- Dados do mockup (João da Serra, 124 partidas…) nunca são hardcoded: vêm de Firestore/RTDB.
- Responsividade por Flexbox + SafeArea + aspectRatio; nada de coordenadas absolutas para a interface inteira.
