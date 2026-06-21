# Flow Projection Generator + Fidelity Report — Contract (Phase 7A, Step 7A-11a)

Status: **Frozen contract — step 7A-11a (Thinking).** This document fixes the projection generator
contract, the rendered-artifact shape, staleness/drift detection, the `fidelity.dropped_fields`
report, the `flow project` wire shapes (CLI = MCP = Hub REST), the anti-drift demo acceptance
criteria, and the seven-tier test matrix **before any mechanical implementation**. 7A-11b (Auto)
implements `lib/flow/projection-generator.mjs`, the `flow project` surfaces, the OpenAPI block, and
the seven tiers **to this contract** — it does not redesign it.

Authored on branch **`feat/flow-projection-pilot`** (the same branch as 7A-10b).

Related:

- `docs/FLOW-V0-SPEC.md` — the canonical spec this contract implements: **§4 Projection generator**
  (dogfood target, anti-drift demo, fidelity report, staleness, drift), **§1.7
  `knowtation.flow_projection/v0`**, §1.1 the `Harness` enum, §6 security checklist (gate 8:
  projections derived/read-only), §9 seven-tier plan.
- `docs/FLOW-STORE-CONTRACT-7A-10.md` — the **read surface already shipped**: the generator reads
  canonical Flows through the same store (`getFlow`) and reuses its scope-resolution and parity
  model function-for-function.
- `scooling/docs/FLOW-PLATFORM-ARCHITECTURE.md` — the consumer architecture: **§ Tenet point 5**
  (harness projection, not ownership), the `Projection` definition, the `FlowProjectionAdapter`
  boundary (`project` / `listProjections` / `projectionStaleness`), and the forward-scan
  "projection fidelity loss" risk this report answers.
- `lib/flow/flow-store.mjs` — the canonical source the generator reads (`getFlow`,
  `flowDefinitionForClient`, `parseSemver` / `compareSemver`, id/version regexes).
- `lib/flow/flow-handlers.mjs` / `lib/flow/flow-scope.mjs` — the CLI = MCP = Hub parity and
  deny-by-default scope machinery the `flow project` surface reuses unchanged.
- `lib/calendar/event-store.mjs` — the Option A parity reference the store already mirrors; the
  generator stays a pure, local, no-network module in the same spirit.

**Scope fence (7A-11a):** Generator contract + rendered shape + staleness/drift + fidelity report +
`flow project` read/derive wire shapes + OpenAPI shapes (to land **with** the routes in 11b) + the
anti-drift acceptance criteria + the seven-tier test matrix — **contract only**. **No**
`lib/flow/projection-generator.mjs` implementation, **no** `flow project` CLI/MCP/Hub wiring, **no**
OpenAPI edit, **no** generated artifact written into any repo, **no** Scooling changes, **no**
posture-constant flips (`FLOW_LIVE_READ_AUTHORIZED` stays `false` in Scooling). `flow run`, live
authoring, hosted projection, and external-agent bundles remain separate later gates
(7A-L2/L3/L5).

---

## Simple summary

A **Flow** is the one true copy of a procedure, kept in Knowtation. A **projection** is a printout
of that procedure in the exact format one tool expects — a Cursor rule file, an `AGENTS.md`, a
`.cursorrules`. The **projection generator** is the printer: you point it at a canonical Flow and a
target format, and it prints the matching file. The printout is **read-only and disposable** — if
you lose it, you reprint it from the canonical Flow and nothing is lost; if someone scribbles on the
printout by hand, that is **drift**, and the system notices and refuses to treat the scribble as the
new truth.

Two honest promises make this trustworthy. First, the **fidelity report**: some formats simply
cannot say everything a Flow can (a plain rule file may have no place for "when *not* to run a
step"). When the generator has to leave something out, it writes down exactly what it dropped, so
you are never silently misled. Second, **staleness**: every printout remembers which version of the
Flow it came from, so when the Flow changes, the system can tell you "this printout is out of date —
reprint it." The proof that it all works (the *anti-drift demo*): change the canonical Flow, reprint,
and the only difference in the file is exactly the change you made — no hand-drift, no surprises.

## Technical summary

A pure, local, no-network generator module (`lib/flow/projection-generator.mjs`) renders a canonical
`knowtation.flow/v0` + its `knowtation.flow_step/v0` records (read via the 7A-10b store, never a
second source) into a `knowtation.flow_projection/v0` artifact for a target **harness**. Rendering is
**deterministic** — same canonical input + same `PROJECTION_GENERATOR_VERSION` ⇒ **byte-identical**
`rendered` text — which is what makes the anti-drift `diff` meaningful. Projections are
`generated_from_canonical: true`, `editable: false`, and carry a `fidelity.dropped_fields[]` listing
every step-anatomy field the target harness could not express. **Staleness** is a pure semver
comparison (`projection.flow_version` vs the latest visible `flow.version`); **drift** is a
content-hash comparison between an on-disk artifact and a fresh render of the same canonical version.
The generator is exposed read/derive-only over the three identical surfaces — CLI
(`knowtation flow project`), MCP (`flow_project`), Hub REST (`GET /api/v1/flows/{id}/projection`) —
returning **byte-identical** `knowtation.flow_project/v0` envelopes for the same authorized request,
reusing the 7A-10b deny-by-default scope resolution unchanged. v0 active harnesses are `cursor_rule`
and `cli_runbook` (the dogfood targets `.cursor/rules/*.mdc`, `AGENTS.md`, `.cursorrules`);
`cursor_skill` and `mcp_prompt` are reserved/parse-valid; `agent_bundle` is **inert** (external-agent
gate 7A-L2). No secrets ever appear in any rendered artifact, hash, or response; scope is enforced
server-side, deny-by-default, with no existence leak.

---

## 1. Generator module shape — `lib/flow/projection-generator.mjs` (contract, no impl)

A **pure, local, file-system-free, network-free** module — the same posture as `flow-store.mjs`.
It **reads canonical Flows only through the store** (`getFlow` from `flow-store.mjs`); it never owns
a second source, never writes the index, and never routes a proposal. Surfaces (route/CLI/MCP) call
it; it never calls them. The function table below pins names, signatures, and return shapes for
7A-11b.

### 1.1 Constants

| Constant | Value | Purpose |
| --- | --- | --- |
| `PROJECTION_GENERATOR_VERSION` | `'1'` (string, bumped only on a deliberate rendering change) | Stamped into every envelope; a render is reproducible **only** for a fixed generator version. A bump is itself a staleness/regeneration trigger. |
| `ACTIVE_HARNESSES` | `Set(['cursor_rule', 'cli_runbook'])` | The v0 dogfood targets that render real artifacts |
| `RESERVED_HARNESSES` | `Set(['cursor_skill', 'mcp_prompt'])` | Parse-valid in the `Harness` enum; rendering deferred (return `FLOW_HARNESS_UNSUPPORTED` until their slice) |
| `INERT_HARNESSES` | `Set(['agent_bundle'])` | **Inert in v0** — external-agent gate 7A-L2; always `FLOW_HARNESS_UNSUPPORTED` |
| `MAX_RENDERED_BYTES` | `65536` | Hard cap on a rendered artifact; over-cap ⇒ `truncated` note in fidelity + bounded output (no unbounded payloads) |
| `GENERATED_MARKER_PREFIX` | `'GENERATED FROM CANONICAL FLOW'` | The leading line of every rendered artifact (harness-commented); the anchor drift detection and humans both read |

`Harness` enum values come from `FLOW-V0-SPEC.md` §1.1 verbatim:
`cursor_rule | cursor_skill | mcp_prompt | cli_runbook | agent_bundle`.

### 1.2 Core generator functions

| Function | Signature | Returns / behaviour |
| --- | --- | --- |
| `isHarnessActive` | `(harness) → boolean` | `ACTIVE_HARNESSES.has(harness)`; the single gate every surface checks first |
| `projectFlow` | `(flow, steps, { harness, generatedAt? }) → FlowProjection` | Pure render of canonical `flow` + ordered `steps` into a `knowtation.flow_projection/v0` (§3). **Deterministic** for a fixed `(flow, steps, harness, PROJECTION_GENERATOR_VERSION)`. `generatedAt` is injectable for test determinism; it lives only in the response **envelope**, never in the canonical projection object. Throws no I/O; returns a value object only. |
| `computeFidelity` | `(harness, flow, steps) → { dropped_fields: string[], notes?: string }` | The per-harness fidelity report (§5). Pure; deterministic; sorted `dropped_fields`. |
| `renderedContentHash` | `(rendered) → string` | Stable hash (e.g. `sha256` hex) of the **`rendered` string only**, excluding the volatile envelope. Drift/regeneration key (§4.2). Never hashes secrets — `rendered` carries none by contract. |
| `isProjectionStale` | `(projectionFlowVersion, latestFlowVersion) → boolean` | Pure semver compare via `parseSemver`/`compareSemver`: stale ⇔ `projectionFlowVersion < latestFlowVersion`, or either side unparseable (fail toward "stale", never silently "fresh"). |
| `detectDrift` | `(onDiskRendered, freshRendered) → { drift: boolean, reason: 'clean' \| 'edited' \| 'missing_marker' \| 'absent' }` | Compares a hand-held on-disk artifact against a fresh render of the **same** canonical version. `drift:true` when content differs after marker-normalization, when the generated marker is absent (hand-authored), or when the file is absent where one is expected. Read-only; never mutates. |
| `flowProjectionForClient` | `(projection) → object` | The client projection of the §3 object — emits **only** the §1.7 spec fields; asserts no extra/secret-bearing key (tested). |

> **Determinism rule (the anti-drift keystone).** `projectFlow` MUST be a pure function of
> `(flow, steps, harness, PROJECTION_GENERATOR_VERSION)`. No clock, no randomness, no host paths, no
> environment in the `rendered` bytes. The only time-like value (`generated_at`) is confined to the
> response envelope (§3.2). This is what makes "edit canonical → regenerate → `diff` shows exactly
> the canonical change and nothing else" a true statement.

### 1.3 What the generator does **not** do (v0)

- It does **not** read or write the filesystem itself. The CLI surface (§6.1) is the only thing that
  may write a rendered artifact to a local `--out` path, and that is a **derived** local file, never
  a canonical write and never a proposal.
- It does **not** accept a hand-edited artifact as input-to-canonical. Drift is **detected and
  reported**, never reconciled by the generator (reconciliation, if ever, is a review-before-write
  proposal at a later gate).
- It does **not** render `agent_bundle` (inert, 7A-L2) or `cursor_skill` / `mcp_prompt` (reserved);
  requests for those fail closed with `FLOW_HARNESS_UNSUPPORTED`.
- It does **not** advance runs, mutate the index, or touch any scope decision — scope is resolved by
  the unchanged 7A-10b `flow-scope.mjs` before the generator is ever called.

---

## 2. Harness targets (v0 dogfood: our own repo guidance)

The v0 dogfood proves anti-drift on a real multi-harness problem we already have: **generate our own
repo guidance from canonical Flows.** Two harnesses are active; they cover all three dogfood targets.

| Harness | v0 status | Dogfood target file(s) | Rendered shape (summary) |
| --- | --- | --- | --- |
| `cursor_rule` | **active** | `.cursor/rules/<flow-slug>.mdc` | MDC frontmatter (`description`, `globs`, `alwaysApply`) derived from `flow.summary`/`tags`, then the generated marker, then an ordered, headed step body (owned job, trigger, anti-trigger, boundaries, output shape, verification). |
| `cli_runbook` | **active** | `AGENTS.md`, `.cursorrules` | Plain Markdown: a title from `flow.title`, the generated marker, a one-line `summary`, then numbered steps with the full step anatomy as labelled lines. No frontmatter. |
| `cursor_skill` | reserved | `.cursor/skills/<slug>/SKILL.md` | Specified later; `FLOW_HARNESS_UNSUPPORTED` in v0. |
| `mcp_prompt` | reserved | MCP prompt registration text | Specified later; `FLOW_HARNESS_UNSUPPORTED` in v0. |
| `agent_bundle` | **inert** | external-agent instruction bundle | Gated 7A-L2; always `FLOW_HARNESS_UNSUPPORTED`. |

### 2.1 Rendered-artifact invariants (both active harnesses)

1. **First content line is the generated marker.** Harness-appropriate comment carrying
   `GENERATED FROM CANONICAL FLOW <flow_id>@<flow_version> — DO NOT EDIT; regenerate via
   `knowtation flow project``. It encodes the source `flow_id` + `flow_version` + the
   `PROJECTION_GENERATOR_VERSION`, so a reader and `detectDrift` both know provenance and staleness at
   a glance. (`cursor_rule`: inside the `.mdc` after frontmatter, as an HTML comment;
   `cli_runbook`: an HTML comment at the top of the Markdown.)
2. **Ordered exactly by `step.ordinal`.** Step order in the artifact equals the canonical order; no
   reordering, no de-duplication, no editorializing.
3. **Verbatim, inert step text.** `instruction`, `owned_job`, `trigger`, `when_not_to_run`,
   `boundaries`, `output_shape`, and `skill_refs` are rendered as **data** — escaped/quoted for the
   harness format, never interpreted, never executed, and incapable of widening scope from inside the
   artifact.
4. **No secrets, ever.** `requires` / `skill_refs` render as **handles/opaque ids only**;
   `provenance` / `evidence_ref` (run-side) are never projected; no `token` / `oauth` /
   `refresh_token` / raw note body / prompt / completion can appear. The security tier asserts this by
   scanning the rendered bytes.
5. **Bounded.** Rendered output never exceeds `MAX_RENDERED_BYTES`; over-cap is truncated at a step
   boundary and recorded in `fidelity.notes`.

---

## 3. Rendered projection object — `knowtation.flow_projection/v0`

### 3.1 Canonical projection object (spec §1.7 — unchanged, no new fields on the canonical shape)

`projectFlow` returns exactly the spec §1.7 fields — nothing more on the canonical object:

```jsonc
{
  "schema": "knowtation.flow_projection/v0",
  "flow_id": "flow_overseer_handover",
  "flow_version": "0.1.0",        // the version this artifact was generated from (staleness key)
  "harness": "cursor_rule",       // Harness enum
  "rendered": "…harness-specific text, marker-first, ordered, secret-free…",
  "generated_from_canonical": true,   // const true
  "editable": false,                  // const false — a hand-edited projection is drift, not a source
  "fidelity": { "dropped_fields": ["when_not_to_run"], "notes": "cursor_rule has no anti-trigger slot" }
}
```

### 3.2 Response envelope — `knowtation.flow_project/v0` (mirrors how `flow_get/v0` wraps `flow`)

Staleness and drift/regeneration **bookkeeping** live in the **envelope**, never on the canonical
projection object (keeping §1.7 pure, exactly as `FlowGetResponse` wraps `Flow`):

```jsonc
{
  "schema": "knowtation.flow_project/v0",
  "vault_id": "default",
  "projection": { /* knowtation.flow_projection/v0 — §3.1 */ },
  "staleness": {
    "stale": false,
    "projection_version": "0.1.0",
    "latest_version": "0.1.0"
  },
  "generator": {
    "generator_version": "1",                  // PROJECTION_GENERATOR_VERSION
    "content_hash": "sha256:…",                // renderedContentHash(projection.rendered)
    "generated_at": "2026-06-20T00:00:00Z"     // envelope-only; never in projection.rendered
  }
}
```

- The `schema` discriminators (`knowtation.flow_projection/v0` on the object,
  `knowtation.flow_project/v0` on the envelope) are stamped by the generator/handler so every surface
  emits them identically.
- `content_hash` lets a caller (CLI `--check`, a CI gate, the Scooling `FlowProjectionAdapter`)
  detect drift without re-shipping the whole artifact.
- `generated_at` is the **only** non-deterministic value and is **excluded** from `content_hash` and
  from `projection.rendered`, so parity and anti-drift comparisons stay byte-stable.

---

## 4. Staleness and drift

### 4.1 Staleness — a pure version lag

- A projection is **stale** when `projection.flow_version` is **less than** the latest visible
  `flow.version` for that `flow_id` (within the caller's scope), per `parseSemver`/`compareSemver`.
- Either version unparseable ⇒ **stale** (fail toward "regenerate", never silently "fresh").
- A `PROJECTION_GENERATOR_VERSION` bump is **also** a regeneration trigger: an artifact whose marker
  carries an older generator version is treated as needing regeneration even at the same flow version.
- Surfaced in the envelope `staleness` block and consumed by the Scooling
  `FlowProjectionAdapter.projectionStaleness(flowId, harness)` (no Scooling change in 11a; this is
  the contract it will read).

### 4.2 Drift — a hand-edited artifact is never a source

- **Drift** = an on-disk rendered artifact whose content (after normalizing the volatile marker
  fields) differs from a fresh deterministic render of the **same** canonical `flow_version`, **or**
  whose generated marker is missing entirely (hand-authored), **or** which is absent where the
  canonical Flow expects one.
- `detectDrift` reports drift; it **never** reconciles it. Because `editable: false`, a drifted
  artifact is **never** read back as a write source (spec §6 gate 8). The remedy is always
  **regenerate** (overwrite the derived artifact), never "promote the edit".
- Drift detection is **read-only** and pure: `(onDiskRendered, freshRendered) → verdict`. The CLI
  `--check` mode (§6.1) surfaces it with a non-zero exit; the Hub `GET …/projection` reports it in
  the payload (a GET never writes). Any future "reconcile a hand edit" path is a separate
  review-before-write proposal gate, **out of scope here**.

---

## 5. Fidelity report — `fidelity.dropped_fields`

When a target harness cannot express a step-anatomy field, the projection records **exactly** what it
dropped, so the user is never silently misled (the spec §4 fidelity requirement and the architecture
"projection fidelity loss" risk).

### 5.1 Contract

- `fidelity.dropped_fields` is a **sorted, de-duplicated** array of canonical field names that the
  harness format could not represent (e.g. `when_not_to_run`, `requires`, `skill_refs`, `outputs`,
  `inputs`, `verification.evidence_required`).
- A field is "dropped" only when its canonical value was **present and non-empty** but has **no slot**
  in the rendered artifact — never list a field that was empty/absent in the source.
- `fidelity.notes` (optional) is a short human string explaining the loss or any truncation
  (`MAX_RENDERED_BYTES`).
- The report is **per-(flow, harness)** and **deterministic** — same input ⇒ same report.
- **A dropped field is a transparency note, not a license to leak.** Dropping a field never means
  rendering it "somewhere unsafe"; it means it is **absent** from the artifact and **named** in the
  report.

### 5.2 v0 per-harness fidelity baseline (representative, frozen for 11b)

| Canonical field | `cursor_rule` | `cli_runbook` |
| --- | --- | --- |
| `owned_job`, `instruction`, `trigger`, `boundaries`, `output_shape`, `verification.kind/description` | expressed | expressed |
| `when_not_to_run` (anti-trigger) | **dropped** (no MDC slot) → listed | expressed (labelled line) |
| `requires` (handles) | dropped (kept out of rule prose) → listed when present | expressed as a handles list |
| `skill_refs` (opaque ids) | expressed as a reference list | expressed as a reference list |
| `inputs` / `outputs` | dropped → listed when present | expressed |
| `verification.evidence_required` | expressed (inline) | expressed (inline) |

The exact matrix is finalized in 11b implementation, but the **rule** is frozen: every
present-but-unexpressible field MUST appear in `dropped_fields`; nothing expressed may also be listed.

---

## 6. `flow project` wire shapes (read/derive) — CLI = MCP = Hub REST

`flow project` is **read/derive-only** in v0: it reads canonical Flows (scope-checked) and derives an
artifact. It performs **no canonical write and no proposal**. The defining invariant from 7A-10
holds: **the same authorized request returns byte-identical `knowtation.flow_project/v0` JSON on all
three surfaces** (modulo the envelope-only `generated_at`, which callers exclude from equality just as
the generator excludes it from `content_hash`). Scope resolution reuses `flow-scope.mjs` **unchanged**
(deny-by-default; `scope` narrows only; no existence leak).

> The OpenAPI shapes in §7 are **specified here** and land in `docs/openapi.yaml` **in the same
> change as the routes (7A-11b)** — never a docs-only PR to `main`.

### 6.1 CLI

```
knowtation flow project <flow_id> --harness <harness> [--version <semver>] [--out <path>] [--check] [--json]
```

- `--harness` (required) — one of the active harnesses; reserved/inert ⇒ `FLOW_HARNESS_UNSUPPORTED`.
- `--version` (optional) — pin a `SEMVER_RE` source version; default = latest visible.
- `--json` — print the exact `knowtation.flow_project/v0` envelope; without it, print `rendered` plus
  a human staleness/fidelity summary.
- `--out <path>` — write `projection.rendered` to a **local derived file** (the dogfood artifact).
  This is the **only** write `flow project` may perform; it is a derived projection, **not** a
  canonical write or proposal. Absent `--out`, output goes to stdout only.
- `--check` — **read-only drift/staleness gate**: regenerate, compare against the on-disk artifact at
  `--out`/default path via `detectDrift` + `isProjectionStale`, print the verdict, and exit **non-zero
  on drift or staleness** (the CI-friendly anti-drift gate). `--check` never writes.
- Scope resolves exactly as Hub does (local identity → authorized scopes → `visibleScopes`); no flag
  can grant a scope the caller lacks. Error codes match the Hub (`BAD_REQUEST`,
  `FLOW_HARNESS_UNSUPPORTED`, `FLOW_SCOPE_DENIED`, `FLOW_SCOPE_AMBIGUOUS`, `unknown_flow`).

### 6.2 MCP tool

| Tool | Inputs | v0 | Result |
| --- | --- | --- | --- |
| `flow_project` | `flow_id` (req), `harness` (req, enum), `version?` (semver), `vault_id?` | **active (read/derive)** | `knowtation.flow_project/v0` envelope — **same JSON** as Hub/CLI. The MCP tool **never writes a file** (no `--out` analogue); it returns the rendered artifact and bookkeeping only. |

It delegates to the same shared handler as CLI/Hub (parity with `flow_list`/`flow_get` in
`mcp/tools/flow.mjs`); no surface re-shapes the payload.

### 6.3 Hub REST

| Method + path | Purpose | v0 |
| --- | --- | --- |
| `GET /api/v1/flows/{id}/projection?harness=&version=` | Derived projection + staleness + generator bookkeeping | **active (read/derive)** |

`BearerAuth` + `X-Vault-Id` + `requireRole('viewer'…)`, parity with `GET /api/v1/flows/{id}`. A GET is
**read-only** — it reports `staleness`/drift in the payload and never writes an artifact server-side.

### 6.4 Shared handler (parity, mirrors `flow-handlers.mjs`)

7A-11b adds `handleFlowProjectRequest(input)` to `lib/flow/flow-handlers.mjs` returning the same
`{ ok, payload } | { ok:false, status, error, code }` shape as the list/get handlers. It:

1. validates `flow_id` (`FLOW_ID_RE`) and `version` (`SEMVER_RE` when present) → `BAD_REQUEST`;
2. resolves `visibleScopes` via the **unchanged** `resolveHandlerVisibleScopes` (ambiguous ⇒
   `FLOW_SCOPE_AMBIGUOUS`);
3. rejects a non-active `harness` → `FLOW_HARNESS_UNSUPPORTED` (400);
4. loads canonical via `getFlow` (missing/scope-invisible ⇒ `404 unknown_flow` — **no existence
   leak**);
5. calls `projectFlow` + `computeFidelity` + staleness/hash helpers and returns the
   `knowtation.flow_project/v0` envelope.

### 6.5 Error codes

| Code | Status | When |
| --- | --- | --- |
| `BAD_REQUEST` | 400 | malformed `flow_id`, bad `version`, missing/unknown `harness` value |
| `FLOW_HARNESS_UNSUPPORTED` | 400 | a syntactically valid but reserved/inert harness (`cursor_skill`, `mcp_prompt`, `agent_bundle`) in v0 |
| `FLOW_SCOPE_AMBIGUOUS` | 400 | scope resolution ambiguous (fails closed) |
| `FLOW_SCOPE_DENIED` | 403 | `scope` query asks for a tier the caller lacks |
| `unknown_flow` | 404 | flow missing **or** scope-invisible (indistinguishable) |

Reuses the existing `Error` schema (`{ error, code }`) — no new error shape.

---

## 7. OpenAPI wire shapes (to land in `docs/openapi.yaml` **with the routes**, 7A-11b)

New path under the existing `Flows` tag; `BearerAuth` + `X-Vault-Id` + `requireRole(viewer…)`.

### 7.1 `GET /api/v1/flows/{id}/projection`

```yaml
/api/v1/flows/{id}/projection:
  get:
    tags: [Flows]
    summary: Derive a read-only harness projection of a canonical flow
    description: >
      Renders the canonical flow (latest visible, or pinned ?version) into the requested
      harness as knowtation.flow_project/v0. Derived and read-only — generated_from_canonical
      is always true and editable is always false. No secrets appear in rendered text.
    parameters:
      - { name: id,      in: path,  required: true, schema: { type: string } }
      - { name: harness, in: query, required: true, schema: { type: string, enum: [cursor_rule, cursor_skill, mcp_prompt, cli_runbook, agent_bundle] } }
      - { name: version, in: query, schema: { type: string } }
    responses:
      '200': { content: { application/json: { schema: { $ref: '#/components/schemas/FlowProjectResponse' } } } }
      '400': { content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }  # BAD_REQUEST | FLOW_HARNESS_UNSUPPORTED | FLOW_SCOPE_AMBIGUOUS
      '401': { content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
      '403': { content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }  # FLOW_SCOPE_DENIED
      '404': { content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }  # unknown_flow (missing OR scope-invisible)
```

### 7.2 Component schemas

```yaml
components:
  schemas:
    FlowProjectResponse:
      type: object
      required: [schema, vault_id, projection, staleness, generator]
      properties:
        schema:    { type: string, enum: [knowtation.flow_project/v0] }
        vault_id:  { type: string }
        projection: { $ref: '#/components/schemas/FlowProjection' }
        staleness: { $ref: '#/components/schemas/FlowProjectionStaleness' }
        generator: { $ref: '#/components/schemas/FlowProjectionGenerator' }

    FlowProjection:           # knowtation.flow_projection/v0 — spec §1.7 (no extra fields)
      type: object
      required: [schema, flow_id, flow_version, harness, rendered, generated_from_canonical, editable]
      properties:
        schema:                   { type: string, enum: [knowtation.flow_projection/v0] }
        flow_id:                  { type: string }
        flow_version:             { type: string }
        harness:                  { type: string, enum: [cursor_rule, cursor_skill, mcp_prompt, cli_runbook, agent_bundle] }
        rendered:                 { type: string, maxLength: 65536 }   # MAX_RENDERED_BYTES; no secrets
        generated_from_canonical: { type: boolean, enum: [true] }
        editable:                 { type: boolean, enum: [false] }
        fidelity:
          type: object
          required: [dropped_fields]
          properties:
            dropped_fields: { type: array, items: { type: string } }
            notes:          { type: string }

    FlowProjectionStaleness:
      type: object
      required: [stale, projection_version, latest_version]
      properties:
        stale:              { type: boolean }
        projection_version: { type: string }
        latest_version:     { type: string }

    FlowProjectionGenerator:
      type: object
      required: [generator_version, content_hash, generated_at]
      properties:
        generator_version: { type: string }
        content_hash:      { type: string }   # hash of rendered only; generated_at excluded
        generated_at:      { type: string }
```

> The `Error` schema already exists; projection routes reuse it with the §6.5 `code` strings.

---

## 8. Fail-closed rules (generator + all three surfaces)

1. **Derived, read-only, regenerable.** `generated_from_canonical: true`, `editable: false`. A
   hand-edited projection is **drift**, detected and never used as a write source (spec §6 gate 8).
2. **Deterministic render.** `projectFlow` is pure over `(flow, steps, harness,
   PROJECTION_GENERATOR_VERSION)`; `generated_at` is envelope-only and excluded from `content_hash`.
   Anti-drift `diff` is therefore meaningful.
3. **No secrets in any artifact, hash, or response.** `requires`/`skill_refs` render as handles/opaque
   ids only; no `token`/`oauth`/`refresh_token`/raw note body/prompt/completion; the security tier
   scans `rendered` and the full envelope.
4. **Untrusted step text.** Step anatomy fields render as inert **data** (escaped/quoted), never
   interpreted, never able to widen scope or escalate from inside the artifact.
5. **Scope is authorization, deny-by-default, no existence leak.** Reuses 7A-10b
   `flow-scope.mjs`/`resolveHandlerVisibleScopes` unchanged; `scope` narrows only; missing and
   scope-invisible both ⇒ `404 unknown_flow`.
6. **Harness fail-closed.** Only `ACTIVE_HARNESSES` render; reserved/inert ⇒
   `FLOW_HARNESS_UNSUPPORTED`. No partial/guessed render of an unsupported harness.
7. **Honest fidelity.** Every present-but-unexpressible field appears in `dropped_fields`; nothing
   expressed is also listed; dropping never means leaking elsewhere.
8. **Bounded + ordered.** `rendered` ≤ `MAX_RENDERED_BYTES` (truncated at a step boundary, noted in
   fidelity); steps always in `ordinal` order; no unbounded payloads, no quadratic scans.
9. **No new write path.** `flow project` performs no canonical write and no proposal. The only write
   anywhere is the CLI `--out` **local derived artifact**; `--check` and the Hub GET are read-only.

---

## 9. Seven-tier test matrix (what each tier proves — representative cases, not code)

Per `RULE #0`, 7A-11b ships all seven tiers. Files follow the repo `.test.mjs` convention
(`test/flow-projection-generator-*.test.mjs`, `test/flow-project-parity-*.test.mjs`). **No network in
unit tests.** Fixtures reuse the six `flows/starter/` bundles (notably `flow_overseer_handover`,
`flow_multi_repo_change` — the two `project`-scoped dogfood Flows), a malicious-step fixture, a
multi-version fixture (e.g. `0.1.0` + `0.2.0`), and a hand-edited-artifact fixture for drift.

### 1. unit — `test/flow-projection-generator-unit.test.mjs`

- `isHarnessActive` true only for `cursor_rule`/`cli_runbook`; reserved/inert are false.
- `projectFlow` returns a §1.7-shaped object with `generated_from_canonical:true`, `editable:false`,
  the marker as the first content line, steps in `ordinal` order, no extra keys
  (`flowProjectionForClient` parity).
- **Determinism:** two `projectFlow` calls on identical input produce **byte-identical** `rendered`
  and identical `renderedContentHash`; `generated_at` differences never affect the hash.
- `computeFidelity` lists exactly the present-but-unexpressible fields (e.g. `when_not_to_run` for
  `cursor_rule`), sorted/de-duped, and never lists an expressed or absent field.
- `isProjectionStale`: `0.1.0` < `0.2.0` ⇒ stale; equal ⇒ fresh; unparseable ⇒ stale (fail-closed).
- `renderedContentHash` stable across runs; differs when `rendered` differs by one byte.

### 2. integration — `test/flow-project-parity-integration.test.mjs`

- **Parity:** CLI `flow project --json`, MCP `flow_project` result, and the Hub route handler payload
  are **deep-equal** (excluding envelope `generated_at`) for the same authorized request.
- Scope filter applied identically across all three; a pinned `--version` resolves identically.
- `FLOW_HARNESS_UNSUPPORTED` returned identically on all three for `agent_bundle`/`cursor_skill`.
- The generator reads canonical via the **same** `getFlow` the read surface uses (one source).

### 3. e2e — `test/flow-projection-generator-e2e.test.mjs`

- Empty vault → first read seeds starters → `flow project flow_overseer_handover --harness cli_runbook`
  renders six ordered steps with `human_review`/`artifact_exists` verifications intact, marker first,
  no secrets → `--out` writes the artifact → re-running `--check` reports **clean** (no drift).
- `flow project … --harness cursor_rule` emits valid MDC frontmatter + marker + ordered body and a
  `fidelity.dropped_fields` containing `when_not_to_run`.

### 4. stress — `test/flow-projection-generator-stress.test.mjs`

- Project a `MAX_STEPS_PER_FLOW`-step flow and many flows back-to-back; `rendered` stays ≤
  `MAX_RENDERED_BYTES` (truncation noted in fidelity), ordering stays correct, render time bounded; no
  quadratic blowup over step count.

### 5. data-integrity — `test/flow-projection-generator-data-integrity.test.mjs`

- **Round-trip fidelity:** every step-anatomy field is **either** present in `rendered` **or** named
  in `dropped_fields` — never silently missing from both.
- **Anti-drift (the acceptance proof):** render → bump canonical (e.g. tighten a step's
  `verification`, bump `flow.version`) → re-render → the `diff` of the two `rendered` artifacts
  contains **only** the canonical change (no manual/incidental drift). Deleting a rendered artifact
  and regenerating reproduces it **byte-for-byte** (lossless).
- `flow_version` in the projection equals the canonical version it was generated from.

### 6. performance — `test/flow-projection-generator-performance.test.mjs`

- `projectFlow` + `computeFidelity` + `renderedContentHash` complete within a p95 budget on the large
  fixture; staleness/drift checks are O(content size); no quadratic scans in fidelity computation.

### 7. security — `test/flow-projection-generator-security.test.mjs`

- **No secrets:** `JSON.stringify` of the full envelope **and** the raw `rendered` bytes contain no
  `token`/`oauth`/`refresh_token`/raw-content markers; `requires`/`skill_refs` render as handles only.
- **Injection inert:** a malicious `instruction`/`boundaries`/`skill_ref` fixture renders as escaped,
  inert data — it cannot break out of the harness format, cannot widen scope, and is never executed.
- **Scope denial / no existence leak:** a `personal` caller projecting a `project` flow gets
  `404 unknown_flow` identical to a missing id; `scope=org` under `personal` authorization is denied
  (`FLOW_SCOPE_DENIED`), never widened.
- **Drift never promoted:** a hand-edited artifact is flagged by `detectDrift` and is **never** read
  back as canonical; `editable:false` holds; the only remedy is regenerate.
- **Harness fail-closed:** `agent_bundle`/`cursor_skill`/`mcp_prompt` never render a partial artifact.

---

## 10. Anti-drift demo — acceptance criteria for the pilot (7A-11 / 7A-12)

The convincing dogfood proof, frozen here as the acceptance bar the 11b implementation and the 7A-12
demo must hit:

1. **Generate.** `knowtation flow project <project-scoped dogfood flow> --harness cursor_rule --out
   .cursor/rules/<slug>.mdc` (and `--harness cli_runbook --out AGENTS.md`) produces a marker-first,
   ordered, secret-free artifact from the canonical Flow.
2. **Edit canonical → regenerate → clean diff.** Make one canonical change (e.g. add an optional step
   or tighten a `verification`), bump `flow.version`, regenerate; the artifact `diff` shows **exactly**
   that change and **no** manual drift.
3. **Delete loses nothing.** Delete the rendered artifact, regenerate; it is reproduced
   **byte-for-byte** from canonical.
4. **Hand-edit is caught.** Hand-edit the artifact, run `flow project … --check`; `detectDrift`
   reports `drift:true` and the command exits non-zero — the hand edit is **never** promoted to
   canonical.
5. **Staleness surfaces.** With canonical ahead of a generated artifact, `--check` /
   `GET …/projection` reports `stale:true` with the lagging vs latest versions.
6. **Fidelity is honest.** `cursor_rule` for a flow with `when_not_to_run` lists it in
   `dropped_fields`; `cli_runbook` expresses it and does not list it.

---

## 11. Acceptance (7A-11a)

- The generator module shape (`lib/flow/projection-generator.mjs` function table, constants,
  determinism rule), the rendered-artifact invariants and per-harness shapes, the
  `knowtation.flow_projection/v0` object (spec §1.7, unchanged) + `knowtation.flow_project/v0`
  envelope, staleness + drift detection, the `fidelity.dropped_fields` contract, the `flow project`
  CLI/MCP/Hub read-derive wire shapes + OpenAPI shapes, the fail-closed rules, the anti-drift demo
  acceptance criteria, and the seven-tier test matrix are **frozen here — contract only, no
  implementation.**
- Ratified against `FLOW-V0-SPEC.md` §4/§1.7/§1.1/§6/§9 and `scooling/docs/FLOW-PLATFORM-ARCHITECTURE.md`
  (tenet point 5, `Projection` definition, `FlowProjectionAdapter` `project`/`listProjections`/
  `projectionStaleness`, projection-fidelity-loss risk). Reuses 7A-10b scope/parity machinery
  unchanged.
- Muse-committed on `feat/flow-projection-pilot`; handover regenerated to point at **7A-11b** (Auto:
  generator + `flow project` surfaces + OpenAPI + seven-tier impl to this contract).

## Non-goals (7A-11)

- No generator implementation, no `flow project` wiring, no OpenAPI edit (all 7A-11b).
- No `cursor_skill` / `mcp_prompt` rendering (reserved); no `agent_bundle` (inert — 7A-L2).
- No reconciliation of a hand-edited projection back to canonical (any such path is a later
  review-before-write gate).
- No `flow run` advancement (gated 7A-L3); no live capture (inert — 7A-L4); no hosted projection or
  MuseHub enrichment (7A-L5).
- No Scooling changes and no posture-constant flips; `FLOW_LIVE_READ_AUTHORIZED` stays `false` in
  Scooling.

---

## Handoff notes (for the next step, 7A-11b — Auto)

1. Branch is **`feat/flow-projection-pilot`**; 7A-11a (this contract) is Muse-committed. Always target
   Knowtation with `muse -C ~/knowtation …`.
2. **7A-11b (Auto)** — implement `lib/flow/projection-generator.mjs` to §1 (pure, deterministic, reads
   canonical via `getFlow`), add `handleFlowProjectRequest` to `lib/flow/flow-handlers.mjs` (§6.4),
   wire `knowtation flow project` (§6.1), the `flow_project` MCP tool (§6.2), and
   `GET /api/v1/flows/{id}/projection` (§6.3), land the OpenAPI block (§7) **with** the routes, and
   ship all seven tiers (§9). Hit the anti-drift acceptance bar (§10).
3. Keep `generated_at` envelope-only and out of `content_hash`/`rendered`; that is what keeps parity
   and anti-drift comparisons byte-stable.
4. Scope/parity machinery from 7A-10b (`flow-scope.mjs`, `resolveHandlerVisibleScopes`) is reused
   **unchanged** — do not fork it.
5. 7A-12 runs the anti-drift diff demo end-to-end on our own repo guidance; 7A-13 is the Scooling
   loopback read wire (separate, gated). No Scooling posture flip rides 7A-11b.
