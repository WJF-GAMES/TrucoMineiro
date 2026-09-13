#!/usr/bin/env bash
# Grava a tela do emulador enquanto executa toques e gera uma folha de contato dos quadros.
# Uso: scripts/qa-record.sh <nome> <segundos> [x y [x y ...]]   (toques 0,8s após iniciar a gravação)
set -u
export MSYS_NO_PATHCONV=1
ADB="${LOCALAPPDATA}/Android/Sdk/platform-tools/adb"
OUT="artifacts/screenshots"
NAME="$1"; SECS="$2"; shift 2
mkdir -p "$OUT"
timeout $((SECS + 20)) "$ADB" shell screenrecord --time-limit "$SECS" --bit-rate 6000000 /sdcard/rec.mp4 &
REC=$!
sleep 0.8
while [ $# -ge 2 ]; do
  timeout 10 "$ADB" shell input tap "$1" "$2"
  shift 2
  sleep "${TAP_GAP:-0.4}"
done
wait $REC
timeout 60 "$ADB" pull /sdcard/rec.mp4 "$OUT/$NAME.mp4" > /dev/null
python - "$OUT/$NAME.mp4" "$OUT/$NAME.png" "${FRAME_STEP:-0.25}" "${CROP:-0,250,1080,2424}" <<'PYEND'
import sys, cv2, numpy as np
src, dst, step, crop = sys.argv[1], sys.argv[2], float(sys.argv[3]), [int(v) for v in sys.argv[4].split(',')]
cap = cv2.VideoCapture(src)
fps = cap.get(cv2.CAP_PROP_FPS) or 30
frames = []; i = 0; nxt = 0.0
# Leitura sequencial: o seek por tempo trava no mp4 do screenrecord.
while True:
    ok, f = cap.read()
    if not ok: break
    t = i / fps; i += 1
    if t + 1e-6 < nxt: continue
    nxt += step
    x0, y0, x1, y1 = crop; f = f[y0:y1, x0:x1]
    h = 420; w = int(f.shape[1] * h / f.shape[0]); f = cv2.resize(f, (w, h))
    cv2.putText(f, f"{t:.2f}s", (8, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 255), 2)
    frames.append(f)
cols = 8; rows = (len(frames) + cols - 1) // cols; h, w = frames[0].shape[:2]
sheet = np.zeros((rows * h, cols * w, 3), np.uint8)
for k, f in enumerate(frames):
    r, c = divmod(k, cols); sheet[r*h:(r+1)*h, c*w:(c+1)*w] = f
cv2.imwrite(dst, sheet); print(f"{len(frames)} frames -> {dst}")
PYEND
