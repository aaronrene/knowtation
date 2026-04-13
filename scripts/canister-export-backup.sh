#!/usr/bin/env bash
# Thin wrapper: operator backup (notes + proposals, optional encrypt + S3) runs in Node.
# See scripts/canister-export-backup.mjs and docs/DEPLOY-HOSTED.md §6.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$SCRIPT_DIR/canister-export-backup.mjs"
