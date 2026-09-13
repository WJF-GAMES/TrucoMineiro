"""Checks that the aspectRatio constants in the UI still match the real asset files.

Assets get replaced by higher-resolution art from time to time and the proportions change with them;
a stale ratio silently crops the image (contentFit="cover"). Run after touching assets/images.
"""

import re
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent

# source file -> (regex capturing "W / H", asset path)
CHECKS = [
    ('src/screens/intro/IntroScreen.tsx', r'HERO_RATIO = (\d+) / (\d+)', 'assets/images/hero/intro_hero.png'),
    ('src/screens/auth/LoginScreen.tsx', r'cards: \{[^}]*aspectRatio: (\d+) / (\d+)', 'assets/images/hero/login_cards.png'),
    ('src/screens/home/HomeScreen.tsx', r'banner: \{[^}]*aspectRatio: (\d+) / (\d+)', 'assets/images/banners/temporada_minas.png'),
    ('src/screens/league/LeagueScreen.tsx', r'banner: \{[^}]*aspectRatio: (\d+) / (\d+)', 'assets/images/banners/temporada_minas.png'),
]

TOLERANCE = 0.02  # 2%

failed = False
for source, pattern, asset in CHECKS:
    text = (ROOT / source).read_text(encoding='utf-8')
    match = re.search(pattern, text)
    if not match:
        print(f'?? {source}: constante não encontrada ({pattern})')
        failed = True
        continue
    coded = int(match.group(1)) / int(match.group(2))
    with Image.open(ROOT / asset) as im:
        real = im.width / im.height
    off = abs(coded - real) / real
    status = 'ok ' if off <= TOLERANCE else 'ERRO'
    if off > TOLERANCE:
        failed = True
    print(f'{status} {asset}: código {coded:.3f} vs arquivo {real:.3f} ({off * 100:.1f}%)')

sys.exit(1 if failed else 0)
