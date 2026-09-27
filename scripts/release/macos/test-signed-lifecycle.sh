#!/bin/bash
set -euo pipefail

app="/Applications/Knowtation.app"
runtime_pattern='/Applications/Knowtation.app/Contents/Resources/runtime/node/bin/node .*/companion/runtime/main.mjs --mode app'
[[ -d "$app" ]] || { echo "installed signed app is required" >&2; exit 2; }

wait_for_runtime() {
  local attempt
  for attempt in {1..40}; do
    if pgrep -f "$runtime_pattern" >/dev/null; then return 0; fi
    sleep 0.25
  done
  echo "app runtime did not start" >&2
  return 1
}

wait_for_stop() {
  local attempt
  for attempt in {1..40}; do
    if ! pgrep -f "$runtime_pattern" >/dev/null; then return 0; fi
    sleep 0.25
  done
  echo "app runtime did not stop with its parent" >&2
  return 1
}

open -a "$app"
wait_for_runtime
/usr/local/bin/knowtation companion status
launchctl print "gui/$UID/store.knowtation.companion.custody" >/dev/null

osascript -e 'tell application id "store.knowtation.companion" to quit'
wait_for_stop

open -a "$app"
wait_for_runtime
/usr/local/bin/knowtation companion status

echo "signed lifecycle start, custody registration, parent shutdown, and restart passed"
