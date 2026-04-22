# Proposal lifecycle (Hub)

This document defines **states**, **roles**, and **identifiers** for Knowtation Hub proposals. It is the reference for extending `ProposalRecord` (Node, canister, OpenAPI) without drift.

## States

| Status | Meaning |
|--------|---------|
| `proposed` | Waiting for review; not applied to the canonical vault. |
| `approved` | Applied to the vault; proposal record kept for audit/history. |
| `discarded` | Rejected; not applied. May be bulk-discarded when notes are deleted (see [HUB-METADATA-BULK-OPS.md](./HUB-METADATA-BULK-OPS.md)). |

Allowed transitions:

- `proposed` → `approved` (admin: **Approve**; may require human evaluation first — see **Evaluation** below)
- `proposed` → `discarded` (admin: **Discard**, or bulk housekeeping)

There is **no** `draft` status in the store today; agents create `proposed` rows via `POST /api/v1/proposals`.

## Roles (Phase 13 + evaluator)

| Role | List / view proposals | Create proposal | Submit evaluation | Approve / discard |
|------|------------------------|-----------------|-------------------|-------------------|
| `viewer` | Yes | No | No | No |
| `editor` | Yes | Yes | No | No |
| `evaluator` | Yes | No | Yes | Only if `HUB_EVALUATOR_MAY_APPROVE=1` (approve only; discard stays admin on Node Hub) |
| `admin` | Yes | Yes | Yes | Yes |

Optional **Tier-2 enrichment** (`POST /api/v1/proposals/:id/enrich` when `KNOWTATION_HUB_PROPOSAL_ENRICH=1`): `editor` or `admin`.

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

**Hosted:** The gateway merges the same logic into **`POST /api/v1/proposals`** before the canister (see [lib/hub-proposal-create-augment.mjs](../lib/hub-proposal-create-augment.mjs)).

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

When the gate is **off** at create, new proposals use `evaluation_status: "none"` unless **review triggers** force pending; admins may approve without submitting evaluation, but may still submit evaluation for audit.

**Hosted canister:** The **gateway** injects `evaluation_status: "pending"` on create when policy is on (same resolution using repo **`data/`** beside the gateway). Approve rules on the canister are unchanged. Canister stores **`review_queue`**, **`review_severity`**, **`auto_flag_reasons_json`**, and optional **`review_hints`** (V3 `ProposalRecord`); upgrade migrates existing rows.

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
