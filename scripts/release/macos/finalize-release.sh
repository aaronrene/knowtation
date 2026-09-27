#!/bin/bash
set -euo pipefail

dist=""
key_file=""
key_id=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dist) dist="$2"; shift 2 ;;
    --key-file) key_file="$2"; shift 2 ;;
    --key-id) key_id="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

[[ -d "$dist" && -f "$key_file" ]] || { echo "--dist and --key-file are required" >&2; exit 2; }
[[ -n "$key_id" && "$key_id" != *'<'* ]] || { echo "real update key ID required" >&2; exit 1; }
repo_root="$(cd "$(dirname "$0")/../../.." && pwd)"

node "$repo_root/scripts/release/macos/sign-update-manifest.mjs" \
  --manifest "$dist/release-manifest.json" \
  --key-file "$key_file" \
  --key-id "$key_id" \
  --output "$dist/release-manifest.sig"

(
  cd "$dist"
  shasum -a 256 \
    Knowtation-0.1.0-100-macos-arm64.zip \
    Knowtation-0.1.0-100-macos-arm64.pkg \
    release-manifest.json \
    release-manifest.sig \
    sbom.spdx.json \
    LICENSE \
    THIRD-PARTY-NOTICES.txt > SHA256SUMS
)
echo "$dist/SHA256SUMS"
