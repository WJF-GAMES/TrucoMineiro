"""Gera todos os ícones de app a partir de references/app-icon.png (arte-mestra 1:1).

Saídas:
  assets/icon.png                      iOS / App Store (1024, opaco, sem alpha)
  assets/android-icon-foreground.png   camada de frente do adaptive icon (1024)
  assets/android-icon-background.png   camada de fundo do adaptive icon (1024)
  assets/android-icon-monochrome.png   themed icon do Android 13+ (1024)
  assets/favicon.png                   web (48)
  android/app/src/main/res/mipmap-*    mipmaps nativos (foreground/background/monochrome + legado)

Geometria: a arte-mestra já é um "badge" quadrado de cantos arredondados (r ~20%) com o
chapéu vazando por cima. O script acha esse quadrado pelo alpha e reposiciona a arte em
cada destino:
  - iOS recorta com squircle próprio -> arte inteira sangrando até a borda, com o fundo
    preenchido por uma cópia borrada da própria arte (nada de moldura escura).
  - Android mascara só o centro de 72dp dos 108dp -> o badge encolhe para caber inteiro
    até na máscara circular (canto a <= 36dp do centro), sobre um campo verde full-bleed.

Rodar: python scripts/generate-app-icons.py
"""

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'references' / 'app-icon.png'
ASSETS = ROOT / 'assets'
RES = ROOT / 'android' / 'app' / 'src' / 'main' / 'res'

# Fundo do ícone: verde do tabuleiro da própria arte (centro mais claro, bordas escuras).
GREEN_CENTER = (10, 92, 50)
GREEN_EDGE = (0, 28, 18)
IOS_BACKDROP = (0, 34, 26)  # #00221a, mesmo tom do splash

# Android: 108dp de canvas, 72dp visíveis. Badge com canto r=20% => raio máx = 0.6243*lado.
ANDROID_VIEWPORT = 72 / 108
BADGE_SCALE = 0.527  # lado do badge / canvas -> canto a 0.329 do centro (< 0.333 do círculo)
MONO_SCALE = 0.55  # a silhueta é mais estreita e pode crescer dentro da área segura

# densidade -> (tamanho adaptive 108dp, tamanho legado 48dp)
DENSITIES = {
    'mdpi': (108, 48),
    'hdpi': (162, 72),
    'xhdpi': (216, 96),
    'xxhdpi': (324, 144),
    'xxxhdpi': (432, 192),
}


def load_master():
    """Arte-mestra + quadrado do badge + topo real da arte (o bico do chapéu)."""
    im = Image.open(SRC).convert('RGBA')
    alpha = np.array(im)[..., 3]
    ys, xs = np.where(alpha > 200)  # ignora a sombra externa
    x0, x1, y1 = int(xs.min()), int(xs.max()), int(ys.max())
    side = x1 - x0 + 1
    return im, (x0, y1 + 1 - side, x1 + 1, y1 + 1), int(ys.min())


def place(size, im, badge, art_top, scale, anchor):
    """Cola a arte redimensionada num canvas transparente `size`x`size`.

    anchor='art' centraliza a bbox visível (nada é cortado);
    anchor='badge' centraliza o quadrado do badge (o chapéu vaza para cima).
    """
    x0, y0, x1, y1 = badge
    art = im.crop((0, art_top, im.width, y1))
    art = art.resize((round(art.width * scale), round(art.height * scale)), Image.LANCZOS)
    cx = (x0 + x1) / 2 * scale
    cy = (((y0 + y1) / 2 if anchor == 'badge' else (art_top + y1) / 2) - art_top) * scale
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    canvas.alpha_composite(art, (round(size / 2 - cx), round(size / 2 - cy)))
    return canvas


def radial_background(size):
    """Campo verde full-bleed com o mesmo degradê do tabuleiro da arte."""
    yy, xx = np.mgrid[0:size, 0:size]
    d = np.sqrt((xx - size / 2) ** 2 + (yy - size / 2) ** 2) / (size * 0.72)
    t = np.clip(d, 0, 1)[..., None] ** 1.35
    rgb = np.array(GREEN_CENTER, float) * (1 - t) + np.array(GREEN_EDGE, float) * t
    return Image.fromarray(rgb.round().astype(np.uint8), 'RGB').convert('RGBA')


def monochrome_art(im, badge, art_top):
    """Silhueta (chapéu + cartas + naipes) para o themed icon do Android 13+."""
    a = np.array(im).astype(int)
    r, g, b, alpha = a[..., 0], a[..., 1], a[..., 2], a[..., 3]
    h, w = alpha.shape
    x0, y0, x1, y1 = badge
    side = x1 - x0
    inset = int(side * 0.078)  # tira a moldura dourada
    ring = Image.new('L', (w, h), 0)
    ImageDraw.Draw(ring).rounded_rectangle(
        [x0 + inset, y0 + inset, x1 - 1 - inset, y1 - 1 - inset],
        radius=int(side * 0.20) - inset,
        fill=255,
    )
    yy = np.arange(h)[:, None] * np.ones((1, w))
    xx = np.ones((h, 1)) * np.arange(w)[None, :]
    cut = y0 + int(side * 0.663)  # corta na tábua do logotipo
    lum = 0.299 * r + 0.587 * g + 0.114 * b
    green = (g > r + 18) & (g > b + 18) & (g > 22)

    art = (alpha > 200) & (np.array(ring) > 127) & ~green & (yy > art_top) & (yy < cut)
    center = (xx > x0 + side * 0.30) & (xx < x0 + side * 0.70) & (yy > y0 + side * 0.35)
    spade = art & center & (lum < 70) & (abs(r - b) < 25) & (abs(r - g) < 25)
    seams = art & (lum < 36)  # fita do chapéu e contornos internos viram vazados

    mask = ((art & ~spade & ~seams) * 255).astype(np.uint8)
    mask = Image.fromarray(mask)
    mask = mask.filter(ImageFilter.MedianFilter(5)).filter(ImageFilter.MedianFilter(3))
    out = Image.new('RGBA', (w, h), (255, 255, 255, 0))
    out.putalpha(mask)
    return out


def fill_small_holes(layer, max_area):
    """Tapa vazados minúsculos (ruído de sombra) mantendo os grandes (naipe, fita)."""
    solid = np.array(layer.getchannel('A')) > 127
    hole = ~solid
    outside = np.zeros_like(hole)
    outside[0, :] = outside[-1, :] = outside[:, 0] = outside[:, -1] = True
    outside &= hole
    while True:  # reconstrução morfológica a partir da borda
        grown = outside.copy()
        grown[1:, :] |= outside[:-1, :]
        grown[:-1, :] |= outside[1:, :]
        grown[:, 1:] |= outside[:, :-1]
        grown[:, :-1] |= outside[:, 1:]
        grown &= hole
        if grown.sum() == outside.sum():
            break
        outside = grown

    inner = hole & ~outside
    seen = np.zeros_like(inner)
    for sy, sx in zip(*np.where(inner)):
        if seen[sy, sx]:
            continue
        stack, cells = [(sy, sx)], []
        seen[sy, sx] = True
        while stack:
            y, x = stack.pop()
            cells.append((y, x))
            for ny, nx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                if inner[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True
                    stack.append((ny, nx))
        if len(cells) <= max_area:
            for y, x in cells:
                solid[y, x] = True

    out = Image.new('RGBA', layer.size, (255, 255, 255, 0))
    out.putalpha(Image.fromarray((solid * 255).astype(np.uint8)))
    return out


def fit(layer, size, frac):
    """Recorta a silhueta e a recentraliza ocupando `frac` do canvas."""
    art = layer.crop(layer.getbbox())
    k = size * frac / max(art.size)
    art = art.resize((round(art.width * k), round(art.height * k)), Image.LANCZOS)
    canvas = Image.new('RGBA', (size, size), (255, 255, 255, 0))
    canvas.alpha_composite(art, ((size - art.width) // 2, (size - art.height) // 2))
    return canvas


def circle_crop(im):
    mask = Image.new('L', im.size, 0)
    ImageDraw.Draw(mask).ellipse((0, 0, im.width - 1, im.height - 1), fill=255)
    out = im.convert('RGBA')
    out.putalpha(mask)
    return out


def save(im, path, **kw):
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.suffix == '.png':
        kw.setdefault('optimize', True)
    im.save(path, **kw)
    print(f'{path.relative_to(ROOT)}  {im.size[0]}x{im.size[1]} {im.mode}')


def main():
    im, badge, art_top = load_master()
    art_h = badge[3] - art_top
    print(f'arte {im.size} | badge {badge} | topo do chapéu y={art_top}')

    # --- iOS / loja: arte inteira sangrando, sem canal alpha ----------------------
    sharp = place(1024, im, badge, art_top, 1024 / art_h, anchor='art')
    glow = place(1024, im, badge, art_top, 1024 / art_h * 1.08, anchor='art')
    ios = Image.new('RGBA', (1024, 1024), (*IOS_BACKDROP, 255))
    ios.alpha_composite(glow.filter(ImageFilter.GaussianBlur(28)))
    ios.alpha_composite(sharp)
    ios = ios.convert('RGB')
    save(ios, ASSETS / 'icon.png')
    save(ios.resize((48, 48), Image.LANCZOS).convert('RGBA'), ASSETS / 'favicon.png')

    # --- Android adaptive ---------------------------------------------------------
    scale = 1024 * BADGE_SCALE / (badge[2] - badge[0])
    foreground = place(1024, im, badge, art_top, scale, anchor='badge')
    background = radial_background(1024)
    monochrome = fit(monochrome_art(im, badge, art_top), 1024, MONO_SCALE)
    monochrome = fill_small_holes(monochrome, max_area=1500)

    save(foreground, ASSETS / 'android-icon-foreground.png')
    save(background.convert('RGB'), ASSETS / 'android-icon-background.png')
    save(monochrome, ASSETS / 'android-icon-monochrome.png')

    # --- mipmaps nativos ----------------------------------------------------------
    adaptive = background.copy()
    adaptive.alpha_composite(foreground)
    inset = round(1024 * (1 - ANDROID_VIEWPORT) / 2)
    viewport = adaptive.crop((inset, inset, 1024 - inset, 1024 - inset))
    webp = dict(format='WEBP', quality=92, method=6)

    for density, (big, small) in DENSITIES.items():
        out = RES / f'mipmap-{density}'
        save(foreground.resize((big, big), Image.LANCZOS), out / 'ic_launcher_foreground.webp', **webp)
        save(background.resize((big, big), Image.LANCZOS), out / 'ic_launcher_background.webp', **webp)
        save(monochrome.resize((big, big), Image.LANCZOS), out / 'ic_launcher_monochrome.webp', **webp)
        save(ios.convert('RGBA').resize((small, small), Image.LANCZOS), out / 'ic_launcher.webp', **webp)
        save(circle_crop(viewport.resize((small, small), Image.LANCZOS)), out / 'ic_launcher_round.webp', **webp)


if __name__ == '__main__':
    main()
