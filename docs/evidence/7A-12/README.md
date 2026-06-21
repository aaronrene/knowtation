# Anti-drift diff demo — acceptance evidence (Phase 7A, Step 7A-12)

Status: **PASS — all six acceptance criteria proven end-to-end** against our own repo guidance,
using the real `knowtation flow project` CLI on the `project`-scoped dogfood Flow
`flow_overseer_handover`.

This directory is the durable evidence for 7A-12. It is reproducible: re-run
[`run-demo.sh`](run-demo.sh) and the same artifacts, diffs, and transcript are regenerated.

- **Repo / branch / Muse:** Knowtation `feat/flow-projection-pilot` @ `ea6d4206` (7A-11b generator).
- **Generator:** `PROJECTION_GENERATOR_VERSION = 1`; active harnesses `cursor_rule`, `cli_runbook`.
- **Contract:** `docs/FLOW-PROJECTION-GENERATOR-CONTRACT-7A-11.md` §10 (acceptance bar) + §4 (staleness/drift).

## Simple summary (plain language)

A **Flow** is the one true copy of a procedure kept in Knowtation. A **projection** is a printout of
that procedure in the exact format one tool wants (a Cursor rule file, an `AGENTS.md`). We pointed the
printer at our real "overseer handover" procedure, printed both formats, then changed the procedure
once and reprinted. The reprint differed in **exactly** the one thing we changed and nothing else.
Deleting a printout lost nothing (we reprinted it identically). Scribbling on a printout by hand was
caught and refused. An out-of-date printout was flagged as stale. And when a format genuinely cannot
hold a field, the printer **tells you** what it left out instead of hiding it.

## Technical summary

The deterministic generator (`projectFlow` pure over `(flow, steps, harness,
PROJECTION_GENERATOR_VERSION)`) renders canonical `knowtation.flow/v0` into byte-stable
`knowtation.flow_projection/v0` artifacts. The only non-deterministic value (`generated_at`) lives in
the envelope and is excluded from `content_hash` and `rendered`, so `diff` is meaningful. A canonical
flow-level change + a `0.1.0 → 0.2.0` version bump produced a diff carrying **only** that change plus
the version marker, on both harnesses. `detectDrift` (marker-normalized content compare) and
`isProjectionStale` (semver lag) gate `--check` with a non-zero exit. Fidelity (`dropped_fields`) is
honest per harness. No secrets appear in any rendered byte.

---

## Acceptance criteria — results

| # | Criterion (contract §10) | Command (real CLI) | Result |
| --- | --- | --- | --- |
| 1 | **Generate** marker-first, ordered, secret-free artifacts | `flow project … --harness cursor_rule/cli_runbook --out …` | ✅ both harnesses, marker line first, 6 steps in `ordinal` order |
| 2 | **Edit canonical → regenerate → clean diff** | bump `0.1.0→0.2.0`, regenerate | ✅ diff = **only** the changed `summary` line + the marker version (`@0.1.0`→`@0.2.0`) |
| 3 | **Delete loses nothing** | `rm` artifact, regenerate | ✅ `IDENTICAL` — reproduced byte-for-byte |
| 4 | **Hand-edit is caught** | scribble + `--check` | ✅ `drift: true (edited)`, **exit 1** — never promoted |
| 5 | **Staleness surfaces** | `--version 0.1.0 --check` vs latest `0.2.0` | ✅ `stale: true`, `projection 0.1.0 < latest 0.2.0`, **exit 1** |
| 6 | **Fidelity is honest** | `--json` per harness | ✅ `cursor_rule` drops `["inputs","outputs","requires","when_not_to_run"]`; `cli_runbook` drops `[]` |

### The clean diff (criterion 2) — the keystone proof

`cursor_rule` ([`overseer.cursor.v1-to-v2.diff`](artifacts/overseer.cursor.v1-to-v2.diff)) and
`cli_runbook` ([`overseer.runbook.v1-to-v2.diff`](artifacts/overseer.runbook.v1-to-v2.diff)) each
show **two** changed lines and nothing else: the canonical `summary`/`description` line and the
generated-marker version. No incidental drift, no reordering, no formatting churn.

```diff
-<!-- GENERATED FROM CANONICAL FLOW flow_overseer_handover@0.1.0 (generator v1) — DO NOT EDIT; … -->
+<!-- GENERATED FROM CANONICAL FLOW flow_overseer_handover@0.2.0 (generator v1) — DO NOT EDIT; … -->
-Docs-first handover … update durable docs, then regenerate …
+Docs-first handover … update the durable docs (ROADMAP snapshot, next-session plan, coordination doc), then regenerate …
```

### Security checks

- **No secrets in any artifact.** A scan for `token|oauth|refresh_token|api_key|secret|password|bearer`
  over every rendered file returns only the canonical boundary text *"No secrets in captured output"*
  / *"No secrets in the block"* — i.e. the Flow's own instruction, not a leaked credential.
- **Untrusted step text rendered inert.** `<`/`>` are HTML-escaped (`muse -C &lt;abs path&gt;`); no
  step field is interpreted or able to widen scope from inside the artifact.
- **Hand edit never promoted** (`editable:false` holds; criterion 4) — the only remedy is regenerate.

Full evidence: [`artifacts/transcript.txt`](artifacts/transcript.txt) (every command, output, exit code).

---

## What this demo required (and the one wiring gap it closed)

To project the two `project`-scoped dogfood Flows via the **documented CLI**, the operator's local
identity must authorize `project` scope. The contract (`FLOW-STORE-CONTRACT-7A-10` §4) specifies this
flows through **local config identity** (not a CLI flag). The CLI already read
`config.flow?.visible_scopes`, but `loadConfig` did not surface a `flow` key, so that channel was
inert — the documented command could never resolve a `project` Flow.

**Fix (durable, contract-specified — not a demo shim):** `lib/config.mjs` now surfaces
`flow.visible_scopes` (validated to a clean string array; deny-by-default when absent; empty/malformed
⇒ `undefined`). Covered by five new cases in `test/config.test.mjs`
(`loadConfig — flow.visible_scopes`). The operator grant itself lives in the git/muse-ignored
`config/local.yaml` (`flow.visible_scopes: [personal, project, org]`) — the legitimate per-operator
identity, never committed.

## Store finding (follow-up, not fixed here — scope fence: demo only)

The 7A-10b store keys **step bodies by `step_id` only**, not `(step_id, version)`
(`getFlow` resolves `vault.steps.filter(s => s.flow_id === flowId)`, ignoring version; `seedStarterFlows`
skips a step whose `step_id` already exists). Consequence: **two versions of the same Flow cannot
carry divergent step bodies in a single store** — a step-field edit on `v0.2.0` silently renders the
`v0.1.0` step text.

- **Impact on this demo:** none for the proof — we made the canonical change at the **flow level**
  (`summary`), which the store versions correctly and both harnesses render. Anti-drift is proven
  honestly.
- **Why not fixed here:** the step record shape is the **frozen 7A-10b contract**; versioned step
  storage is a schema change (Tier 2 decision + its own seven-tier slice), explicitly outside the
  7A-12 "demo only" fence.
- **Recommendation:** track as a Knowtation follow-up (suggest `7A-10c` — versioned step keying, e.g.
  `(flow_id, version, ordinal)` or a per-version steps array) **before** any surface needs to edit a
  step in place. It does **not** block 7A-13 (Scooling loopback read), which reads whole Flows.

---

## Reproduce

```bash
cd ~/knowtation
bash docs/evidence/7A-12/run-demo.sh
```

The driver uses **copied** starter bundles (`demo-starters/v1`, `demo-starters/v2`) and a throwaway
`mktemp` data store. It does **not** touch the shipped `flows/starter/` bundles, the live data store,
the real `AGENTS.md`, or `.cursor/rules/` — honoring the 7A-12 scope fence.

## Files

| Path | What |
| --- | --- |
| `run-demo.sh` | Reproducible driver (real CLI; throwaway store) |
| `demo-starters/v1/`, `demo-starters/v2/` | Canonical Flow bundles before/after the one change (`0.1.0`/`0.2.0`) |
| `artifacts/overseer.v0.1.0.mdc`, `…v0.2.0.mdc` | `cursor_rule` projections |
| `artifacts/overseer.AGENTS.v0.1.0.md`, `…v0.2.0.md` | `cli_runbook` projections |
| `artifacts/overseer.cursor.v1-to-v2.diff`, `…runbook.v1-to-v2.diff` | The clean diffs (criterion 2) |
| `artifacts/overseer.AGENTS.handedited.md` | Hand-scribbled artifact (criterion 4 input) |
| `artifacts/transcript.txt` | Full command/output/exit-code transcript |
