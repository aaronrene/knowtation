# Flow Store + List/Get Parity — Contract (Phase 7A, Step 7A-10a)

Status: **Implemented — step 7A-10b (Auto).** Store module, Hub routes, CLI/MCP wiring, OpenAPI block,
and seven-tier tests ship on branch **`feat/flow-projection-pilot`**. This document remains the
frozen contract reference; do not redesign it in follow-on steps.

Authored on branch **`feat/flow-projection-pilot`** (branched from `feat/flow-v0-spec`).

Related:

- `docs/FLOW-V0-SPEC.md` — the canonical spec this contract implements (§1 schemas, §2 Storage
  Option A, §3 API surfaces, §6 security checklist, §9 seven-tier plan).
- `lib/calendar/event-store.mjs` — the **Option A parity reference** (local file-backed, per-vault,
  atomic write, `*ForClient` projection, deny-by-default query filter). The Flow store mirrors its
  shape function-for-function where the concern is the same.
- `flows/starter/` — the six canonical seed Flows / 24 steps authored in 7A-3 (`flow_*.json`
  bundles) that the store seeds on first read.
- `docs/openapi.yaml` — where the Hub wire shapes in §6 land **in the same change as the routes**
  (7A-10b), per the no-docs-only-PR rule.
- `scooling/docs/FLOW-ADAPTERS-CONTRACT-7A-5.md` — the consumer read shape Scooling expects
  (`FlowSummary`, `FlowDefinitionView`, content-minimization, scope-denial codes). This contract is
  ratified against it so the Hub JSON the `FlowAdapter` will read at 7A-10b matches field-for-field.

**Scope fence (7A-10a):** Store API + list/get read contract + OpenAPI wire shapes + seven-tier test
matrix **only**. **No** `lib/flow/` implementation, **no** Hub routes, **no** CLI wiring, **no**
MCP tool wiring, **no** Scooling changes, **no** posture-constant flips. v0 read surface is
**list/get only** — `propose` / `project` / `run` are named here for parity completeness but are
**not** in 7A-10's read scope (propose/project = 7A-10b+ / 7A-11; run = gated 7A-L3).

---

## Simple summary

A **Flow** is a saved procedure (an ordered checklist with proof-of-done). Knowtation is the one
place Flows live. This document is the blueprint for the **filing cabinet** that holds them (the
store) and the two **read doors** every surface uses to look inside: *list* (give me the titles of
the Flows I'm allowed to see) and *get* (give me one whole Flow with its steps). The blueprint
guarantees three things. First, the command line, the MCP plug-in, and the Hub website all return
**the exact same answer** — change a Flow once and every door shows the change, with no copying.
Second, you only ever see Flows you're **allowed** to see; the server decides that, never the
client, and the default is "see nothing extra." Third, the list view is **trimmed** (titles and
counts, never the full step text), and **no secret, token, or private content** is ever in any
answer. The store is modeled on the calendar store that already works this way, so it inherits a
proven, safe shape.

## Technical summary

A local file-backed, per-vault **Flow index store** (`lib/flow/flow-store.mjs`) that mirrors
`lib/calendar/event-store.mjs` Option A: structured records in a JSON index (primary, query/scope
source of truth) plus an **optional** vault Markdown mirror (`type: flow`, derived from the index,
never the reverse). v0 exposes **read-only** `listFlows` (content-minimized summaries, scope/tag
filtered) and `getFlow` (full definition + ordered steps) over **three identical surfaces** — CLI
(`knowtation flow list` / `flow get`), MCP (`flow_list` / `flow_get`), and Hub REST
(`GET /api/v1/flows`, `GET /api/v1/flows/{id}`) — returning **byte-identical JSON** for the same
authorized request. Scope is **authorization, enforced server-side, deny-by-default**
(`WorkspaceScopeAdapter` + retrieval policy); the client never supplies its own visible tier. Step
text is **untrusted input**; list views are **truncated**; evidence/provenance and `requires` /
`skill_refs` are **pointers/handles only** — no secrets, tokens, or raw content in any response. The
store seeds the six 7A-3 starter bundles from `flows/starter/` on first read (idempotent). All seven
test tiers are specified for the store and for list/get parity.

---

## 1. Store module shape — `lib/flow/flow-store.mjs` (Option A, calendar parity)

The Flow store is a **pure, local, file-backed module** with no network and no Express coupling —
exactly like `event-store.mjs`. Routes/CLI/MCP call it; it never calls them. The function table
below pins names, parameters, and return shapes for 7A-10b.

### 1.1 Constants and on-disk layout

| Constant | Value | Parity note |
| --- | --- | --- |
| `FLOW_STORE_FILENAME` | `'hub_flow_store.json'` | mirrors `STORE_FILENAME = 'hub_calendar_store.json'` |
| `STARTER_FLOWS_DIRNAME` | `'flows/starter'` (repo-relative; resolvable override for tests) | seed source (7A-3 bundles) |
| `MAX_FLOW_SUMMARIES` | `200` | list cap; sets `truncated` when exceeded |
| `MAX_STEPS_PER_FLOW` | `100` | get cap; rejects/marks over-long step lists |

On-disk shape (one file under `data_dir`, keyed by vault, mirroring the calendar store):

```jsonc
{
  "vaults": {
    "<vault_id>": {
      "flows":        [ /* knowtation.flow/v0 records */ ],
      "steps":        [ /* knowtation.flow_step/v0 records */ ],
      "runs":         [ /* knowtation.flow_run/v0 records (read-only in v0) */ ],
      "candidates":   [ /* knowtation.flow_candidate/v0 records (inert in v0) */ ],
      "projections":  [ /* knowtation.flow_projection/v0 records (derived; 7A-11) */ ]
    }
  }
}
```

> The index is the **source of truth**. The optional vault Markdown mirror (spec §2.2) is a
> projection of the index, reconciled as a proposal if hand-edited — never silently promoted.

### 1.2 Persistence primitives (mirror `event-store.mjs` exactly)

| Function | Signature | Behaviour (parity target) |
| --- | --- | --- |
| `getFlowStorePath` | `(dataDir) → string` | `path.join(dataDir, FLOW_STORE_FILENAME)` |
| `loadFlowStore` | `(dataDir) → FlowStoreFile` | read+parse; **never throws** — malformed/missing ⇒ `{ vaults: {} }` |
| `saveFlowStore` | `(dataDir, store) → void` | `mkdir -p`, write to `*.<pid>.<uuid>.tmp`, `renameSync` (atomic), 2-space JSON |
| `getVaultFlowStore` | `(dataDir, vaultId) → VaultFlowStore` | lazily creates an empty `{flows,steps,runs,candidates,projections}` |

### 1.3 Id + version helpers (pin §1.2 of the spec)

| Export | Value / signature | Source |
| --- | --- | --- |
| `FLOW_ID_RE` | `/^flow_[a-z0-9_]{1,64}$/` | spec §1.2 |
| `FLOW_STEP_ID_RE` | `/^flow_[a-z0-9_]{1,64}#[1-9][0-9]*$/` | `<flow_id>#<ordinal>` |
| `FLOW_RUN_ID_RE` | `/^run_[a-z0-9_]{1,48}$/` | spec §1.2 |
| `SEMVER_RE` | strict `MAJOR.MINOR.PATCH` | `flow.version` |
| `buildFlowStepId` | `(flowId, ordinal) → string` | `` `${flowId}#${ordinal}` `` (parity with `buildEventId`) |

### 1.4 Seeding from `flows/starter/` (idempotent)

| Function | Signature | Behaviour |
| --- | --- | --- |
| `seedStarterFlows` | `(dataDir, vaultId, { starterDir? }) → { seeded: number, skipped: number }` | Load each `flows/starter/flow_*.json` bundle (`{ flow, steps }`), **validate against §1 schema**, and upsert by `(flow_id, version)`. Idempotent: re-running seeds nothing new (`skipped` counts already-present). A bundle that fails schema validation is **rejected and logged**, never partially written. |

Seeding is **read-time lazy** (first `listFlows`/`getFlow` on an empty vault triggers it) and is the
only write the v0 store performs — it materializes **canonical, user-owned seeds**, not user data,
and routes no proposal (the seeds ship with the repo). All later durable writes route through
proposals (review-before-write); the store exposes **no** public create/update/delete in v0.

### 1.5 Read operations (the v0 surface)

| Function | Signature | Returns | Rules |
| --- | --- | --- | --- |
| `listFlows` | `(dataDir, vaultId, { visibleScopes, scope?, tags?, limit? }) → FlowListResult` | `{ flows: FlowSummary[], effective_scope, truncated }` | content-minimized; deny-by-default scope filter (§4); `limit` capped at `MAX_FLOW_SUMMARIES`; `truncated:true` when capped or when more than `limit` match |
| `getFlow` | `(dataDir, vaultId, flowId, { visibleScopes, version? }) → FlowDefinitionResult \| null` | `{ flow: Flow, steps: FlowStep[] }` or `null` when not found/not visible | `flowId` must match `FLOW_ID_RE`; resolve **latest** version within visible scope unless `version` pins one; steps returned in **ascending `ordinal`** order; capped at `MAX_STEPS_PER_FLOW` |

`visibleScopes` is a **server-resolved** `Set<Scope>` passed in by the route/CLI/MCP after scope
resolution (§4). The store **never** trusts a client-supplied tier; an absent `visibleScopes`
resolves to `{ 'personal' }` (lowest). `getFlow` returns `null` (mapped to `404 unknown_flow`) for
both genuinely-missing and **scope-invisible** flows so existence is never leaked across scope.

### 1.6 Client projections (`*ForClient` — calendar parity)

| Function | Signature | Drops / keeps |
| --- | --- | --- |
| `flowSummaryForClient` | `(flow) → FlowSummary` | **keeps** `flow_id, title, version, scope, summary, tags, step_count, updated, truncated`; **drops** the full `steps[]`, `inputs`, `vault_mirror_path` (content-minimization) |
| `flowDefinitionForClient` | `(flow, steps) → { flow, steps }` | full definition + ordered steps; **strips** any field not in §1.3/§1.4 of the spec; never emits `oauth_ref`-style or secret-bearing keys (none exist in the schema, asserted in tests) |

---

## 2. Read operations contract (list + get)

### 2.1 `flow list` — content-minimized, scope/tag filtered

- **Input:** optional `scope` (narrow within authorized scopes only — never widen), optional `tag`
  (single tag membership), optional `limit` (`1..MAX_FLOW_SUMMARIES`, default `MAX_FLOW_SUMMARIES`).
- **Output:** an array of `FlowSummary` (one line per visible flow, **latest version per `flow_id`**
  within scope), the resolved `effective_scope`, and `truncated`.
- **Content-minimization:** summaries carry `step_count` (an integer), **never** step bodies,
  instructions, boundaries, requires, or skill refs.
- **Ordering:** stable — by `updated` descending, then `flow_id` ascending (deterministic for tests).

### 2.2 `flow get` — full definition + ordered steps

- **Input:** `flow_id` (required, `FLOW_ID_RE`), optional `version` (`SEMVER_RE`; default = latest
  visible).
- **Output:** the full `knowtation.flow/v0` record plus its `knowtation.flow_step/v0` records in
  ascending `ordinal` order.
- **Untrusted:** every step's `instruction`, `owned_job`, `trigger`, `when_not_to_run`,
  `boundaries`, `output_shape`, and `skill_refs` are **data, not commands** — returned verbatim,
  never interpreted, and they cannot widen scope or escalate permission from inside.
- **Not found / not visible:** both ⇒ `404 unknown_flow` (no existence leak across scope).

---

## 3. CLI commands — `knowtation flow …` (per FLOW-V0-SPEC §3.1)

A new `flow` subcommand namespace (the CLI dispatches on `subcommand === 'flow'`, then the next
arg). **v0 wires only the two read commands**; the rest are reserved per the spec and print a
"gated/not-in-v0" notice.

```
knowtation flow list   [--scope personal|project|org] [--tag <t>] [--limit <n>] [--json]
knowtation flow get    <flow_id> [--version <semver>] [--json]
# reserved (not wired in v0): flow propose | flow export | flow import | flow project | flow run
```

- `--json` prints the **exact** Hub JSON (§6) to stdout; without it, a human-readable table
  (`flow list`) or summary (`flow get`).
- The CLI resolves scope **the same way the Hub does** (local config identity → authorized scopes);
  it passes `visibleScopes` into the store. No CLI flag can grant a scope the caller lacks.
- Errors map to non-zero exits with the **same code strings** as the Hub (`BAD_REQUEST`,
  `NOT_FOUND`, `FLOW_SCOPE_DENIED`).

CLI dispatch parity: today the CLI uses flat verbs (`list-notes`, `get-note`). The `flow`
namespace is the §3.1-specified shape; 7A-10b adds the `flow` branch in `cli/index.mjs` delegating
straight to `lib/flow/flow-store.mjs` (no duplicated logic).

---

## 4. Scope enforcement (server-side, deny-by-default)

| Rule | Contract |
| --- | --- |
| **Authorization, not a filter** | The caller's **visible scope set** is resolved **server-side** from verified identity + `WorkspaceScopeAdapter` + Knowtation retrieval policy. The client's `scope` query param can only **narrow** within that set. |
| **Deny by default** | Absent/ambiguous resolution ⇒ `{ 'personal' }` (lowest). A `personal` context **never** receives `project`/`org` flows. |
| **No existence leak** | A flow outside the visible scope is indistinguishable from a missing one (`getFlow` ⇒ `null` ⇒ `404 unknown_flow`). |
| **Error codes** | unauthorized tier ⇒ `403 FLOW_SCOPE_DENIED`; ambiguous scope ⇒ `400 FLOW_SCOPE_AMBIGUOUS` (mirrors the consumer's `flow_scope_denied` / `flow_scope_ambiguous`). |
| **Vault binding** | `X-Vault-Id` + role required on the Hub (`requireVaultAccess` + `requireRole('viewer'…)`), parity with the calendar routes; the CLI binds the locally-configured vault. |

The starter set spans scopes on purpose: four `personal` Flows + two `project` Flows
(`flow_multi_repo_change`, `flow_overseer_handover`). The scope test fixtures use exactly this set
so a `personal` context proves it sees four and **never** the two `project` Flows.

---

## 5. Starter Flow seed (from `flows/starter/`)

- The six 7A-3 bundles (`flow_capture_to_note`, `flow_research_brief`, `flow_reviewed_writeback`,
  `flow_session_to_flow`, `flow_multi_repo_change`, `flow_overseer_handover`) are the canonical
  **seed definitions**. `seedStarterFlows` validates each against §1 of the spec and upserts by
  `(flow_id, version)`.
- Seeding is **idempotent** and **read-time lazy**; it writes only canonical seeds, never user data,
  and routes no proposal.
- A bundle failing schema validation (e.g. a step missing `trigger`/`verification` — the
  "anatomy-completeness" rule) is **rejected wholesale and logged**; the store is never left
  partially seeded.

---

## 6. OpenAPI wire shapes (to land in `docs/openapi.yaml` **with the routes** in 7A-10b)

Specified here, **added to `docs/openapi.yaml` in the same change as the routes** (no docs-only PR
to `main`). New tag: `Flows`. Both routes are `BearerAuth` + `X-Vault-Id` + `requireRole(viewer…)`.

### 6.1 `GET /api/v1/flows` — list (scope/tag filtered, content-minimized)

Query params: `scope` (enum `personal|project|org`, optional — narrows only), `tag` (string,
optional), `limit` (integer `1..200`, optional).

```yaml
/api/v1/flows:
  get:
    tags: [Flows]
    summary: List scope-visible flows (content-minimized)
    parameters:
      - { name: scope, in: query, schema: { type: string, enum: [personal, project, org] } }
      - { name: tag,   in: query, schema: { type: string } }
      - { name: limit, in: query, schema: { type: integer, minimum: 1, maximum: 200 } }
    responses:
      '200': { content: { application/json: { schema: { $ref: '#/components/schemas/FlowListResponse' } } } }
      '400': { content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }  # BAD_REQUEST | FLOW_SCOPE_AMBIGUOUS
      '401': { content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
      '403': { content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }  # FLOW_SCOPE_DENIED
```

### 6.2 `GET /api/v1/flows/{id}` — full definition + ordered steps

Path param `id` (`FLOW_ID_RE`); query param `version` (`SEMVER_RE`, optional — default latest).

```yaml
/api/v1/flows/{id}:
  get:
    tags: [Flows]
    summary: Get one flow definition + ordered steps
    parameters:
      - { name: id,      in: path,  required: true, schema: { type: string } }
      - { name: version, in: query, schema: { type: string } }
    responses:
      '200': { content: { application/json: { schema: { $ref: '#/components/schemas/FlowGetResponse' } } } }
      '400': { content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
      '401': { content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
      '403': { content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }  # FLOW_SCOPE_DENIED
      '404': { content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }  # unknown_flow (missing OR scope-invisible)
```

### 6.3 Component schemas

```yaml
components:
  schemas:
    FlowListResponse:
      type: object
      required: [schema, vault_id, effective_scope, flows, truncated]
      properties:
        schema:          { type: string, enum: [knowtation.flow_list/v0] }
        vault_id:        { type: string }
        effective_scope: { type: string, enum: [personal, project, org] }
        flows:
          type: array
          maxItems: 200
          items: { $ref: '#/components/schemas/FlowSummary' }
        truncated:       { type: boolean }

    FlowSummary:           # content-minimized — NO step bodies
      type: object
      required: [schema, flow_id, title, version, scope, summary, tags, step_count, updated, truncated]
      properties:
        schema:     { type: string, enum: [knowtation.flow/v0] }
        flow_id:    { type: string }
        title:      { type: string }
        version:    { type: string }
        scope:      { type: string, enum: [personal, project, org] }
        summary:    { type: string }
        tags:       { type: array, maxItems: 32, items: { type: string } }
        step_count: { type: integer, minimum: 0 }
        updated:    { type: string }
        truncated:  { type: boolean }

    FlowGetResponse:
      type: object
      required: [schema, vault_id, flow, steps]
      properties:
        schema:   { type: string, enum: [knowtation.flow_get/v0] }
        vault_id: { type: string }
        flow:     { $ref: '#/components/schemas/Flow' }
        steps:
          type: array
          maxItems: 100
          items: { $ref: '#/components/schemas/FlowStep' }

    Flow:                  # knowtation.flow/v0 — full (spec §1.3)
      type: object
      required: [schema, flow_id, title, version, scope, summary, steps, updated, truncated]
      properties:
        schema:            { type: string, enum: [knowtation.flow/v0] }
        flow_id:           { type: string }
        title:             { type: string }
        version:           { type: string }
        scope:             { type: string, enum: [personal, project, org] }
        summary:           { type: string }
        tags:              { type: array, maxItems: 32, items: { type: string } }
        steps:             { type: array, maxItems: 100, items: { type: string } }   # ordered step ids
        inputs:
          type: array
          items:
            type: object
            required: [name, type, required]
            properties:
              name:     { type: string }
              type:     { type: string }
              required: { type: boolean }
        vault_mirror_path: { type: string, nullable: true }
        updated:           { type: string }
        truncated:         { type: boolean }

    FlowStep:              # knowtation.flow_step/v0 — full (spec §1.4); all text is UNTRUSTED
      type: object
      required: [schema, step_id, flow_id, ordinal, owned_job, instruction, trigger, when_not_to_run, boundaries, output_shape, verification, automatable]
      properties:
        schema:         { type: string, enum: [knowtation.flow_step/v0] }
        step_id:        { type: string }
        flow_id:        { type: string }
        ordinal:        { type: integer, minimum: 1 }
        owned_job:      { type: string }
        instruction:    { type: string }
        trigger:        { type: string }
        when_not_to_run:{ type: string }
        requires:
          type: array
          items:
            type: object
            required: [kind, id]
            properties:
              kind: { type: string, enum: [vault_scope, tool, file, artifact] }
              id:   { type: string }              # handle/pointer only — never an inline secret
        boundaries:     { type: array, items: { type: string } }
        skill_refs:
          type: array
          items:
            type: object
            required: [kind, id]
            properties:
              kind: { type: string, enum: [mcp_prompt, skill_pack, cli, external_tool] }
              id:   { type: string }              # opaque id only
        inputs:
          type: array
          items:
            type: object
            required: [name, from]
            properties: { name: { type: string }, from: { type: string } }
        outputs:
          type: array
          items:
            type: object
            required: [name, type]
            properties: { name: { type: string }, type: { type: string } }
        output_shape:   { type: string }
        verification:
          type: object
          required: [kind, evidence_required, description]
          properties:
            kind:              { type: string, enum: [human_review, artifact_exists, value_match, test_pass, agent_check] }
            evidence_required: { type: boolean }
            description:       { type: string }
        automatable:    { type: string, enum: [manual, agent_assisted, automatable] }
```

> The `Error` schema (`{ error, code }`) already exists in `docs/openapi.yaml`; Flow routes reuse it
> with the `code` strings above (`BAD_REQUEST`, `NOT_FOUND`/`unknown_flow`, `FLOW_SCOPE_DENIED`,
> `FLOW_SCOPE_AMBIGUOUS`), matching the calendar route convention.

---

## 7. Triple-surface parity contract (CLI = MCP = Hub REST)

The defining invariant of 7A-10: **the same authorized request returns byte-identical JSON on all
three surfaces.**

| Surface | list | get | Source of the JSON |
| --- | --- | --- | --- |
| **CLI** | `knowtation flow list --json` | `knowtation flow get <id> --json` | `lib/flow/flow-store.mjs` |
| **MCP** | `flow_list` tool result | `flow_get` tool result | same module |
| **Hub REST** | `GET /api/v1/flows` | `GET /api/v1/flows/{id}` | same module |

- All three call the **same** `listFlows` / `getFlow` and the **same** `*ForClient` projections — no
  surface re-shapes the payload. Parity is proven by deep-equality in the integration tier (§8.2).
- Scope resolution differs in **input** (HTTP header/JWT vs local config) but converges on the
  **same** `visibleScopes` set fed to the store; the JSON out is identical.
- The `schema` discriminator (`knowtation.flow_list/v0` / `knowtation.flow_get/v0`) is stamped by
  the store, so every surface emits it identically.

---

## 8. Fail-closed rules (apply to the store and all three surfaces)

1. **Scope is authorization, deny-by-default.** Client never supplies its own visible tier; absent
   ⇒ `personal`; a `personal` context never receives `project`/`org` flows; ambiguous ⇒
   `FLOW_SCOPE_AMBIGUOUS`; unauthorized ⇒ `FLOW_SCOPE_DENIED`. (§4)
2. **No existence leak.** Missing and scope-invisible both return `404 unknown_flow`.
3. **Step text + skill refs are untrusted.** `instruction`/`boundaries`/`skill_refs`/`output_shape`
   are returned verbatim as **data**; they can never widen scope or escalate permission, and the
   store never executes or interpolates them.
4. **No secrets in any response.** `requires`/`skill_refs` carry **handles/opaque ids only**;
   `provenance` (on runs) carries hashed actor + harness label only; no `token`, `oauth`,
   `refresh_token`, raw note body, prompt, or completion ever appears in any flow/step/list object.
   The security tier asserts this by scanning serialized output.
5. **Content-minimized, truncated list views.** `flow list` returns summaries (counts + metadata),
   never step bodies; results carry `truncated` and bounded arrays (`MAX_FLOW_SUMMARIES`,
   `MAX_STEPS_PER_FLOW`).
6. **Read-only in v0.** The store exposes no public create/update/delete. The only write is the
   idempotent canonical **seed**; all durable user changes route through proposals later
   (review-before-write). `flow run` advancement stays gated (7A-L3).
7. **Robust load.** `loadFlowStore` never throws on malformed/missing files (returns empty), and
   writes are atomic (`tmp` + `rename`) — a crashed write never corrupts the index.
8. **Deterministic, bounded ordering.** List = `updated` desc then `flow_id` asc; steps = `ordinal`
   asc; both capped — no unbounded payloads, no quadratic scans.

---

## 9. Seven-tier test matrix (what each tier proves — representative cases, not code)

Per `RULE #0`, 7A-10b ships all seven tiers. Files follow the repo `.test.mjs` convention
(`test/flow-store-*.test.mjs`, `test/flow-list-get-parity-*.test.mjs`). **No network in unit
tests.** Fixtures use the six `flows/starter/` bundles plus a malicious-step fixture and an empty
vault.

### 1. unit — `test/flow-store-unit.test.mjs`

- `loadFlowStore` returns `{ vaults: {} }` for missing **and** malformed files (never throws).
- `saveFlowStore` writes atomically (tmp + rename) and round-trips a vault store.
- Id/version regexes accept canonical ids and reject malformed (`FLOW_ID_RE`, `FLOW_STEP_ID_RE`,
  `FLOW_RUN_ID_RE`, `SEMVER_RE`); `buildFlowStepId` composes `<flow_id>#<ordinal>`.
- `flowSummaryForClient` drops step bodies/inputs/mirror path and keeps the nine summary fields;
  `flowDefinitionForClient` emits only spec-§1 fields.
- `seedStarterFlows` validates a good bundle and **rejects** an anatomy-incomplete one (missing
  `trigger`/`verification`) without partial write.
- `listFlows`/`getFlow` stamp the `schema` discriminator; `getFlow` orders steps by `ordinal`.

### 2. integration — `test/flow-list-get-parity-integration.test.mjs`

- **Parity:** CLI `flow list`/`flow get` JSON, MCP `flow_list`/`flow_get` result, and the Hub
  route handler payload are **deep-equal** for the same authorized request (same `visibleScopes`).
- Scope filter applied identically across all three for `list` and `get`.
- `getFlow` step ids match the `flow.steps[]` order; `step_count` in the summary equals
  `steps.length` from `get`.
- Seeding is idempotent across repeated `listFlows` calls (no duplicate `flow_id`/version).

### 3. e2e — `test/flow-store-e2e.test.mjs`

- Empty vault → first `flow list` seeds the six starters → `flow get flow_overseer_handover`
  returns six ordered steps with `human_review` + `artifact_exists` verification kinds intact →
  `flow list --scope personal` returns exactly the four personal flows.
- A pinned `--version` returns that version; absent returns latest.

### 4. stress — `test/flow-store-stress.test.mjs`

- Seed/load a vault with up to `MAX_FLOW_SUMMARIES` flows and `MAX_STEPS_PER_FLOW`-step flows;
  `list`/`get` stay correct and set `truncated` when capped. Deep `step_states` on read-only runs
  do not slow `get`.

### 5. data-integrity — `test/flow-store-data-integrity.test.mjs`

- Round-trip a starter bundle through `seed → getFlow` with **no field loss/mutation**: steps keep
  `ordinal` order; `requires`/`skill_refs`/`verification`/`scope`/`version` survive byte-for-byte.
- `done`+`evidence_required` run step states never appear with `verified:false` (read invariant).
- The optional vault mirror, when present, is never treated as the source (index wins).

### 6. performance — `test/flow-store-performance.test.mjs`

- `listFlows` (scope-filtered) and `getFlow` complete within a p95 budget on the large fixture; no
  quadratic blowups in scope/tag filtering or step ordering; load is O(file size).

### 7. security — `test/flow-store-security.test.mjs`

- **Scope denial:** a `personal` `visibleScopes` never returns the two `project` flows; ambiguous
  scope fails closed (`FLOW_SCOPE_AMBIGUOUS`); unauthorized tier ⇒ `FLOW_SCOPE_DENIED`.
- **No existence leak:** `getFlow` for a `project` flow under a `personal` scope returns `null` ⇒
  `404 unknown_flow`, identical to a truly-missing id.
- **Injection:** a malicious `instruction`/`boundaries` fixture is returned verbatim as inert data
  and never alters scope/permission or gets interpreted.
- **No secrets:** `JSON.stringify` of every `list`/`get` result contains no `token`/`oauth`/
  `refresh_token`/raw-content markers; `requires`/`skill_refs` are handles only.
- **Client cannot widen scope:** a `scope=org` query param under `personal` authorization does not
  return org flows (param narrows only).

---

## 10. Acceptance (7A-10a)

- Store module shape (`lib/flow/flow-store.mjs`), read-op contract (`listFlows`/`getFlow`), CLI
  command shape, Hub route shapes, OpenAPI wire schemas, scope-enforcement model, starter-seed
  behaviour, fail-closed rules, the triple-surface parity invariant, and the seven-tier test matrix
  are all frozen here — **contract only, no implementation.**
- Ratified against `FLOW-V0-SPEC.md` §1–§3/§6/§9 and against the consumer shape in
  `scooling/docs/FLOW-ADAPTERS-CONTRACT-7A-5.md` (FlowSummary / FlowDefinitionView /
  content-minimization / scope-denial codes).
- Muse-committed on `feat/flow-projection-pilot`; handover regenerated to point at **7A-10b** (Auto:
  store + routes + CLI + OpenAPI + seven-tier impl to this contract).

## Non-goals (7A-10)

- No `propose` / `export` / `import` / `project` read or write paths (named for parity; impl later).
- No run advancement (`flow run`) — gated 7A-L3.
- No live capture / candidate detection — inert (7A-L4).
- No Scooling changes and no posture-constant flips; `FLOW_LIVE_READ_AUTHORIZED` stays `false` in
  Scooling until the 7A-10b Hub `GET /flows` ships and is wired.

---

## Handoff notes (for the next step, 7A-11 — Thinking)

1. Branch is **`feat/flow-projection-pilot`**; 7A-10b is Muse-committed (store + routes + CLI + MCP +
   OpenAPI + seven tiers). Always target Knowtation with `muse -C ~/knowtation …`.
2. **7A-11a (Thinking)** — design the projection generator + fidelity report contract per
   `docs/FLOW-V0-SPEC.md` §4 (`knowtation.flow_projection/v0`, harness targets, staleness/drift).
3. Hub `GET /api/v1/flows` + `GET /api/v1/flows/{id}` are live on self-hosted Hub; Scooling
   `FLOW_LIVE_READ_AUTHORIZED` flip is a **separate, later Scooling step** (not part of 7A-10b).
4. Parity gate: `test/flow-list-get-parity-integration.test.mjs` — CLI = MCP = Hub handler
   deep-equality for the same authorized request.
