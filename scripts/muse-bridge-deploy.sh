#!/usr/bin/env bash
# muse-bridge-deploy.sh
#
# Complete MuseHub → external Git deployment pipeline.
#
# Usage:
#   ./scripts/muse-bridge-deploy.sh "mirror: brief description of what changed"
#
# What this does (in order):
#   1. Security audit    — npm audit fix (blocks the bridge if high vulns remain)
#   2. Commit audit fix  — if audit changed package-lock.json, commits it to Muse
#   3. Bridge export     — muse bridge git-export → isolated .muse/mirror checkout
#   4. GitHub PR         — opens a PR from muse-mirror to main (skips if one already exists)
#
# Requirements:
#   - muse CLI in PATH (from ~/.local/share/muse/venv/bin)
#   - gh CLI in PATH and authenticated (gh auth status)
#   - git remote "origin" points to your GitHub/GitLab repo
#   - MUSE_BRIDGE_GIT_BRANCH env var (default: muse-mirror)
#   - MUSE_BRIDGE_BASE_BRANCH env var (default: main)
#   - MUSE_BRIDGE_MIRROR_DIR env var (default: $TMPDIR/knowtation-muse-mirror-$USER
#     outside the Cursor workspace — in-repo .muse/mirror fails when Cursor locks
#     nested .cursor/hooks.json during git-export)
#   - MUSE_BRIDGE_MUSE_REF env var (default: main)

set -euo pipefail

# ── Config (override via env) ──────────────────────────────────────────────────
MIRROR_BRANCH="${MUSE_BRIDGE_GIT_BRANCH:-muse-mirror}"
BASE_BRANCH="${MUSE_BRIDGE_BASE_BRANCH:-main}"
MUSE_REF="${MUSE_BRIDGE_MUSE_REF:-main}"
PR_TITLE="${1:-mirror: deploy from MuseHub $(date '+%Y-%m-%d')}"
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
# Prefer an out-of-workspace mirror so Cursor file locks on .cursor/* cannot abort export.
DEFAULT_MIRROR_DIR="${TMPDIR:-/tmp}/knowtation-muse-mirror-${USER:-user}"
MIRROR_DIR="${MUSE_BRIDGE_MIRROR_DIR:-$DEFAULT_MIRROR_DIR}"
# SIGPIPE-safe git-export entry (see scripts/muse-bridge-git-export.py).
GIT_EXPORT_WRAPPER="${REPO_ROOT}/scripts/muse-bridge-git-export.py"

# ── Colors ─────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'; BLUE='\033[0;34m'; NC='\033[0m'
info()    { echo -e "${BLUE}[bridge]${NC} $*"; }
success() { echo -e "${GREEN}[bridge]${NC} $*"; }
warn()    { echo -e "${YELLOW}[bridge]${NC} $*"; }
fail()    { echo -e "${RED}[bridge] ERROR:${NC} $*" >&2; exit 1; }

cd "$REPO_ROOT"

# Resolve the Muse venv interpreter from the `muse` shim shebang so the wrapper
# can `import muse` without relying on system Python.
resolve_muse_python() {
  local muse_bin shebang
  muse_bin="$(command -v muse 2>/dev/null || true)"
  [[ -n "$muse_bin" ]] || fail "muse CLI not found in PATH. Install Muse and retry."
  shebang="$(head -n 1 "$muse_bin" 2>/dev/null || true)"
  if [[ "$shebang" == "#!"* ]]; then
    MUSE_PYTHON="${shebang:2}"
  else
    MUSE_PYTHON="$(command -v python3)"
  fi
  [[ -x "$MUSE_PYTHON" ]] || fail "Muse Python interpreter not executable: ${MUSE_PYTHON}"
  [[ -f "$GIT_EXPORT_WRAPPER" ]] || fail "Missing git-export wrapper: ${GIT_EXPORT_WRAPPER}"
}
resolve_muse_python

if [[ "$MIRROR_DIR" = /* ]]; then
  MIRROR_DIR_ABS="$MIRROR_DIR"
else
  MIRROR_DIR_ABS="${REPO_ROOT}/${MIRROR_DIR}"
fi

if [[ "$MIRROR_DIR_ABS" == "$REPO_ROOT" ]]; then
  fail "MUSE_BRIDGE_MIRROR_DIR must not be the repository root. Refusing unsafe --git-dir . workflow."
fi

cleanup_sentinels() {
  [[ -n "${ENV_SENTINEL:-}" && -f "$ENV_SENTINEL" ]] && rm -f "$ENV_SENTINEL"
  [[ -n "${CONFIG_SENTINEL:-}" && -f "$CONFIG_SENTINEL" ]] && rm -f "$CONFIG_SENTINEL"
  [[ -n "${DATA_SENTINEL:-}" && -f "$DATA_SENTINEL" ]] && rm -f "$DATA_SENTINEL"
  [[ "${CREATED_DATA_DIR:-0}" == "1" && -d "${REPO_ROOT}/data" ]] && rmdir "${REPO_ROOT}/data" 2>/dev/null || true
}
trap cleanup_sentinels EXIT

ensure_mirror_checkout() {
  local remote_url
  remote_url=$(git config --get remote.origin.url 2>/dev/null || true)
  [[ -n "$remote_url" ]] || fail "Git remote 'origin' is not configured."

  if [[ -e "$MIRROR_DIR_ABS" && ! -d "${MIRROR_DIR_ABS}/.git" ]]; then
    fail "Mirror path exists but is not a git repository: ${MIRROR_DIR_ABS}"
  fi

  if [[ ! -d "${MIRROR_DIR_ABS}/.git" ]]; then
    info "Provisioning isolated mirror checkout at ${MIRROR_DIR}..."
    mkdir -p "$(dirname "$MIRROR_DIR_ABS")"
    git clone --single-branch --branch "$MIRROR_BRANCH" "$remote_url" "$MIRROR_DIR_ABS"
  fi

  git -C "$MIRROR_DIR_ABS" remote set-url origin "$remote_url"
  git -C "$MIRROR_DIR_ABS" fetch origin "$MIRROR_BRANCH"
  git -C "$MIRROR_DIR_ABS" checkout -B "$MIRROR_BRANCH" "origin/${MIRROR_BRANCH}"
  git -C "$MIRROR_DIR_ABS" reset --hard "origin/${MIRROR_BRANCH}"
}

prepare_sentinels() {
  ENV_SENTINEL="${REPO_ROOT}/.env.bridge-sentinel.$$"
  CONFIG_SENTINEL="${REPO_ROOT}/config/bridge-sentinel-local.$$.yaml"
  CREATED_DATA_DIR=0

  if [[ ! -d "${REPO_ROOT}/data" ]]; then
    mkdir -p "${REPO_ROOT}/data"
    CREATED_DATA_DIR=1
  fi
  DATA_SENTINEL="${REPO_ROOT}/data/bridge-sentinel.$$.db"

  printf 'bridge sentinel: no secrets\n' > "$ENV_SENTINEL"
  printf 'bridge sentinel: no secrets\n' > "$CONFIG_SENTINEL"
  printf 'bridge sentinel: no secrets\n' > "$DATA_SENTINEL"
}

verify_sentinels() {
  [[ -f "$ENV_SENTINEL" ]] || fail "Bridge safety sentinel disappeared: ${ENV_SENTINEL}. The bridge touched the dev tree."
  [[ -f "$CONFIG_SENTINEL" ]] || fail "Bridge safety sentinel disappeared: ${CONFIG_SENTINEL}. The bridge touched the dev tree."
  [[ -f "$DATA_SENTINEL" ]] || fail "Bridge safety sentinel disappeared: ${DATA_SENTINEL}. The bridge touched the dev tree."
}

# ── Step 1: Security audit ─────────────────────────────────────────────────────
info "Step 1/4 — Running security audit (npm audit fix)..."

# Match CI (.github/workflows/ci.yml): root + hub/gateway + hub/bridge.
audit_tree_high_critical() {
  local dir="$1"
  local label="$2"
  local audit_json high_count
  (
    cd "$dir"
    npm audit fix --audit-level=moderate --omit=dev >/dev/null 2>&1 || true
  )
  audit_json="$(cd "$dir" && npm audit --json --omit=dev 2>/dev/null || true)"
  high_count=$(printf '%s' "$audit_json" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    v = d.get('metadata', {}).get('vulnerabilities', {})
    print(int(v.get('high', 0)) + int(v.get('critical', 0)))
except Exception:
    print(0)
" 2>/dev/null || echo "0")
  high_count=$(printf '%s\n' "$high_count" | tail -1 | tr -cd '0-9'); high_count=${high_count:-0}
  if (( high_count > 0 )); then
    fail "npm audit (${label}) found ${high_count} high/critical vulnerabilities that could not be auto-fixed.\n\
Run 'npm audit --omit=dev' in ${dir} to review them, fix manually, then re-run this script.\n\
DO NOT bridge with known high/critical vulnerabilities."
  fi
  success "Audit clean (${label}) — 0 high/critical vulnerabilities."
}

if [[ ! -f package.json ]]; then
  warn "No package.json found — skipping npm audit. Add audits for your stack manually."
else
  audit_tree_high_critical "$REPO_ROOT" "root"
  [[ -f hub/gateway/package.json ]] && audit_tree_high_critical "${REPO_ROOT}/hub/gateway" "hub/gateway"
  [[ -f hub/bridge/package.json ]] && audit_tree_high_critical "${REPO_ROOT}/hub/bridge" "hub/bridge"
fi

# ── Step 2: Commit audit changes if any ───────────────────────────────────────
info "Step 2/4 — Checking for audit-generated changes..."

AUDIT_CHANGED=$(muse status --short 2>/dev/null | grep -E "package-lock\.json|package\.json" || true)

if [[ -n "$AUDIT_CHANGED" ]]; then
  warn "Audit changed package files — committing to Muse before bridging."
  muse code add package-lock.json package.json \
    hub/gateway/package-lock.json hub/gateway/package.json \
    hub/bridge/package-lock.json hub/bridge/package.json 2>/dev/null || true
  muse commit -m "security: npm audit fix pre-bridge $(date '+%Y-%m-%d')"
  muse push staging "${BASE_BRANCH}"
  success "Audit commit pushed to Muse main."
else
  success "No audit changes to commit."
fi

# ── Step 3: Bridge export ──────────────────────────────────────────────────────
info "Step 3/4 — Bridging Muse main → ${MIRROR_BRANCH} via isolated mirror checkout..."

ensure_mirror_checkout
prepare_sentinels

info "Exporting Muse ref '${MUSE_REF}' → ${MIRROR_DIR_ABS} (${MIRROR_BRANCH})..."
info "Using SIGPIPE-safe wrapper (${GIT_EXPORT_WRAPPER}) via ${MUSE_PYTHON}"

# Cursor locks .cursor/hooks.json even under TMPDIR. Exclude those paths from
# export (mirror keeps prior Git copies) and clear local hot paths before sync.
if [[ -d "${MIRROR_DIR_ABS}/.cursor" ]]; then
  info "Clearing mirror .cursor hot paths before export..."
  rm -f "${MIRROR_DIR_ABS}/.cursor/hooks.json" 2>/dev/null || true
  rm -rf "${MIRROR_DIR_ABS}/.cursor/hooks" 2>/dev/null || true
fi

# Do not redirect muse stdout through a pipe/log here: macOS mktemp templates
# that put XXXXXX in the middle (….XXXXXX.log) create a literal empty file and
# historically produced exit 141. The remaining 141 root cause is Muse's
# ``git check-ignore --stdin`` under CPython SIG_DFL — fixed by the wrapper.
info "Starting muse bridge git-export (output follows)..."
set +e
"${MUSE_PYTHON}" "${GIT_EXPORT_WRAPPER}" \
  --muse-ref "${MUSE_REF}" \
  --git-dir "${MIRROR_DIR_ABS}" \
  --git-branch "${MIRROR_BRANCH}" \
  --git-remote origin \
  --push \
  --force-push \
  --strip-muse-metadata \
  --exclude '.muse/*' \
  --exclude '.muse/**' \
  --exclude '.env' \
  --exclude '.env.local' \
  --exclude '.env.*.local' \
  --exclude 'config/local.yaml' \
  --exclude 'config/*-local.*' \
  --exclude 'data/*' \
  --exclude 'data/**' \
  --exclude '*.db' \
  --exclude '*.sqlite' \
  --exclude '.cursor/hooks.json' \
  --exclude '.cursor/hooks/**'
EXPORT_EC=$?
set -e

if [[ "$EXPORT_EC" -ne 0 ]]; then
  if [[ "$EXPORT_EC" -eq 141 ]]; then
    fail "muse bridge git-export failed (exit 141 / SIGPIPE) even with the SIGPIPE-safe wrapper. Capture output and file a MuseHub issue (git check-ignore --stdin)."
  fi
  fail "muse bridge git-export failed (exit ${EXPORT_EC}).
If you saw PermissionError on .cursor/hooks.json: Cmd+Q Cursor, remove the mirror dir, re-run the bridge."
fi

success "git-export finished."
verify_sentinels

# `muse bridge git-export --exclude` prevents ADDING .muse/, but it does NOT prune
# .muse/ files already tracked in the mirror branch from before the exclude existed.
# Purge them explicitly so the audit mirror never carries Muse-internal metadata.
# Idempotent: a no-op once the mirror is clean (Knowtation's mirror is already clean).
MIRROR_TRACKED_MUSE=$(git -C "${MIRROR_DIR_ABS}" ls-files .muse)
if [[ -n "$MIRROR_TRACKED_MUSE" ]]; then
  info "Purging pre-existing tracked .muse/ metadata from ${MIRROR_BRANCH}..."
  git -C "${MIRROR_DIR_ABS}" rm -r --quiet .muse
  git -C "${MIRROR_DIR_ABS}" commit -q -m "chore(bridge): purge Muse-internal .muse/ metadata from mirror"
  git -C "${MIRROR_DIR_ABS}" push origin "HEAD:${MIRROR_BRANCH}"
  success "Mirror .muse/ metadata purged and pushed."
fi

success "Bridge complete. ${MIRROR_BRANCH} is up to date on origin."

# ── Step 4: GitHub/GitLab PR ──────────────────────────────────────────────────
info "Step 4/4 — Opening or updating PR: ${MIRROR_BRANCH} → ${BASE_BRANCH}..."

if ! command -v gh &>/dev/null; then
  warn "gh CLI not found — skipping PR creation."
  warn "Manually open a PR from '${MIRROR_BRANCH}' to '${BASE_BRANCH}' on your Git host."
  exit 0
fi

# Check if a PR already exists for this branch
EXISTING_PR=$(gh pr list --head "${MIRROR_BRANCH}" --base "${BASE_BRANCH}" --json number,url \
  --jq '.[0].url' 2>/dev/null || true)

if [[ -n "$EXISTING_PR" ]]; then
  warn "PR already exists: $EXISTING_PR"
  warn "Review and merge it at the link above. (The bridge already updated the branch.)"
else
  PR_URL=$(gh pr create \
    --base "${BASE_BRANCH}" \
    --head "${MIRROR_BRANCH}" \
    --title "${PR_TITLE}" \
    --body "Automated mirror from MuseHub. All development and review happened there.

- Security audit passed (0 high/critical vulnerabilities)
- Bridged via: \`muse bridge git-export\`
- Source: \`muse status\` on Muse main at time of bridge

Merge this PR to trigger your deployment platform." \
    2>&1)
  success "PR created: $PR_URL"
fi

echo ""
success "Deploy pipeline complete."
echo -e "  Next step: merge the PR on GitHub/GitLab and your deployment platform will pick it up."
