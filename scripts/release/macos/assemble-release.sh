#!/bin/bash
set -euo pipefail

app=""
package_file=""
output=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --app) app="$2"; shift 2 ;;
    --package) package_file="$2"; shift 2 ;;
    --output) output="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

[[ -d "$app" && -f "$package_file" && -n "$output" ]] || {
  echo "--app, --package, and --output are required" >&2; exit 2;
}
repo_root="$(cd "$(dirname "$0")/../../.." && pwd)"
release="$(node -p "require('$repo_root/release/macos/release.json').version")"
build="$(node -p "require('$repo_root/release/macos/release.json').build")"
architecture="$(node -p "require('$repo_root/release/macos/release.json').architectures[0]")"
base="Knowtation-$release-$build-macos-$architecture"

rm -rf "$output"
mkdir -p "$output"
ditto -c -k --sequesterRsrc --keepParent "$app" "$output/$base.zip"
cp "$package_file" "$output/$base.pkg"
cp "$app/Contents/Resources/sbom.spdx.json" "$output/sbom.spdx.json"
cp "$repo_root/LICENSE" "$output/LICENSE"
cp "$app/Contents/Resources/THIRD-PARTY-NOTICES.txt" "$output/THIRD-PARTY-NOTICES.txt"

node "$repo_root/scripts/release/macos/generate-manifest.mjs" \
  --stage final \
  --dist "$output" \
  --output "$output/release-manifest.json"
echo "$output"
