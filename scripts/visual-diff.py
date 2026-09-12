"""Builds side-by-side and overlay comparisons between references/ and artifacts/screenshots/.

Usage:
    python scripts/visual-diff.py                 # every mapped screen
    python scripts/visual-diff.py 06-jogar jogar  # one screenshot against one reference
"""

import os
import sys
from PIL import Image

SHOTS = 'artifacts/screenshots'
REFS = 'references'
OUT = 'artifacts/visual-diff'

# screenshot (without .png) -> reference (without .png)
PAIRS = {
    '01-introducao': 'introducao',
    '02-login': 'login',
    '04-cadastro': 'cadastro',
    '06-jogar': 'jogar',
    '07-liga': 'liga',
    '08-amigos': 'amigos',
    '09-mais': 'mais',
    '11-loja': 'loja',
    '12-perfil': 'perfil',
    '13-configuracoes': 'configuracoes',
}

GAP = 24
BG = (11, 48, 46)


def load(path):
    return Image.open(path).convert('RGB')


def scale_to_height(im, height):
    w = max(1, round(im.width * height / im.height))
    return im.resize((w, height), Image.LANCZOS)


def side_by_side(ref, shot, out_path):
    height = 1400
    a, b = scale_to_height(ref, height), scale_to_height(shot, height)
    canvas = Image.new('RGB', (a.width + GAP + b.width, height), BG)
    canvas.paste(a, (0, 0))
    canvas.paste(b, (a.width + GAP, 0))
    canvas.save(out_path)
    return canvas.size


def overlay(ref, shot, out_path):
    """App over the reference at 50%. Widths are matched; heights differ by device ratio."""
    width = 900
    a = ref.resize((width, round(ref.height * width / ref.width)), Image.LANCZOS)
    b = shot.resize((width, round(shot.height * width / shot.width)), Image.LANCZOS)
    height = max(a.height, b.height)
    base = Image.new('RGB', (width, height), BG)
    base.paste(a, (0, 0))
    top = Image.new('RGB', (width, height), BG)
    top.paste(b, (0, 0))
    Image.blend(base, top, 0.5).save(out_path)


def run(shot_name, ref_name):
    shot_path, ref_path = f'{SHOTS}/{shot_name}.png', f'{REFS}/{ref_name}.png'
    if not os.path.exists(shot_path):
        print(f'skip {shot_name}: screenshot ausente')
        return
    if not os.path.exists(ref_path):
        print(f'skip {shot_name}: referência ausente')
        return
    os.makedirs(OUT, exist_ok=True)
    ref, shot = load(ref_path), load(shot_path)
    side_by_side(ref, shot, f'{OUT}/{ref_name}-side-by-side.png')
    overlay(ref, shot, f'{OUT}/{ref_name}-overlay.png')
    print(f'{ref_name}: side-by-side + overlay')


if __name__ == '__main__':
    if len(sys.argv) == 3:
        run(sys.argv[1], sys.argv[2])
    else:
        for shot, ref in PAIRS.items():
            run(shot, ref)
