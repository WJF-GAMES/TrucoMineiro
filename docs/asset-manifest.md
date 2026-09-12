# Asset Manifest — Truco Mineiro / TrucoX

Fonte oficial de verdade visual: `referencia.png` (mosaico 1536×1024 com 10 telas).
As referências individuais ficam em `references/` (recortes 3× via LANCZOS) e os assets de UI em `assets/images/`.

Todos os assets abaixo foram **extraídos de `referencia.png`** pelo script `scripts/extract-assets.py`
(coordenadas fixas no mosaico), portanto os personagens são exatamente os mesmos em todas as telas.
Nenhum foi gerado pelo ChatGPT nesta rodada (acesso à conversa exige login humano — ver "Pendências").

| Nome | Caminho | Tipo | Tela(s) | Finalidade | Origem | Já existia | Criado | ChatGPT | Proporção |
|---|---|---|---|---|---|---|---|---|---|
| logo | assets/images/hero/logo.png | PNG (alpha) | Cadastro, OTP, Jogar, Liga, Principal, Splash | Logotipo "TRUCO MINEIRO" para fundos escuros | recorte referência (Cadastro) + chroma-key do fundo | não | sim | não | 333×150 (~2.2:1) |
| intro_hero | assets/images/hero/intro_hero.png | PNG | Introdução | Arte principal: logo + personagem João + paisagem + tagline script | recorte referência (Introdução) | não | sim | não | 900×1014 |
| login_header | assets/images/hero/login_header.png | PNG | Login | Logo + vilarejo mineiro (topo) | recorte referência (Login) | não | sim | não | 873×354 |
| login_cards | assets/images/hero/login_cards.png | PNG (alpha suavizado) | Login | Leque de cartas vermelhas decorativas | recorte referência (Login) | não | sim | não | 654×261 |
| mode_ia | assets/images/cards/mode_ia.png | PNG | Jogar, Principal, Contra a IA | Ilustração do card "JOGAR CONTRA A IA" | recorte referência (Jogar) | não | sim | não | 396×360 |
| mode_online | assets/images/cards/mode_online.png | PNG | Jogar, Principal, Jogar Online | Ilustração do card "JOGAR ONLINE" | recorte referência (Jogar) | não | sim | não | 384×360 |
| amigos_turma | assets/images/banners/amigos_turma.png | PNG | Amigos, Principal | Banner "Jogue com seus amigos" | recorte referência (Amigos) | não | sim | não | 393×228 |
| loja_personalize | assets/images/banners/loja_personalize.png | PNG | Loja | Lado direito do banner "Personalize seu jogo!" (texto e botão são RN) | recorte referência (Loja) | não | sim | não | 432×369 |
| temporada_minas | assets/images/banners/temporada_minas.png | PNG | Liga, Principal | Banner promocional "Temporada Minas Gerais" (arte com texto embutido, sem áreas clicáveis internas) | recorte referência (Liga) | não | sim | não | 831×273 (~3:1) |
| coins_small/medium/large | assets/images/icons/coins_*.png | PNG (alpha) | Loja, Principal | Pilhas de moedas dos pacotes | recorte referência (Loja) + chroma-key | não | sim | não | 144×102 |
| coin | assets/images/icons/coin.png | PNG (alpha circular) | Header (Jogar/Liga/Principal), Resultado | Ícone de moeda | recorte referência (Jogar) | não | sim | não | 60×60 |
| gem | assets/images/icons/gem.png | PNG (alpha circular) | Header | Ícone de gema | recorte referência (Jogar) | não | sim | não | 60×60 |
| shield_bronze | assets/images/icons/shield_bronze.png | PNG (alpha) | Liga, Perfil, Principal | Escudo Liga Bronze | recorte referência (Liga) | não | sim | não | 183×216 |
| shield_silver | assets/images/icons/shield_silver.png | PNG (alpha) | Liga (próxima liga) | Escudo Liga Prata | recorte referência (Liga) | não | sim | não | 150×138 |
| avatar joao | assets/images/avatars/joao.png | PNG (circular) | Cadastro, Perfil, Header, Loja, Mesa | Personagem principal (João da Serra) | recorte referência (Perfil) | não | sim | não | 228×228 |
| avatar maria | assets/images/avatars/maria.png | PNG (circular) | Cadastro, Amigos, Loja, Mesa | Maria Souza | recorte referência (Cadastro) | não | sim | não | 162×162 |
| avatar cachorro | assets/images/avatars/cachorro.png | PNG (circular) | Cadastro, Loja, Mesa | Caramelo | recorte referência (Cadastro) | não | sim | não | 162×162 |
| avatar galo | assets/images/avatars/galo.png | PNG (circular) | Cadastro, Mesa | Galo Carijó | recorte referência (Cadastro) | não | sim | não | 162×162 |
| avatar seu_ze | assets/images/avatars/seu_ze.png | PNG (circular) | Cadastro, Mesa | Seu Zé | recorte referência (Cadastro) | não | sim | não | 162×162 |
| avatar seu_antonio | assets/images/avatars/seu_antonio.png | PNG (circular) | Cadastro, Mesa | Seu Antônio | recorte referência (Cadastro) | não | sim | não | 162×162 |
| avatar tiao | assets/images/avatars/tiao.png | PNG (circular) | Loja, Mesa | Tião (óculos escuros) | recorte referência (Loja) | não | sim | não | 156×156 |
| icon / splash / adaptive icon | assets/icon.png, assets/splash-icon.png, assets/android-icon-*.png | PNG | Launcher / Splash | Ícone do app | template Expo (**placeholder — pendente**) | sim (template) | não | não | 1024×1024 |

## Ícones de interface
Família única: **Ionicons** (via `@expo/vector-icons`), mapeada em `src/design-system/icons.ts`.
Exceção: glifo de cartas da tab "Jogar" usa `MaterialCommunityIcons` (`cards`), pois Ionicons não possui.
Naipes das cartas na mesa são caracteres tipográficos (♠ ♥ ♦ ♣), não emojis.

## Pendências de asset (requerem ChatGPT/login humano ou arte original)
1. **Ícone do app e splash** — ainda são os do template Expo. Gerar ícone com o logo "TRUCO MINEIRO" (1024×1024, fundo `#00221a`).
2. **Versões em alta resolução** de todos os recortes acima (a referência tem ~300 px por tela; os recortes foram ampliados 3×). Pedir ao ChatGPT "mesmo personagem/paleta, 3× maior".
3. **Tela Principal** — não existe na referência; a implementação (`references/principal.png`, screenshot da tela construída) segue o Design System das demais telas.
4. **Tela OTP** — idem; construída com os mesmos componentes do Login/Cadastro.
5. **Escudos Ouro e Diamante** — reutilizam bronze/prata até haver arte própria.
6. **Verso de carta** — renderizado nativamente (gradiente vermelho + moldura creme); uma arte ornamentada em PNG pode substituir.
