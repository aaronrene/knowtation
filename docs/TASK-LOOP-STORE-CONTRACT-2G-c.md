# Task Loop Store + List/Get Parity — Contract (Phase 2G-c, Step 2G-c-b)

Status: **Contract frozen (2G-c-b Auto, 2026-06-24).** Read-only list/get for task loops,
orchestrator graphs, and loop-scoped task instances. Implementation on branch
`feat/phase-2g-c-loop-contracts`.

Related:

- `docs/TASK-LOOPS-AND-ORCHESTRATOR-PLAN.md` — frozen plan (2G-c-a); open decisions §9 resolved below.
- `docs/TASK-STORE-CONTRACT-2G.md` — one-time task store (unchanged method shapes; additive instance fields).
- `scooling/docs/TASK-LOOP-ADAPTER-CONTRACT-2G-c.md` — Scooling consumer boundary.
- `scooling/docs/CROSS-REPO-COORDINATION.md` — **SD-2** (instance task ↔ run linkage).

**Scope fence (2G-c-b):** Canonical `task_loop/v0` + `orchestrator_graph/v0` schemas, store shape,
read ops, starter fixtures (school-trip graph), seven-tier test matrix. **No** Hub routes, **no**
CLI/MCP wiring, **no** live gate flips. Writes deferred to 2G-d + Tier 3.

---

## Simple summary

Recurring jobs (school-trip packing, weekly check-ins) need a **series template** in Knowtation plus
**dated instance tasks** that link back to the series. This contract defines that filing cabinet:
`task_loop/v0` series, optional `orchestrator_graph/v0` for loop-of-loops handoffs, and extended
`task/v0` rows with `loop_ref` + `occurrence_key`. Read-only list/get mirrors the 2G-b task pattern.

## Technical summary

Extend `hub_flow_store.json` vault buckets with `task_loops[]` and `orchestrator_graphs[]` beside
existing `tasks[]`. New module `lib/task/task-loop-store.mjs` owns loop/graph read ops; `task-store.mjs`
gains optional instance fields and `loop_ref` / `occurrence_key` list filters. v0 exposes read-only
`listTaskLoops`, `getTaskLoop`, `getOrchestratorGraph` — **contract + inert store only** in 2G-c-b;
Hub/CLI/MCP surfaces land with live gate (Tier 3).

---

## Open decisions §9 — recorded defaults (2G-c-b)

| ID | Decision | Recorded default |
| --- | --- | --- |
| **OD-1** | Loop-of-loops graph location | **`orchestrator_graph/v0`** in Knowtation portable store (`orchestrator_graphs[]`); Scooling orchestrator consumes by id |
| **OD-2** | RRULE vs subset | **cron + interval + manual + on_wake v0**; full RRULE deferred to 2G-f |
| **OD-3** | Instance materialization | **Lazy** — next occurrence on demand; optional `horizon_days` deferred |
| **OD-4** | Cancel series → pending instances | **Auto-cancel pending** with audit ref (write path in 2G-d) |
| **OD-5** | Series end condition | **`until_at` optional** + manual cancel |
| **OD-6** | Agent loop without task instance | **Require instance task** for SD-2 / delegation bind |
| **OD-7** | Pass audit persistence | **Scooling operational v0**; Knowtation mirror in 2G-e |
| **OD-8** | Composition tier gate | **Split gate** — `LOOP_ORCHESTRATOR_COMPOSITION_ENABLED` (Scooling) |
| **OD-9** | Classroom recurrence | **Deferred** to Phase 2C authority spec |
| **OD-10** | Trigger signal source | **task status + calendar timeline + manual v0**; note signals in 2G-f |

---

## 1. Canonical record — `knowtation.task_loop/v0`

| Field | Type | Req | Description |
| --- | --- | --- | --- |
| `schema` | const | yes | `knowtation.task_loop/v0` |
| `loop_id` | `loop_<token>` | yes | Stable series id |
| `kind` | enum | yes | Same as task: `personal` \| `assignment` \| `mentor_checkin` \| `org_work_job` |
| `scope` | enum | yes | `personal` \| `project` \| `org` |
| `status` | enum | yes | `active` \| `paused` \| `cancelled` |
| `title` | string | yes | Untrusted display |
| `workspace_id` | string | yes | Workspace binding |
| `recurrence` | object | yes | See §1.1 |
| `timezone` | IANA string | yes | Occurrence generation |
| `flow_id` | string \| null | no | Optional default Flow for agent passes |
| `boundary_policy` | enum | yes | `observe_only` \| `draft_only` \| `propose_only` \| `execute_with_consent` |
| `memory_links` | `{ kind, ref }[]` | yes | Pointer-only series memory |
| `handoff_refs` | string[] | no | Orchestrator graph ids (OD-1) |
| `until_at` | ISO8601 \| null | no | Optional series end (OD-5) |
| `created` / `updated` | ISO8601 | yes | |

### 1.1 Recurrence shape (v0 pinned subset — OD-2)

| `recurrence.kind` | Fields |
| --- | --- |
| `cron` | `expression`, `anchor_tz` |
| `interval` | `every`, `unit` (`day` \| `week` \| `month`), `anchor_at` |
| `manual` | _(none)_ — human/orchestrator trigger only |
| `on_wake` | `source_loop_ref` — sibling wake from orchestrator graph |

`calendar_anchor` deferred until Phase 2H calendar anchor refs exist.

### 1.2 Id regexes

| Export | Value |
| --- | --- |
| `LOOP_ID_RE` | `/^loop_[a-z0-9_]{1,48}$/` |
| `OCCURRENCE_KEY_RE` | `/^[A-Za-z0-9._:-]{1,64}$/` |
| `GRAPH_ID_RE` | `/^graph_[a-z0-9_]{1,48}$/` |
| `MAX_TASK_LOOP_SUMMARIES` | `200` |

---

## 2. Instance extensions — `knowtation.task/v0` (additive)

Optional fields on occurrence instance tasks (standalone one-time tasks omit or null):

| Field | Type | Description |
| --- | --- | --- |
| `loop_ref` | string \| null | `loop_<token>` when spawned from series |
| `occurrence_key` | string \| null | Stable id (`2026-W25`, etc.) |
| `occurrence_at` | ISO8601 \| null | Scheduled instant for this occurrence |
| `series_status_snapshot` | enum \| null | Loop status at spawn time |

Uniqueness: `(vault, loop_ref, occurrence_key)` unique when `loop_ref` set.

---

## 3. Orchestrator graph — `knowtation.orchestrator_graph/v0` (OD-1)

| Field | Type | Req | Description |
| --- | --- | --- | --- |
| `schema` | const | yes | `knowtation.orchestrator_graph/v0` |
| `graph_id` | `graph_<token>` | yes | Stable graph id |
| `scope` | enum | yes | Authorization tier |
| `workspace_id` | string | yes | Workspace binding |
| `title` | string | yes | Untrusted display |
| `nodes` | string[] | yes | Loop ids in graph |
| `edges` | `{ from, to, trigger }[]` | yes | Handoff rules; `trigger`: `on_pass` \| `on_trigger` \| `on_conflict` |
| `composition_tier` | enum | yes | `personal_safe` (v0 default) |
| `created` / `updated` | ISO8601 | yes | |

---

## 4. Store module shape

```jsonc
{
  "vaults": {
    "<vault_id>": {
      "flows": [],
      "steps": [],
      "runs": [],
      "candidates": [],
      "projections": [],
      "tasks": [],
      "task_loops": [],
      "orchestrator_graphs": []
    }
  }
}
```

| Rule | Contract |
| --- | --- |
| Backward compat | Missing `task_loops` / `orchestrator_graphs` default to `[]` |
| No second file | Same `hub_flow_store.json` per SD-2 portability |
| Writes | Read-only v0; materialization via proposals in 2G-d |

### 4.1 Read operations

| Function | Returns |
| --- | --- |
| `listTaskLoops(dataDir, vaultId, query)` | `{ schema: knowtation.task_loop_list/v0, vault_id, effective_scope, loops, truncated }` |
| `getTaskLoop(dataDir, vaultId, loopId, query)` | Full `task_loop/v0` or `null` |
| `getOrchestratorGraph(dataDir, vaultId, graphId, query)` | Full `orchestrator_graph/v0` or `null` |
| `listTasks` (extended) | Adds filters `loop_ref`, `occurrence_key` |

### 4.2 Seeding — `task-loops/starter/`, `orchestrator-graphs/starter/`

Idempotent seed on first loop read (school-trip fixture graph — plan Appendix A):

| `loop_id` | Recurrence | Boundary |
| --- | --- | --- |
| `loop_school_trip` | manual | observe_only |
| `loop_packing_list` | on_wake | draft_only |
| `loop_weather_check` | on_wake | observe_only |
| `loop_schedule_conflict` | on_wake | draft_only |
| `loop_message_draft` | on_wake | draft_only |

Instance: `task_school_trip_2026_w25` with `loop_ref: loop_school_trip`, `occurrence_key: 2026-W25`.

Graph: `graph_school_trip` linking all five loops.

---

## 5. Fail-closed rules

1. **Read-only v0** — no POST/PATCH/DELETE on loops/graphs.
2. **Titles untrusted** — never interpreted as commands.
3. **Memory links = pointers only** — no note bodies.
4. **Scope deny-by-default** — same model as tasks/flows.
5. **Lazy materialization** — store does not auto-spawn instances in 2G-c-b (fixture seed only).

---

## 6. Seven-tier test matrix (2G-c-b)

| Tier | File | Focus |
| --- | --- | --- |
| unit | `test/task-loop-store-unit.test.mjs` | Regexes, recurrence validation, projections |
| integration | `test/task-loop-store-integration.test.mjs` | Seed + list/get parity handlers |
| e2e | `test/task-loop-store-e2e.test.mjs` | School-trip graph seed → instance get |
| stress | `test/task-loop-store-stress.test.mjs` | 500 instance filter; list caps |
| data-integrity | `test/task-loop-store-data-integrity.test.mjs` | `(loop_ref, occurrence_key)` uniqueness; SD-2 |
| performance | `test/task-loop-store-performance.test.mjs` | list/get p95 |
| security | `test/task-loop-store-security.test.mjs` | Scope deny; malicious titles inert |

Cross-repo **I-T-LOOP-01:** `loop_school_trip` → `task_school_trip_2026_w25` with matching
`loop_ref` / `occurrence_key`.

---

## 7. Acceptance (2G-c-b)

- [x] Schema, store shape, read ops, OD defaults, fail-closed rules frozen here.
- [ ] `lib/task/task-loop-store.mjs` + extended `task-store.mjs` implement to this contract.
- [ ] Seven-tier tests green on feature branch.
- [ ] Hub routes **not** mounted until Tier 3 live gate.

## Non-goals (2G-c-b)

- Hub/CLI/MCP route wiring (follows `TASK_LOOP_LIVE_READ_AUTHORIZED` Tier 3).
- Instance materialization writes (2G-d).
- Hosted canister loop index.
- RRULE full parser (2G-f).
