#!/bin/bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../../.." && pwd)"
app=""
full=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --app) app="$2"; shift 2 ;;
    --full) full=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

mkdir -p "$repo_root/build"
swift_scratch="$(mktemp -d "$repo_root/build/swift-tests.XXXXXX")"
trap 'rm -rf "$swift_scratch"' EXIT
env \
  CLANG_MODULE_CACHE_PATH="$swift_scratch/clang-cache" \
  SWIFTPM_MODULECACHE_OVERRIDE="$swift_scratch/swiftpm-cache" \
  swift test \
    --disable-sandbox \
    --package-path "$repo_root/companion/macos" \
    --scratch-path "$swift_scratch"
node --test \
  "$repo_root/test/release-macos-manifest.test.mjs" \
  "$repo_root/test/release-macos-layout.test.mjs" \
  "$repo_root/test/release-macos-caller-policy.test.mjs" \
  "$repo_root/test/release-macos-lifecycle.test.mjs" \
  "$repo_root/test/release-macos-update-policy.test.mjs" \
  "$repo_root/test/release-macos-runtime-closure.test.mjs" \
  "$repo_root/test/companion-runtime-oauth-session.test.mjs" \
  "$repo_root/test/companion-oauth-flow-bind.test.mjs" \
  "$repo_root/test/native-oauth-refresh-durability.test.mjs"

if [[ -n "$app" ]]; then
  test -f "$app/Contents/Resources/runtime-manifest.json"
  test -x "$app/Contents/MacOS/Knowtation"
  test -x "$app/Contents/Helpers/knowtation"
  test -x "$app/Contents/Helpers/knowtation-mcp"
  node "$repo_root/scripts/release/macos/verify-runtime-manifest.mjs" --app "$app"
  node --experimental-vm-modules --no-warnings \
    "$repo_root/scripts/release/macos/verify-module-closure.mjs" \
    --runtime "$app/Contents/Resources/runtime"
  "$app/Contents/Resources/runtime/node/bin/node" \
    "$repo_root/scripts/release/macos/smoke-inference.mjs" \
    --runtime "$app/Contents/Resources/runtime"
fi

if [[ "$full" == 1 ]]; then
  npm test --prefix "$repo_root"
fi
