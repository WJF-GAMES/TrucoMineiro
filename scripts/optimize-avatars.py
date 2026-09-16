"""Reduz os avatares para o tamanho em que o app de fato os desenha.

O maior avatar da interface tem 112 dp; em telas @3x isso são 336 px. Os PNGs chegaram com
1254 x 1254 (1,5-1,9 MB cada): a grade do cadastro decodificava ~12 MB de imagem e os círculos
ficavam vazios por segundos (e com risco de memória em aparelhos modestos).

Idempotente: só reescreve arquivos maiores que o alvo. Os originais continuam no histórico do git.
Uso: python scripts/optimize-avatars.py
"""
from pathlib import Path

from PIL import Image

TARGET = 360
ROOT = Path(__file__).resolve().parent.parent / 'assets' / 'images' / 'avatars'


def main() -> None:
    for path in sorted(ROOT.glob('*.png')):
        with Image.open(path) as im:
            before = path.stat().st_size
            if max(im.size) <= TARGET:
                print(f'{path.name}: {im.size} ok')
                continue
            resized = im.convert('RGBA').resize((TARGET, TARGET), Image.LANCZOS)
        resized.save(path, optimize=True)
        after = path.stat().st_size
        print(f'{path.name}: -> {TARGET}x{TARGET}  {before // 1024} KB -> {after // 1024} KB')


if __name__ == '__main__':
    main()
