#!/usr/bin/env bash
# Joga uma partida contra a IA "no automático": toca no baralho da cerimônia, no botão de
# confirmar (embaralho/corte) e numa carta da mão a cada ciclo até o log de dev registrar
# MATCH_ENDED (ou até esgotar os ciclos).
# Uso: scripts/qa-autoplay.sh [ciclos=240] [intervalo=1.5]
set -u
export MSYS_NO_PATHCONV=1
ADB="${LOCALAPPDATA}/Android/Sdk/platform-tools/adb"
CYCLES="${1:-240}"; GAP="${2:-1.5}"
[ "${KEEP_LOG:-0}" = "1" ] || timeout 20 "$ADB" logcat -c
for ((i = 1; i <= CYCLES; i++)); do
  timeout 10 "$ADB" shell input tap 520 1070 > /dev/null   # baralho (embaralhar/cortar)
  timeout 10 "$ADB" shell input tap 540 2135 > /dev/null   # "Está bom" / "Confirmar corte"
  timeout 10 "$ADB" shell input tap 470 2040 > /dev/null   # carta da mão
  if timeout 20 "$ADB" logcat -d 2>/dev/null | grep -q "MATCH_ENDED"; then
    echo "match ended after $i cycles"; exit 0
  fi
  sleep "$GAP"
done
echo "gave up after $CYCLES cycles"; exit 1
