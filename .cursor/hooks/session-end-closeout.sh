#!/bin/sh
# sessionEnd hook — governance-sync dry-run summary + CURRENT NEXT (§LT.4.5, fail-open).

find_ok() {
  if [ -n "$OVERSEER_OK" ] && [ -x "$OVERSEER_OK" ]; then
    printf '%s\n' "$OVERSEER_OK"
    return 0
  fi
  if [ -x "./cli/ok" ]; then
    printf '%s\n' "./cli/ok"
    return 0
  fi
  if command -v ok >/dev/null 2>&1; then
    printf '%s\n' "ok"
    return 0
  fi
  return 1
}

OK=$(find_ok) || {
  printf '%s\n' '{"followup_message":"ok CLI not found"}'
  exit 0
}

DRY=$("$OK" governance-sync --dry-run 2>&1) || DRY="$DRY"
NEXT=$("$OK" next 2>&1) || NEXT="$NEXT"

export LT_HOOK_DRY="$DRY"
export LT_HOOK_NEXT="$NEXT"

if command -v python3 >/dev/null 2>&1; then
  python3 - <<'PY' || true
import json
import os

dry = os.environ.get("LT_HOOK_DRY", "").strip()
nxt = os.environ.get("LT_HOOK_NEXT", "").strip()
summary = dry.splitlines()[0] if dry else "governance-sync dry-run complete"
body = summary
if nxt:
    body = f"{summary}\n\n{nxt}"
print(json.dumps({"followup_message": body}))
PY
else
  printf '%s\n' '{"followup_message":"governance-sync dry-run (python3 unavailable)"}'
fi

exit 0
