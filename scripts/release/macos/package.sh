#!/bin/bash
set -euo pipefail

app=""
identity=""
output=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --app) app="$2"; shift 2 ;;
    --installer-identity) identity="$2"; shift 2 ;;
    --output) output="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

[[ -d "$app" && -n "$output" ]] || { echo "--app and --output are required" >&2; exit 2; }
[[ -n "$identity" && "$identity" != *'<'* ]] || { echo "real Developer ID Installer identity required" >&2; exit 1; }
codesign --verify --deep --strict "$app"

repo_root="$(cd "$(dirname "$0")/../../.." && pwd)"
node "$repo_root/scripts/release/macos/verify-runtime-manifest.mjs" \
  --app "$app" --require-committed-source
release_version="$(node -p "require('$repo_root/release/macos/release.json').version")"
release_build="$(node -p "require('$repo_root/release/macos/release.json').build")"
package_work="$repo_root/build/phase7/package"
payload="$package_work/payload"
rm -rf "$package_work"
mkdir -p "$payload/Applications" "$payload/usr/local/bin" "$(dirname "$output")"
ditto "$app" "$payload/Applications/Knowtation.app"
cp "$app/Contents/Helpers/knowtation" "$payload/usr/local/bin/knowtation"
cp "$app/Contents/Helpers/knowtation-mcp" "$payload/usr/local/bin/knowtation-mcp"
chmod 755 "$payload/usr/local/bin/knowtation" "$payload/usr/local/bin/knowtation-mcp"

pkgbuild \
  --root "$payload" \
  --scripts "$repo_root/release/macos/pkg-scripts" \
  --ownership recommended \
  --identifier store.knowtation.pkg \
  --version "$release_version.$release_build" \
  --install-location / \
  "$package_work/Knowtation-component.pkg"

productbuild \
  --distribution "$repo_root/release/macos/Distribution.xml" \
  --package-path "$package_work" \
  --sign "$identity" \
  "$output"

pkgutil --check-signature "$output"
echo "$output"
