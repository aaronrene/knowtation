# Flow Execution Gate — Canonical Contract (Phase 7A, Step 7A-L3a)

Status: **Contract only — Thinking step (7A-L3a).** This is the frozen, canonical
contract for the **automatable step execution gate** and **run advancement**: when
`automatable: automatable` steps may advance via server-side orchestration, how manual
run writes work, consent + cost caps, and how this gate stays **wholly separate** from
external-agent grants (7A-L2). **No implementation, no routes, no MCP/CLI wiring, no
posture flip, and no model invocation ships in this step.** The mechanical implementation
(run handlers, consent ledger, ModelRuntimeAdapter bridge, Scooling live wire, seven-tier
test bodies) is **7A-L3b (Auto)**, written to this contract without redesigning it.

Authored on branch **`feat/flow-projection-pilot`** (Knowtation). Always target the
repo explicitly with `muse -C ~/knowtation …`.

Related:

- `docs/FLOW-V0-SPEC.md` — §1.1 (`Automatable`, `RunStatus`, `StepStateStatus`), §3
  (gated `flow_run` surfaces), §6 items 5/7/9/10 (review-before-write for outcomes;
  automatable gated by consent + cost caps; classroom policy; version pinning).
- `docs/FLOW-EXTERNAL-AGENT-CONTRACT-7A-L2.md` — **separate gate** (SD-5); external
  grants and `external_tool` invoke never substitute for automatable execution.
- `docs/FLOW-AUTHORING-WRITEBACK-CONTRACT-7A-L1.md` — import path; §5 sandbox carry-over
  extended here for `automatable` steps.
- `docs/FLOW-STORE-CONTRACT-7A-10.md` — `runs[]` persistence; read invariants for
  `step_states`.
- `scooling/docs/FLOW-EXECUTION-LIVE-WIRE-CONTRACT-7A-L3.md` — the **consumer** half
  (run-write + automatable execution double-lock posture) ratified field-for-field
  against this contract.
- `scooling/docs/FLOW-ADAPTERS-CONTRACT-7A-5.md` — `FlowRunAdapter` method shapes;
  `FLOW_RUN_WRITES_AUTHORIZED` and `FLOW_AUTOMATABLE_EXECUTION_AUTHORIZED`.

**Scope fence (7A-L3a):** run-start/advance/evidence wire shapes + automatable execution
orchestration rules + consent/cost-cap model + import sandbox for `automatable` steps +
separation from SD-5 external-agent grants + error taxonomy + seven-tier test matrix
**only**. **Not** in scope: handler impl, routes, MCP/CLI wiring, OpenAPI edits (land
**with** routes in 7A-L3b), capture (7A-L4), MuseHub enrichment (7A-L5), or flipping
`FLOW_RUN_WRITES_ENABLED` / `FLOW_AUTOMATABLE_EXECUTION_ENABLED`.

---

## Simple summary

A Flow run tracks progress step by step. Until now every run write and every
`automatable` step has been dead on arrival — you could read fixture runs but never
start or advance one, and the server never executed a step for you. This contract
freezes the rules for when those doors may open — still default **off**.

Two related capabilities, **two separate locks**:

1. **Run writes** — start a run, advance a step manually, attach evidence pointers,
   submit outcomes to review. Operational state lives in the flow store; only durable
   *knowledge* outcomes route through the review tray.
2. **Automatable execution** — for steps marked `automatable: automatable` only,
   Knowtation may orchestrate a **server-side** model lane (with explicit consent and
   cost caps) to produce a bounded execution result and advance the step — never by
   interpreting step text as commands, never by widening scope, and never by reusing
   external-agent grants from 7A-L2.

Imported Flows may *declare* automatable steps, but they stay inert through import and
until human review approves the canonical version. Classroom/org policy may forbid
automatable steps entirely. Nothing here turns the gates on.

## Technical summary

The execution gate unblocks two capability families behind independent posture flags:
**(A) run advancement** (`FLOW_RUN_WRITES_ENABLED`, default off) — start/advance/evidence
on `knowtation.flow_run/v0` with ordered-step invariants, verification-before-`done`,
and pinned `flow_version`; **(B) automatable step execution**
(`FLOW_AUTOMATABLE_EXECUTION_ENABLED`, default off) — server-side orchestration via
`ModelRuntimeAdapter` + `BillingAdapter` reservation, requiring per-run
`knowtation.flow_execution_consent/v0`, vault policy caps, and step-level
`automatable === 'automatable'`. **`agent_assisted` and `manual` steps never invoke
automatable execution** — they use manual advancement only. **`external_tool` skill-refs
remain on the SD-5 external-agent gate** — automatable execution may use `mcp_prompt`,
`skill_pack`, and `cli` refs only (vault allowlist ∩ step refs). SD-6 records the
separation from SD-5. Import sandbox rejects bundles whose automatable steps exceed org
policy. Triple-exposed surfaces (CLI / MCP / Hub REST) converge on one handler family.

---

## 0. Design decision (recorded as SD-6)

**How do automatable steps execute safely, separately from external agents?** Recorded
once in `scooling/docs/CROSS-REPO-COORDINATION.md` → Standing Decisions as **SD-6**:

> **SD-6 — Automatable execution is consent-gated server orchestration, not
> external-agent authority.** Steps with `automatable: automatable` may advance via
> Knowtation server-side orchestration only when `FLOW_AUTOMATABLE_EXECUTION_ENABLED`
> is on, the actor holds valid `knowtation.flow_execution_consent/v0` for the run,
> billing reserves within caps, and org policy permits. This path uses
> `ModelRuntimeAdapter` internally — it does **not** mint, accept, or substitute
> `knowtation.flow_external_grant/v0` bearers (SD-5). External agents consume read-only
> `agent_bundle` projections and invoke `external_tool` refs through grants; they never
> trigger automatable execution. Automatable execution never activates `external_tool`.
> Run operational state (`flow_run/v0`) mutates in the flow store; durable knowledge
> outcomes still route through proposals (review-before-write). Implements FLOW-V0-SPEC
> §6 items 5, 7, and 9 literally.

---

## 1. Two sub-gates (independent posture)

| Sub-gate | Knowtation control | Default | Unlocks |
| --- | --- | --- | --- |
| **Run writes** | `FLOW_RUN_WRITES_ENABLED` | **off** | `startRun`, manual `advanceStep`, `recordEvidence`, `submitToReview` |
| **Automatable execution** | `FLOW_AUTOMATABLE_EXECUTION_ENABLED` | **off** | `executeAutomatableStep` server orchestration for `automatable: automatable` steps |

Both may be implemented in 7A-L3b while staying **off**. Enabling either is **Tier 3**.
Automatable execution **requires run writes** to be enabled (cannot execute without an
active run), but run writes do **not** imply automatable execution.

Scooling mirrors with compile-time `FLOW_RUN_WRITES_AUTHORIZED` and
`FLOW_AUTOMATABLE_EXECUTION_AUTHORIZED` (both hard-`false`) plus env double-locks
(consumer contract §1).

---

## 2. Surfaces (triple-exposed when sub-gate ON — design only in 7A-L3a)

All surfaces require the relevant sub-gate (§1) and resolve authority server-side.
**7A-L3a freezes shapes; 7A-L3b wires them.**

| Surface | Start run | Get/list runs | Advance step | Record evidence | Execute automatable | Submit to review |
| --- | --- | --- | --- | --- | --- | --- |
| **MCP** | `flow_run` (`action:start`) | `flow_run` (`action:get`\|`list`) | `flow_run` (`action:advance`) | `flow_run` (`action:evidence`) | `flow_run` (`action:execute_automatable`) | `flow_run` (`action:submit_review`) |
| **Hub REST** | `POST /api/v1/flows/{id}/runs` | `GET /api/v1/flows/{id}/runs`, `GET …/runs/{run_id}` | `POST …/runs/{run_id}/advance` | `POST …/runs/{run_id}/evidence` | `POST …/runs/{run_id}/execute-automatable` | `POST …/runs/{run_id}/submit-review` |
| **CLI** | `knowtation flow run start …` | `knowtation flow run get\|list …` | `knowtation flow run advance …` | `knowtation flow run evidence …` | `knowtation flow run execute …` | `knowtation flow run submit-review …` |

Read paths (`get`/`list` runs) remain on the 7A-10 read store — unchanged. Write paths
converge on **one handler family** (`handleFlowRun*`) with deep-equality parity across
the three surfaces (§9 tier 2).

### 2.1 Request — start run (`flow_run` / `POST …/runs`)

```jsonc
{
  "flow_id": "flow_weekly_review",     // REQUIRED — readable in caller's scope
  "flow_version": "1.2.0",           // REQUIRED — semver pin; must match a visible canonical version
  "task_ref": "task_abc123",         // OPTIONAL — SD-2 link to Phase 2G task (id only)
  "external_ref": "muse:sha:…"       // OPTIONAL — lineage bridge pointer (id/hash only)
}
```

Response — `knowtation.flow_run_start/v0`:

```jsonc
{
  "schema": "knowtation.flow_run_start/v0",
  "run": { /* knowtation.flow_run/v0 — §3.1 */ }
}
```

### 2.2 Request — advance step (manual)

```jsonc
{
  "run_id": "run_2026w25",
  "step_id": "flow_weekly_review#1",
  "to_status": "in_progress|blocked|done|skipped"  // REQUIRED; never widens scope
}
```

- Advancing to `done` when the step's verification sets `evidence_required: true`
  requires `verified: true` on that step state ⇒ `403 FLOW_VERIFICATION_UNSATISFIED`.
- Skipping is allowed only when the step's canonical `when_not_to_run` contract is
  satisfied by an explicit `skip_reason` enum (7A-L3b impl) — never from free-text alone.
- Out-of-order advance ⇒ `409 FLOW_STEP_OUT_OF_ORDER`.

### 2.3 Request — record evidence (pointer only)

```jsonc
{
  "run_id": "run_2026w25",
  "step_id": "flow_weekly_review#1",
  "evidence_ref": "prop_abc123",     // REQUIRED — pointer id/hash only
  "pointer_kind": "proposal|artifact|hash|test_result"  // REQUIRED — bounded enum
}
```

Never accepts raw content, note bodies, prompts, or completions.

### 2.4 Request — execute automatable step

```jsonc
{
  "run_id": "run_2026w25",
  "step_id": "flow_weekly_review#2",
  "consent_id": "fcons_<token>",     // REQUIRED — valid knowtation.flow_execution_consent/v0 for this run
  "model_lane": "local_default|cloud_premium",  // OPTIONAL — must ⊆ consent.allowed_lanes
  "dry_run": false                   // OPTIONAL — when true, validate gates only; no model call (7A-L3b)
}
```

 Preconditions (all checked server-side; failures are opaque §8 codes):

1. Sub-gate `FLOW_AUTOMATABLE_EXECUTION_ENABLED` is on.
2. Target step's canonical `automatable === 'automatable'` (not `manual` / `agent_assisted`).
3. Run is `in_progress`; step is the current ordinal frontier (or explicitly `in_progress`).
4. Valid, unexpired `consent_id` bound to this `run_id` + actor.
5. Billing reservation succeeds within consent + vault caps.
6. Org/classroom policy permits automatable steps for this scope.
7. Step skill-refs ⊆ allowed internal kinds (`mcp_prompt`, `skill_pack`, `cli`) — **never
   `external_tool`** (SD-5).

Response — `knowtation.flow_execute_automatable/v0`:

```jsonc
{
  "schema": "knowtation.flow_execute_automatable/v0",
  "run": { /* updated knowtation.flow_run/v0 */ },
  "execution": {
    "execution_id": "fexec_<token>",
    "step_id": "flow_weekly_review#2",
    "status": "completed|failed|cost_capped|consent_denied",
    "evidence_ref": "hash_…",       // pointer only when completed + verification satisfied
    "cost_units": 42,                // bounded integer; no raw billing payload
    "model_lane": "local_default",
    "completed_at": "2026-06-20T12:00:00Z"
  }
}
```

The execution record never contains prompts, completions, or secrets.

### 2.5 Request — execution consent mint (prerequisite for automatable)

```jsonc
{
  "run_id": "run_2026w25",
  "allowed_lanes": ["local_default"],  // REQUIRED, non-empty; ⊆ vault policy
  "cost_cap_units": 100,               // REQUIRED; server may lower to policy max
  "ttl_seconds": 3600                  // OPTIONAL; capped at policy max (default 3600, max 86400)
}
```

Response — `knowtation.flow_execution_consent_mint/v0`:

```jsonc
{
  "schema": "knowtation.flow_execution_consent_mint/v0",
  "consent": { /* knowtation.flow_execution_consent/v0 — §3.2 */ }
}
```

Consent is **run-bound** — not reusable across runs or flows.

### 2.6 Request — submit to review (durable outcome)

```jsonc
{
  "run_id": "run_2026w25",
  "intent": "Weekly review run outcome"  // REQUIRED, untrusted; never executed
}
```

Creates a standard Knowtation proposal (`intent`, `external_ref` from run lineage) —
review-before-write for durable knowledge outcomes. Does **not** mutate canonical Flow
definitions.

---

## 3. Canonical records

### 3.1 Run record — `knowtation.flow_run/v0` (unchanged from FLOW-V0-SPEC §1.5)

Invariants enforced on every write:

| Rule | Contract |
| --- | --- |
| **Version pin** | `flow_version` immutable for the life of the run (§6 item 10). |
| **Ordered frontier** | At most one step `in_progress`; advance only to the next ordinal or explicit skip. |
| **Done = verified** | `status: done` on a step state requires `verified: true` when `evidence_required`. |
| **Human review** | Steps with `verification.kind: human_review` never receive `verified: true` from automatable execution — manual approval only. |
| **Provenance** | `provenance.actor` is hashed; `provenance.harness` is a label — never raw identity. |
| **SD-2 link** | Optional `task_ref` / `external_ref` are ids/pointers only; reciprocal link is maintained atomically when `task_ref` is supplied. |

Operational run mutations write **directly** to the vault flow store (`runs[]`). They
do **not** create proposals per tick. Only `submitToReview` and knowledge-producing
outcomes route through `/proposals` (FLOW-V0-SPEC §6 item 5).

### 3.2 Execution consent — `knowtation.flow_execution_consent/v0`

```jsonc
{
  "schema": "knowtation.flow_execution_consent/v0",
  "consent_id": "fcons_<token>",
  "vault_id": "default",
  "scope": "personal|project|org",
  "run_id": "run_2026w25",
  "flow_id": "flow_weekly_review",
  "flow_version": "1.2.0",
  "allowed_lanes": ["local_default"],
  "cost_cap_units": 100,
  "cost_consumed_units": 0,
  "actor_hash": "<sha256>",
  "expires_at": "2026-06-20T13:00:00Z",
  "revoked_at": null
}
```

No model API keys, OAuth tokens, or billing account identifiers appear on the consent
record.

---

## 4. Run advancement rules

### 4.1 Manual advancement (`agent_assisted` and `manual` steps)

| Step `automatable` | Advancement path |
| --- | --- |
| `manual` | Human operator only — `advanceStep` / evidence / review. |
| `agent_assisted` | Human or scoped agent **assists** via existing agent surfaces; run adapter advances manually — **no** `executeAutomatableStep`. |
| `automatable` | Manual advancement still allowed when automatable gate is off; when gate is on, **either** manual advance **or** `executeAutomatableStep`, never both racing on the same step (optimistic concurrency on run etag — 7A-L3b). |

### 4.2 Automatable execution orchestration (gate ON only)

Server-side pipeline (design — 7A-L3b implements):

```
validate gates → load pinned step (untrusted text) → resolve skill_refs (internal only)
→ BillingAdapter.reserve(cost_cap) → ModelRuntimeAdapter.run(lane, sandboxed context)
→ produce evidence pointer (hash/id) → evaluate verification (FlowVerificationAdapter rules)
→ update step_state → increment cost_consumed → emit safe observability metadata
```

| Rule | Contract |
| --- | --- |
| **Untrusted step text** | `instruction`/`boundaries`/`output_shape` are **data** fed to the model sandbox — never executed, never interpreted as permission grants. |
| **Scope frozen** | Execution context is the run's `scope` — retrieval cannot widen. |
| **No auto human_review** | `human_review` verification never satisfied by automatable execution. |
| **Cost cap** | Exceeding `cost_cap_units` ⇒ `FLOW_EXECUTION_COST_CAPPED`; step stays non-`done`. |
| **Idempotent execute** | Re-posting the same `(run_id, step_id, consent_id)` while in-flight returns the in-flight `execution_id` (no double billing). |

---

## 5. Separation from external-agent grants (7A-L2 / SD-5)

| Concern | External-agent gate (SD-5) | Execution gate (SD-6) |
| --- | --- | --- |
| **Purpose** | Third-party agents consume read-only bundles + invoke `external_tool` | Knowtation orchestrates `automatable` steps server-side |
| **Authority** | `knowtation.flow_external_grant/v0` bearer | `knowtation.flow_execution_consent/v0` |
| **Skill refs** | `external_tool` only | `mcp_prompt`, `skill_pack`, `cli` only |
| **Posture flag** | `FLOW_EXTERNAL_AGENT_ENABLED` | `FLOW_AUTOMATABLE_EXECUTION_ENABLED` |
| **Projections** | `agent_bundle` harness | none (operates on run state) |
| **Cross-use** | **Forbidden** — a grant bearer does not satisfy execution consent; execution consent does not authorize `external_tool` invoke. |

A step may declare both `automatable: automatable` and an `external_tool` skill-ref; each
capability activates only through its own gate and never implies the other.

---

## 6. Import sandbox carry-over (extends 7A-L1 §5 + 7A-L2 §6)

| Rule | Contract |
| --- | --- |
| **Parse-valid, runtime-inert** | Bundles may declare `automatable: automatable` steps; import records them on the proposal — **nothing executes** on import. |
| **Policy cap at import** | When vault/org policy sets `automatable_forbidden: true`, any step with `automatable !== 'manual'` ⇒ `403 FLOW_IMPORT_AUTOMATABLE_DENIED`. |
| **Review required** | Automatable steps stay inert through approve; activation waits §1 sub-gate + §2.4 preconditions. |
| **No privilege escalation** | `instruction` text cannot activate automatable execution; only schema-valid `automatable` field counts. |
| **External tool unchanged** | `external_tool` sandbox rules remain on 7A-L2 §6 — independent of automatable import rules. |
| **Combined bundle** | A bundle with both undeclared `external_tool` refs **and** policy-forbidden automatable steps fails at the **first** sandbox violation encountered (deterministic ordering: external_tool check, then automatable policy check). |

---

## 7. Posture / gating (default off)

| Control | Where | Default | Tier to enable |
| --- | --- | --- | --- |
| **`FLOW_RUN_WRITES_ENABLED`** | Knowtation Hub/CLI/MCP policy | **off** | Tier 3 |
| **`FLOW_AUTOMATABLE_EXECUTION_ENABLED`** | Knowtation Hub/CLI/MCP policy | **off** | Tier 3 |
| **`FLOW_RUN_WRITES_AUTHORIZED`** | Scooling compile-time | **false** | Tier 3 (consumer contract) |
| **`FLOW_AUTOMATABLE_EXECUTION_AUTHORIZED`** | Scooling compile-time | **false** | Tier 3 (consumer contract) |
| **Classroom / minor policy** | Org policy | may forbid automatable | `FLOW_EXECUTION_POLICY_FORBIDDEN` |
| **External-agent gate** | unchanged | **off** | 7A-L2 (SD-5) — independent |

Enabling any control above is **out of scope** for 7A-L3a and 7A-L3b — impl ships with
gates off.

---

## 8. Error taxonomy (opaque codes; no scope/id/secret leak)

New codes (7A-L3); existing codes reused unchanged:

| Code | Status | When |
| --- | --- | --- |
| `FLOW_RUN_WRITES_DISABLED` | 403 | run-write sub-gate off |
| `FLOW_AUTOMATABLE_EXECUTION_DISABLED` | 403 | automatable sub-gate off |
| `FLOW_EXECUTION_POLICY_FORBIDDEN` | 403 | org/classroom policy forbids |
| `FLOW_STEP_NOT_AUTOMATABLE` | 400 | step is `manual` or `agent_assisted` |
| `FLOW_EXECUTION_CONSENT_REQUIRED` | 403 | missing/invalid/expired consent |
| `FLOW_EXECUTION_CONSENT_RUN_MISMATCH` | 403 | consent bound to a different run |
| `FLOW_EXECUTION_COST_CAPPED` | 403 | billing cap exceeded |
| `FLOW_EXECUTION_LANE_DENIED` | 403 | requested lane ∉ consent/policy |
| `FLOW_VERIFICATION_UNSATISFIED` | 403 | advance/execute to `done` without proof |
| `FLOW_STEP_OUT_OF_ORDER` | 409 | ordinal frontier violated |
| `FLOW_RUN_NOT_IN_PROGRESS` | 409 | run terminal or not started |
| `FLOW_IMPORT_AUTOMATABLE_DENIED` | 403 | import declares automatable where policy forbids |
| `unknown_run` | 404 | missing **or** scope-invisible |
| `unknown_flow` | 404 | missing **or** scope-invisible (unchanged) |
| `FLOW_EXTERNAL_*` | — | **not used** by execution handlers (SD-5/SD-6 separation) |

Codes never carry vault ids, consent tokens, model payloads, or raw step bodies.

---

## 9. Seven-tier test matrix (what each tier proves — design only)

Per `RULE #0`. 7A-L3b ships all seven tiers under `test/flow-execution-*.test.mjs`,
reusing `flows/starter/` bundles + a malicious-step bundle + a bundle with
`automatable: automatable` steps + a policy-forbidden automatable bundle. **No network
in unit tests.** Every tier runs with both sub-gates toggled independently.

| Tier | File | What it proves (representative cases) |
| --- | --- | --- |
| **unit** | `test/flow-execution-unit.test.mjs` | Consent record validates `knowtation.flow_execution_consent/v0`; execution result schema validates; ordinal frontier math; `human_review` never auto-verified; sub-gate off ⇒ handlers unreachable (test hook). |
| **integration** | `test/flow-execution-parity-integration.test.mjs` | MCP `flow_run`, `POST …/runs`, and CLI `flow run start` produce deep-equal run records; advance/evidence/execute parity across three surfaces; each sub-gate off ⇒ identical disabled code. |
| **e2e** | `test/flow-execution-e2e.test.mjs` | start → consent mint → execute automatable on pinned version → evidence pointer attached → manual advance on `manual` step → submit review creates proposal; external grant bearer **does not** satisfy execute; import with forbidden automatable ⇒ refused. |
| **stress** | `test/flow-execution-stress.test.mjs` | many concurrent runs; idempotent execute under parallel posts; cost_consumed increments atomically; consent expiry enforced under load. |
| **data-integrity** | `test/flow-execution-data-integrity.test.mjs` | run pin preserves `flow_version` through execute; step_states ordinal order intact; SD-2 `task_ref` round-trip; export→import preserves `automatable` field but not activation. |
| **performance** | `test/flow-execution-performance.test.mjs` | start/advance within p95 on 100-step fixture; consent mint bounded; gate checks O(steps) not O(runs²). |
| **security** | `test/flow-execution-security.test.mjs` | scope denial; no existence leak; injection in `instruction` inert (never widens scope); **SD-5/SD-6 separation** (grant ≠ consent); cost cap enforced; **no secrets** in run/consent/execution records or logs; classroom policy denies automatable; import sandbox rejects policy violations. |

---

## 10. Acceptance (7A-L3a)

- Run-start/advance/evidence/execute/submit wire shapes, consent model, run advancement
  rules, automatable orchestration preconditions, SD-5 separation, import sandbox
  extensions, posture defaults, error taxonomy, and seven-tier test matrix are frozen
  here — **contract only, no implementation, no route, no OpenAPI edit, no posture
  flip.**
- Ratified against `FLOW-V0-SPEC.md` (§1.1, §3, §6 items 5/7/9/10),
  `FLOW-EXTERNAL-AGENT-CONTRACT-7A-L2.md` (explicit non-overlap),
  `FLOW-AUTHORING-WRITEBACK-CONTRACT-7A-L1.md` (§5 import baseline),
  `FLOW-STORE-CONTRACT-7A-10.md` (runs persistence), and the consumer contract
  `scooling/docs/FLOW-EXECUTION-LIVE-WIRE-CONTRACT-7A-L3.md`.
- SD-6 recorded in `scooling/docs/CROSS-REPO-COORDINATION.md`.
- Muse-committed on `feat/flow-projection-pilot`; handover regenerated to point at
  **7A-L3b** (Auto: run handlers + consent ledger + Scooling live wire + seven-tier
  impl, all gates default off).

## Non-goals (7A-L3)

- No capture flywheel (7A-L4); no MuseHub enrichment (7A-L5).
- No flip of `FLOW_RUN_WRITES_ENABLED`, `FLOW_AUTOMATABLE_EXECUTION_ENABLED`, or Scooling
  posture constants — enabling is Tier 3.
- No real cloud model provider integrations beyond orchestration **stubs** for test parity
  in 7A-L3b.
- No conflation with external-agent grants (`FLOW_EXTERNAL_AGENT_ENABLED` unchanged).

---

## Handoff notes (for 7A-L3b — Auto)

1. Branch is **`feat/flow-projection-pilot`**; this contract is Muse-committed. Always
   target Knowtation with `muse -C ~/knowtation …`.
2. Add `lib/flow/flow-execution.mjs` (run start/advance/evidence/execute/consent +
   policy helpers) wired to the flow store `runs[]`.
3. Wire routes/MCP/CLI/OpenAPI **in the same change** as handlers (no docs-only PR to
   `main`).
4. Extend import sandbox in `flow-authoring.mjs` for `FLOW_IMPORT_AUTOMATABLE_DENIED`.
5. Mirror Scooling consumer contract in `flowHubTransport.ts` + keep
   `createLiveFlowRunAdapter` unselected while posture flags are `false`.
6. Ship all seven tiers green before handover regen; gates stay off.
