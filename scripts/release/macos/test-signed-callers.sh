#!/bin/bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../../.." && pwd)"
app="${1:-/Applications/Knowtation.app}"
[[ "$app" == "/Applications/Knowtation.app" ]] || {
  echo "signed-caller test requires the installed production path" >&2; exit 2;
}
[[ -d "$app" && -x /usr/local/bin/knowtation && -x /usr/local/bin/knowtation-mcp ]] || {
  echo "signed app, CLI, and MCP installation are required" >&2; exit 2;
}

/usr/local/bin/knowtation companion status
/usr/local/bin/knowtation companion verify-session
/usr/local/bin/knowtation-mcp companion verify-session
"$app/Contents/Resources/runtime/node/bin/node" \
  "$repo_root/scripts/release/macos/smoke-mcp-client.mjs" \
  --helper /usr/local/bin/knowtation-mcp

probe_build="$repo_root/build/signed-caller-probe"
env \
  CLANG_MODULE_CACHE_PATH="$probe_build/clang-cache" \
  SWIFTPM_MODULECACHE_OVERRIDE="$probe_build/swiftpm-cache" \
  swift build --disable-sandbox \
    --package-path "$repo_root/companion/macos" \
    --scratch-path "$probe_build" \
    --product KnowtationCallerProbe
probe="$(swift build --disable-sandbox --package-path "$repo_root/companion/macos" \
  --scratch-path "$probe_build" --show-bin-path)/KnowtationCallerProbe"
"$probe"

tamper_root="$(mktemp -d "${TMPDIR:-/tmp}/knowtation-tamper.XXXXXX")"
trap 'rm -rf "$tamper_root"' EXIT
cp -cR "$app" "$tamper_root/Knowtation.app"
printf '\n// release tamper probe\n' >> \
  "$tamper_root/Knowtation.app/Contents/Resources/runtime/companion/runtime/main.mjs"
if codesign --verify --deep --strict "$tamper_root/Knowtation.app" 2>/dev/null; then
  echo "tampered app unexpectedly retained a valid signature" >&2
  exit 1
fi
if node "$repo_root/scripts/release/macos/verify-runtime-manifest.mjs" \
  --app "$tamper_root/Knowtation.app" --require-committed-source 2>/dev/null; then
  echo "tampered runtime unexpectedly matched its manifest" >&2
  exit 1
fi

echo "signed caller, CLI/MCP provisioning, unsigned-caller denial, and tamper rejection passed"
