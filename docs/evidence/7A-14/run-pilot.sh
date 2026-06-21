#!/usr/bin/env bash
#
# Muse commit pilot (Phase 7A, Step 7A-14) — reproducible driver.
#
# Proves the canonical → projection → Muse commit loop end-to-end on our own repo-guidance
# Flow `flow_overseer_handover`, extending the 7A-12 anti-drift demo with Muse as the durable
# write surface:
#   1. Generate marker-first projections from canonical v0.1.0 into the pilot workspace.
#   2. Muse-commit the baseline artifacts on feat/flow-projection-pilot.
#   3. Bump canonical to v0.2.0, regenerate, capture clean diff (only canonical change).
#   4. Muse-commit the updated artifacts; record before/after SHAs + muse diff.
#   5. Anti-drift gates: delete+regenerate byte-identical; hand-edit caught; staleness caught.
#
# Scope fence (7A-14): pilot + evidence only. Does NOT touch flows/starter/, the live data store,
# real AGENTS.md, .cursor/rules/, FLOW_LIVE_READ_AUTHORIZED, flow run, or MuseHub enrichment.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$REPO_ROOT"

KNOWTATION_MUSE="muse -C $REPO_ROOT"
EV="docs/evidence/7A-14"
ART="$EV/artifacts"
WS="$EV/pilot-workspace"
V1="docs/evidence/7A-12/demo-starters/v1"
V2="docs/evidence/7A-12/demo-starters/v2"
STORE_ROOT="$(mktemp -d)"
export KNOWTATION_DATA_DIR="$STORE_ROOT/data"

FLOW="flow_overseer_handover"
RUNBOOK_OUT="$WS/overseer.AGENTS.md"
CURSOR_OUT="$WS/overseer.cursor.mdc"

TRANSCRIPT="$ART/transcript.txt"
SHA_BEFORE="$ART/muse-sha-before.txt"
SHA_AFTER="$ART/muse-sha-after.txt"
MUSE_DIFF="$ART/muse-commit.v1-to-v2.diff"

mkdir -p "$KNOWTATION_DATA_DIR" "$ART" "$WS"
: > "$TRANSCRIPT"

log() { printf '%s\n' "$*" | tee -a "$TRANSCRIPT"; }
run() {
  local label="$1"; shift
  log ""
  log "### $label"
  log "\$ $*"
  "$@" >>"$TRANSCRIPT" 2>&1
  local rc=$?
  log "[exit=$rc]"
  return 0
}

log "=== Muse commit pilot (7A-14) ==="
log "repo: $REPO_ROOT"
log "store: $KNOWTATION_DATA_DIR"
log "pilot workspace: $WS"

# --- Dependency gate: branch + Muse HEAD (7A-10b/7A-11b/7A-12 baseline) --------------------
run "0a. muse status (dependency gate)" $KNOWTATION_MUSE status
BRANCH=$($KNOWTATION_MUSE status 2>/dev/null | awk '/^On branch/{print $3}')
if [[ "$BRANCH" != "feat/flow-projection-pilot" ]]; then
  log "FATAL: expected branch feat/flow-projection-pilot, got: ${BRANCH:-unknown}"
  exit 1
fi

# --- Stage A: seed canonical v0.1.0, generate baseline projections ------------------------
node -e "import('./lib/flow/flow-store.mjs').then(m=>{const r=m.seedStarterFlows(process.env.KNOWTATION_DATA_DIR,'default',{starterDir:'$V1'});console.log('seed v1',JSON.stringify(r));})" | tee -a "$TRANSCRIPT"

run "1a. generate cli_runbook @ v0.1.0 → pilot workspace" \
  node cli/index.mjs flow project "$FLOW" --harness cli_runbook --out "$RUNBOOK_OUT"
run "1b. generate cursor_rule @ v0.1.0 → pilot workspace" \
  node cli/index.mjs flow project "$FLOW" --harness cursor_rule --out "$CURSOR_OUT"
run "1c. --check baseline cli_runbook (expect drift=false, exit 0)" \
  node cli/index.mjs flow project "$FLOW" --harness cli_runbook --out "$RUNBOOK_OUT" --check

# --- Stage B: Muse commit v0.1.0 baseline -------------------------------------------------
$KNOWTATION_MUSE log -1 | tee "$SHA_BEFORE" | tee -a "$TRANSCRIPT"
SHA_BEFORE_VAL=$($KNOWTATION_MUSE log -1 | sed -n 's/^commit \(sha256:[^ ]*\).*/\1/p')
log "sha before pilot commits: $SHA_BEFORE_VAL"

run "2a. muse code add pilot workspace + evidence driver" \
  $KNOWTATION_MUSE code add "$WS" "$EV/run-pilot.sh"
run "2b. muse commit v0.1.0 pilot baseline" \
  $KNOWTATION_MUSE commit -m "$(cat <<'EOF'
feat(flow): 7A-14 Muse commit pilot baseline @ v0.1.0

Generate repo-guidance projections (cli_runbook + cursor_rule) from canonical
flow_overseer_handover v0.1.0 into docs/evidence/7A-14/pilot-workspace/ and
Muse-commit them as the durable write surface. Pilot only — real AGENTS.md and
.cursor/rules untouched; throwaway store; posture unchanged.

EOF
)"

COMMIT_V1=$($KNOWTATION_MUSE log -1 | sed -n 's/^commit \(sha256:[^ ]*\).*/\1/p')
log "commit v0.1.0 sha: $COMMIT_V1"

# --- Stage C: canonical v0.2.0, regenerate, capture anti-drift diff -----------------------
node -e "import('./lib/flow/flow-store.mjs').then(m=>{const r=m.seedStarterFlows(process.env.KNOWTATION_DATA_DIR,'default',{starterDir:'$V2'});console.log('seed v2',JSON.stringify(r));})" | tee -a "$TRANSCRIPT"

cp "$RUNBOOK_OUT" "$ART/overseer.AGENTS.v0.1.0.md"
cp "$CURSOR_OUT" "$ART/overseer.v0.1.0.mdc"

run "3a. regenerate cli_runbook @ v0.2.0" \
  node cli/index.mjs flow project "$FLOW" --harness cli_runbook --out "$RUNBOOK_OUT"
run "3b. regenerate cursor_rule @ v0.2.0" \
  node cli/index.mjs flow project "$FLOW" --harness cursor_rule --out "$CURSOR_OUT"

cp "$RUNBOOK_OUT" "$ART/overseer.AGENTS.v0.2.0.md"
cp "$CURSOR_OUT" "$ART/overseer.v0.2.0.mdc"

log ""
log "### 3c. anti-drift diff v0.1.0 → v0.2.0 (cli_runbook)"
diff -u "$ART/overseer.AGENTS.v0.1.0.md" "$ART/overseer.AGENTS.v0.2.0.md" | tee "$ART/overseer.runbook.v1-to-v2.diff" | tee -a "$TRANSCRIPT"
log "[diff captured: $ART/overseer.runbook.v1-to-v2.diff]"

log ""
log "### 3d. anti-drift diff v0.1.0 → v0.2.0 (cursor_rule)"
diff -u "$ART/overseer.v0.1.0.mdc" "$ART/overseer.v0.2.0.mdc" | tee "$ART/overseer.cursor.v1-to-v2.diff" | tee -a "$TRANSCRIPT"
log "[diff captured: $ART/overseer.cursor.v1-to-v2.diff]"

# --- Stage D: Muse commit v0.2.0 + record muse diff between commits -------------------------
run "4a. muse code add updated pilot workspace" $KNOWTATION_MUSE code add "$WS"
run "4b. muse commit v0.2.0 pilot update" \
  $KNOWTATION_MUSE commit -m "$(cat <<'EOF'
feat(flow): 7A-14 Muse commit pilot update @ v0.2.0

Regenerate pilot-workspace projections after canonical flow_overseer_handover
0.1.0→0.2.0 bump. Diff carries only the canonical summary change + marker version
(anti-drift proven in docs/evidence/7A-14/artifacts/). Pilot only.

EOF
)"

COMMIT_V2=$($KNOWTATION_MUSE log -1 | sed -n 's/^commit \(sha256:[^ ]*\).*/\1/p')
log "commit v0.2.0 sha: $COMMIT_V2"
$KNOWTATION_MUSE log -1 | tee "$SHA_AFTER" | tee -a "$TRANSCRIPT"

log ""
log "### 4c. muse diff v0.1.0 commit → v0.2.0 commit (pilot workspace only)"
if [[ -n "$COMMIT_V1" && -n "$COMMIT_V2" ]]; then
  $KNOWTATION_MUSE diff "$COMMIT_V1" "$COMMIT_V2" --path "$WS" 2>/dev/null | tee "$MUSE_DIFF" | tee -a "$TRANSCRIPT" || \
    log "[muse diff unavailable — artifact diffs in $ART/ are authoritative]"
else
  log "[skip muse diff — commit shas not captured]"
fi

# --- Stage E: anti-drift acceptance (extends 7A-12 §10) -----------------------------------
cp "$RUNBOOK_OUT" "$ART/.overseer.AGENTS.v0.2.0.keep"
rm -f "$RUNBOOK_OUT"
run "5a. regenerate deleted cli_runbook @ v0.2.0" \
  node cli/index.mjs flow project "$FLOW" --harness cli_runbook --out "$RUNBOOK_OUT"
log ""
log "### 5b. byte-identical after delete+regenerate"
if diff "$ART/.overseer.AGENTS.v0.2.0.keep" "$RUNBOOK_OUT" >>"$TRANSCRIPT" 2>&1; then
  log "IDENTICAL: regenerated artifact == pre-delete artifact (lossless)"
else
  log "MISMATCH: regeneration was not byte-identical"
fi
rm -f "$ART/.overseer.AGENTS.v0.2.0.keep"

cp "$RUNBOOK_OUT" "$ART/overseer.AGENTS.handedited.md"
printf '\n<!-- hand-scribbled note that is NOT in canonical -->\n' >> "$ART/overseer.AGENTS.handedited.md"
run "5c. --check hand-edited cli_runbook (expect drift=true, exit 1)" \
  node cli/index.mjs flow project "$FLOW" --harness cli_runbook --out "$ART/overseer.AGENTS.handedited.md" --check

run "5d. --check pinned v0.1.0 vs latest v0.2.0 (expect stale=true, exit 1)" \
  node cli/index.mjs flow project "$FLOW" --harness cli_runbook --version 0.1.0 --out "$ART/overseer.AGENTS.v0.1.0.md" --check

run "5e. cursor_rule fidelity (--json)" \
  node cli/index.mjs flow project "$FLOW" --harness cursor_rule --json
run "5f. cli_runbook fidelity (--json)" \
  node cli/index.mjs flow project "$FLOW" --harness cli_runbook --json

log ""
log "=== pilot complete — workspace + artifacts + muse SHAs under $EV ==="
rm -rf "$STORE_ROOT"
