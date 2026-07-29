# Proposal lifecycle (Hub)

This document defines **states**, **roles**, and **identifiers** for Knowtation Hub proposals. It is the reference for extending `ProposalRecord` (Node, canister, OpenAPI) without drift.

## States

| Status | Meaning |
|--------|---------|
| `proposed` | Waiting for review; not applied to the canonical vault. |
| `approved` | Applied to the vault; proposal record kept for audit/history. |
| `discarded` | Rejected; not applied. May be bulk-discarded when notes are deleted (see [HUB-METADATA-BULK-OPS.md](./HUB-METADATA-BULK-OPS.md)). |

Allowed transitions:

- `proposed` → `approved` (admin / permitted evaluator **Approve**; or **personal self-apply** for the Scooling review-tray class — see below; may require human evaluation first — see **Evaluation**)
- `proposed` → `discarded` (admin: **Discard**, or bulk housekeeping)

There is **no** `draft` status in the store today; agents create `proposed` rows via `POST /api/v1/proposals`.

## Roles (Phase 13 + evaluator)

| Role | List / view proposals | Create proposal | Submit evaluation | Approve / discard |
|------|------------------------|-----------------|-------------------|-------------------|
| `viewer` | Yes | No | No | No |
| `editor` | Yes | Yes | No | Yes **only** via personal self-apply class (below); otherwise No |
| `member` (hosted) | Yes | Yes | No | Yes **only** via personal self-apply class (below); otherwise No |
| `evaluator` | Yes | No | Yes | Only if `HUB_EVALUATOR_MAY_APPROVE=1` (approve only; discard stays admin on Node Hub) |
| `admin` | Yes | Yes | Yes | Yes |

**Discard** remains **admin-only** on hosted gateway and Node Hub (personal self-apply never grants discard).

Optional **Tier-2 enrichment** (`POST /api/v1/proposals/:id/enrich` when `KNOWTATION_HUB_PROPOSAL_ENRICH=1`): `editor` or `admin`.

## Personal self-apply (Scooling review tray — HOSTED-WRITE-EVAL)

For the **Scooling personal self-apply class**, the learner’s Scooling review-tray Approve **is** the human review. Knowtation does **not** require a separate Hub `POST …/evaluation` hop for that class, and hosted `member` (Node: `editor`) may `POST …/approve` when **all** of the following hold server-side:

| Check | Rule |
| --- | --- |
| Actor | JWT resolves; actor has `vault:write` (hosted `member`/`admin`, or Node `editor`/`admin`) |
| Partition | Proposal is in the actor’s effective vault partition (hosted: canister user partition; no cross-partition apply) |
| Intent | `intent === "scooling.review_tray.approve"` (exact) |
| External ref | `external_ref` matches `^scooling\.review:[A-Za-z0-9._:-]{1,200}$` |
| Path | `path` matches `^reviewed/[A-Za-z0-9._:-]{1,128}\.md$` |
| Not elevated | `review_severity !== "elevated"` and `auto_flag_reasons` / `auto_flag_reasons_json` empty or absent |
| Status | `status === "proposed"` |
| No learner waiver | Approve must not rely on `waiver_reason` for this class (Scooling omits it) |

**Evaluation satisfaction (E1, preferred):** On `POST /api/v1/proposals` create, **after** policy + review-trigger augmentation, when the fingerprint still matches and the proposal is not elevated/auto-flagged, the gateway / Node Hub sets `evaluation_status` to `passed` and records `evaluated_by` / `evaluated_at` from the creating actor. Elevated or auto-flagged proposals are **not** self-passed.

This is **not** a global “members may approve any proposal” grant. Non-matching intents, elevated content, org/classroom flows, and IDOR cross-partition attempts keep existing Hub RBAC / evaluation gates. Do **not** turn off `HUB_PROPOSAL_EVALUATION_REQUIRED` globally for this path.

Implementation: [lib/hub-proposal-personal-self-apply.mjs](../lib/hub-proposal-personal-self-apply.mjs); hosted gate in [hub/gateway/server.mjs](../hub/gateway/server.mjs) `assertHostedProposalApproveDiscard`.

### Session-bound learner identity (SEC-SEAM-1)

**Consumer contract:** Consumers must present a per-learner, session-bound Knowtation credential on task, media, and delegation proposal-create surfaces. A shared service credential is a contract violation. Knowtation cannot detect it; its only server-side consequence is permanent ineligibility for personal self-apply.

Seam surfaces (task / media / delegation / flow / flow_capture) that can trigger an approve-time apply are classified by reusing the apply path’s own predicates. Self-apply on those surfaces requires a mint-stamped `type: 'session'` credential and `authorActorId === approverActorId`.

### Tasks / Media / Flow admission (T5 + FLOW-WRITE-LIVE-KN-b)

Gate **T5** admits **personal-scope Tasks, Media, and Wave 1 Flow authoring** into the self-apply class under positive fingerprints (not a global member approve). Frozen contracts: `~/scooling/docs/FINISH-COMPLETE-APPLY-CONTRACT.md` §FCA.4 (Tasks/Media) and `~/scooling/docs/FLOW-WRITE-LIVE-FREEZE.md` §FWL.4 (Flow).

| Surface | Fingerprint (approve-time) |
| --- | --- |
| **Tasks** | `source`/seam task classification; `proposal_kind` ∈ closed allowlist; path `meta/tasks/proposals/{proposal_id}.json` (never `pending`); `external_ref` `^scooling\.task:[A-Za-z0-9._:-]{1,200}$`; body scope `personal`; `task_assign` only when `assignee_ref` equals session author |
| **Media** | `source === media`; kind ∈ {`media_external_link`,`media_attach`}; path `meta/media/proposals/{proposal_id}.json`; `external_ref` `^scooling\.media:[A-Za-z0-9._:-]{1,200}$`; body `scope === personal` |
| **Flow authoring** | `source === flow`; `flow_meta` present as object **and** `flow_meta.kind` exactly ∈ {`new`,`edit`,`import`} (missing/empty kind ⇒ not admitted — do **not** default to `new`); path `^meta/flows/[A-Za-z0-9._:-]{1,128}\.md$`; `external_ref` `^scooling\.flow:[A-Za-z0-9._:-]{1,128}$`; scope `personal` (frontmatter.scope → body.flow.scope) |
| **Delegation** | **Never** — `SELF_APPLY_DELEGATION_REFUSED` (P4) |
| **flow_capture** | Seam-classified but **not admitted** in Wave 1 (`SELF_APPLY_NOT_ADMITTED`; SD-7 never-auto) |

Propose paths persist a validated optional `external_ref` (malformed → 400; absent → propose ok, not admitted). Flow propose accepts `scooling.flow:…` for **all** Wave 1 kinds; import lineage hints must not substitute for the admission ref. E1 create-time evaluation satisfaction widens to admitted Task/Media/Flow fingerprints when `sessionBound` + author gates hold. Client-supplied `evaluation_status` / `evaluated_by` / `evaluated_at` remain stripped (P2).

Honest notes review-tray proposals remain eligible under the fingerprint rules above.

### Media proposals — self-hosted only today (SEC-SEAM-1 / S7)

Media proposals are **self-hosted-only** today. There is no hosted media proposal route on the gateway; Scooling’s hosted media transport targets `api/v1/attachments/*`, which falls through to the canister and returns `404 NOT_FOUND`. Self-hosted media (`source: 'media'`) is still a seam surface when it reaches apply. A future hosted media proposal surface must ship with a `maybeApplyHostedMediaAfterApprove` hook and a matching seam classification condition in the same change.
## Optimistic concurrency: `base_state_id`

When a proposal targets an **existing** note path, the client may send **`base_state_id`**: a fingerprint of the vault note **as the client last saw it** (e.g. from `GET /api/v1/notes/:path`). On **Approve**, the Hub (self-hosted Node) recomputes the current fingerprint for that path and returns **409 `CONFLICT`** if it does not match **either** the request body’s `base_state_id` (if provided) **or** the value stored on the proposal.

### Format `kn1_` (FNV-1a 64-bit)

- Prefix: `kn1_`
- Suffix: 16 lowercase hex characters = FNV-1a 64-bit over UTF-8 bytes of `canonicalJSON(frontmatterObject) + "\0" + body`
- `canonicalJSON` means **sorted object keys** at all levels (see [lib/note-state-id.mjs](../lib/note-state-id.mjs) `stableStringify`).

**Absent path** (new note; no file at that path yet): fingerprint is the FNV-1a of the single byte `0x00`, still with prefix `kn1_` (see `absentNoteStateId()`).

**Hosted canister:** Approve does **not** recompute `kn1_` in Motoko today (frontmatter serialization may differ from Node). Clients should rely on Node Hub for strict checks, or treat `base_state_id` as advisory on canister-only flows until parity is implemented.

## `external_ref` on approve (optional Muse bridge)

Besides setting **`external_ref`** at **`POST /api/v1/proposals`** (create), operators may set or resolve it at **`POST /api/v1/proposals/:id/approve`**: the client can send **`external_ref`** in the approve body, or the server may fill it from an optional Muse lineage callback when **`MUSE_URL`** is configured. Approve **never** fails because Muse is unreachable. See [MUSE-THIN-BRIDGE.md](./MUSE-THIN-BRIDGE.md).

## Optional fields (augmentation)

| Field | Purpose |
|-------|---------|
| `intent` | Human- or agent-readable reason. |
| `external_ref` | Optional cross-system id (e.g. Muse lineage). |
| `labels` | String array for triage/filter (not only inside proposed frontmatter). |
| `source` | e.g. `agent`, `human`, `import`. |
| `suggested_labels`, `assistant_notes`, `assistant_model`, `assistant_at` | Tier-2 enrichment output when enabled. |
| `review_queue` | Optional string for triage (e.g. `legal`), set by deterministic triggers or client. |
| `review_severity` | `standard` or `elevated`, from triggers. |
| `auto_flag_reasons` | String array of structured reason codes (e.g. `phrase:…`, `path_prefix:…`); audited on create when non-empty. |
| `review_hints`, `review_hints_at`, `review_hints_model` | Optional async LLM text for humans only; **never** the sole merge gate. |

## Deterministic review triggers

Org-configurable rules in **`data/hub_proposal_review_triggers.json`** (override; packaged default **`hub/proposal-review-triggers-default.json`**) can force **`evaluation_status: pending`** and set **`review_queue`** / **`review_severity`** from:

- **`literal_phrases`** — case-insensitive substring match on path + body + intent (bounded list/size per [lib/hub-proposal-review-triggers.mjs](../lib/hub-proposal-review-triggers.mjs)).
- **`path_prefixes`** — vault-relative path prefix match.
- **`label_any`** — intersection with proposal `labels`.

**Hosted:** The gateway merges the same logic into **`POST /api/v1/proposals`** before the canister (see [lib/hub-proposal-create-augment.mjs](../lib/hub-proposal-create-augment.mjs)). Inline LLM **review hints** after create are **skipped** for this class (see [hub/gateway/proposal-review-hints-async.mjs](../hub/gateway/proposal-review-hints-async.mjs)) so one-click approve is not held behind the hints deadline.

## Human evaluation (Phase: proposal evaluation)

Evaluation is a **human-led** record (who/when/outcome/checklist/comment, optional grade). It is **not** the same as Tier-2 **Enrich** (LLM assist). LLM output must not be the sole merge authority.

### `evaluation_status` (orthogonal to `status`)

| Value | Meaning |
|--------|---------|
| `none` | No evaluation required for this proposal (gate off at creation), or legacy row with no field set. |
| `pending` | Evaluation expected before approve (gate on at creation). |
| `passed` | Evaluator recorded a pass outcome; approve allowed without waiver. |
| `failed` | Evaluator recorded fail; approve blocked unless admin supplies a **waiver** (see below). |
| `needs_changes` | Evaluator requested changes; approve blocked unless **waiver**. |

Transitions (human action via `POST /api/v1/proposals/:id/evaluation`):

- `none` → `passed` \| `failed` \| `needs_changes` (optional audit when gate is off)
- `pending` → `passed` \| `failed` \| `needs_changes`
- `failed` \| `needs_changes` → `passed` \| `failed` \| `needs_changes` (re-evaluation after edits)

`approved` / `discarded` proposals **cannot** receive new evaluations.

### Stored fields (Node `hub_proposals.json` and canister `ProposalRecord`)

| Field | Purpose |
|--------|---------|
| `evaluation_status` | One of the values above. |
| `evaluation_grade` | Optional (e.g. letter or 1–5). Secondary to pass/fail. |
| `evaluation_checklist` | JSON array: `[{ "id", "label", "passed" }]` merged from org rubric + submission. |
| `evaluation_comment` | Free text; **required** for outcomes `failed` and `needs_changes`. |
| `evaluated_by` | JWT `sub` of evaluator (v1: admin). |
| `evaluated_at` | ISO timestamp. |
| `evaluation_waiver` | Set on approve when bypassing a non-pass state: `{ "by", "at", "reason" }`. |

### Gate: require evaluation before approve

**Policy resolution** ([lib/hub-proposal-policy.mjs](../lib/hub-proposal-policy.mjs)):

- `HUB_PROPOSAL_EVALUATION_REQUIRED=1` or `true` → gate **on** for new proposals.
- `=0` or `false` → gate **off**.
- If unset: read **`data/hub_proposal_policy.json`**; if `proposal_evaluation_required === true`, gate **on**; else **off**.

When the gate is **on**, new proposals are created with `evaluation_status: "pending"` (unless triggers already implied pending). **Approve** is rejected with **403** / **`EVALUATION_REQUIRED`** unless:

- `evaluation_status === "passed"`, or
- the approve request includes a non-empty **`waiver_reason`** (trimmed length ≥ 3), which records **`evaluation_waiver`** and an audit entry (`approve_waiver`).

**Exception — personal self-apply (E1):** matching Scooling review-tray proposals are created with `evaluation_status: "passed"` after triggers (see **Personal self-apply** above), so approve does not need a separate evaluation POST or learner waiver.

When the gate is **off** at create, new proposals use `evaluation_status: "none"` unless **review triggers** force pending; admins may approve without submitting evaluation, but may still submit evaluation for audit.

**Hosted canister:** The **gateway** injects `evaluation_status: "pending"` on create when policy is on (same resolution using repo **`data/`** beside the gateway), then applies E1 for the personal self-apply class (`passed` + `evaluated_by` / `evaluated_at`). Approve rules on the canister allow `passed` / empty / `none`. Canister stores **`review_queue`**, **`review_severity`**, **`auto_flag_reasons_json`**, and optional **`review_hints`** (V3 `ProposalRecord`); upgrade migrates existing rows.
### Rubric

Default checklist items ship in-repo (`hub/proposal-rubric-default.json`). Override with **`data/hub_proposal_rubric.json`** (same `{ "items": [{ "id", "label" }] }` shape). See [PROPOSAL-EVALUATION-RUBRIC-DEFAULT.md](./PROPOSAL-EVALUATION-RUBRIC-DEFAULT.md).

### Who evaluates

**Admins** and **`evaluator`** users may **`POST …/evaluation`**. **Approve** defaults to **admin**; set **`HUB_EVALUATOR_MAY_APPROVE=1`** to allow **evaluator** to approve. **Discard** remains **admin** on the Node Hub.

### Optional LLM review hints

When **`KNOWTATION_HUB_PROPOSAL_REVIEW_HINTS=1`**, the Hub may asynchronously populate **`review_hints`** (self-hosted: after create; hosted: gateway schedules a canister **`POST …/review-hints`** after create). **Prompt-injection:** treat model output as **untrusted**; it does not change `evaluation_status` unless you add a separate policy (not shipped). **Privacy:** proposal body may be sent to OpenAI or Ollama per [lib/llm-complete.mjs](../lib/llm-complete.mjs).

## Related

- [HUB-API.md](./HUB-API.md) §3.4 Proposals  
- [IMPORT-EVALS.md](./IMPORT-EVALS.md) (retrieval vs proposal evaluation)  
- [AGENT-INTEGRATION.md](./AGENT-INTEGRATION.md) §4 — proposals, metadata, optional Muse linkage  
- [HUB-API.md](./HUB-API.md) proposals section (lifecycle extensions)
