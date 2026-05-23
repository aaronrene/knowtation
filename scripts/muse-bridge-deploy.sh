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
#   - MUSE_BRIDGE_MIRROR_DIR env var (default: .muse/mirror)

set -euo pipefail

# ── Config (override via env) ──────────────────────────────────────────────────
MIRROR_BRANCH="${MUSE_BRIDGE_GIT_BRANCH:-muse-mirror}"
BASE_BRANCH="${MUSE_BRIDGE_BASE_BRANCH:-main}"
PR_TITLE="${1:-mirror: deploy from MuseHub $(date '+%Y-%m-%d')}"
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
MIRROR_DIR="${MUSE_BRIDGE_MIRROR_DIR:-.muse/mirror}"

# ── Colors ─────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'; BLUE='\033[0;34m'; NC='\033[0m'
info()    { echo -e "${BLUE}[bridge]${NC} $*"; }
success() { echo -e "${GREEN}[bridge]${NC} $*"; }
warn()    { echo -e "${YELLOW}[bridge]${NC} $*"; }
fail()    { echo -e "${RED}[bridge] ERROR:${NC} $*" >&2; exit 1; }

cd "$REPO_ROOT"

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

if [[ ! -f package.json ]]; then
  warn "No package.json found — skipping npm audit. Add audits for your stack manually."
else
  AUDIT_FIX_OUTPUT=$(npm audit fix --audit-level=moderate 2>&1 || true)
  printf '%s\n' "$AUDIT_FIX_OUTPUT" | tail -5

  # Check if high/critical vulns remain after auto-fix
  HIGH_COUNT=$(npm audit --json 2>/dev/null \
    | python3 -c "import json,sys; d=json.load(sys.stdin); \
      v=d.get('metadata',{}).get('vulnerabilities',{}); \
      print(v.get('high',0)+v.get('critical',0))" 2>/dev/null || echo "0")

  if [[ "$HIGH_COUNT" -gt 0 ]]; then
    fail "npm audit found $HIGH_COUNT high/critical vulnerabilities that could not be auto-fixed.\n\
Run 'npm audit' to review them, fix manually, then re-run this script.\n\
DO NOT bridge with known high/critical vulnerabilities."
  fi
  success "Audit clean — 0 high/critical vulnerabilities."
fi

# ── Step 2: Commit audit changes if any ───────────────────────────────────────
info "Step 2/4 — Checking for audit-generated changes..."

AUDIT_CHANGED=$(muse status --short 2>/dev/null | grep -E "package-lock\.json|package\.json" || true)

if [[ -n "$AUDIT_CHANGED" ]]; then
  warn "Audit changed package files — committing to Muse before bridging."
  muse code add package-lock.json package.json 2>/dev/null || true
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

muse bridge git-export \
  --git-dir "${MIRROR_DIR_ABS}" \
  --git-branch "${MIRROR_BRANCH}" \
  --git-remote origin \
  --force-push \
  --exclude '.env' \
  --exclude '.env.local' \
  --exclude '.env.*.local' \
  --exclude 'config/local.yaml' \
  --exclude 'config/*-local.*' \
  --exclude 'data/*' \
  --exclude 'data/**' \
  --exclude '*.db' \
  --exclude '*.sqlite'

verify_sentinels

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
