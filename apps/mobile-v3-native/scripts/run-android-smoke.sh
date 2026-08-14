#!/usr/bin/env bash
set -euo pipefail

apk="apps/mobile-v3-native/android/app/build/outputs/apk/debug/app-debug.apk"
test -s "$apk"
mkdir -p artifacts

adb install -r "$apk"
adb logcat -c
adb shell am force-stop live.esports.arena
adb shell monkey -p live.esports.arena -c android.intent.category.LAUNCHER 1
sleep 8

pid="$(adb shell pidof live.esports.arena | tr -d '\r')"
test -n "$pid"
adb forward tcp:9222 "localabstract:webview_devtools_remote_$pid"

set +e
ARENA_ANDROID_WEBVIEW_REPORT="artifacts/android-smoke-webview.json" \
  node apps/mobile-v3-native/scripts/verify-android-webview.mjs
smoke_status=$?
set -e

adb exec-out screencap -p > artifacts/android-smoke-screen.png
adb logcat -d > artifacts/android-smoke-logcat.txt || true
adb forward --remove tcp:9222 || true
exit "$smoke_status"
