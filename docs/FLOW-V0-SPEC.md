# Flow v0 — Canonical Spec (Knowtation)

Status: **DRAFT for acceptance — step 7A-2.** Authored on branch **`feat/flow-v0-spec`** (Thinking).
This is the **canonical** spec for the Flow procedure layer: schemas, storage, API contract, projection
generator, capture flywheel, defaults, seven-tier test plan, and the signed-off security/privacy
checklist. The Scooling-side architecture/consumer doc is `scooling/docs/FLOW-PLATFORM-ARCHITECTURE.md`
and the five wire schemas here are ratified against its **§ Wire schemas**.

> Cross-repo note: Flow is canonical in **Knowtation** (store, schemas, CLI/MCP/Hub APIs, projection
> generator). Scooling is a consumer. MuseHub enrichment (versioning/releases/provenance) is specified
> in `MUSE_HUB/musehub/docs/FLOW-ENRICHMENT-CONTRACT-7A-L5.md` (7A-L5a frozen; 7A-L5b impl). See
> `scooling/docs/CROSS-REPO-COORDINATION.md`.

**Scope fence for this step (7A-2):** spec only. No code, no routes, no live effects. Starter Flow
definitions = 7A-3; projection-generator implementation = 7A-10/7A-11; live authoring/capture/
automatable execution = gated 7A-L1..L5.

---

## Simple summary

A **Flow** is a saved, reusable **procedure** — an ordered checklist of steps that says *how* a job
gets done, what each step needs, and **how you know it is actually finished** (the proof, not just a
checkbox). Flows live in **one canonical place (Knowtation)**, the same way notes and the calendar
already do. The command line, the MCP plug-in, the Hub website, and Scooling all read and run the
*same* Flows — change one once and every surface sees the update, with no copying and no drift.

This document is the precise contract: the data shapes, where they are stored, the identical API on
all three surfaces, how a canonical Flow is projected into harness files (Cursor rules, `AGENTS.md`),
how repeated work is *proposed* (never auto-saved) as a new Flow, the safe defaults, and the proof
(tests + security sign-off) required before any of it is built.

## Technical summary

- **Canonical owner:** Knowtation (definitions, steps, verification contracts, run state, candidates,
  projections, scope policy). Scooling is a consumer/UI; never a second store.
- **Wire schemas (v0, open, versioned):** `knowtation.flow/v0`, `knowtation.flow_step/v0`,
  `knowtation.flow_run/v0`, `knowtation.flow_candidate/v0`, `knowtation.flow_projection/v0` — each
  carries a `schema` discriminator so clients detect capability without sniffing.
- **Step model:** v0 is an **ordered list, not a DAG.** Branching/parallel steps are deferred.
- **Storage:** **Option A** (calendar parity) — structured records in the Hub/canister index (for
  scope/range/version queries) **plus** an optional vault Markdown mirror (`type: flow`) for
  portability/offline.
- **API parity:** identical read/list/run/propose/project contract on **CLI**, **MCP tools**, and
  **Hub REST**, mirroring `AGENT-INTEGRATION.md`. Scope is enforced **server-side**; deny by default.
- **Defaults:** scope `personal`; external/automatable effects **off**; v0 verification kinds
  `human_review` + `artifact_exists` active first (others reserved, parse-accepted, runtime-gated).

---

## 0. Purpose and scope

Flow is a **canonical, versioned, scoped procedure substrate** owned by Knowtation and exposed over
the existing three agent surfaces (CLI, MCP, Hub REST) plus a harness-projection layer. It mirrors
the calendar architecture: **canonical store + open wire schema + scoped retrieval + Scooling as
consumer.** Knowtation already holds *what you know* (notes, summaries, memory); Flow adds *how you
work* (procedure), so an agent never has to relearn a workflow each session.

**In scope for v0**

- Definitions, steps (full skill-primitive anatomy), runs, candidates, projections — as open schemas.
- Read / list / get / propose; export / import (bundle round-trip).
- One projection target as the dogfood proof (own repo guidance — `AGENTS.md` / `.cursor/rules` /
  `.cursorrules`).
- Scope enforcement (`personal | project | org`) server-side; review-before-write for durable changes.

**Out of scope for v0** (each a separate later gate)

- Live automatable step execution (7A-L3); hosted projection + external-agent bundles (7A-L2); live
  capture flywheel detection (7A-L4); MuseHub enrichment — step-level history, semver-typed change
  impact, releases, reviewed merge, provenance-anchored evidence, social discovery (7A-L5).
- DAG / branching / parallel steps (a later schema version).

---

## 1. Data model and wire schemas (ratified vs `FLOW-PLATFORM-ARCHITECTURE.md`)

All five shapes are open, versioned, and discriminated by a `schema` field. They are ratified
field-for-field against the architecture doc's **§ Wire schemas** `jsonc` blocks; differences below
are **pins** this spec adds (enums, id format, step-state shape), not divergences.

### 1.1 Pinned enums (v0)

| Enum | Field | Values (v0) | Notes |
| --- | --- | --- | --- |
| `Scope` | `flow.scope`, `run.scope`, `candidate.scope_hint` | `personal` \| `project` \| `org` | Aligns with `WorkspaceScopeAdapter`; default `personal` |
| `VerificationKind` | `flow_step.verification.kind` | `human_review` \| `artifact_exists` \| `value_match` \| `test_pass` \| `agent_check` | **Active in v0:** `human_review`, `artifact_exists`. Others parse-valid but runtime-gated (deny until their gate) |
| `Automatable` | `flow_step.automatable` | `manual` \| `agent_assisted` \| `automatable` | `automatable` is **inert** in v0 (execution gate 7A-L3) |
| `RunStatus` | `flow_run.status` | `pending` \| `in_progress` \| `blocked` \| `done` \| `abandoned` | |
| `StepStateStatus` | `flow_run.step_states[].status` | `pending` \| `in_progress` \| `blocked` \| `done` \| `skipped` | `done` requires `verified: true` when the step's contract sets `evidence_required` |
| `SkillRefKind` | `flow_step.skill_refs[].kind` | `mcp_prompt` \| `skill_pack` \| `cli` \| `external_tool` | `external_tool` is inert in v0 (external-agent gate 7A-L2) |
| `RequiresKind` | `flow_step.requires[].kind` | `vault_scope` \| `tool` \| `file` \| `artifact` | Pointers/handles only — never inline secrets |
| `TriggerSignal` | `flow_candidate.trigger_signal` | `repetition` \| `re_explanation` \| `repeated_correction` \| `review_debt` \| `session_extraction` | |
| `Confidence` | `flow_candidate.confidence` | `low` \| `medium` \| `high` | Suppress `low` unless explicitly requested |
| `CandidateStatus` | `flow_candidate.status` | `pending_review` \| `promoted` \| `rejected` \| `merged_into:<flow_id>` | |
| `Harness` | `flow_projection.harness` | `cursor_rule` \| `cursor_skill` \| `mcp_prompt` \| `cli_runbook` \| `agent_bundle` | |

### 1.2 Pinned id formats (v0)

| Object | `*_id` format | Example |
| --- | --- | --- |
| Flow | `flow_<slug>` — `slug` is `[a-z0-9_]{1,64}` | `flow_weekly_review` |
| Step | `<flow_id>#<ordinal>` — `ordinal` is a 1-based integer | `flow_weekly_review#1` |
| Run | `run_<token>` — `token` is `[a-z0-9_]{1,48}` | `run_2026w25` |
| Candidate | `cand_<token>` — `token` is `[a-z0-9]{4,32}` | `cand_7f3a` |

`flow.version` is **semver** (`MAJOR.MINOR.PATCH`); a `flow_run` pins `flow_version`; a
`flow_projection` carries the `flow_version` it was generated from (used for staleness).

### 1.3 `knowtation.flow/v0` — definition

| Field | Type | Req | Description |
| --- | --- | --- | --- |
| `schema` | const `knowtation.flow/v0` | yes | Discriminator |
| `flow_id` | string (`flow_<slug>`) | yes | Stable id |
| `title` | string | yes | Human title |
| `version` | semver | yes | Bump on step/contract change |
| `scope` | `Scope` | yes | `personal` default |
| `summary` | string | yes | One-line purpose |
| `tags` | string[] | no | Light taxonomy (tags-first, see §7) |
| `steps` | string[] (step ids) | yes | **Ordered** refs; v0 = list, not DAG |
| `inputs` | `{name, type, required}[]` | no | Flow-level inputs |
| `vault_mirror_path` | string | no | Optional Markdown mirror location |
| `updated` | ISO8601 | yes | Last change |
| `truncated` | boolean | yes | Content-minimization flag for retrieval |

### 1.4 `knowtation.flow_step/v0` — one step (full skill-primitive anatomy)

| Field | Type | Req | Description |
| --- | --- | --- | --- |
| `schema` | const `knowtation.flow_step/v0` | yes | |
| `step_id` | string (`<flow_id>#<n>`) | yes | |
| `flow_id` | string | yes | Parent |
| `ordinal` | int (1-based) | yes | Position in the ordered list |
| `owned_job` | string | yes | The one thing the step is responsible for |
| `instruction` | string | yes | Imperative step text (**untrusted input**) |
| `trigger` | string | yes | When to use |
| `when_not_to_run` | string | yes | Anti-trigger |
| `requires` | `{kind:RequiresKind, id}[]` | no | Required tools/files/scope (handles only) |
| `boundaries` | string[] | yes | Must-not-do |
| `skill_refs` | `{kind:SkillRefKind, id}[]` | no | Composed primitives (opaque ids) |
| `inputs` | `{name, from}[]` | no | Bound from `flow.inputs.*` or prior step outputs |
| `outputs` | `{name, type}[]` | no | Declared outputs |
| `output_shape` | string | yes | What "the result" looks like |
| `verification` | `{kind:VerificationKind, evidence_required:boolean, description}` | yes | Done = proven |
| `automatable` | `Automatable` | yes | `manual` default; `automatable` inert in v0 |

> **Anatomy completeness rule:** a record missing `trigger`, `when_not_to_run`, `output_shape`, or
> `verification` is a *doc*, not a Flow step, and MUST fail schema validation.

### 1.5 `knowtation.flow_run/v0` — execution instance (canonical run state)

| Field | Type | Req | Description |
| --- | --- | --- | --- |
| `schema` | const `knowtation.flow_run/v0` | yes | |
| `run_id` | string (`run_<token>`) | yes | |
| `flow_id` | string | yes | |
| `flow_version` | semver | yes | **Pinned**; in-flight runs finish on the pinned version |
| `scope` | `Scope` | yes | |
| `status` | `RunStatus` | yes | |
| `step_states` | `{step_id, status:StepStateStatus, evidence_ref?, verified:boolean}[]` | yes | Per-step progress |
| `started` | ISO8601 | yes | |
| `provenance` | `{actor, harness}` | yes | Hashed actor id + harness label only |

`evidence_ref` is a **pointer** (proposal id, run id, artifact id, hash) — never raw content.

### 1.6 `knowtation.flow_candidate/v0` — flywheel proposal (never an auto-Flow)

| Field | Type | Req | Description |
| --- | --- | --- | --- |
| `schema` | const `knowtation.flow_candidate/v0` | yes | |
| `candidate_id` | string (`cand_<token>`) | yes | |
| `suggested_title` | string | yes | Untrusted text |
| `scope_hint` | `Scope` | yes | Inferred; user confirms before promotion |
| `trigger_signal` | `TriggerSignal` | yes | Why it surfaced |
| `observed_count` | int | yes | e.g. recurred in N sessions |
| `evidence_refs` | string[] | yes | Pointers only — no raw content |
| `draft_steps` | string[] | no | Structural outline only (untrusted) |
| `confidence` | `Confidence` | yes | Suppress `low` unless asked |
| `status` | `CandidateStatus` | yes | |
| `provenance` | `{actor, harness}` | yes | Hashes/labels only |

### 1.7 `knowtation.flow_projection/v0` — derived, read-only harness rendering

| Field | Type | Req | Description |
| --- | --- | --- | --- |
| `schema` | const `knowtation.flow_projection/v0` | yes | |
| `flow_id` | string | yes | |
| `flow_version` | semver | yes | Projection is **stale** if it lags the source version |
| `harness` | `Harness` | yes | Target format |
| `rendered` | string | yes | Harness-specific text (no secrets) |
| `generated_from_canonical` | const `true` | yes | |
| `editable` | const `false` | yes | A hand-edited projection is drift, not a source |
| `fidelity` | `{dropped_fields: string[], notes?}` | no | What a weaker harness could not express (see §4) |

---

## 2. Storage

**Decision: Option A (calendar parity).** Primary = structured records in the Hub/canister index;
secondary = an **optional** vault Markdown mirror for portability/offline.

### 2.1 Index (primary)

| Concern | Decision |
| --- | --- |
| Index keys | `flow_id`, `scope`, `vault_id`, `version`, `tags`, `updated` |
| Query patterns | by scope, by tag, by id+version, "latest per flow_id within scope" |
| Records indexed | `flow`, `flow_step`, `flow_run`, `flow_candidate`, `flow_projection` (each by `flow_id`) |
| Scope enforcement | server-side via retrieval policy + `WorkspaceScopeAdapter`; deny by default |

### 2.2 Vault mirror (optional, `type: flow`)

When `vault_mirror_path` is set, a Markdown note mirrors the definition for export/offline. Frontmatter:

```yaml
---
type: flow
flow_id: flow_weekly_review
version: 1.4.0
scope: personal
tags: [review, weekly]
updated: 2026-06-20T00:00:00Z
canonical: hub        # the index is source of truth; the mirror is a projection of it
---
```

The mirror body is human-readable steps; it is **derived from the index**, never the reverse. A
hand-edited mirror is reconciled as a proposal (review-before-write), not silently promoted.

### 2.3 Retention / deletion

| Action | Effect |
| --- | --- |
| Deprecate a version | Mark non-latest; existing pinned runs/projections keep working |
| Delete a Flow | Tombstone the `flow_id`; runs retained as historical records (pointers only); projections invalidated |
| Delete the mirror note | Loses nothing — regenerable from the index |

---

## 3. API surfaces (triple-exposed, identical contract)

Same contract across CLI / MCP / Hub REST, mirroring `AGENT-INTEGRATION.md`. v0 ships
**read/list/get/propose/project + export/import**; **run advancement and live authoring are gated**
(7A-L1/L3). Scope is enforced server-side on every surface; `X-Vault-Id` + role required; deny by
default.

> Spec-only note for 7A-2: routes are **specified here**, not implemented. Per the no-docs-only-PR
> rule, the OpenAPI shapes in `docs/openapi.yaml` are added in the **same change as the routes**
> (step 7A-10), not in this spec step.

### 3.1 CLI

```
knowtation flow list   [--scope personal|project|org] [--tag <t>] [--json]
knowtation flow get    <flow_id> [--version <semver>] [--json]
knowtation flow propose <bundle.json>          # review-before-write
knowtation flow export <flow_id> [--out <path>]
knowtation flow import <bundle.json>            # scope-checked; fails closed
knowtation flow project <flow_id> --harness <harness> [--out <path>]
# gated (not v0): knowtation flow run <flow_id> ...   (execution gate 7A-L3)
```

### 3.2 MCP tools (role-gated)

| Tool | Purpose | v0 |
| --- | --- | --- |
| `flow_list` | List flows in scope | active (read) |
| `flow_get` | Get one flow + steps | active (read) |
| `flow_propose` | Propose a flow/edit (review tray) | active (proposal only) |
| `flow_project` | Render a projection for a harness | active (read/derive) |
| `flow_run` | Start/advance a run | **gated** (7A-L3) |

### 3.3 Hub REST

| Method + path | Purpose | v0 |
| --- | --- | --- |
| `GET /api/v1/flows` | List (scope/tag filters) | active |
| `GET /api/v1/flows/{id}` | Get definition + steps | active |
| `POST /api/v1/flows` | Propose new flow (review) | active (proposal) |
| `GET /api/v1/flows/{id}/projection?harness=` | Derived projection | active |
| `GET /api/v1/flows/{id}/runs` | List runs | active (read) |
| `POST /api/v1/flows/{id}/runs` | Start a run | **gated** (7A-L3) |

All durable changes route through Knowtation **proposals** (`intent`, `base_state_id`,
`external_ref`) — no new write path; no adapter writes canonical knowledge directly.

---

## 4. Projection generator (dogfood target)

A canonical Flow → harness artifact. Projections are **derived, read-only, regenerable**.

- **v0 dogfood target:** generate our **own** repo guidance — `AGENTS.md`, `.cursor/rules/*`,
  `.cursorrules` — as projections of canonical Flows. (Generator *implementation* is 7A-10/7A-11; this
  spec fixes the contract.)
- **Anti-drift demo (acceptance for the pilot):** edit canonical Flow → regenerate projection →
  `diff` shows no manual drift; deleting a projection loses nothing.
- **Fidelity report:** when a harness cannot express a field (e.g. anti-triggers), the projection's
  `fidelity.dropped_fields` records exactly what was dropped so the user knows.
- **Staleness:** a projection is stale when `flow_projection.flow_version` < the latest `flow.version`;
  surfaced via `FlowProjectionAdapter.projectionStaleness`.
- **Drift:** a hand-edited projection (`editable:false` violated) is detected as drift and never fed
  back as a write source.

---

## 5. The capture flywheel (inert-first)

Turns *repeated work* into a *reviewable candidate* — **never silently**. Detection produces a
`flow_candidate/v0` **proposal**; a human approves/edits/rejects; only on approval does a `flow/v0`
exist. **Detection is inert in v0** (live detection is gate 7A-L4); this spec fixes the contract +
thresholds.

### 5.1 Detection signals (observational, content-minimized)

| Signal (`trigger_signal`) | Observes | Suggests |
| --- | --- | --- |
| `repetition` | Same ordered step/skill-ref sequence across ≥ N sessions | A stable procedure is being re-derived |
| `re_explanation` | User re-types the same standing instruction | A missing captured procedure |
| `repeated_correction` | User corrects the agent the same way repeatedly | A missing boundary/anti-trigger |
| `review_debt` | A step type reaches "done" but fails human inspection | A missing verification contract |
| `session_extraction` | End-of-session opt-in check: "recurring, non-obvious procedure worth saving?" | Explicit capture moment (usually "no") |

Signals derive from session metadata + bounded structural patterns (ids, hashes, counts) — **never**
raw prompts, completions, or note bodies.

### 5.2 Recommended thresholds (v0 defaults; tunable)

| Knob | Default | Rationale |
| --- | --- | --- |
| `N` repetitions before surfacing | **3** | High bar; most sessions produce no candidate |
| Minimum confidence surfaced | **`medium`** | Suppress `low` unless explicitly asked |
| Per-session candidate cap | **2** | Prevent candidate spam / prompt-bloat-in-a-new-place |
| Dedup | merge into existing flow when ≥ 0.8 structural overlap | Offer "merge into" over "create parallel" |

### 5.3 Guardrails (must hold)

- **No silent promotion** — review-before-write is mandatory.
- **Privacy** — pointers/hashes/bounded enums only; scope inferred then user-confirmed, never widened.
- **Untrusted input** — candidate titles/draft steps are untrusted prompt content.
- **Opt-in** — end-of-session extraction is user-controlled; classroom/minor policy may disable capture.

---

## 6. Security and privacy checklist (signed off — 7A-2)

| # | Gate | Status | Notes |
| --- | --- | --- | --- |
| 1 | Scope is authorization, enforced server-side; deny by default | **Accepted** | `WorkspaceScopeAdapter` + Knowtation retrieval policy; client filters never trusted; `truncated` for content-minimized reads |
| 2 | Step text + skill refs treated as untrusted input (prompt-injection) | **Accepted** | `instruction`/`boundaries`/`draft_steps` are data, not commands; cannot escalate permissions or widen scope from inside a Flow |
| 3 | Imported / community Flows sandboxed | **Accepted** | Import enforces tool allowlist + scope; review required before an imported Flow runs with any privilege; `external_tool` skill-ref inert in v0 |
| 4 | Verification evidence = pointers/hashes/bounded enums, never raw private content/secrets | **Accepted** | `evidence_ref`, `evidence_refs[]`, `provenance` carry ids/hashes/labels only |
| 5 | Durable edits + run outcomes route through proposals (review-before-write) | **Accepted** | `flow_propose` / `POST /flows` → proposals (`intent`, `base_state_id`, `external_ref`); no direct canonical write |
| 6 | No secrets in definitions, projections, logs, provenance, responses | **Accepted** | `requires`/`skill_refs` reference handles; projections carry no secrets; OAuth/token shapes never appear in Flow objects |
| 7 | Automatable steps gated by model consent + cost caps | **Accepted** | `automatable` inert in v0; execution behind `ModelRuntimeAdapter` consent + `BillingAdapter` caps at gate 7A-L3; classroom/minor may forbid |
| 8 | Projections derived/read-only; hand-edited projection = drift | **Accepted** | `generated_from_canonical:true`, `editable:false`; drift detected, never used as write source |
| 9 | Classroom / minors policy may cap Flow/step kinds | **Accepted** | Org policy may forbid automatable steps; student personal Flows not visible to teacher/class agents by default |
| 10 | Run/version skew is safe | **Accepted** | Run pins `flow_version`; in-flight runs finish on the pinned version; migration offered, never forced |
| 11 | Seven-tier test matrix before any live capability | **Accepted** | See §9; scope-denial, injection, redaction, no-secrets are mandatory security-tier cases |

---

## 7. Defaults (confirmed for v0)

| Default | Value | Notes |
| --- | --- | --- |
| `flow.scope` for new flows | `personal` | Private by default |
| External / automatable effects | **off** | `automatable` inert until gate 7A-L3 |
| Active verification kinds | `human_review`, `artifact_exists` | Others parse-valid, runtime-gated |
| Step model | ordered list | DAG deferred to a later version |
| Taxonomy | **tags first** | Formal categories only if needed (see open items) |
| Storage | Hub index primary + optional vault mirror | Option A |

---

## 8. Starter Flow definitions — **deferred to 7A-3** (not authored here)

Authoring the concrete starter set (user-owned `knowtation.flow/v0` records composing existing
primitives, including the two project-scoped process Flows from `CROSS-REPO-COORDINATION.md`:
**"Multi-repo substrate + top-layer change"** and **"Overseer handover"**) is **step 7A-3**. This
spec only fixes the schema they must satisfy. Listed here so the scope boundary is explicit.

---

## 9. Test plan — seven tiers

Per `RULE #0`, every later implementation slice ships all seven tiers. v0 spec-step authors the plan;
adapter/store slices (7A-5..7A-10) implement it. **No network in unit tests.**

| Tier | What it proves | Representative v0 cases |
| --- | --- | --- |
| **unit** | Schema parse/validate per object | Required-field + enum validation for all five schemas; anatomy-completeness rejection (missing `trigger`/`verification`); id-format regex; semver parse |
| **integration** | CLI / MCP / Hub return the **same** contract | `flow_list`/`flow_get` parity across all three surfaces; scope filter applied identically; proposal path on each |
| **e2e** | Author → retrieve → project round-trip | Propose a flow → approve → `get` → `project --harness cursor_rule` → projection matches canonical |
| **stress** | Many flows/steps/runs | 10k flows, 100-step flows, deep `step_states`; list/get stay correct under load |
| **data-integrity** | Export/import round-trip with **no field loss** | Bundle export → import into a second vault preserves steps, skill refs, verification, scope, version, lineage byte-for-byte |
| **performance** | List/get latency budgets | `flow list` (scope-filtered) and `flow get` within target p95; projection generation bounded |
| **security** | Scope denial, injection, redaction, no-secrets | Personal flow never returned to a project/org context; malicious `instruction`/`draft_step` cannot escalate; evidence/provenance carry no raw content; no secret ever serialized in any object or projection |

---

## 10. Open items / decisions

| # | Item | Recommendation |
| --- | --- | --- |
| 1 | `flow_run` ↔ Phase 2G task record | **Decided (7A-4 / SD-2, 2026-06-20): linked records, both canonical in Knowtation, one portable store.** Link by id (`task.run_ref` ↔ `run.task_ref`, reusing the `external_ref` lineage bridge); never a Scooling-only store. Implementation rides 7A-5/7A-10. See `scooling/docs/CROSS-REPO-COORDINATION.md` → Standing Decisions |
| 2 | First projection target for the pilot | CLI runbook *or* Cursor rule; recommend **own repo guidance** (dogfood) as the convincing anti-drift case |
| 3 | Semver classification rules for procedures | Remove step / tighten verification = **MAJOR**; add optional step = **MINOR**; reword = **PATCH** (drives MuseHub typed-commit mapping at 7A-L5) |
| 4 | Category taxonomy | **Tags first**; formal categories only if needed |
| 5 | DAG vs ordered list | Ordered list for v0; revisit when branching/parallel is worth the complexity |
| 6 | Flow-candidate thresholds | Start `N=3`, confidence `medium`, cap `2`/session (see §5.2); tune to keep the bar high |
| 7 | External-agent bundle token/allowlist shape | Defer to external-agent gate 7A-L2 |

---

## Acceptance criteria for this spec (7A-2)

- The five wire schemas are ratified against `scooling/docs/FLOW-PLATFORM-ARCHITECTURE.md` with enums,
  id formats, and the step-state shape pinned (§1).
- Storage (Option A), API parity contract, projection-generator contract, capture-flywheel contract +
  thresholds, and defaults are complete (§2–§7).
- The security/privacy checklist is **fully signed off** (§6) and the seven-tier test plan is written
  (§9).
- No live capability is implied by acceptance; each live slice (7A-L1..L5) remains a separate gate.

## Non-goals (v0)

- Live automatable step execution; hosted projection; external-agent Flow bundles.
- DAG / branching / parallel steps.
- MuseHub enrichment (step-level history, releases, provenance-anchored evidence, social discovery).
- Scooling becoming a second canonical procedure store.

---

## Handoff notes (for the next step, 7A-3)

1. Branch is `feat/flow-v0-spec` (created from `main` @ `94ec65bd`); this spec is Muse-committed here.
2. 7A-3 authors the starter Flow set as concrete `knowtation.flow/v0` records against §1 (Thinking →
   Auto), including the two process Flows from `CROSS-REPO-COORDINATION.md`.
3. Add OpenAPI shapes to `docs/openapi.yaml` **in the same change as the routes** (7A-10) — no
   docs-only PR to Knowtation `main`.
4. Always target the repo explicitly with `muse -C ~/knowtation …`.
