# Flow Authoring Write-Back — Canonical Contract (Phase 7A, Step 7A-L1a)

Status: **Contract only — Thinking step (7A-L1a).** This is the frozen, canonical
contract for **live Flow authoring write-back**: how a drafted/edited/imported Flow
becomes a reviewed, durable change in Knowtation. **No implementation, no routes,
no live effect, and no posture flip ship in this step.** The mechanical
implementation (propose facade + seven-tier test bodies) is **7A-L1b (Auto)**,
written to this contract without redesigning it.

Authored on branch **`feat/flow-projection-pilot`** (Knowtation). Always target the
repo explicitly with `muse -C ~/knowtation …`.

Related:

- `docs/FLOW-V0-SPEC.md` — the canonical Flow spec. §3 names the `flow_propose` MCP
  tool / `POST /api/v1/flows` propose route; §6 item 5 ("durable edits route through
  proposals") is the security gate this contract satisfies.
- `docs/FLOW-STORE-CONTRACT-7A-10.md` — the read store this write-back lands into;
  §1.4 seeding is the **only** existing write, and §8 rule 6 states "all durable user
  changes route through proposals." This contract is that path.
- `docs/openapi.yaml` → `/proposals` (lifecycle) — the **existing** proposal create →
  evaluate → approve → apply machinery this contract reuses. **No new write path.**
- `lib/note-state-id.mjs` — the `kn1_` optimistic-concurrency token used as the
  proposal `base_state_id`; the Flow analog is defined in §4 below.
- `scooling/docs/FLOW-AUTHORING-LIVE-WIRE-CONTRACT-7A-L1.md` — the **consumer** side
  (`FlowAuthoringAdapter` live wire) ratified field-for-field against this contract.

**Scope fence (7A-L1a):** propose-shape + scope/role write-authority + review-before-
write lifecycle + optimistic concurrency + the seven-tier test matrix **only**. **Not**
in scope: any `lib/flow/` write implementation, the Hub route, CLI/MCP wiring, OpenAPI
edits (those land **with** the route in 7A-L1b per the no-docs-only-PR rule),
candidate promotion (7A-L4), run advancement (7A-L3), or MuseHub enrichment (7A-L5).

---

## Simple summary

Today a Flow can only be **read** (list/get/project). This contract describes the one
safe way to **change** a Flow: you never edit the canonical copy directly. Instead you
hand in a *proposal* — "here is the Flow I'd like to add or change, and why." A human
(or a policy) reviews it, and only after it is approved does the canonical Flow change.
Three things are guaranteed. First, **nothing is ever written without review** — there
is no back door. Second, you can only propose changes to Flows in a **scope you are
allowed to write** (your own personal Flows always; project/org Flows only if your role
grants it) and the server decides this, never the client. Third, if the Flow changed
since you started editing, your proposal is **rejected as a conflict** rather than
silently overwriting someone else's work. This reuses the exact proposal machinery
notes already use, so it inherits a proven, audited, safe path.

## Technical summary

Flow authoring write-back is a **typed facade over the existing proposal lifecycle**
(`/proposals` create → evaluation → approve → apply), not a second write path. A
`flow_propose` MCP tool and `POST /api/v1/flows` route accept a validated
`knowtation.flow/v0` + `flow_step/v0` bundle (reusing `validateFlowBundle`), derive a
proposal targeting the Flow's `vault_mirror_path` note, and return a
`knowtation.flow_proposal/v0` envelope (`{ proposal_id, flow_id, base_version,
base_state_id, status: "proposed" }`). **Write authority is scope × role**, resolved
server-side and deny-by-default (`personal` for any authenticated writer; `project`
requires `editor`; `org` requires `admin`), reusing `resolveFlowVisibleScopes` plus a
new write-tier check. **Optimistic concurrency** uses `base_version` (the semver the
edit is based on) **and** `base_state_id` (a deterministic `flowst1_` hash of the
canonical flow+steps); a mismatch at approve time is `409 FLOW_LINEAGE_CONFLICT`.
**`auto_approvable` is server-derived** from verification kinds (`human_review ⇒
false`) so a draft can never self-authorize. All free-text (`instruction`,
`boundaries`, `summary`, `intent`) is **untrusted**; evidence/lineage/provenance are
**pointers/hashes only**; no secret is ever serialized. `FLOW_AUTHORING_WRITES` stays
disabled by default and `automatable` step execution remains inert (7A-L3).

---

## 0. Design decision (recorded as SD-4)

**How does Flow authoring map onto the canonical write path?** Recorded once in
`scooling/docs/CROSS-REPO-COORDINATION.md` → Standing Decisions as **SD-4**:

> **SD-4 — Flow authoring write-back is a typed facade over the existing `/proposals`
> lifecycle, not a new write path.** `flow_propose` / `POST /api/v1/flows` validate a
> Flow bundle, then create a standard proposal targeting the Flow's `vault_mirror_path`
> note (frontmatter `type: flow`). Review/evaluation/approve/apply and the `base_state_id`
> concurrency check are the **same** machinery notes use. Rationale: one audited
> review path, no duplicated approve/apply logic, inherits the proven optimistic-
> concurrency + evaluation gate. The Flow index is updated **only** on approve, by
> reconciling the approved mirror note back into the index (the mirror is a projection
> of the index everywhere else; on the write path the *approved* mirror is the reconciliation source).

This keeps the boundary "**no new write path; no adapter writes canonical knowledge
directly**" (FLOW-V0-SPEC §6 item 5) literally true.

---

## 1. Surfaces (triple-exposed, identical contract)

Same shape across MCP / Hub REST / CLI, mirroring the read parity of 7A-10. **All three
require `FLOW_AUTHORING_WRITES` enabled** (default off, §6) and resolve write authority
server-side.

| Surface | Propose new | Propose edit | Import bundle |
| --- | --- | --- | --- |
| **MCP** | `flow_propose` (`draft`) | `flow_propose` (`flow_id` + `base_version`) | `flow_import` (`bundle`) |
| **Hub REST** | `POST /api/v1/flows` | `POST /api/v1/flows/{id}/proposals` | `POST /api/v1/flows/import` |
| **CLI** | `knowtation flow propose <bundle.json>` | same (bundle carries `flow_id`+`base_version`) | `knowtation flow import <bundle.json>` |

All three converge on **one handler** (`handleFlowProposeRequest`) that validates,
checks write authority, and delegates to the proposal create lifecycle. No surface
re-implements the write — parity is proven by deep-equality (§7 tier 2).

### 1.1 Request — `flow_propose` (new or edit)

```jsonc
{
  "flow": { /* knowtation.flow/v0 — full record (FLOW-V0-SPEC §1.3) */ },
  "steps": [ /* knowtation.flow_step/v0[] — full anatomy (§1.4) */ ],
  "intent": "string",            // REQUIRED, untrusted; recorded on the proposal, never executed
  "base_version": "1.2.0",       // REQUIRED for edit (the version the edit is based on); OMITTED for new
  "base_state_id": "flowst1_…"   // REQUIRED for edit (concurrency token, §4); OMITTED for new
}
```

- **New flow:** `base_version` + `base_state_id` omitted; server treats it as
  "must still be absent" (the absent-flow sentinel, §4). A `flow_id` collision with an
  existing flow in scope ⇒ `409 FLOW_LINEAGE_CONFLICT`.
- **Edit:** `flow_id` (inside `flow`), `base_version`, and `base_state_id` all required.
- The bundle is validated with the **existing** `validateFlowBundle` (FLOW-V0-SPEC §1
  anatomy completeness; a step missing `trigger`/`when_not_to_run`/`output_shape`/
  `verification` ⇒ `400 FLOW_DRAFT_INVALID`).

### 1.2 Response — `knowtation.flow_proposal/v0`

```jsonc
{
  "schema": "knowtation.flow_proposal/v0",
  "proposal_id": "string",       // the underlying /proposals id (lineage pointer)
  "flow_id": "flow_weekly_review",
  "base_version": "1.2.0",       // echo (null for new)
  "base_state_id": "flowst1_…",  // the state the proposal was based on (null for new)
  "scope": "personal|project|org",
  "auto_approvable": false,      // SERVER-DERIVED (§3); human_review ⇒ false
  "status": "proposed",
  "review_queue": "string"       // where it routes; never a secret
}
```

The response carries **pointers + labels only** — no rendered Flow body, no secrets.

---

## 2. Write-authority model (scope × role, server-side, deny-by-default)

Read visibility (7A-10 §4) is necessary but **not sufficient** to write. Write authority
is a second, stricter gate.

| Target scope | Minimum role | Resolution |
| --- | --- | --- |
| `personal` | any authenticated writer (`viewer`+) writing **their own** vault | `resolveFlowVisibleScopes` must include `personal` |
| `project` | `editor` | `visibleScopesForRole` must include `project` **and** role ≥ editor |
| `org` | `admin` | role must be `admin` |

| Rule | Contract |
| --- | --- |
| **Authorization, not a filter** | Write tier resolved server-side from verified identity + role + `WorkspaceScopeAdapter`. The client never supplies its own write tier. |
| **Deny by default** | Absent/ambiguous resolution ⇒ `personal` only. A `personal` writer proposing a `project`/`org` Flow ⇒ `403 FLOW_SCOPE_DENIED`. Ambiguous ⇒ `400 FLOW_SCOPE_AMBIGUOUS`. |
| **No scope widening from inside** | The draft's `flow.scope` is **validated against** the resolved write tier; a draft can never request a tier above what the actor holds (this is checked **before** the proposal is created). |
| **No existence leak** | Proposing an edit to a `flow_id` the actor cannot **read** ⇒ `404 unknown_flow` (identical to truly-missing), never `403`. |
| **Vault binding** | `X-Vault-Id` + role required on the Hub (`requireVaultAccess` + `requireRole`), parity with the read routes. CLI binds the locally-configured vault. |

---

## 3. Review-before-write lifecycle (reuses `/proposals`)

The Flow proposal **is** a standard proposal record; it traverses the existing
lifecycle. No new states are introduced.

```
flow_propose / POST /api/v1/flows
        │  validate bundle (validateFlowBundle) + write-authority + concurrency precheck
        ▼
   POST /proposals  ──────────────►  status: proposed     (intent, base_state_id, external_ref, source:"flow")
        │                                   │
        │                          (optional) /review-hints, /enrich   ← never a merge gate
        │                                   │
        ▼                                   ▼
   /proposals/{id}/evaluation  ────►  pass | fail | needs_changes   (EVALUATION_REQUIRED policy)
        │
        ▼
   /proposals/{id}/approve  ───────►  status: approved → APPLY
        │   base_state_id re-checked here (CONFLICT → 409)
        ▼
   reconcile approved mirror note → Flow index   (the ONLY index write besides seed)
```

| Rule | Contract |
| --- | --- |
| **No silent promotion** | A drafted/imported Flow is **never** written to the index by `flow_propose`. The index changes **only** at approve→apply. |
| **`auto_approvable` is server-derived** | Computed from the bundle's verification kinds: if **any** step is `human_review` (or `evidence_required` with a runtime-gated kind), `auto_approvable = false`. A draft has **no** `auto_approvable` field; supplying one is ignored. |
| **Evaluation gate honored** | When `HUB_PROPOSAL_EVALUATION_REQUIRED` is set, approve requires a passed evaluation or an admin `waiver_reason` — unchanged from the note path. |
| **Untrusted `intent`** | `intent` is recorded verbatim as data; it is never interpreted, never executes, and cannot widen scope. |
| **Apply reconciliation** | On approve, the approved mirror note (frontmatter `type: flow`, body = the validated bundle) is reconciled into the Flow index by `(flow_id, version)` upsert; steps re-validated; a failed reconcile **rolls back** (no partial index write). |

---

## 4. Optimistic concurrency — `base_version` + `base_state_id`

The Flow analog of the note `kn1_` token. Prevents lost updates when two authors edit
the same Flow.

| Item | Definition |
| --- | --- |
| **`flowStateId(flow, steps)`** | `'flowst1_' + fnv1a64Hex(stableStringify({ flow, steps }))` — a deterministic 64-bit FNV-1a over the canonical, key-sorted flow definition + ordered steps. Reuses `fnv1a64Hex` + `stableStringify` from `lib/note-state-id.mjs`. |
| **Absent-flow sentinel** | `'flowst1_' + fnv1a64Hex(0x00)` — used for **new** flows so a propose-new can require "still absent" and collide-fail if the `flow_id` appeared meanwhile. |
| **`base_version`** | The semver the edit is based on; must equal the **latest visible** canonical version at propose time **and** at approve time. |
| **Check points** | (1) propose-time **precheck** (fast fail if already stale); (2) approve-time **authoritative re-check** (the binding one). |
| **Conflict** | Either `base_version` ≠ latest **or** `base_state_id` ≠ `flowStateId(canonical)` ⇒ `409 FLOW_LINEAGE_CONFLICT`. The author re-fetches (`flow get`), rebases, and re-proposes. |
| **Semver classification (advisory)** | Per FLOW-V0-SPEC §10 item 3: remove step / tighten verification = MAJOR; add optional step = MINOR; reword = PATCH. The contract records the proposed `flow.version`; the server validates it is **strictly greater** than `base_version` for an edit (else `400 FLOW_DRAFT_INVALID`). |

> **Store keying note (carry-forward from 7A-12):** the 7A-10b store keys step bodies
> by `step_id` (= `flow_id#ordinal`) only, not `(step_id, version)`. Until a versioned-
> step-keying slice (recommended 7A-10c) lands, an **in-place step-field edit cannot
> diverge across two stored versions of one Flow.** 7A-L1b MUST therefore reconcile an
> edit as a **new version record** (new `(flow_id, version)` row) and never mutate an
> existing version's step bodies in place. This is a hard constraint on the impl step.

---

## 5. Import (portable bundle → scope-checked proposal)

`flow_import` / `POST /api/v1/flows/import` accepts a portable bundle (the export shape
from the read/derive side) and routes it through the **same** propose path.

| Rule | Contract |
| --- | --- |
| **Scope-checked** | The bundle's `scope` is validated against the actor's write tier (§2). Unwritable ⇒ `403 FLOW_IMPORT_SCOPE_DENIED`. |
| **Malformed fails closed** | A bundle that fails `validateFlowBundle` ⇒ `400 FLOW_IMPORT_BUNDLE_MALFORMED`; never partially imported. |
| **Lineage preserved** | `external_ref` + `source_vault_hint` (pointers/labels only) are carried onto the proposal's `external_ref`; no field loss vs the export. |
| **Tool allowlist** | `external_tool` skill-refs remain **inert** (FLOW-V0-SPEC §6 item 3); an imported Flow cannot run any external tool on import (that is the 7A-L2 external-agent gate). |
| **Never auto-applied** | Import creates a `proposed` proposal — identical review path; never a direct index write. |

---

## 6. Posture / gating (default off)

| Control | Default | Effect |
| --- | --- | --- |
| **`FLOW_AUTHORING_WRITES`** (Hub/CLI env + policy file, tri-state like `hub-proposal-policy`) | **off** | When off, `flow_propose`/`flow_import` return `403 FLOW_AUTHORING_DISABLED`. No write path is reachable. |
| **`automatable` step execution** | **inert** | Drafting a step with `automatable` is parse-valid but execution stays gated (7A-L3); the proposal records it, nothing runs. |
| **Classroom / minor policy** | may forbid | An org policy may forbid authoring entirely or cap verification/automatable kinds (`403 FLOW_AUTHORING_POLICY_FORBIDDEN`). |

Enabling `FLOW_AUTHORING_WRITES` is a **Tier 3** action (named authorization), separate
from this contract step and from the Scooling posture flag.

## 6.1 Error taxonomy (opaque codes; no scope/id/secret leak)

`FLOW_DRAFT_INVALID` · `FLOW_SCOPE_DENIED` · `FLOW_SCOPE_AMBIGUOUS` · `unknown_flow`
(missing **or** unreadable) · `FLOW_LINEAGE_CONFLICT` (409) · `FLOW_IMPORT_SCOPE_DENIED`
· `FLOW_IMPORT_BUNDLE_MALFORMED` · `FLOW_AUTHORING_DISABLED` ·
`FLOW_AUTHORING_POLICY_FORBIDDEN` · `EVALUATION_REQUIRED` (from approve, unchanged).

---

## 7. Seven-tier test matrix (what each tier proves — design only)

Per `RULE #0`. 7A-L1b ships all seven tiers under `test/flow-authoring-*.test.mjs`,
reusing the six `flows/starter/` bundles + a malicious-step bundle + a higher-scope
bundle + an empty vault. **No network in unit tests.** Every tier runs with
`FLOW_AUTHORING_WRITES` toggled both ways.

| Tier | File | What it proves (representative cases) |
| --- | --- | --- |
| **unit** | `test/flow-authoring-unit.test.mjs` | `flowStateId` is deterministic + key-order-stable; absent-sentinel is stable; `auto_approvable` derives `false` for any `human_review` step; `validateFlowBundle` rejects anatomy-incomplete drafts; the proposal envelope stamps `knowtation.flow_proposal/v0`. |
| **integration** | `test/flow-authoring-parity-integration.test.mjs` | MCP `flow_propose`, `POST /api/v1/flows`, and CLI `flow propose` produce a **deep-equal** proposal envelope for the same authorized request; all three create exactly **one** `/proposals` record; `FLOW_AUTHORING_WRITES=off` ⇒ all three return `FLOW_AUTHORING_DISABLED`. |
| **e2e** | `test/flow-authoring-e2e.test.mjs` | propose-new → evaluation pass → approve → `flow get` shows the new Flow at its version; propose-edit with correct `base_version`+`base_state_id` → approve → version bumped, old version still pinnable; discard leaves the index unchanged. |
| **stress** | `test/flow-authoring-stress.test.mjs` | `MAX_STEPS_PER_FLOW`-step drafts; many concurrent proposals against one `flow_id` — exactly one approves, the rest hit `FLOW_LINEAGE_CONFLICT`; no index corruption (atomic apply). |
| **data-integrity** | `test/flow-authoring-data-integrity.test.mjs` | approve→apply reconciliation preserves steps/skill-refs/verification/scope/version/lineage byte-for-byte; an edit creates a **new version row** (never mutates an existing version's steps — §4 carry-forward); rolled-back apply leaves zero partial state. |
| **performance** | `test/flow-authoring-performance.test.mjs` | propose validation + `flowStateId` within a p95 budget on the large fixture; approve→apply bounded; no quadratic scans in version resolution. |
| **security** | `test/flow-authoring-security.test.mjs` | scope denial (personal writer cannot propose project/org); ambiguous fails closed; **no scope widening** (draft scope above tier rejected pre-create); **no existence leak** (edit to unreadable flow ⇒ `unknown_flow`); injection (`instruction`/`intent` returned/recorded inert, never executed, cannot escalate); concurrency (stale `base_state_id` ⇒ conflict, no lost update); **no secrets** — `JSON.stringify` of every proposal envelope + applied record carries no `token`/`oauth`/`refresh_token`/raw-content marker; `provenance.actor` is a hash. |

---

## 8. Acceptance (7A-L1a)

- Propose request/response shapes, the write-authority model, the review-before-write
  lifecycle (reusing `/proposals`), the `base_version`+`base_state_id` concurrency
  model, the import path, gating, the error taxonomy, and the seven-tier test matrix
  are all frozen here — **contract only, no implementation, no route, no OpenAPI edit,
  no posture flip.**
- Ratified against `FLOW-V0-SPEC.md` (§3 surfaces, §6 security items 1/2/3/5/6),
  `FLOW-STORE-CONTRACT-7A-10.md` (read store + §8 rule 6), the existing `/proposals`
  lifecycle, and the consumer contract `scooling/docs/FLOW-AUTHORING-LIVE-WIRE-CONTRACT-7A-L1.md`.
- SD-4 recorded in `scooling/docs/CROSS-REPO-COORDINATION.md`.
- Muse-committed on `feat/flow-projection-pilot`; handover regenerated to point at
  **7A-L1b** (Auto: propose facade + route + CLI/MCP + OpenAPI + seven-tier impl, with
  `FLOW_AUTHORING_WRITES` defaulting off).

## Non-goals (7A-L1)

- No candidate promotion/dismissal write-back (`FlowCaptureAdapter` writes — 7A-L4).
- No run advancement / automatable execution (7A-L3).
- No MuseHub enrichment — step-level history, semver-typed change impact, releases,
  provenance-anchored evidence (7A-L5).
- No flip of `FLOW_AUTHORING_WRITES` (Knowtation) or `FLOW_AUTHORING_WRITES_AUTHORIZED`
  (Scooling) — both stay off; enabling is a separate Tier 3 authorization.

---

## Handoff notes (for 7A-L1b — Auto)

1. Branch is **`feat/flow-projection-pilot`**; this contract is Muse-committed. Always
   target Knowtation with `muse -C ~/knowtation …`.
2. Implement `lib/flow/flow-authoring.mjs` (propose facade) + `flowStateId` in/near
   `lib/note-state-id.mjs`; wire `POST /api/v1/flows`, `POST /api/v1/flows/{id}/proposals`,
   `POST /api/v1/flows/import`, the `flow_propose`/`flow_import` MCP tools, and the
   `knowtation flow propose|import` CLI branch — **all delegating to one handler**.
3. Add the OpenAPI shapes for the propose/import routes **in the same change as the
   routes** (no docs-only PR to `main`).
4. Honor the §4 store-keying carry-forward: reconcile edits as **new version rows**.
5. `FLOW_AUTHORING_WRITES` defaults **off**; ship all seven tiers green before any
   handover regen.
