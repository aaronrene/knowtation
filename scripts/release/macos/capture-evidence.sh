#!/bin/bash
set -euo pipefail

dist=""
build=""
output=""
verification_log=""
test_log=""
signed_callers_log=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dist) dist="$2"; shift 2 ;;
    --build) build="$2"; shift 2 ;;
    --output) output="$2"; shift 2 ;;
    --verification-log) verification_log="$2"; shift 2 ;;
    --test-log) test_log="$2"; shift 2 ;;
    --signed-callers-log) signed_callers_log="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

[[ -d "$dist" && -d "$build" && -n "$output" ]] || { echo "--dist, --build, and --output are required" >&2; exit 2; }
for required_log in "$verification_log" "$test_log" "$signed_callers_log"; do
  [[ -f "$required_log" ]] || { echo "verification, test, and signed-caller logs are required" >&2; exit 2; }
done
[[ "${KNOWTATION_SOURCE_MUSE_REVISION:-}" =~ ^sha256:[0-9a-f]{64}$ ]] || {
  echo "exact KNOWTATION_SOURCE_MUSE_REVISION is required" >&2; exit 1;
}
[[ "${KNOWTATION_SOURCE_GIT_REVISION:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "exact KNOWTATION_SOURCE_GIT_REVISION is required" >&2; exit 1;
}
mkdir -p "$output"

cp "$dist/release-manifest.json" "$output/release-manifest.json"
cp "$dist/release-manifest.sig" "$output/release-manifest.sig"
cp "$dist/SHA256SUMS" "$output/SHA256SUMS"
cp "$dist/sbom.spdx.json" "$output/sbom.spdx.json"
cp "$dist/LICENSE" "$output/LICENSE"
cp "$dist/THIRD-PARTY-NOTICES.txt" "$output/THIRD-PARTY-NOTICES.txt"
cp "$build/evidence/app-notary-submission.json" "$output/app-notary-submission.json"
cp "$build/evidence/app-notary-submission.json.log.json" "$output/app-notary-log.json"
cp "$build/evidence/pkg-notary-submission.json" "$output/pkg-notary-submission.json"
cp "$build/evidence/pkg-notary-submission.json.log.json" "$output/pkg-notary-log.json"
cp "$build/signed/Knowtation.app/Contents/Resources/runtime-manifest.json" \
  "$output/runtime-manifest.json"
cp "$build/signed/Knowtation.app/Contents/Resources/release-lock.json" \
  "$output/release-lock.json"
cp "$dist/Knowtation-0.1.0-100-macos-arm64.zip" "$output/Knowtation-0.1.0-100-macos-arm64.zip"
cp "$dist/Knowtation-0.1.0-100-macos-arm64.pkg" "$output/Knowtation-0.1.0-100-macos-arm64.pkg"
cp "$verification_log" "$output/release-verification.log"
cp "$test_log" "$output/release-tests.log"
cp "$signed_callers_log" "$output/signed-callers.log"

SOURCE_MUSE="$KNOWTATION_SOURCE_MUSE_REVISION" SOURCE_GIT="$KNOWTATION_SOURCE_GIT_REVISION" \
  node -e 'const fs=require("fs"); fs.writeFileSync(process.argv[1], JSON.stringify({schema:1,sourceRevision:{status:"committed",muse:process.env.SOURCE_MUSE,github:process.env.SOURCE_GIT}}, null, 2)+"\n")' \
  "$output/source-revisions.json"

xcodebuild -version > "$output/xcode-version.txt"
swift --version > "$output/swift-version.txt" 2>&1
uname -m > "$output/architecture.txt"
sw_vers > "$output/macos-version.txt"
codesign -d --verbose=4 "$build/signed/Knowtation.app" > "$output/app-signature.txt" 2>&1
codesign -d --entitlements :- "$build/signed/Knowtation.app" > "$output/app-entitlements.plist" 2>&1
codesign -d --verbose=4 "$build/signed/Knowtation.app/Contents/Library/LaunchServices/KnowtationCustodyAgent.app" \
  > "$output/custody-signature.txt" 2>&1
codesign -d --entitlements :- "$build/signed/Knowtation.app/Contents/Library/LaunchServices/KnowtationCustodyAgent.app" \
  > "$output/custody-entitlements.plist" 2>&1
codesign -d --verbose=4 "$build/signed/Knowtation.app/Contents/Helpers/knowtation" \
  > "$output/cli-signature.txt" 2>&1
codesign -d --verbose=4 "$build/signed/Knowtation.app/Contents/Helpers/knowtation-mcp" \
  > "$output/mcp-signature.txt" 2>&1
pkgutil --check-signature "$dist/Knowtation-0.1.0-100-macos-arm64.pkg" > "$output/pkg-signature.txt" 2>&1
pkgutil --payload-files "$dist/Knowtation-0.1.0-100-macos-arm64.pkg" > "$output/pkg-payload-files.txt"
xcrun stapler validate "$build/signed/Knowtation.app" > "$output/app-stapler.txt" 2>&1
xcrun stapler validate "$dist/Knowtation-0.1.0-100-macos-arm64.pkg" > "$output/pkg-stapler.txt" 2>&1
(cd "$output" && shasum -a 256 -c SHA256SUMS) > "$output/checksum-verification.txt" 2>&1

echo "$output"
