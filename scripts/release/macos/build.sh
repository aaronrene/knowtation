#!/bin/bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../../.." && pwd)"
configuration="release"
input_dir="$repo_root/build/release-inputs"
output_dir="$repo_root/build/phase7"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --configuration) configuration="$2"; shift 2 ;;
    --inputs) input_dir="$2"; shift 2 ;;
    --output) output_dir="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

if [[ "$input_dir" != /* ]]; then input_dir="$repo_root/$input_dir"; fi
if [[ "$output_dir" != /* ]]; then output_dir="$repo_root/$output_dir"; fi

[[ "$(uname -s)" == "Darwin" ]] || { echo "macOS build host required" >&2; exit 1; }
[[ "$(uname -m)" == "arm64" ]] || { echo "arm64 build host required" >&2; exit 1; }
[[ -x "$input_dir/node/bin/node" ]] || { echo "verified Node input missing" >&2; exit 1; }
[[ -f "$input_dir/model/onnx/model_quantized.onnx" ]] || { echo "verified model input missing" >&2; exit 1; }
[[ -f "$repo_root/companion/runtime/package-lock.json" ]] || { echo "runtime package lock missing" >&2; exit 1; }
if [[ "${KNOWTATION_ALLOW_UNCOMMITTED_BUILD:-}" != "1" ]]; then
  [[ "${KNOWTATION_SOURCE_MUSE_REVISION:-}" =~ ^sha256:[0-9a-f]{64}$ ]] || {
    echo "exact KNOWTATION_SOURCE_MUSE_REVISION is required" >&2; exit 1;
  }
  [[ "${KNOWTATION_SOURCE_GIT_REVISION:-}" =~ ^[0-9a-f]{40}$ ]] || {
    echo "exact KNOWTATION_SOURCE_GIT_REVISION is required" >&2; exit 1;
  }
fi

rm -rf "$output_dir"
mkdir -p "$output_dir/clang-cache" "$output_dir/swiftpm-cache"
export CLANG_MODULE_CACHE_PATH="$output_dir/clang-cache"
export SWIFTPM_MODULECACHE_OVERRIDE="$output_dir/swiftpm-cache"

swift build \
  --disable-sandbox \
  --package-path "$repo_root/companion/macos" \
  --configuration "$configuration" \
  --scratch-path "$output_dir/swift"
bin_dir="$(swift build --disable-sandbox --package-path "$repo_root/companion/macos" --configuration "$configuration" --scratch-path "$output_dir/swift" --show-bin-path)"

app="$output_dir/unsigned/Knowtation.app"
resources="$app/Contents/Resources"
runtime="$resources/runtime"
custody_app="$app/Contents/Library/LaunchServices/KnowtationCustodyAgent.app"
mkdir -p \
  "$app/Contents/MacOS" \
  "$app/Contents/Helpers" \
  "$app/Contents/Library/LaunchAgents" \
  "$custody_app/Contents/MacOS" \
  "$runtime"

cp "$repo_root/release/macos/plists/App-Info.plist" "$app/Contents/Info.plist"
cp "$repo_root/release/macos/plists/CustodyAgent-Info.plist" "$custody_app/Contents/Info.plist"
cp "$repo_root/release/macos/plists/LaunchAgent.plist" "$app/Contents/Library/LaunchAgents/store.knowtation.companion.custody.plist"
cp "$bin_dir/Knowtation" "$app/Contents/MacOS/Knowtation"
cp "$bin_dir/KnowtationCustodyAgent" "$custody_app/Contents/MacOS/KnowtationCustodyAgent"
cp "$bin_dir/knowtation" "$app/Contents/Helpers/knowtation"
cp "$bin_dir/knowtation-mcp" "$app/Contents/Helpers/knowtation-mcp"

ditto "$input_dir/node" "$runtime/node"
# The installed runtime executes only the fixed Node binary. Package managers,
# development headers, and their symlinks are build inputs and are not shipped.
rm -f "$runtime/node/bin/corepack" "$runtime/node/bin/npm" "$runtime/node/bin/npx"
rm -rf "$runtime/node/include" "$runtime/node/lib/node_modules" "$runtime/node/share"
ditto "$input_dir/model" "$runtime/models/all-MiniLM-L6-v2"

runtime_spec="$repo_root/release/macos/runtime-files.json"
while IFS= read -r directory; do
  mkdir -p "$runtime/$directory"
  ditto "$repo_root/$directory" "$runtime/$directory"
done < <(node -e 'const j=require(process.argv[1]); for(const p of j.sourceDirectories) console.log(p)' "$runtime_spec")

while IFS= read -r file; do
  mkdir -p "$(dirname "$runtime/$file")"
  cp "$repo_root/$file" "$runtime/$file"
done < <(node -e 'const j=require(process.argv[1]); for(const p of j.sourceFiles) console.log(p)' "$runtime_spec")

while IFS= read -r directory; do
  mkdir -p "$runtime/$directory"
  ditto "$repo_root/$directory" "$runtime/$directory"
done < <(node -e 'const j=require(process.argv[1]); for(const p of j.assetDirectories) console.log(p)' "$runtime_spec")

runtime_package="$output_dir/runtime-package"
mkdir -p "$runtime_package"
cp "$repo_root/companion/runtime/package.json" "$runtime_package/package.json"
cp "$repo_root/companion/runtime/package-lock.json" "$runtime_package/package-lock.json"
runtime_npm="$input_dir/node/bin/npm"
runtime_path="$input_dir/node/bin:/usr/bin:/bin:/usr/sbin:/sbin"
env PATH="$runtime_path" npm_config_cache="$output_dir/npm-cache" \
  "$runtime_npm" --prefix "$runtime_package" ci --omit=dev --ignore-scripts
env PATH="$runtime_path" npm_config_cache="$output_dir/npm-cache" npm_config_build_from_source=true \
  "$runtime_npm" --prefix "$runtime_package" rebuild argon2 better-sqlite3
rm -rf \
  "$runtime_package/node_modules/.bin" \
  "$runtime_package/node_modules/argon2/prebuilds" \
  "$runtime_package/node_modules/sharp" \
  "$runtime_package/node_modules/onnxruntime-node" \
  "$runtime_package/node_modules/@img"
rm -f "$runtime_package/node_modules/better-sqlite3/build/Release/test_extension.node"
find "$runtime_package/node_modules" -maxdepth 1 -type d -name 'sqlite-vec-*' \
  ! -name 'sqlite-vec-darwin-arm64' -exec rm -rf {} +
ditto "$runtime_package/node_modules" "$runtime/node_modules"
cp "$repo_root/companion/runtime/package-lock.json" "$runtime/release-package-lock.json"

verify_locked_file() {
  local file="$1"
  local expected="$2"
  [[ -f "$file" ]] || { echo "locked runtime file missing: $file" >&2; exit 1; }
  [[ "$(shasum -a 256 "$file" | awk '{print $1}')" == "$expected" ]] || {
    echo "locked runtime file digest mismatch: $file" >&2; exit 1;
  }
}
while IFS=$'\t' read -r relative expected; do
  verify_locked_file "$runtime/$relative" "$expected"
done < <(node -e 'const j=require(process.argv[1]); for(const f of j.runtime.files) console.log(`${f.path}\t${f.sha256}`)' \
  "$repo_root/release/macos/release-lock.json")
while IFS=$'\t' read -r relative expected; do
  verify_locked_file "$runtime/models/all-MiniLM-L6-v2/$relative" "$expected"
done < <(node -e 'const j=require(process.argv[1]); for(const f of j.model.files) console.log(`${f.path}\t${f.sha256}`)' \
  "$repo_root/release/macos/release-lock.json")

if find "$runtime/node_modules" -type d \( -name sharp -o -name 'sharp-*' -o -name 'libvips-*' \) -print -quit | grep -q .; then
  echo "excluded sharp/libvips dependency entered runtime closure" >&2
  exit 1
fi

for required_native in \
  "$runtime/node_modules/argon2/build/Release/argon2.node" \
  "$runtime/node_modules/better-sqlite3/build/Release/better_sqlite3.node" \
  "$runtime/node_modules/sqlite-vec-darwin-arm64/vec0.dylib"; do
  [[ -f "$required_native" ]] || { echo "required arm64 runtime missing: $required_native" >&2; exit 1; }
done
while IFS= read -r -d '' native; do
  [[ "$(lipo -archs "$native")" == "arm64" ]] || {
    echo "non-arm64 native runtime entered closure: $native" >&2; exit 1;
  }
done < <(find "$runtime" -type f \( -name '*.node' -o -name '*.dylib' \) -print0)

node --experimental-vm-modules --no-warnings \
  "$repo_root/scripts/release/macos/verify-module-closure.mjs" --runtime "$runtime"

export SOURCE_DATE_EPOCH="${SOURCE_DATE_EPOCH:?SOURCE_DATE_EPOCH is required}"
node "$repo_root/scripts/release/macos/generate-sbom.mjs" \
  --node-modules "$runtime/node_modules" \
  --package-lock "$repo_root/companion/runtime/package-lock.json" \
  --release-lock "$repo_root/release/macos/release-lock.json" \
  --node-license "$input_dir/node/LICENSE" \
  --license-templates "$repo_root/release/macos/licenses" \
  --license-overrides "$repo_root/release/macos/license-overrides.json" \
  --sbom "$resources/sbom.spdx.json" \
  --notices "$resources/THIRD-PARTY-NOTICES.txt"

cp "$repo_root/release/macos/release-lock.json" "$resources/release-lock.json"
cp "$repo_root/release/macos/update-trust.json" "$resources/update-trust.json"
chmod 755 \
  "$app/Contents/MacOS/Knowtation" \
  "$app/Contents/Helpers/knowtation" \
  "$app/Contents/Helpers/knowtation-mcp" \
  "$custody_app/Contents/MacOS/KnowtationCustodyAgent" \
  "$runtime/node/bin/node"

node "$repo_root/scripts/release/macos/generate-manifest.mjs" \
  --stage unsigned \
  --app "$app" \
  --output "$resources/runtime-manifest.json"
mkdir -p "$output_dir/manifests"
cp "$resources/runtime-manifest.json" "$output_dir/manifests/unsigned-runtime-manifest.json"

echo "$app"
