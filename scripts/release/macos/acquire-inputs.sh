#!/bin/bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../../.." && pwd)"
lock_file="$repo_root/release/macos/release-lock.json"
output_dir="$repo_root/build/release-inputs"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --lock) lock_file="$2"; shift 2 ;;
    --output) output_dir="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

lock_file="$(cd "$(dirname "$lock_file")" && pwd)/$(basename "$lock_file")"
if [[ "$output_dir" != /* ]]; then output_dir="$PWD/$output_dir"; fi

for command in curl node shasum tar; do
  command -v "$command" >/dev/null || { echo "missing command: $command" >&2; exit 1; }
done

mkdir -p "$output_dir/downloads" "$output_dir/model"

node_url="$(node -e 'const j=require(process.argv[1]); process.stdout.write(j.node.url)' "$lock_file")"
node_sha="$(node -e 'const j=require(process.argv[1]); process.stdout.write(j.node.sha256)' "$lock_file")"
node_archive="$(node -e 'const j=require(process.argv[1]); process.stdout.write(j.node.archive)' "$lock_file")"
node_download="$output_dir/downloads/$node_archive"

curl --fail --location --proto '=https' --tlsv1.2 --output "$node_download.part" "$node_url"
actual_node_sha="$(shasum -a 256 "$node_download.part" | awk '{print $1}')"
[[ "$actual_node_sha" == "$node_sha" ]] || { echo "Node runtime digest mismatch" >&2; exit 1; }
mv "$node_download.part" "$node_download"
mkdir -p "$output_dir/node"
tar -xzf "$node_download" --strip-components=1 -C "$output_dir/node"
[[ "$($output_dir/node/bin/node --version)" == "v24.21.0" ]] || {
  echo "Node runtime version mismatch" >&2; exit 1;
}
[[ "$($output_dir/node/bin/npm --version)" == "11.19.0" ]] || {
  echo "bundled npm version mismatch" >&2; exit 1;
}

model_list="$output_dir/model-downloads.tsv"
node - "$lock_file" > "$model_list" <<'NODE'
const lock = require(process.argv[2]);
for (const file of lock.model.files) {
  process.stdout.write([file.path, file.url, file.sha256, file.bytes].join('\t') + '\n');
}
NODE

while IFS=$'\t' read -r relative_path url expected_sha expected_bytes; do
  destination="$output_dir/model/$relative_path"
  mkdir -p "$(dirname "$destination")"
  curl --fail --location --proto '=https' --tlsv1.2 --output "$destination.part" "$url"
  actual_sha="$(shasum -a 256 "$destination.part" | awk '{print $1}')"
  actual_bytes="$(stat -f '%z' "$destination.part")"
  [[ "$actual_sha" == "$expected_sha" ]] || { echo "model digest mismatch: $relative_path" >&2; exit 1; }
  [[ "$actual_bytes" == "$expected_bytes" ]] || { echo "model size mismatch: $relative_path" >&2; exit 1; }
  mv "$destination.part" "$destination"
done < "$model_list"

cp "$lock_file" "$output_dir/release-lock.json"
shasum -a 256 "$lock_file" > "$output_dir/release-lock.sha256"
echo "Verified release inputs: $output_dir"
