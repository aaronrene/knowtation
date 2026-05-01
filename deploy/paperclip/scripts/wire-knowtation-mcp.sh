#!/usr/bin/env bash
######################################################################
# wire-knowtation-mcp.sh
#
# Smoke-tests that Paperclip can talk to the hosted Knowtation Hub via
# its REST API (the same endpoints the 5 skills use).
#
# Runs three checks against the Hub:
#   1. semantic search returns 2xx
#   2. get_note for the Born Free style guide returns 2xx
#   3. list_notes for the Born Free project returns 2xx
#
# If any of these fail, do NOT run load-skills-and-agents.sh — fix the
# Hub URL / JWT / vault ID first via push-secrets.sh.
#
# Run AS the paperclip user:
#   sudo -u paperclip /opt/paperclip/scripts/wire-knowtation-mcp.sh
######################################################################

set -euo pipefail

ENV_FILE=/etc/paperclip/env
if [[ ! -r "$ENV_FILE" ]]; then
  echo "FAIL: $ENV_FILE not readable. Run push-secrets.sh first."
  exit 1
fi

# shellcheck disable=SC1090
set -a
source "$ENV_FILE"
set +a

REQUIRED=(KNOWTATION_HUB_URL KNOWTATION_HUB_JWT KNOWTATION_VAULT_ID)
for v in "${REQUIRED[@]}"; do
  if [[ -z "${!v:-}" ]]; then
    echo "FAIL: $v missing in $ENV_FILE. Run push-secrets.sh."
    exit 1
  fi
done

H_AUTH="Authorization: Bearer $KNOWTATION_HUB_JWT"
H_VAULT="X-Vault-Id: $KNOWTATION_VAULT_ID"
H_USER="X-User-Id: paperclip"

PASS=0
FAIL=0

check() {
  local name="$1"
  local status="$2"
  if [[ "$status" =~ ^2[0-9][0-9]$ ]]; then
    echo "  [PASS] $name (HTTP $status)"
    PASS=$((PASS + 1))
  else
    echo "  [FAIL] $name (HTTP $status)"
    FAIL=$((FAIL + 1))
  fi
}

echo "[wire-knowtation] Testing Hub connectivity at $KNOWTATION_HUB_URL"
echo "                  vault: $KNOWTATION_VAULT_ID"
echo ""

# 1. Semantic search
STATUS=$(curl -s -o /tmp/wire-1.json -w '%{http_code}' \
  -X POST "$KNOWTATION_HUB_URL/api/v1/search" \
  -H "$H_AUTH" -H "$H_VAULT" -H "$H_USER" \
  -H "Content-Type: application/json" \
  -d '{"query":"test","mode":"semantic","limit":1}' \
  --max-time 15) || STATUS="000"
check "search (POST /api/v1/search)" "$STATUS"

# 2. get_note for Born Free style guide
STATUS=$(curl -s -o /tmp/wire-2.json -w '%{http_code}' \
  "$KNOWTATION_HUB_URL/api/v1/notes/projects%2Fborn-free%2Fstyle-guide%2Fvoice-and-boundaries.md" \
  -H "$H_AUTH" -H "$H_VAULT" -H "$H_USER" \
  --max-time 15) || STATUS="000"
check "get_note (born-free style-guide)" "$STATUS"

# 3. list_notes for Born Free project
STATUS=$(curl -s -o /tmp/wire-3.json -w '%{http_code}' \
  "$KNOWTATION_HUB_URL/api/v1/notes?project=born-free&limit=5" \
  -H "$H_AUTH" -H "$H_VAULT" -H "$H_USER" \
  --max-time 15) || STATUS="000"
check "list_notes (project=born-free)" "$STATUS"

echo ""
echo "[wire-knowtation] $PASS passed, $FAIL failed"

if [[ "$FAIL" -gt 0 ]]; then
  echo ""
  echo "Likely cause: 401 → JWT expired (default 24h). Copy a fresh JWT from"
  echo "Hub UI → Settings → Integrations → Hub API, then push-secrets.sh."
  echo ""
  echo "Or: 404 → Hub URL wrong, or the Born Free style guide note does not exist yet."
  echo "Verify in Hub UI that vault/projects/born-free/style-guide/voice-and-boundaries.md is present."
  rm -f /tmp/wire-1.json /tmp/wire-2.json /tmp/wire-3.json
  exit 1
fi

rm -f /tmp/wire-1.json /tmp/wire-2.json /tmp/wire-3.json
echo "[wire-knowtation] PASS — Paperclip can read/search the Knowtation Hub."
exit 0
