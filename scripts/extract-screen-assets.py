"""Extrai os assets de tela a partir dos prints de referência em references/.

Os prints são a fonte de verdade visual das telas (mockups gerados): aqui recortamos só a
ARTE deles — nunca a interface, que é construída em React Native (textos, campos, botões).

  references/introducao.png -> assets/images/hero/intro_hero.png     (logo + personagem + mesa)
  references/login.png      -> assets/images/hero/login_header.png   (paisagem + logo + slogan)
                            -> assets/images/hero/login_footer.png   (vegetação do rodapé)
  references/otp.png        -> assets/images/hero/otp_top.png        (paisagem + lampião + placa)
                            -> assets/images/hero/otp_bottom.png     (vegetação + mesa)

Rodar: python scripts/extract-screen-assets.py
"""

from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter, ImageOps

ROOT = Path(__file__).resolve().parent.parent
REFS = ROOT / 'references'
OUT = ROOT / 'assets' / 'images' / 'hero'
SCALE = 1.5  # os prints têm ~930 px de largura; 1,5x cobre telas 3x sem inventar detalhe


def save(im: Image.Image, name: str) -> None:
    im = im.resize((round(im.width * SCALE), round(im.height * SCALE)), Image.LANCZOS)
    im.save(OUT / name, optimize=True)
    print(f'{name}  {im.width}x{im.height}  ({im.width}/{im.height})')


def intro_hero() -> None:
    """Topo do print até a faixa de benefícios (que é desenhada pela UI)."""
    src = Image.open(REFS / 'introducao.png').convert('RGB')
    save(src.crop((0, 64, src.width, 1186)), 'intro_hero.png')


def erase(px, box, top_row, bottom_row):
    """Apaga um texto embutido reconstruindo o degradê do fundo (mediana das colunas limpas)."""
    x0, y0, x1, y1 = box
    top = np.median(px[top_row - 5 : top_row, 300:650], axis=(0, 1))
    bottom = np.median(px[bottom_row : bottom_row + 5, 300:650], axis=(0, 1))
    ramp = np.linspace(0, 1, y1 - y0)[:, None, None]
    patch = np.repeat(top[None, None] * (1 - ramp) + bottom[None, None] * ramp, x1 - x0, axis=1)

    blend = Image.new('L', (x1 - x0, y1 - y0), 255)
    blend = ImageOps.expand(blend, border=18, fill=0).filter(ImageFilter.GaussianBlur(9))
    alpha = np.array(blend.crop((18, 18, 18 + x1 - x0, 18 + y1 - y0))).astype(float)[..., None] / 255
    px[y0:y1, x0:x1] = px[y0:y1, x0:x1] * (1 - alpha) + patch * alpha


def login_art() -> None:
    src = Image.open(REFS / 'login.png').convert('RGB')

    # Paisagem + logo + slogan, até onde a arte já escureceu no tom do fundo do app.
    save(src.crop((0, 68, src.width, 700)), 'login_header.png')

    # Vegetação do rodapé: no print ela sobe até a altura do botão, então o recorte
    # carrega junto o selo do Firebase e a frase final — ambos são UI e saem daqui.
    TOP = 1205  # abaixo do botão CONTINUAR embutido no print
    foot = src.crop((0, TOP, src.width, src.height)).convert('RGB')
    px = np.array(foot).astype(float)
    erase(px, (160, 1245 - TOP, 800, 1372 - TOP), 1240 - TOP, 1374 - TOP)  # selo de segurança
    erase(px, (150, 1548 - TOP, 790, 1632 - TOP), 1543 - TOP, 1634 - TOP)  # frase final

    # Topo dissolve no fundo da tela para não deixar emenda.
    out = Image.fromarray(px.round().astype('uint8')).convert('RGBA')
    fade = np.ones((out.height, out.width), float)
    ramp_h = int(out.height * 0.12)
    fade[:ramp_h] = np.linspace(0, 1, ramp_h)[:, None]
    out.putalpha(Image.fromarray((fade * 255).round().astype('uint8')))
    save(out, 'login_footer.png')


def otp_art() -> None:
    """Cenário da tela de código: faixa de cima (paisagem, lampião, placa) e vegetação de baixo.

    Tudo que é interface no print (seta, logo, títulos) é apagado — a tela desenha por cima.
    """
    src = Image.open(REFS / 'otp.png').convert('RGB')

    top = src.crop((0, 0, src.width, 520))
    px = np.array(top).astype(float)
    erase(px, (140, 235, src.width, 519), 230, 519)       # títulos sobre fundo liso
    erase(px, (315, 92, 620, 215), 86, 220)               # logo (a UI redesenha por cima)
    erase(px, (55, 105, 115, 172), 100, 176)              # seta de voltar
    # A base dissolve no fundo da tela (no mockup a paisagem some sem linha de corte).
    out = Image.fromarray(px.round().astype('uint8')).convert('RGBA')
    fade = np.ones((out.height, out.width), float)
    ramp_h = int(out.height * 0.42)
    fade[-ramp_h:] = (np.linspace(1, 0, ramp_h) ** 0.9)[:, None]
    out.putalpha(Image.fromarray((fade * 255).round().astype('uint8')))
    save(out, 'otp_top.png')

    save(src.crop((0, 1240, src.width, src.height)), 'otp_bottom.png')


if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    intro_hero()
    login_art()
    otp_art()
