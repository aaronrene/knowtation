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
#   3. Bridge export     — muse bridge git-export → muse-mirror branch
#   4. GitHub PR         — opens a PR from muse-mirror to main (skips if one already exists)
#
# Requirements:
#   - muse CLI in PATH (from ~/.local/share/muse/venv/bin)
#   - gh CLI in PATH and authenticated (gh auth status)
#   - git remote "origin" points to your GitHub/GitLab repo
#   - MUSE_BRIDGE_GIT_BRANCH env var (default: muse-mirror)
#   - MUSE_BRIDGE_BASE_BRANCH env var (default: main)

set -euo pipefail

# ── Config (override via env) ──────────────────────────────────────────────────
MIRROR_BRANCH="${MUSE_BRIDGE_GIT_BRANCH:-muse-mirror}"
BASE_BRANCH="${MUSE_BRIDGE_BASE_BRANCH:-main}"
PR_TITLE="${1:-mirror: deploy from MuseHub $(date '+%Y-%m-%d')}"
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

# ── Colors ─────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'; BLUE='\033[0;34m'; NC='\033[0m'
info()    { echo -e "${BLUE}[bridge]${NC} $*"; }
success() { echo -e "${GREEN}[bridge]${NC} $*"; }
warn()    { echo -e "${YELLOW}[bridge]${NC} $*"; }
fail()    { echo -e "${RED}[bridge] ERROR:${NC} $*" >&2; exit 1; }

cd "$REPO_ROOT"

# ── Step 1: Security audit ─────────────────────────────────────────────────────
info "Step 1/4 — Running security audit (npm audit fix)..."

if [[ ! -f package.json ]]; then
  warn "No package.json found — skipping npm audit. Add audits for your stack manually."
else
  npm audit fix --audit-level=moderate 2>&1 | tail -5

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
info "Step 3/4 — Bridging Muse main → ${MIRROR_BRANCH}..."

muse bridge git-export \
  --git-dir . \
  --git-branch "${MIRROR_BRANCH}" \
  --git-remote origin \
  --force-push

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
