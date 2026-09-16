#!/usr/bin/env bash
# Builds the release APK and copies it to dist/ with a versioned name.
#
#   ./scripts/build-apk.sh              # ARM (armeabi-v7a + arm64-v8a): todos os celulares reais
#   ./scripts/build-apk.sh arm64-v8a    # só 64 bits — o menor APK para aparelhos modernos
#   ./scripts/build-apk.sh x86_64       # emulator only — much faster
#   ./scripts/build-apk.sh all          # as 4 ABIs (APK universal, inclui x86/x86_64 de emulador)
#
# x86/x86_64 só servem para emulador e somavam ~52 MB ao APK universal. O AAB da Play Store
# (./gradlew bundleRelease) continua com as 4 ABIs de gradle.properties: a Play entrega a cada
# aparelho só a ABI dele.
#
# The release variant is signed with the production keystore declared in android/keystore.properties
# (storeFile/storePassword/keyAlias/keyPassword). Sem esse arquivo o build cai no
# android/app/debug.keystore do template Expo. The fingerprints printed at the end are read from the
# APK itself and are the ones that must be registered in the Firebase Console for Phone Auth to work.
set -euo pipefail

ABIS="${1:-armeabi-v7a,arm64-v8a}"
[ "$ABIS" = "all" ] && ABIS=""
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/android"

export ANDROID_HOME="${ANDROID_HOME:-$LOCALAPPDATA/Android/Sdk}"

# O plugin do React Native não limpa os assets gerados pelo Metro: se um asset trocar de extensão
# (ex.: PNG -> WebP) a cópia antiga fica e o merge de recursos falha com "Duplicate resources".
rm -rf app/build/generated/res/react app/build/generated/assets/react

GRADLE_ARGS=(assembleRelease --no-daemon)
[ -n "$ABIS" ] && GRADLE_ARGS+=("-PreactNativeArchitectures=$ABIS")

echo "==> Gradle: ${GRADLE_ARGS[*]}"
./gradlew "${GRADLE_ARGS[@]}"

APK="$ROOT/android/app/build/outputs/apk/release/app-release.apk"
# sed em vez de grep -P: o Git Bash do Windows roda com locale que não suporta -P.
VERSION="$(sed -n 's/.*versionName *"\([^"]*\)".*/\1/p' app/build.gradle | head -1)"
OUT_DIR="$ROOT/dist"
OUT="$OUT_DIR/truco-mineiro-$VERSION.apk"

mkdir -p "$OUT_DIR"
cp "$APK" "$OUT"

echo
echo "APK: $OUT"
ls -la "$OUT"

APKSIGNER="$(ls "$ANDROID_HOME"/build-tools/*/apksigner.bat 2>/dev/null | tail -1 || true)"
CERTS=""
[ -n "$APKSIGNER" ] && CERTS="$("$APKSIGNER" verify --print-certs "$OUT" 2>/dev/null || true)"

CERTS="$CERTS" python - "$OUT" <<'PY'
import collections
import os
import re
import sys
import zipfile

apk = sys.argv[1]
with zipfile.ZipFile(apk) as z:
    abis = collections.Counter(
        n.split('/')[1] for n in z.namelist() if n.startswith('lib/')
    )
print('ABIs incluídas:', ', '.join(sorted(abis)) or '(nenhuma)')

certs = os.environ.get('CERTS', '')
found = re.findall(r'(SHA-\d+) digest:\s*([0-9a-fA-F]+)', certs)
if found:
    print('\nImpressões digitais deste APK (cadastrar no Firebase Console):')
    for kind, digest in found:
        pretty = ':'.join(digest[i:i + 2].upper() for i in range(0, len(digest), 2))
        print(f'  {kind:8} {pretty}')
else:
    print('\n(apksigner não encontrado — confira a assinatura com'
          ' "$ANDROID_HOME/build-tools/<versão>/apksigner.bat" verify --print-certs)')
PY
