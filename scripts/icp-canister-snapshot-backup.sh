#!/usr/bin/env bash
# Full ICP canister snapshots: stop -> snapshot create -> start per canister; optional download.
# Controller identity required. See docs/ICP-CANISTER-SNAPSHOT-RUNBOOK.md
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ICP_DIR="$ROOT/hub/icp"

NETWORK="ic"
DOWNLOAD_ROOT=""
YES=0
CANISTERS=(hub attestation)

usage() {
  cat <<'EOF'
Usage: icp-canister-snapshot-backup.sh [options]

  Creates an on-chain snapshot per canister: stop -> snapshot create -> start.
  Default order: hub, then attestation (same as default canister list).

Options:
  --network NAME     dfx network (default: ic)
  --download-dir DIR After each create, download snapshot under DIR/<canister>-<UTC>-<snapshotId>/
  --canisters A,B    Comma-separated dfx canister names (default: hub,attestation)
  --yes              Skip interactive confirmation
  -h, --help         This help

Env:
  KNOWTATION_SNAPSHOT_YES=1   Same as --yes

Requires: dfx on PATH; identity with controller rights. Script cds to hub/icp.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --network)
      NETWORK="${2:-}"
      shift 2
      ;;
    --download-dir)
      DOWNLOAD_ROOT="${2:-}"
      shift 2
      ;;
    --canisters)
      IFS=',' read -ra CANISTERS <<<"${2:-}"
      shift 2
      ;;
    --yes)
      YES=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ "${KNOWTATION_SNAPSHOT_YES:-}" == "1" ]]; then
  YES=1
fi

if ! command -v dfx >/dev/null 2>&1; then
  echo "ERROR: dfx not on PATH. Install IC SDK: https://internetcomputer.org/docs/current/developer-docs/setup/install" >&2
  exit 1
fi

if [[ ! -d "$ICP_DIR" ]]; then
  echo "ERROR: hub/icp not found at $ICP_DIR" >&2
  exit 1
fi

if [[ "$YES" != "1" ]]; then
  echo "This will STOP each canister on network '$NETWORK' (downtime), then snapshot create, then start."
  echo "Canisters: ${CANISTERS[*]}"
  read -r -p "Continue? [y/N] " ans
  case "$ans" in
    y | Y | yes | YES) ;;
    *)
      echo "Aborted."
      exit 1
      ;;
  esac
fi

cd "$ICP_DIR"

extract_snapshot_id() {
  sed -n 's/.*[Ss]napshot ID: *\([^[:space:]]*\).*/\1/p' | tail -1
}

TS="$(date -u +%Y%m%dT%H%M%SZ)"

for c in "${CANISTERS[@]}"; do
  c="${c// /}"
  [[ -z "$c" ]] && continue
  echo "==> $c: stop"
  dfx canister stop "$c" --network "$NETWORK"
  echo "==> $c: snapshot create"
  create_out="$(dfx canister snapshot create "$c" --network "$NETWORK" 2>&1)" || {
    echo "$create_out"
    echo "ERROR: snapshot create failed for $c" >&2
    echo "Attempting start so canister is not left stopped..." >&2
    dfx canister start "$c" --network "$NETWORK" || true
    exit 1
  }
  echo "$create_out"
  sid="$(echo "$create_out" | extract_snapshot_id)"
  echo "==> $c: start"
  dfx canister start "$c" --network "$NETWORK"

  if [[ -n "$DOWNLOAD_ROOT" ]]; then
    if [[ -z "$sid" ]]; then
      echo "WARN: Could not parse snapshot id for $c; list snapshots manually:" >&2
      dfx canister snapshot list "$c" --network "$NETWORK" || true
    else
      out="${DOWNLOAD_ROOT%/}/${c}-${TS}-${sid}"
      mkdir -p "$out"
      echo "==> $c: snapshot download -> $out"
      dfx canister snapshot download "$c" "$sid" --dir "$out" --network "$NETWORK"
    fi
  fi
done

echo "icp-canister-snapshot-backup: OK"
