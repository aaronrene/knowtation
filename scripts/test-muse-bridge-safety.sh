#!/usr/bin/env bash
# Verify the safe Muse bridge workflow does not delete local ignored files.
#
# This is a smoke test for the repository-level bridge workflow. It creates a
# throwaway Muse repo, exports into an isolated mirror git checkout, and asserts
# that ignored local state remains outside the bridge's deletion boundary.

set -euo pipefail

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"
}

require_cmd git
require_cmd muse

TMP_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/knowtation-bridge-safety.XXXXXX")
cleanup() {
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

SRC="$TMP_ROOT/source"
MIRROR="$SRC/.muse/mirror"

mkdir -p "$SRC"
cd "$SRC"

git init -q
git config user.email "bridge-safety@example.invalid"
git config user.name "Bridge Safety Test"

muse init --domain code >/dev/null

cat > .gitignore <<'EOF'
.muse/
.env
.env.*
!.env.example
config/local.yaml
config/*-local.*
data/
*.db
*.sqlite
EOF

cat > .museignore <<'EOF'
[global]
patterns = [
    ".env",
    "config/local.yaml",
    "config/*-local.*",
    "data/",
    "*.db",
    "*.sqlite",
]

[domain.code]
patterns = []
EOF

mkdir -p scripts config data "$MIRROR"

cat > README.md <<'EOF'
# Bridge safety smoke test
EOF

cat > .env.example <<'EOF'
EXAMPLE_ONLY=1
EOF

cat > scripts/hello.sh <<'EOF'
#!/usr/bin/env bash
echo "hello"
EOF
chmod +x scripts/hello.sh

cat > .env <<'EOF'
SENTINEL_ONLY=do-not-delete
EOF
cat > config/local.yaml <<'EOF'
sentinel: do-not-delete
EOF
cat > data/local.sqlite <<'EOF'
sentinel-only
EOF

muse code add README.md .env.example scripts/hello.sh .gitignore .museignore >/dev/null
muse commit -m "test: seed bridge safety fixture" >/dev/null

git -C "$MIRROR" init -q
git -C "$MIRROR" config user.email "bridge-safety@example.invalid"
git -C "$MIRROR" config user.name "Bridge Safety Test"
git -C "$MIRROR" checkout -b muse-mirror >/dev/null 2>&1
git -C "$MIRROR" commit --allow-empty -m "seed mirror branch" >/dev/null

muse bridge git-export \
  --git-dir "$MIRROR" \
  --git-branch muse-mirror \
  --git-remote origin \
  --no-push \
  --exclude '.env' \
  --exclude '.env.local' \
  --exclude '.env.*.local' \
  --exclude 'config/local.yaml' \
  --exclude 'config/*-local.*' \
  --exclude 'data/*' \
  --exclude 'data/**' \
  --exclude '*.db' \
  --exclude '*.sqlite' >/dev/null

[[ -f "$SRC/.env" ]] || fail ".env sentinel was deleted from source repo"
[[ -f "$SRC/config/local.yaml" ]] || fail "config/local.yaml sentinel was deleted from source repo"
[[ -f "$SRC/data/local.sqlite" ]] || fail "data/local.sqlite sentinel was deleted from source repo"

git -C "$MIRROR" ls-tree -r --name-only HEAD | grep -qx 'scripts/hello.sh' \
  || fail "scripts/hello.sh was not exported to the mirror"

MODE=$(git -C "$MIRROR" ls-tree HEAD scripts/hello.sh | awk '{print $1}')
[[ "$MODE" == "100755" ]] || fail "scripts/hello.sh mode is $MODE, expected 100755"

if git -C "$MIRROR" ls-tree -r --name-only HEAD | grep -Eq '^(\.env$|config/local\.yaml$|data/)'; then
  fail "local-only sentinel files leaked into the mirror commit"
fi

echo "PASS: Muse bridge safety smoke test preserved local ignored files and executable mode."
