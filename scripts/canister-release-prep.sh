#!/usr/bin/env bash
#
# One-shot preparation before upgrading the hub canister on mainnet.
# Runs: optional git sync → migration shape check → npm test → dfx build → optional vault export backup.
# Does NOT run dfx deploy (you run that after this succeeds).
#
# Usage (from anywhere):
#   cd /path/to/knowtation
#   npm run canister:release-prep
#
# Sync to latest main first (fails if working tree is not clean):
#   npm run canister:release-prep -- --sync-main
#
# Environment (optional; also loaded from repo-root .env if present):
#   KNOWTATION_CANISTER_URL          — e.g. https://<canister-id>.icp0.io (no trailing slash)
#   KNOWTATION_CANISTER_BACKUP_USER_ID — Hub user id (e.g. google:123) for GET /api/v1/export backup
#   KNOWTATION_CANISTER_BACKUP_VAULT_ID — default: default
#
# If BACKUP_USER_ID is set but URL is not, the script defaults URL from hub/icp/canister_ids.json (ic + .icp0.io).
#
# Escape hatches (passed through to canister-predeploy.sh):
#   SKIP_NPM_TEST=1 npm run canister:release-prep
#   SKIP_DFX_BUILD=1 npm run canister:release-prep
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
      sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Unknown option: $arg (use --sync-main or --help)"
      exit 1
      ;;
  esac
done

if [[ -f "$REPO_ROOT/.env" ]]; then
  echo "==> Loading repo-root .env (for backup / tool env)"
  set -a
  # shellcheck disable=SC1091
  source "$REPO_ROOT/.env"
  set +a
fi

if [[ "$SYNC_MAIN" == 1 ]]; then
  echo "==> [0/5] Git: checkout main and pull (requires clean working tree)"
  if [[ -n "$(git status --porcelain 2>/dev/null)" ]]; then
    echo "ERROR: Working tree is not clean. Commit, stash, or discard changes, then retry."
    exit 1
  fi
  git fetch origin main
  git checkout main
  git pull origin main
  echo "    On branch $(git branch --show-current) @ $(git rev-parse --short HEAD)"
fi

if [[ -n "${KNOWTATION_CANISTER_BACKUP_USER_ID:-}" && -z "${KNOWTATION_CANISTER_URL:-}" ]]; then
  echo "==> Defaulting KNOWTATION_CANISTER_URL from hub/icp/canister_ids.json"
  KNOWTATION_CANISTER_URL="$(
    node -e "
      const fs = require('fs');
      const p = 'hub/icp/canister_ids.json';
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      const id = j.hub && j.hub.ic;
      if (!id) throw new Error('Missing hub.ic in canister_ids.json');
      process.stdout.write('https://' + id + '.icp0.io');
    "
  )"
  export KNOWTATION_CANISTER_URL
  echo "    Using: $KNOWTATION_CANISTER_URL (override KNOWTATION_CANISTER_URL if your gateway uses another host)"
fi

echo "==> [1–4/5] canister-predeploy (migration + tests + dfx build + optional backup)"
bash "$REPO_ROOT/scripts/canister-predeploy.sh"

echo ""
echo "==> [5/5] Done. When ready to upgrade mainnet:"
echo "    cd hub/icp && dfx identity use <your-deploy-identity> && dfx deploy hub --network ic"
