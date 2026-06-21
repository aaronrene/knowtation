# Flow Capture Flywheel — Canonical Contract (Phase 7A, Step 7A-L4a)

Status: **Contract only — Thinking step (7A-L4a).** This is the frozen, canonical
contract for the **capture flywheel gate**: content-minimized session-signal detection,
`knowtation.flow_candidate/v0` lifecycle, candidate promotion rules, dedup/merge, and
review-before-write promotion to `knowtation.flow/v0`. **No implementation, no routes,
no MCP/CLI wiring, no posture flip, and no live detection ships in this step.** The
mechanical implementation (detector handlers, candidate store writes, promotion/dismiss
facades, Scooling live wire, seven-tier test bodies) is **7A-L4b (Auto)**, written to
this contract without redesigning it.

Authored on branch **`feat/flow-projection-pilot`** (Knowtation). Always target the
repo explicitly with `muse -C ~/knowtation …`.

Related:

- `docs/FLOW-V0-SPEC.md` — §1.6 (`flow_candidate/v0`), §5 (capture flywheel,
  thresholds, guardrails), §6 items 1/2/4/5/11 (scope, untrusted input, pointers-only,
  review-before-write, seven-tier matrix).
- `docs/FLOW-STORE-CONTRACT-7A-10.md` — `candidates[]` persistence (inert placeholder
  until this gate); read/list invariants.
- `docs/FLOW-AUTHORING-WRITEBACK-CONTRACT-7A-L1.md` — SD-4 propose/approve/apply
  machinery reused for **promotion** (distinct intent); `validateFlowBundle` on approve.
- `scooling/docs/FLOW-ADAPTERS-CONTRACT-7A-6.md` — frozen `FlowCaptureAdapter` interface
  (rules 15–18, method table, thresholds, refusal codes).
- `scooling/docs/FLOW-CAPTURE-LIVE-WIRE-CONTRACT-7A-L4.md` — the **consumer** half
  (detection/write double-lock posture) ratified field-for-field against this contract.

**Scope fence (7A-L4a):** detection signal model + threshold constants + candidate
record lifecycle + promotion/dismiss rules + dedup/merge + scope-confirmation model +
vault capture policy + error taxonomy + seven-tier test matrix **only**. **Not** in
scope: handler impl, routes, MCP/CLI wiring, OpenAPI edits (land **with** routes in
7A-L4b), automatable execution (7A-L3), MuseHub enrichment (7A-L5), or flipping
`FLOW_CAPTURE_DETECTION_ENABLED` / `FLOW_CAPTURE_WRITES_ENABLED`.

---

## Simple summary

Repeated work should become reusable procedure — but **never silently**. This contract
freezes how Knowtation watches for patterns (same steps again, re-explained
instructions, repeated corrections, review debt, optional end-of-session check),
stores a **candidate suggestion** (`flow_candidate/v0`), and lets a human **approve,
edit, merge, or reject** before any canonical Flow exists. Detection uses safe summaries
(ids, counts, hashes) — never raw chat or note bodies. The quality bar stays high: most
sessions produce nothing; low-confidence noise is suppressed; duplicates merge into an
existing Flow instead of spawning a parallel one. Promotion always goes through the
review tray; dismissal never creates a Flow. Classroom/minor policy may disable capture
entirely. Everything stays **off** until a named authorization gate opens.

## Technical summary

The capture flywheel unblocks two independent capability families behind separate posture
flags: **(A) detection** (`FLOW_CAPTURE_DETECTION_ENABLED`, default off) —
`observeSignals` ingests content-minimized `FlowSessionMeta`, runs bounded structural
detectors, writes/updates `knowtation.flow_candidate/v0` in the vault flow store, and
returns summaries capped by `FLOW_CAPTURE_PER_SESSION_CAP`; **(B) capture writes**
(`FLOW_CAPTURE_WRITES_ENABLED`, default off) — `proposeCandidate` routes promotion through
the existing `/proposals` lifecycle with intent `flow_candidate_promote` (SD-7, distinct
from SD-4 authoring); `dismissCandidate` records a status-only proposal with intent
`flow_candidate_dismiss` (no Flow created). Thresholds pin FLOW-V0-SPEC §5.2:
`FLOW_CAPTURE_MIN_REPETITIONS = 3`, `FLOW_CAPTURE_MIN_CONFIDENCE = medium`, cap `2`/session,
dedup overlap `≥ 0.8` ⇒ `merged_into:<flow_id>`. `scope_hint` is inferred then
**user-confirmed** on promotion — never silently widened. Triple-exposed surfaces (CLI /
MCP / Hub REST) converge on one handler family. Scooling mirrors with compile-time
`FLOW_CAPTURE_DETECTION_AUTHORIZED` + `FLOW_CAPTURE_WRITES_AUTHORIZED` and env
double-locks (consumer contract §1).

---

## 0. Design decision (recorded as SD-7)

**How does repeated work become a Flow without silent promotion?** Recorded once in
`scooling/docs/CROSS-REPO-COORDINATION.md` → Standing Decisions as **SD-7**:

> **SD-7 — Capture flywheel is detect → candidate store → review proposal → Flow
> creation (never auto).** Session signals derive content-minimized
> `knowtation.flow_candidate/v0` records when detection is enabled. Candidate records
> are operational store state in the vault flow index; Scooling stores nothing
> canonical. **Promotion** to `knowtation.flow/v0` routes through the Knowtation
> `/proposals` lifecycle with intent `flow_candidate_promote` — on approve,
> `validateFlowBundle` runs and the Flow index reconciles from the approved bundle (same
> approve/apply machinery as SD-4, distinct proposal intent and envelope). **Dismissal**
> routes through a lightweight `flow_candidate_dismiss` proposal that updates candidate
> status to `rejected` on apply — no Flow is created. Detection never calls
> `flow_propose` directly; observe never auto-promotes. Implements FLOW-V0-SPEC §5 and
> §6 items 4/5 literally; resolves §10 item 6 (thresholds pinned).

---

## 1. Two sub-gates (independent posture)

| Sub-gate | Knowtation control | Default | Unlocks |
| --- | --- | --- | --- |
| **Detection** | `FLOW_CAPTURE_DETECTION_ENABLED` | **off** | `observeSignals` — ingest session meta, run detectors, create/update `flow_candidate/v0` |
| **Capture writes** | `FLOW_CAPTURE_WRITES_ENABLED` | **off** | `proposeCandidate`, `dismissCandidate` — promotion/dismiss proposals |

Both may be implemented in 7A-L4b while staying **off**. Enabling either is **Tier 3**.
Capture writes do **not** imply detection (fixtures/manual candidates may be listed and
promoted when writes are on); detection does **not** imply writes (candidates may
accumulate in `pending_review` without promotion until writes are authorized).

Scooling mirrors with compile-time `FLOW_CAPTURE_DETECTION_AUTHORIZED` and
`FLOW_CAPTURE_WRITES_AUTHORIZED` (both hard-`false`) plus env double-locks (consumer
contract §1).

**Read path:** `listCandidates` / `GET …/candidates` uses the 7A-10 read store — unchanged
semantics; returns content-minimized summaries with `truncated` when capped.

---

## 2. Surfaces (triple-exposed when sub-gate ON — design only in 7A-L4a)

All surfaces require the relevant sub-gate (§1) and resolve authority server-side.
**7A-L4a freezes shapes; 7A-L4b wires them.**

| Surface | Observe signals | List candidates | Propose promotion | Dismiss candidate |
| --- | --- | --- | --- | --- |
| **MCP** | `flow_capture` (`action:observe`) | `flow_capture` (`action:list`) | `flow_capture` (`action:propose`) | `flow_capture` (`action:dismiss`) |
| **Hub REST** | `POST /api/v1/flows/capture/observe` | `GET /api/v1/flows/candidates` | `POST /api/v1/flows/candidates/{candidate_id}/propose` | `POST /api/v1/flows/candidates/{candidate_id}/dismiss` |
| **CLI** | `knowtation flow capture observe …` | `knowtation flow capture list …` | `knowtation flow capture propose …` | `knowtation flow capture dismiss …` |

Read/list candidates requires readable scope only (7A-10). Observe requires detection
sub-gate. Propose/dismiss require capture-writes sub-gate.

---

## 3. Canonical record — `knowtation.flow_candidate/v0`

Field-for-field with FLOW-V0-SPEC §1.6. Additional lifecycle invariants enforced on
every write:

| Rule | Contract |
| --- | --- |
| **Never a Flow** | A candidate record is not a `flow/v0`; no step ids, no runnable procedure until promotion approve. |
| **Untrusted text** | `suggested_title`, `draft_steps[]` are prompt content — stored for review display only; never executed or interpreted as permission grants. |
| **Pointers only** | `evidence_refs[]` carry `run:<id>`, `proposal:<id>`, `hash:<hex>` — never note bodies or completions. |
| **Scope hint** | `scope_hint` is inferred from session/workspace context; promotion request MUST include user-confirmed `confirmed_scope` (§5.2). |
| **Status machine** | `pending_review` → `promoted` \| `rejected` \| `merged_into:<flow_id>`; terminal states are immutable. |
| **Provenance** | `provenance.actor` is hashed; `provenance.harness` is a label — never raw identity. |
| **Dedup target** | When status is `merged_into:<flow_id>`, the suffix is a readable `flow_id` in caller scope — pointer only. |

Candidates persist in `VaultFlowStore.candidates[]` keyed by `candidate_id` (latest row
wins for list; history append optional in 7A-L4b but not required for v0).

---

## 4. Detection (sub-gate ON only)

### 4.1 Input — content-minimized session meta

```jsonc
{
  "session_id": "<sha256-hex>",              // REQUIRED — hashed; never raw transcript id
  "step_sequence_refs": ["flow_x#1", "…"],   // REQUIRED — structural pointers only; bounded MAX_SESSION_SIGNAL_REFS
  "skill_ref_ids": ["mcp_prompt:daily-brief", "…"],  // OPTIONAL — opaque ids
  "observed_counts": {                       // REQUIRED — bounded integer map
    "repetition": 4,
    "repeated_correction": 2
  },
  "signal_hints": ["repetition"]             // OPTIONAL — harness belief; server re-validates
}
```

**Rejected at validation:** any field carrying raw prompt text, completion bodies, note
content, tokens, or unbounded arrays ⇒ `400 FLOW_CAPTURE_SIGNAL_MALFORMED`.

### 4.2 Detection signals (`trigger_signal`)

Ratified from FLOW-V0-SPEC §5.1 — server-side detectors only; client hints are non-authoritative:

| Signal | Detector observes (structural) | Emits candidate when |
| --- | --- | --- |
| `repetition` | Same ordered `step_sequence_refs` (+ optional `skill_ref_ids` tail) across sessions | `observed_counts.repetition ≥ FLOW_CAPTURE_MIN_REPETITIONS` (3) |
| `re_explanation` | Same standing-instruction hash recurs (hash of normalized structural cue, not raw text stored) | count ≥ 3 **and** no existing Flow with matching skill-ref footprint |
| `repeated_correction` | Same correction-class hash repeats | count ≥ 3 |
| `review_debt` | Step verification kind repeatedly marked done then failed human inspection (run ids in `evidence_refs`) | count ≥ 2 |
| `session_extraction` | End-of-session opt-in flag set by caller **and** vault policy permits | explicit `session_extraction_requested: true` on observe request **and** user opt-in (§6) |

### 4.3 Threshold constants (pinned — tunable only at Tier 3)

| Constant | Value | Rationale |
| --- | --- | --- |
| `FLOW_CAPTURE_MIN_REPETITIONS` | **3** | High bar; most sessions produce no candidate |
| `FLOW_CAPTURE_MIN_CONFIDENCE` | **`medium`** | Suppress `low` unless `include_low_confidence: true` on list/observe |
| `FLOW_CAPTURE_PER_SESSION_CAP` | **2** | Max **new** candidates created per `session_id` per observe call |
| `FLOW_CAPTURE_DEDUP_OVERLAP` | **0.8** | Structural overlap with an existing Flow ⇒ prefer merge (§5.3) |
| `MAX_SESSION_SIGNAL_REFS` | **64** | Bound signal payload |
| `MAX_CANDIDATE_SUMMARIES` | **50** | List cap (matches Scooling 7A-6a) |
| `MAX_DRAFT_STEPS` | **32** | Bound `draft_steps` outline length |

Confidence derivation (server-side, bounded enum only):

| Confidence | When assigned |
| --- | --- |
| `low` | Single weak signal or count just at threshold |
| `medium` | Meets threshold with consistent cross-session evidence |
| `high` | Multiple signal classes agree **or** repetition count ≥ 2× threshold |

Candidates with `confidence: low` are **stored** but **suppressed** from default list/observe
responses unless `include_low_confidence: true`.

### 4.4 Detection output

```jsonc
{
  "schema": "knowtation.flow_capture_observe/v0",
  "detection_authorized": true,              // false when sub-gate off
  "returned_count": 1,
  "truncated": false,
  "candidates": [ /* flow_candidate/v0 summaries — content-minimized */ ]
}
```

When sub-gate is off: `detection_authorized: false`, `returned_count: 0`, empty
`candidates[]` — **no store mutation**.

---

## 5. Candidate promotion rules (sub-gate B + human review)

### 5.1 No silent promotion

| Rule | Contract |
| --- | --- |
| **Never auto-Flow** | Detection creates/updates candidates only; no `flow/v0` row appears without an approved `flow_candidate_promote` proposal. |
| **Review-before-write** | `proposeCandidate` creates a standard Knowtation proposal; approve runs `validateFlowBundle` + index reconcile (SD-4 machinery, SD-7 intent). |
| **Intent** | Proposal `intent` is untrusted display text; `proposal_kind: flow_candidate_promote` is server-stamped. |

### 5.2 Scope confirmation (no silent widening)

Promotion request shape:

```jsonc
{
  "candidate_id": "cand_7f3a",
  "confirmed_scope": "personal|project|org",  // REQUIRED — user-confirmed; must be ≤ actor write tier
  "scope_widen_acknowledged": false,          // REQUIRED — must be true iff confirmed_scope > candidate.scope_hint
  "intent": "Promote weekly URL verify procedure"  // REQUIRED — untrusted; never executed
}
```

| Check | Failure |
| --- | --- |
| `confirmed_scope` above actor write tier | `403 FLOW_SCOPE_DENIED` |
| `confirmed_scope > scope_hint` without `scope_widen_acknowledged: true` | `403 FLOW_CAPTURE_SCOPE_UNCONFIRMED` |
| Candidate not `pending_review` | `409 FLOW_CANDIDATE_NOT_PROMOTABLE` |
| `confidence: low` without `allow_low_confidence: true` | `403 FLOW_CAPTURE_LOW_CONFIDENCE_SUPPRESSED` |

On approve: candidate `status → promoted`; new `flow/v0` + steps created at
`confirmed_scope` (not `scope_hint` alone).

### 5.3 Dedup and merge (prefer merge over parallel Flow)

Before creating a promote proposal, the server computes structural overlap between
`draft_steps` (+ skill-ref footprint from `evidence_refs`) and existing readable Flows
in scope:

| Overlap | Action |
| --- | --- |
| `< FLOW_CAPTURE_DEDUP_OVERLAP` | Offer standard **promote** (new Flow) |
| `≥ FLOW_CAPTURE_DEDUP_OVERLAP` | Default path is **merge** — proposal kind `flow_candidate_merge` targeting `merge_into_flow_id`; on approve candidate `status → merged_into:<flow_id>` and a **Flow edit proposal** (SD-4) is queued for the merge patch — never a silent edit |

Client may force new-Flow promote with `force_new_flow: true` only when overlap < 1.0 and
actor holds project/org write authority; still requires review.

### 5.4 Promotion proposal envelope (on propose success)

Uses standard proposal fields plus:

```jsonc
{
  "proposal_kind": "flow_candidate_promote",
  "candidate_id": "cand_7f3a",
  "confirmed_scope": "personal",
  "bundle": { /* draft flow + steps derived from candidate — validateFlowBundle-ready */ }
}
```

Response — `{ ok: true, proposal_id, external_ref }` pointers only.

---

## 6. Dismiss rules (sub-gate B)

```jsonc
{
  "candidate_id": "cand_7f3a",
  "intent": "Not a recurring procedure"   // REQUIRED — untrusted
}
```

Creates `flow_candidate_dismiss` proposal; on apply: `status → rejected` (terminal).
No Flow created or mutated. Unknown candidate ⇒ `404 unknown_candidate` (no existence
leak across scopes — same rule as 7A-10 unreadable resources).

---

## 7. Vault capture policy + opt-in

Vault policy extension (`config.flow.capture` — 7A-L4b):

| Field | Type | Default | Effect |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` (personal vaults) | `false` ⇒ all capture surfaces return `FLOW_CAPTURE_POLICY_FORBIDDEN` |
| `session_extraction_opt_in` | boolean | `false` | Required for `session_extraction` signal |
| `classroom_minor_mode` | boolean | `false` | When `true`, capture **fully disabled** (classroom/minor policy) |
| `min_confidence_floor` | `low\|medium\|high` | `medium` | Vault may raise bar; never lower below server `FLOW_CAPTURE_MIN_CONFIDENCE` without Tier 3 |

Scooling adapter mirrors policy refusals as `capture_policy_forbidden` and
`capture_opt_in_required` (7A-6a).

---

## 8. Separation from other gates

| Concern | Authoring (SD-4) | Capture (SD-7) |
| --- | --- | --- |
| **Trigger** | Human drafts/edits/imports a Flow | System/human surfaces a candidate from session patterns |
| **Proposal kind** | `flow_authoring` (default) | `flow_candidate_promote` \| `flow_candidate_merge` \| `flow_candidate_dismiss` |
| **Store write on approve** | Reconcile `flow/v0` from bundle | Promote: new Flow; merge: candidate terminal + queued edit proposal; dismiss: candidate status only |
| **Posture flags** | `FLOW_AUTHORING_WRITES_ENABLED` | `FLOW_CAPTURE_DETECTION_ENABLED` + `FLOW_CAPTURE_WRITES_ENABLED` |
| **Cross-use** | Authoring never runs detectors; capture never bypasses review for Flow creation |

Execution (SD-6) and external-agent (SD-5) gates are **independent** — capture does not
mint execution consent or external grants.

---

## 9. Posture / gating (default off)

| Control | Where | Default | Tier to enable |
| --- | --- | --- | --- |
| `FLOW_CAPTURE_DETECTION_ENABLED` | Knowtation config | **off** | Tier 3 |
| `FLOW_CAPTURE_WRITES_ENABLED` | Knowtation config | **off** | Tier 3 |
| `FLOW_CAPTURE_DETECTION_AUTHORIZED` | Scooling compile-time | **false** | Tier 3 |
| `FLOW_CAPTURE_WRITES_AUTHORIZED` | Scooling compile-time | **false** | Tier 3 |

---

## 10. Error taxonomy (opaque codes; no scope/id/secret leak)

`FLOW_CAPTURE_DISABLED` · `FLOW_CAPTURE_WRITES_DISABLED` ·
`FLOW_CAPTURE_SIGNAL_MALFORMED` · `FLOW_CAPTURE_POLICY_FORBIDDEN` ·
`FLOW_CAPTURE_OPT_IN_REQUIRED` · `FLOW_CAPTURE_LOW_CONFIDENCE_SUPPRESSED` ·
`FLOW_CAPTURE_SCOPE_UNCONFIRMED` · `FLOW_CANDIDATE_NOT_PROMOTABLE` ·
`FLOW_CAPTURE_SESSION_CAP_EXCEEDED` · `FLOW_SCOPE_DENIED` · `FLOW_SCOPE_AMBIGUOUS` ·
`unknown_candidate` (missing **or** unreadable) · `FLOW_CAPTURE_DEDUP_MERGE_REQUIRED`
(409 — overlap ≥ threshold; client must choose merge or `force_new_flow`).

---

## 11. Seven-tier test matrix (what each tier proves — design only)

Per `RULE #0`. 7A-L4b ships all seven tiers under `test/flow-capture-*.test.mjs`,
reusing 7A-6 session-signal fixtures + malicious candidate text + policy-forbidden vault
+ opt-in-disabled vault. **No network in unit tests.** Every tier runs with both sub-gates
toggled off (default) **and** forced-on harness.

| Tier | File | What it proves (representative cases) |
| --- | --- | --- |
| **unit** | `test/flow-capture-unit.test.mjs` | Signal schema rejects raw content; confidence enum derivation; threshold constants match §4.3; `validateCandidate` stamps `knowtation.flow_candidate/v0`; promotion envelope stamps `flow_candidate_promote`; dismiss stamps `flow_candidate_dismiss`. |
| **integration** | `test/flow-capture-parity-integration.test.mjs` | MCP `flow_capture`, Hub REST, and CLI `flow capture` produce **deep-equal** observe/list/propose/dismiss envelopes for the same authorized request; sub-gates off ⇒ all surfaces return disabled/refusal codes. |
| **e2e** | `test/flow-capture-e2e.test.mjs` | observe (detection on) → candidate in store → list → propose with confirmed scope → evaluation → approve → `flow get` shows new Flow; dismiss path → `rejected` terminal; dedup overlap → merge proposal path; low confidence suppressed unless flag set. |
| **stress** | `test/flow-capture-stress.test.mjs` | `MAX_SESSION_SIGNAL_REFS` observe; many sessions hitting repetition detector — per-session cap enforced; list at `MAX_CANDIDATE_SUMMARIES` sets `truncated`; concurrent propose on same candidate — exactly one succeeds. |
| **data-integrity** | `test/flow-capture-data-integrity.test.mjs` | Candidate round-trip preserves fields; promote approve reconciles bundle byte-stable vs proposal; merge sets `merged_into:<flow_id>` iff terminal; `evidence_refs` remain pointers after full lifecycle; scope on approved Flow equals `confirmed_scope`, not stale `scope_hint`. |
| **performance** | `test/flow-capture-performance.test.mjs` | Observe + dedup overlap scan within p95 on large flow index; list candidates bounded; no quadratic overlap checks. |
| **security** | `test/flow-capture-security.test.mjs` | Scope denial + no widening without ack; no existence leak; injection in `suggested_title`/`draft_steps`/`intent` inert; policy forbidden + opt-in required; **no secrets** in any candidate/proposal JSON; detection off ⇒ no store mutation; sub-gates independently enforced. |

---

## 12. Acceptance (7A-L4a)

- Detection signal model, threshold constants, candidate lifecycle, promotion/dismiss/
  merge rules, vault capture policy, error taxonomy, SD-7, and seven-tier test matrix
  are frozen here — **contract only, no implementation, no route, no OpenAPI edit, no
  posture flip.**
- Ratified against `FLOW-V0-SPEC.md` §1.6/§5/§6, `FLOW-STORE-CONTRACT-7A-10.md`,
  `FLOW-AUTHORING-WRITEBACK-CONTRACT-7A-L1.md` (SD-4 machinery reuse), and
  `scooling/docs/FLOW-ADAPTERS-CONTRACT-7A-6.md` (adapter boundary unchanged).
- Consumer contract `scooling/docs/FLOW-CAPTURE-LIVE-WIRE-CONTRACT-7A-L4.md` ratified
  field-for-field.
- SD-7 recorded in `scooling/docs/CROSS-REPO-COORDINATION.md`.
- Muse-committed on `feat/flow-projection-pilot`; handover regenerated to point at
  **7A-L4b** (Auto impl) only.

## Non-goals (7A-L4)

- No automatable step execution (7A-L3); no external-agent grants (7A-L2).
- No MuseHub enrichment (7A-L5).
- No flip of `FLOW_CAPTURE_*_ENABLED` (Knowtation) or `FLOW_CAPTURE_*_AUTHORIZED`
  (Scooling) — enabling is Tier 3.
- No Scooling UI route for capture (later product-surface step).

---

## Handoff notes (for 7A-L4b — Auto)

1. Branch is **`feat/flow-projection-pilot`**; this contract is Muse-committed. Always
   target Knowtation with `muse -C ~/knowtation …`.
2. Implement `lib/flow/flow-capture.mjs` (detectors + candidate CRUD + promote/dismiss
   proposal facades) delegating to one handler family; wire §2 surfaces; add OpenAPI
   **in the same change as routes**.
3. Extend vault policy parser for `config.flow.capture`; default all sub-gates **off**.
4. Ship all seven tiers green before handover regen; then point at next gate (7A-L5 or
   product surfaces per overseer).
