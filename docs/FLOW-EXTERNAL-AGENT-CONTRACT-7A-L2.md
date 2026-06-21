# Flow External-Agent Gate — Canonical Contract (Phase 7A, Step 7A-L2a)

Status: **Contract only — Thinking step (7A-L2a).** This is the frozen, canonical
contract for the **external-agent gate**: hosted `agent_bundle` projection reads,
scoped external-agent grants, vault tool allowlists, and `external_tool` skill-ref
activation rules. **No implementation, no routes, no MCP/CLI wiring, no posture flip,
and no tool invocation ships in this step.** The mechanical implementation (generator
`agent_bundle` renderer, grant mint/revoke, hosted projection parity, seven-tier test
bodies) is **7A-L2b (Auto)**, written to this contract without redesigning it.

Authored on branch **`feat/flow-projection-pilot`** (Knowtation). Always target the
repo explicitly with `muse -C ~/knowtation …`.

Related:

- `docs/FLOW-V0-SPEC.md` — §1.1 (`external_tool`, `agent_bundle`), §6 item 3
  (imported/community Flows sandboxed; `external_tool` inert until this gate), §10
  item 7 (token/allowlist shape — resolved here as SD-5).
- `docs/FLOW-PROJECTION-GENERATOR-CONTRACT-7A-11.md` — `agent_bundle` is inert in
  v0 (`INERT_HARNESSES`); this contract defines when it becomes active and what it
  renders.
- `docs/FLOW-AUTHORING-WRITEBACK-CONTRACT-7A-L1.md` — import path; §5 tool
  allowlist defers enforcement detail to this gate.
- `scooling/docs/FLOW-EXTERNAL-AGENT-LIVE-WIRE-CONTRACT-7A-L2.md` — the **consumer**
  half (hosted projection wire + double-lock posture) ratified field-for-field
  against this contract.
- `scooling/docs/AGENT-ARCHITECTURE.md` — external agents as scoped clients (tokens,
  allowlists, review-before-write, no direct canonical writes).

**Scope fence (7A-L2a):** scoped-grant wire shape + vault tool allowlist model +
`external_tool` activation rules + `agent_bundle` rendered shape + hosted projection
read contract + import sandboxing + error taxonomy + seven-tier test matrix **only**.
**Not** in scope: generator/renderer impl, grant mint routes, MCP/CLI wiring, OpenAPI
edits (land **with** routes in 7A-L2b), automatable step execution (7A-L3), capture
(7A-L4), MuseHub enrichment (7A-L5), or flipping `FLOW_EXTERNAL_AGENT_ENABLED`.

---

## Simple summary

Third-party agents (Slack bots, custom MCP clients, partner integrations) must never
get the keys to the kingdom. This contract defines the one safe way they may consume a
Flow: Knowtation issues a **short-lived, scoped grant** (which vault, which scope tier,
which Flow version, which tools — nothing else). The Flow is delivered as a read-only
**external-agent bundle** (`agent_bundle` harness) generated from the canonical copy,
never hand-edited. Every `external_tool` reference in a step stays **dead** until the
grant exists, the tool is on the vault allowlist, and the Flow has passed human review.
Imported or community Flows are checked at import time: unknown tools are rejected, not
silently ignored. Hosted (non-loopback) projection reads for `agent_bundle` follow the
same pattern calendar uses for hosted parity — explicit env gate, pinned hostnames, no
secrets in the artifact. Nothing here turns the gate on; it only freezes the rules.

## Technical summary

The external-agent gate unblocks two capabilities that stay inert until authorized:
**(A) hosted `agent_bundle` projection reads** (`GET /api/v1/flows/{id}/projection?
harness=agent_bundle` on the Knowtation gateway, not loopback-only) and **(B)
`external_tool` skill-ref resolution** at runtime (never at import/propose). Grants are
server-minted `knowtation.flow_external_grant/v0` records: opaque `grant_id`, pinned
`flow_id` + `flow_version`, vault-bound `scope`, `allowed_tools[]` ⊆ (vault allowlist
∩ flow-declared `external_tool` ids), `allowed_harnesses: ['agent_bundle']`, TTL-capped
`expires_at`, hashed `actor_hash` — the one-time bearer secret is returned **once** at
mint and never appears in projections, Flow objects, logs, or grant listings.
**Tool allowlists** live in vault policy (`external_agent.allowed_tools[]`); import and
grant mint both enforce ⊆. **`agent_bundle` rendered** is JSON (`knowtation.agent_bundle/v0`
inside `flow_projection.rendered`): marker-first, ordered steps, opaque tool ids, computed
`allowed_tools`, `grant_required: true`, secret-free. Posture: `FLOW_EXTERNAL_AGENT_ENABLED`
defaults **off** on Knowtation; Scooling mirrors with compile-time
`FLOW_PROJECTION_WRITE_BACK_AUTHORIZED` + env double-lock (consumer contract). Ratifies
FLOW-V0-SPEC §6 item 3 field-for-field.

---

## 0. Design decision (recorded as SD-5)

**How do external agents consume Flows safely?** Recorded once in
`scooling/docs/CROSS-REPO-COORDINATION.md` → Standing Decisions as **SD-5**:

> **SD-5 — External-agent access is grant-gated, not Flow-embedded.** Third-party agents
> never receive durable authority from a Flow definition, projection, or import bundle.
> Knowtation mints short-lived `knowtation.flow_external_grant/v0` grants server-side;
> vault policy holds the tool allowlist; `external_tool` skill-refs activate only when
> grant + allowlist + approved canonical Flow version all match. The `agent_bundle`
> harness is derived read-only (same anti-drift rules as `cursor_rule` / `cli_runbook`).
> Hosted projection reads reuse the calendar hosted-parity pattern (pinned gateway
> hostnames, explicit env gate, gateway JWT — not the loopback Hub token). Resolves
> FLOW-V0-SPEC §10 item 7 and implements §6 item 3 literally.

---

## 1. Surfaces (triple-exposed when gate is ON — design only in 7A-L2a)

All surfaces require **`FLOW_EXTERNAL_AGENT_ENABLED`** (default off, §8) and resolve
authority server-side. **7A-L2a freezes shapes; 7A-L2b wires them.**

| Surface | Mint grant | Revoke grant | Fetch `agent_bundle` | List grants (metadata) |
| --- | --- | --- | --- | --- |
| **MCP** | `flow_external_grant_mint` | `flow_external_grant_revoke` | `flow_project` (`harness=agent_bundle`) | `flow_external_grant_list` |
| **Hub REST** | `POST /api/v1/flows/{id}/external-grants` | `DELETE /api/v1/flows/external-grants/{grant_id}` | `GET /api/v1/flows/{id}/projection?harness=agent_bundle` | `GET /api/v1/flows/external-grants` |
| **CLI** | `knowtation flow grant mint …` | `knowtation flow grant revoke …` | `knowtation flow project … --harness agent_bundle` | `knowtation flow grant list` |

Grant mint/revoke/list converge on **one handler family** (`handleFlowExternalGrant*`);
`agent_bundle` projection reuses **`handleFlowProjectRequest`** (7A-11) with the
harness gate lifted when `FLOW_EXTERNAL_AGENT_ENABLED` is on. No surface re-implements
allowlist math — parity is proven by deep-equality (§9 tier 2).

### 1.1 Request — grant mint (`flow_external_grant_mint`)

```jsonc
{
  "flow_id": "flow_weekly_review",       // REQUIRED — must be readable in caller's scope
  "flow_version": "1.2.0",             // REQUIRED — semver pin; must match a visible canonical version
  "requested_tools": ["web_search"],   // REQUIRED, non-empty; each id must be ⊆ §3 allowlist ∩ flow external_tool refs
  "ttl_seconds": 3600,                 // OPTIONAL; server caps at policy max (default 3600, max 86400)
  "actor_label": "slack-bot-prod"      // OPTIONAL, untrusted label; stored hashed only (§2)
}
```

- The caller never supplies `scope` or `vault_id` as authority — both are derived from
  verified identity + vault binding (`X-Vault-Id` on Hub; local vault on CLI).
- Requesting a tool not declared on any step as `external_tool` ⇒
  `400 FLOW_EXTERNAL_TOOL_UNKNOWN`.
- Requesting a tool outside the vault allowlist ⇒ `403 FLOW_EXTERNAL_TOOL_DENIED`.

### 1.2 Response — mint (`knowtation.flow_external_grant_mint/v0`)

```jsonc
{
  "schema": "knowtation.flow_external_grant_mint/v0",
  "grant": { /* knowtation.flow_external_grant/v0 — §2.1, NO bearer here */ },
  "bearer": "fgrnt_bearer_<opaque>",   // ONE-TIME; never logged, never listed, never in projections
  "expires_at": "2026-06-20T12:00:00Z"
}
```

List/revoke responses use **`knowtation.flow_external_grant/v0` only** — never `bearer`.

---

## 2. Scoped grant model — `knowtation.flow_external_grant/v0`

### 2.1 Grant record (durable metadata — pointer-safe)

```jsonc
{
  "schema": "knowtation.flow_external_grant/v0",
  "grant_id": "fgrnt_<token>",          // fgrnt_ + [a-z0-9_]{8,48}; server-issued
  "vault_id": "default",
  "scope": "personal|project|org",      // derived from flow.scope ∩ caller write/read tier
  "flow_id": "flow_weekly_review",
  "flow_version": "1.2.0",             // pinned — mismatch at invoke ⇒ FLOW_EXTERNAL_GRANT_FLOW_MISMATCH
  "allowed_tools": ["web_search"],      // opaque ids only; ⊆ §3
  "allowed_harnesses": ["agent_bundle"], // v0: const single element
  "expires_at": "ISO8601",
  "issued_at": "ISO8601",
  "revoked_at": null,                   // set on revoke; revoked grants never re-activate
  "actor_hash": "<64-hex>",             // fnv/sha of actor_label + vault + issuer; never PII
  "max_invocations": 100,               // OPTIONAL cap; 0 = unlimited (policy may forbid)
  "invocation_count": 0                 // server-maintained; never client-writable
}
```

| Rule | Contract |
| --- | --- |
| **Opaque bearer** | The mint-time `bearer` is stored hashed server-side only (`grant_bearer_hash`); it never appears on the grant record, in list responses, in projections, or in logs. |
| **Short-lived** | Default TTL 3600s; policy max 86400s; expired ⇒ `403 FLOW_EXTERNAL_GRANT_EXPIRED`. |
| **Version-pinned** | A grant for `1.2.0` does not authorize `1.3.0` — external agents must re-mint on semver bump (anti-drift). |
| **Scope-bound** | Grant scope equals the Flow's canonical scope ∩ caller's visible tier; never widened by request body. |
| **Revocable** | Revoke is immediate; subsequent invoke/projection-with-grant fails `403 FLOW_EXTERNAL_GRANT_REVOKED`. |
| **No secret leakage** | `JSON.stringify(grant)` contains no `token`/`oauth`/`refresh_token`/note body/prompt/completion. |

### 2.2 Grant authorization headers (invoke + grant-scoped bundle fetch)

Hosted gateway reads reuse the **calendar step-12 pattern**: `Authorization: Bearer
<gateway_jwt>` + `X-Vault-Id` for transport auth. Grant scope is a **second** header —
never conflated with the gateway JWT:

```
Authorization: Bearer <gateway_jwt>       // KNOWTATION_AUTH_TOKEN class; transport auth
X-Vault-Id: <vault>
X-Flow-External-Bearer: fgrnt_bearer_<opaque>   // present only for grant-scoped fetch/invoke
X-Flow-Grant-Id: fgrnt_<token>                // optional cross-check; must match bearer when both present
```

Bundle fetch **without** `X-Flow-External-Bearer` succeeds when the caller can read the Flow
(transport auth only) and returns `grant_required: true` inside the bundle JSON — no tool
invoke. With the grant header, the server validates: bearer hash match, not revoked, not
expired, flow/version/tools/harness match, scope visible — deny-by-default on any mismatch.

---

## 3. Vault tool allowlist model

Tool allowlists are **vault policy**, not Flow-embedded secrets. Shape (config/policy file):

```yaml
external_agent:
  enabled: false                    # master switch; FLOW_EXTERNAL_AGENT_ENABLED mirrors this
  allowed_tools:
    - id: web_search                # opaque id; matches skill_refs[].id when kind=external_tool
      description: "Scoped web retrieval"
    - id: slack_notify
      description: "Post to allowed Slack channels"
  default_ttl_seconds: 3600
  max_ttl_seconds: 86400
  import_policy: reject_unknown     # reject | strip_inert — v0 default: reject (fail closed)
```

| Rule | Contract |
| --- | --- |
| **Deny by default** | An `external_tool` id not in `allowed_tools` ⇒ `403 FLOW_EXTERNAL_TOOL_DENIED` at grant mint; at import ⇒ `403 FLOW_IMPORT_EXTERNAL_TOOL_DENIED` (distinct code for telemetry). |
| **Flow intersection** | At grant mint, `requested_tools` must be ⊆ `allowed_tools` **and** ⊆ the union of `skill_refs` where `kind === 'external_tool'` on the pinned flow version's steps. |
| **Import enforcement (§6 item 3)** | On `flow_import`, every `external_tool` ref in the bundle is checked against the actor's vault allowlist **before** proposal creation. Unknown tools with `import_policy: reject` ⇒ refuse the entire import (no partial proposal). |
| **No widening from Flow text** | Step `instruction`/`boundaries` cannot add tools; only declared `skill_refs` count. |
| **Community Flows** | Imported Flows keep `external_tool` refs **inert** until a human approves the proposal **and** a grant is minted — import + approve alone does not activate tools. |

---

## 4. `external_tool` skill-ref activation rules

`SkillRefKind = external_tool` is parse-valid everywhere (FLOW-V0-SPEC §1.1) but **runtime-inert**
until **all** conditions hold:

| # | Condition | Failure code |
| --- | --- | --- |
| 1 | `FLOW_EXTERNAL_AGENT_ENABLED` is on (server) | `FLOW_EXTERNAL_AGENT_DISABLED` |
| 2 | Flow is **approved canonical** at the pinned `flow_version` (not `proposed`) | `FLOW_EXTERNAL_GRANT_DENIED` |
| 3 | Valid, non-revoked, non-expired grant with matching `flow_id` + `flow_version` | `FLOW_EXTERNAL_GRANT_EXPIRED` / `FLOW_EXTERNAL_GRANT_FLOW_MISMATCH` |
| 4 | Tool id ∈ `grant.allowed_tools` | `FLOW_EXTERNAL_GRANT_TOOL_DENIED` |
| 5 | Tool id ∈ vault allowlist (re-checked at invoke) | `FLOW_EXTERNAL_TOOL_DENIED` |
| 6 | Caller scope can **read** the Flow at its scope tier | `unknown_flow` (no existence leak) |

**Explicitly NOT activation paths:**

- **`flow_propose` / import** — refs are recorded but never invoked; 7A-L1 import rule stands.
- **Projection alone** — fetching `agent_bundle` without a grant returns the bundle with
  `grant_required: true` and **does not** enable invoke (read-only instruction delivery).
- **Automatable steps (7A-L3)** — `automatable: automatable` execution is a separate gate;
  `external_tool` invoke does not piggyback on run advancement in v0.

Future invoke surface (7A-L2b stubs only; full routing deferred if no tool providers yet):
`POST /api/v1/flows/external-tools/{tool_id}/invoke` — requires grant bearer + validated payload
schema per tool id; out of 7A-L2a scope beyond the error taxonomy entry.

---

## 5. `agent_bundle` harness — rendered shape

When `FLOW_EXTERNAL_AGENT_ENABLED` is on, `agent_bundle` is removed from `INERT_HARNESSES`
(7A-11 §1). Rendering rules inherit §2.1 invariants from
`FLOW-PROJECTION-GENERATOR-CONTRACT-7A-11.md` (marker-first, ordered, verbatim-inert step text,
no secrets, bounded bytes).

### 5.1 Inner payload — `knowtation.agent_bundle/v0` (inside `projection.rendered`)

The `rendered` field for `harness: agent_bundle` is **JSON text** (not Markdown):

```jsonc
{
  "schema": "knowtation.agent_bundle/v0",
  "flow_id": "flow_weekly_review",
  "flow_version": "1.2.0",
  "title": "Weekly review",
  "summary": "…",
  "scope": "personal",
  "generated_marker": "GENERATED FROM CANONICAL FLOW flow_weekly_review@1.2.0 — DO NOT EDIT",
  "grant_required": true,
  "allowed_tools": ["web_search"],     // §3 intersection at render time; may be [] if none declared
  "steps": [
    {
      "step_id": "flow_weekly_review#1",
      "ordinal": 1,
      "owned_job": "…",
      "instruction": "…",              // untrusted data — escaped, never executed at render
      "trigger": "…",
      "when_not_to_run": "…",
      "boundaries": ["…"],
      "output_shape": "…",
      "verification": { "kind": "human_review", "evidence_required": true, "description": "…" },
      "skill_refs": [{ "kind": "external_tool", "id": "web_search" }]  // opaque ids only
    }
  ],
  "fidelity": { "dropped_fields": [], "notes": null }
}
```

| Rule | Contract |
| --- | --- |
| **Read-only** | `generated_from_canonical: true`, `editable: false` on the outer `flow_projection/v0`. |
| **No bearer in bundle** | The JSON never contains a grant bearer, vault token, or OAuth material. |
| **Tool list is advisory** | `allowed_tools` reflects policy ∩ flow refs at render time; invoke still re-checks grant. |
| **Staleness** | Same envelope staleness as 7A-11 (`knowtation.flow_project/v0`); version lag ⇒ `stale: true`. |

### 5.2 Hosted projection read (gateway parity)

Loopback `GET …/projection?harness=agent_bundle` and hosted gateway reads return **identical**
`knowtation.flow_project/v0` envelopes when authorized. Hosted reads require:

| Control | Default | Effect |
| --- | --- | --- |
| **`FLOW_EXTERNAL_AGENT_ENABLED`** | off | When off, `agent_bundle` ⇒ `400 FLOW_HARNESS_UNSUPPORTED` (unchanged 7A-11 behavior). |
| **`FLOW_HOSTED_PROJECTION_ENABLED`** | off | When off, gateway rejects hosted `agent_bundle` projection with `403 FLOW_HOSTED_PROJECTION_DISABLED`; loopback may still serve when external-agent gate is on. |

Hosted hostname allowlist mirrors calendar step 12 (`api.knowtation.store`); pinning is enforced
server-side on the gateway and client-side in Scooling (consumer contract §3).

---

## 6. Import sandboxing (ratifies FLOW-V0-SPEC §6 item 3)

Extends `FLOW-AUTHORING-WRITEBACK-CONTRACT-7A-L1.md` §5:

| Rule | Contract |
| --- | --- |
| **Tool allowlist at import** | Before proposal creation, collect all `skill_refs` with `kind: external_tool`. Each id must be in vault `allowed_tools` or import fails (`FLOW_IMPORT_EXTERNAL_TOOL_DENIED`). |
| **Scope-checked** | Unchanged from 7A-L1 §5 (`FLOW_IMPORT_SCOPE_DENIED`). |
| **Review required** | Import creates `proposed` only; tools stay inert through approve. |
| **`external_tool` inert on import** | Satisfied: import never invokes tools; activation waits §4. |
| **No privilege escalation** | An imported Flow cannot add tools via `instruction` text; only schema-valid `skill_refs` count. |

---

## 7. Posture / gating (default off)

| Control | Where | Default | Tier to enable |
| --- | --- | --- | --- |
| **`FLOW_EXTERNAL_AGENT_ENABLED`** | Knowtation Hub/CLI/MCP policy | **off** | Tier 3 |
| **`FLOW_HOSTED_PROJECTION_ENABLED`** | Knowtation gateway | **off** | Tier 3 |
| **`FLOW_PROJECTION_WRITE_BACK_AUTHORIZED`** | Scooling compile-time | **false** | Tier 3 (consumer contract) |
| **`automatable` execution** | Knowtation | **inert** | 7A-L3 (unchanged) |
| **Classroom / minor policy** | Org policy | may forbid | May return `FLOW_EXTERNAL_AGENT_POLICY_FORBIDDEN` |

Enabling any control above is **out of scope** for 7A-L2a and 7A-L2b — impl ships with gates off.

---

## 8. Error taxonomy (opaque codes; no scope/id/secret leak)

New codes (7A-L2); existing codes reused unchanged:

| Code | Status | When |
| --- | --- | --- |
| `FLOW_EXTERNAL_AGENT_DISABLED` | 403 | gate off |
| `FLOW_EXTERNAL_AGENT_POLICY_FORBIDDEN` | 403 | org/classroom policy forbids |
| `FLOW_EXTERNAL_TOOL_DENIED` | 403 | tool id ∉ vault allowlist |
| `FLOW_EXTERNAL_TOOL_UNKNOWN` | 400 | tool id ∉ flow's declared `external_tool` refs |
| `FLOW_IMPORT_EXTERNAL_TOOL_DENIED` | 403 | import bundle declares tools outside allowlist |
| `FLOW_EXTERNAL_GRANT_DENIED` | 403 | mint denied (tier, flow not approved, etc.) |
| `FLOW_EXTERNAL_GRANT_EXPIRED` | 403 | past `expires_at` |
| `FLOW_EXTERNAL_GRANT_REVOKED` | 403 | `revoked_at` set |
| `FLOW_EXTERNAL_GRANT_FLOW_MISMATCH` | 403 | bearer grant does not match requested flow/version |
| `FLOW_EXTERNAL_GRANT_TOOL_DENIED` | 403 | invoke/fetch tool ∉ grant.allowed_tools |
| `FLOW_HOSTED_PROJECTION_DISABLED` | 403 | hosted gateway path off |
| `FLOW_HARNESS_UNSUPPORTED` | 400 | gate off ⇒ `agent_bundle` still inert (7A-11 parity) |
| `unknown_flow` | 404 | missing **or** scope-invisible (unchanged) |

Codes never carry vault ids, grant bearers, tool payloads, or raw Flow bodies.

---

## 9. Seven-tier test matrix (what each tier proves — design only)

Per `RULE #0`. 7A-L2b ships all seven tiers under `test/flow-external-agent-*.test.mjs`,
reusing `flows/starter/` bundles + a malicious-step bundle + a bundle with undeclared
`external_tool` refs + a higher-scope bundle. **No network in unit tests.** Every tier
runs with `FLOW_EXTERNAL_AGENT_ENABLED` toggled both ways.

| Tier | File | What it proves (representative cases) |
| --- | --- | --- |
| **unit** | `test/flow-external-agent-unit.test.mjs` | Grant record validates `knowtation.flow_external_grant/v0`; bearer never appears on grant list schema; allowlist intersection is deterministic; `agent_bundle` JSON schema validates; `INERT_HARNESSES` contains `agent_bundle` when gate off and excludes it when gate on (test hook). |
| **integration** | `test/flow-external-agent-parity-integration.test.mjs` | MCP mint, `POST …/external-grants`, and CLI `flow grant mint` produce deep-equal grant metadata; `flow project --harness agent_bundle` parity across three surfaces; gate off ⇒ identical `FLOW_HARNESS_UNSUPPORTED` / `FLOW_EXTERNAL_AGENT_DISABLED`. |
| **e2e** | `test/flow-external-agent-e2e.test.mjs` | approve Flow with `external_tool` ref → mint grant → fetch `agent_bundle` → invoke stub accepts bearer; revoke ⇒ invoke fails; version bump ⇒ grant mismatch; import with unknown tool ⇒ refused before proposal. |
| **stress** | `test/flow-external-agent-stress.test.mjs` | many concurrent mints; grant table bounded; expired grants cleaned; invocation_count increments atomically; no bearer logged under load. |
| **data-integrity** | `test/flow-external-agent-data-integrity.test.mjs` | `agent_bundle` round-trip preserves steps/skill_refs/verification/scope/version; allowlist intersection stable across re-render; export→import preserves external_tool refs but not activation; grant metadata survives list/revoke with no bearer field. |
| **performance** | `test/flow-external-agent-performance.test.mjs` | allowlist scan + bundle render within p95 on 100-step fixture; grant mint bounded; hosted/loopback parity adds no extra quadratic work. |
| **security** | `test/flow-external-agent-security.test.mjs` | scope denial; no existence leak; injection in `instruction`/bundle text inert; **no widening** (grant cannot exceed allowlist ∩ flow refs); expired/revoked/mismatched bearer denied; **no secrets** in grant list, bundle JSON, or logs; hosted hostname pinning rejects arbitrary hosts; import sandbox rejects undeclared tools. |

---

## 10. Acceptance (7A-L2a)

- Scoped grant wire shapes, vault tool allowlist model, `external_tool` activation rules,
  `agent_bundle` rendered JSON shape, hosted projection read contract, import sandboxing
  (FLOW-V0-SPEC §6 item 3), posture defaults, error taxonomy, and seven-tier test matrix
  are frozen here — **contract only, no implementation, no route, no OpenAPI edit, no
  posture flip.**
- Ratified against `FLOW-V0-SPEC.md` (§1.1, §6 item 3, §10 item 7),
  `FLOW-PROJECTION-GENERATOR-CONTRACT-7A-11.md` (`agent_bundle` inert → active),
  `FLOW-AUTHORING-WRITEBACK-CONTRACT-7A-L1.md` (§5 import tool rule), and the consumer
  contract `scooling/docs/FLOW-EXTERNAL-AGENT-LIVE-WIRE-CONTRACT-7A-L2.md`.
- SD-5 recorded in `scooling/docs/CROSS-REPO-COORDINATION.md`.
- Muse-committed on `feat/flow-projection-pilot`; handover regenerated to point at
  **7A-L2b** (Auto: `agent_bundle` renderer + grant handlers + hosted parity + seven-tier
  impl, all gates default off).

## Non-goals (7A-L2)

- No automatable step execution (7A-L3); no capture flywheel (7A-L4); no MuseHub enrichment
  (7A-L5).
- No flip of `FLOW_EXTERNAL_AGENT_ENABLED`, `FLOW_HOSTED_PROJECTION_ENABLED`, or Scooling
  `FLOW_PROJECTION_WRITE_BACK_AUTHORIZED` — enabling is Tier 3.
- No real third-party tool provider integrations beyond invoke **stubs** for test parity.

---

## Handoff notes (for 7A-L2b — Auto)

1. Branch is **`feat/flow-projection-pilot`**; this contract is Muse-committed. Always
   target Knowtation with `muse -C ~/knowtation …`.
2. Add `lib/flow/external-agent.mjs` (grant mint/revoke/list + allowlist helpers) and
   extend `projection-generator.mjs` with `renderAgentBundle` per §5; remove `agent_bundle`
   from `INERT_HARNESSES` only when `FLOW_EXTERNAL_AGENT_ENABLED` is on (runtime check, gate
   still defaults off).
3. Wire routes/MCP/CLI/OpenAPI **in the same change** as handlers (no docs-only PR to `main`).
4. Mirror Scooling consumer contract in `flowHubTransport.ts` + keep
   `createLiveFlowProjectionAdapter` unselected while posture is `false`.
5. Ship all seven tiers green before handover regen; gates stay off.
