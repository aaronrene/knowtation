#!/bin/bash
set -euo pipefail

app=""
identity=""
output=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --app) app="$2"; shift 2 ;;
    --application-identity) identity="$2"; shift 2 ;;
    --output) output="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

[[ -d "$app" && -n "$output" ]] || { echo "--app and --output are required" >&2; exit 2; }
[[ -n "$identity" && "$identity" != *'<'* ]] || { echo "real Developer ID Application identity required" >&2; exit 1; }
[[ -n "${KNOWTATION_UPDATE_KEY_ID:-}" && "$KNOWTATION_UPDATE_KEY_ID" != *'<'* ]] || {
  echo "KNOWTATION_UPDATE_KEY_ID is required" >&2; exit 1;
}
[[ -n "${KNOWTATION_UPDATE_PUBLIC_KEY_BASE64:-}" && "$KNOWTATION_UPDATE_PUBLIC_KEY_BASE64" != *'<'* ]] || {
  echo "KNOWTATION_UPDATE_PUBLIC_KEY_BASE64 is required" >&2; exit 1;
}
[[ "${KNOWTATION_SOURCE_MUSE_REVISION:-}" =~ ^sha256:[0-9a-f]{64}$ ]] || {
  echo "exact KNOWTATION_SOURCE_MUSE_REVISION is required" >&2; exit 1;
}
[[ "${KNOWTATION_SOURCE_GIT_REVISION:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "exact KNOWTATION_SOURCE_GIT_REVISION is required" >&2; exit 1;
}
[[ "${KNOWTATION_APPLE_TEAM_ID:-}" =~ ^[A-Z0-9]{10}$ ]] || {
  echo "KNOWTATION_APPLE_TEAM_ID is required" >&2; exit 1;
}
[[ -f "${KNOWTATION_CUSTODY_PROVISIONING_PROFILE:-}" ]] || {
  echo "KNOWTATION_CUSTODY_PROVISIONING_PROFILE is required" >&2; exit 1;
}

repo_root="$(cd "$(dirname "$0")/../../.." && pwd)"
rm -rf "$output"
ditto "$app" "$output"
cp "$KNOWTATION_CUSTODY_PROVISIONING_PROFILE" \
  "$output/Contents/Library/LaunchServices/KnowtationCustodyAgent.app/Contents/embedded.provisionprofile"
custody_entitlements="$(mktemp "${TMPDIR:-/tmp}/knowtation-custody-entitlements.XXXXXX")"
profile_plist="$(mktemp "${TMPDIR:-/tmp}/knowtation-custody-profile.XXXXXX")"
trap 'rm -f "$custody_entitlements" "$profile_plist"' EXIT
sed "s/__APPLE_TEAM_ID__/$KNOWTATION_APPLE_TEAM_ID/g" \
  "$repo_root/release/macos/entitlements/custody.plist" > "$custody_entitlements"
plutil -lint "$custody_entitlements" >/dev/null
security cms -D -i "$KNOWTATION_CUSTODY_PROVISIONING_PROFILE" > "$profile_plist"
test "$(/usr/libexec/PlistBuddy -c 'Print :TeamIdentifier:0' "$profile_plist")" = \
  "$KNOWTATION_APPLE_TEAM_ID"
test "$(/usr/libexec/PlistBuddy -c 'Print :Entitlements:com.apple.application-identifier' "$profile_plist")" = \
  "$KNOWTATION_APPLE_TEAM_ID.store.knowtation.companion.custody"
test "$(/usr/libexec/PlistBuddy -c 'Print :Entitlements:keychain-access-groups:0' "$profile_plist")" = \
  "$KNOWTATION_APPLE_TEAM_ID.store.knowtation.companion.custody"
if /usr/libexec/PlistBuddy -c 'Print :Entitlements:com.apple.security.get-task-allow' \
  "$profile_plist" 2>/dev/null | grep -qx true; then
  echo "custody provisioning profile permits debugging" >&2
  exit 1
fi
UPDATE_TRUST="$output/Contents/Resources/update-trust.json" \
  node - <<'NODE'
const fs = require('fs');
const raw = Buffer.from(process.env.KNOWTATION_UPDATE_PUBLIC_KEY_BASE64, 'base64');
if (raw.length !== 32) throw new Error('Ed25519 update public key must be 32 raw bytes');
const file = process.env.UPDATE_TRUST;
const trust = JSON.parse(fs.readFileSync(file, 'utf8'));
trust.activeKey = {
  keyID: process.env.KNOWTATION_UPDATE_KEY_ID,
  publicKey: process.env.KNOWTATION_UPDATE_PUBLIC_KEY_BASE64,
};
fs.writeFileSync(file, `${JSON.stringify(trust, null, 2)}\n`);
NODE

while IFS= read -r -d '' code; do
  codesign --force --timestamp --options runtime --sign "$identity" "$code"
done < <(find "$output/Contents/Resources/runtime" -type f \( -name '*.node' -o -name '*.dylib' \) -print0)

codesign --force --timestamp --options runtime \
  --identifier store.knowtation.runtime.node \
  --entitlements "$repo_root/release/macos/entitlements/runtime.plist" \
  --sign "$identity" "$output/Contents/Resources/runtime/node/bin/node"

codesign --force --timestamp --options runtime \
  --identifier store.knowtation.cli \
  --entitlements "$repo_root/release/macos/entitlements/launcher.plist" \
  --sign "$identity" "$output/Contents/Helpers/knowtation"

codesign --force --timestamp --options runtime \
  --identifier store.knowtation.mcp \
  --entitlements "$repo_root/release/macos/entitlements/launcher.plist" \
  --sign "$identity" "$output/Contents/Helpers/knowtation-mcp"

# Nested signatures change runtime bytes. Regenerate the sealed runtime manifest
# after signing all runtime code and before applying the outer app signature.
node "$repo_root/scripts/release/macos/generate-manifest.mjs" \
  --stage unsigned \
  --app "$output" \
  --output "$output/Contents/Resources/runtime-manifest.json"

codesign --force --timestamp --options runtime \
  --entitlements "$custody_entitlements" \
  --sign "$identity" "$output/Contents/Library/LaunchServices/KnowtationCustodyAgent.app"

codesign --force --timestamp --options runtime \
  --entitlements "$repo_root/release/macos/entitlements/app.plist" \
  --sign "$identity" "$output"

codesign --verify --deep --strict --verbose=4 "$output"
echo "$output"
