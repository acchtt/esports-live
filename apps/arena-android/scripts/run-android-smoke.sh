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

if ! adb logcat -d -s ARENA:I '*:S' | grep -Fq 'ARENA_SCHEDULE_STATE_SAFE futureFinals=0'; then
  echo "The native schedule still contains a future match marked Final."
  adb logcat -d > "$artifact_dir/android-smoke-logcat.txt"
  exit 1
fi

tap_text() {
  local label="$1"
  adb shell uiautomator dump --compressed /sdcard/arena-tap.xml >/dev/null
  adb pull /sdcard/arena-tap.xml "$artifact_dir/android-smoke-tap.xml" >/dev/null
  local coordinates
  coordinates="$(LABEL="$label" XML_PATH="$artifact_dir/android-smoke-tap.xml" node <<'NODE'
  const fs = require('node:fs');
  const xml = fs.readFileSync(process.env.XML_PATH, 'utf8');
  const label = process.env.LABEL;
  const nodes = xml.match(/<node\b[^>]*>/g) || [];
  const target = nodes.find(node => {
    const text = node.match(/text="([^"]*)"/)?.[1] || '';
    return text.includes(label);
  });
  const bounds = target?.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
  if (!bounds) process.exit(1);
  process.stdout.write(`${Math.floor((Number(bounds[1]) + Number(bounds[3])) / 2)} ${Math.floor((Number(bounds[2]) + Number(bounds[4])) / 2)}`);
NODE
)"
  test -n "$coordinates"
  adb shell input tap $coordinates
}

tap_text "Results"
sleep 2
tap_text "MATCH CENTER"

scoreboard_ready=false
for attempt in {1..30}; do
  if adb logcat -d -s ARENA:I '*:S' | grep -Fq 'ARENA_V3_SCOREBOARD_READY'; then
    scoreboard_ready=true
    break
  fi
  sleep 2
done

if [[ "$scoreboard_ready" != "true" ]]; then
  echo "The current v3 scoreboard did not render game telemetry."
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

echo "Native ARENA UI rendered, rejected future finals, and opened the v3 scoreboard."
