"""Otimiza as imagens empacotadas pelo Metro (assets/images) para reduzir o APK/AAB.

  python scripts/optimize-assets.py            # só relatório (não grava nada)
  python scripts/optimize-assets.py --apply    # grava os .webp e remove o PNG de origem

Fluxo de arte: os scripts de extração (extract-assets.py, extract-screen-assets.py) gravam PNG em
assets/images; este script converte cada PNG no formato final do app. Ele só processa PNG — nunca
recomprime um .webp já gerado (evita perda geracional). O PNG removido continua no histórico do git.

Regras por asset (PROFILES):
  - max_w: largura máxima necessária no app (maior tamanho exibido × ~3,5x de densidade). Nunca amplia.
  - quality: WebP com perdas para ilustrações (o canal alpha é sempre salvo sem perdas).
Para cada asset o script também gera WebP lossless e fica com o menor arquivo; o relatório traz o
PSNR de luminância do resultado contra o original redimensionado. (O PSNR em RGB estaciona em
~31-36 dB em arte saturada mesmo em q100 por causa da subamostragem de croma 4:2:0 do WebP com
perdas; isso não é perceptível na tela.)

Assets de launcher/splash (assets/icon.png, android-icon-*, splash-icon.png) ficam em PNG: são
entradas do `expo prebuild`, que gera os recursos nativos a partir deles.
"""

import argparse
import io
import math
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageStat

ROOT = Path(__file__).resolve().parent.parent
IMAGES = ROOT / 'assets' / 'images'

# Tamanho máximo exibido (dp) → largura alvo. Ver docs/asset-manifest.md.
PROFILES = {
    # Arte de tela cheia (largura da tela; telas QHD chegam a ~1440 px).
    'hero/intro_hero.png': dict(max_w=1440, quality=92),
    'hero/login_header.png': dict(max_w=1440, quality=92),
    'hero/login_footer.png': dict(max_w=1440, quality=92),
    'hero/otp_top.png': dict(max_w=1440, quality=92),
    'hero/otp_bottom.png': dict(max_w=1440, quality=92),
    # Banner com texto embutido: qualidade maior. 2172×724 → 1440×480 (3:1 exato).
    'banners/temporada_minas.png': dict(max_w=1440, quality=95),
    # Logo: no máximo 220×96 dp (Splash) → 1024 px cobre ~4,6x.
    'hero/logo.png': dict(max_w=1024, quality=95),
    # Cards de modo: meia tela nos cards e largura total nos heros de Online/IA.
    'cards/mode_ia.png': dict(max_w=1254, quality=92),
    'cards/mode_online.png': dict(max_w=1254, quality=92),
    # Banner de amigos: miniatura 52 dp e banner ~230×130 dp (cover) → 1024 px.
    'banners/amigos_turma.png': dict(max_w=1024, quality=92),
    # Avatares: até 112 dp; o original tem 360 px (não amplia).
    'avatars/*.png': dict(max_w=360, quality=95),
    # Brasões: até 96×106 dp (Liga) → 512 px cobre ~4,8x.
    'icons/shield_*.png': dict(max_w=512, quality=95),
}


def profile_for(rel: str):
    for pattern, prof in PROFILES.items():
        if Path(rel).match(pattern):
            return prof
    return None


def encode(im: Image.Image, method: int = 6, **kw) -> bytes:
    buf = io.BytesIO()
    im.save(buf, format='WEBP', method=method, **kw)
    return buf.getvalue()


def psnr(a: Image.Image, b: Image.Image) -> float:
    """PSNR de luminância, com a imagem composta sobre o verde escuro do app."""
    bg = Image.new('RGBA', a.size, (0, 34, 26, 255))
    a = Image.alpha_composite(bg, a.convert('RGBA')).convert('L')
    b = Image.alpha_composite(bg, b.convert('RGBA')).convert('L')
    mse = ImageStat.Stat(ImageChops.difference(a, b)).rms[0] ** 2
    return 99.0 if mse == 0 else 20 * math.log10(255 / math.sqrt(mse))


def process(path: Path, apply: bool):
    rel = path.relative_to(IMAGES).as_posix()
    prof = profile_for(rel)
    if prof is None:
        print(f'?? {rel}: sem perfil em PROFILES — ignorado')
        return None
    src = Image.open(path)
    src.load()
    has_alpha = src.mode in ('RGBA', 'LA', 'PA') or 'transparency' in src.info
    im = src.convert('RGBA' if has_alpha else 'RGB')
    if has_alpha and im.getchannel('A').getextrema()[0] == 255:
        im, has_alpha = im.convert('RGB'), False  # alpha totalmente opaco: descarta o canal
    before = (src.size, path.stat().st_size)
    if im.width > prof['max_w']:
        h = round(im.height * prof['max_w'] / im.width)
        im = im.resize((prof['max_w'], h), Image.LANCZOS)

    lossy = encode(im, quality=prof['quality'], alpha_quality=100)
    lossless = encode(im, lossless=True, quality=60, method=4)
    data, kind = (lossless, 'lossless') if len(lossless) <= len(lossy) else (lossy, f"q{prof['quality']}")
    out = path.with_suffix('.webp')
    decoded = Image.open(io.BytesIO(data))
    quality = psnr(im, decoded)

    if apply:
        out.write_bytes(data)
        path.unlink()
    return dict(
        rel=rel, dim_before=before[0], size_before=before[1], dim_after=im.size,
        size_after=len(data), kind=kind, alpha=has_alpha, psnr=quality,
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true', help='grava os .webp e remove os PNG')
    args = parser.parse_args()

    pngs = sorted(IMAGES.rglob('*.png'))
    if not pngs:
        print('Nenhum PNG em assets/images — nada a otimizar.')
        return 0
    rows = [r for r in (process(p, args.apply) for p in pngs) if r]
    print(f"{'arquivo':38} {'antes':>11} {'depois':>11} {'KB antes':>9} {'KB dep.':>8} {'red.':>6}  fmt       alpha  PSNR")
    for r in rows:
        red = 100 * (1 - r['size_after'] / r['size_before'])
        print(
            f"{r['rel']:38} {'x'.join(map(str, r['dim_before'])):>11} {'x'.join(map(str, r['dim_after'])):>11} "
            f"{r['size_before'] / 1024:9.0f} {r['size_after'] / 1024:8.0f} {red:5.1f}%  {r['kind']:9} "
            f"{'sim' if r['alpha'] else 'não':5}  {r['psnr']:.1f} dB"
        )
    total_b = sum(r['size_before'] for r in rows)
    total_a = sum(r['size_after'] for r in rows)
    print(f'\nTotal: {total_b / 1e6:.2f} MB -> {total_a / 1e6:.2f} MB ({100 * (1 - total_a / total_b):.1f}% menor)')
    low = [r['rel'] for r in rows if r['psnr'] < 36]
    if low:
        print('ATENÇÃO: PSNR < 36 dB, revisar visualmente:', ', '.join(low))
    if not args.apply:
        print('(relatório apenas — use --apply para gravar)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
