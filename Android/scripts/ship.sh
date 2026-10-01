#!/usr/bin/env bash
# Build a standalone release APK and push it straight to a connected phone.
#
#   npm run ship            build, install, launch
#   npm run ship -- --fast  skip the build, install the APK that's already there
#
# Works over USB or wireless debugging. For wireless, pair once (see the hint
# printed when no device is found) and the phone stays paired across reboots of
# this script — so day to day this is a single command with no cable and no
# file transfer.
set -euo pipefail

cd "$(dirname "$0")/.."
APK="android/app/build/outputs/apk/release/app-release.apk"
PKG="com.runturfing.app"

devices=$(adb devices | awk 'NR>1 && $2=="device" {print $1}')
if [ -z "$devices" ]; then
  cat <<'EOF'
No device connected.

USB:      plug the phone in, enable Developer options > USB debugging,
          and accept the "Allow USB debugging" prompt on the phone.

Wireless: on the phone, Developer options > Wireless debugging > Pair device
          with pairing code. Then, once, on this machine:

            adb pair <phone-ip>:<pairing-port>     # port from the pairing dialog
            adb connect <phone-ip>:<debug-port>    # port from the main screen

          Both ports are shown on the phone; they are different numbers.
EOF
  exit 1
fi

count=$(echo "$devices" | wc -l | tr -d ' ')
echo "Target device(s): $(echo "$devices" | tr '\n' ' ')"

if [ "${1:-}" != "--fast" ]; then
  echo "Building release APK..."
  (cd android && ./gradlew assembleRelease)
fi

if [ ! -f "$APK" ]; then
  echo "No APK at $APK — run without --fast to build one." >&2
  exit 1
fi

echo "Installing $(du -h "$APK" | cut -f1) to $count device(s)..."
for d in $devices; do
  adb -s "$d" install -r "$APK"
  adb -s "$d" shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 || true
done

echo "Done. App launched on $count device(s)."
