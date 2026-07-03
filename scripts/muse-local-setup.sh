#!/usr/bin/env bash
# muse-local-setup.sh — one-shot LOCAL hygiene for a Muse-as-source-of-truth repo.
#
# Run once per fresh clone. Everything here is local-only, idempotent, and reversible;
# it never changes tracked repo content, the Muse snapshot, or any remote.
#
# What it does:
#   1. Marks volatile .muse/* files `skip-worktree` so Muse rewriting its own bookkeeping
#      (HEAD, config.toml, symlogs, logs) on every checkout/commit stops dirtying the git
#      tree and blocking `git checkout`. (.muse/harmony/** is left live on purpose.)
#   2. Fails loudly if secret/local files (.env, config/local.yaml, …) are git-tracked —
#      they must always be ignored so the bridge/CI never leak them.
#   3. Runs the bridge safety smoke test if present.
#   4. Prints the golden rule about the destructive bridge form.
#
# Canonical guidance: Knowtation vault → areas/muse-ops/muse-local-hygiene.md
# Reverse the skip-worktree bits with: git update-index --no-skip-worktree <file>

set -euo pipefail

info()  { printf '\033[0;34m[muse-setup]\033[0m %s\n' "$*"; }
ok()    { printf '\033[0;32m[muse-setup]\033[0m %s\n' "$*"; }
warn()  { printf '\033[1;33m[muse-setup]\033[0m %s\n' "$*"; }
fail()  { printf '\033[0;31m[muse-setup] ERROR:\033[0m %s\n' "$*" >&2; exit 1; }

command -v git >/dev/null 2>&1 || fail "git is required."
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || fail "Not inside a git repository."
cd "$REPO_ROOT"

# ── 1. skip-worktree the volatile .muse bookkeeping files ────────────────────────────────
info "Applying skip-worktree to volatile .muse/* files (keeping .muse/harmony/** live)…"
applied=0
while IFS= read -r f; do
  [ -n "$f" ] || continue
  if git update-index --skip-worktree "$f" 2>/dev/null; then
    applied=$((applied + 1))
  fi
done < <(git ls-files .muse/ | grep -Ev '^\.muse/harmony/' || true)
ok "skip-worktree set on ${applied} volatile .muse file(s)."

# ── 2. Guard: secrets/local files must never be git-tracked ──────────────────────────────
info "Verifying secret/local files are NOT git-tracked…"
tracked_secrets="$(git ls-files \
  '.env' '.env.*' \
  'config/local.yaml' 'config/*-local.*' \
  '*.key' '*.pem' '*.p12' 2>/dev/null | grep -Ev '(^|/)\.env\.example$' || true)"
if [ -n "$tracked_secrets" ]; then
  warn "These secret/local files are git-tracked and MUST be untracked:"
  printf '  %s\n' $tracked_secrets >&2
  fail "Untrack them (keep the working copy) with: git rm --cached <file>  — then re-run this script."
fi
ok "No secret/local files are git-tracked."

# ── 3. Bridge safety smoke test (if present) ─────────────────────────────────────────────
if [ -f scripts/test-muse-bridge-safety.sh ]; then
  if command -v muse >/dev/null 2>&1; then
    info "Running bridge safety smoke test…"
    bash scripts/test-muse-bridge-safety.sh || fail "Bridge safety smoke test FAILED — do not run the bridge until resolved."
    ok "Bridge safety smoke test passed."
  else
    warn "muse not on PATH — skipping bridge safety smoke test."
  fi
else
  info "No scripts/test-muse-bridge-safety.sh in this repo — skipping safety smoke test."
fi

# ── 4. Golden rule ───────────────────────────────────────────────────────────────────────
cat <<'RULE'

  ────────────────────────────────────────────────────────────────────────────
  GOLDEN RULE: never run `muse bridge git-export/import --git-dir .` on a working
  tree — it deletes ignored files (.env, config/local.yaml, data/) permanently.
  Mirror to GitHub ONLY via: ./scripts/muse-bridge-deploy.sh "mirror: <desc>"
  After a merge, reconcile: git fetch origin && git checkout main && git reset --hard origin/main
  ────────────────────────────────────────────────────────────────────────────

RULE
ok "Local Muse hygiene setup complete."
