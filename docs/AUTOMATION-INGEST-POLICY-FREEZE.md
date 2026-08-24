---
frozen: true
step: AIP-a
model: "Thinking (thinking-high)"
date: 2026-08-24
branch: feat/automation-ingest-policy-a
status: thinking-freeze-2026-08-24
supersedes: "Phase C + Lane D remain the machine credential and propose-path contract. This freeze adds per-account ingest rules so cron agent writes are not forced into Review as generic proposals. Does not authorize AIP-b Auto until freeze-review pass. Does not edit Scooling. Does not wire VideoFactory (AIP-c). Does not flip evaluation policy, billing enforce, or enable Born Free templates globally."
evidence: "Knowtation PRIMARY 2026-08-24 after KN-AUTH-LANE-D propose-path land. Cron agents with kt_agent_ still land every write in Review. Born Free / VideoFactory trend scout is the first integration test, not a hard-coded Hub hack."
---

# AUTOMATION-INGEST-POLICY — per-account ingest rules

**Ground truth** for AIP-b Auto. Downstream Auto may treat this document as ground truth without re-deriving. Phase C (`docs/DURABLE-AGENT-AUTH-PHASE-C-FREEZE.md`) remains the token-shape and mint/exchange contract. Lane D remains the health + isolation + one machine path contract. This freeze does **not** edit Scooling, change SEC-SEAM / personal self-apply / T5 fingerprints, grant `vault:write` on the cron JWT, let `agent_access` call `POST api/v1/proposals/:id/approve`, bypass elevated triggers or `auto_flag_reasons`, enable Born Free templates on every Hub, or implement VideoFactory (AIP-c).

```yaml
phase: AIP-a
outputs:
- id: automation-ingest-policy
  path: docs/AUTOMATION-INGEST-POLICY-FREEZE.md
  frozen: true
  notes: Per-sub ingest rules (match + disposition). Router first-match. POST api/v1/automation/ingest. Scope ingest:automation. direct_note is server-trusted write. proposal_auto_apply is a server hook, not approve. Born Free pack disabled. REST-only v1.
frozen_inputs:
- id: agent-credential-core
  path: hub/lib/agent-credential-core.mjs
  notes: ALLOWED_AGENT_SCOPES, DEFAULT_AGENT_SCOPES, applyScopeCeiling, agentScopesPermitMethod, PROPOSE_CREATE_PATHS, JWT cid + agent claims at exchange
- id: access-token-authz
  path: hub/gateway/access-token-authz.mjs
  notes: subFromVerifiedPayload, isAgentAccessPayload, isSessionBoundActor, roleFromMcpAccessScopes, mayApplyAdminAllowlistOverride
- id: gateway-get-user-id
  path: hub/gateway/server.mjs
  notes: getUserId uses effectiveRequestPath so propose allowlist sees api/v1/proposals not the Express suffix
- id: request-path
  path: hub/gateway/request-path.mjs
  notes: effectiveRequestPath is the only path string Auto may pass to agentScopesPermitMethod on gateway and self-hosted ingest/hook routes
- id: review-triggers
  path: lib/hub-proposal-review-triggers.mjs
  notes: applyReviewTriggers; elevated + auto_flag_reasons; packaged default + data/ override
- id: personal-self-apply
  path: lib/hub-proposal-personal-self-apply.mjs
  notes: roleEligibleForPersonalSelfApply refuses agent_access; T5 fingerprints unchanged
- id: proposal-create-augment
  path: lib/hub-proposal-create-augment.mjs
  notes: stripClientEvaluationFields + triggers + E1 after triggers
- id: proposal-lifecycle
  path: docs/PROPOSAL-LIFECYCLE.md
  notes: States, roles, personal self-apply, review_queue / review_severity / auto_flag_reasons
- id: phase-c-freeze
  path: docs/DURABLE-AGENT-AUTH-PHASE-C-FREEZE.md
  notes: propose is not approve; propose path allowlist; default scopes propose + vault:read; consumer trend-agent is follow-on
- id: audit-log
  path: hub/audit-log.mjs
  notes: Existing JSONL hub_audit.log; AIP extends actions, does not invent a second log family
- id: billing-middleware
  path: hub/gateway/billing-middleware.mjs
  notes: note_write vs proposal_write; ingest handler chooses op after route
- id: list-notes
  path: lib/list-notes.mjs
  notes: filterNotesByListOptions; content_class filter is additive
- id: hub-provenance
  path: lib/hub-provenance.mjs
  notes: mergeProvenanceFrontmatter kind agent already exists
- id: proposals-store
  path: hub/proposals-store.mjs
  notes: createProposal + updateProposalStatus for self-hosted auto-apply mark
review_stamp:
  reviewed_at: '2026-08-24T14:05:38Z'
  verdict: pass
  reviewer_mode: agent
  reviewer_model: thinking-high
  reviewer_provider: local
  kit_version: 0.1.0
  artifact_digest: sha256:9fded978386543865225f5cc2bc0f04f09e777f8de96a56ef5d516c995a2793c
downstream:
- id: AIP-b
  model: Auto
  consumes_as_ground_truth: true
  notes: Implement router, ingest route, scope, Settings CRUD, Research filter, audit, seven-tier tests. Starts only after freeze-review pass. Auto does not edit Scooling. Auto does not enable Born Free templates. Auto does not claim production smoke.
- id: AIP-c
  model: Thinking → Auto
  consumes_as_ground_truth: true
  notes: VideoFactory trend-scout wire. Not this Hub Auto. Appendix A is the contract edge only.
tier3_gates:
- T1 Muse main or muse-mirror to GitHub main (SD-14) outside SD-21 land hygiene
- T2 Production ingest smoke on api.knowtation.store (Operator; record PASS or FINDINGS)
- T3 Enabling packaged Born Free templates as enabled-true in the default JSON (global opt-in)
- T4 Changing SEC-SEAM / personal self-apply / T5 fingerprints or admitting agent_access to E1
- T5 Granting vault:write on DEFAULT_AGENT_SCOPES or requiring vault:write for cron ingest
- T6 Teaching agent_access to call POST api/v1/proposals/:id/approve
- T7 Flipping BILLING_ENFORCE or inventing unscoped long-lived API keys
- T8 Editing Scooling or VideoFactory from this Knowtation tip
- T9 Feature branch to GitHub main / non-muse-mirror head
```

Auto must not build until freeze review **pass**. This Thinking tip does **not** implement routes. This Thinking tip does **not** flip any env.

## Review record

| Round | Reviewer | Verdict | Resolution |
| --- | --- | --- | --- |
| 0 | Thinking (this session) | draft | Freeze authored from Phase C + Lane D + review triggers + self-apply + getUserId propose-path + billing + list-notes |
| 1 | Freeze-review loop (thinking) | findings | R1-F1–F7 fixed below. Mechanical dry-run was already pass. |
| 2 | Freeze-review loop (thinking) | findings | R2-F1–F3 fixed below. |
| 3 | Freeze-review loop (thinking) + `ok review --freeze` + `ok check-ok --path` | **pass** | R1–R2 hold. Interfaces, fail-closed, seven-tier matrix, Tier-3 gates present. No open design decisions for Auto. No escalating category. Digest in `review_stamp.artifact_digest`. Cleared for AIP-b Auto. Auto must not edit Scooling, enable Born Free templates, or claim production smoke. |

### Round 1 findings (cited — file+line)

| ID | Sev | Cat | Citation | Finding | Fix |
| --- | --- | --- | --- | --- | --- |
| R1-F1 | MAJOR | completeness | docs/AUTOMATION-INGEST-POLICY-FREEZE.md:465 (prior “Auto may call”) | Hosted auto-apply mark was unbound. Auto could invent Motoko or skip status flip. | D23 locks gateway `fetch` to canister approve with gateway auth only; D23 failure code. |
| R1-F2 | MAJOR | completeness | docs/AUTOMATION-INGEST-POLICY-FREEZE.md:443 (prior “override or helper”) | Billing hook was an “or”. Auto could double-charge or skip storage cap. | D24 locks `opts.operation` on `runBillingGate`. |
| R1-F3 | MAJOR | completeness | docs/AUTOMATION-INGEST-POLICY-FREEZE.md:348 (prior store-or-frontmatter) | `content_class` persist unbound. Auto could edit `proposals-store` ad hoc. | D25 frontmatter only. |
| R1-F4 | MAJOR | completeness | docs/AUTOMATION-INGEST-POLICY-FREEZE.md:450 (prior “GET existing note”) | D22 I/O unbound. | D22 names `readNote` and canister GET. |
| R1-F5 | MAJOR | completeness | docs/AUTOMATION-INGEST-POLICY-FREEZE.md:434 (prior execute “may”) | Policy vs I/O split unbound; D26 later conflicted. | D26 pure exports; execute in route wrappers. |
| R1-F6 | MINOR | completeness | docs/AUTOMATION-INGEST-POLICY-FREEZE.md:574 (prior PATCH sugar) | Auto could add PATCH. | PATCH forbidden in v1. |
| R1-F7 | MINOR | completeness | docs/AUTOMATION-INGEST-POLICY-FREEZE.md:640 (prior skip audit) | Hosted audit could no-op. | Same `dataDir` as augment; always append. |

### Round 2 findings (cited — file+line)

| ID | Sev | Cat | Citation | Finding | Fix |
| --- | --- | --- | --- | --- | --- |
| R2-F1 | MAJOR | completeness | docs/AUTOMATION-INGEST-POLICY-FREEZE.md:226 (prior D26 store-only) | Idempotency persist names unbound. Auto could invent a third file. | D26 names `getIngestIdempotency` / `putIngestIdempotency` on the store module. |
| R2-F2 | MAJOR | completeness | docs/AUTOMATION-INGEST-POLICY-FREEZE.md:748 (prior “if a new blob”) | Netlify blob globals unbound. Auto could reuse billing/agent blobs. | D27 two dedicated blobs + globals. |
| R2-F3 | MINOR | completeness | docs/AUTOMATION-INGEST-POLICY-FREEZE.md:729-736 (prior “if needed”) | File list still had optional edits. | access-token-authz and audit-log are do-not-edit; D8 hook is required. |

## Citation discipline

Every freeze-review finding MUST cite **file+line** (OVERSEER-KIT-SPEC §6). Do not
trust uncited review output. HTTP routes in this doc omit the leading slash
(`api/v1/…`) so the freeze mechanical gate does not treat them as absolute machine
paths. Cross-repo paths use `~/scooling/…`. Never leading-slash absolute paths.

---

## 1. Plain-language summary

Robots with `kt_agent_` credentials can already create proposals. Every one of those writes still lands in Review as a generic proposal. Operators need a Settings page of **ingest rules**: for matching robot writes, choose **write the vault note now**, **create a proposal and apply it on the server**, or **leave it in Review** (today’s default). Elevated legal/security triggers still win. Robots never get a blanket vault-write password. Born Free is a **disabled template pack** the operator turns on for one account — not three rules baked into every Hub.

### Technical summary

AIP adds `ingest:automation` to the Phase C scope vocabulary; a first-match per-sub rule router; `POST api/v1/automation/ingest` as the preferred cron entrypoint; a required agent-only hook on `POST api/v1/proposals` when the body matches the ingest contract (D8); server-trusted `direct_note` (canister or `writeNote`, billing `note_write`); `proposal_auto_apply` as create-then-server-apply (never the approve HTTP route; never E1); `review_queue` via existing augment + triggers; `content_class` list filter; JSONL audit actions on `hub_audit.log`. MCP is **out of v1**. REST only.

---

## 2. Ground truth — what the code does today (file+line)

Every row was read in this session.

| # | Fact | Citation |
| --- | --- | --- |
| G1 | Allowed agent scopes are `vault:read`, `propose`, `vault:write` only | `hub/lib/agent-credential-core.mjs:27` |
| G2 | Default mint scopes are `propose` + `vault:read` | `hub/lib/agent-credential-core.mjs:29` |
| G3 | `applyScopeCeiling` always keeps `propose`; `vault:write` needs role write | `hub/lib/agent-credential-core.mjs:110-116` |
| G4 | `propose` without write allows only three POST paths | `hub/lib/agent-credential-core.mjs:411-433` |
| G5 | `vault:write` (or admin) short-circuits `agentScopesPermitMethod` to allow all | `hub/lib/agent-credential-core.mjs:427-429` |
| G6 | Exchange JWT already carries `cid` and `agent` (credential name) | `hub/gateway/agent-credential-routes.mjs:226-236` |
| G7 | `subFromVerifiedPayload` enforces aud, typ, and `agentScopesPermitMethod` | `hub/gateway/access-token-authz.mjs:173-178` |
| G8 | `isSessionBoundActor` is true only for `type: session` | `hub/gateway/access-token-authz.mjs:69-70` |
| G9 | Gateway `getUserId` passes `effectiveRequestPath` (Lane D propose-path fix) | `hub/gateway/server.mjs:1959-1967` |
| G10 | Gateway catch-all `app.use('api/v1')` bills then `proxyToCanister` | `hub/gateway/server.mjs:4466-4469` |
| G11 | Self-hosted `jwtAuth` verifies JWT only — no `agentScopesPermitMethod` | `hub/server.mjs:395-406` |
| G12 | Self-hosted `POST api/v1/proposals` inlines triggers; does not call `augmentProposalCreateRequestBody` | `hub/server.mjs:3194-3231` |
| G13 | Hosted create runs `augmentProposalCreateForHosted` → augment + E1 | `hub/gateway/server.mjs:3790-3808` |
| G14 | `applyReviewTriggers` sets `forcePending`, queue, severity, `auto_flag_reasons` | `lib/hub-proposal-review-triggers.mjs:119-165` |
| G15 | E1 runs after triggers; elevated or auto-flag stay pending | `lib/hub-proposal-create-augment.mjs:78-84` |
| G16 | `roleEligibleForPersonalSelfApply` refuses `tokenType === 'agent_access'` | `lib/hub-proposal-personal-self-apply.mjs:437-440` |
| G17 | Hosted approve path refuses agents via `humanActor: false` + `tokenType: agent_access` | `hub/gateway/server.mjs:3575-3616` |
| G18 | Phase C denies approve/discard/notes write even with `propose` | `docs/DURABLE-AGENT-AUTH-PHASE-C-FREEZE.md:330` |
| G19 | Billing maps `POST api/v1/notes` and `PUT` notes to `note_write`; proposals to `proposal_write` | `hub/gateway/billing-middleware.mjs:26-40` |
| G20 | `filterNotesByListOptions` has no `content_class` key | `lib/list-notes.mjs:57-119` |
| G21 | Vault filter `filter-content-scope` is notes vs approval logs only | `web/hub/index.html:180-184` |
| G22 | Audit append is JSONL on `hub_audit.log` | `hub/audit-log.mjs:18-30` |
| G23 | Provenance `kind` already includes `agent` | `lib/hub-provenance.mjs:37` |
| G24 | Self-hosted approve writes via `writeNote`; store can `updateProposalStatus` | `hub/server.mjs:3378`; `hub/proposals-store.mjs:353-368` |
| G25 | Canister note IO uses `x-user-id`, `x-actor-id`, `x-vault-id`, plus `canisterAuthHeaders()` | `hub/gateway/server.mjs:3663-3670` |
| G26 | Settings tabs today: backup, team, vaults, integrations, appearance, billing, consolidation — no Automation tab | `web/hub/index.html:705-713` |
| G27 | Mint UI checkboxes: propose, vault:read, vault:write | `web/hub/index.html:1448-1450` |
| G28 | Phase C consumer contract still posts `api/v1/proposals` (not ingest) | `docs/DURABLE-AGENT-AUTH-PHASE-C-FREEZE.md:381` |
| G29 | PROPOSAL-LIFECYCLE says agents create `proposed` rows via `POST api/v1/proposals` | `docs/PROPOSAL-LIFECYCLE.md:18` |

**Consumer evidence (operator-reported, not in this workspace):** Born Free / VideoFactory trend scout posts Hub proposals after `kt_agent_` exchange. Lane D unblocked `POST api/v1/proposals`. Those rows still queue as generic Review items. Trend-agent source is not a Knowtation tree. AIP-b does **not** edit VideoFactory. Appendix A freezes the Hub-side contract edge only.

---

## 3. Frozen product goal

An operator signed into Hub can:

1. Open **Settings → Automation → Ingest rules**.
2. See packaged templates (Born Free pack) as **disabled**. Enable or copy a template for **this account only**.
3. Order rules by **priority** (lower number wins). First matching **enabled** rule decides the write.
4. Choose per rule: **direct vault note**, **server auto-apply proposal**, or **Review queue**.
5. Mint a cron credential with **`ingest:automation` + `vault:read`** (no `vault:write`).
6. Point the robot at `POST api/v1/automation/ingest` (preferred). Existing `POST api/v1/proposals` still works for humans; agents with an ingest-shaped body may hit the same router.
7. Filter Vault by **Research** (`content_class=research`).

Success metric: a matching Born Free trend write can land as a research note or an auto-applied proposal **only after the operator enables a rule**; unmatched or flagged writes stay in Review; `agent_access` still cannot approve.

---

## 4. Decisions (lock — do not reopen in Auto)

| ID | Decision | Recorded default |
| --- | --- | --- |
| **D1** | Router | **First-match.** Sort enabled rules by `priority` ascending, then `rule_id` lexicographic. First AND-match wins. No specificity score. |
| **D2** | Default disposition | No enabled match → `review_queue` (today’s behavior). |
| **D3** | Match empty | Forbidden. At least one predicate required. Blank match is `400` `INGEST_RULE_MATCH_EMPTY`. |
| **D4** | Match combinator | All specified predicates **AND**. Unspecified keys are wildcards. |
| **D5** | Scope | New `ingest:automation`. Additive like `propose` in `applyScopeCeiling`. Not in `DEFAULT_AGENT_SCOPES`. |
| **D6** | Cron mint | Recommended `ingest:automation` + `vault:read`. Checkbox default **off**. Never require `vault:write`. |
| **D7** | Ingest path allowlist | `POST` + normalized path `api/v1/automation/ingest` requires `ingest:automation` (or `vault:write`, existing short-circuit). `propose` alone does **not** open the ingest route. |
| **D8** | Legacy proposals hook | **On** for `agent_access` only when the body matches the ingest contract (D14). Session / human callers never enter the router. |
| **D9** | Elevated / flags | After match, **before** execute, run `applyReviewTriggers`. If `forcePending` or `review_severity === 'elevated'` or `auto_flag_reasons.length > 0` → force `review_queue` and audit `ingest_elevated_override`. All three dispositions. |
| **D10** | Evaluation vs auto-apply | If evaluation policy would leave `evaluation_status` `pending` (E1 does not apply to agents — G15, G16) → **cannot** `proposal_auto_apply`; fall back to `review_queue`. Do **not** invent ingest-E1. Do **not** stamp `evaluation_status: passed` for robots. |
| **D11** | Approve HTTP | `agent_access` never calls `POST api/v1/proposals/:id/approve`. Auto-apply uses `writeNote` / canister note POST + `updateProposalStatus` / hosted status flip **without** forwarding the agent Bearer to approve. |
| **D12** | direct_note vs JWT | Server-trusted write only. JWT does not need `vault:write`. |
| **D13** | MCP | **REST-only v1.** No MCP tool, prompt, or resource. |
| **D14** | Ingest contract body | See §6.2. Required `source_fingerprint`. Marker is `ingest === true` **or** a known `content_class`. |
| **D15** | Idempotency precedence | If header `X-Ingest-Idempotency-Key` is non-empty after trim → that is the store key. Else key = `source_fingerprint`. See §8. |
| **D16** | Born Free pack | Packaged templates, all `enabled: false`. Never copy into a new sub as enabled. Operator enable is per-sub CRUD. |
| **D17** | Settings chrome | New Settings tab **Automation** (`data-settings-tab="automation"`). Ingest rules live there. Pointer line under Integrations → Agent credentials. |
| **D18** | Rule cap | Max **32** enabled+disabled user rules per sub (templates in the pack do not count until copied). |
| **D19** | Self-hosted agent auth | Ingest route and the proposals hook **must** call `agentScopesPermitMethod` with `effectiveRequestPath(req)` from `hub/gateway/request-path.mjs` (G11 is a gap). Do not rewrite all of `jwtAuth` in this Auto. |
| **D20** | Hosted mount | Dedicated `app.post` for ingest **before** the catch-all at `hub/gateway/server.mjs:4466`. |
| **D21** | Scooling | No edits. No T5 fingerprint changes. |
| **D22** | Path clobber | `direct_note` / auto-apply write to an existing path is allowed only on idempotent replay (same fingerprint) or if existing frontmatter `source_fingerprint` equals the request. Else `409` `INGEST_PATH_CONFLICT`. Self-hosted existence check is `readNote` in `lib/vault.mjs`. Hosted existence check is `GET` canister `api/v1/notes/<path>` with the same headers as G25. Missing note is not a conflict. |
| **D23** | Hosted auto-apply mark | Gateway `fetch`es `${CANISTER_URL}` + `api/v1/proposals/<id>/approve` with `POST`, `canisterAuthHeaders()`, `x-user-id`, `x-actor-id`, `x-vault-id`, JSON `{}`. **No** inbound agent `Authorization` header is copied. Incoming agent HTTP to that path still hits `assertHostedProposalApproveDiscard` (G17). If this mark fails after the note write, respond `500` `INGEST_APPLY_FAILED` with `proposal_id` + `path`; do **not** delete the note; audit `ingest_apply_failed`. |
| **D24** | Billing hook | Extend `runBillingGate` with `opts.operation`. When set, that string replaces `operationFromRequest`. Ingest calls it **after** route: `proposal_write` for §9.1; `note_write` for §9.2 and §9.3. When `opts.operation === 'note_write'`, also run the existing storage-cap branch (`getNoteCount`). Do **not** add a path regex for ingest that always maps to `note_write`. |
| **D25** | `content_class` persist | Stamp on **frontmatter only** (note and proposal). Do **not** add a `proposals-store` column. List filter reads `n.content_class ?? n.frontmatter?.content_class`. Response `content_class` is computed. |
| **D26** | Module exports | `lib/automation-ingest-policy.mjs` (pure) exports `routeAutomationIngest`, `isIngestContractBody`, `normalizeIngestBody`, `listPackTemplates`. `hub/gateway/automation-ingest-store.mjs` exports `loadIngestRulesForSub`, `saveIngestRulesForSub`, `getIngestIdempotency`, `putIngestIdempotency` (file + blob). Execute I/O stays in `hub/gateway/server.mjs` and `hub/server.mjs` wrappers — not in the pure module. |
| **D27** | Netlify blobs | `netlify/functions/gateway.mjs` provisions **two** new dedicated blobs: `gateway-automation-ingest-rules` → `globalThis.__knowtation_gateway_ingest_rules_blob` and `gateway-automation-ingest-idempotency` → `globalThis.__knowtation_gateway_ingest_idempotency_blob`. Never reuse `gateway-agent-credentials` or `gateway-billing`. |

---

## 5. Rule schema (frozen)

### 5.1 Rule object

```json
{
  "rule_id": "ingr_<16 hex>",
  "enabled": false,
  "priority": 100,
  "pack_id": null,
  "label": "Trend scout → Review",
  "match": {
    "credential_id": null,
    "credential_name": null,
    "credential_name_prefix": null,
    "path_prefix": "inbox/trends/",
    "intent": null,
    "content_class": "research"
  },
  "disposition": "review_queue",
  "content_class": "research"
}
```

| Field | Type | Rules |
| --- | --- | --- |
| `rule_id` | string | Server-minted `ingr_` + 16 lowercase hex. Client cannot supply on create. |
| `enabled` | boolean | Disabled rules are skipped by the router. |
| `priority` | integer | `0`–`10000`. Lower wins. Default `100`. |
| `pack_id` | string or null | `born_free_v1` when copied from the pack; else null. |
| `label` | string | 1–128 chars. Required. |
| `match` | object | At least one non-null predicate (D3). |
| `disposition` | enum | Exact: `direct_note` \| `proposal_auto_apply` \| `review_queue`. |
| `content_class` | enum or null | Stamp when request omits class. Closed set §7. |

### 5.2 Match predicates

| Key | Match | Source |
| --- | --- | --- |
| `credential_id` | exact, case-sensitive | JWT claim `cid` (G6). If claim missing → predicate fails (no store lookup required in v1). |
| `credential_name` | exact, case-sensitive | JWT claim `agent` (G6). Missing claim → fail. |
| `credential_name_prefix` | `agent` starts with prefix (case-sensitive) | Same claim. |
| `path_prefix` | `notePathMatchesPrefix` (`lib/write.mjs:49-52`) | Request `path`. Normalize slashes; no leading slash. |
| `intent` | exact | Request `intent`. |
| `content_class` | exact | Request `content_class` after defaulting (§7). |

Null / omitted / empty-string predicates are skipped (wildcard). After skip, **zero** remaining predicates → invalid rule (D3).

### 5.3 Disposition enum

| Value | Meaning |
| --- | --- |
| `direct_note` | Server writes the note. No Review row unless D9/D22 forces queue. |
| `proposal_auto_apply` | Create proposal (augment + triggers) then server-apply if D9 and D10 allow. |
| `review_queue` | Create proposal only. Today’s path. |

Unknown disposition on save → `400` `INGEST_DISPOSITION_UNKNOWN`.

---

## 6. Router (frozen)

Export **`routeAutomationIngest(input, rules)`** from `lib/automation-ingest-policy.mjs`. Pure. No I/O.

### 6.1 Algorithm

1. Take `rules` for `input.sub` only (caller loads storage).
2. Drop `enabled !== true`.
3. Sort by `priority` ascending, then `rule_id` ascending (UTF-8).
4. For each rule, evaluate §5.2 AND. First true → candidate.
5. If none → candidate `{ rule_id: null, disposition: 'review_queue', content_class: input.content_class }`.
6. Run `applyReviewTriggers` on `{ path, body, intent, labels }` (G14). If D9 trips → rewrite disposition to `review_queue`, set `elevated_override: true`, keep `rule_id` of the candidate (or null).
7. If candidate disposition is `proposal_auto_apply` and D10 trips (`evaluationRequired === true` and E1 will not stamp — agents never session-bound) → rewrite to `review_queue`, set `evaluation_block: true`.
8. Return `{ rule_id, disposition, content_class, elevated_override, evaluation_block, trigger_result }`.

`content_class` on the result: request class if known; else rule `content_class`; else `general`.

### 6.2 Ingest request body (preferred route)

`POST api/v1/automation/ingest`

**Auth:** `agent_access` with `ingest:automation` (D7) **or** session `editor`/`admin` (operator test from Settings). Vault: `X-Vault-Id` must pass `assertAgentVaultAllowed` for agents (Phase C §7.4).

```json
{
  "path": "inbox/trends/example.md",
  "body": "markdown",
  "frontmatter": {},
  "intent": "videofactory.trend_scout.ingest",
  "labels": [],
  "source": "automation_ingest",
  "source_fingerprint": "sha256:…-or-opaque-8-to-128",
  "content_class": "research",
  "ingest": true
}
```

| Field | Required | Rules |
| --- | --- | --- |
| `path` | yes | Vault-relative. No `..`. No leading slash. Max 512. Must end `.md`. |
| `body` | yes | String. Max 512 KiB. |
| `frontmatter` | no | Object. Reserved provenance keys stripped (`lib/hub-provenance.mjs`). |
| `intent` | no | String max 256. |
| `labels` | no | String array, max 32, each max 64. |
| `source` | no | Default `automation_ingest`. Max 64. |
| `source_fingerprint` | **yes** | Trimmed 8–128 chars. Charset `[A-Za-z0-9._:/-]`. |
| `content_class` | no | §7. Unknown → `400` `INGEST_CONTENT_CLASS_UNKNOWN`. |
| `ingest` | no | Boolean. Ignored on the ingest route (always ingest). Required as a marker on the legacy hook unless `content_class` is known (D14). |

**Headers**

| Header | Required | Rules |
| --- | --- | --- |
| `Authorization` | yes | Bearer session or `agent_access`. |
| `X-Vault-Id` | no | Default `default`; must be in `vault_ids` for agents. |
| `X-Ingest-Idempotency-Key` | no | Trimmed 8–128. Same charset as fingerprint. Precedence D15. |

### 6.3 Success response

`201` on first apply/create. `200` on idempotent replay (`replayed: true`).

```json
{
  "disposition": "review_queue",
  "rule_id": "ingr_ab12cd34ef567890",
  "outcome": "proposal",
  "path": "inbox/trends/example.md",
  "content_class": "research",
  "proposal_id": "prop-…",
  "note": null,
  "replayed": false,
  "elevated_override": false,
  "evaluation_block": false
}
```

| `outcome` | When |
| --- | --- |
| `note` | `direct_note` write succeeded |
| `proposal` | Review row created (queue or auto-apply-created) |
| `note_and_proposal` | `proposal_auto_apply` wrote the note and marked approved |

`proposal_id` required when a proposal exists. `note` is `{ "path": "…" }` when a note was written.

### 6.4 Error codes (closed)

| HTTP | `code` |
| --- | --- |
| 400 | `INGEST_PATH_INVALID`, `INGEST_BODY_REQUIRED`, `INGEST_FINGERPRINT_REQUIRED`, `INGEST_FINGERPRINT_INVALID`, `INGEST_CONTENT_CLASS_UNKNOWN`, `INGEST_CONTRACT_REQUIRED` (legacy hook body mismatch — should not appear on the ingest route), `INGEST_RULE_MATCH_EMPTY`, `INGEST_DISPOSITION_UNKNOWN` |
| 401 | `UNAUTHORIZED` |
| 403 | `AGENT_VAULT_FORBIDDEN`, `FORBIDDEN` |
| 409 | `INGEST_IDEMPOTENCY_CONFLICT`, `INGEST_PATH_CONFLICT` |
| 402 | billing codes from `runBillingGate` unchanged |
| 429 | existing agent rate limit if any |
| 500 | `INGEST_APPLY_FAILED` (D23 only) |
| 503 | `AGENT_CREDENTIAL_STORE_UNAVAILABLE` / store I/O on rules or idempotency |

Do not invent extra codes in Auto.

### 6.5 Legacy `POST api/v1/proposals` hook (D8)

Runs **only** when **all** hold:

1. Verified payload `type === 'agent_access'` (G8 inverse).
2. Method `POST` and normalized path is exactly `api/v1/proposals` (not `…/approve`, not task/flow facades).
3. Body matches ingest contract (D14): non-empty valid `source_fingerprint` **and** (`ingest === true` **or** known `content_class`).

Then the handler calls the same router + execute as the ingest route (scope already allowed via `propose` on this path — G4). Response **shape** is the ingest success/error envelope (not the raw `createProposal` object) so cron clients can share a parser. HTTP status 201/200 as §6.3.

If (1) or (3) fail → **existing** create path unchanged (G12 / G13). Session callers with `source_fingerprint` set still use existing create. That is intentional (do not hijack Hub UI / CLI humans).

Task / media / flow / path facade POSTs are **not** ingest. Do not hook them.

---

## 7. `content_class` + Research filter

Closed enum (lowercase):

| Value | Meaning |
| --- | --- |
| `research` | Research / scout notes. Vault filter **Research**. |
| `ops` | Operational automation. |
| `general` | Default when omitted. |

Stamp:

- Note frontmatter key `content_class` (string). Server sets; client cannot override reserved provenance but **can** send `content_class` (not in RESERVED — G23). Server overwrites with the routed class.
- Proposal `frontmatter.content_class` only (D25). Do **not** invent a store column. Do **not** add a fake `research` label unless the client sent that label.

**List filter:** add `content_class` to `filterNotesByListOptions` (G20). Exact match on `n.content_class ?? n.frontmatter?.content_class`. Query `GET api/v1/notes?content_class=research`.

**Hub UI:** new `<select id="filter-content-class">` immediately after `#filter-content-scope` (G21). Options: All classes, Research, Ops, General. Client-side mirror in `hub.js` (hosted list already filters client-side — `web/hub/hub.js` near the `filter-content-scope` branch).

Do not overload `content_scope` (notes vs approval logs).

---

## 8. Idempotency (frozen)

Store file: `data/automation_ingest_idempotency.json` (self-hosted / gateway data dir). Hosted blob name `gateway-automation-ingest-idempotency`, persist key `automation-ingest-idempotency-v1`. Shape:

```json
{
  "version": 1,
  "entries": {
    "<sub>\\t<vault_id>\\t<key>": {
      "source_fingerprint": "…",
      "path": "…",
      "result": { },
      "created_at": 0,
      "expires_at": 0
    }
  }
}
```

| Rule | Value |
| --- | --- |
| Key | D15 |
| TTL | **30 days** from first write. Expired entries ignored (treat as miss). |
| Replay | Same key **and** same `source_fingerprint` **and** same `path` → return stored `result` with `replayed: true`, **no** second billing deduct, **no** second write. |
| Conflict | Same key, different fingerprint or path → `409` `INGEST_IDEMPOTENCY_CONFLICT`. |
| In-flight | v0 last-write-wins on the JSON file. No `409` `INGEST_IN_PROGRESS`. |

`result` is the §6.3 JSON object (without forcing a new `proposal_id`).

---

## 9. Execute paths (frozen)

I/O stays in gateway / `hub/server.mjs` wrappers that call `routeAutomationIngest` then §9.1–§9.3. The policy module stays pure (D26). Do not duplicate trigger logic.

### 9.1 `review_queue`

1. Build create payload: path, body, frontmatter (stamp `content_class`, `source_fingerprint`, `source`), intent, labels, `proposed_by` = actor sub.
2. Hosted: existing `augmentProposalCreateForHosted` (G13). Self-hosted: **must call `augmentProposalCreateRequestBody`** (close G12 for this path only — do not leave ingest on the inline trigger copy).
3. Persist proposal (`createProposal` / canister POST proposals).
4. Do not write the note.
5. Audit `ingest_review_queued`.
6. Billing: D24 — `runBillingGate(..., { operation: 'proposal_write' })`.

E1 still runs inside augment and still fails for `agent_access` (G15, G16). That is correct.

### 9.2 `direct_note`

1. D9 already applied. If override → §9.1 instead.
2. D22 path-conflict check (`readNote` self-hosted; canister `GET api/v1/notes/<path>` hosted). Compare existing frontmatter `source_fingerprint`.
3. Merge frontmatter via `mergeProvenanceFrontmatter(..., { sub, kind: 'agent' })` (G23). Stamp `content_class`, `source_fingerprint`, `source`.
4. **Self-hosted:** `writeNote(vaultPath, path, { body, frontmatter })` — same function as `POST api/v1/notes` (`hub/server.mjs:2574`). Do **not** go through `requireRole('editor')` on the agent JWT; the ingest handler is the trusted caller.
5. **Hosted:** `POST` `${CANISTER_URL}/api/v1/notes` with headers `Accept`, `Content-Type`, `x-user-id` = owner effective id, `x-actor-id` = uid, `x-vault-id`, `...canisterAuthHeaders()` (G25). Body `{ path, body, frontmatter }`. **Do not** forward the agent Bearer to the canister as a write grant.
6. Billing: D24 — `runBillingGate(..., { operation: 'note_write', getNoteCount: getNoteCountForUser })`.
7. Audit `ingest_direct_note`.
8. No proposal row.

### 9.3 `proposal_auto_apply`

1. D9 / D10 already applied. If either trips → §9.1.
2. Create proposal as §9.1 (so Review/Activity has an audit row) with `source: automation_ingest`.
3. Write the note as §9.2 steps 2–6 (same trusted write).
4. Mark proposal `approved` (D23):
   - Self-hosted: `updateProposalStatus(dataDir, id, 'approved')` (G24). Do **not** run Express `POST api/v1/proposals/:id/approve` or `requireApproveRole`.
   - Hosted: gateway `fetch` to canister approve path per D23 (gateway auth only). Incoming agent HTTP still hits G17.
   - Mark failure after a successful note write → `500` `INGEST_APPLY_FAILED` (D23). Do not delete the note.
5. Do **not** call `applyPersonalSelfApplyEvaluationE1` with fake sessionBound. Do **not** add `agent_access` to `roleEligibleForPersonalSelfApply`.
6. Audit `ingest_auto_applied` on full success; `ingest_apply_failed` on D23 failure.
7. Billing: D24 `note_write` once. Do not also charge `proposal_write` on the same ingest.

### 9.4 What must not happen

- `agent_access` HTTP `POST api/v1/proposals/:id/approve` → still 401/403 (G4, G17, G18).
- `direct_note` granting `vault:write` on mint or JWT.
- Skipping `applyReviewTriggers`.
- Using E1 / T5 fingerprints for ingest.
- Enabling pack templates in the packaged JSON.

---

## 10. Scope + mint (frozen)

### 10.1 Vocabulary

Add `ingest:automation` to `ALLOWED_AGENT_SCOPES` (G1). Keep `FORBIDDEN_AGENT_SCOPES` unchanged.

`DEFAULT_AGENT_SCOPES` stays `propose` + `vault:read` (G2). **Do not** add ingest to the default.

`applyScopeCeiling`: treat `ingest:automation` like `propose` — always keep it if requested (G3). Members can mint it.

### 10.2 `agentScopesPermitMethod`

Keep G5 short-circuit (`vault:write` / admin → allow).

Add **before** the propose-path check:

- If `POST` and `normalizeAgentRequestPath(path) === 'api/v1/automation/ingest'` → allow iff list includes `ingest:automation`.

Then existing: safe → `vault:read`; mutating → `propose` + `PROPOSE_CREATE_PATHS` (G4).

`ingest:automation` does **not** add ingest to `PROPOSE_CREATE_PATHS`. It does **not** allow notes POST, approve, discard, enrich, or evaluation write.

CRUD routes (`api/v1/automation/ingest-rules`) are **session only**. `agent_access` on those paths → `agentScopesPermitMethod` false → `getUserId` null → 401.

### 10.3 Mint UI

Add checkbox `id="agent-cred-scope-ingest"` label `ingest:automation`, **unchecked**. Warning line (show when checked): ingest lets this robot use the ingest router per Settings rules; it does not grant `vault:write`.

`hub.js` mint body includes the scope when checked (mirror of G27).

### 10.4 Interaction with `propose` + `vault:read`

| Mint set | Ingest route | Legacy proposals hook | Reads | Direct notes POST |
| --- | --- | --- | --- | --- |
| `ingest:automation` + `vault:read` | yes | no (no `propose`) | yes | no |
| `propose` + `vault:read` | no | yes if D14 body | yes | no |
| `propose` + `ingest:automation` + `vault:read` | yes | yes if D14 body | yes | no |
| `vault:write` | yes (G5) | n/a | yes | yes (existing; not the AIP cron path) |

Cron default documentation: row 1. Do not require row 4.

---

## 11. Storage + CRUD (frozen)

### 11.1 Files

| Kind | Path |
| --- | --- |
| Packaged templates | `hub/automation-ingest-rules-default.json` |
| Self-hosted / gateway file overlay | `data/automation_ingest_rules.json` (under `KNOWTATION_GATEWAY_DATA_DIR` on hosted file fallback) |
| Hosted blob | name `gateway-automation-ingest-rules`, key `automation-ingest-rules-v1` |

Overlay shape:

```json
{
  "version": 1,
  "subs": {
    "<sub>": {
      "rules": [],
      "updated_at": 0
    }
  }
}
```

Packaged file shape:

```json
{
  "version": 1,
  "templates": [ ]
}
```

Load: templates from packaged JSON; user rules from overlay `subs[sub].rules`. Router sees **user rules only**. Templates appear in GET as `templates` and are never `enabled` in the packaged file (D16).

Netlify missing blob global: same fail-closed spirit as Lane D agent store — do **not** silently mint an empty overlay that wipes a missed blob. If overlay I/O throws → 503. If overlay missing → treat as empty **user** rules (templates still list). Do not write the overlay on GET.

### 11.2 Session CRUD

All require session JWT (`type: session` or legacy session). `editor` or `admin`. `agent_access` → 401.

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `api/v1/automation/ingest-rules` | `{ rules, templates }` for caller `sub` |
| PUT | `api/v1/automation/ingest-rules` | Replace `rules` (full list). Validate §5. Cap D18. Re-mint missing `rule_id`s. |
| POST | `api/v1/automation/ingest-rules` | Append one rule. Server mints `rule_id`. |
| POST | `api/v1/automation/ingest-rules/from-template` | Body `{ template_id }`. Copy that pack row into `rules` with **new** `rule_id`, `enabled: false` unless body `{ "enable": true }` **and** the operator is session (explicit opt-in). |
| DELETE | `api/v1/automation/ingest-rules/:rule_id` | Remove from user list. |

`template_id` on pack rows is the packaged `rule_id` (stable, e.g. `tmpl_born_free_trend_review`).

No PATCH in v1. PUT replace is the update path.

### 11.3 Born Free pack (disabled)

Pack id `born_free_v1`. All `enabled: false`. Match on credential **name** + **path** (not global).

| `rule_id` (template) | label | match | disposition | `content_class` |
| --- | --- | --- | --- | --- |
| `tmpl_born_free_trend_review` | Born Free trend → Review | `credential_name` = `videofactory-trend-agent`, `path_prefix` = `inbox/trends/` | `review_queue` | `research` |
| `tmpl_born_free_trend_direct` | Born Free trend → vault note | `credential_name` = `videofactory-trend-agent`, `path_prefix` = `inbox/trends/accepted/` | `direct_note` | `research` |
| `tmpl_born_free_trend_auto` | Born Free trend → auto-apply | `credential_name` = `videofactory-trend-agent`, `path_prefix` = `inbox/trends/drafts/` | `proposal_auto_apply` | `research` |

These are **examples the operator enables**. They are not live on a new Hub. Do not add a second hidden match on `born-free` prefix in v1 (keeps first-match predictable). Operators who mint a different name copy the template and edit `credential_name`.

---

## 12. Settings UI (frozen)

New tab button: `data-settings-tab="automation"` label **Automation**, visible to every signed-in user (not hidden behind admin-only). Panel `id="settings-panel-automation"`.

Section **Ingest rules**:

1. Intro: matching robot writes can go to the vault, auto-apply, or Review. Elevated triggers still force Review. Born Free templates stay off until you add them.
2. Table of `rules`: label, match summary, disposition, enabled, priority, Enable/Disable, Delete.
3. Add rule form: label, priority, disposition select, match fields, content_class, Save (POST).
4. Pack list: three templates + **Add to my rules** (from-template, stays disabled unless the operator checks Enable on add).
5. Reorder: number input for priority (no drag required in v1).

Pointer under Agent credentials (after G27 warning): “Ingest routing lives under Settings → Automation.”

Unit tests assert element ids from Hub HTML (same pattern as Lane D banner ids). e2e is HTTP, not a browser driver.

---

## 13. Audit JSONL (frozen)

Reuse `appendAudit` (G22). New `action` values (closed):

| `action` | When |
| --- | --- |
| `ingest_routed` | Router returned (every ingest, including replay) |
| `ingest_direct_note` | Note written |
| `ingest_auto_applied` | Note written + proposal approved via hook |
| `ingest_review_queued` | Proposal created, not applied |
| `ingest_elevated_override` | D9 rewrote disposition |
| `ingest_idempotent_replay` | Store hit |
| `ingest_apply_failed` | D23 mark failed after note write |

`proposalId` on the existing field when a proposal exists; else `proposalId: ''`.

`detail` object (no secrets, no raw `kt_agent_`, no JWT):

```json
{
  "rule_id": "ingr_…-or-null",
  "disposition": "review_queue",
  "source_fingerprint": "…",
  "path": "inbox/trends/example.md",
  "content_class": "research",
  "vault_id": "Business",
  "credential_id": "cid-from-jwt-or-null",
  "elevated_override": false,
  "evaluation_block": false,
  "replayed": false
}
```

Hosted and self-hosted both append using the same `dataDir` already passed to `augmentProposalCreateForHosted` / `createProposal` (G13, G12). Do not skip. Do not invent a second log file.

---

## 14. MCP (frozen)

**Out of v1.** `docs/AGENT-INTEGRATION.md` must say ingest is REST-only. Do not add an MCP tool that wraps ingest. Phase C §7.6 (MCP optional) is unchanged.

---

## 15. Docs Auto must amend (same PR as code)

| Doc | Change |
| --- | --- |
| `docs/openapi.yaml` | `POST api/v1/automation/ingest`, CRUD ingest-rules, `content_class` query on notes list |
| `docs/AGENT-INTEGRATION.md` | Machine path: exchange → ingest route; cron scopes; REST-only; no JWT-as-env |
| `docs/PROPOSAL-LIFECYCLE.md` | Cross-link: agent ingest may skip Review only via AIP rules; approve HTTP still denied; elevated triggers still apply |
| `docs/HUB-API.md` | Ingest section + honesty that templates ship disabled |

No docs-only PR to `main`.

---

## 16. Test matrix (seven tiers)

| Tier | File (Auto creates) | Must prove |
| --- | --- | --- |
| unit | `test/automation-ingest-unit.test.mjs` | normalize/match/first-match/priority; D3 empty match; D9 override; D10 evaluation block; D15 key precedence; scope allowlist ingest path; `propose` cannot ingest route; `ingest:automation` cannot approve path |
| integration | `test/automation-ingest-integration.test.mjs` | load pack disabled; PUT rules; route + execute review_queue create; from-template stays disabled unless enable |
| e2e | `test/automation-ingest-e2e.test.mjs` | HTTP ingest on test gateway/self-hosted helper: session CRUD + agent ingest → 201 envelope |
| stress | `test/automation-ingest-stress.test.mjs` | 32 rules first-match under cap; 33rd PUT fails; 100 sequential ingests no unbounded growth beyond TTL map |
| data-integrity | `test/automation-ingest-data-integrity.test.mjs` | replay same key+fingerprint+path; conflict on fingerprint change; pack JSON all `enabled: false`; no secret in audit detail |
| performance | `test/automation-ingest-performance.test.mjs` | `routeAutomationIngest` p95 budget on 32 rules (document threshold in test, local only) |
| security | `test/automation-ingest-security.test.mjs` | agent cannot approve; agent cannot CRUD rules; session proposals with fingerprint do not auto-route; elevated body cannot direct_note; `vault:write` not required; `roleEligibleForPersonalSelfApply` still refuses `agent_access`; Scooling fingerprint constants unchanged (source scan) |

Security tier **must fail against pre-AIP code** for: ingest route 401/404; `ingest:automation` unknown scope; missing `content_class` filter.

Smoke: `scripts/verify-automation-ingest-smoke.mjs` — default target is local/test gateway. Production URL is Operator T2. Script must refuse to print credentials.

---

## 17. Fail-closed rules (checklist)

1. No `ingest:automation` on `DEFAULT_AGENT_SCOPES`.
2. No pack template `enabled: true` in `hub/automation-ingest-rules-default.json`.
3. No `agent_access` on approve / discard / ingest-rules CRUD.
4. No E1 / T5 / SEC-SEAM predicate edits.
5. No trigger skip on any disposition.
6. No `evaluation_status: passed` stamp for ingest actors.
7. No Scooling edits. No VideoFactory edits.
8. No MCP ingest tool.
9. No second audit file format (extend `appendAudit`).
10. Ingest route mounted before gateway catch-all.
11. Self-hosted ingest + proposals hook call `agentScopesPermitMethod`.
12. Idempotent replay does not bill twice.
13. D23 mark failure does not delete the note and does not return 201.

---

## 18. AIP-b file list (mechanical)

Auto creates or edits **only** these (plus tests/docs in §15–16):

- `lib/automation-ingest-policy.mjs` (schema, route, execute orchestration)
- `hub/automation-ingest-rules-default.json`
- `hub/lib/agent-credential-core.mjs` (scope + allowlist)
- `hub/gateway/access-token-authz.mjs` — **do not edit** (re-exports `agentScopesPermitMethod` already)
- `hub/gateway/server.mjs` (ingest + CRUD + mount order + D8 proposals hook — required)
- `hub/gateway/billing-middleware.mjs` (`opts.operation` per D24 only)
- `hub/server.mjs` (parity routes + hook + `agentScopesPermitMethod` + `effectiveRequestPath` on those routes)
- `hub/gateway/automation-ingest-store.mjs` (D26)
- `lib/list-notes.mjs` + hosted notes list client filter in `web/hub/hub.js`
- `web/hub/index.html` + `web/hub/hub.js` (Automation tab, mint checkbox, Research filter)
- `hub/audit-log.mjs` — **do not edit** (empty `proposalId` string is already valid)
- `netlify/functions/gateway.mjs` (D27 two blob globals)
- `scripts/verify-automation-ingest-smoke.mjs`

Do **not** edit `lib/hub-proposal-personal-self-apply.mjs` except if a test import needs a comment — **no predicate changes**.

---

## 19. SD-21 land path (document only)

After AIP-b BV **pass**, with **no** live posture/env flip, secrets, real money, or Delegation write env in the diff:

1. Muse merge/FF `feat/automation-ingest-policy-b` → Muse `main`
2. `./scripts/muse-bridge-deploy.sh`
3. GitHub PR `muse-mirror` → `main` (merge commit)
4. Never `git push origin main`. Never feature → GitHub `main`.

Production smoke (T2) is **Operator**, recorded in `docs/reviews/<date>-automation-ingest-live-smoke.md` as PASS or FINDINGS: `rule_id`, disposition, Review proposed-count delta, HTTP status + JSON `code` only. Auto must not claim that smoke.

---

## 20. Operator production smoke record (not Auto)

After land + deploy, Operator records:

- PASS or FINDINGS
- `rule_id` (or `null` if default queue)
- `disposition`
- Review proposed-count delta
- HTTP status + JSON `code`
- No secrets, no JWTs, no `kt_agent_` material

---

## Appendix A — VideoFactory trend scout (contract edge; AIP-c implements)

**Not** Hub Auto. Knowtation does not contain trend-agent source (Phase C §2 same fact).

| Item | Frozen Hub expectation |
| --- | --- |
| Hub URL | `KNOWTATION_HUB_URL` (hosted `https://api.knowtation.store`) |
| Vault | `KNOWTATION_HUB_VAULT_ID` (operator; Lane D smoke used `Business`) |
| Secret | `KNOWTATION_HUB_AGENT_CREDENTIAL` (`kt_agent_` family) |
| Exchange | `POST api/v1/auth/agent/token` → short `agent_access` |
| Preferred write | `POST api/v1/automation/ingest` with `ingest:automation` + `vault:read` |
| Interim write | `POST api/v1/proposals` with ingest contract fields (D8, D14) if the agent still has `propose` |
| `intent` | `videofactory.trend_scout.ingest` |
| `path` prefix | `inbox/trends/` (accepted / drafts subfolders if using pack templates) |
| `content_class` | `research` |
| `source_fingerprint` | Stable id of the scout item (URL + published time, or item id). Same item → same fingerprint. |
| Credential `name` | `videofactory-trend-agent` to match pack templates without editing |
| Fingerprint (consumer) | intent + path prefix + credential name + `content_class=research` |
| Forbidden | `ktn_refresh` / session JWT in cron env; `POST api/v1/proposals/:id/approve`; mint `vault:write` for this cron |
| Full wire | **AIP-c** (VideoFactory repo). This appendix is the Hub contract only. |

---

## Appendix B — What Auto must not treat as open

If a later reviewer asks “should we score specificity?” — **no** (D1).  
If “should default mint include ingest?” — **no** (D5).  
If “should evaluation-on vaults auto-apply?” — **no** (D10).  
If “should MCP grow a tool?” — **no** (D13).  
If “should pack enable itself?” — **no** (D16).
)
