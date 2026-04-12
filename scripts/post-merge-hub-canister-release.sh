#!/usr/bin/env bash
#
# Post-merge hub canister release (mainnet) when Netlify + 4Everland auto-deploy on push to main.
#
# Problem: merging to main may deploy the new gateway/UI before the canister is upgraded. Run this
# script immediately after merge (same machine as dfx + mainnet identity) to:
#   1) Sync to latest main (optional)
#   2) Run full preflight: migration checks, npm test, dfx build, optional JSON export backup
#   3) Optionally run dfx deploy (opt-in)
#   4) Optionally run read-only hosted API snapshot verify
#
# Usage (repo root):
#   npm run release:post-merge-canister
#   npm run release:post-merge-canister -- --sync-main
#
# Recommended .env (repo root; never commit secrets):
#   KNOWTATION_CANISTER_BACKUP_USER_ID=google:…   # or github:… — required for backup step
#   KNOWTATION_CANISTER_URL=https://<id>.icp0.io # optional; defaults from hub/icp/canister_ids.json
#   KNOWTATION_CANISTER_BACKUP_VAULT_ID=default  # optional
#
# Optional:
#   RUN_DFX_DEPLOY=1              — after preflight succeeds, run: dfx deploy hub --network ic (hub/icp)
#   DFX_DEPLOY_IDENTITY=name      — if set, runs: dfx identity use "$DFX_DEPLOY_IDENTITY" before deploy
#   RUN_POST_VERIFY_SNAPSHOT=1    — after deploy block, run npm run verify:hosted-api; set in same shell:
#                                   KNOWTATION_HUB_SNAPSHOT_ONLY=1 (and KNOWTATION_HUB_API if not default)
#   SKIP_NPM_TEST=1 SKIP_DFX_BUILD=1 — passed through to canister-predeploy (escape hatches)
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

export NO_COLOR="${NO_COLOR:-}"
export CI="${CI:-}"
export TERM="${TERM:-}"

SYNC_MAIN=0
for arg in "$@"; do
  case "$arg" in
    --sync-main) SYNC_MAIN=1 ;;
    -h | --help)
      sed -n '2,45p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Unknown option: $arg (use --sync-main or --help)"
      exit 1
      ;;
  esac
done

if [[ "$SYNC_MAIN" == 1 ]]; then
  echo "==> [0] Git: checkout main and pull (requires clean working tree)"
  if [[ -n "$(git status --porcelain 2>/dev/null)" ]]; then
    echo "ERROR: Working tree is not clean. Commit, stash, or discard changes, then retry."
    exit 1
  fi
  git fetch origin main
  git checkout main
  git pull origin main
  echo "    Branch: $(git branch --show-current) @ $(git rev-parse --short HEAD)"
fi

echo "==> [1] Preflight + backup (canister-predeploy.sh)"
bash "$REPO_ROOT/scripts/canister-predeploy.sh"

echo ""
echo "==> [2] Mainnet deploy (manual unless RUN_DFX_DEPLOY=1)"
ICP_DIR="$REPO_ROOT/hub/icp"
if [[ "${RUN_DFX_DEPLOY:-}" == "1" ]]; then
  if ! command -v dfx >/dev/null 2>&1; then
    echo "ERROR: dfx not on PATH."
    exit 1
  fi
  cd "$ICP_DIR"
  if [[ -n "${DFX_DEPLOY_IDENTITY:-}" ]]; then
    echo "    dfx identity use ${DFX_DEPLOY_IDENTITY}"
    dfx identity use "$DFX_DEPLOY_IDENTITY"
  fi
  echo "    dfx deploy hub --network ic"
  dfx deploy hub --network ic
  cd "$REPO_ROOT"
  echo "    Canister deploy finished."
else
  echo "    Next (you run):"
  echo "      cd hub/icp && dfx identity use <your-deploy-identity> && dfx deploy hub --network ic"
  echo "    Or re-run with: RUN_DFX_DEPLOY=1 DFX_DEPLOY_IDENTITY=<name> npm run release:post-merge-canister"
fi

echo ""
echo "==> [3] After Netlify + 4Everland finish: smoke / test flight"
echo "    - Wait for production Netlify + 4Everland deploys to complete (dashboards)."
echo "    - Do NOT set KNOWTATION_HUB_PROPOSAL_ENRICH=1 on the gateway until the canister above is upgraded."
echo "    - Read-only snapshot (no JWT):"
echo "        KNOWTATION_HUB_SNAPSHOT_ONLY=1 KNOWTATION_HUB_API=https://<your-gateway-origin> npm run verify:hosted-api"
echo "    - Optional multi-vault smoke (writes test notes — avoid production unless intended):"
echo "        See docs/DEPLOY-HOSTED.md §5.1 and: npm run smoke:hosted-multi-vault"
echo "    - Manual: Hub login → open a proposal → Enrich (AI) with enrich env ON."
echo ""
if [[ "${RUN_POST_VERIFY_SNAPSHOT:-}" == "1" ]]; then
  echo "==> [3b] RUN_POST_VERIFY_SNAPSHOT=1 — npm run verify:hosted-api"
  if [[ "${KNOWTATION_HUB_SNAPSHOT_ONLY:-}" != "1" ]]; then
    echo "WARN: Set KNOWTATION_HUB_SNAPSHOT_ONLY=1 for read-only snapshot. Running anyway if script honors .env."
  fi
  npm run verify:hosted-api
fi

echo ""
echo "post-merge-hub-canister-release: done."
