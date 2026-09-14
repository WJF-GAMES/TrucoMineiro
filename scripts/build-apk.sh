#!/usr/bin/env bash
# Builds the release APK and copies it to dist/ with a versioned name.
#
#   ./scripts/build-apk.sh              # all ABIs (installs on real phones)
#   ./scripts/build-apk.sh x86_64       # emulator only — much faster
#
# The release variant is signed with android/app/debug.keystore (Expo template default), NOT with
# ~/.android/debug.keystore. The fingerprints printed at the end are read from the APK itself and are
# the ones that must be registered in the Firebase Console for Phone Auth to work.
set -euo pipefail

ABIS="${1:-}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/android"

export ANDROID_HOME="${ANDROID_HOME:-$LOCALAPPDATA/Android/Sdk}"

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
