# Task + Task Loop Write Proposals — Canonical Contract (Phase 2G-d, Step 2G-d-a)

Status: **Contract frozen (2G-d-a Thinking, 2026-06-24).** Typed facade over the existing
Knowtation `/proposals` lifecycle (SD-4 machinery — **not** a new write path). **No
implementation, no routes, no posture flip in this step.** Mechanical implementation is **2G-d-b
(Auto)** on branch `feat/phase-2g-d-write-proposals` (branch off `feat/phase-2g-c-loop-contracts`
or merged `main` when available).

Related:

- `docs/TASK-STORE-CONTRACT-2G.md` — one-time task read store (frozen).
- `docs/TASK-LOOP-STORE-CONTRACT-2G-c.md` — loop series + instance fields (frozen).
- `scooling/docs/TASK-ADAPTER-CONTRACT-2G.md` — one-time task consumer writes (frozen shapes).
- `scooling/docs/TASK-WRITE-ADAPTER-CONTRACT-2G-d.md` — Scooling consumer write boundary.
- `docs/FLOW-AUTHORING-WRITEBACK-CONTRACT-7A-L1.md` — SD-4 pattern reference.
- `docs/TASK-LOOPS-AND-ORCHESTRATOR-PLAN.md` — §3.3–§3.4 materialization + completion semantics.
- `scooling/docs/CROSS-REPO-COORDINATION.md` — **SD-2**, **SD-4**.

**Scope fence (2G-d-a):** propose shapes + scope×role write authority + review-before-write lifecycle
+ optimistic concurrency + apply reconciliation rules + seven-tier test matrix + Tier 3 gate
checklist **only**. **Not** in scope: Hub routes, CLI/MCP wiring, OpenAPI edits (land **with**
routes in 2G-d-b), Scooling live wire, orchestrator dispatch (2G-e), classroom teacher authority
(OD-9 defer), RRULE parser (2G-f).

---

## Simple summary

Tasks and recurring task loops change the same safe way notes and Flows already do: you never edit
the canonical copy directly. You submit a **proposal** — "here is the task or loop I want to create,
the next occurrence I want to spawn, or the series I want to pause or cancel." A human reviews it;
only after approval does Knowtation write to the portable store. Loop **create** adds a series
template. **Materialize** adds one dated instance task linked back to the series (lazy — usually
the next occurrence). **Pause** stops new instances but leaves existing ones visible. **Cancel**
ends the series and, per the frozen OD-4 default, auto-cancels pending instances with an audit
pointer — all in one approved apply. One-time task creates and status changes use the same proposal
machinery. Everything stays off until a named Tier 3 authorization flips `TASK_WRITES_ENABLED`.

## Technical summary

Task and task-loop durable writes are a **typed facade over `/proposals`** (SD-4), parallel to
`flow-authoring.mjs` and `delegation.mjs`: validate payload → check scope×role write authority →
create proposal with server-stamped `proposal_kind` + `task_meta` → existing
evaluation/approve/apply. The portable index (`hub_flow_store.json` `tasks[]` / `task_loops[]`)
changes **only** on approve→apply via `reconcileApprovedTaskProposal`. Optimistic concurrency uses
`taskst1_` / `loopst1_` state ids (FNV-1a over canonical JSON). Materialization enforces
`(vault, loop_ref, occurrence_key)` uniqueness. Cancel applies OD-4 cascade in the same atomic
transaction. `TASK_WRITES_ENABLED` defaults **off**; Scooling `TASK_WRITES_AUTHORIZED` stays
**false** until Tier 3.

---

## 0. Design decision — SD-4 extension (recorded, not a new write path)

> **Task and task-loop writes reuse SD-4.** `task_propose` / `task_loop_propose` /
> `task_instance_materialize` validate structured payloads, then create standard proposals with
> `source: "task"`, server-stamped `proposal_kind`, and `task_meta` for apply routing. Review,
> evaluation, approve, apply, and optimistic-concurrency checks are the **same** machinery notes
> and Flows use. The task index and loop index update **only** on approve→apply — never at propose
> time.

Rationale: one audited review path; no duplicated approve/apply logic; adapters never write
canonical knowledge directly.

---

## 1. Surfaces (triple-exposed, identical contract)

All surfaces require **`TASK_WRITES_ENABLED`** (Knowtation, default off, §8) and resolve write
authority server-side.

| Surface | One-time task writes | Loop series writes | Instance materialize |
| --- | --- | --- | --- |
| **MCP** | `task_propose` | `task_loop_propose` | `task_instance_materialize` |
| **Hub REST** | `POST /api/v1/tasks/proposals` | `POST /api/v1/task-loops/proposals` | `POST /api/v1/task-loops/{loop_id}/instances/proposals` |
| **CLI** | `knowtation task propose …` | `knowtation task-loop propose …` | `knowtation task-loop materialize …` |

All converge on **one handler family** (`lib/task/task-write.mjs`):

- `handleTaskProposeRequest` — one-time task kinds.
- `handleTaskLoopProposeRequest` — loop create / pause / cancel.
- `handleTaskInstanceMaterializeRequest` — occurrence spawn.

No surface re-implements write logic — parity proven by deep-equality (§10 tier 2).

### 1.1 Common request fields

Every propose request includes:

| Field | Req | Description |
| --- | --- | --- |
| `intent` | yes | Untrusted human-readable reason; recorded on proposal; **never executed** |
| `proposal_kind` | no (ignored if client sends) | **Server-stamped** on create — client value ignored |

Edit/status proposals on existing records require:

| Field | Req | Description |
| --- | --- | --- |
| `base_state_id` | yes | Concurrency token (`taskst1_…` or `loopst1_…`, §6) |

---

## 2. Write-authority model (scope × role, server-side, deny-by-default)

Reuses Flow/task **read** visibility plus a stricter write tier (mirrors
`FLOW-AUTHORING-WRITEBACK-CONTRACT-7A-L1.md` §2):

| Target scope | Minimum role | Resolution |
| --- | --- | --- |
| `personal` | authenticated writer (`viewer`+) in own vault | `resolveFlowVisibleScopes` includes `personal` |
| `project` | `editor` | visible scopes include `project` **and** role ≥ editor |
| `org` | `admin` | role must be `admin` |

| Rule | Contract |
| --- | --- |
| **Authorization, not a filter** | Write tier resolved server-side; client never supplies its own tier. |
| **Deny by default** | Ambiguous ⇒ `400 TASK_SCOPE_AMBIGUOUS`. Unauthorized ⇒ `403 TASK_SCOPE_DENIED`. |
| **No scope widening** | Payload `scope` validated against resolved write tier **before** proposal create. |
| **No existence leak** | Edit/materialize on unreadable id ⇒ `404 unknown_task` / `404 unknown_task_loop` (same as missing). |
| **Classroom assignment (OD-9)** | `kind: assignment` at `project`/`org` scope requires **Phase 2C** teacher authority gate — v0 returns `403 TASK_CLASSROOM_AUTHORITY_REQUIRED` until that gate ships. |

---

## 3. Proposal kinds (server-stamped `proposal_kind`)

| `proposal_kind` | Apply target | Index mutation |
| --- | --- | --- |
| `task_create` | new `knowtation.task/v0` | upsert `tasks[]` |
| `task_status_update` | existing task | patch `status` (+ optional `skip_reason` when → `cancelled`) |
| `task_assign` | existing task | patch `assignee_ref` / `assigner_ref` |
| `task_artifact_link` | existing task | append capped `artifact_links[]` (pointer-only) |
| `task_loop_create` | new `knowtation.task_loop/v0` | upsert `task_loops[]` |
| `task_loop_pause` | existing loop | patch `status: paused` |
| `task_loop_cancel` | existing loop + instances | patch loop `status: cancelled`; OD-4 cascade on pending instances |
| `task_instance_materialize` | new occurrence task | upsert `tasks[]` with `loop_ref` + `occurrence_key` |

**Non-goals (2G-d):** `task_loop_edit` (recurrence/title/flow_id patch) — defer to **2G-f** unless
Tier 3 explicitly expands scope. Orchestrator graph writes — separate gate (not 2G-d).

---

## 4. Request / response shapes

### 4.1 `task_create`

```jsonc
{
  "proposal_kind": "task_create",  // ignored — server stamps
  "intent": "Add personal practice goal",
  "task": {
    "task_id": "task_practice_june",
    "kind": "personal",
    "scope": "personal",
    "title": "Daily scale practice",
    "workspace_id": "ws_personal",
    "due_at": "2026-06-30T17:00:00.000Z",
    "assignee_ref": null,
    "assigner_ref": null,
    "artifact_links": []
  }
}
```

- `task_id` required; must match `TASK_ID_RE`; collision in scope ⇒ `409 TASK_LINEAGE_CONFLICT`.
- `loop_ref` / `occurrence_key` **must be absent or null** — use `task_instance_materialize` for
  loop instances.
- `run_ref` must be null at create (SD-2 run link is separate Flow run proposal path).

**Response — `knowtation.task_proposal/v0`:**

```jsonc
{
  "schema": "knowtation.task_proposal/v0",
  "proposal_id": "…",
  "proposal_kind": "task_create",
  "task_id": "task_practice_june",
  "loop_id": null,
  "base_state_id": "taskst1_…",  // absent-flow sentinel for create
  "scope": "personal",
  "auto_approvable": false,
  "status": "proposed",
  "review_queue": "task-writes"
}
```

### 4.2 `task_status_update` | `task_assign` | `task_artifact_link`

Same envelope pattern as §4.1 with `task_id`, `base_state_id` (required), and kind-specific patch
fields documented in `TASK-STORE-CONTRACT-2G.md` §1. Status transitions must be valid enum moves;
agents cannot auto-complete to `done` without policy (org may forbid via `hub_task_write_policy.json`).

### 4.3 `task_loop_create`

```jsonc
{
  "intent": "Weekly mentor check-in series",
  "loop": {
    "loop_id": "loop_mentor_w25",
    "kind": "mentor_checkin",
    "scope": "project",
    "title": "Weekly mentor check-in",
    "workspace_id": "ws_mentor",
    "status": "active",
    "recurrence": { "kind": "interval", "every": 1, "unit": "week", "anchor_at": "2026-06-23T09:00:00.000Z" },
    "timezone": "America/Los_Angeles",
    "flow_id": null,
    "boundary_policy": "propose_only",
    "memory_links": [],
    "handoff_refs": [],
    "until_at": null
  }
}
```

- Validates against `TASK-LOOP-STORE-CONTRACT-2G-c.md` §1 + recurrence subset (OD-2).
- `loop_id` collision ⇒ `409 TASK_LOOP_LINEAGE_CONFLICT`.
- Initial `status` must be `active` (pause/cancel are separate proposal kinds).

### 4.4 `task_loop_pause`

```jsonc
{
  "intent": "Pause until summer break",
  "loop_id": "loop_mentor_w25",
  "base_state_id": "loopst1_…"
}
```

**Semantics (plan §3.4):**

- Sets loop `status: paused`.
- **Does not** cancel existing instance tasks.
- **Blocks** new materialization while paused (`409 TASK_LOOP_NOT_ACTIVE` at materialize propose).

### 4.5 `task_loop_cancel`

```jsonc
{
  "intent": "Series no longer needed",
  "loop_id": "loop_mentor_w25",
  "base_state_id": "loopst1_…"
}
```

**Semantics (plan §3.4 + OD-4 default):**

- Sets loop `status: cancelled`.
- **Same atomic apply:** all instance tasks where `loop_ref === loop_id` and
  `status ∈ { pending, in_progress, blocked }` → `status: cancelled` with
  `skip_reason: series_cancelled` (new optional field on `task/v0`, pointer-only audit).
- Instance tasks already `done` or `cancelled` are untouched.
- Apply records `cascade_task_ids[]` (ids only) on proposal `task_meta` for audit — no bodies.

### 4.6 `task_instance_materialize`

```jsonc
{
  "intent": "Spawn next school-trip occurrence",
  "loop_id": "loop_school_trip",
  "occurrence_key": "2026-W25",
  "occurrence_at": "2026-06-23T09:00:00.000Z",
  "due_at": "2026-06-28T17:00:00.000Z",
  "title_override": null
}
```

| Field | Req | Description |
| --- | --- | --- |
| `loop_id` | yes | Must exist, scope-visible, `status: active` |
| `occurrence_key` | no | If omitted, server computes **next lazy** key from recurrence + timezone (OD-3) |
| `occurrence_at` | no | Defaults from recurrence computation |
| `due_at` | no | Calendar overlay; defaults to `occurrence_at` when set |
| `title_override` | no | Untrusted display override; default = loop title |

**Materialization rules:**

1. Uniqueness: `(vault, loop_ref, occurrence_key)` — duplicate ⇒ `409 TASK_OCCURRENCE_EXISTS`.
2. Sets `series_status_snapshot` to loop status at spawn (`active`).
3. New task `status: pending`; `run_ref: null` until agent pass (SD-2).
4. Does **not** mutate the loop series row (except `updated` timestamp optional).
5. Lazy only in v0 — no eager horizon window (OD-3 defer).

**Response — `knowtation.task_instance_proposal/v0`:**

```jsonc
{
  "schema": "knowtation.task_instance_proposal/v0",
  "proposal_id": "…",
  "proposal_kind": "task_instance_materialize",
  "loop_id": "loop_school_trip",
  "task_id": "task_school_trip_2026_w25",
  "occurrence_key": "2026-W25",
  "base_state_id": "loopst1_…",
  "scope": "personal",
  "auto_approvable": false,
  "status": "proposed",
  "review_queue": "task-writes"
}
```

`task_id` is **deterministic**: `task_<loop_token>_<sanitized_occurrence_key>` with max length
enforced by `TASK_ID_RE` (server rejects computed id overflow ⇒ `400 TASK_MATERIALIZE_INVALID`).

---

## 5. Review-before-write lifecycle

Identical to SD-4 / 7A-L1 §3:

```
task_propose / task_loop_propose / task_instance_materialize
        │  validate + write-authority + concurrency precheck
        ▼
   POST /proposals  ──►  status: proposed  (source:"task", task_meta, intent)
        │
        ▼
   /proposals/{id}/evaluation  ──►  pass | fail | needs_changes
        │
        ▼
   /proposals/{id}/approve  ──►  base_state_id re-check (409 on conflict)
        │
        ▼
   reconcileApprovedTaskProposal  ──►  tasks[] / task_loops[] ONLY mutation
```

| Rule | Contract |
| --- | --- |
| **No silent writes** | Propose never mutates `hub_flow_store.json` task buckets. |
| **`auto_approvable`** | Always `false` for task/loop proposals in v0 (human review default). |
| **Evaluation gate** | `HUB_PROPOSAL_EVALUATION_REQUIRED` honored unchanged. |
| **Rollback** | Failed reconcile rolls back — no partial index state. |
| **Orchestrator** | Materialize may be invoked by Scooling orchestrator **only** through adapter → same propose path; orchestrator never writes Knowtation directly. |

---

## 6. Optimistic concurrency

| Item | Definition |
| --- | --- |
| **`taskStateId(task)`** | `'taskst1_' + fnv1a64Hex(stableStringify(canonicalTask(task)))` — canonical subset: all §1 fields except `created`/`updated`/`truncated`. |
| **`loopStateId(loop)`** | `'loopst1_' + fnv1a64Hex(stableStringify(canonicalLoop(loop)))` — canonical subset per `TASK-LOOP-STORE-CONTRACT-2G-c.md` §1. |
| **Absent sentinels** | `taskst1_` / `loopst1_` + fnv1a64Hex(0x00) for create proposals. |
| **Check points** | Propose-time precheck + approve-time authoritative re-check. |
| **Conflict** | `base_state_id` mismatch ⇒ `409 TASK_LINEAGE_CONFLICT` or `409 TASK_LOOP_LINEAGE_CONFLICT`. |

Materialize proposals include loop `base_state_id` so concurrent pause/cancel fails closed if loop
changed between read and propose.

---

## 7. Apply reconciliation (`reconcileApprovedTaskProposal`)

| `proposal_kind` | Handler behavior |
| --- | --- |
| `task_create` | Validate schema; upsert task; stamp `created`/`updated` |
| `task_status_update` | Patch status; validate transition |
| `task_assign` | Patch assignee/assigner; `UID_HASH_REF_RE` only |
| `task_artifact_link` | Append link; cap `MAX_ARTIFACT_LINKS`; pointer-only |
| `task_loop_create` | Validate recurrence; upsert loop |
| `task_loop_pause` | Set `status: paused` if currently `active` |
| `task_loop_cancel` | Set loop cancelled + OD-4 instance cascade (§4.5) |
| `task_instance_materialize` | Insert instance task; enforce uniqueness |

Proposal body is JSON stored at `meta/tasks/proposals/<proposal_id>.json` (path convention parallel
to delegation `meta/delegation/…`). `task_meta` on the proposal record:

```jsonc
{
  "record_kind": "task" | "task_loop" | "task_instance",
  "proposal_kind": "task_loop_create",
  "task_id": "…",
  "loop_id": "…",
  "occurrence_key": "…",
  "cascade_task_ids": ["…"]
}
```

---

## 8. Posture / gating (default off)

| Control | Default | Effect |
| --- | --- | --- |
| **`TASK_WRITES_ENABLED`** (Knowtation env + `hub_task_write_policy.json`) | **off** | All propose/materialize routes return `403 TASK_WRITES_DISABLED`. |
| **`TASK_WRITES_AUTHORIZED`** (Scooling compile-time) | **false** | Adapter write methods return `task_writes_not_authorized`. |
| **`TASK_LOOP_LIVE_READ_AUTHORIZED`** | **false** | Unchanged — separate Tier 3 from writes. |
| **`LOOP_ORCHESTRATOR_*`** | **false** | Unchanged — dispatch is 2G-e. |

Enabling live writes is **Tier 3** — see §9 checklist. **Do not flip without explicit authorization.**

Env double-lock when Tier 3 consumed (Scooling): `SCOOLING_TASK_WRITES=enabled` +
`KNOWTATION_HUB_TOKEN` + `KNOWTATION_HUB_VAULT_ID` + compile-time `TASK_WRITES_AUTHORIZED=true`.

---

## 9. Tier 3 gate checklist (operator — consume once per authorization)

Each row must pass **before** flipping `TASK_WRITES_ENABLED` (Knowtation) and
`TASK_WRITES_AUTHORIZED` (Scooling). One authorization, one session, consumed when DONE.

| # | Gate | Pass criterion |
| --- | --- | --- |
| T3-1 | **Contracts frozen** | `TASK-WRITE-PROPOSAL-CONTRACT-2G-d.md` + `TASK-WRITE-ADAPTER-CONTRACT-2G-d.md` committed; 2G-c-b read contracts unchanged |
| T3-2 | **2G-d-b impl green** | All seven tiers pass in Knowtation `test/task-write-*.test.mjs` and Scooling `test/*/task-write-*` with gates **off**; re-run with gates **on** in staging only |
| T3-3 | **No secrets** | `JSON.stringify` audit of proposal envelopes + applied records — no tokens/oauth/raw bodies |
| T3-4 | **Scope negatives** | Personal writer cannot create `project`/`org` task or loop; ambiguous scope fails closed |
| T3-5 | **Existence leak** | Out-of-scope get/propose returns `404 unknown_*`, not `403` |
| T3-6 | **Concurrency** | Stale `base_state_id` on pause/cancel/materialize ⇒ `409`; no lost updates under concurrent propose |
| T3-7 | **Materialize uniqueness** | Duplicate `(loop_ref, occurrence_key)` ⇒ `409 TASK_OCCURRENCE_EXISTS` |
| T3-8 | **OD-4 cancel cascade** | Approve `task_loop_cancel` cancels pending instances atomically; done instances unchanged; `cascade_task_ids` recorded |
| T3-9 | **Pause blocks materialize** | Paused loop ⇒ materialize propose refused |
| T3-10 | **SD-2 preserved** | Materialized instance `run_ref: null` until run proposal; no adapter canonical store |
| T3-11 | **Classroom defer** | `assignment` at project/org returns `403 TASK_CLASSROOM_AUTHORITY_REQUIRED` until 2C |
| T3-12 | **Cross-repo I-T-LOOP-02** | propose loop create → approve → materialize → get instance with matching `loop_ref`/`occurrence_key` |
| T3-13 | **Hosted smoke** | `scripts/verify-hosted-task-write-smoke.mjs` PASS on staging Hub (propose only — approve via UI or test admin) |
| T3-14 | **Governance sync** | `ROADMAP.md` + `OVERSEER-HANDOVER.md` updated; Tier 3 row marked CONSUMED |
| T3-15 | **Merge path** | Muse merge to `main` + GitHub muse-mirror PR (SD-14); **no** direct push to GitHub `main` |

**Explicit authorization record (operator fills on flip day):**

```text
Tier 3 TASK_WRITES — authorized YYYY-MM-DD by <principal>
Repos: knowtation @ <sha>, scooling @ <sha>
Gates flipped: TASK_WRITES_ENABLED=1 (KN), TASK_WRITES_AUTHORIZED=true (SC)
Pre/post curl matrix: docs/CROSS-REPO-COORDINATION.md (if staging push)
```

---

## 10. Error taxonomy

`TASK_DRAFT_INVALID` · `TASK_SCOPE_DENIED` · `TASK_SCOPE_AMBIGUOUS` · `unknown_task` ·
`unknown_task_loop` · `TASK_LINEAGE_CONFLICT` (409) · `TASK_LOOP_LINEAGE_CONFLICT` (409) ·
`TASK_OCCURRENCE_EXISTS` (409) · `TASK_LOOP_NOT_ACTIVE` · `TASK_MATERIALIZE_INVALID` ·
`TASK_WRITES_DISABLED` · `TASK_CLASSROOM_AUTHORITY_REQUIRED` · `EVALUATION_REQUIRED` (approve,
unchanged).

---

## 11. Seven-tier test matrix (2G-d-b Auto)

Files: `test/task-write-*.test.mjs`. **No network in unit tests.** Run with
`TASK_WRITES_ENABLED` toggled both ways.

| Tier | File | Focus |
| --- | --- | --- |
| unit | `test/task-write-unit.test.mjs` | `taskStateId`/`loopStateId` deterministic; recurrence validator; proposal envelope stamps; kind routing |
| integration | `test/task-write-parity-integration.test.mjs` | CLI = MCP = Hub deep-equal propose envelopes; `TASK_WRITES_DISABLED` all surfaces |
| e2e | `test/task-write-e2e.test.mjs` | loop create → approve → materialize → get instance; pause blocks materialize; cancel cascades pending |
| stress | `test/task-write-stress.test.mjs` | 100 concurrent materialize proposals — one wins per occurrence_key; cancel cascade on 500 pending instances |
| data-integrity | `test/task-write-data-integrity.test.mjs` | approve round-trip byte-stable; OD-4 cascade ids match store; `(loop_ref, occurrence_key)` unique; SD-2 `run_ref` null at spawn |
| performance | `test/task-write-performance.test.mjs` | propose + apply p95 budgets; cancel cascade O(n) single pass |
| security | `test/task-write-security.test.mjs` | scope denial; no widening; injection in titles/intent inert; no secrets in JSON; stale concurrency |

Cross-repo **I-T-LOOP-02:** school-trip loop create (fixture fields) → materialize `2026-W25` →
Scooling inert/live adapter read coherence with Knowtation store.

---

## 12. Acceptance (2G-d-a)

- [x] Proposal kinds, request/response shapes, write authority, lifecycle, concurrency, apply rules,
      materialize/pause/cancel semantics, posture, error taxonomy, seven-tier matrix, and Tier 3
      checklist frozen here — **contract only**.
- [x] Ratified against `TASK-STORE-CONTRACT-2G.md`, `TASK-LOOP-STORE-CONTRACT-2G-c.md`, SD-4, plan
      §3.3–§3.4, OD-3/OD-4 defaults.
- [ ] 2G-d-b implements on `feat/phase-2g-d-write-proposals`.
- [ ] Posture remains off until Tier 3 checklist §9 consumed.

## Non-goals (2G-d)

- `task_loop_edit` / recurrence patch proposals (2G-f).
- Orchestrator live dispatch (2G-e).
- `TASK_LOOP_LIVE_READ_AUTHORIZED` flip (separate Tier 3 session).
- Hosted canister task write index.
- Auto-approve task proposals (`auto_approvable` stays false v0).

---

## Handover notes (for 2G-d-b — Auto)

1. Branch **`feat/phase-2g-d-write-proposals`** off latest loop-contract work; read this doc +
   `scooling/docs/TASK-WRITE-ADAPTER-CONTRACT-2G-d.md` — **no redesign**.
2. Implement `lib/task/task-write.mjs` + `taskStateId` / `loopStateId` in `lib/note-state-id.mjs`
   (or `task-store.mjs` exports); wire Hub routes, CLI, MCP, OpenAPI **in the same change**.
3. Extend proposal apply dispatcher to call `reconcileApprovedTaskProposal` when
   `source === "task"`.
4. `TASK_WRITES_ENABLED` defaults **off**; seven tiers green before handover regen.
5. Do **not** flip Scooling `TASK_WRITES_AUTHORIZED` without Tier 3 §9 checklist + explicit
   operator authorization.
