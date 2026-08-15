#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
apk="$repo_root/apps/arena-android/app/build/outputs/apk/debug/app-debug.apk"
artifact_dir="$repo_root/artifacts"

test -s "$apk"
mkdir -p "$artifact_dir"

adb logcat -c
adb install -r "$apk"
adb shell am force-stop live.esports.arena
adb shell am start -W -n live.esports.arena/.MainActivity | tee "$artifact_dir/android-smoke-launch.txt"

ready=false
for attempt in {1..30}; do
  if adb logcat -d -s ARENA:I '*:S' | grep -Fq 'ARENA_NATIVE_UI_READY'; then
    ready=true
    break
  fi
  sleep 2
done

if [[ "$ready" != "true" ]]; then
  echo "Native ARENA activity did not report its first frame."
  adb logcat -d > "$artifact_dir/android-smoke-logcat.txt"
  exit 1
fi

result_ready=false
for attempt in {1..30}; do
  if adb logcat -d -s ARENA:I '*:S' \
    | grep -Eq 'ARENA_RESULT_ENRICHED.*score=([1-9][0-9]*-[0-9]+|[0-9]+-[1-9][0-9]*)'; then
    result_ready=true
    break
  fi
  sleep 2
done

if [[ "$result_ready" != "true" ]]; then
  echo "Completed LoL results were not enriched with a final score."
  adb logcat -d > "$artifact_dir/android-smoke-logcat.txt"
  exit 1
fi

adb shell uiautomator dump --compressed /sdcard/arena-window.xml
adb pull /sdcard/arena-window.xml "$artifact_dir/android-smoke-window.xml"
grep -Eq 'ARENA_NATIVE_UI_READY|text="ARENA"' "$artifact_dir/android-smoke-window.xml"

adb exec-out screencap -p > "$artifact_dir/android-smoke-native-ui.png"
test "$(stat -c '%s' "$artifact_dir/android-smoke-native-ui.png")" -gt 10000

adb shell dumpsys activity activities > "$artifact_dir/android-smoke-activities.txt"
grep -Eq 'topResumedActivity=ActivityRecord|ResumedActivity: ActivityRecord' "$artifact_dir/android-smoke-activities.txt"
grep -Fq 'live.esports.arena/.MainActivity' "$artifact_dir/android-smoke-activities.txt"

adb logcat -d > "$artifact_dir/android-smoke-logcat.txt"
if grep -E 'FATAL EXCEPTION|ANR in live\.esports\.arena' "$artifact_dir/android-smoke-logcat.txt"; then
  echo "Native ARENA process crashed or stopped responding."
  exit 1
fi

echo "Native ARENA UI rendered, loaded a final score, and remained responsive."
