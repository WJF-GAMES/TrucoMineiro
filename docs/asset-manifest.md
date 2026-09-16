# Asset Manifest — Truco Mineiro / TrucoX

Fonte oficial de verdade visual: `referencia.png` (mosaico 1536×1024 com 10 telas).
As referências individuais ficam em `references/` (recortes 3× via LANCZOS) e os assets de UI em `assets/images/`.

Todos os assets abaixo foram **extraídos de `referencia.png`** pelo script `scripts/extract-assets.py`
(coordenadas fixas no mosaico), portanto os personagens são exatamente os mesmos em todas as telas.
Nenhum foi gerado pelo ChatGPT nesta rodada (acesso à conversa exige login humano — ver "Pendências").

| Nome | Caminho | Tipo | Tela(s) | Finalidade | Origem | Já existia | Criado | ChatGPT | Proporção |
|---|---|---|---|---|---|---|---|---|---|
| logo | assets/images/hero/logo.webp | WebP (alpha) | Cadastro, OTP, Jogar, Liga, Principal, Splash | Logotipo "TRUCO MINEIRO" para fundos escuros | recorte referência (Cadastro) + chroma-key do fundo | não | sim | não | 333×150 (~2.2:1) |
| intro_hero | assets/images/hero/intro_hero.webp | WebP | Introdução | Arte principal: logo + personagem João + paisagem + tagline script | recorte referência (Introdução) | não | sim | não | 900×1014 |
| login_header | assets/images/hero/login_header.webp | WebP | Login | Logo + vilarejo mineiro (topo) | recorte referência (Login) | não | sim | não | 873×354 |
| mode_ia | assets/images/cards/mode_ia.webp | WebP | Jogar, Principal, Contra a IA | Ilustração do card "JOGAR CONTRA A IA" | recorte referência (Jogar) | não | sim | não | 396×360 |
| mode_online | assets/images/cards/mode_online.webp | WebP | Jogar, Principal, Jogar Online | Ilustração do card "JOGAR ONLINE" | recorte referência (Jogar) | não | sim | não | 384×360 |
| amigos_turma | assets/images/banners/amigos_turma.webp | WebP | Amigos, Principal | Banner "Jogue com seus amigos" | recorte referência (Amigos) | não | sim | não | 393×228 |
| temporada_minas | assets/images/banners/temporada_minas.webp | WebP | Liga, Principal | Banner promocional "Temporada Minas Gerais" (arte com texto embutido, sem áreas clicáveis internas) | recorte referência (Liga) | não | sim | não | 831×273 (~3:1) |
| shield_bronze | assets/images/icons/shield_bronze.webp | WebP (alpha) | Liga, Perfil, Principal | Escudo Liga Bronze | recorte referência (Liga) | não | sim | não | 183×216 |
| shield_silver | assets/images/icons/shield_silver.webp | WebP (alpha) | Liga (próxima liga) | Escudo Liga Prata | recorte referência (Liga) | não | sim | não | 150×138 |
<!-- Avatares: 360×360 (3× o maior uso, 112 dp). Ver "Formato e tamanho final" abaixo. -->
| avatar joao | assets/images/avatars/joao.webp | WebP (alpha, circular) | Cadastro, Perfil, Header, Loja, Mesa | Personagem principal (João da Serra) | recorte referência (Perfil) | não | sim | não | 360×360 |
| avatar maria | assets/images/avatars/maria.webp | WebP (alpha, circular) | Cadastro, Amigos, Loja, Mesa | Maria Souza | recorte referência (Cadastro) | não | sim | não | 360×360 |
| avatar cachorro | assets/images/avatars/cachorro.webp | WebP (alpha, circular) | Cadastro, Loja, Mesa | Caramelo | recorte referência (Cadastro) | não | sim | não | 360×360 |
| avatar galo | assets/images/avatars/galo.webp | WebP (alpha, circular) | Cadastro, Mesa | Galo Carijó | recorte referência (Cadastro) | não | sim | não | 360×360 |
| avatar seu_ze | assets/images/avatars/seu_ze.webp | WebP (alpha, circular) | Cadastro, Mesa | Seu Zé | recorte referência (Cadastro) | não | sim | não | 360×360 |
| avatar seu_antonio | assets/images/avatars/seu_antonio.webp | WebP (alpha, circular) | Cadastro, Mesa | Seu Antônio | recorte referência (Cadastro) | não | sim | não | 360×360 |
| avatar tiao | assets/images/avatars/tiao.webp | WebP (alpha, circular) | Loja, Mesa | Tião (óculos escuros) | recorte referência (Loja) | não | sim | não | 360×360 |
| intro hero | assets/images/hero/intro_hero.webp | WebP | Introdução | Logo + personagem + mesa (a faixa de benefícios é UI) | recorte de `references/introducao.png` via `scripts/extract-screen-assets.py` | sim | sim | não | 1419×1683 |
| login header | assets/images/hero/login_header.webp | WebP | Login | Paisagem mineira + logo + slogan | recorte de `references/login.png` (idem) | sim | sim | não | 1396×948 |
| login footer | assets/images/hero/login_footer.webp | WebP | Login | Vegetação do rodapé (a frase é UI, apagada do recorte) | recorte de `references/login.png` (idem) | não | sim | não | 1396×464 |
| otp top | assets/images/hero/otp_top.webp | WebP (alpha na base) | OTP | Paisagem noturna + lampião + placa | recorte de `references/otp.png` via `scripts/extract-screen-assets.py` | não | sim | não | 1396×780 |
| otp bottom | assets/images/hero/otp_bottom.webp | WebP | OTP | Vegetação + mesa de truco | recorte de `references/otp.png` (idem) | não | sim | não | 1396×674 |
| app icon (iOS) | assets/icon.png | PNG (opaco, sem alpha) | Launcher iOS / App Store | Ícone do app sangrando até a borda (o iOS aplica o squircle) | `references/app-icon.png` via `scripts/generate-app-icons.py` | não | sim | não | 1024×1024 |
| adaptive foreground | assets/android-icon-foreground.png | PNG (alpha) | Launcher Android | Badge reduzido a 52,7% do canvas para caber inteiro até na máscara circular | idem | não | sim | não | 1024×1024 |
| adaptive background | assets/android-icon-background.png | PNG | Launcher Android | Campo verde full-bleed (degradê radial do tabuleiro) | idem | não | sim | não | 1024×1024 |
| adaptive monochrome | assets/android-icon-monochrome.png | PNG (alpha) | Themed icon (Android 13+) | Silhueta chapéu + cartas + espada | idem | não | sim | não | 1024×1024 |
| favicon | assets/favicon.png | PNG | Web | Favicon derivado do ícone iOS | idem | sim | sim | não | 48×48 |
| splash | assets/splash-icon.png | PNG (alpha) | Splash | Arte do ícone sobre `#00221a` | arte anterior (não regenerada) | sim | não | não | 1024×1024 |

## Formato e tamanho final (APK)
Tudo que o Metro empacota (`assets/images/**`) é **WebP**, gerado por `python scripts/optimize-assets.py`:
os scripts de extração gravam PNG, e o otimizador redimensiona para o maior tamanho exibido
(~3,5× de densidade) e converte (WebP com perdas q92–q95, alpha sempre sem perdas; fica com o
lossless quando ele sai menor). Sem `--apply` o script só gera o relatório. Os PNGs mestres ficam
no histórico do git.

| Grupo | Largura final | Qualidade |
|---|---|---|
| Heros de tela cheia (intro, login, OTP) | até 1440 px (sem ampliar) | q92 |
| `temporada_minas` (texto embutido) | 1440×480 | q95 |
| `logo` | 1024 px | q95 |
| Cards de modo | 1254 px | q92 |
| `amigos_turma` | 1024 px | q92 |
| Avatares | 360 px | q95 |
| Brasões de liga | 512 px (maior uso: 96×106 dp) | q95 |

Ícone do app, adaptive icon e splash (`assets/*.png`) continuam PNG: são entradas do `expo prebuild`.

## Ícones de interface
Família única: **Ionicons** (via `@expo/vector-icons`), mapeada em `src/design-system/icons.ts`.
Exceção: glifo de cartas da tab "Jogar" (`cards` / `cards-outline` do MaterialCommunityIcons), pois
Ionicons não possui. Para não empacotar a fonte inteira do MCI (1,3 MB), o app usa um subconjunto
com só esses dois glifos: `assets/fonts/mci-cards.ttf` (`CardsIcon` em `src/design-system/icons.ts`).
Naipes das cartas na mesa são caracteres tipográficos (♠ ♥ ♦ ♣), não emojis.

## Pendências de asset (requerem ChatGPT/login humano ou arte original)
1. **Splash** — `assets/splash-icon.png` ainda é a arte antiga do ícone. O ícone do app já vem de
   `references/app-icon.png` (rodar `python scripts/generate-app-icons.py` após trocar a arte-mestra).
2. **Versões em alta resolução** de todos os recortes acima (a referência tem ~300 px por tela; os recortes foram ampliados 3×). Pedir ao ChatGPT "mesmo personagem/paleta, 3× maior".
3. **Tela Principal** — não existe na referência; a implementação (`references/principal.png`, screenshot da tela construída) segue o Design System das demais telas.
4. **Tela OTP** — idem; construída com os mesmos componentes do Login/Cadastro.
5. **Escudos Ouro e Diamante** — reutilizam bronze/prata até haver arte própria.
6. **Verso de carta** — renderizado nativamente (gradiente vermelho + moldura creme); uma arte ornamentada em PNG pode substituir.
