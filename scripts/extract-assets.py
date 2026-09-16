"""Extract reusable assets from referencia.png (source of visual truth).
Coordinates are in mosaic pixels (1536x1024). Output is upscaled 3x (LANCZOS)."""

from PIL import Image, ImageFilter, ImageDraw
import os

SRC = Image.open('referencia.png').convert('RGBA')
OUT = 'assets/images'
S = 3


def crop(box, scale=S):
    im = SRC.crop(box)
    return im.resize((im.width * scale, im.height * scale), Image.LANCZOS)


def save(im, path):
    os.makedirs(os.path.dirname(f'{OUT}/{path}'), exist_ok=True)
    im.save(f'{OUT}/{path}')
    print(path, im.size)


def circle(im, feather=2):
    mask = Image.new('L', im.size, 0)
    ImageDraw.Draw(mask).ellipse((0, 0, im.width - 1, im.height - 1), fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(feather))
    im = im.copy()
    im.putalpha(mask)
    return im


def key_dark(im, lo=28, hi=90):
    """Make dark (background) pixels transparent, soft alpha between lo..hi on max channel."""
    im = im.copy()
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            m = max(r, g, b)
            if m <= lo:
                al = 0
            elif m >= hi:
                al = 255
            else:
                al = int(255 * (m - lo) / (hi - lo))
            px[x, y] = (r, g, b, min(a, al))
    return im


def feather_edges(im, pad=18):
    mask = Image.new('L', im.size, 0)
    ImageDraw.Draw(mask).rectangle((pad, pad, im.width - pad, im.height - pad), fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(pad))
    im = im.copy()
    im.putalpha(mask)
    return im


def sq(cx, cy, r):
    return (cx - r, cy - r, cx + r, cy + r)


# ---- Avatars (circular). Order = registration options.
save(circle(crop(sq(997, 639, 38))), 'avatars/joao.png')          # Perfil (personagem principal)
save(circle(crop(sq(737, 263, 27))), 'avatars/maria.png')
save(circle(crop(sq(800, 263, 27))), 'avatars/cachorro.png')
save(circle(crop(sq(863, 263, 27))), 'avatars/galo.png')
save(circle(crop(sq(673, 330, 27))), 'avatars/seu_ze.png')
save(circle(crop(sq(737, 330, 27))), 'avatars/seu_antonio.png')
save(circle(crop(sq(799, 941, 26))), 'avatars/tiao.png')          # Loja (óculos escuros)

# ---- Hero / backgrounds
# Introdução: arte sem nenhum elemento de UI (sem status bar do mockup, sem cards).
save(crop((13, 28, 313, 380)), 'hero/intro_hero.png')
save(crop((326, 14, 617, 132)), 'hero/login_header.png')          # logo + vilarejo (Login)
save(key_dark(crop((715, 14, 826, 64)), 40, 120), 'hero/logo.png')  # logo sobre fundo escuro

# ---- Game mode illustrations
save(crop((930, 116, 1062, 236)), 'cards/mode_ia.png')
save(crop((1068, 116, 1196, 236)), 'cards/mode_online.png')

# ---- Banners
save(crop((173, 686, 304, 762)), 'banners/amigos_turma.png')
save(crop((1234, 430, 1511, 521)), 'banners/temporada_minas.png')

# (Moedas e gemas não existem mais no produto: os recortes coins_*/coin/gem foram removidos.)

# ---- Currency icons (circular), shields
save(key_dark(crop((1279, 104, 1340, 176)), 30, 100), 'icons/shield_bronze.png')
save(key_dark(crop((1436, 178, 1486, 224)), 30, 110), 'icons/shield_silver.png')
