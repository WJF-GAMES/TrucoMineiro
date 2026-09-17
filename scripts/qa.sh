#!/usr/bin/env bash
# QA helpers: drive the app on the running Android emulator and capture screenshots.
set -u
export MSYS_NO_PATHCONV=1
ADB="${LOCALAPPDATA}/Android/Sdk/platform-tools/adb"
PKG=com.mooby.trucomineiro
SHOTS="artifacts/screenshots"
mkdir -p "$SHOTS"

tap()   { timeout 20 "$ADB" shell input tap "$1" "$2"; sleep "${3:-1.2}"; }
swipe() { timeout 20 "$ADB" shell input swipe "$1" "$2" "$3" "$4" "${5:-300}"; sleep "${6:-1.2}"; }
type()  { timeout 20 "$ADB" shell input text "$1"; sleep "${2:-0.8}"; }
key()   { timeout 20 "$ADB" shell input keyevent "$1"; sleep "${2:-0.8}"; }
back()  { timeout 20 "$ADB" shell input keyevent 4; sleep "${1:-1.2}"; }
clear_field() { for _ in $(seq 1 "${1:-40}"); do timeout 10 "$ADB" shell input keyevent 67 >/dev/null; done; }
shot()  { sleep "${2:-0.6}"; timeout 30 "$ADB" exec-out screencap -p > "$SHOTS/$1.png"; echo "captured $1"; }
wipe()  { timeout 30 "$ADB" shell pm clear $PKG > /dev/null; }
launch() {
  timeout 20 "$ADB" shell am force-stop $PKG
  if [ "${DEV_CLIENT:-0}" = "1" ]; then
    # O reverse some sempre que o emulador reinicia; sem ele o dev client não acha o Metro.
    timeout 15 "$ADB" reverse tcp:8081 tcp:8081 > /dev/null
    # Backend local (REST + Socket.IO). O app em dev usa http://10.0.2.2:3000, que já chega ao host;
    # o reverse deixa também http://localhost:3000 funcionar (EXPO_PUBLIC_API_URL apontando para ele).
    timeout 15 "$ADB" reverse tcp:3000 tcp:3000 > /dev/null
    timeout 30 "$ADB" shell am start -a android.intent.action.VIEW       -d "trucomineiro://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081" $PKG > /dev/null
    local n=0
    until timeout 20 "$ADB" logcat -d 2>/dev/null | grep -q 'Running "main"'; do
      sleep 4; n=$((n+1)); [ $n -ge 30 ] && break
    done
  else
    timeout 30 "$ADB" shell am start -n $PKG/.MainActivity > /dev/null
  fi
  sleep "${1:-7}"
}
otp_code() {
  curl -s -m 10 "http://127.0.0.1:9099/emulator/v1/projects/truco-mineiro-wjf/verificationCodes"     | python -c "import sys,json; c=json.load(sys.stdin)['verificationCodes']; print(c[-1]['code'] if c else '')"
}
clear_logs() { timeout 20 "$ADB" logcat -c; }
errors()  { timeout 25 "$ADB" logcat -d 2>/dev/null | grep -E "ReactNativeJS|FirebaseAuth|AndroidRuntime|FATAL" | grep -viE "adbd|Running \"main\"" | tail -"${1:-15}" | cut -c1-220; }

"$@"
