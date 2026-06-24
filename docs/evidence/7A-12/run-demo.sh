#!/usr/bin/env bash
#
# Anti-drift diff demo (Phase 7A, Step 7A-12) — reproducible driver.
#
# Proves the FLOW-PROJECTION-GENERATOR-CONTRACT-7A-11 §10 acceptance bar end-to-end against
# our own repo guidance, using the real `knowtation flow project` CLI:
#   1. Generate marker-first, ordered, secret-free artifacts from a canonical Flow.
#   2. Edit canonical + bump version -> regenerate -> diff shows ONLY the canonical change.
#   3. Delete the artifact -> regenerate -> reproduced byte-for-byte.
#   4. Hand-edit the artifact -> `--check` reports drift and exits non-zero.
#   5. Canonical ahead of a pinned artifact -> `--check` reports stale and exits non-zero.
#   6. Fidelity is honest (cursor_rule drops `when_not_to_run`; cli_runbook expresses it).
#
# Scope fence (7A-12): demo only. The shipped `flows/starter/` bundles, the live data store,
# the real `AGENTS.md`, and `.cursor/rules/` are NOT touched — the demo runs against copied
# starter bundles (`demo-starters/v1`,`/v2`) and a throwaway data store (mktemp).
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$REPO_ROOT"

EV="docs/evidence/7A-12"
ART="$EV/artifacts"
V1="$EV/demo-starters/v1"
V2="$EV/demo-starters/v2"
STORE_ROOT="$(mktemp -d)"
export KNOWTATION_DATA_DIR="$STORE_ROOT/data"
mkdir -p "$KNOWTATION_DATA_DIR" "$ART"

TRANSCRIPT="$ART/transcript.txt"
: > "$TRANSCRIPT"

log() { printf '%s\n' "$*" | tee -a "$TRANSCRIPT"; }
run() { # run <label> <cmd...>  — records cmd, output, and exit code (never aborts the driver)
  local label="$1"; shift
  log ""
  log "### $label"
  log "\$ $*"
  "$@" >>"$TRANSCRIPT" 2>&1
  local rc=$?
  log "[exit=$rc]"
  return 0
}

FLOW="flow_overseer_handover"

log "=== Anti-drift diff demo (7A-12) ==="
log "store: $KNOWTATION_DATA_DIR"

# --- Stage A: seed canonical v0.1.0 into a clean store -------------------------------------
node -e "import('./lib/flow/flow-store.mjs').then(m=>{const r=m.seedStarterFlows(process.env.KNOWTATION_DATA_DIR,'default',{starterDir:'$V1'});console.log('seed v1',JSON.stringify(r));})" | tee -a "$TRANSCRIPT"

# (1) Generate baseline artifacts from canonical v0.1.0
run "1a. generate cursor_rule @ v0.1.0" \
  node cli/index.mjs flow project "$FLOW" --harness cursor_rule --out "$ART/overseer.v0.1.0.mdc"
run "1b. generate cli_runbook @ v0.1.0" \
  node cli/index.mjs flow project "$FLOW" --harness cli_runbook --out "$ART/overseer.AGENTS.v0.1.0.md"

# baseline --check is clean (artifact matches a fresh render of the same version)
run "1c. --check baseline cli_runbook (expect drift=false, exit 0)" \
  node cli/index.mjs flow project "$FLOW" --harness cli_runbook --out "$ART/overseer.AGENTS.v0.1.0.md" --check

# --- Stage B: add canonical v0.2.0 (one tightened flow.summary + version bump) -------------
# NOTE: the canonical change is at the FLOW level (summary). The 7A-10b store keys step bodies by
# step_id only (not (step_id, version)), so a step-field change cannot diverge across versions in a
# single store — see docs/evidence/7A-12/README.md "Store finding". A flow-level change proves
# anti-drift cleanly through both harnesses without depending on that gap.
node -e "import('./lib/flow/flow-store.mjs').then(m=>{const r=m.seedStarterFlows(process.env.KNOWTATION_DATA_DIR,'default',{starterDir:'$V2'});console.log('seed v2',JSON.stringify(r));})" | tee -a "$TRANSCRIPT"

# (2) Regenerate at latest (now v0.2.0) and prove the diff carries ONLY the canonical change
run "2a. regenerate cursor_rule @ latest (v0.2.0)" \
  node cli/index.mjs flow project "$FLOW" --harness cursor_rule --out "$ART/overseer.v0.2.0.mdc"
run "2b. regenerate cli_runbook @ latest (v0.2.0)" \
  node cli/index.mjs flow project "$FLOW" --harness cli_runbook --out "$ART/overseer.AGENTS.v0.2.0.md"

log ""
log "### 2c. diff v0.1.0 -> v0.2.0 (cursor_rule) — expect only marker version + verification line"
diff -u "$ART/overseer.v0.1.0.mdc" "$ART/overseer.v0.2.0.mdc" | tee "$ART/overseer.cursor.v1-to-v2.diff" | tee -a "$TRANSCRIPT"
log "[diff captured: $ART/overseer.cursor.v1-to-v2.diff]"

log ""
log "### 2d. diff v0.1.0 -> v0.2.0 (cli_runbook) — expect only marker version + verification line"
diff -u "$ART/overseer.AGENTS.v0.1.0.md" "$ART/overseer.AGENTS.v0.2.0.md" | tee "$ART/overseer.runbook.v1-to-v2.diff" | tee -a "$TRANSCRIPT"
log "[diff captured: $ART/overseer.runbook.v1-to-v2.diff]"

# (3) Delete loses nothing: remove the v0.2.0 artifact, regenerate, prove byte-identical
cp "$ART/overseer.v0.2.0.mdc" "$ART/.overseer.v0.2.0.mdc.keep"
rm -f "$ART/overseer.v0.2.0.mdc"
run "3a. regenerate deleted cursor_rule @ v0.2.0" \
  node cli/index.mjs flow project "$FLOW" --harness cursor_rule --out "$ART/overseer.v0.2.0.mdc"
log ""
log "### 3b. byte-identical after delete+regenerate (expect no output / identical)"
if diff "$ART/.overseer.v0.2.0.mdc.keep" "$ART/overseer.v0.2.0.mdc" >>"$TRANSCRIPT" 2>&1; then
  log "IDENTICAL: regenerated artifact == pre-delete artifact (lossless)"
else
  log "MISMATCH: regeneration was not byte-identical"
fi
rm -f "$ART/.overseer.v0.2.0.mdc.keep"

# (4) Hand-edit is caught: scribble on the artifact, --check must report drift + exit non-zero
cp "$ART/overseer.AGENTS.v0.2.0.md" "$ART/overseer.AGENTS.handedited.md"
printf '\n<!-- hand-scribbled note that is NOT in canonical -->\n' >> "$ART/overseer.AGENTS.handedited.md"
run "4. --check hand-edited cli_runbook (expect drift=true edited, exit 1)" \
  node cli/index.mjs flow project "$FLOW" --harness cli_runbook --out "$ART/overseer.AGENTS.handedited.md" --check

# (5) Staleness surfaces: pin the older version against the lagging artifact
run "5. --check pinned v0.1.0 vs latest v0.2.0 (expect stale=true, exit 1)" \
  node cli/index.mjs flow project "$FLOW" --harness cli_runbook --version 0.1.0 --out "$ART/overseer.AGENTS.v0.1.0.md" --check

# (6) Fidelity honesty across harnesses (machine-readable envelope)
run "6a. cursor_rule fidelity (expect when_not_to_run dropped)" \
  node cli/index.mjs flow project "$FLOW" --harness cursor_rule --json
run "6b. cli_runbook fidelity (expect when_not_to_run expressed, not dropped)" \
  node cli/index.mjs flow project "$FLOW" --harness cli_runbook --json

log ""
log "=== demo complete — artifacts + diffs + transcript under $ART ==="
rm -rf "$STORE_ROOT"
