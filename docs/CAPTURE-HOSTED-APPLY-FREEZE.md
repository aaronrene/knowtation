# CAPTURE-HOSTED-APPLY — Hosted Hub-complete capture apply (Knowtation)

Status: **Frozen Thinking outline (CAPTURE-HOSTED-APPLY-a / 9-kn-a).** Spec only — no
product code in this step. No `FLOW_CAPTURE_*_ENABLED` flip. No Scooling
`FLOW_CAPTURE_*_AUTHORIZED` flip. No run / automatable / projection / Delegation
flip. **No T5 admission** for `source: flow_capture` (SD-23 kept). Do **not**
approve canister proposal `prop-1785500300353491755` until **9-kn-b** ships and
BV `pass`. Downstream Auto (**CAPTURE-HOSTED-APPLY-KN-b / 9-kn-b**) implements
this contract only after freeze-review `pass`.

```yaml
phase: CAPTURE-HOSTED-APPLY-a
outputs:
- id: capture-hosted-apply-freeze
  path: docs/CAPTURE-HOSTED-APPLY-FREEZE.md
  frozen: true
  notes: 'Gateway maybeApplyHostedCaptureAfterApprove + bridge apply-approved + Flow upsert / candidate terminal states on Hub admin|evaluator approve; T5 stays SELF_APPLY_NOT_ADMITTED; GET flows list/get hosted exposure; CHA-C1–C11; no posture/env flip; prop-1785500300353491755 stays pending until 9-kn-b

    '
frozen_inputs:
- id: flow-capture-live-freeze
  path: ../scooling/docs/FLOW-CAPTURE-LIVE-FREEZE.md
  notes: frozen:true; review_stamp pass; FCL-C1 option B; FCL-C3 T5 refuse; SD-23
- id: flow-capture-live-hosted-freeze
  path: ../scooling/docs/FLOW-CAPTURE-LIVE-HOSTED-FREEZE.md
  notes: frozen:true; FCH hosted observe/propose/dismiss; postures false until flip
- id: proposal-lifecycle
  path: docs/PROPOSAL-LIFECYCLE.md
  notes: Wave 2 option B; flow_capture seam + SELF_APPLY_NOT_ADMITTED
- id: gateway-approve-hooks
  path: hub/gateway/server.mjs
  notes: assertHostedProposalApproveDiscard + task/delegation post-approve hooks
- id: task-approve-hosted
  path: hub/gateway/task-approve-hosted.mjs
  notes: maybeApplyHostedTaskAfterApprove + mergeTaskApplyIntoApproveResponse pattern
- id: delegation-approve-hosted
  path: hub/gateway/delegation-approve-hosted.mjs
  notes: maybeApplyHostedDelegationAfterApprove pattern
- id: capture-facade
  path: lib/flow/flow-capture.mjs
  notes: precheckApprovedCaptureProposal + applyCaptureProposal (self-hosted truth)
- id: capture-hosted-proposal
  path: lib/flow/flow-capture-hosted-proposal.mjs
  notes: frontmatter normalize + fetchCanisterProposalForCapture (no apply yet)
- id: bridge-capture-routes
  path: hub/bridge/flow-capture-routes.mjs
  notes: observe/list/propose/dismiss only — no apply-approved
- id: self-hosted-approve
  path: hub/server.mjs
  notes: capture precheck before approve commit; applyCaptureProposal after mirror
- id: personal-self-apply
  path: lib/hub-proposal-personal-self-apply.mjs
  notes: flow_capture seam; T5 omits capture → SELF_APPLY_NOT_ADMITTED
- id: flow-store-blob
  path: hub/bridge/external-agent-blob-store.mjs
  notes: hub_flow_store.json in EXTERNAL_PROTOCOL_BLOB_FILES; mergeFlowStoreJson
- id: product-order-board
  path: ../scooling/docs/ROADMAP.md
  notes: rows 9-apply BLOCKED; 9-kn-a/9-kn-b queued
review_stamp:
  reviewed_at: '2026-07-31T15:47:33Z'
  verdict: pass
  reviewer_mode: agent
  reviewer_model: thinking-high
  reviewer_provider: local
  kit_version: 0.1.0
  artifact_digest: sha256:6db36223e5e6c9bf8ec4788962e69db4e42bbee9032cddad339a2677832000e5
downstream:
- id: CAPTURE-HOSTED-APPLY-KN-b
  model: Auto
  consumes_as_ground_truth: true
  notes: Implement CHA-C1–C11; seven-tier green; BV pass; no posture/env flip
- id: CAPTURE-APPLY-CHECK-rerun
  model: Operator + Auto
  consumes_as_ground_truth: true
  notes: After 9-kn-b BV pass — approve prop-1785500300353491755 via Hub review; verify Flow list
tier3_gates:
- T1 Muse main / muse-mirror → GitHub main (SD-14) for 9-kn-b land
- T2 Production gateway/bridge deploy that mounts the capture apply hook
- T3 Approving prop-1785500300353491755 (or any live capture propose→approve) on production
- T4 Any FLOW_CAPTURE_*_ENABLED or Scooling FLOW_CAPTURE_*_AUTHORIZED flip (already on for SMOKE — do not change in 9-kn-b)
```

## Review record

| Round | Reviewer | Verdict | Resolution |
| --- | --- | --- | --- |
| 0 | Thinking (this session) | draft | Freeze authored |
| 1 | Freeze-review loop (thinking) + `ok review --freeze --dry-run` | findings | CLI-F1 / R1-F1–F3 fixed below |
| 2 | Freeze-review loop (thinking) + `ok review --freeze` | **pass** | R1 addressed. CLI C checklist clean. Semantic re-read: CHA-C1–C11 implementable; T5 refuse kept; no escalating category open. Cleared for 9-kn-b Auto. |

### Round 1 findings (cited — file+line)

| ID | Sev | Cat | Citation | Finding | Fix |
| --- | --- | --- | --- | --- | --- |
| CLI-F1 | BLOCKER | security | docs/CAPTURE-HOSTED-APPLY-FREEZE.md:183 (pre-fix) | Leading-slash Hub route citation matched absolute-path checklist (C4). | Rewrote Hub routes as `GET api/v1/flows` (no leading slash); scooling citations use `../scooling/…`. |
| CLI-F2 | MINOR | consistency | docs/CAPTURE-HOSTED-APPLY-FREEZE.md:1 | Checklist C8 requires literal `file+line` citation-readiness evidence. | Added CHA-C9. |
| R1-F1 | MAJOR | completeness | lib/flow/flow-capture.mjs:1037-1052 (precheck parses `proposal.body`); docs/CAPTURE-HOSTED-APPLY-FREEZE.md:§CHA.2 CHA-C2 | Auto could normalize frontmatter only and drop canister `body`, breaking promote bundle precheck. | CHA-C10 — body intact through apply. |
| R1-F2 | MAJOR | consistency | hub/gateway/server.mjs:3513-3556 (approve-then-hook); hub/server.mjs:3104-3161 (precheck-before-commit) | Freeze implied hosted apply parity without stating approve-already-committed asymmetry vs self-hosted. | CHA-C11 — honest approved-but-no-Flow + ops re-apply. |
| R1-F3 | MINOR | completeness | docs/CAPTURE-HOSTED-APPLY-FREEZE.md:§CHA.5 DoD | DoD said CHA-C1–C8 after C9–C11 added. | DoD + 9-kn-b paste → CHA-C1–C11. |

---

## Simple summary

Learners can already propose a capture suggestion for review. On the hosted Hub,
approving that review today only flips the proposal status — it does **not** save
a Flow. This freeze specifies the missing piece: after an admin or evaluator
approves a capture proposal, Knowtation must run the same promote / merge /
dismiss apply that self-hosted Hub already runs, so the Flow (or terminal
candidate state) lands in the library and shows up on the Flows list. One-click
learner self-apply for capture stays refused on purpose.

## Technical summary

**CAPTURE-HOSTED-APPLY** closes the hosted gap found by **9-apply CAPTURE-APPLY-CHECK
(2026-07-31)**: gateway post-approve hooks exist for task and delegation
(`maybeApplyHostedTaskAfterApprove` / `maybeApplyHostedDelegationAfterApprove`) but
**not** for `source: flow_capture`. Self-hosted approve still calls
`precheckApprovedCaptureProposal` then `applyCaptureProposal` → `upsertFlowVersion`
(`hub/server.mjs`). Hosted canister approve has no bridge apply-approved route for
capture. Wave 2 / SD-23 keeps T5 `SELF_APPLY_NOT_ADMITTED` for all capture kinds;
Hub-complete approve (admin / permitted evaluator) is the apply authority. This
freeze also requires hosted `GET api/v1/flows` (+ get-by-id) bridge exposure so
Scooling `listFlows` can observe the upserted Flow after apply.

---

## §CHA.0 — Scope and hard stops

### In scope (9-kn-a freeze → 9-kn-b Auto)

| Deliverable | Owner |
| --- | --- |
| `maybeApplyHostedCaptureAfterApprove` + response merge on gateway approve success | Knowtation |
| Bridge `POST …/apply-approved` for capture + `applyApprovedCaptureProposalFromCanister` | Knowtation |
| Reuse `precheckApprovedCaptureProposal` + `applyCaptureProposal` on bridge `dataDir` | Knowtation |
| Blob hydrate/persist of `hub_flow_store.json` around apply (and list reads) | Knowtation |
| Hosted `GET api/v1/flows` + `GET api/v1/flows/:id` bridge routes + gateway proxies | Knowtation |
| PROPOSAL-LIFECYCLE Wave 2 note: Hub-complete apply path exists; T5 still refuse-all | Knowtation |
| Seven-tier tests for the above | Knowtation |

### Explicitly NOT in scope

| Out of scope | Why |
| --- | --- |
| T5 / personal self-apply admission for `source: flow_capture` | SD-23 / FCL-C1 / FCL-C3 |
| Approve `prop-1785500300353491755` in this Thinking or Auto session | Board hard stop until hook ships + BV pass |
| Flip Knowtation `FLOW_CAPTURE_*_ENABLED` or Scooling capture postures | Already set for SMOKE; not this phase |
| `maybeApplyHostedFlowAfterApprove` for Wave 1 Flow **authoring** | Separate gap; not capture |
| `maybeApplyHostedMediaAfterApprove` | SEC-SEAM-MEDIA |
| Wave 3 capture UX (candidate list + dismiss surfaces in Scooling) | After 9-apply re-run |
| MuseHub F7 | AWS-parked |
| Feature → GitHub-`main` | SD-14 |
| Secrets, real money, Delegation write env | Hard stop |

### Hard stops

- No T5 admission helper or fingerprint for capture kinds
- No posture / production env flip inside 9-kn-a or 9-kn-b
- No `gh pr create --base main --head feat/…`
- No Auto product code in this Thinking turn
- Do **not** approve `prop-1785500300353491755` until after 9-kn-b BV `pass` and
  board advances to the 9-apply re-run

---

## §CHA.1 — Ground truth (verified 2026-07-31)

Every row was read in this session.

| # | Fact | Citation |
| --- | --- | --- |
| G1 | Gateway post-approve block calls delegation then task apply hooks only | `hub/gateway/server.mjs:3522-3553` |
| G2 | No `maybeApplyHostedCaptureAfterApprove` import or call on gateway | `hub/gateway/server.mjs:67-73` (imports); approve block `:3513-3556` |
| G3 | Task hook pattern: fetch canister → classify → `POST` bridge `…/tasks/proposals/:id/apply-approved` → merge `task_index_applied` | `hub/gateway/task-approve-hosted.mjs:37-118` |
| G4 | Delegation hook same shape with `delegation_index_applied` | `hub/gateway/delegation-approve-hosted.mjs:29-114` |
| G5 | Self-hosted approve prechecks capture **before** vault write; refuses on precheck fail | `hub/server.mjs:3104-3110` |
| G6 | Self-hosted approve applies capture via `applyCaptureProposal` after mirror write | `hub/server.mjs:3160-3161` |
| G7 | `precheckApprovedCaptureProposal` requires pending candidate + promote/merge/dismiss kind; promote validates bundle + scope; merge requires existing flow | `lib/flow/flow-capture.mjs:1037-1117` |
| G8 | `applyCaptureProposal`: dismiss→`rejected`; merge→`merged_into:`; promote→`upsertFlowVersion` + `promoted` | `lib/flow/flow-capture.mjs:1125-1143` |
| G9 | Hosted capture create embeds frontmatter markers; `fetchCanisterProposalForCapture` + normalize exist; **no** apply-from-canister helper | `lib/flow/flow-capture-hosted-proposal.mjs:59-74`, `:83-153`, `:289-312` |
| G10 | Bridge capture routes: observe / candidates list / propose / dismiss only | `hub/bridge/flow-capture-routes.mjs:135-251` |
| G11 | Gateway proxies those four capture surfaces to BRIDGE_URL | `hub/gateway/server.mjs:1102-1133` |
| G12 | T5 step 11 omits capture → `SELF_APPLY_NOT_ADMITTED` | `lib/hub-proposal-personal-self-apply.mjs:556-558` |
| G13 | PROPOSAL-LIFECYCLE: flow_capture seam + not admitted; Wave 2 propose-only / Hub-complete | `docs/PROPOSAL-LIFECYCLE.md:71-82` |
| G14 | Task apply-from-canister requires `status === 'approved'`, then precheck + reconcile into `hub_flow_store.json` | `lib/task/task-hosted-proposal.mjs:343-377` |
| G15 | Bridge task apply-approved persists blob after mutate | `hub/bridge/task-routes.mjs:375-400` |
| G16 | `hub_flow_store.json` is in `EXTERNAL_PROTOCOL_BLOB_FILES` with merge helper | `hub/bridge/external-agent-blob-store.mjs:15-19`, `:37+` |
| G17 | Gateway has **no** `GET api/v1/flows` or `GET api/v1/flows/:id` bridge proxy (list/get fall through to canister catch-all) | `hub/gateway/server.mjs:1035-1133` (projection/external-grants/candidates/POST only) |
| G18 | Bridge has **no** `GET api/v1/flows` list/get registration | `hub/bridge/flow-routes.mjs:174-187` (POST authoring only); `hub/bridge/flow-capture-routes.mjs` (capture write/list candidates) |
| G19 | Self-hosted list/get use `handleFlowListRequest` / `handleFlowGetRequest` | `hub/server.mjs:1189-1235`; `lib/flow/flow-handlers.mjs:65-103` |
| G20 | Scooling live `listFlows` calls Knowtation `GET api/v1/flows` | `../scooling/src/adapters/flowAdapter.ts:1848-1876`; `../scooling/src/adapters/flowHubTransport.ts:564-611` |
| G21 | Product board: 9-apply BLOCKED (hosted gap); 9-kn-a Thinking NEXT; proposal left pending | `../scooling/docs/ROADMAP.md:184-186`; `../scooling/docs/OVERSEER-HANDOVER.md:14-54` |
| G22 | Capture propose body carries `proposal_kind` / `candidate_id` / `bundle` JSON used by precheck | `lib/flow/flow-capture.mjs:896-926` |

---

## §CHA.2 — Frozen rules (WHAT)

### CHA-C1 — Gateway post-approve capture hook (parity)

**Rule:** On successful hosted canister `POST …/proposals/:id/approve` (same gate as
today’s task/delegation block at `hub/gateway/server.mjs:3513-3556`), the gateway
MUST call `maybeApplyHostedCaptureAfterApprove` and merge the outcome into the
approve response body.

| Field (approve JSON) | Meaning |
| --- | --- |
| `capture_index_applied` | `true` when bridge apply succeeded; `false` when capture proposal classified but apply failed |
| `capture_apply` | Bridge payload on success (include `applied`, `proposal_id`, `proposal_kind`, and promote `flow_id` when applicable) |
| `capture_apply_error` / `capture_apply_code` | Present when classified but `applied: false` |

**Null outcome:** If the proposal is not a capture proposal (normalize returns null /
non-capture), the hook returns `null` and the response body is unchanged (same as
task/delegation non-matches).

**HTTP status:** Canister approve success remains the primary status. Apply failure
is **non-fatal** to the HTTP status (parity with task/delegation today) but MUST
surface `capture_index_applied: false` + error fields. Auto MUST log the failure
(parity `console.error` for task/delegation).

**Module location:** New `hub/gateway/capture-approve-hosted.mjs` (do not inline the
hook body into `server.mjs` beyond import + call + merge).

### CHA-C2 — Bridge apply-approved route + canister apply helper

**Rule:** Bridge MUST expose:

`POST api/v1/flows/capture/proposals/:proposal_id/apply-approved`

behind `requireBridgeAuth`, vault context, and the same canister header pattern as
task apply-approved (`hub/bridge/task-routes.mjs:375-400`).

Helper (extend `lib/flow/flow-capture-hosted-proposal.mjs` or adjacent module —
Auto may choose filename as long as imports are stable):

`applyApprovedCaptureProposalFromCanister({ dataDir, canisterUrl, headers, proposalId, requireApproved })`

| Step | Behavior |
| --- | --- |
| 1 | `fetchCanisterProposalForCapture` (existing) |
| 2 | If normalize yields non-capture → 400 `BAD_REQUEST` |
| 3 | If `requireApproved !== false` and `status !== 'approved'` → 409 `CONFLICT` |
| 4 | Run `precheckApprovedCaptureProposal(dataDir, proposal)` — **same function** as self-hosted |
| 5 | On precheck fail → return that status/code/error (do not mutate store) |
| 6 | `applyCaptureProposal(dataDir, precheck)` |
| 7 | Persist `hub_flow_store.json` via `persistExternalProtocolStoresToBlob` (or `withExternalProtocolBlobSync` wrapping the mutate) |
| 8 | Return payload `{ applied: true, proposal_id, vault_id, proposal_kind, … }` with promote `flow_id` / merge `merge_into_flow_id` / dismiss marker as applicable |

**Gateway hook** calls this bridge route with the learner Authorization + `X-Vault-Id`
(parity task-approve-hosted).

### CHA-C3 — Precheck / apply parity with self-hosted (kinds)

**Rule:** Hosted Hub-complete apply MUST reach the same terminal effects as
`applyCaptureProposal` for all three kinds:

| `proposal_kind` | Canonical effect |
| --- | --- |
| `flow_candidate_promote` | `upsertFlowVersion` + candidate `promoted` |
| `flow_candidate_merge` | candidate `merged_into:{id}` (no silent Flow mint) |
| `flow_candidate_dismiss` | candidate `rejected` |

Precheck refusal codes (`FLOW_CANDIDATE_NOT_PROMOTABLE`, `FLOW_DRAFT_INVALID`,
`FLOW_LINEAGE_CONFLICT`, `unknown_flow`, …) MUST come from the shared precheck —
Auto MUST NOT fork a second hosted-only precheck.

**Candidate + store locality:** Observe/propose already write candidates into bridge
`dataDir` / blob-backed `hub_flow_store.json` (G10, G16). Apply MUST hydrate from
blob before precheck so a cold lambda still sees `pending_review` candidates.

### CHA-C4 — T5 stays refuse-all (SD-23)

**Rule:** 9-kn-b MUST NOT:

- add a capture fingerprint to `isAdmittedSeamSelfApplyFingerprint`
- create E1 create-time `evaluation_status: passed` for capture proposes
- allow member/editor personal self-apply to approve capture proposals

`personalSelfApplyRefusalReason` for capture proposals with session-bound
author==approver MUST remain `SELF_APPLY_NOT_ADMITTED`.

**Approve authority for Hub-complete:** existing hosted RBAC only — `admin`, or
`evaluator` with `mayApproveProposals` (`assertHostedProposalApproveDiscard`).
Capture remains a seam surface for classification; admission stays empty.

### CHA-C5 — Honest outcome exposure (list + proposal)

**Rule:** After a successful promote apply, a subsequent authenticated

`GET api/v1/flows` (scope filter personal/default as today)

MUST include the new Flow summary so Scooling `listFlows` / `/flows` can show it.

**HOW (required — G17/G18 prove absence today):**

1. Bridge registers `GET api/v1/flows` → `handleFlowListRequest` and
   `GET api/v1/flows/:id` → `handleFlowGetRequest` (self-hosted handlers), with
   blob hydrate before read.
2. Gateway proxies those two GETs to BRIDGE_URL **before** the canister catch-all,
   with static-path ordering that does **not** steal
   `flows/candidates`, `flows/capture/*`, `flows/external-grants`,
   `flows/import`, or `flows/:id/projection`.
3. Approve response (CHA-C1) exposes apply outcome; proposal `status` remains the
   canister source of truth (`approved` after successful approve).

**Out of scope for Scooling UI copy changes** — honesty strings already distinguish
pending vs saved; this phase makes Hub-complete save **true** on the wire.

### CHA-C6 — PROPOSAL-LIFECYCLE honesty

**Rule:** Update the Wave 2 capture subsection so it states:

1. T5 / personal self-apply remains refuse-all (`SELF_APPLY_NOT_ADMITTED`) — SD-23.
2. **Hub-complete** admin/evaluator approve on hosted MUST invoke the capture apply
   hook (CHA-C1–C3) so promote creates a Flow (and merge/dismiss terminate the
   candidate).
3. Wave 2 “propose-only” means **no learner self-apply / no auto-promote** — not
   “approve never applies.”

Do not claim media hosted apply exists.

### CHA-C7 — No posture / env flip; pending proposal untouched

**Rule:** 9-kn-a and 9-kn-b MUST NOT change:

- Knowtation `FLOW_CAPTURE_DETECTION_ENABLED` / `FLOW_CAPTURE_WRITES_ENABLED` defaults
  or production values as part of this phase
- Scooling `FLOW_CAPTURE_*_AUTHORIZED`
- run / automatable / projection / Delegation write gates

**Operator action deferred:** Approving `prop-1785500300353491755` is **Tier 3 /
board 9-apply re-run only** after 9-kn-b BV `pass`. Auto MUST NOT call approve on
that id.

### CHA-C8 — Fail-closed security properties

| Threat | Required behavior |
| --- | --- |
| Apply before approve | Bridge `requireApproved: true` → 409 if not `approved` |
| Non-capture proposal hit apply route | 400; no store mutate |
| Cross-vault / wrong partition | Existing bridge vault context + canister headers (`X-User-Id` effective, `X-Actor-Id` actor, `X-Vault-Id`) |
| Learner self-apply capture | Still `SELF_APPLY_NOT_ADMITTED` / 403 at approve gate |
| Secrets in envelopes | No tokens/secrets in `capture_apply` payload fields |
| Injection via proposal body | Shared `validateFlowBundle` / precheck path only — no `eval` / shell |

### CHA-C9 — Citation readiness

Every freeze-review finding against this artifact MUST cite `path:line` (**file+line**).
Uncited findings are invalid.

### CHA-C10 — Canister body is precheck input

**Rule:** `precheckApprovedCaptureProposal` reads `proposal.body` JSON (G7, G22), not
only frontmatter `capture_meta`. Hosted apply MUST pass the canister GET proposal
(with `body` string intact) through `normalizeCanisterProposalForCapturePrecheck`
without stripping `body`. If canister GET returns empty/missing body → precheck
refuses (`FLOW_DRAFT_INVALID`) and store is not mutated; approve response surfaces
`capture_index_applied: false` (CHA-C1).

### CHA-C11 — Hosted approve/apply ordering honesty

**Rule:** Hosted canister approve commits **before** the gateway capture hook runs
(G1 task/delegation parity). Therefore a precheck/apply failure after a successful
canister approve yields **approved proposal + no Flow** with honest
`capture_index_applied: false`. Auto MUST NOT claim atomic approve+apply on hosted.
Self-hosted keeps its precheck-before-commit behavior (G5) unchanged.

Ops recovery: re-calling bridge
`POST api/v1/flows/capture/proposals/:proposal_id/apply-approved` after fixing store
state is allowed when `status === 'approved'` (CHA-C2). Gateway may optionally proxy
that path for operators; the post-approve hook remains mandatory on every successful
approve.

---

## §CHA.3 — HOW (Auto implementation sketch)

Ordered for 9-kn-b. No redesign beyond this list.

1. **`lib/flow/flow-capture-hosted-proposal.mjs` (or sibling):** add
   `applyApprovedCaptureProposalFromCanister` per CHA-C2 (reuse
   `precheckApprovedCaptureProposal` + `applyCaptureProposal`).
2. **`hub/bridge/flow-capture-routes.mjs`:** register apply-approved; wrap mutate
   with blob sync; register `GET api/v1/flows` + `GET api/v1/flows/:id` **or**
   put list/get on `flow-routes.mjs` — either is fine if gateway proxies match and
   static routes win.
3. **`hub/gateway/capture-approve-hosted.mjs`:** `maybeApplyHostedCaptureAfterApprove`
   + `mergeCaptureApplyIntoApproveResponse` (CHA-C1).
4. **`hub/gateway/server.mjs`:** import hook; call after task apply in the approve
   success block; add GET list/get proxies with safe ordering (CHA-C5).
5. **`docs/PROPOSAL-LIFECYCLE.md`:** CHA-C6 wording.
6. **Tests:** `test/capture-hosted-apply-kn-b.test.mjs` (or split files) — §CHA.4.
7. **Governance:** ROADMAP + OVERSEER-HANDOVER together; feature-branch Muse commit.
8. **Do not** approve the live pending proposal; **do not** flip envs.

---

## §CHA.4 — Seven-tier test matrix (9-kn-b)

File(s): prefer `test/capture-hosted-apply-kn-b.test.mjs` (may split if size demands).

| Tier | Must prove |
| --- | --- |
| **1 unit** | `mergeCaptureApplyIntoApproveResponse` merges success/failure/null; normalize+apply helper refuse non-capture / non-approved; promote payload includes `flow_id` |
| **2 integration** | Bridge apply-approved with mock canister proposal → `upsertFlowVersion` visible via `listFlows`/`getFlow` on same `dataDir`; blob persist called or store file updated |
| **3 e2e** | Live Express gateway + mock bridge + mock canister: admin approve of capture proposal → response has `capture_index_applied: true` and bridge apply was invoked; non-capture approve → no capture fields |
| **4 stress** | ≥50 sequential capture apply-approved calls (or approve-hook invocations) complete without unbounded handle growth; last promote still listable |
| **5 data-integrity** | Idempotent second apply-approved after promote → fail-closed conflict or explicit idempotent success **without** duplicate `flow_id` versions beyond contract; dismiss/merge terminal statuses stick |
| **6 performance** | Single apply-approved + list p95 budget on fixture (document bound in test; no network to real canister) |
| **7 security** | (a) T5 refuse-all regression for promote/merge/dismiss still `SELF_APPLY_NOT_ADMITTED`; (b) apply-approved with `status: proposed` → 409; (c) source-scan: no new capture admission in `isAdmittedSeamSelfApplyFingerprint`; (d) GET list proxy does not expose secrets |

KN-b existing `test/flow-capture-live-kn-b.test.mjs` T5 suite MUST remain green
(re-run in BV).

---

## §CHA.5 — Definition of Done (9-kn-b)

- CHA-C1–C11 implemented exactly
- Freeze-review `pass` on this artifact (prerequisite — this Thinking step)
- Seven-tier tests green
- `/build-verification-review` → `pass` before ROADMAP → DONE
- No secrets committed; no posture/env flip; no live approve of `prop-1785500300353491755`
- `docs/ROADMAP.md` + `docs/OVERSEER-HANDOVER.md` updated together (SD-17)
- Feature-branch Muse commit; merge remains Tier 3 / SD-21 land path

---

## §CHA.6 — Downstream paste (9-kn-b Auto) — after freeze-review pass

```text
CAPTURE-HOSTED-APPLY-KN-b — implement hosted capture Hub-complete apply.

Model: Auto
Step: 9-kn-b
Repo: knowtation (workspace root)
Frozen: docs/CAPTURE-HOSTED-APPLY-FREEZE.md (frozen: true; review_stamp pass)
Authority: product_order PRIMARY — ROADMAP row 9-kn-b

Implement CHA-C1–C11 exactly:
- hub/gateway/capture-approve-hosted.mjs + wire into approve success block
- applyApprovedCaptureProposalFromCanister + bridge apply-approved
- GET api/v1/flows (+ :id) bridge + gateway proxies (ordered)
- T5 refuse-all unchanged; PROPOSAL-LIFECYCLE Hub-complete note
- Seven-tier test/capture-hosted-apply-kn-b.test.mjs; re-run flow-capture-live-kn-b
- /build-verification-review → pass; governance sync; Muse feature-branch commit

Hard stops: no T5 admission; no posture/env flip; no approve of
prop-1785500300353491755; no feature→GitHub-main.
```
)
