# QA visual e regressão

## Fonte de verdade
`referencia.png` (mosaico 1536×1024, 10 telas) → recortes individuais em `references/` gerados por
`scripts/extract-assets.py` (o mesmo script extrai os assets de UI).

| Tela | Referência | Screenshot |
|---|---|---|
| Introdução | `references/introducao.png` | `artifacts/screenshots/01-introducao.png` |
| Login | `references/login.png` | `02-login.png` |
| OTP | *(não existe na referência; construída com os componentes de Login/Cadastro)* | `03-otp.png` |
| Cadastro | `references/cadastro.png` | `04-cadastro.png` |
| Principal | *(não existe na referência; composta a partir do mesmo Design System)* | `05-principal.png` |
| Jogar | `references/jogar.png` | `06-jogar.png` |
| Liga | `references/liga.png` | `07-liga.png` |
| Amigos | `references/amigos.png` | `08-amigos.png` |
| Mais | `references/mais.png` | `09-mais.png` |
| Loja | `references/loja.png` | `11-loja.png` |
| Perfil | `references/perfil.png` | `12-perfil.png` |
| Configurações | `references/configuracoes.png` | `13-configuracoes.png` |
| Contra a IA | *(derivada de Jogar)* | `14-ia-setup.png` |
| Mesa | *(não existe na referência)* | `15-mesa.png`, `15b-mesa-jogada.png` |
| Resultado | *(não existe na referência)* | `16-resultado.png` |

## Como capturar
O emulador Android precisa estar rodando e o app instalado (release de preferência: sem dev menu).

```
./scripts/qa.sh launch 8            # abre o app (DEV_CLIENT=1 usa o dev client + Metro)
./scripts/qa.sh shot 06-jogar       # captura artifacts/screenshots/06-jogar.png
./scripts/qa.sh tap 322 2323        # toca (coordenadas em px do device 1080x2424)
./scripts/qa.sh errors              # últimas linhas de ReactNativeJS/FirebaseAuth do logcat
./scripts/qa.sh otp_code            # código do Auth Emulator (modo emulador)
```

## Comparação lado a lado
```
python scripts/visual-diff.py                 # todas as telas com referência
python scripts/visual-diff.py 06-jogar jogar  # uma tela específica
```
Gera `artifacts/visual-diff/<tela>-side-by-side.png` (referência | app, mesma altura) e
`<tela>-overlay.png` (app sobre a referência a 50%). As proporções diferem (referência ≈ 300×514,
device 1080×2424), então o overlay serve para conferir **ordem, proporção e hierarquia**, não pixels.

## Segunda rodada visual — o que conferir
font weight · line height · altura de botão · border radius · spacing · imagem · avatar ·
tamanho dos cards · posição do header · Bottom Navigation · sombras · opacidade · gradientes.

## Segunda rodada visual — o que mudou (12/09)

A referência tem proporção ~0.58 (300×514) e o device 0.45 (1080×2424): mantendo as alturas fixas, os
elementos ficavam **achatados** em relação ao mockup. Ajustes aplicados depois da primeira comparação:
cards de modo 292→334, arte do card 60%→62%, título 20→21, linhas de ação +3pt de padding,
escudo da liga 86×100→98×114, "Liga Bronze" 22→24, cards de estatística +5pt, linhas de menu 58→64.

## Resultado da auditoria (12/09)
Aprovadas: Introdução, Login, Cadastro, Jogar, Liga, Amigos, Mais, Loja, Perfil, Configurações.
Diferenças conhecidas e aceitas:
- A referência tem proporção ~0.58 e o device 0.45: sobra altura, distribuída como respiro
  (Introdução: madeira da mesa; demais telas: espaço no rodapé antes da Bottom Navigation).
- Dados do mockup (124 partidas, "2.384 online") **não** são reproduzidos: as telas
  mostram os valores reais do Firestore/RTDB, como exige o requisito.
- Na Loja, os itens fora de "Destaques" usam avatar circular (a referência só mostra a aba Destaques).
