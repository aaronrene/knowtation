#!/usr/bin/env bash
# Safe preflight before `dfx deploy` for hub/icp.
#
# What it does:
#   1. Static migration / actor contract checks (scripts/verify-canister-migration.mjs)
#   2. npm test (skip with SKIP_NPM_TEST=1)
#   3. dfx build hub (compiles Motoko; catches type errors before touching mainnet)
#   4. Optional: JSON export backup to ./backups/ (see env vars below)
#
# What it does NOT do: run deploy or upgrade. You still run `dfx deploy --network ic` yourself.
#
# Optional backup (recommended before mainnet upgrade if you have real user data):
#   export KNOWTATION_CANISTER_URL='https://<canister-id>.icp0.io'   # no trailing slash
#   export KNOWTATION_CANISTER_BACKUP_USER_ID='google:123'           # sub you use on hosted
#   export KNOWTATION_CANISTER_BACKUP_VAULT_ID='default'             # optional, default default
#
# If dfx crashes on "ColorOutOfRange", upgrade dfx or try another terminal; or run checks only:
#   SKIP_DFX_BUILD=1 ./scripts/canister-predeploy.sh
#
# dfx build defaults to the **local** network; this repo only lists mainnet in canister_ids.json,
# so without a local `dfx canister create hub` you get "Cannot find canister id". Preflight uses
# **ic** by default. Override: DFX_PREFLIGHT_NETWORK=local (after `dfx start` + `dfx canister create hub`).
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

export NO_COLOR="${NO_COLOR:-}"
export CI="${CI:-}"
export TERM="${TERM:-}"

echo "==> [1/4] Migration / stable-shape contract (Node)"
node "$REPO_ROOT/scripts/verify-canister-migration.mjs"

if [[ "${SKIP_NPM_TEST:-}" != "1" ]]; then
  echo "==> [2/4] npm test (set SKIP_NPM_TEST=1 to skip)"
  npm test
else
  echo "==> [2/4] npm test SKIPPED (SKIP_NPM_TEST=1)"
fi

DFX_PREFLIGHT_NETWORK="${DFX_PREFLIGHT_NETWORK:-ic}"
echo "==> [3/4] dfx build hub (--network $DFX_PREFLIGHT_NETWORK)"
ICP_DIR="$REPO_ROOT/hub/icp"
if [[ "${SKIP_DFX_BUILD:-}" == "1" ]]; then
  echo "    SKIPPED (SKIP_DFX_BUILD=1) — run 'cd hub/icp && dfx build hub --network ic' before mainnet deploy."
else
  if ! command -v dfx >/dev/null 2>&1; then
    echo "ERROR: dfx not on PATH. Install the IC SDK: https://internetcomputer.org/docs/current/developer-docs/setup/install"
    exit 1
  fi
  if ! ( cd "$ICP_DIR" && dfx build hub --network "$DFX_PREFLIGHT_NETWORK" ); then
    echo "ERROR: dfx build failed. If you see 'ColorOutOfRange', update dfx or use SKIP_DFX_BUILD=1 after building in a working environment."
    echo "       If you see 'Cannot find canister id' on network local, run: cd hub/icp && dfx canister create hub"
    echo "       Or preflight against mainnet id: DFX_PREFLIGHT_NETWORK=ic npm run canister:preflight"
    exit 1
  fi
  WASM_OUT="$ICP_DIR/.dfx/$DFX_PREFLIGHT_NETWORK/canisters/hub/hub.wasm"
  if [[ -f "$WASM_OUT" ]]; then
    echo "    Built wasm: $WASM_OUT ($(wc -c < "$WASM_OUT" | tr -d ' ') bytes)"
  else
    echo "WARN: Expected wasm not found at $WASM_OUT (dfx output layout may differ)."
  fi
fi

echo "==> [4/4] Optional canister export backup"
BACKUP_DIR="$REPO_ROOT/backups"
mkdir -p "$BACKUP_DIR"
if [[ -n "${KNOWTATION_CANISTER_URL:-}" && -n "${KNOWTATION_CANISTER_BACKUP_USER_ID:-}" ]]; then
  BASE="${KNOWTATION_CANISTER_URL%/}"
  VID="${KNOWTATION_CANISTER_BACKUP_VAULT_ID:-default}"
  STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
  OUT="$BACKUP_DIR/canister-export-${STAMP}.json"
  echo "    Fetching GET $BASE/api/v1/export (X-User-Id + X-Vault-Id=$VID) -> $OUT"
  if curl -fsS -o "$OUT" \
    -H "X-User-Id: ${KNOWTATION_CANISTER_BACKUP_USER_ID}" \
    -H "X-Vault-Id: ${VID}" \
    -H "Accept: application/json" \
    "$BASE/api/v1/export"; then
    echo "    Backup written ($(wc -c < "$OUT" | tr -d ' ') bytes)."
  else
    echo "ERROR: Backup curl failed. Fix URL/auth or unset backup env vars."
    exit 1
  fi
else
  echo "    Skipped (set KNOWTATION_CANISTER_URL + KNOWTATION_CANISTER_BACKUP_USER_ID to export one vault to ./backups/)"
fi

echo ""
echo "canister-predeploy: OK. Next (you run manually): cd hub/icp && dfx deploy --network ic"
echo "Read docs/HOSTED-STORAGE-BILLING-ROADMAP.md before changing stable types."
