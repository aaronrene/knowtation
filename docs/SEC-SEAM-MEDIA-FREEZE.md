# SEC-SEAM-MEDIA — Hosted media proposal surface (Knowtation)

**Phase:** SEC-SEAM-MEDIA (`SEC-SEAM-MEDIA-a` Thinking freeze → `SEC-SEAM-MEDIA-b` Auto)
**Freeze status:** **CLEARED for `SEC-SEAM-MEDIA-b`** — freeze-review `pass` (mechanical + semantic)
**Date:** 2026-08-01
**Model (this artifact):** Thinking
**Owner repo:** Knowtation
**Ratified parent:** SEC-SEAM-1 §12 **D2 = A** (media out of SEC-SEAM-1b; open hosted media row)

Status: **Frozen Thinking outline.** Spec only — no product code in this step. No
`MEDIA_EXTERNAL_LINK_ENABLED` / `MEDIA_ATTACH_ENABLED` flip. No Scooling
`SCOOLING_MEDIA_*` / `MEDIA_*_AUTHORIZED` flip. No deploy. Do **not** unpark
SEC-KN-P6-ROTATE R4–R5 (Tier-3 T2 secret writes) in this session. Downstream Auto
(**SEC-SEAM-MEDIA-b**) implements this contract only after freeze-review `pass`.

```yaml
phase: SEC-SEAM-MEDIA-a
outputs:
- id: sec-seam-media-freeze
  path: docs/SEC-SEAM-MEDIA-FREEZE.md
  frozen: true
  notes: 'Hosted media propose+apply surface: gateway maybeApplyHostedMediaAfterApprove + matching isSeamSurfaceProposal S3.1 condition via normalizeCanisterProposalForMediaPrecheck in the SAME change (S3.0); bridge propose/apply-approved/consent/list proxies; blob-backed media stores; no posture/env flip; no P6 R4-R5

    '
frozen_inputs:
- id: sec-seam-1-freeze
  path: docs/SEC-SEAM-1-SESSION-BOUND-IDENTITY-FREEZE.md
  notes: frozen:true; review_stamp pass; S3.0 anti-drift; S7.6 hook+S3.1 same-change; D2=A
- id: media-write-contract
  path: docs/MEDIA-WRITE-SURFACES-CONTRACT-2F-b-d-kn.md
  notes: frozen:true; media_external_link + media_attach; self-hosted v0; hosted proxy deferred (this phase)
- id: proposal-lifecycle
  path: docs/PROPOSAL-LIFECYCLE.md
  notes: Media self-hosted-only today; requires maybeApplyHostedMediaAfterApprove + seam condition
- id: capture-hosted-apply-freeze
  path: docs/CAPTURE-HOSTED-APPLY-FREEZE.md
  notes: frozen:true; review_stamp pass; CHA-C1 hook + apply-approved + blob pattern
- id: gateway-approve-hooks
  path: hub/gateway/server.mjs
  notes: post-approve delegation/task/capture hooks; no media hook; no attachments routes
- id: task-approve-hosted
  path: hub/gateway/task-approve-hosted.mjs
  notes: maybeApplyHostedTaskAfterApprove + mergeTaskApplyIntoApproveResponse pattern
- id: capture-approve-hosted
  path: hub/gateway/capture-approve-hosted.mjs
  notes: maybeApplyHostedCaptureAfterApprove pattern (newest sibling)
- id: attachment-write
  path: lib/attachments/attachment-write.mjs
  notes: handleMedia*Propose + precheckApprovedMediaProposal + reconcileApprovedMediaProposal
- id: personal-self-apply
  path: lib/hub-proposal-personal-self-apply.mjs
  notes: isSeamSurfaceProposal S3.1; MEDIA source only today; no media normalize
- id: self-hosted-media-routes
  path: hub/server.mjs
  notes: attachments list/get/propose/consent + media apply on approve
- id: external-protocol-blob
  path: hub/bridge/external-agent-blob-store.mjs
  notes: EXTERNAL_PROTOCOL_BLOB_FILES — media store files absent today
- id: scooling-media-transport
  path: ../scooling/src/adapters/mediaWriteHubTransport.ts
  notes: hosted targets api/v1/attachments/link-proposals and attach-proposals
review_stamp:
  reviewed_at: '2026-08-01T16:17:27Z'
  verdict: pass
  reviewer_mode: agent
  reviewer_model: thinking-high
  reviewer_provider: local
  kit_version: 0.1.0
  artifact_digest: sha256:f9c58fd31deb88b134d2b01bdd2fb187789e9205c11933b7ba9a86ebe80648f6
downstream:
- id: SEC-SEAM-MEDIA-b
  model: Auto
  consumes_as_ground_truth: true
  notes: Implement SM-C1–C12 exactly; seven-tier green; BV pass; no posture/env flip; no P6 R4-R5
tier3_gates:
- T1 Muse main / muse-mirror to GitHub main (SD-14) for SEC-SEAM-MEDIA-b land
- T2 Production gateway/bridge deploy that mounts hosted media routes or the media approve hook
- T3 Any MEDIA_EXTERNAL_LINK_ENABLED / MEDIA_ATTACH_ENABLED production write (or Scooling MEDIA_*_AUTHORIZED / SCOOLING_MEDIA_* flip)
- T4 SEC-KN-P6-ROTATE R4-R5 SESSION_SECRET writes (explicitly out of this phase)
- T5 GitHub PR head that is not muse-mirror targeting main (SD-14)
```

## Review record

| Round | Reviewer | Verdict | Resolution |
| --- | --- | --- | --- |
| 0 | Thinking (this session) | draft | Freeze authored from SEC-SEAM-1 S7.6 + source ground truth |
| 1 | `ok review --freeze --dry-run` + thinking review | findings | CLI-F1 / R1-F1 / R1-F2 fixed below |
| 2 | Freeze-review loop (thinking) | findings | R2-F1 / R2-F2 fixed below |
| 3 | Freeze-review loop (thinking) + `ok review --freeze` | **pass** | R1/R2 hold. CLI C checklist clean. Semantic re-read: SM-C1–C12 implementable; S3.0 same-change load-bearing; media_attach IO adapter unambiguous; no escalating category open. Cleared for SEC-SEAM-MEDIA-b Auto. |

### Round 1 findings (cited — file+line)

| ID | Sev | Cat | Citation | Finding | Fix |
| --- | --- | --- | --- | --- | --- |
| CLI-F1 | BLOCKER | security | docs/SEC-SEAM-MEDIA-FREEZE.md:361 (pre-fix) | Leading-slash Hub route glob matched absolute-path checklist (C4). | Rewrote as prose `api/v1` (no leading slash). |
| R1-F1 | MAJOR | completeness | docs/SEC-SEAM-MEDIA-FREEZE.md:§SM-C5 (pre-fix); hub/icp/src/hub/main.mo:404-411 | SM-C5 said “existing hosted note write path” without naming the canister notes surface Auto must reuse — Auto could invent a parallel write. | SM-C5 now requires canister notes GET/POST family; forbids a second note-write protocol. |
| R1-F2 | MINOR | consistency | docs/SEC-SEAM-MEDIA-FREEZE.md:G2 | G2 end line stopped before capture import close. | G2 → `hub/gateway/server.mjs:68-78`. |

### Round 2 findings (cited — file+line)

| ID | Sev | Cat | Citation | Finding | Fix |
| --- | --- | --- | --- | --- | --- |
| R2-F1 | MAJOR | completeness | lib/attachments/attachment-write.mjs:825-907; docs/SEC-SEAM-MEDIA-FREEZE.md:§SM-C4/C5 (pre-fix) | SM-C4 “same function” conflicted with SM-C5 canister-only note I/O — media_attach precheck requires `ctx.vaultPath`. Auto could fork a hosted precheck. | SM-C5 now freezes temp-stage **or** thin noteIO adapter; forbids hosted-only precheck fork. |
| R2-F2 | MINOR | completeness | docs/MEDIA-WRITE-SURFACES-CONTRACT-2F-b-d-kn.md:35, :711 | OpenAPI-with-routes obligation from MEDIA contract omitted from in-scope table. | Added OpenAPI deliverable to §SM.0 in-scope. |

---

## Simple summary

Learners and editors can already propose media changes on a self-hosted Hub (link an
external item, or attach media to a note). On the hosted product
(`api.knowtation.store`) those same URLs hit the canister catch-all and return
not-found — so nothing is proposed, and approving would not apply even if a
proposal somehow existed. This freeze specifies the missing hosted path: create
media proposals through the gateway/bridge into the canister review tray, then
after an admin or evaluator approves, run the same media apply the self-hosted
Hub already runs. The security rule from SEC-SEAM-1 stays: the apply hook and the
seam classifier must share one predicate, shipped in the same change.

## Technical summary

**SEC-SEAM-MEDIA** closes the gap recorded by SEC-SEAM-1 **S7 / G17 / G30** and
PROPOSAL-LIFECYCLE: no hosted `api/v1/attachments/*` routes; no
`maybeApplyHostedMediaAfterApprove`. Self-hosted already implements
`handleMediaLinkProposeRequest` / `handleMediaAttachProposeRequest`,
`precheckApprovedMediaProposal`, and `reconcileApprovedMediaProposal` with
`source: media`. Hosted must mirror the task/capture pattern: canister proposal
create with embedded frontmatter markers, gateway post-approve hook, bridge
`apply-approved`, blob-backed media stores. **S3.0:** Auto MUST add
`normalizeCanisterProposalForMediaPrecheck` and wire it as both the hook trigger
and a new `isSeamSurfaceProposal` condition in the **same** change — never a
hand-written kind/intent list.

---

## §SM.0 — Scope and hard stops

### In scope (SEC-SEAM-MEDIA-a freeze → SEC-SEAM-MEDIA-b Auto)

| Deliverable | Owner |
| --- | --- |
| `maybeApplyHostedMediaAfterApprove` + response merge on gateway approve success | Knowtation |
| `normalizeCanisterProposalForMediaPrecheck` + S3.1 condition in `isSeamSurfaceProposal` **same change** (S3.0) | Knowtation |
| Bridge propose routes for link/attach + import-consent grant/list/revoke | Knowtation |
| Bridge `apply-approved` + `applyApprovedMediaProposalFromCanister` | Knowtation |
| Gateway proxies for those surfaces **before** canister catch-all | Knowtation |
| Hosted attachment list/get (at least connector_ref / external-ref derivation) | Knowtation |
| Blob hydrate/persist for media store files | Knowtation |
| OpenAPI shapes for new hosted attachment write/apply routes **in the same change as routes** (MEDIA contract §0 / §18 parity) | Knowtation |
| PROPOSAL-LIFECYCLE honesty update (hosted path exists; gates still default off) | Knowtation |
| Seven-tier tests | Knowtation |

### Explicitly NOT in scope

| Out of scope | Why |
| --- | --- |
| Flip `MEDIA_EXTERNAL_LINK_ENABLED` / `MEDIA_ATTACH_ENABLED` | Separate Tier 3 (T3) |
| Flip Scooling `MEDIA_*_AUTHORIZED` / `SCOOLING_MEDIA_*` | Consumer Tier 3 |
| SEC-KN-P6-ROTATE R4–R5 secret writes | Operator-parked; Tier-3 T2 |
| Detach/unlink proposal kind; byte import/mirror; connector SDK fetch | MEDIA contract non-goals |
| Change `MEDIA_WRITE_ROLES` (editor/admin) | SEC-SEAM-1 / MEDIA contract posture |
| Redesign SEC-SEAM-1 S1–S6/S10 | Parent freeze closed |
| MuseHub F7 | AWS-parked |
| Feature → GitHub-`main` | SD-14 |
| Auto product code in this Thinking turn | Model boundary |

### Hard stops

- No posture / production env flip inside MEDIA-a or MEDIA-b
- No `gh pr create --base main --head feat/…`
- No SESSION_SECRET / SESSION_SECRET_PREVIOUS writes
- No Auto product code until freeze-review `pass`
- No hand-written seam field/kind/intent list (S3.0)

---

## §SM.1 — Ground truth (verified 2026-08-01)

Every row was read in this session.

| # | Fact | Citation |
| --- | --- | --- |
| G1 | Gateway post-approve block calls delegation, task, then capture apply hooks only — **no media hook** | `hub/gateway/server.mjs:3557-3607` |
| G2 | Imports exist for delegation/task/capture apply helpers; no media approve module | `hub/gateway/server.mjs:68-78` |
| G3 | Task hook pattern: fetch canister → classify via `normalizeCanisterProposalForTaskPrecheck` → bridge apply-approved → merge `task_index_applied` | `hub/gateway/task-approve-hosted.mjs:17-18`, `:36-92`, `:102-118` |
| G4 | Capture hook same shape with `capture_index_applied` | `hub/gateway/capture-approve-hosted.mjs` (full module) |
| G5 | Self-hosted media propose routes: link-proposals, attach-proposals, import-consents; roles editor/admin (consent read includes viewer/evaluator) | `hub/server.mjs:1325-1426` |
| G6 | Self-hosted attachment list/get exist | `hub/server.mjs:1292`, `:1443` |
| G7 | Gateway has **zero** `attachments` route registrations — paths fall through canister catch-all | `hub/gateway/server.mjs` (no match); catch-all `:4095` |
| G8 | Bridge has **zero** attachment/media route modules | `hub/bridge/` (no `*media*` / `*attach*` route file) |
| G9 | Self-hosted approve prechecks media when `source === MEDIA_PROPOSAL_SOURCE`, then `reconcileApprovedMediaProposal` | `hub/server.mjs:3133-3142`, `:3172-3173` |
| G10 | `MEDIA_PROPOSAL_SOURCE === 'media'`; kinds `media_external_link` / `media_attach` | `lib/attachments/attachment-write.mjs:54`, `:781`, `:825` |
| G11 | `precheckApprovedMediaProposal` / `reconcileApprovedMediaProposal` are the shared apply truth | `lib/attachments/attachment-write.mjs:770-911` |
| G12 | `isSeamSurfaceProposal` classifies media only via `proposal.source === MEDIA_PROPOSAL_SOURCE` — **no** media normalize predicate | `lib/hub-proposal-personal-self-apply.mjs:447-465` |
| G13 | SEC-SEAM-1 S3.0 forbids hand-written seam lists; S7.6 requires hook **and** matching S3.1 condition in the same change | `docs/SEC-SEAM-1-SESSION-BOUND-IDENTITY-FREEZE.md:428-440`, `:708-711` |
| G14 | SEC-SEAM-1 D2 = A ratified — media out of 1b; roadmap row opened | `docs/SEC-SEAM-1-SESSION-BOUND-IDENTITY-FREEZE.md:1227` |
| G15 | MEDIA write contract deferred hosted gateway proxy | `docs/MEDIA-WRITE-SURFACES-CONTRACT-2F-b-d-kn.md:85-86`, `:692` |
| G16 | PROPOSAL-LIFECYCLE records self-hosted-only media + future hook obligation | `docs/PROPOSAL-LIFECYCLE.md:103-105` |
| G17 | Scooling hosted write transport targets `api/v1/attachments/link-proposals` and `attach-proposals` on `api.knowtation.store` | `../scooling/src/adapters/mediaWriteHubTransport.ts:361-367`, `:558`, `:578` |
| G18 | `EXTERNAL_PROTOCOL_BLOB_FILES` is flow store + idempotency + delegation audit only — **no** media store filenames | `hub/bridge/external-agent-blob-store.mjs:15-19` |
| G19 | Media durable files: `hub_attachment_external_refs.json`, `hub_media_import_consent.json`, `hub_media_connector_policy.json`, `hub_media_write_policy.json` | `lib/attachments/attachment-external-ref-store.mjs:13`; `media-import-consent.mjs:13`; `media-connector-policy.mjs:13`; `attachment-write.mjs:52` |
| G20 | Task hosted create embeds FM markers via `mergeTaskFrontmatter`; normalize is the hook trigger | `lib/task/task-hosted-proposal.mjs:60-77`, `:85-94` |
| G21 | T5 media fingerprint requires `proposal.source === MEDIA_PROPOSAL_SOURCE` plus admitted kinds + path + external_ref | `lib/hub-proposal-personal-self-apply.mjs:285-316` |
| G22 | media_attach apply uses local `writeNote` + `resolveMediaPointerForAttach` (vault walk for `att_mist_*`) | `lib/attachments/attachment-write.mjs:235-271`, `:886-907` |
| G23 | media_external_link apply upserts external-ref store only (dataDir — bridge-friendly) | `lib/attachments/attachment-write.mjs:873-883` |
| G24 | Gates default off via env tri-state + policy file | `lib/attachments/attachment-write.mjs:99-111`; `hub/server.mjs:1324` |

---

## §SM.2 — Frozen rules (WHAT)

### SM-C1 — Gateway post-approve media hook (parity; S7.6)

**Rule:** On successful hosted canister `POST …/proposals/:id/approve` (same gate block as
`hub/gateway/server.mjs:3548-3607`), the gateway MUST call
`maybeApplyHostedMediaAfterApprove` and merge the outcome into the approve response body.

| Field (approve JSON) | Meaning |
| --- | --- |
| `media_index_applied` | `true` when bridge apply succeeded; `false` when media proposal classified but apply failed |
| `media_apply` | Bridge payload on success (include `applied`, `proposal_id`, `proposal_kind`, and kind-specific ids) |
| `media_apply_error` / `media_apply_code` | Present when classified but `applied: false` |

**Null outcome:** If normalize returns null / non-media, the hook returns `null` and the
response body is unchanged (task/capture parity).

**HTTP status:** Canister approve success remains primary. Apply failure is **non-fatal**
to HTTP status but MUST surface `media_index_applied: false` + error fields. Auto MUST
`console.error` on failure (parity).

**Module location:** New `hub/gateway/media-approve-hosted.mjs` (do not inline the hook
body into `server.mjs` beyond import + call + merge). Call order after the capture hook
in the approve success block (delegation → task → capture → **media**).

### SM-C2 — S3.0 / S3.1 same-change seam condition (load-bearing)

**Rule:** Auto MUST introduce

`normalizeCanisterProposalForMediaPrecheck(proposal)`

in `lib/attachments/media-hosted-proposal.mjs` (or equivalent `lib/attachments/**` module
that does **not** import `hub/gateway/**`), and in the **same** change:

1. The media approve hook's classify step MUST be
   `normalizeCanisterProposalForMediaPrecheck(proposal) != null` (identical call, not a
   copied field list).
2. `isSeamSurfaceProposal` MUST gain a condition:
   `normalizeCanisterProposalForMediaPrecheck(proposal) != null`
   (hosted media rows that carry markers only in frontmatter).
3. Existing `proposal.source === MEDIA_PROPOSAL_SOURCE` condition MUST remain (self-hosted).

**Forbidden (S3.0):** any new `SEAM_*` array of kinds/intents/field names used as a
parallel classifier; any seam condition that reads a different key than the apply path
honors (the N1 class of defect).

**Normalize recognition (minimum union — mirror task G20):** return non-null when any of:

- frontmatter `knowtation_proposal_source === MEDIA_PROPOSAL_SOURCE` (FM key parity with task), or
- `proposal.source === MEDIA_PROPOSAL_SOURCE`, or
- path prefix `meta/media/proposals/` (mirror path family used by self-hosted media propose)

and the proposal carries a resolvable media kind (`media_external_link` | `media_attach`)
from frontmatter / `media_meta` / body JSON (fail-closed null if kind absent/unknown).

**Fail-closed:** if normalize throws, `isSeamSurfaceProposal` treats as seam (existing
S3.1 catch). Normalize itself MUST be total over arbitrary input (object guards +
defensive parse) like task/delegation normalizers.

**Correspondence table (security-tier must assert):**

| Apply trigger | Covered by |
| --- | --- |
| Hosted media approve hook (SM-C1) | `normalizeCanisterProposalForMediaPrecheck != null` |
| Self-hosted media apply | `proposal.source === MEDIA_PROPOSAL_SOURCE` (unchanged) |

### SM-C3 — Bridge propose + canister create helper

**Rule:** Bridge MUST expose (behind `requireBridgeAuth` + vault context + role gates
matching self-hosted MEDIA_WRITE_ROLES / consent read roles):

| Method + path | Handler family |
| --- | --- |
| `POST api/v1/attachments/link-proposals` | `handleMediaLinkProposeRequest` with `createProposal` → canister |
| `POST api/v1/attachments/attach-proposals` | `handleMediaAttachProposeRequest` with `createProposal` → canister |
| `POST api/v1/attachments/import-consents` | grant |
| `GET api/v1/attachments/import-consents` | list |
| `DELETE api/v1/attachments/import-consents/:id` | revoke |

Helper `createMediaProposalOnCanister` MUST embed media markers via a
`mergeMediaFrontmatter` (parity `mergeTaskFrontmatter`) so canister rows survive without
a `media_meta` column — FM keys at minimum:

- `knowtation_proposal_source` = `media`
- `media_proposal_kind` = `media_external_link` | `media_attach`
- kind-specific ids (`attachment_id`, `connector_id`, `consent_id`, `note_ref` as applicable)

**E1:** When `sessionBound === true` and the fingerprint admits, create-time evaluation
satisfaction MAY set `evaluation_status: passed` via the existing
`applyPersonalSelfApplyEvaluationE1` path (task hosted parity). Normalize MUST set
`source: MEDIA_PROPOSAL_SOURCE` on the normalized object so T5 fingerprint (G21) can match
hosted rows after normalize.

**Gates:** Propose handlers still honor `getMediaExternalLinkEnabled` /
`getMediaAttachEnabled` (default off). Hosted routes with gates off return the same
refusal codes as self-hosted.

### SM-C4 — Bridge apply-approved + shared precheck/apply

**Rule:** Bridge MUST expose:

`POST api/v1/attachments/proposals/:proposal_id/apply-approved`

behind `requireBridgeAuth`, vault context, and canister header pattern parity with task
apply-approved.

Helper:

`applyApprovedMediaProposalFromCanister({ dataDir, canisterUrl, headers, proposalId, requireApproved, vaultPath?, vaultConfig? })`

| Step | Behavior |
| --- | --- |
| 1 | Fetch canister proposal + `normalizeCanisterProposalForMediaPrecheck` |
| 2 | If normalize null → 400 `BAD_REQUEST` |
| 3 | If `requireApproved !== false` and `status !== 'approved'` → 409 `CONFLICT` |
| 4 | Run media precheck (SM-C5) — refusal codes MUST match self-hosted |
| 5 | On precheck fail → return that status/code/error (no mutate) |
| 6 | Apply per SM-C5 |
| 7 | Persist media blob files (SM-C6) |
| 8 | Return `{ applied: true, proposal_id, vault_id, proposal_kind, … }` |

**Gateway hook** calls this route with learner Authorization + `X-Vault-Id` (task parity).

### SM-C5 — Kind effects + hosted vault asymmetry

**Rule:** Hosted Hub-complete apply MUST reach the same canonical effects as
`reconcileApprovedMediaProposal` for both kinds, with the following hosted HOW constraint:

| `proposal_kind` | Canonical effect | Hosted HOW |
| --- | --- | --- |
| `media_external_link` | upsert `hub_attachment_external_refs.json` | Call `precheckApprovedMediaProposal` + `reconcileApprovedMediaProposal` on bridge dataDir + blob (G23) — identical functions |
| `media_attach` | append pointer to target note `attachments[]` | **Canister note read-modify-write** via existing canister note HTTP surface (`hub/icp/src/hub/main.mo:404-411` notes routes — GET/POST `api/v1/notes` family already used by gateway catch-all). MUST NOT depend on Netlify-local vault filesystem walk |

**media_attach IO adapter (required — resolves precheck/vaultPath tension):**
Self-hosted `precheckApprovedMediaProposal` / `reconcileApprovedMediaProposal` read/write
notes through `ctx.vaultPath` (`lib/attachments/attachment-write.mjs:825-907`). Hosted Auto
MUST choose **exactly one** of:

1. **Temp stage:** GET canister note → write into a per-request temp vaultPath → call the
   **same** `precheckApprovedMediaProposal` + `reconcileApprovedMediaProposal` → POST/write
   the mutated note back to canister → discard temp dir; or
2. **Thin noteIO hook:** extend those two functions with an optional note reader/writer that
   defaults to today's filesystem helpers and, on hosted, delegates to canister notes — without
   changing refusal codes or branching a second precheck.

Forking a hosted-only precheck that re-implements connector/consent/lineage rules is
**forbidden**. Auto MUST NOT invent a second note-write protocol outside the canister notes
surface above.

**Propose-time pointer stamp (media_attach):** When creating a hosted attach proposal,
Auto MUST resolve the attach pointer once (via `resolveMediaPointerForAttach` when a
vaultPath is available, or an equivalent hosted resolver) and persist it on the proposal
as `media_meta.media_pointer` **and** frontmatter `media_pointer`. Apply MUST prefer that
stamped pointer and MUST NOT require a vault-wide mist walk on the bridge lambda (G22).

If the attachment cannot be resolved at propose time → refuse `404 unknown_attachment`
(same as self-hosted) — no silent propose.

**Note concurrency:** media_attach precheck still enforces `base_state_id` / live note
state against the canister-fresh note (via the adapter above), not an empty local vault.

**Precheck refusal codes** (`MEDIA_CONNECTOR_DENIED`, `MEDIA_IMPORT_CONSENT_REQUIRED`,
`MEDIA_LINEAGE_CONFLICT`, `MEDIA_DRAFT_INVALID`, …) MUST come from the shared precheck —
no hosted-only fork.

### SM-C6 — Blob hydrate/persist for media stores

**Rule:** The following files MUST be hydrated before media propose/apply/list reads that
depend on them, and persisted after mutating writes (parity capture blob sync):

- `hub_attachment_external_refs.json`
- `hub_media_import_consent.json`
- `hub_media_connector_policy.json`
- `hub_media_write_policy.json`

Auto may extend `EXTERNAL_PROTOCOL_BLOB_FILES` **or** add a dedicated media blob helper
module — either is fine if every mutating media bridge route and list/get that reads
those stores hydrates first. Merge strategy for concurrent warm-lambda writes MUST be
id-keyed union with newest-`updated` wins for external refs (parity
CAPTURE-STORE-STALE-MERGE lessons) — document the chosen merge in code comments + tests.

### SM-C7 — Gateway proxies + attachment list/get exposure

**Rule:** Gateway MUST proxy to BRIDGE_URL **before** the canister catch-all:

- `POST api/v1/attachments/link-proposals`
- `POST api/v1/attachments/attach-proposals`
- `POST|GET|DELETE api/v1/attachments/import-consents[/:id]`
- `POST api/v1/attachments/proposals/:proposal_id/apply-approved` (ops re-apply; optional for clients, mandatory for the hook)
- `GET api/v1/attachments` and `GET api/v1/attachments/:id`

Static-path ordering MUST NOT steal unrelated `api/v1` routes outside the attachment
surface. Attachment list/get on bridge reuse `handleAttachmentListRequest` /
`handleAttachmentGetRequest` with blob hydrate so connector_ref rows from external-link
apply are visible to Scooling hosted reads.

### SM-C8 — Session-bound seam + T5 posture (no redesign)

**Rule:**

1. Hosted media propose is a seam surface under SM-C2. SEC-SEAM-1 session-binding /
   author-match / named refusals apply unchanged.
2. T5 admission for media fingerprints (**already** admitted by FINISH-COMPLETE-APPLY)
   remains; Auto MUST NOT remove media from T5. Hosted normalize MUST make fingerprint
   evaluation possible (SM-C3 `source` on normalized object).
3. Delegation stays out of media paths. Capture/Flow authoring hooks untouched.

### SM-C9 — PROPOSAL-LIFECYCLE honesty

**Rule:** Replace the “self-hosted only today” media subsection with:

1. Hosted media propose/apply exists via gateway→bridge (SM-C1–C7) when gates allow.
2. Seam classification uses `normalizeCanisterProposalForMediaPrecheck` (hosted) and
   `source: media` (self-hosted) — S3.0.
3. Hub gates `MEDIA_EXTERNAL_LINK_ENABLED` / `MEDIA_ATTACH_ENABLED` still default off;
   production flips remain Tier 3.
4. Hub-complete approve invokes `maybeApplyHostedMediaAfterApprove`; apply failure is
   non-fatal to approve status (`media_index_applied: false`).

### SM-C10 — No posture / env flip; no P6 unpark

**Rule:** SEC-SEAM-MEDIA-a and SEC-SEAM-MEDIA-b MUST NOT:

- set production `MEDIA_EXTERNAL_LINK_ENABLED` / `MEDIA_ATTACH_ENABLED`
- flip Scooling media authorize/env flags
- execute SEC-KN-P6-ROTATE R4–R5 or write `SESSION_SECRET*`

### SM-C11 — Fail-closed security properties

| Threat | Required behavior |
| --- | --- |
| Apply before approve | Bridge `requireApproved: true` → 409 if not `approved` |
| Non-media proposal hit apply route | 400; no store/note mutate |
| Parallel seam list (N1 class) | Forbidden — SM-C2 source-scan in tier 7 |
| Cross-vault / wrong partition | Bridge vault context + canister `X-User-Id` / `X-Actor-Id` / `X-Vault-Id` |
| SSRF via opaque_ref | Unchanged MEDIA contract — never fetch/dereference |
| Secrets in envelopes | No tokens/secrets in `media_apply` payload fields |
| Consent MCP write | Consent grant/revoke remain non-MCP-write (MEDIA KN-MD-3) |
| Service-token self-apply | Existing SEC-SEAM-1 refusals; no weakening |

### SM-C12 — Citation readiness + hosted approve/apply ordering honesty

Every freeze-review / build-verification finding against this artifact MUST cite
**file+line**. Uncited findings are invalid.

**Ordering:** Hosted canister approve commits **before** the gateway media hook runs
(G1 parity). Therefore precheck/apply failure after successful approve yields
**approved proposal + no media effect** with honest `media_index_applied: false`.
Auto MUST NOT claim atomic approve+apply on hosted. Self-hosted keeps
precheck-before-commit (G9) unchanged.

Ops recovery: re-calling bridge apply-approved when `status === 'approved'` is allowed
(SM-C4). The post-approve hook remains mandatory on every successful approve.

---

## §SM.3 — HOW (Auto implementation sketch)

Ordered for SEC-SEAM-MEDIA-b. No redesign beyond this list.

1. **`lib/attachments/media-hosted-proposal.mjs`:** `mergeMediaFrontmatter`,
   `normalizeCanisterProposalForMediaPrecheck`, `createMediaProposalOnCanister`,
   `fetchCanisterProposalForMedia`, `applyApprovedMediaProposalFromCanister` (SM-C2–C5).
2. **`hub/bridge/media-routes.mjs` (new):** register propose/consent/list/get/apply-approved;
   wrap mutates with media blob sync (SM-C3, SM-C4, SM-C6, SM-C7).
3. **Blob module:** extend `EXTERNAL_PROTOCOL_BLOB_FILES` or add media blob helper + merge
   tests (SM-C6).
4. **`hub/gateway/media-approve-hosted.mjs`:** `maybeApplyHostedMediaAfterApprove` +
   `mergeMediaApplyIntoApproveResponse` (SM-C1).
5. **`hub/gateway/server.mjs`:** import hook; call after capture in approve success block;
   add attachment proxies with safe ordering (SM-C7).
6. **`lib/hub-proposal-personal-self-apply.mjs`:** add normalize condition to
   `isSeamSurfaceProposal` **same commit as hook** (SM-C2).
7. **media_attach hosted note I/O:** temp-stage or noteIO adapter + propose-time
   `media_pointer` stamp (SM-C5); canister notes surface only.
8. **`docs/openapi.yaml`:** attachment write/apply/consent hosted shapes with the routes.
9. **`docs/PROPOSAL-LIFECYCLE.md`:** SM-C9 wording.
10. **Tests:** `test/sec-seam-media-hosted.test.mjs` — §SM.4.
11. **Governance:** ROADMAP + OVERSEER-HANDOVER together; feature-branch Muse commit.
12. **Do not** flip envs; **do not** touch P6 secrets.

---

## §SM.4 — Seven-tier test matrix (SEC-SEAM-MEDIA-b)

File: prefer `test/sec-seam-media-hosted.test.mjs` (may split if size demands).

| Tier | Must prove |
| --- | --- |
| **1 unit** | `mergeMediaApplyIntoApproveResponse` success/failure/null; normalize true for each recognition arm + false for notes/task; normalize sets `source: media`; pointer stamp preferred over vault walk |
| **2 integration** | Bridge apply-approved with mock canister `media_external_link` → external-ref upsert visible via attachment list on same `dataDir`; blob persist called or store file updated |
| **3 e2e** | Live Express gateway + mock bridge + mock canister: admin approve of media proposal → `media_index_applied: true` and bridge apply invoked; non-media approve → no media fields; gateway proxies hit bridge not canister catch-all |
| **4 stress** | ≥50 sequential media apply-approved calls complete without unbounded handle growth; last external-link still listable |
| **5 data-integrity** | Second apply-approved after external-link → `MEDIA_LINEAGE_CONFLICT` or explicit idempotent success **without** duplicate ref rows; consent expiry still refuses precheck |
| **6 performance** | Single apply-approved + list p95 budget on fixture (document bound; no real canister network) |
| **7 security** | (a) Correspondence: hook trigger ≡ S3.1 media normalize condition (source-scan + behavioral); (b) apply-approved with `status: proposed` → 409; (c) no new hand-written seam kind/intent list introduced; (d) opaque_ref never fetched (no http(s) client call in media apply path); (e) gates-off propose still 403 |

Existing `test/sec-seam-1-session-bound-identity.test.mjs` MUST remain green (re-run in BV).

---

## §SM.5 — Definition of Done (SEC-SEAM-MEDIA-b)

- SM-C1–C12 implemented exactly
- Freeze-review `pass` on this artifact (prerequisite — this Thinking step)
- Seven-tier tests green
- `/build-verification-review` → `pass` before ROADMAP → DONE
- No secrets committed; no posture/env flip; no P6 R4–R5
- `docs/ROADMAP.md` + `docs/OVERSEER-HANDOVER.md` updated together (SD-17)
- Feature-branch Muse commit; merge remains Tier 3 / SD-21 land path

---

## §SM.6 — Downstream paste (SEC-SEAM-MEDIA-b Auto) — after freeze-review pass

```text
Step: SEC-SEAM-MEDIA-b
Model: Auto
Authority: knowtation
Frozen: docs/SEC-SEAM-MEDIA-FREEZE.md (frozen: true; review_stamp pass)

Implement SM-C1–C12 exactly:
- hub/gateway/media-approve-hosted.mjs + wire after capture in approve success block
- lib/attachments/media-hosted-proposal.mjs (normalize + create + apply-from-canister)
- isSeamSurfaceProposal gains normalizeCanisterProposalForMediaPrecheck in SAME change (S3.0)
- bridge media routes: propose/consent/list/get/apply-approved + blob sync
- gateway proxies before canister catch-all
- media_attach hosted note RMW via canister + propose-time media_pointer stamp
- PROPOSAL-LIFECYCLE honesty; seven-tier test/sec-seam-media-hosted.test.mjs
- /build-verification-review → pass; governance sync; Muse feature-branch commit
- No MEDIA_* / SCOOLING_MEDIA_* flips; no SESSION_SECRET writes; no P6 R4-R5; SD-14
```
