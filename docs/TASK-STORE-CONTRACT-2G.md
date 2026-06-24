# Task Store + List/Get Parity — Contract (Phase 2G, Step 2G-a)

Status: **Contract frozen (2G-a Thinking).** Implementation (store, Hub routes, CLI/MCP, OpenAPI,
seven-tier tests, hosted smoke script) is **2G-b Auto** on branch **`feat/phase-2g-task-store`**.

Related:

- `scooling/docs/TASK-ADAPTER-CONTRACT-2G.md` — Scooling consumer boundary (frozen 2G-a/2G-b on
  `main` @ `e185af0`); maps to this wire shape at live-read time.
- `scooling/docs/CROSS-REPO-COORDINATION.md` — **SD-2** (task↔run linkage, one portable store).
- `docs/FLOW-STORE-CONTRACT-7A-10.md` — **Option A parity reference** (file-backed index,
  `*ForClient` projections, triple-surface list/get, scope deny-by-default).
- `lib/flow/flow-store.mjs` — shared on-disk file (`hub_flow_store.json`); tasks extend the same
  vault bucket per SD-2.
- `lib/flow/flow-scope.mjs` — scope resolution reused verbatim (`personal|project|org`).
- `docs/AGENT-DELEGATION-V0-SPEC.md` — `task_ref` / `run_ref` pin formats (SD-2).
- `docs/openapi.yaml` — Hub wire shapes in §6 land **in the same change as the routes** (2G-b).

**Scope fence (2G-a):** Canonical record schema, store shape, list/get read contract, OpenAPI wire
shapes, seven-tier test matrix, hosted smoke checklist **only**. **No** `lib/task/` implementation,
**no** Hub routes, **no** CLI/MCP wiring, **no** Scooling changes, **no** posture flips
(`TASK_LIVE_READ_AUTHORIZED` stays `false` in Scooling until a separate Tier 3 gate).

**Posture (2G-b):** Read-only list/get. **No** create/update/assign/artifact-link routes. Durable
task writes route through Knowtation proposals (review-before-write) at a **separate Tier 3 gate**
(`TASK_WRITES_AUTHORIZED`).

---

## Simple summary

Homework, personal goals, mentor check-ins, and org work jobs need a **single canonical home** in
Knowtation — not in Scooling. This document is the blueprint for that filing cabinet: a **task
record** (`knowtation.task/v0`) stored beside Flow runs in the same portable index, plus two read
doors — **list** (trimmed summaries) and **get** (one authorized task). The blueprint guarantees
three things. First, the CLI, MCP plug-in, and Hub REST return **byte-identical JSON** for the same
authorized request. Second, scope is **authorization enforced server-side** — the client never
widens its own tier; invisible tasks look missing. Third, list views are **content-minimized** (no
submission bodies; artifact links are pointer-only on get). Tasks link to Flow runs by id per
**SD-2** (`task.run_ref` ↔ `run.task_ref`); Scooling consumes and displays only.

## Technical summary

Extend the existing **Option A** Flow index (`hub_flow_store.json`) with a per-vault `tasks[]`
array holding `knowtation.task/v0` records — **one portable store** with `runs[]` (SD-2). New module
`lib/task/task-store.mjs` owns task read ops; it **reads/writes through** `loadFlowStore` /
`saveFlowStore` from `lib/flow/flow-store.mjs` (no second index file). v0 exposes read-only
`listTasks` and `getTask` over **three identical surfaces** — CLI (`knowtation task list|get`), MCP
(`task_list` / `task_get`), Hub REST (`GET /api/v1/tasks`, `GET /api/v1/tasks/{id}`). Scope reuses
`resolveFlowVisibleScopes` / `resolveFlowScopeQuery` from `lib/flow/flow-scope.mjs`. Idempotent
starter seed from `tasks/starter/` on first read aligns with Scooling inert fixtures and seeds the
SD-2 anchor pair (`task_2g_handover_001` ↔ `run_overseer_in_progress`). Self-hosted Hub only in v0
(calendar/flow parity); hosted canister task index is deferred.

---

## 1. Canonical record — `knowtation.task/v0`

| Field | Type | Req | Description |
| --- | --- | --- | --- |
| `schema` | const `knowtation.task/v0` | yes | Wire discriminator |
| `task_id` | string (`task_<token>`, `[a-z0-9_]{1,48}`) | yes | Stable id |
| `kind` | enum | yes | `personal` \| `assignment` \| `mentor_checkin` \| `org_work_job` |
| `scope` | enum | yes | `personal` \| `project` \| `org` — authorization tier |
| `status` | enum | yes | `pending` \| `in_progress` \| `blocked` \| `done` \| `cancelled` |
| `title` | string | yes | **Untrusted** display text — never interpreted as commands |
| `workspace_id` | string | yes | Workspace binding (opaque id, not authorization by itself) |
| `due_at` | ISO8601 UTC \| null | yes | Due timestamp or null |
| `assignee_ref` | string \| null | no | `uid_hash:<64-hex>` only — never raw email/name |
| `assigner_ref` | string \| null | no | `uid_hash:…` or org-scoped ref (`org_ref:…`) |
| `run_ref` | string \| null | no | **SD-2** link to `flow_run.run_id`; reciprocal to `run.task_ref` |
| `artifact_links` | `{ kind, ref }[]` | yes | Pointer-only (`note` \| `media` \| `review_item` + opaque ref) |
| `created` | ISO8601 UTC | yes | |
| `updated` | ISO8601 UTC | yes | |
| `truncated` | boolean | yes | `true` when list cap or field cap applied |

Lifecycle rules (**SD-2**):

- A task may exist before any run (`run_ref: null`).
- A run may exist without a task (`task_ref: null` on run — e.g. retry).
- One task may spawn several runs over time; the task pins at most one **current** `run_ref`.
- When both sides set link ids, `task.run_ref` MUST equal `run.run_id` and `run.task_ref` MUST
  equal `task.task_id`. Seed enforces this for the anchor pair.

### 1.1 Id regexes (pin v0)

| Export | Value | Consumer parity |
| --- | --- | --- |
| `TASK_ID_RE` | `/^task_[a-z0-9_]{1,48}$/` | Scooling `TASK_ID_RE` |
| `FLOW_RUN_ID_RE` | `/^run_[a-z0-9_]{1,48}$/` | Reused from flow store |
| `UID_HASH_REF_RE` | `/^uid_hash:[a-f0-9]{64}$/` | Scooling assignee format |
| `SAFE_ARTIFACT_REF_RE` | `/^[A-Za-z0-9._:#-]{1,256}$/` | Scooling `SAFE_REF_RE` |
| `MAX_TASK_SUMMARIES` | `500` | Scooling `MAX_TASK_SUMMARIES` |
| `MAX_ARTIFACT_LINKS` | `32` | Cap on get payload |

---

## 2. Store module shape — `lib/task/task-store.mjs`

Tasks live in the **same file** as Flow records:

```jsonc
{
  "vaults": {
    "<vault_id>": {
      "flows":        [ /* unchanged */ ],
      "steps":        [ /* unchanged */ ],
      "runs":         [ /* knowtation.flow_run/v0 — includes task_ref */ ],
      "candidates":   [ /* unchanged */ ],
      "projections":  [ /* unchanged */ ],
      "tasks":        [ /* knowtation.task/v0 — NEW */ ]
    }
  }
}
```

### 2.1 Vault shape migration

| Rule | Contract |
| --- | --- |
| **Backward compat** | `loadFlowStore` / `getVaultFlowStore` MUST default missing `tasks` to `[]` |
| **Atomic writes** | Task seed/read paths use existing `saveFlowStore` (tmp + rename) |
| **No second file** | Do **not** introduce `hub_task_store.json` — violates SD-2 portability |

### 2.2 Required changes to `lib/flow/flow-store.mjs` (2G-b)

| Change | Behaviour |
| --- | --- |
| `VaultFlowStore.tasks` | Add `tasks: []` to typedef and `getVaultFlowStore` default |
| Empty vault init | All `{ flows, steps, runs, candidates, projections, tasks }` arrays |

Task read logic stays in `lib/task/task-store.mjs`; flow-store only grows the vault bucket.

### 2.3 Persistence primitives (reuse — do not duplicate)

Task store imports and uses:

- `loadFlowStore`, `saveFlowStore`, `getVaultFlowStore` from `lib/flow/flow-store.mjs`

### 2.4 Seeding — `tasks/starter/` (idempotent)

| Function | Signature | Behaviour |
| --- | --- | --- |
| `seedStarterTasks` | `(dataDir, vaultId, { starterDir?, seedSd2Run? }) → { seeded, skipped }` | Load each `tasks/starter/task_*.json`, validate §1 schema, upsert by `task_id`. Idempotent. |
| `seedSd2AnchorRun` | `(dataDir, vaultId) → { seeded: boolean }` | If `run_overseer_in_progress` absent from `runs[]`, upsert minimal read-only run with `task_ref: task_2g_handover_001`, `flow_id: flow_overseer_handover`, `flow_version: 0.1.0`, `scope: project`, `status: in_progress`. Does **not** enable run writes. |

Seeding is **read-time lazy** (first `listTasks`/`getTask` on empty `tasks[]` triggers it).

**Starter bundles (must match Scooling inert fixtures field-for-field on wire):**

| File | `task_id` | `scope` | `run_ref` |
| --- | --- | --- | --- |
| `task_2g_handover_001.json` | `task_2g_handover_001` | `project` | `run_overseer_in_progress` |
| `task_personal_practice.json` | `task_personal_practice` | `personal` | `null` |
| `task_mentor_checkin_w25.json` | `task_mentor_checkin_w25` | `project` | `null` |
| `task_org_compliance_q2.json` | `task_org_compliance_q2` | `org` | `null` |

Assignee hash in starters: `0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef`
(Scooling `TASK_FIXTURE_ACTOR_HASH`).

### 2.5 Read operations (v0 surface)

| Function | Signature | Returns | Rules |
| --- | --- | --- | --- |
| `listTasks` | `(dataDir, vaultId, { visibleScopes, filterScopes, effectiveScope, workspaceId?, status?, kind?, limit?, starterDir? }) → TaskListResult` | `{ schema, vault_id, effective_scope, tasks, truncated }` | Summaries only; scope filter deny-by-default; `limit` capped at `MAX_TASK_SUMMARIES`; ordering: `due_at` asc (nulls last), then `task_id` asc |
| `getTask` | `(dataDir, vaultId, taskId, { visibleScopes, starterDir? }) → StoredTask \| null` | Full `knowtation.task/v0` or `null` | `taskId` must match `TASK_ID_RE`; invisible/out-of-scope ⇒ `null` (404) |

### 2.6 Client projections (`*ForClient`)

| Function | Drops / keeps |
| --- | --- |
| `taskSummaryForClient` | **keeps** `task_id, kind, scope, status, title, workspace_id, due_at, run_ref, truncated`; **drops** `assignee_ref`, `assigner_ref`, `artifact_links`, `created`, `updated` |
| `taskForClient` | Full §1 record; caps `artifact_links` at `MAX_ARTIFACT_LINKS` (sets `truncated:true` when capped) |

---

## 3. Shared handlers — `lib/task/task-handlers.mjs`

Mirror `lib/flow/flow-handlers.mjs` structure:

| Handler | Maps to store | Error codes |
| --- | --- | --- |
| `handleTaskListRequest` | `listTasks` | `400 TASK_SCOPE_AMBIGUOUS`, `403 TASK_SCOPE_DENIED`, `400 BAD_REQUEST` |
| `handleTaskGetRequest` | `getTask` | Same + `404 unknown_task` |

Scope resolution: import `resolveHandlerVisibleScopes` pattern from flow-handlers OR call
`resolveFlowVisibleScopes` + `resolveFlowScopeQuery` directly — **same visible scope set as Flow
list/get for the same caller**.

Query param mapping (Hub + CLI flags):

| Param | Maps to |
| --- | --- |
| `scope` | Narrows within authorized scopes only |
| `workspace_id` | Filter `workspace_id` equality |
| `status` | Filter task status enum |
| `kind` | Filter task kind enum |
| `limit` | `1..MAX_TASK_SUMMARIES` |

---

## 4. Triple-surface parity (CLI = MCP = Hub REST)

The defining invariant: **the same authorized request returns byte-identical JSON on all three
surfaces.**

### 4.1 CLI — `knowtation task …`

```
knowtation task list  [--scope personal|project|org] [--workspace-id <id>] [--status <s>] [--kind <k>] [--limit <n>] [--json]
knowtation task get   <task_id> [--json]
```

- `--json` prints exact Hub JSON to stdout.
- Errors: non-zero exit + same code strings as Hub.

### 4.2 MCP — `task_list`, `task_get`

Register in `mcp/tools/task.mjs` (new) and wire in dispatcher. Zod args mirror query params /
`task_id`. Results deep-equal Hub payload.

### 4.3 Hub REST

Mount under existing auth stack (`jwtAuth`, `apiLimiter`, `requireVaultAccess`):

```
app.use('/api/v1/tasks', jwtAuth, apiLimiter, requireVaultAccess);
GET /api/v1/tasks           requireRole('viewer', 'editor', 'admin', 'evaluator')
GET /api/v1/tasks/:id       requireRole('viewer', 'editor', 'admin', 'evaluator')
```

**Self-hosted Hub only in v0.** Gateway hosted proxy for tasks is **deferred** (flows delegation
routes proxy selectively; tasks follow calendar pattern — local/self-hosted first).

---

## 5. OpenAPI wire shapes (land with routes in 2G-b)

New tag: `Tasks`. Auth: `BearerAuth` + `X-Vault-Id`.

### 5.1 `GET /api/v1/tasks`

Query: `scope`, `workspace_id`, `status`, `kind`, `limit` (1..500).

Response schema: `knowtation.task_list/v0`:

```yaml
TaskListResponse:
  type: object
  required: [schema, vault_id, effective_scope, tasks, truncated]
  properties:
    schema:          { type: string, enum: [knowtation.task_list/v0] }
    vault_id:        { type: string }
    effective_scope: { type: string, enum: [personal, project, org] }
    tasks:
      type: array
      maxItems: 500
      items: { $ref: '#/components/schemas/TaskSummary' }
    truncated:       { type: boolean }
```

`TaskSummary`: required fields from `taskSummaryForClient` (§2.6).

### 5.2 `GET /api/v1/tasks/{id}`

Response schema: `knowtation.task_get/v0`:

```yaml
TaskGetResponse:
  type: object
  required: [schema, vault_id, effective_scope, task]
  properties:
    schema:          { type: string, enum: [knowtation.task_get/v0] }
    vault_id:        { type: string }
    effective_scope: { type: string, enum: [personal, project, org] }
    task:            { $ref: '#/components/schemas/TaskRecord' }
```

Errors: `400 BAD_REQUEST | TASK_SCOPE_AMBIGUOUS`, `403 TASK_SCOPE_DENIED`, `404 unknown_task`.

---

## 6. Scooling consumer mapping (for later live wire — not 2G-b Knowtation scope)

When Scooling flips `TASK_LIVE_READ_AUTHORIZED` (Tier 3), `taskLiveWire` maps Hub JSON → adapter
types:

| Hub (snake_case) | Scooling (camelCase) |
| --- | --- |
| `task_id` | `taskId` |
| `workspace_id` | `workspaceId` |
| `due_at` | `dueAt` |
| `run_ref` | `runRef` |
| `assignee_ref` | `assigneeRef` |
| `assigner_ref` | `assignerRef` |
| `artifact_links` | `artifactLinks` |
| `effective_scope` | `effectiveScope` |

Scooling adds `schema: scooling.task/v0`, `contractVersion`, `mode: live`, `untrustedTitle: true`.
That flip is **out of scope** for Knowtation 2G-b.

---

## 7. Scope enforcement (server-side, deny-by-default)

Reuse `docs/FLOW-STORE-CONTRACT-7A-10.md` §4 rules verbatim with task-specific error codes:

| Rule | Error |
| --- | --- |
| Absent/ambiguous scope | `400 TASK_SCOPE_AMBIGUOUS` |
| Unauthorized tier | `403 TASK_SCOPE_DENIED` |
| Missing/invisible task | `404 unknown_task` (no existence leak) |
| Client `scope=org` under personal auth | Does not widen — param narrows only |

**Scope test fixture:** four starters span tiers — `personal` caller sees 1 task; `admin` sees all 4.

---

## 8. Fail-closed rules

1. **Read-only v0** — no POST/PATCH/DELETE on tasks; writes refuse until Tier 3 proposals path.
2. **Titles untrusted** — returned verbatim; never executed or interpreted server-side.
3. **Artifact links = pointers only** — no note bodies, media bytes, or review payloads.
4. **Content-minimization** — list never returns `artifact_links` or assignee refs.
5. **Identity hygiene** — assignee/assigner are hashed or opaque refs only; no PII fields on record.
6. **SD-2 integrity** — seed + data-integrity tier assert reciprocal link on anchor pair.
7. **Robust load** — missing/malformed store ⇒ empty vault; writes atomic via flow-store primitives.

---

## 9. Seven-tier test matrix (2G-b Auto)

Files: `test/task-store-*.test.mjs`, `test/task-list-get-parity-*.test.mjs`. **No network in unit
tests.**

### 1. unit — `test/task-store-unit.test.mjs`

- `TASK_ID_RE` / artifact ref regexes accept canonical ids, reject malformed.
- `taskSummaryForClient` drops assignee/artifact_links; `taskForClient` caps artifact links.
- `seedStarterTasks` validates good bundle; rejects schema-invalid bundle without partial write.
- Vault load defaults `tasks: []` when key absent (backward compat).

### 2. integration — `test/task-list-get-parity-integration.test.mjs`

- CLI `task list|get` JSON, MCP `task_list|task_get`, and Hub handler payload **deep-equal** for
  same `visibleScopes`.
- Scope filter identical across surfaces.
- Seeding idempotent across repeated `listTasks`.

### 3. e2e — `test/task-store-e2e.test.mjs`

- Empty vault → first `task list` seeds four starters → `task get task_2g_handover_001` returns
  full record with two artifact links → `task list --scope personal` returns exactly one task.

### 4. stress — `test/task-store-stress.test.mjs`

- Vault with `MAX_TASK_SUMMARIES` tasks; list correct, `truncated:true` when capped.

### 5. data-integrity — `test/task-store-data-integrity.test.mjs`

- **I-T-SD2-01 (cross-repo):** `getTask(task_2g_handover_001).run_ref === run_overseer_in_progress`
  AND seeded run `task_ref === task_2g_handover_001`.
- Round-trip starter JSON through seed → get with no field loss.
- `artifact_links` remain pointer-only (no body fields).

### 6. performance — `test/task-store-performance.test.mjs`

- `listTasks` / `getTask` p95 budget on 500-task fixture; O(n) filter, no quadratic blowup.

### 7. security — `test/task-store-security.test.mjs`

- Personal scope never returns `project`/`org` tasks.
- `getTask` for out-of-scope id ⇒ `null` ⇒ `404 unknown_task` (same as missing).
- Malicious `title` returned as inert data; scope unchanged.
- `JSON.stringify` of list/get contains no `token`/`oauth`/raw-content markers.

---

## 10. Hosted smoke checklist (2G-b deliverable)

Script: `scripts/verify-hosted-task-read-smoke.mjs` (self-hosted Hub; mirrors delegation smoke
pattern).

**Prerequisites:**

- Self-hosted Hub running with JWT auth (`hub/server.mjs`)
- Vault with viewer+ role; `config.data_dir` writable
- Optional: `hub_flow_workspace_scope.json` grants for scope tests

**Steps (operator checklist):**

| # | Step | Pass criterion |
| --- | --- | --- |
| 1 | `GET /api/v1/tasks` with `Authorization: Bearer <jwt>`, `X-Vault-Id: <vault>` | `200`, `schema: knowtation.task_list/v0`, `tasks.length >= 1` after lazy seed |
| 2 | `GET /api/v1/tasks/task_2g_handover_001` | `200`, `task.run_ref === run_overseer_in_progress`, two artifact_links |
| 3 | `GET /api/v1/tasks?scope=personal` under personal-only role | Returns only `task_personal_practice`; no project/org tasks |
| 4 | `GET /api/v1/tasks/task_org_compliance_q2` under personal-only role | `404 unknown_task` (not 403 — no existence leak) |
| 5 | `GET /api/v1/flows/.../runs/run_overseer_in_progress` (existing run read) OR read `runs[]` from store | `task_ref === task_2g_handover_001` (SD-2 reciprocal) |
| 6 | CLI parity: `knowtation task list --json` | Deep-equal to step 1 JSON |
| 7 | Confirm **no write routes**: `POST /api/v1/tasks` | `404` or not mounted |

Env vars: `KNOWTATION_HUB_TOKEN`, `KNOWTATION_HUB_VAULT_ID`, `KNOWTATION_HUB_API` (default
`http://localhost:3000` for self-hosted).

---

## 11. Acceptance (2G-a)

- [x] Store shape (§1–§2), read-op contract, CLI/MCP/Hub route shapes, OpenAPI schemas, scope model,
      SD-2 seed plan, fail-closed rules, triple-surface parity invariant, seven-tier matrix, and
      hosted smoke checklist frozen here — **contract only**.
- [x] Ratified against `scooling/docs/TASK-ADAPTER-CONTRACT-2G.md`, SD-2, and
      `FLOW-STORE-CONTRACT-7A-10.md` Option A parity.
- [ ] 2G-b implements to this contract on `feat/phase-2g-task-store`.

## Non-goals (2G)

- Task create/update/assign/artifact-link (Tier 3 + proposals).
- Scooling `TASK_LIVE_READ_AUTHORIZED` flip (separate Tier 3 session).
- Hosted canister task index / gateway proxy.
- Calendar task-due overlay (Phase 2H-c — blocked until live read exists).
- Classroom teacher authority write paths (Phase 2C gates).

---

## 12. 2G-b implementation checklist (Auto — mechanical)

Branch: **`feat/phase-2g-task-store`** off Knowtation `main`.

| # | Artifact | Notes |
| --- | --- | --- |
| 1 | Extend `lib/flow/flow-store.mjs` vault shape | `tasks: []` default |
| 2 | `lib/task/task-store.mjs` | Read ops + seed + projections |
| 3 | `lib/task/task-handlers.mjs` | Shared handlers |
| 4 | `tasks/starter/*.json` | Four starter bundles |
| 5 | `hub/server.mjs` | `GET /api/v1/tasks`, `GET /api/v1/tasks/:id` |
| 6 | `cli/index.mjs` | `task list|get` subcommand |
| 7 | `mcp/tools/task.mjs` + dispatcher wire | `task_list`, `task_get` |
| 8 | `docs/openapi.yaml` | Tasks tag + schemas (same PR as routes) |
| 9 | Seven-tier tests | §9 file names |
| 10 | `scripts/verify-hosted-task-read-smoke.mjs` | §10 checklist automation |
| 11 | Muse + Git commit on feature branch | No push staging unless Tier 3 |

**Verification gate (2G-b):**

```bash
npm test -- test/task-store-*.test.mjs test/task-list-get-parity-*.test.mjs
node scripts/verify-hosted-task-read-smoke.mjs   # against local Hub
```

**Follow-on (not 2G-b):** Scooling live wire + `TASK_LIVE_READ_AUTHORIZED` Tier 3; Knowtation task
write proposals; Phase 2H-c calendar overlay.
