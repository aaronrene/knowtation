#!/bin/sh
# sessionStart / stop hook — print CURRENT NEXT from disk (§LT.4.5, fail-open).

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
  printf '%s\n' '{"additional_context":"ok CLI not found","followup_message":"ok CLI not found"}'
  exit 0
}

NEXT=$("$OK" next 2>&1) || true

WORKSPACE='Open the repository root (the folder that contains `.overseer/`) as the IDE workspace. If you open a parent folder, project rules and skills under `.cursor/` often do not load. The CLI still works. The open editor tab is not the source of truth — run `ok next`.'

STALE='If an editor tab of the handover looks old, close it and reopen it. The kit cannot reload the tab. Trust `ok next`, not the tab.'

export LT_HOOK_NEXT="$NEXT"
export LT_HOOK_WORKSPACE="$WORKSPACE"
export LT_HOOK_STALE="$STALE"

if command -v python3 >/dev/null 2>&1; then
  python3 - <<'PY' || true
import json
import os

body = "\n\n".join(
    part
    for part in (
        os.environ.get("LT_HOOK_NEXT", ""),
        os.environ.get("LT_HOOK_WORKSPACE", ""),
        os.environ.get("LT_HOOK_STALE", ""),
    )
    if part
)
print(json.dumps({"additional_context": body, "followup_message": body}))
PY
else
  printf '%s\n' '{"additional_context":"ok next (python3 unavailable)","followup_message":"ok next (python3 unavailable)"}'
fi

exit 0
