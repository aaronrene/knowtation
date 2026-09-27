#!/bin/bash
set -euo pipefail

app=""
package_file=""
manifest=""
signature=""
checksums=""
public_key_file="${KNOWTATION_UPDATE_PUBLIC_KEY_FILE:-}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --app) app="$2"; shift 2 ;;
    --package) package_file="$2"; shift 2 ;;
    --manifest) manifest="$2"; shift 2 ;;
    --signature) signature="$2"; shift 2 ;;
    --checksums) checksums="$2"; shift 2 ;;
    --public-key-file) public_key_file="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

repo_root="$(cd "$(dirname "$0")/../../.." && pwd)"
for required in "$app" "$package_file" "$manifest" "$signature" "$checksums" "$public_key_file"; do
  [[ -e "$required" ]] || { echo "missing verification input: $required" >&2; exit 2; }
done
[[ "${KNOWTATION_APPLE_TEAM_ID:-}" =~ ^[A-Z0-9]{10}$ ]] || {
  echo "KNOWTATION_APPLE_TEAM_ID is required" >&2; exit 1;
}
verification_tmp="$(mktemp -d "${TMPDIR:-/tmp}/knowtation-release-verify.XXXXXX")"
trap 'rm -rf "$verification_tmp"' EXIT

verify_identity() {
  local target="$1"
  local expected_identifier="$2"
  local information
  information="$(codesign -d --verbose=4 "$target" 2>&1)"
  grep -Fqx "Identifier=$expected_identifier" <<< "$information"
  grep -Fqx "TeamIdentifier=$KNOWTATION_APPLE_TEAM_ID" <<< "$information"
}

codesign --verify --deep --strict --verbose=4 "$app"
node "$repo_root/scripts/release/macos/verify-runtime-manifest.mjs" \
  --app "$app" --require-committed-source
spctl --assess --type execute --verbose=4 "$app"
verify_identity "$app" "store.knowtation.companion"
verify_identity "$app/Contents/Library/LaunchServices/KnowtationCustodyAgent.app" \
  "store.knowtation.companion.custody"
verify_identity "$app/Contents/Helpers/knowtation" "store.knowtation.cli"
verify_identity "$app/Contents/Helpers/knowtation-mcp" "store.knowtation.mcp"
verify_identity "$app/Contents/Resources/runtime/node/bin/node" "store.knowtation.runtime.node"
custody_app="$app/Contents/Library/LaunchServices/KnowtationCustodyAgent.app"
test -f "$custody_app/Contents/embedded.provisionprofile"
codesign -d --entitlements :- "$custody_app" > "$verification_tmp/custody-entitlements.plist" 2>/dev/null
test "$(plutil -extract 'com\.apple\.application-identifier' raw \
  "$verification_tmp/custody-entitlements.plist")" = \
  "$KNOWTATION_APPLE_TEAM_ID.store.knowtation.companion.custody"
test "$(plutil -extract keychain-access-groups.0 raw \
  "$verification_tmp/custody-entitlements.plist")" = \
  "$KNOWTATION_APPLE_TEAM_ID.store.knowtation.companion.custody"
pkgutil --check-signature "$package_file"
spctl --assess --type install --verbose=4 "$package_file"
xcrun stapler validate "$app"
xcrun stapler validate "$package_file"

(cd "$(dirname "$checksums")" && shasum -a 256 -c "$(basename "$checksums")")
unzip -t "$(dirname "$manifest")/Knowtation-0.1.0-100-macos-arm64.zip"

node "$repo_root/scripts/release/macos/verify-update-manifest.mjs" \
  --manifest "$manifest" \
  --signature "$signature" \
  --public-key-file "$public_key_file" \
  --trust "$app/Contents/Resources/update-trust.json" \
  --package "$package_file"

test "$(plutil -extract CFBundleIdentifier raw "$app/Contents/Info.plist")" = "store.knowtation.companion"
test "$(plutil -extract CFBundleShortVersionString raw "$app/Contents/Info.plist")" = "0.1.0"
test "$(plutil -extract CFBundleVersion raw "$app/Contents/Info.plist")" = "100"
lipo "$app/Contents/MacOS/Knowtation" -verify_arch arm64
lipo "$app/Contents/Helpers/knowtation" -verify_arch arm64
lipo "$app/Contents/Helpers/knowtation-mcp" -verify_arch arm64
lipo "$app/Contents/Resources/runtime/node/bin/node" -verify_arch arm64
while IFS= read -r -d '' native; do
  test "$(lipo -archs "$native")" = "arm64"
done < <(find "$app/Contents/Resources/runtime" -type f \( -name '*.node' -o -name '*.dylib' \) -print0)

if find "$app" -type f \( -name '.env' -o -name '*.pem' -o -name '*.p12' -o -name 'local.yaml' \) -print -quit | grep -q .; then
  echo "secret-bearing or local configuration file found in app" >&2
  exit 1
fi

if find "$app/Contents/Resources/runtime/node_modules" -type d \( -name sharp -o -name 'sharp-*' -o -name 'libvips-*' \) -print -quit | grep -q .; then
  echo "excluded sharp/libvips dependency found" >&2
  exit 1
fi

if grep -q "No license text was present" "$app/Contents/Resources/THIRD-PARTY-NOTICES.txt"; then
  echo "runtime dependency is missing distributable license text" >&2
  exit 1
fi

echo "release verification passed"
