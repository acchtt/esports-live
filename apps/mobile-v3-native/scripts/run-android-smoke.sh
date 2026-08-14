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
adb shell uiautomator dump /sdcard/arena-window.xml >/dev/null 2>&1 || true
adb pull /sdcard/arena-window.xml artifacts/android-smoke-window.xml >/dev/null 2>&1 || true
adb shell dumpsys activity activities > artifacts/android-smoke-activity.txt
adb logcat -d > artifacts/android-smoke-logcat.txt
exit "$smoke_status"
