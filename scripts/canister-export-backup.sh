#!/usr/bin/env bash
# Export hub canister vault(s) to JSON via GET /api/v1/export (same contract as canister-predeploy.sh).
#
# Usage (repo root):
#   KNOWTATION_CANISTER_BACKUP_USER_ID='google:…' bash scripts/canister-export-backup.sh
#
# Environment:
#   KNOWTATION_CANISTER_BACKUP_USER_ID — required; sent as X-User-Id
#   KNOWTATION_CANISTER_URL — base URL, no trailing slash (e.g. https://<id>.icp0.io)
#   KNOWTATION_CANISTER_BACKUP_URL — alias for KNOWTATION_CANISTER_URL (e.g. GitHub Actions secret name)
#   KNOWTATION_CANISTER_BACKUP_VAULT_ID — single vault (default: default)
#   KNOWTATION_CANISTER_BACKUP_VAULT_IDS — comma-separated vault ids (overrides VAULT_ID when set)
#   KNOWTATION_CANISTER_BACKUP_DIR — output directory (default: <repo>/backups)
#
# If URL is unset but BACKUP_USER_ID is set, URL defaults from hub/icp/canister_ids.json (same as preflight).
#
# Output files: backups/canister-export-<sanitized-vault>-<UTC-stamp>.json
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

if [[ -f "$REPO_ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$REPO_ROOT/.env"
  set +a
fi

if [[ -z "${KNOWTATION_CANISTER_BACKUP_USER_ID:-}" ]]; then
  echo "ERROR: KNOWTATION_CANISTER_BACKUP_USER_ID is required." >&2
  exit 1
fi

# Normalize URL alias (CI secrets)
if [[ -n "${KNOWTATION_CANISTER_BACKUP_URL:-}" && -z "${KNOWTATION_CANISTER_URL:-}" ]]; then
  export KNOWTATION_CANISTER_URL="$KNOWTATION_CANISTER_BACKUP_URL"
fi

if [[ -n "${KNOWTATION_CANISTER_BACKUP_USER_ID:-}" && -z "${KNOWTATION_CANISTER_URL:-}" ]]; then
  echo "==> Defaulting KNOWTATION_CANISTER_URL from hub/icp/canister_ids.json"
  if ! KNOWTATION_CANISTER_URL="$(
    node --input-type=module -e "
      import { hubBaseUrlFromCanisterIds } from './lib/canister-export-env.mjs';
      process.stdout.write(hubBaseUrlFromCanisterIds(process.cwd()));
    "
  )"; then
    echo "ERROR: Could not read hub canister id from hub/icp/canister_ids.json. Set KNOWTATION_CANISTER_URL." >&2
    exit 1
  fi
  export KNOWTATION_CANISTER_URL
  echo "    Using: $KNOWTATION_CANISTER_URL"
fi

BASE="${KNOWTATION_CANISTER_URL%/}"
BACKUP_DIR="${KNOWTATION_CANISTER_BACKUP_DIR:-$REPO_ROOT/backups}"
mkdir -p "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

VAULT_ARR=()
while IFS= read -r line; do
  [[ -n "$line" ]] && VAULT_ARR+=("$line")
done < <(
  node --input-type=module -e "
    import { parseBackupVaultIds } from './lib/canister-export-env.mjs';
    for (const id of parseBackupVaultIds(process.env)) console.log(id);
  "
)

if [[ ${#VAULT_ARR[@]} -eq 0 ]]; then
  echo "ERROR: No vault ids to export (check KNOWTATION_CANISTER_BACKUP_VAULT_IDS / VAULT_ID)." >&2
  exit 1
fi

for vid in "${VAULT_ARR[@]}"; do
  [[ -z "$vid" ]] && continue
  safe="$(printf '%s' "$vid" | tr '/:' '__')"
  OUT="$BACKUP_DIR/canister-export-${safe}-${STAMP}.json"
  echo "==> GET $BASE/api/v1/export (X-Vault-Id=$vid) -> $OUT"
  curl -fsS -o "$OUT" \
    -H "X-User-Id: ${KNOWTATION_CANISTER_BACKUP_USER_ID}" \
    -H "X-Vault-Id: $vid" \
    -H "Accept: application/json" \
    "$BASE/api/v1/export"
  echo "    Wrote $(wc -c <"$OUT" | tr -d ' ') bytes."
done

echo "canister-export-backup: OK ($STAMP)"
