# SEC-SEAM-1 — frozen spec: session-bound learner identity for task / media / delegation / flow writes

**Phase:** SEC-SEAM-1 (`SEC-SEAM-1a` Thinking freeze → `SEC-SEAM-1b` Auto build)
**Freeze status:** **CLEARED — independent reviewer `pass` (round 7).** Escalated decisions §12
**D1–D5** are **RATIFIED by the operator** (§12.1: D1 = A, D2 = A, D3 = start empty, D4 = A,
**D5 = A**). Round-3's 11 findings (V1–V11), round-4's W1–W5, and round-5/6 X1–X2 / Y1 are addressed
(§11.3–§11.4). D3's cost-premise was corrected as a disclosure (V1) — the empty-list *outcome* is
unchanged. `SEC-SEAM-1b` (Auto) may start from this freeze. Tier-3 gates T1–T5 (§8) remain **not**
authorized and unexecuted.
**Date:** 2026-07-26 (authored) · 2026-07-27 (round-3 ratification; rounds 4–7 fixes; clearance)
**Model (this artifact):** Thinking
**Driving finding:** Pass 2 **P3** — `~/scooling/docs/PRE-BUILD-SECURITY-AUDIT-FINDINGS-PASS2.md` (row `P3`, owner `SC + KN`)
**Owner repos:** Knowtation (permission authority — rules S1–S10) **and** Scooling (consumer — contract C1–C6, built as `L-SEAM` on the Scooling board)

**No review stamp is present by design.** `ok review --freeze` writes a machine-readable
`review_stamp: {verdict: pass}` into this block when its *mechanical checklist* passes. Round 1 of the
semantic review (§11) correctly flagged that stamp as an authoring session recording its own
clearance — the SEC-KN-4a round-2 failure shape. The stamp was removed and may only be written after
a semantic reviewer records `pass` in §11. **Mechanical-gate status:** `ok review --freeze` blocked
twice during round-1 authoring — on an absolute machine path and on a secret-like pattern — and both
were fixed (§10). Round 2 recorded no run at all, and the round-1 header claim that it "is run with
`--dry-run` between rounds" was unsupported (N16); that wording is removed rather than reworded. It
was re-run at the end of the round-3 fix work. It **blocked twice, both times on the same checker
rule and both self-inflicted**: a self-hosted refresh route written with a leading slash (the §2
notation rule exists for exactly this), and then the sentence that *described* that fix, which quoted
the offending string. Both were rewritten to the §2 notation; the re-run returned **`pass`, 0
findings**. Round 4 re-ran it after V1–V11 / D5 fixes: again **`pass`, 0 findings**; again the run
**auto-wrote a `review_stamp: {verdict: pass}` block and this session removed it**. Round 5 re-ran
it after W1–W5 (**`pass`, 0 findings**; stamp removed). Round 6 re-ran it after X1–X2 (**`pass`, 0
findings**; stamp removed again). Round 7 re-ran it after Y1 (**`pass`, 0 findings**; stamp removed
in this session). The round-1 F1 rule stands: a mechanical checklist passing is not a reviewer
clearing the freeze.
`--dry-run` is accepted by `ok review` but is undocumented in `ok review --help`; it does not appear
to suppress the stamp on its own, so **the stamp must be checked for and removed by hand after every
run** until §11 records a semantic `pass`.
The mechanical gate is **not** a semantic clearance and never substitutes for §11.

## Freeze-contract declaration

```yaml
phase: SEC-SEAM-1
outputs:
- id: sec-seam-1-freeze
  path: docs/SEC-SEAM-1-SESSION-BOUND-IDENTITY-FREEZE.md
  frozen: true
frozen_inputs:
- docs/ROADMAP.md
- docs/OVERSEER-HANDOVER.md
- docs/SEC-KN-4-DELEGATION-PRINCIPAL-BINDING-FREEZE.md
- docs/PROPOSAL-LIFECYCLE.md
- ~/scooling/docs/PRE-BUILD-SECURITY-AUDIT-FINDINGS-PASS2.md
- ~/scooling/docs/ROADMAP.md
review_stamp:
  reviewed_at: '2026-07-27T13:25:02Z'
  verdict: pass
  reviewer_mode: agent
  reviewer_model: thinking-high
  reviewer_provider: local
  kit_version: 0.1.0
  artifact_digest: sha256:286147aaca3caf9fe7579e472a87af3da5245d0f6778749ff722b2098f1d1e68
tier3_gates:
- T1 canister WASM upgrade that installs created_by (inherited from SEC-KN-4 gate T1)
- T2 merge to Muse main or a muse-mirror pull request (SD-14)
- T3 flipping SCOOLING_TASK_WRITES / SCOOLING_MEDIA_* / SCOOLING_DELEGATION_* on in production
- T4 restoring the migration hook to identity after T1 (inherited from SEC-KN-4 gate T4 / SEC-KN-4c)
- T5 admitting any new intent into the personal self-apply class (FINISH-COMPLETE-APPLY KN-b)
```

---

## 1. Plain-language summary

When a learner uses Scooling to create a task, attach a piece of media, or set up an agent consent,
Scooling does not send Knowtation the learner's own sign-in credential. It sends **one shared
password that belongs to the operator**, taken from an environment variable. Knowtation therefore
sees every learner's request as if it came from the same single person.

Nothing is broken in production today, because these three surfaces are switched off and because
Knowtation only lets people "approve their own work without a second reviewer" for one narrow kind
of note proposal, which these surfaces do not match. The danger is what happens next: the planned
step is to let people approve their own task and media work. If that shipped while every request
arrives under one shared name, "approving your own work" would mean **one shared identity approving
work it cannot attribute to any actual person**.

This document freezes the fix and, just as importantly, **who can fix what**. Scooling must send each
learner's own credential — it already does exactly this for the notes review tray, so the mechanism
exists and only needs reusing. Knowtation cannot detect a shared credential by looking at it, and
this freeze says so plainly instead of pretending otherwise. What Knowtation *can* do, and what it is
required to do here, is refuse to ever let one of these surfaces be self-approved unless the server's
own record shows that the person approving is the same person who wrote the request — and refuse
loudly, by name, rather than silently allowing it.

### Technical summary

Scooling's `taskWriteHubTransport.ts`, `mediaWriteHubTransport.ts`, `delegationHubTransport.ts`, and
`flowHubTransport.ts` build their write `Authorization` header from `KNOWTATION_AUTH_TOKEN` /
`KNOWTATION_HUB_TOKEN` (`taskWriteHubTransport.ts:208-212`, `:293-302`;
`flowHubTransport.ts:1119`), whereas `hostedReviewWriteBack.ts:843-851` sends
`sessionResult.rawToken` — the learner's own Knowtation JWT from the signed HttpOnly cookie.
Knowtation resolves caller identity from the JWT `sub` alone (`hub/bridge/server.mjs:840-847`,
`:900-907`) and marks no token class on web-session JWTs (`hub/gateway/access-token-authz.mjs:28-30`
distinguishes only `mcp_access`). A shared operator token is therefore **byte-indistinguishable** from
a learner session, and every seam proposal lands with the same `X-Actor-Id`, the same canister
`created_by` (`hub/icp/src/hub/main.mo:160-169`), and the same `proposed_by`
(`lib/task/task-write.mjs:499`).

SEC-SEAM-1b makes session-bound identity a **positive, server-derived, mint-time property** (S1),
makes author-equals-approver a hard admission requirement for any seam surface entering the
self-apply class (S2–S3 — classification by apply-path predicate, not intent), forbids
client-asserted identity as a remedy (S4–S5), names the refusals (S6), records the hosted media gap
(S7), and includes self-hosted flow / flow_capture as seam surfaces (D5 = A). The systemic
one-identity-per-learner property is **consumer-owned** and cannot be enforced server-side (§3.2).

---

## 2. Ground truth — what the code does today (file+line)

Every row below was read in this session. No row is inferred, and no row is carried over from the
audit without re-reading the cited source.

**Notation:** HTTP route paths are written without their leading slash (`api/v1/…`) throughout this
document, because the freeze-gate path check treats a leading-slash multi-segment path as an absolute
machine path (kit source: `overseer-kit/tools/freeze_reviewer/providers/base.py:15` — the kit
checkout, not this repo).

| # | Ground truth | Citation |
| --- | --- | --- |
| G1 | Bridge auth resolves identity from the JWT `sub` and nothing else — no `type`, scope, or class check | `hub/bridge/server.mjs:840-847`, `:900-907` |
| G2 | Only `mcp_access` is a distinguishable token class; web-session JWTs carry **no** `type` claim | `hub/gateway/access-token-authz.mjs:28-30`, `:121-129` |
| G3 | The gateway signs `SESSION_SECRET` JWTs at **three** sites. Two mint the web-session shape `{sub, provider, id, name, role}`; the third mints `{sub}` only, a 5-minute internal token for the gateway→bridge GitHub-token hop, presented as a bearer at `:1301` | `hub/gateway/server.mjs:213-228` (`issueToken`), `:277-287` (`issueAccessTokenForSub`), `:1282` (internal hop) |
| G3.1 | `mcp_access` tokens are minted at **four** further sites — an initial grant **and** a refresh/rotation path in each provider — and **all four** already carry `type: 'mcp_access'`, so they are out of S1's scope. (N11: round 1 enumerated only the two initial-grant sites) | `hub/gateway/device-oauth-provider.mjs:204` (grant), `:262` (refresh); `hub/gateway/mcp-oauth-provider.mjs:240` (grant), `:311` (refresh) |
| G4 | Native OAuth code exchange mints through `issueAccessTokenForSub`, not a fourth shape | `hub/gateway/native-oauth-provider.mjs:442-445` |
| G5 | `X-Actor-Id` is set server-side from the verified `sub`; clients cannot inject it (allowlist forwards only content headers) | `hub/gateway/server.mjs:3204-3205`, `:3209-3213`, `:1351-1356` |
| G6 | Canister `created_by` reads `X-Actor-Id` only, no fallback, empty when absent (SEC-KN-4b, on branch) | `hub/icp/src/hub/main.mo:160-169` |
| G7 | Canister partition is `X-User-Id`, defaulting to `"default"` | `hub/icp/src/hub/main.mo:153-158` |
| G8 | The self-apply class is exactly **one** fingerprint: intent `scooling.review_tray.approve` + `scooling.review:*` external ref + `reviewed/*.md` path | `lib/hub-proposal-personal-self-apply.mjs:13`, `:16-19`, `:47-56` |
| G9 | Full class predicate checks vault:write, partition ownership, role, human actor, `status === 'proposed'`, fingerprint, and elevation — but **never** authorship | `lib/hub-proposal-personal-self-apply.mjs:106-124` |
| G10 | SEC-KN-3 actor gate rejects `mcp_access` / `actorKind: 'agent'` / `humanActor: false` | `lib/hub-proposal-personal-self-apply.mjs:84-90`; wired at `hub/gateway/server.mjs:3102-3111` |
| G11 | `partitionOwned` is `Boolean(proposal)` — a successful partition-scoped GET, not an authorship check | `hub/gateway/server.mjs:3098-3106`, `:3036-3057` |
| G12 | Hosted task proposals: `requireBridgeAuth` only; `userId: req.uid`; author headers derived from the same `req.uid` | `hub/bridge/task-routes.mjs:251-283`, `:104-108` |
| G13 | Hosted delegation proposals: same shape (`X-User-Id` effective, `X-Actor-Id` actor) | `hub/bridge/delegation-routes.mjs:66-70` |
| G14 | Task `proposed_by` is server-set from `input.userId`, never from the client body | `lib/task/task-write.mjs:499`, `:588`, `:648`, `:713`, `:811`, `:880`, `:931`, `:1066`; carried at `lib/task/task-hosted-proposal.mjs:261` |
| G15 | Hosted task propose accepts learner roles — bridge `member` maps to handler `editor` | `hub/bridge/task-routes.mjs:40-42`, `:86-92` |
| G16 | Self-hosted task propose is `viewer`-inclusive; self-hosted delegation consent propose is `viewer`-inclusive | `hub/server.mjs:1497-1499`, `:1872` |
| G17 | **No hosted media proposal route exists.** Attachments proposal routes are self-hosted only, and `editor`/`admin` only | `hub/server.mjs:1304-1307`, `:1340`; no `api/v1/attachments` route in `hub/gateway/server.mjs` |
| G18 | An unmatched `api/v1/*` request falls through the gateway catch-all to the canister, which returns `404 NOT_FOUND` for unknown paths | `hub/gateway/server.mjs:3889-3893`; `hub/icp/src/hub/main.mo:1760` |
| G19 | Neither the gateway nor the bridge **reads** a client `X-User-Id` or `X-Actor-Id`. Every occurrence in `hub/bridge/**` is an outbound canister header — `hub/bridge/server.mjs:664`, `:1315`, `:1355`, `:1426`, `:1694-1698`, `:2221`, `:2850`, `:3021-3025`; `hub/bridge/task-routes.mjs:106`, `:365`; `hub/bridge/delegation-routes.mjs:68`, `:197`. The only read is the trusted gateway→canister hop | `hub/icp/src/hub/main.mo:154` |
| G19.5 | A first-party client **already sends** client-asserted `X-User-Id`: Paperclip's `createHubClient` injects `'X-User-Id': userId` (default `'paperclip'`) on every call. It is **inert** — the gateway sets `x-user-id` itself and the proxy allowlist forwards only content headers — so the invitation S4.2 warns about has already been accepted and is held closed solely by the control S4.4 freezes. Recorded so G19 is not read as "no client sends it" | `deploy/paperclip/skills/hub-client.mjs:5`, `:20`, `:65`; gateway set/forward `hub/gateway/server.mjs:3204-3213`, `:1351-1356` |
| G19.1 | `X-User-Id` is nevertheless advertised in CORS `Access-Control-Allow-Headers` on **both** JS surfaces, and in the canister's own CORS headers | `hub/bridge/server.mjs:872`; `hub/gateway/cors-middleware.mjs:60`; `hub/icp/src/hub/main.mo:221` |
| G19.2 | The canister proposal GET serializes `frontmatter` and `created_by`; the proposal **list** serializes neither `frontmatter` nor `body`. Neither serializer emits `task_meta`, and `task_meta` / `proposal_kind` appear **zero** times in the canister source | `hub/icp/src/hub/main.mo:1156` (GET), `:1137` (list) |
| G19.3 | Task proposal `frontmatter` is **server-set** (`{type, task_id, proposal_kind}`), while `intent` is free-form client text validated only for non-emptiness | frontmatter `lib/task/task-write.mjs:494`, `:583`, `:643`, `:708`, `:806`, `:875`, `:926`, `:1056-1061`; intent `lib/task/task-write.mjs:374-377`, passed through at `hub/bridge/task-routes.mjs:268` |
| G19.4 | On the generic proposal-create path the client controls **both** `intent` and `frontmatter` — the canister extracts frontmatter straight from the POST body | `hub/icp/src/hub/main.mo:1367` (proposals-POST branch), `:1370` (`intent`), `:1371` (`extractFrontmatterFromPostBody`), `:1391` (stored); generic path `hub/gateway/server.mjs:3889-3893` |
| G27 | **The hosted task apply hook and the seam classifier must share a predicate.** `maybeApplyHostedTaskAfterApprove` fires iff `normalizeCanisterProposalForTaskPrecheck(proposal) != null`; that normalizer triggers on `frontmatter.knowtation_proposal_source` **or** `proposal.source` **or** a `meta/tasks/proposals/` path prefix, and resolves its kind from `frontmatter.task_proposal_kind` → `proposal.task_meta.proposal_kind` → `JSON.parse(proposal.body).proposal_kind`. **`task_proposal_kind` ≠ `proposal_kind`** — this key difference is the N1 parser differential | hook `hub/gateway/task-approve-hosted.mjs:17-19`, `:56`, invoked `hub/gateway/server.mjs:3386`; normalizer `lib/task/task-hosted-proposal.mjs:85-163`; key constants `:18-23`; merge `:60-77` |
| G28 | The hosted **delegation** apply hook dispatches on `isDelegationProposalIntent(intent)` **alone**, while `normalizeCanisterProposalForDelegationPrecheck` also accepts the frontmatter marker and `proposal.source`. The normalizer is therefore a **strict superset** of the hook trigger: a matching intent sets `fromIntent`, and `delegationRecordKindFromIntent` returns a non-empty kind for both intents, so the normalizer can never return `null` when the hook would fire (verified by execution, §10) | hook `hub/gateway/delegation-approve-hosted.mjs:50-51`, invoked `hub/gateway/server.mjs:3370`; normalizer `lib/agent/delegation-hosted-proposal.mjs:100-137`; intents `:21-24`; kind map `:44-48` |
| G29 | The **self-hosted** approve path dispatches all three seam applies on `proposal.source` alone — no frontmatter or body parsing | `hub/server.mjs:3072` (delegation), `:3085` (task), `:3093` (media); constants `lib/task/task-write.mjs:44` (`'task'`), `lib/attachments/attachment-write.mjs:49` (`'media'`), `lib/agent/delegation.mjs:36` (`'delegation'`) |
| G30 | **There is no hosted media apply hook.** Only two `maybeApply*AfterApprove` hooks exist (task, delegation), consistent with there being no hosted media route (G17) | `hub/gateway/server.mjs:3370`, `:3386`; exhaustive search for `maybeApply*AfterApprove` returns only `hub/gateway/task-approve-hosted.mjs:36` and `hub/gateway/delegation-approve-hosted.mjs:29` |
| G31 | The **self-hosted** proposal store persists `frontmatter` as an **object** (not a JSON string) and retains `task_meta`, `delegation_meta`, and `media_meta`, each carrying `proposal_kind` / `record_kind`. `parseProposalFrontmatter` already accepts **both** the object and string shapes, so one predicate covers both stores | `hub/proposals-store.mjs:212` (frontmatter), `:256-270` (delegation_meta), `:271-293` (task_meta), `:294-300` (media_meta); dual-shape parse `lib/task/task-hosted-proposal.mjs:29-45` |
| G32 | Self-hosted approve fires **five** index applies — task, delegation, media, **flow**, **flow_capture** — all on `proposal.source`, all behind the same `requireApproveRole` self-apply gate | apply `hub/server.mjs:3056` (flow), `:3064` (flow_capture), `:3072` (delegation), `:3085` (task), `:3093` (media); gate `:467-491` |
| G33 | Flow propose sets `source: FLOW_PROPOSAL_SOURCE` (`'flow'`); the client controls `intent`, `external_ref`, and `vault_mirror_path` (mirror path becomes `proposal.path`). Capture propose sets `source: FLOW_CAPTURE_PROPOSAL_SOURCE` (`'flow_capture'`). Gateway has **no** flow propose write route — authoring is self-hosted only | propose `lib/flow/flow-authoring.mjs:299-303`, `:397`, `:407-414`; capture source `lib/flow/flow-capture.mjs:49`; gateway write search: only `hub/gateway/server.mjs:1017` (external-grants), no propose |
| G34 | Scooling Flow authoring write uses `KNOWTATION_HUB_TOKEN` — the identical P3 shared-env-token shape. `FLOW_AUTHORING_WRITES` defaults **off** | `~/scooling/src/adapters/flowHubTransport.ts:1119`; gate `lib/flow/flow-authoring.mjs:171-174` |
| G35 | A **machine-credential mint path exists today**: `signServiceJwt` mints `{sub, role: 'service'}` with `SESSION_SECRET`, no `type` claim (classifies `legacy_session`) | `netlify/functions/consolidation-scheduler.mjs:72-73`, used `:146` |
| G36 | A **fifth learner-session mint site**: `issueLocalToken` mints the web-session shape `{sub: 'local:…', provider, id, name, role}` on interactive local sign-in; mounted on **both** surfaces via `registerLocalAuthRoutes` | mint `hub/lib/local-auth.mjs:179-192`, called `:401`; mounts `hub/gateway/server.mjs:510`, `hub/server.mjs:625` |
| G37 | Beyond the two `maybeApply*AfterApprove` hooks (G30), **post-approve apply triggers** exist: gateway proxies `api/v1/delegation/proposals/:proposal_id/apply-approved`; bridge owns task and delegation `apply-approved` routes. Both bridge handlers pass `requireApproved: true` (or default), so they are **not** a self-apply bypass — the approve-time gate still stands | gateway proxy `hub/gateway/server.mjs:1049`; bridge `hub/bridge/task-routes.mjs:351` (`requireApproved: true` at `:370`); `hub/bridge/delegation-routes.mjs:181` (`requireApproved: true` at `:202`) |
| G20 | Scooling task writes build `Authorization` from `KNOWTATION_AUTH_TOKEN ?? KNOWTATION_HUB_TOKEN` | `~/scooling/src/adapters/taskWriteHubTransport.ts:208-212`, `:293-302`, used at `:326` |
| G21 | Scooling media and delegation writes use the same env-token pattern | `~/scooling/src/adapters/mediaWriteHubTransport.ts:112-115`, `:314-322`; `~/scooling/src/adapters/delegationHubTransport.ts:486-489`, `:344-355` |
| G22 | Scooling notes self-apply is the **contrast case** — it passes `sessionResult.rawToken`, the learner's own Knowtation JWT, as the bearer | `~/scooling/src/adapters/hostedReviewWriteBack.ts:843-851` |
| G23 | The reusable per-learner mechanism already exists: cookie → `resolveHostedAuthSessionContext` → `rawToken`; calendar already substitutes a session token for the env token | `~/scooling/src/adapters/scoolingHostedAuth.ts:373-417`; `~/scooling/src/adapters/calendarHubTransport.ts:407-427` |
| G24 | The Scooling task write UI passes a **synthetic** actor, not a session: `scoolingUid: "f".repeat(64)` | `~/scooling/src/tasks/taskWriteSurface.ts:65-68`, used at `:222-272`; routes at `app/routes/tasks.tsx:23-27` |
| G25 | All three Scooling hosted transports default to the **gateway** origin `https://api.knowtation.store` | `~/scooling/src/adapters/taskHubTransport.ts:31`; `mediaHubTransport.ts:30`; `delegationHubTransport.ts:40` |
| G26 | `scooling_uid` is an in-Scooling HMAC of `provider:providerId` and is **not** transmitted to Knowtation on any transport | `~/scooling/src/adapters/identityAdapter.ts:242-251` |

### 2.1 Why P3 is not a live exploit today — and what D4 = A changes about overlap

**Honest seam proposes do not match the fingerprint.** The self-apply class requires
`intent === 'scooling.review_tray.approve'` plus the external-ref and path shape (G8). Honest task /
media / delegation / flow proposes set different intents (and different default paths). The
SEC-KN-4 test asserts the delegation case directly
(`test/sec-kn-4-delegation-principal-binding.test.mjs:934-942`). Production env for the task /
media / delegation surfaces is absent (Pass 2 F5(a); Scooling roadmap surface table);
`FLOW_AUTHORING_WRITES` defaults off (G34).

**Overlap is possible, and D4 = A makes it seam.** Frontmatter is client-controlled on the canister
proposals-POST (`hub/icp/src/hub/main.mo:1371`) and returned by the GET serializer (`:1156`). A
proposal can therefore carry the review-tray fingerprint **and** `knowtation_proposal_source` +
`task_proposal_kind` (or another S3.1 apply marker). **Reproduced by execution in round 4:**
`normalizeCanisterProposalForTaskPrecheck` returns non-null **and**
`matchesScoolingReviewTrayFingerprint` / `isPersonalSelfApplyClass` return `true` for that shape.
Under S6.1 that proposal refuses at the seam steps (7–11) instead of passing the fingerprint —
the boolean flips. Fail-closed in direction; not a hole. It is **not** a regression of the honest
notes tray (S2.4 / §9 R3), which carries no seam apply marker and never enters those steps.

P3 remains a **precondition defect**, not a live exploit for honest seam proposes — exactly as the
audit records it. The consequence of shipping the widening first is stated in §3.3. The overlap
case is an intentional consequence of D4 = A / S3.0 and is accepted in S6.1 and §9 R10.

### 2.2 What the shared token actually collapses today

Even with self-apply out of reach, the shared credential already degrades three properties. These are
consequences of G20–G21 plus G6/G7/G14, not speculation:

| Collapsed property | Consequence |
| --- | --- |
| **Partition** (`X-User-Id`) | Every learner's seam proposal lands in the operator identity's partition, so learners can read each other's pending proposals through the ordinary partition-scoped list |
| **Authorship** (`created_by`, `proposed_by`) | Attribution names the operator, so the audit trail cannot answer "which learner asked for this" |
| **Role** | Every learner inherits the operator's role, including any admin allowlist entry (`hub/gateway/access-token-authz.mjs:55-66`, `:75-77`) rather than their own |

---

## 3. Frozen trust model

| Term | Definition | Source of truth |
| --- | --- | --- |
| **Learner** | The human using Scooling | Knowtation JWT `sub` (`provider:id`) — never a Scooling-derived id |
| **Session-bound credential** | A credential minted by Knowtation for one identity through an interactive sign-in, presented on that identity's behalf | JWT class claim (S1) — **not** inferable from an unmarked token |
| **Author** | The verified session identity that created the proposal | Canister `created_by` (hosted) / `proposed_by` (self-hosted) — never the request body |
| **Approver** | The verified session identity that approves | Gateway `x-actor-id` / `req.user.sub` |
| **Seam surface** | Task, media, delegation, flow, and flow_capture proposal surfaces (§4 S3) | **The apply path's own dispatch predicate** (S3.1) — never a field list written in this document |

### 3.1 Inherited assumptions (stated, not silently assumed)

1. The canister trusts gateway-minted headers, guarded only by `X-Gateway-Auth`. Everything in this
   freeze that relies on `created_by` inherits SEC-KN-4 §3.2(1) unchanged: it is exactly as
   trustworthy as `X-User-Id` partitioning, which is acceptable only because SEC-KN-1 made the
   empty-secret branch deny and SEC-KN-0 verified the secret is set.
2. `created_by` is **not live** until the SEC-KN-4 Tier-3 canister upgrade (gate T1). Until then every
   hosted `created_by` is `""` (G6). Every rule in this freeze that reads authorship must therefore
   **fail closed on empty**, never fall back to the partition owner — the fallback the operator
   already rejected as SEC-KN-4 D1.
3. `PROXY_HEADER_ALLOWLIST` (G5) is the control that keeps `x-actor-id` un-injectable. If it is ever
   widened, S4 collapses with it.

### 3.2 The honesty clause — what Knowtation cannot verify

**Knowtation cannot determine whether the bearer it received is held by the human currently using
Scooling.** A copied learner token and a live learner session are identical on the wire (G1, G2). No
rule in this freeze claims otherwise, and `SEC-SEAM-1b` must not implement any check that pretends to
detect it.

Two consequences the build phase must respect:

- The **one-identity-per-learner** property — correct partitioning and correct attribution for every
  learner — is achievable only by the consumer sending per-learner credentials (C1–C4). Knowtation's
  contribution is to make those credentials work, to make the absence of session binding *fail closed
  where the decision matters*, and to make a dedicated machine credential explicitly ineligible by
  class (S1) — including the **present** `signServiceJwt` path (G35), which today carries no `type`
  and therefore classifies `legacy_session`.
- That is **not** the same as saying Knowtation has no server-side control over the shared-identity
  case. It has one, and S10 adopts it: the operator can *declare* the shared subject
  self-apply-ineligible. Declaration is not detection — it depends on the operator knowing which
  account backs the token, which they do. Freeze review round 1 (F5) was right that an earlier draft
  of this clause overclaimed by saying the consumer fix was the *only* remedy.
- **S10's reach is narrower than it first appears (N14), and it is dormant in this phase (D3).**
  The indistinguishability above applies to S10 itself: S10 keys on the approver's `sub`. The
  shared consumer token (`KNOWTATION_AUTH_TOKEN` / `KNOWTATION_HUB_TOKEN`) is a JWT for a **human
  operator account**. A separate machine-credential mint path **does** exist — `signServiceJwt`
  (G35) — but it is unused for those consumer env tokens today, carries no `type`, and is already
  self-apply-ineligible under S1 as `legacy_session`. Listing the operator's human `sub` therefore
  still disables that human's own legitimate self-apply from their own browser, because the server
  cannot tell the two uses of that `sub` apart. That is the same wall, not an exception to it.
  (Round-3 V1: earlier drafts claimed "there is no machine-credential mint path"; that premise was
  false and is withdrawn. D3's empty-list *outcome* is unaffected.) Per the ratified **D3**,
  `HUB_SELF_APPLY_INELIGIBLE_SUBS` ships **empty**, so in `SEC-SEAM-1b` S10 bars nobody; populating
  it is Tier 3 (T3). No claim in this document may say S10 "closes" the shared-identity case without
  both qualifications.
- The tempting server-side "fix" — letting Scooling assert the learner id alongside a service token —
  is **forbidden** (S4). It is client-asserted identity, the precise failure shape SEC-KN-4 exists to
  close, and it would be strictly worse than the current state because it would look authoritative.

### 3.3 Why the admission gate is the load-bearing rule

The widening step (`FINISH-COMPLETE-APPLY-KN-b`) admits new intents into the self-apply class. Today
that class checks partition ownership but never authorship (G9). Under a shared credential the
service identity **is** the partition owner **and** the author **and** the approver, so the existing
predicate would return `true` for a proposal no identifiable human authored.

Adding **author must equal approver** does not, on its own, defeat a single shared identity acting
alone — that is exactly why §3.2 exists. What it does defeat is the mixed case that widening creates:
a proposal created under the shared service credential can never be self-applied by a learner
session, and a proposal created by a learner can never be self-applied by the service. Combined with
S1 (class marking) and T5 (admission is Tier 3), the class cannot be widened into the P3 hole by
accident.

### 3.4 Deviation from the driving finding's fix wording

Pass 2 P3 prescribes: "Gateway must reject service-token proposals from the self-apply class"
(`~/scooling/docs/PRE-BUILD-SECURITY-AUDIT-FINDINGS-PASS2.md:81`), and `docs/ROADMAP.md:49` repeats it
as the Knowtation deliverable. Taken literally, that instruction **cannot be implemented**, and
`SEC-SEAM-1b` must not pretend to implement it: there is no property of an inbound request that
identifies it as carrying a "service token" (G1, G2, §3.2). A gateway check that claimed to detect
one would be a guess wearing the costume of a control.

What replaces it, in descending order of directness:

1. **S10** — the operator *declares* the shared subject ineligible. This is the closest thing to the
   literal remedy, with the detection step relocated from the server to the human who already has the
   knowledge. **It is dormant in `SEC-SEAM-1b`**: per ratified D3 the list ships empty, and per N14
   populating it also disables the named human's own self-apply. So the audit's wording is not
   satisfied by this phase either — it is made *available* to a later Tier-3 operator action.
2. **S2** — author must equal approver, which makes any mixed service/learner combination
   ineligible regardless of declaration.
3. **S1** — a class marker so a dedicated machine credential is ineligible by construction. The
   present `signServiceJwt` mint (G35) already lacks `type` and classifies `legacy_session`; a
   future mint that stamps a non-`session` class is barred the same way.

`docs/ROADMAP.md:49` **already carries** the §3.4 disclaimer ("the audit's literal 'reject
service-token proposals' wording **cannot be implemented**…"). The closing commit does **not**
re-argue that point; it **refreshes the SEC-SEAM-1 status row** (round-4 state, D5 = A ratified,
reviewer verdict) and adds the hosted-media roadmap row required by ratified D2 = A (S7.5). This
follows the SEC-KN-4a precedent for deviating from audit fix wording
(`docs/SEC-KN-4-DELEGATION-PRINCIPAL-BINDING-FREEZE.md:115-126`). (W4: earlier drafts of this
paragraph treated line 49 as still describing the impossible deliverable; that premise is stale.)

---

## 4. Frozen rules — SEC-SEAM-1b implements exactly these

### S1 — Session binding is a positive, mint-time, server-set property

**§12 D1 is ratified as option A** (§12.1). S1 is therefore unconditional: the mint claim ships. No
option-B or option-C variant of this rule exists, and `SEC-SEAM-1b` must not implement one. (This
replaces the round-1 conditional that N2 flagged as leaving Auto with no spec under a C selection,
and removes that clause's incorrect description of S1.4 as a "negative test" — S1.4 is an
acceptance-preserving rule, not a test.)

1. Add `type: 'session'` to the payload minted at **all five learner-session mint sites** — the
   four OAuth/refresh sites plus local-auth. Native OAuth inherits through `issueAccessTokenForSub`
   (G4) and needs no separate change. (V2: round 3's "all four" enumeration missed `issueLocalToken`.)

   | Mint site | Role |
   | --- | --- |
   | `hub/gateway/server.mjs:213-228` (`issueToken`) | hosted login |
   | `hub/gateway/server.mjs:277-287` (`issueAccessTokenForSub`) | hosted refresh / native OAuth exchange |
   | `hub/server.mjs:308-316` (`issueToken`) | self-hosted login |
   | `hub/server.mjs:326-332` (`issueAccessTokenForSub`) | self-hosted refresh (`POST auth/refresh`) |
   | `hub/lib/local-auth.mjs:179-192` (`issueLocalToken`) | local / offline-locked interactive sign-in; mounted via `registerLocalAuthRoutes` at `hub/gateway/server.mjs:510` **and** `hub/server.mjs:625` (G36) |

   **Both refresh sites are mandatory (N9).** Stamping only the login sites would leave every
   refreshed token `legacy_session`. **After T5** admits a seam surface, a learner's seam self-apply
   would then silently begin refusing after their first token refresh — the same failure class V2
   records for unstamped local-auth. In `SEC-SEAM-1b` itself every seam proposal already refuses at
   S6.1 step 11 (W3), so refresh stamping does not change eligibility this phase; it is still
   mandatory so T5 cannot ship onto a half-stamped mint surface. The build must not treat the
   refresh sites as optional or "the same site". (Y1: earlier wording claimed S2.1 identified
   self-hosted as having "live effect before T1"; that is withdrawn — see S2.1 / X1.)

   **`issueLocalToken` is mandatory (V2).** Unstamped, every local-auth / offline-locked session is
   `legacy_session`, so after T5 those users' seam self-apply would refuse permanently — the same
   silent failure N9 was raised to prevent for refresh.

   **Do not stamp the third gateway mint site** (`hub/gateway/server.mjs:1282`) — it is an internal
   5-minute gateway→bridge hop, not a learner session, and it must classify as `legacy_session` so it
   can never satisfy S2 (G3). **Do not stamp `signServiceJwt`**
   (`netlify/functions/consolidation-scheduler.mjs:72-73`) — it is a machine credential (G35) and
   must remain `legacy_session`. A unit test pins both classifications.
2. Add `resolveActorTokenClass(payload)` to `hub/gateway/access-token-authz.mjs`, returning exactly
   one of `'session'` | `'mcp_access'` | `'legacy_session'` | `'unknown'`:
   - `'mcp_access'` when `isMcpAccessPayload(payload)` (reuse `:28-30`; do not re-implement)
   - `'session'` when `payload.type === 'session'`
   - `'legacy_session'` when `payload` is an object with a non-empty string `sub` and no `type`
   - `'unknown'` otherwise, including `null` / non-object
3. Add `isSessionBoundActor(payload)` returning `true` **only** for `'session'`. Every other class,
   including `'legacy_session'`, returns `false`.
4. `'legacy_session'` remains **fully accepted for authentication and propose** — no request that
   succeeds today may begin failing because of S1. Its only effect is S2 eligibility.
5. Token verification must not require the claim. Unknown or missing claims never cause a 401.

**Frozen rationale (do not "improve" this in build):** the claim is a *necessary* condition for a
machine-credential class to be barred by name — including the present `signServiceJwt` path (G35)
and any future dedicated mint. It is **not sufficient** to detect a copied learner token (§3.2). Do
not add heuristics — `iat` freshness, IP pinning, user-agent checks — to make it look sufficient.

### S2 — Author-bound admission to the self-apply class

Extend `lib/hub-proposal-personal-self-apply.mjs`:

1. Add optional inputs to `isPersonalSelfApplyClass`: `authorActorId`, `approverActorId`,
   `sessionBound`.
2. When `isSeamSurfaceProposal(proposal)` returns `true` (S3.1), **all** of the following must hold or
   the class is refused:
   - `sessionBound === true`
   - `authorActorId` is a non-empty string after trim
   - `approverActorId` is a non-empty string after trim
   - `authorActorId === approverActorId` after trim (exact, case-sensitive — uids are opaque)

   **The trigger is `isSeamSurfaceProposal`, not the proposal's `intent` (N4).** Round 1 left this
   clause reading "when the proposal's intent is in `SEAM_SURFACE_INTENTS`"; implemented literally
   that reinstates the F3/N1 defect, because `intent` is client-controlled on the generic create path
   (G19.4) and is not what any apply hook dispatches on (G27–G29). There is no intent set any more
   (S3).
3. The seam evaluation runs **before** the fingerprint check, so a seam proposal is refused with a
   named reason (S6) rather than incidentally failing the fingerprint. Its exact position in the
   refusal order is frozen in S6.1 (N6) — it is **not** first overall, because it must run after the
   guards that today decide the same boolean.
4. **Non-seam proposals keep today's behavior exactly.** The existing notes review-tray path must not
   gain a new refusal — see §9 (R3) for why author-binding the notes path is deliberately deferred.
   A notes review-tray proposal is non-seam under S3.1 (its `source` is none of task/delegation/media
   and it carries no task or delegation frontmatter marker), so it never enters the seam branch.
5. Delegation proposals are refused unconditionally, before any other seam check, regardless of
   authorship or session binding — SEC-KN-4 R9 restated, not re-derived. The test is
   `isDelegationSurfaceProposal(proposal)` (S3.1), not an intent-name comparison.

#### S2.1 — Frozen input sources (both call sites)

The build does not choose where these values come from.

| Input | Hosted — `hub/gateway/server.mjs:3102-3111` | Self-hosted — `hub/server.mjs:476` |
| --- | --- | --- |
| `authorActorId` | `proposal.created_by` from the canister GET (G19.2). Empty until gate T1 — refuse, never substitute the partition owner (§3.1(2)) | `proposal.proposed_by` (`hub/proposals-store.mjs:184-185`) |
| `approverActorId` | `uid` — the same `getUserId(req)` already used at `:3071` for `x-actor-id` | `req.user?.sub` (already read at `hub/server.mjs:469`) |
| `sessionBound` | `isSessionBoundActor(payload)` where `payload` is the verified bearer payload. `resolveHostedActorRole` (**definition begins `hub/gateway/server.mjs:2949`**; `:3077` is only the call-site destructure — N17) returns `{role, mayApproveProposals, isMcpAccess}`, so extend it to return the payload rather than adding a second verify call. It already verifies and holds the payload in `bearerPayload` (`:2953`, `:2958`), so this is a return-shape change only. **Both returns must include the payload** — the `mcp_access` early return at `:2969` **and** the main return at `:3025` (W1); omitting `:3025` leaves `sessionBound` undefined for every non-agent approve, i.e. every case S2 exists for. **When `bearerPayload` is `null`** (verify threw, or no bearer — `:2953-2962`), `sessionBound` is **`false`**: `isSessionBoundActor(null)` returns `false` by S1.3 (`'unknown'`). No call site may treat null payload as session-bound (V11) | `isSessionBoundActor(req.user)` — `req.user` null/absent ⇒ `false`. **Self-hosted import disposition (W2):** `hub/server.mjs` may import `isSessionBoundActor` / `resolveActorTokenClass` from `hub/gateway/access-token-authz.mjs`. That module has **no imports and no top-level side effects** (verified); it is the one authorized `hub/server.mjs` → `hub/gateway/**` edge this phase adds beyond today's `./gateway/note-facets.mjs`. Do **not** resolve this by copying the class logic into `hub/server.mjs` |

**S2 discrimination is code-level only until T5 (X1).** Self-hosted `proposed_by` is populated today
(G14) while hosted `created_by` is empty until T1, so the two paths return **different refusal
codes** when a seam proposal is well-formed for authorship (`SELF_APPLY_NOT_ADMITTED` after
passing S2's session/author clauses on self-hosted, vs `SELF_APPLY_AUTHOR_UNVERIFIED` on hosted).
Because W3 freezes admission empty, **neither path yields an eligible seam result in
`SEC-SEAM-1b`** — step 11 refuses every seam proposal. Do not read this paragraph as "self-hosted
seam self-apply can succeed before T5." The phase's sole live *eligibility* change is the V3
overlap flip (fingerprint ∧ seam marker: eligible today → refused under S6.1). S2's author/session
clauses are as dormant for eligibility this phase as S10 is (S10.4); they become load-bearing when
T5 admits a surface.

### S3 — Seam classification reuses the apply path's own predicate

**§12 D4 is ratified as option A** (§12.1). This rule replaces round 1's `SEAM_SURFACE_INTENTS` set
and its `frontmatter.proposal_kind` classifier, both of which N1 and N3 refuted.

#### S3.0 — The frozen anti-drift rule

> **No hand-written seam field list, key list, intent list, or kind list may exist in the code
> `SEC-SEAM-1b` ships.** Classification must be expressed by calling the same predicate the apply
> path calls, or by testing the same field the apply path dispatches on.

This is the load-bearing rule of S3, and it is frozen. Round 1 wrote a parallel list keyed on
`frontmatter.proposal_kind`; the task apply hook keys on `frontmatter.task_proposal_kind` (G27).
**They are different keys**, honest hosted proposals carry both (`mergeTaskFrontmatter`
`lib/task/task-hosted-proposal.mjs:60-77`), so the parallel list passed every honest test and failed
only on crafted input. The gap between a hand-written list and the list the effect honors **is** the
vulnerability. A list cannot be kept in sync by discipline, so the build is forbidden from creating
one.

`SEAM_SURFACE_INTENTS` is **deleted**, not renamed. N3 established that ten of its twelve entries
were `proposal_kind` values rather than intents, which made the `intent` branch of the round-1 union
inert for task and media; the correct fix under D4 = A is that no such set exists.

#### S3.1 — The predicate

`isSeamSurfaceProposal(proposal)` returns `true` if **any** of the following holds. The list is a
union and is exhaustive over both stores:

| # | Condition | Store / surface |
| --- | --- | --- |
| 1 | `normalizeCanisterProposalForTaskPrecheck(proposal) != null` | hosted task — *identical* to the hook's own `isTaskProposal` (G27) |
| 2 | `normalizeCanisterProposalForDelegationPrecheck(proposal) != null` | hosted delegation — proven **superset** of the hook trigger (G28) |
| 3 | `proposal.source === TASK_PROPOSAL_SOURCE` | self-hosted task (G29) |
| 4 | `proposal.source === DELEGATION_PROPOSAL_SOURCE` | self-hosted delegation (G29) |
| 5 | `proposal.source === MEDIA_PROPOSAL_SOURCE` | self-hosted media (G29) |
| 6 | `proposal.source === FLOW_PROPOSAL_SOURCE` | self-hosted flow (G32, G33) — **§12 D5 = A** |
| 7 | `proposal.source === FLOW_CAPTURE_PROPOSAL_SOURCE` | self-hosted flow_capture (G32, G33) — **§12 D5 = A** |

`isDelegationSurfaceProposal(proposal)` returns `true` for conditions **2 or 4** only. S2.5 uses it
for the unconditional delegation refusal.

**Correspondence requirement (the reason this is safe).** Every condition above is a superset of an
approve-time apply trigger, and every approve-time apply trigger is covered. **Post-approve
`apply-approved` routes (G37) are not approve-time triggers** — they require `status === 'approved'`
and are therefore not a self-apply bypass; they are recorded so G30's hook-only search is not
mistaken for an exhaustive apply-trigger enumeration (V7).

| Apply trigger | Cited at | Covered by |
| --- | --- | --- |
| Hosted task apply (approve hook) | `hub/gateway/task-approve-hosted.mjs:17-19`, `:56` | #1, same function |
| Hosted delegation apply (approve hook) | `hub/gateway/delegation-approve-hosted.mjs:50-51` | #2, superset (G28) |
| Hosted media apply | **does not exist** (G30) | n/a — S7 |
| Self-hosted task apply | `hub/server.mjs:3085` | #3, same expression |
| Self-hosted delegation apply | `hub/server.mjs:3072` | #4, same expression |
| Self-hosted media apply | `hub/server.mjs:3093` | #5, same expression |
| Self-hosted flow apply | `hub/server.mjs:3056` | #6, same expression |
| Self-hosted flow_capture apply | `hub/server.mjs:3064` | #7, same expression |
| Post-approve task `apply-approved` | `hub/bridge/task-routes.mjs:351` (`requireApproved: true`) | n/a — not approve-time (G37) |
| Post-approve delegation `apply-approved` | `hub/bridge/delegation-routes.mjs:181`; gateway proxy `:1049` | n/a — not approve-time (G37) |

A proposal that can trigger a seam apply at approve time is therefore **seam by construction**. A
security-tier test must assert this correspondence directly (§7 tier 7).

**Import safety (checked, not assumed).** `lib/hub-proposal-personal-self-apply.mjs` may import the
apply-path predicate modules and the S10 parser module under `lib/` — **not** `hub/gateway/**`
(V10). Nothing in the dependency closure of `lib/task/task-hosted-proposal.mjs`,
`lib/agent/delegation-hosted-proposal.mjs`, `lib/attachments/attachment-write.mjs`,
`lib/flow/flow-authoring.mjs` (for `FLOW_PROPOSAL_SOURCE` only — a constant export; do **not** import
`precheckApprovedFlowProposal`, which needs `dataDir` and store I/O), or
`lib/flow/flow-capture.mjs` (for `FLOW_CAPTURE_PROPOSAL_SOURCE` only) may import the self-apply
module. The combined import was verified in round 3 for the first three modules; round 4 extends the
obligation to the flow constant imports and forbids any new `lib/**` → `hub/gateway/**` edge. If the
build hits a cycle, it must **stop and escalate** — it may **not** resolve it by copying a field
list into the self-apply module (S3.0).

**Fail-closed rule.** If any predicate throws, the proposal classifies as **seam** (obligations
imposed). Never as non-seam. The predicates are total over arbitrary input today — each begins with
an object guard (`lib/task/task-hosted-proposal.mjs:86`;
`lib/agent/delegation-hosted-proposal.mjs:101`) and each parses defensively
(`parseProposalFrontmatter:29-45`, body parse `:145-154`) — so the `try` is a guard against future
change, not a known throw.

#### S3.2 — Why this closes the evasion round 1 left open

The N1 proposal — matches an admitted allowlist entry, omits `proposal_kind`, sets
`knowtation_proposal_source` and `task_proposal_kind` — classifies **seam** under S3.1 condition #1,
because that is precisely the condition under which the apply hook fires. Reproduced by execution in
this session (§10): the round-1 rule classifies it non-seam, the S3.1 rule classifies it seam.

The residual argument round 1 made — "renaming the intent costs the attacker eligibility" — is
**withdrawn**, not repaired. N3 showed it was empty: a real task proposal's `intent` was never in the
round-1 set, so renaming it cost nothing. Under S3.1 the attacker's problem is different and real: to
get the task apply to fire they must satisfy `normalizeCanisterProposalForTaskPrecheck`, and
satisfying it *is* what makes them seam. There is no field they can add to trigger the effect that
does not also trigger the classification, because it is the same function.

**What still carries the load.** The self-apply class remains a positive allowlist admitted at gate
T5, and S2's obligations attach to seam classification at evaluation time. S3.1 is no longer a
"belt-and-braces second check" behind the allowlist (round 1's framing); with D4 = A it is the
**primary** seam control, and the allowlist is the independent one.

#### S3.3 — Self-hosted input shape (N10)

The self-hosted store persists `frontmatter` as an **object** and retains `task_meta` /
`delegation_meta` / `media_meta` (G31), whereas the canister serializes `frontmatter` as a string.
Round 1's parse-failure rule presumed a string and left the self-hosted shape unspecified.

Under S3.1 this question **dissolves for all three surfaces**: `parseProposalFrontmatter`
(`lib/task/task-hosted-proposal.mjs:29-45`) already accepts object, string, and neither, and the
self-hosted conditions #3–#5 read `proposal.source`, which the self-hosted store sets directly
(`hub/proposals-store.mjs:214`). No shape-specific branch is needed and none may be added.

### S4 — Client-asserted identity is forbidden, and the advertisement is removed

1. No gateway or bridge route may read a client-supplied `X-User-Id`, `X-Actor-Id`, `X-Scooling-Uid`,
   or any body field, as the source of actor identity. This is the current behavior (G5, G19); S4
   freezes it and requires a test that fails if it regresses.
2. Remove `X-User-Id` from the CORS `Access-Control-Allow-Headers` on **both** JavaScript surfaces —
   `hub/gateway/cors-middleware.mjs:60` **and** `hub/bridge/server.mjs:872`. Neither reads it (G19);
   advertising it invites a consumer to build the forbidden remedy. **That invitation has already
   been accepted once** — Paperclip's Hub client sends the header today (G19.5) — and is inert only
   because S4.4 / the proxy allowlist hold. Removing the advertisement still stands; changing
   Paperclip to stop sending the header is **out of scope** for `SEC-SEAM-1b` (record-only). The
   gateway is the surface that matters most, because all three Scooling transports target the
   gateway origin, not the bridge (G25). This is the only production behavior change in S4 and it
   removes a capability rather than adding one.
3. The canister's own CORS header (`hub/icp/src/hub/main.mo:221`) is **left as-is, deliberately**.
   The canister is reachable only behind `X-Gateway-Auth`, it is the one component that legitimately
   *does* read `X-User-Id` (G19), and changing it would require a WASM upgrade (gate T1) for a
   cosmetic fix. Recorded here so a later phase does not read the omission as an oversight.
4. `PROXY_HEADER_ALLOWLIST` (`hub/gateway/server.mjs:1351-1356`) must not be widened by this phase.

### S5 — Seam propose keeps accepting learner roles

Per-learner tokens carry the learner's own role, which is weaker than the operator's. `SEC-SEAM-1b`
must not raise the role bar on seam propose paths; hosted task propose maps `member → editor` (G15)
and self-hosted task and delegation consent propose are `viewer`-inclusive (G16). A test must assert
that a `member`/`viewer` actor can still propose on each reachable seam surface, so the consumer's
switch to learner tokens does not silently start returning 403.

**Explicitly out of scope:** changing `MEDIA_WRITE_ROLES` (`hub/server.mjs:1304`) from `editor`/`admin`.
Media role posture is a separate decision (§12 D2).

### S6 — Named, loud refusals

Introduce these codes; each must be returned with an HTTP 403 and must never be collapsed into a
generic `FORBIDDEN`:

**Seam codes — HTTP-visible.** Returned with HTTP 403 and never collapsed into a generic `FORBIDDEN`:

| Code | Meaning |
| --- | --- |
| `SELF_APPLY_SESSION_BINDING_REQUIRED` | Seam proposal, approver's credential is not session-bound (S2.2 first clause) |
| `SELF_APPLY_AUTHOR_UNVERIFIED` | Seam proposal, `authorActorId` empty — includes every hosted proposal before Tier-3 gate T1 |
| `SELF_APPLY_AUTHOR_MISMATCH` | Seam proposal, author and approver are both present and differ |
| `SELF_APPLY_DELEGATION_REFUSED` | Delegation surface proposal — unconditional (S2.5); replaces the overloaded `SELF_APPLY_INTENT_NOT_ELIGIBLE` for this case (V9) |
| `SELF_APPLY_NOT_ADMITTED` | Seam proposal not admitted at T5; in this phase refuses **every** seam proposal (V9, W3) |

`SELF_APPLY_INTENT_NOT_ELIGIBLE` is **deleted**, not renamed. It named a concept S3.0 abolished
(`intent` eligibility) and collapsed two structurally different refusals the operator cannot
distinguish in logs (V9).

**Admission source — frozen empty in this phase (W3).** S6.1 step 11's "not admitted at T5"
conjunct is **unconditionally true** for every seam proposal until a *later* T5 widening freeze
ships an admission predicate. `SEC-SEAM-1b` must implement step 11 as an unconditional seam
refusal (no admission input on `personalSelfApplyRefusalReason`, no env, no config file, no
allowlist). Introducing any admission surface in this phase is a scope violation (S9).

**`SELF_APPLY_SUBJECT_INELIGIBLE` is internal-only, not HTTP-visible (N7).** Round 1 listed it in the
seam table while S10.2 applied it to seam and non-seam proposals alike — a contradiction of this
section's own "none may change what the caller returns over HTTP" rule, and a disclosure of blocklist
membership to the caller. Resolved in the safer direction: the code is named in server-side logs and
returned to internal callers, but the HTTP response stays the generic 403 `FORBIDDEN`. Naming a
refusal loudly is for the operator reading logs, not for an unauthenticated prober enumerating who is
on the list.

**Non-seam codes — internal only.** `isPersonalSelfApplyClass` returns `false` today for seven
ordinary conditions (`lib/hub-proposal-personal-self-apply.mjs:106-124`), none of which is an
anomaly. Each needs a name so `personalSelfApplyRefusalReason` is total, but **none** may change what
the caller returns over HTTP: every one keeps today's generic 403 `FORBIDDEN`
(`hub/gateway/server.mjs:3116-3120`; `hub/server.mjs:486-490`).

**Two trigger descriptions are corrected here (N5).** Round 1 paraphrased the live guards inaccurately
while also mandating that `isPersonalSelfApplyClass` be re-implemented as
`personalSelfApplyRefusalReason(opts) === null`. A literal build of the round-1 text would therefore
have **changed live behavior**. The column below is the guard as written in source, and the build must
reproduce it exactly:

| Code | Exact live guard | Line |
| --- | --- | --- |
| `NOT_VAULT_WRITE` | `!hasVaultWrite` | `:108` |
| `NOT_PARTITION_OWNED` | `!partitionOwned` | `:108` |
| `ROLE_NOT_ELIGIBLE` | `opts.role != null && !roleEligibleForPersonalSelfApply(opts.role, {humanActor, tokenType, actorKind})` — **the `role != null` guard is load-bearing**: when `role` is omitted the check is skipped entirely today | `:109-118` |
| `PROPOSAL_MISSING` | `!proposal \|\| typeof proposal !== 'object'` | `:119` |
| `STATUS_NOT_PROPOSED` | `String(proposal.status ?? 'proposed').trim() !== 'proposed'` — **an absent status is treated as proposed today**; it must not become a refusal | `:120` |
| `FINGERPRINT_MISMATCH` | `!matchesScoolingReviewTrayFingerprint(proposal)` — the ordinary case for almost every proposal | `:121` |
| `ELEVATED_OR_AUTO_FLAGGED` | `isElevatedOrAutoFlagged(proposal)` | `:122` |

Add `personalSelfApplyRefusalReason(opts)` returning exactly one code, or `null` when the class holds.
`isPersonalSelfApplyClass` keeps its boolean signature so existing callers are untouched; it must be
implemented as `personalSelfApplyRefusalReason(opts) === null` so the two can never diverge. The
function must be **total** — every path returns a code or `null`, and a unit test must assert that no
input produces `undefined`.

#### S6.2 — How refusal codes reach HTTP (V5) — `personalSelfApplyAllowsApprove`

Both approve gates call **`personalSelfApplyAllowsApprove`** today — not `isPersonalSelfApplyClass`
directly (`hub/gateway/server.mjs:3103`, `hub/server.mjs:476`; definition
`lib/hub-proposal-personal-self-apply.mjs:171-173`). That wrapper is a boolean and cannot carry a
code. The build freezes this traversal — Auto must not invent a parallel path:

1. Keep `personalSelfApplyAllowsApprove(opts)` as
   `personalSelfApplyRefusalReason(opts) === null` (same boolean contract for any other caller).
2. At **both** call sites, replace the bare boolean branch with:
   - `const reason = personalSelfApplyRefusalReason(optsWithS2Inputs);`
   - if `reason === null` → allow (same as today's `personalSelfApplyAllowsApprove === true`)
   - if `reason` is one of the **HTTP-visible seam codes** in the S6 table → HTTP 403 with
     `{ error: <stable message>, code: reason }` — never collapsed to `FORBIDDEN`
   - otherwise (non-seam codes **and** `SELF_APPLY_SUBJECT_INELIGIBLE`) → today's generic 403
     `FORBIDDEN` body at `hub/gateway/server.mjs:3116-3120` and `hub/server.mjs:486-490`
3. No third wrapper, no bypass of `personalSelfApplyRefusalReason`, and no call-site that returns a
   seam code without going through that function.

#### S6.1 — Refusal precedence is frozen (N6)

Exactly one code is returned, so the order decides which one. The order below is frozen. It is
derived from two constraints, not from preference: **(a)** the non-seam guards must fire in their
current source order so `reason === null` is bit-identical to today's boolean *for non-overlap
inputs*, and **(b)** seam evaluation must come after `PROPOSAL_MISSING`, because every seam
predicate dereferences the proposal.

| # | Check | Code | Why here |
| --- | --- | --- | --- |
| 1 | S10 ineligible subject | `SELF_APPLY_SUBJECT_INELIGIBLE` | Operator declaration outranks everything; internal-only, so it leaks nothing |
| 2 | `!hasVaultWrite` | `NOT_VAULT_WRITE` | Live order `:108` |
| 3 | `!partitionOwned` | `NOT_PARTITION_OWNED` | Live order `:108` |
| 4 | role ineligible (with `role != null` guard) | `ROLE_NOT_ELIGIBLE` | Live order `:109-118`; keeps the SEC-KN-3 agent gate ahead of any seam disclosure |
| 5 | proposal not an object | `PROPOSAL_MISSING` | Live order `:119`; seam predicates need a proposal |
| 6 | status not proposed | `STATUS_NOT_PROPOSED` | Live order `:120` |
| 7 | `isDelegationSurfaceProposal` | `SELF_APPLY_DELEGATION_REFUSED` | S2.5 — unconditional, before any authorship logic (V9) |
| 8 | seam ∧ `sessionBound !== true` | `SELF_APPLY_SESSION_BINDING_REQUIRED` | S2.2 first clause |
| 9 | seam ∧ author empty | `SELF_APPLY_AUTHOR_UNVERIFIED` | S2.2; every hosted proposal until T1 |
| 10 | seam ∧ approver empty ∨ author ≠ approver | `SELF_APPLY_AUTHOR_MISMATCH` | S2.2 |
| 11 | seam ∧ not admitted at T5 | `SELF_APPLY_NOT_ADMITTED` | Unconditional for every seam proposal in this phase — admission set is frozen empty (W3); T5's widening freeze is the only thing that may populate it |
| 12 | fingerprint mismatch | `FINGERPRINT_MISMATCH` | Live order `:121` |
| 13 | elevated / auto-flagged | `ELEVATED_OR_AUTO_FLAGGED` | Live order `:122` |
| 14 | — | `null` | Class holds |

**Disclosure consequence, stated explicitly.** Steps 2–6 run before any seam code, so a caller who
fails an ordinary precondition learns nothing about seam classification; and steps 7–11 are reachable
only by a caller who already holds `vault:write` on a partition-owned proposal with an eligible role.
The HTTP-visible seam codes therefore disclose seam status only to an actor who could already read
the proposal.

**Live behavior — honest notes unchanged; overlap flips fail-closed (V3).** Round 3's claim that
"no seam proposal can match the review-tray fingerprint" is **withdrawn** — disproved by execution
(§2.1, §10). The frozen consequences:

| Input class | Today | Under S6.1 | Notes |
| --- | --- | --- | --- |
| Honest notes tray (fingerprint, no S3.1 marker) | eligible when ordinary guards pass | **unchanged** — never enters steps 7–11 | S2.4 / §9 R3 stand |
| Honest seam (S3.1 marker, no fingerprint) | refuses at fingerprint (`false`) | refuses at steps 7–11 (`false`, named code) | boolean preserved; name changes |
| **Overlap** (fingerprint ∧ S3.1 marker) | **eligible** (`true`) | **refuses** at steps 7–11 (`false`) | boolean **flips**, fail-closed; intentional under D4 = A |

A test must assert the first two rows' boolean equivalence and the third row's flip. The flip is
**not** a notes-tray regression: an honest notes row does not carry seam apply markers.

### S7 — The hosted media surface gap is recorded, not silently "supported"

No hosted media proposal route exists (G17); Scooling's hosted media transport targets
`https://api.knowtation.store/api/v1/attachments/*` (G21, G25), which falls through the gateway
catch-all to the canister and returns `404 NOT_FOUND` (G18).

Therefore:

1. `SEC-SEAM-1b` **must not** build a hosted media proposal route. That is a new surface, not a P3 fix.
2. `docs/PROPOSAL-LIFECYCLE.md` must record that media proposals are self-hosted-only today and that
   the hosted media transport is unreachable.
3. A test must assert the gateway exposes no `api/v1/attachments/*` route, so a later phase cannot
   add one without deliberately updating this freeze.
4. Media is excluded from the "accept session-bound learner identity" deliverable for the hosted path,
   because there is no hosted path to accept it on. **Self-hosted media is still classified seam**
   (S3.1 condition #5), so media proposals that can actually reach an apply today are covered.
5. **§12 D2 is ratified as option A** (§12.1): media stays out of scope and a roadmap row is opened
   for a hosted media proposal surface. `SEC-SEAM-1b` ships without it.
6. When a hosted media route is later built, it must ship with a `maybeApplyHostedMediaAfterApprove`
   hook **and** a matching S3.1 condition added in the same change — the S3.0 anti-drift rule applies
   to future surfaces, not only to the surfaces that exist today. Recording this here is what makes
   G30's "no hosted media apply hook" a stated gap rather than a silent hole in the correspondence
   table.

### S8 — The consumer contract is published

Record in `docs/PROPOSAL-LIFECYCLE.md` (and cross-link from
`~/scooling/docs/ADAPTER-CONTRACTS.md` under the Task and Delegation adapter sections, which today say
nothing about which credential is used — G-note in §7):

> Consumers must present a per-learner, session-bound Knowtation credential on task, media, and
> delegation proposal-create surfaces. A shared service credential is a contract violation.
> Knowtation cannot detect it (§3.2); its only server-side consequence is permanent ineligibility for
> personal self-apply.

### S10 — Operator-declared self-apply-ineligible subjects

Freeze review round 1 (F5) identified a server-side control this freeze had missed, and it is
adopted. Knowtation cannot *detect* a shared credential (§3.2), but the operator **knows which
account backs the shared token** — it is their own. Naming that `sub` server-side is a declaration,
not a heuristic.

1. Add `HUB_SELF_APPLY_INELIGIBLE_SUBS`, a comma-separated env list of `sub` values permanently
   ineligible for personal self-apply — compared exactly, never pattern-matched. **Parse shape**
   copies `hub/gateway/server.mjs:156-160` (`HUB_ADMIN_USER_IDS` → `.split(',').map(trim).filter(Boolean)`
   → `Set`), but the implementation **must not** live in `hub/gateway/**` (V10): put a pure
   `parseSelfApplyIneligibleSubs(raw)` in `lib/hub-self-apply-ineligible.mjs` (or an equivalent
   `lib/**` module that does not import `hub/**`). Production wires
   `process.env.HUB_SELF_APPLY_INELIGIBLE_SUBS` through that parser **once at module load** into a
   module-level `Set`. Tier 7b exercises unset / `''` / `',, '` by calling the **pure parser**
   directly with those strings in one run — not by mutating `process.env` and hoping module load
   re-runs (V6). Round 1 cited `hub/gateway/access-token-authz.mjs:75-77` and `:55-66` for this;
   both citations were wrong (N8).
2. When the approving actor's `sub` is on the list, `personalSelfApplyRefusalReason` returns
   `SELF_APPLY_SUBJECT_INELIGIBLE`. It is **step 1** of the frozen precedence (S6.1) and applies to
   seam and non-seam proposals alike. It is **internal-only** — the HTTP response is unchanged (S6,
   N7).
3. Absent or empty env means no subject is listed. This is the one place where absence is permissive,
   because the alternative — an unset variable disabling all self-apply — would take the live notes
   review tray down (§9 R3, and the same live-path reasoning as S2.4). The empty-env branch is the
   one S10 branch whose failure is a live outage, so §7 requires a dedicated test for it (N13).
4. Setting the variable in production is an operator action, i.e. **Tier 3** (gate T3). Shipping the
   *code* is not.

#### S10.4 — What S10 does and does not deliver (N14, ratified D3)

**Ships dormant.** Per ratified D3 the list is **empty** in `SEC-SEAM-1b`. S10 bars nobody in this
phase; it makes the control available for a later Tier-3 action. Any statement that S10 "closes" the
shared-identity case must carry this qualification — an earlier draft of the paragraph below did not.

**It cannot be used without cost.** The shared consumer token is a JWT for a **human operator
account**. A machine-credential mint path **does** exist (`signServiceJwt`, G35) but is not what
backs those env tokens today, and it is already self-apply-ineligible under S1 (`legacy_session`).
Listing the operator's human `sub` still disables that human's own legitimate self-apply from their
own browser, because §3.2's indistinguishability applies to S10 itself — the server cannot tell the
operator's shared-token use from the operator's personal use of the same `sub`. S10 is therefore a
control the operator trades something for, not a free win. (V1: the "no machine-credential mint
path" premise is withdrawn; the cost argument for listing the human `sub` stands.)

**What it would deliver if populated:** the single-shared-identity case that S1 and S2 cannot reach,
closed **before** the Scooling work (C1–C4) lands, narrowing the window §9 R4 accepts as open. It is
the closest available thing to the driving finding's literal wording (§3.4).

**What it does not do:** it needs the operator to know and maintain the list, it costs that operator
their own self-apply, and it does nothing for a shared credential the operator has not declared. It
is a complement to C1–C4, not a substitute.

### S9 — No scope creep (closing rule — deliberately last, after S10)

`SEC-SEAM-1b` changes only:

| File | Change |
| --- | --- |
| `hub/gateway/server.mjs:213-228`, `:277-287` | S1 mint claim (D1 = A, ratified). `:1282` is deliberately **not** stamped (G3) |
| `hub/server.mjs:308-316`, `:326-332` | S1 mint claim at **both** self-hosted sites — login **and** refresh (N9) |
| `hub/lib/local-auth.mjs:179-192` | S1 mint claim at `issueLocalToken` (V2 / G36) |
| `hub/gateway/server.mjs:156-160` | Reference pattern only for S10.1 — **not modified** |
| `hub/gateway/access-token-authz.mjs` | S1 `resolveActorTokenClass` / `isSessionBoundActor` only — **not** the S10 set (V10). Self-hosted may import these two exports (W2) |
| `lib/hub-self-apply-ineligible.mjs` | **new** — S10 pure parser + module-load Set (V6, V10) |
| `lib/hub-proposal-personal-self-apply.mjs` | S2, S3, S6, S10 consult — imports apply-path predicates + flow source constants (S3.1) and the S10 `lib/` module; **no** `hub/gateway/**` import |
| `hub/gateway/server.mjs:2949`, `:2969`, `:3025`, `:3077`, `:3102-3111`, `:3116-3120` | S2.1 hosted inputs — extend `resolveHostedActorRole` to return the payload at **both** `:2969` and `:3025` (N17, W1); S6.2 seam-code HTTP branch at `:3116-3120` (V4, V5) |
| `hub/server.mjs:467-491`, `:476`, `:486-490` | S2.1 self-hosted inputs (incl. authorized import of `access-token-authz.mjs` — W2); S6.2 seam-code HTTP branch (V4, V5) |
| `hub/gateway/cors-middleware.mjs:60`, `hub/bridge/server.mjs:872` | S4.2 |
| `docs/PROPOSAL-LIFECYCLE.md` | S7.2, S8 |
| `docs/ROADMAP.md:49` | **Status refresh** for SEC-SEAM-1 (round-4 / D5 = A / reviewer verdict) **plus** the new roadmap row for a hosted media proposal surface (S7.5, ratified D2 = A). The §3.4 disclaimer on line 49 already exists — do not re-argue it (W4) |
| `~/scooling/docs/ADAPTER-CONTRACTS.md` | S8 cross-link. **Owned by Scooling as C6**, not built by `SEC-SEAM-1b` — listed here so this table is not contradicted by S8 (N12) |
| `test/sec-seam-1-session-bound-identity.test.mjs` | new |

Nothing else. **No new seam field list, in any file** (S3.0). Conditions #6/#7 test the same
`proposal.source === …` expressions the apply path already uses (G32) — that is S3.0-compliant, not
a parallel list.

**Do not** in this phase: add a hosted media route; change `MEDIA_WRITE_ROLES`; touch the delegation
apply path (SEC-KN-4 owns it); add telemetry for shared-credential detection; widen the self-apply
fingerprint — widening is gate T5; stamp `signServiceJwt` (G35); or import `hub/gateway/**` from
`lib/hub-proposal-personal-self-apply.mjs`.

### 4.1 Frozen signatures

```js
// hub/gateway/access-token-authz.mjs
export function resolveActorTokenClass(payload):
  'session' | 'mcp_access' | 'legacy_session' | 'unknown'
export function isSessionBoundActor(payload): boolean
// isSessionBoundActor(null) === false  (V11)

// lib/hub-self-apply-ineligible.mjs  (V6, V10)
export function parseSelfApplyIneligibleSubs(raw: string | undefined | null): Set<string>
// module-load: parseSelfApplyIneligibleSubs(process.env.HUB_SELF_APPLY_INELIGIBLE_SUBS)

// lib/hub-proposal-personal-self-apply.mjs
// NOTE: no SEAM_SURFACE_INTENTS — deleted by S3 (D4 = A). No seam field list may exist (S3.0).
export function isSeamSurfaceProposal(proposal): boolean
export function isDelegationSurfaceProposal(proposal): boolean
export function personalSelfApplyRefusalReason({
  proposal, hasVaultWrite, partitionOwned, role,
  humanActor, tokenType, actorKind,
  authorActorId, approverActorId, sessionBound,
}): string | null
export function personalSelfApplyAllowsApprove(opts): boolean
// === personalSelfApplyRefusalReason(opts) === null  (V5)
```

---

## 5. Scope

**In scope (Knowtation, `SEC-SEAM-1b`):** S1–S10 exactly as written.

**In scope (Scooling, `L-SEAM` — a separate build on the Scooling board):** C1–C6 in §6.

**Out of scope:** hosted media route (S7); media role posture (§12 D2); author-binding the existing
notes self-apply path (§9 R3); any change to delegation apply (SEC-KN-4); the actual widening of the
self-apply class (gate T5, `FINISH-COMPLETE-APPLY-KN-b`); secret rotation (Pass 2 P7, already done);
`applyPersonalSelfApplyEvaluationE1` (§9 R8).

---

## 6. Consumer contract — Scooling `L-SEAM` (not built by SEC-SEAM-1b)

Frozen here so both boards agree; built and verified on the Scooling board.

| # | Requirement | Anchor |
| --- | --- | --- |
| **C1** | Hosted task, media, and delegation write transports stop sourcing `Authorization` from `KNOWTATION_AUTH_TOKEN` / `KNOWTATION_HUB_TOKEN` | `taskWriteHubTransport.ts:208-212`, `:293-302`; `mediaWriteHubTransport.ts:112-115`, `:314-322`; `delegationHubTransport.ts:486-489`, `:344-355` |
| **C2** | They take the per-request learner token from the existing session mechanism — `resolveHostedAuthSessionContext(...).rawToken` — mirroring the notes path and the calendar session substitution | `scoolingHostedAuth.ts:373-417`; `hostedReviewWriteBack.ts:843-851`; `calendarHubTransport.ts:407-427` |
| **C3** | The synthetic task-write UI actor is replaced by the real session; the routes must pass `request` through to the surface | `taskWriteSurface.ts:65-68`, `:222-272`; `app/routes/tasks.tsx:23-27` and the three sibling routes |
| **C4** | When no learner session is present, the write **refuses** with a distinct reason. It must not fall back to the env token — a fallback reproduces P3 exactly | new refusal code, sibling of `hostedReviewWriteBack` refusals |
| **C5** | Learner identity is never sent as a header or body field; `scooling_uid` stays internal to Scooling | `identityAdapter.ts:242-251`; enforced Knowtation-side by S4 |
| **C6** | The env token may remain **only** for operator/maintenance paths that are not learner-attributed, and `ADAPTER-CONTRACTS.md` must state which those are | `~/scooling/docs/ADAPTER-CONTRACTS.md:470-491`, `:511-531` |

**Ownership split in one line:** Scooling makes each request carry the right learner; Knowtation
makes the wrong learner un-self-appliable and says so by name. Neither half is sufficient alone, and
the Scooling half is the only one that fixes partition and attribution (§2.2).

**Sequencing:** C1–C4 may ship before or after `SEC-SEAM-1b` — they are independent, because S1–S10
change no behavior that today's Scooling depends on. Both must be done before gate T5.

---

## 7. Test matrix — seven tiers plus security regression

One new file, `test/sec-seam-1-session-bound-identity.test.mjs`, following the established SEC-KN
layout (tier-banner `describe` blocks; a pre-fix replica in the security tier; source-read assertions
where behavior is structural).

| Tier | Must prove |
| --- | --- |
| **1 unit** | `resolveActorTokenClass` returns each of the four classes for the four payload shapes, including `null`, and classifies the `:1282` internal-hop payload (`{sub}` only) **and** a `signServiceJwt`-shaped `{sub, role:'service'}` payload as `legacy_session` (G3, G35); `isSessionBoundActor` is true **only** for `'session'` and is `false` for `null` (V11); `isSeamSurfaceProposal` returns `true` for each of the **seven** S3.1 conditions **independently** and `false` for a notes review-tray proposal; `isDelegationSurfaceProposal` is true for conditions 2 and 4 only; a predicate that throws classifies **seam** (fail-closed, S3.1); `personalSelfApplyRefusalReason` is **total** — no input yields `undefined`; `parseSelfApplyIneligibleSubs` returns an empty Set for unset / `''` / `',, '` (V6) |
| **2 integration** | `personalSelfApplyRefusalReason` returns each S6 code — seam and non-seam — for its exact trigger, **in the S6.1 precedence order** (assert the order directly: an input satisfying several refusals returns the earliest); `isPersonalSelfApplyClass` / `personalSelfApplyAllowsApprove` equal `reason === null` across the matrix (V5); the non-seam codes **and** `SELF_APPLY_SUBJECT_INELIGIBLE` do not change the HTTP response (still generic 403 `FORBIDDEN` at `hub/gateway/server.mjs:3116-3120` and `hub/server.mjs:486-490` — N7); HTTP-visible seam codes **are** returned at those same sites (V4); **both** call sites pass the three new inputs — `hub/gateway/server.mjs:3102-3111` and `hub/server.mjs:476` (source-read assertions); S1 stamps `issueLocalToken` (G36) |
| **2b behavior preservation (N5)** | A differential test over a generated input matrix: for every combination, `personalSelfApplyRefusalReason(opts) === null` equals the **pre-fix** `isPersonalSelfApplyClass` boolean whenever no seam/S10 input is supplied. Must specifically cover the two guards round 1 misstated — `role` **omitted** (check skipped, still eligible) and `status` **absent** (treated as `'proposed'`, still eligible) — so a regression here fails loudly rather than silently tightening a live path |
| **3 e2e** | Approve-eligibility matrix over {seam, non-seam} × {session-bound, legacy, mcp_access} × {author==approver, author≠approver, author empty}; the notes review-tray fingerprint with a legacy token and empty author still resolves **eligible** (no live regression — §4 S2.4) |
| **3b role floor (N13)** | S5: a `member` actor on hosted task propose and a `viewer` actor on self-hosted task and delegation-consent propose all still succeed (G15, G16) — the consumer's switch to learner tokens must not start returning 403 |
| **4 stress** | Many distinct seam proposals sharing one author id never produce an eligible result; large/adversarial intent strings and a 128-char author id do not bypass the trim/equality check |
| **5 data-integrity** | Refusal is a pure decision — no proposal field is mutated, no evaluation field is written, and the result is idempotent across repeated calls with the same inputs |
| **6 performance** | Eligibility resolution adds no filesystem or network read beyond today's single `fetchHostedProposalForSelfApply` call |
| **7 security** | **Regression that fails against pre-fix code.** A pre-fix replica of `isPersonalSelfApplyClass` (today's `:106-124`) must return `true` for a `task_create` proposal admitted to the fingerprint class under a single shared identity; the fixed function must return `false` with `SELF_APPLY_SESSION_BINDING_REQUIRED` or `SELF_APPLY_AUTHOR_MISMATCH`. **The N1 evasion, as the primary case:** a proposal that omits `proposal_kind` and sets `knowtation_proposal_source` + `task_proposal_kind` must classify **seam** — and the test must assert the round-1 rule (`frontmatter.proposal_kind ∈ list`) would have classified it non-seam, so the differential is demonstrated rather than asserted. Also: `intent` omitted, and `intent` renamed to an unlisted value, must not change the classification either way. **V3 overlap:** fingerprint ∧ task markers → pre-fix replica `true`, fixed function `false` with a seam code (not `FINGERPRINT_MISMATCH`). **Correspondence (S3.1):** for each of the **seven** conditions, a proposal that satisfies the approve-time apply trigger satisfies `isSeamSurfaceProposal` — asserted by calling the *same* functions/expressions the hooks use (`normalizeCanisterProposalForTaskPrecheck`, `isDelegationProposalIntent`, and the five `*_PROPOSAL_SOURCE` constants including flow / flow_capture), so the test breaks if the hook's dispatch changes. **S3.0 source-read:** the shipped `lib/hub-proposal-personal-self-apply.mjs` contains no literal seam kind/intent list — assert the absence of the deleted `SEAM_SURFACE_INTENTS` identifier and of the string `task_proposal_kind`; assert it does not import from `hub/gateway/**` (V10). **S10:** an approver whose `sub` is on the ineligible set is refused even when every other condition holds, including on the notes fingerprint, **and the HTTP body stays generic `FORBIDDEN`** (N7). Plus: no route reads a client `X-User-Id`/`X-Actor-Id` (source-read over `hub/bridge/**` and `hub/gateway/server.mjs`); `X-User-Id` is absent from the allow-headers of **both** `hub/gateway/cors-middleware.mjs` and `hub/bridge/server.mjs`; the gateway exposes no `api/v1/attachments/*` route (S7.3) |
| **7b S10 empty-env (N13, V6)** | Call `parseSelfApplyIneligibleSubs` with `undefined`, `''`, and `',, '` in one run — each yields an empty Set — and assert the notes review-tray fingerprint still resolves **eligible** when the ineligible set is empty. Do **not** require reloading the module under three `process.env` values. This is the one S10 branch whose failure is a live outage (S10.3), and the ratified D3 selection means it is the branch that actually ships |

**Test-honesty requirement (from SEC-KN-4b BV round 1):** the security tier must *demonstrate* the
discrimination — the pre-fix replica has to be a branch-for-branch copy of the current function, and
the test must fail if the fix is reverted. Tautological assertions over two constants are not
evidence.

Because honest seam proposes do not reach the class through the fingerprint (§2.1), the tier-3 and
tier-7 cases must construct the widened-class and overlap scenarios explicitly (fingerprint
satisfied *and* seam marker) so the admission gate and the V3 flip are exercised rather than masked
by the fingerprint refusal.

---

## 8. Tier 3 gates (not part of SEC-SEAM-1b)

| Gate | Description |
| --- | --- |
| **T1** | Canister WASM upgrade installing `created_by` — inherited from SEC-KN-4. Until T1, every hosted `authorActorId` is `""` and S2 refuses with `SELF_APPLY_AUTHOR_UNVERIFIED` |
| **T2** | Merge to Muse `main`, or a `muse-mirror → main` PR (SD-14) |
| **T3** | Flipping `SCOOLING_TASK_WRITES` / `SCOOLING_MEDIA_*` / `SCOOLING_DELEGATION_*` on in production |
| **T4** | Restoring the migration hook to identity after T1 — inherited (SEC-KN-4c) |
| **T5** | **Admitting any intent into the personal self-apply class.** Requires: S1–S10 done, C1–C4 done, T1 installed, and a fresh freeze for the widening itself |

---

## 9. Residual risks and non-goals (explicitly accepted)

| # | Risk | Disposition |
| --- | --- | --- |
| **R1** | A learner's own token copied into operator env still passes every server-side check | Accepted and stated (§3.2). Blast radius shrinks from *all learners* to *one*, which is ordinary credential compromise rather than systemic identity collapse |
| **R2** | S1's class claim does not prove liveness | Accepted (§4 S1 rationale). Its value is barring a future machine credential by name and failing closed on unknown classes |
| **R3** | The existing notes self-apply path is **not** author-bound by this phase | Deliberate. Requiring non-empty `created_by` there would break a live hosted path before T1 (§3.1(2)), and a partition-owner fallback is the SEC-KN-4 D1 fail-open the operator already rejected. Tracked as a post-T1 roadmap row, **not** silently dropped |
| **R4** | Until C1–C4 ship, partition and attribution stay collapsed (§2.2) | Accepted. Not fixable in Knowtation — S10 *would* remove the self-apply consequence if the operator declared the subject, but per ratified D3 the list ships empty, so in this phase it removes nothing; partitioning and attribution stay wrong until the consumer sends per-learner credentials. The three surfaces are env-off in production, so nothing live degrades meanwhile |
| **R5** | Media hosted remains unreachable | Accepted (S7). Recorded rather than papered over |
| **R6** | `legacy_session` tokens remain valid until natural expiry | Accepted. They are propose-capable and self-apply-ineligible, which is the fail-closed direction |
| **R7** | The role collapse in §2.2 (learners inheriting the operator's allowlist role) is not addressed server-side | Accepted; it is a direct consequence of the shared credential and resolves entirely with C1–C4 |
| **R8** | `applyPersonalSelfApplyEvaluationE1` (`lib/hub-proposal-personal-self-apply.mjs:134-164`) is a **second consumer** of the self-apply concept in the same file. It stamps `evaluation_status: 'passed'` at create time gated only by `matchesScoolingReviewTrayFingerprint`, wired at `lib/hub-proposal-create-augment.mjs:15` and `hub/proposals-store.mjs:12`. When gate T5 widens the fingerprint, E1 widens with it — unbound by S2 | Out of scope here (§5), because touching E1 changes create-time behavior on the live notes path. **Must be author-bound as part of the T5 widening freeze**, which cannot be signed off without it. Raised by freeze review round 1 (F14) |
| **R9** | S10's ineligible list is operator-maintained, **ships empty (D3)**, and cannot be populated without collateral cost | Accepted, with the N14 qualification and the V1 correction. A subject the operator has not declared gets no protection from S10, and in `SEC-SEAM-1b` that is *every* subject. Populating it is Tier 3 (T3). The shared *consumer* token belongs to a human operator account; listing that `sub` also disables that human's own self-apply from their browser. A machine-credential mint path exists (`signServiceJwt`, G35) but is already `legacy_session` under S1 and is not what backs those env tokens today. S10 is a dormant, cost-bearing control in this phase; S1/S2 carry the enforcement that actually ships. See S10.4 |
| **R10** | Seam classification reuses *enabling* apply-path predicates as *restricting* classifiers | Accepted, and preferred to a parallel list. A change that makes `normalizeCanisterProposalForTaskPrecheck` (or a sibling) more permissive — in order to apply more rows — also pulls more proposals into the seam refusal branch, **including fingerprint-overlap rows** (the V3 mechanism). That co-movement is the point of S3.0 for apply triggers; the residual is that review-tray rows which also grow seam markers flip from eligible to refused (fail-closed, §2.1 / S6.1). The tier-7 correspondence + overlap tests convert a future divergence or silent tray break into a failing build |

---

## 10. Ground-truth edge — what this session could not verify

| Item | Status |
| --- | --- |
| The 404 for hosted media proposals | **Code-verified, not live-probed** — derived from the gateway routing table (G17) plus the canister default (G18). No HTTP request was made in this session |
| Whether the MCP host shares `SESSION_SECRET` with the gateway | **UNVERIFIED**, unchanged from the handover snapshot. Does not affect S1–S10 |
| The exact production value/holder of `KNOWTATION_AUTH_TOKEN` | **Not inspected by design.** No secret was read or printed |
| Self-hosted mint site line numbers for S1.1 | **RESOLVED in round 3 (N9).** Both sites were read directly: `hub/server.mjs:308-316` (`issueToken`, login) and `:326-332` (`issueAccessTokenForSub`, refresh). The round-1 deferral of this to Auto is withdrawn; there are **two** sites, not "the self-hosted equivalent", and missing the refresh one would break seam self-apply after any token refresh |
| Whether the notes review tray is genuinely live (N15) | **Document-verified, not live-probed.** The driving audit records `SCOOLING_HOSTED_REVIEW_WRITE_BACK` as absent (`~/scooling/docs/PRE-BUILD-SECURITY-AUDIT-FINDINGS-PASS2.md:86`), which would make the "would break the live notes review tray" justification for S2.4 / §9 R3 / S10.3 hollow. That audit row is **stale**: Scooling records P8 as resolved on 2026-07-26 with `SCOOLING_HOSTED_REVIEW_WRITE_BACK=enabled` on production (`~/scooling/docs/OVERSEER-HANDOVER.md:95`, `:130`, `:299`, `:323`; `~/scooling/docs/ROADMAP.md:122`, `:162`). The deferrals therefore stand. **Caveat kept:** Scooling's own note says the post-env live Approve smoke was **not re-run**, so "live" here means operator-set env recorded in two governance docs, not an observed 200 |
| Predicate reuse under S3.1 | **Execution-verified in round 3.** `node` importing `lib/task/task-hosted-proposal.mjs`, `lib/agent/delegation-hosted-proposal.mjs`, `lib/attachments/attachment-write.mjs`, `lib/task/task-write.mjs`, and `lib/hub-proposal-personal-self-apply.mjs` together succeeds (no cycle); the N1 crafted proposal returns non-null from `normalizeCanisterProposalForTaskPrecheck` (**seam**) while its `frontmatter.proposal_kind` is `undefined` (round-1 rule: **non-seam**); and `normalizeCanisterProposalForDelegationPrecheck` returns non-null wherever `isDelegationProposalIntent` is true (G28 superset) |
| V3 fingerprint ∧ seam overlap | **Execution-verified in round 4.** A proposal with review-tray fingerprint fields **and** `knowtation_proposal_source` + `task_proposal_kind` (string or object frontmatter) yields `normalizeCanisterProposalForTaskPrecheck != null`, `matchesScoolingReviewTrayFingerprint === true`, and `isPersonalSelfApplyClass === true` today — so S6.1's absolute "no live behavior change" claim was false |
| Flow forgeability (D5 ground) | **Execution-verified in round 4.** `source: 'flow'` + forged fingerprint → self-apply class `true`; honest flow path → `false`. Apply dispatch and shared-token citations: G32–G34 |
| V1 / V2 / V4–V11 citations | **Re-derived from source in round 4** before amendment. V2 mount sites corrected to `registerLocalAuthRoutes` call sites (`:510` / `:625`), not the import lines round 3 cited |
| Scooling `mediaWriteHubTransport.ts` / `delegationHubTransport.ts` line numbers (G21) | Originally spot-checked by pattern rather than read line-by-line. **Freeze review round 1 read them directly and confirmed both**, and added the nuance now recorded in G21: delegation reads `KNOWTATION_AUTH_TOKEN` with **no** `KNOWTATION_HUB_TOKEN` fallback |

**Two claims in the first draft were presented as verified ground truth and were not** — both caught
by freeze review round 1, both now corrected in §2 rather than merely disclosed here:

- G3 claimed "exactly two" gateway mint sites. There are three (`hub/gateway/server.mjs:1282`). The
  omission was fail-closed — the third classifies as `legacy_session` — but S1.1 told the build the
  enumeration was exhaustive (F2).
- S3 keyed seam classification on `task_meta.proposal_kind`, which **does not exist on the canister
  record at all** (G19.2), making the hosted classifier inert and leaving only a client-supplied
  `intent` (F3). This was the most consequential defect in the draft and is why S3.1/S3.2 now exist.

**Round 2 found that round 1's own repair was also wrong, and round 3 records that plainly.** The F3
fix re-keyed classification onto `frontmatter.proposal_kind` — a *second* hand-written field list,
and still not the key the apply hook reads (`task_proposal_kind`, G27). Two consecutive rounds wrote
a parallel list and two consecutive lists were wrong in the same way, which is the evidence behind
S3.0's blanket prohibition: the defect was never the choice of key, it was the existence of a
parallel key at all.

**Round-1's "all verified against source" claim was overstated (N16), and is corrected here.** N3 and
N11 both found errors inside rows that claim had covered — ten of twelve `SEAM_SURFACE_INTENTS`
entries were not intents, and the `mcp_access` enumeration missed two refresh sites. The claim in
§11's round-1 row is amended to "every finding was checked against source before amendment", which is
what actually happened, rather than "every resulting row is correct", which round 2 disproved.

---

## 11. Review record

| Round | Reviewer | Verdict | Resolution |
| --- | --- | --- | --- |
| 1 | Freeze-review loop (thinking, independent) | **blocked** | 14 findings, all cited. **Each finding was checked against source before amendment** — no finding was accepted on the reviewer's word. (N16 correction: the original wording, "all verified against source", implied the *resulting rows* were correct; round 2 disproved that via N3 and N11, so the weaker and accurate claim is recorded instead.) F1 stamp removed (§ header note). F2 G3 corrected to three mint sites + G3.1. F3 S3.1/S3.2 rewritten — `task_meta` is not on the canister record; classification is now a fail-closed union over `intent` and server-set `frontmatter.proposal_kind`, with obligations attached to allowlist admission rather than a skippable overlay. F4 seven non-seam refusal codes added, marked internal-only. **F5 adopted as new rule S10** (operator-declared ineligible subjects) and §3.2's "only" corrected. F6 S4.2 extended to `hub/gateway/cors-middleware.mjs:60` with a stated disposition for `main.mo:221`. F7 self-hosted call site named (`hub/server.mjs:467-491`). F8 S2.1 input-source table added. F9 G19 re-scoped and enumeration completed. F10 kit-root path prefix. F11 line cites corrected to the frontmatter sources. F12 §3.4 deviation subsection added. F13 D1 third option added. F14 E1 recorded as §9 R8 + §5 out-of-scope |
| 3 | Freeze-review loop (thinking-high, independent, fresh — no authoring context) | **blocked** | 11 findings (V1–V11); **1 escalating: V1 (`security`)**. Confirms the D4 = A rewrite works — N1's evasion is closed by construction, reproduced by execution — and independently confirms **15 of 18** round-2 findings resolved. But it disproves three claims round 3 asserted: **V1** the "no machine-credential mint path" premise (one exists), **V2** S1's "all four mint sites" (a fifth exists), **V3** S6.1's "no live behavior change" (disproved by execution). **Loop stopped for the operator** per `.claude/skills/freeze-review-loop/SKILL.md:28-39` — `security` category **and** `blocked` verdict are both hard stops. No finding auto-fixed |
| 2 | Freeze-review loop (thinking, independent, fresh) | **blocked** | 18 findings (N1–N18). Round-1 fixes verified from source: **F1, F6, F7, F9, F10, F11, F12, F14 HOLD**; **F2, F4, F5, F8 PARTIAL**; **F3 and F13 DO NOT HOLD**. Two escalating: **N1** (`security`, BLOCKER) and **N14** (`security`, MINOR); **N2** is a BLOCKER spec gap introduced by round 1. **Loop stopped for the operator** per `.cursor/skills/freeze-review-loop/SKILL.md:28-36`. No finding auto-fixed in this round. |
| 4 | Fix round (Thinking) — operator D5 = A; citations re-derived; V3 overlap re-executed | **findings** (5 MINOR, none escalating) | Independent reviewer (`thinking-high`, fresh — [round-4 review](a50ef4d3-5941-4779-8cf7-9fcd1bb8aeff)) re-derived V1–V11 + D5 from source; **confirmed all hold**, including V3 by execution. Returned W1–W5 (all MINOR). No operator decision. Fixer addresses W1–W5 in place |
| 5 | Fix round (Thinking) — W1–W5 only | **findings** (2 MINOR: X1, X2) | Independent reviewer ([round-5 review](f1e9f81d-39d5-455c-b1db-e3d0738b9eb2)) — **W1–W5 HOLD**; V1–V11 / D5 / S3.0 spot-checks hold; no stamp in YAML. X1: S2.1 "live effect" wording contradicted W3. X2: header stale vs round-5 row |
| 6 | Fix round (Thinking) — X1–X2 only | **findings** (1 MINOR: Y1) | Independent reviewer ([round-6 review](ac718447-7613-41b0-8dd6-7810b240a568)) — X1/X2 HOLD at cited loci; YAML stamp absent; W3/S3.0/D1–D5 clean. **Y1:** S1.1 N9 rationale still claimed "live effect before T1" |
| 7 | Fix round (Thinking) — Y1 only | **pass** | Independent reviewer ([round-7 clearance](b7e481c0-c3d4-437b-ae86-1865e895397f)) — Y1 HOLD; X1/X2/W3 consistent; no YAML stamp at review time; D1–D5 ratified; T1–T5 unauthorized; S3.0 intact. **FINDINGS: none.** Mechanical gate re-run after recording this pass; stamp retained only because §11 now has semantic `pass` (F1 rule) |

**Round-1 escalations (F1, F3, F5, F6) were technical or procedural defects, not operator decisions,
and were fixed in place.** Round 2 is different: **N1 changes where enforcement must live**, which is
a design decision, and round 1's own fix for F3 is what N1 refutes. The round-2 session did **not**
attempt a third self-directed redesign inside the loop.

**Round 3 (this fix round) started by obtaining the operator's selection, not by assuming it.** The
paste-ready prompt it was launched with contained the words "fix N1 per D4 option A" — but that text
was written by the round-2 session itself (`docs/OVERSEER-HANDOVER.md:46-60`), so treating it as
ratification would have been an authoring session clearing its own escalation, the exact defect that
reverted SEC-KN-4a §12.1 in that phase's round 2. The session stopped, asked, and recorded the
operator's four answers verbatim in §12.1 before editing any rule.

### 11.1 Round-2 findings — full list, **all addressed in round 3**

Every citation below was **re-verified against source by the round-3 session**; none is accepted on
the reviewer's word, and two reviewer citations were themselves corrected (see N15 and N18). N1's
evasion and its fix were reproduced by **executing** the predicates, not only by reading them (§10).

**Disposition summary.** All 18 addressed: 16 fixed as cited, N15 resolved as *the audit row is
stale* (the reverse of what the finding assumed), N18 fixed with a corrected line number. The two
BLOCKERs are closed by the ratified decisions: **N1** by D4 = A (S3 rewritten around the apply path's
own predicate), **N2** by D1 = A (S1 is now unconditional, so no C-selection spec gap exists).

| # | Disposition | Where |
| --- | --- | --- |
| N1 | **Fixed** — S3 rewritten; classification calls the apply path's predicate; anti-drift rule S3.0 frozen; evasion + fix reproduced by execution | S3.0–S3.3, G27–G31, §10 |
| N2 | **Fixed** — D1 ratified A, so S1 is unconditional; the option-B/C clause and its S1.4 mis-description are deleted | S1 preamble |
| N3 | **Dissolved** — `SEAM_SURFACE_INTENTS` deleted entirely rather than re-keyed | S3.0 |
| N4 | **Fixed** — S2.2 now triggers on `isSeamSurfaceProposal`, with the reason stated | S2.2 |
| N5 | **Fixed** — S6 trigger table replaced with the exact live guards, incl. `role != null` and `status ?? 'proposed'`; tier-2b differential test added | S6, §7 |
| N6 | **Fixed** — full 14-step precedence frozen, derived from live order + predicate needs | S6.1 |
| N7 | **Fixed** — `SELF_APPLY_SUBJECT_INELIGIBLE` demoted to internal-only, removing both the contradiction and the disclosure | S6, S10.2 |
| N8 | **Fixed** — citation corrected to `hub/gateway/server.mjs:156-160`; the two wrong cites named | S10.1 |
| N9 | **Fixed** — both self-hosted mint sites enumerated; §10 deferral withdrawn | S1.1, S9, §10 |
| N10 | **Dissolved** — S3.1 reads `source` self-hosted and reuses the dual-shape parser | S3.3, G31 |
| N11 | **Fixed** — four `mcp_access` mint sites, grant + refresh in each provider | G3.1 |
| N12 | **Fixed** — `ADAPTER-CONTRACTS.md` added to the S9 table, marked Scooling-owned (C6) | S9 |
| N13 | **Fixed** — tier 3b (S5 role floor) and tier 7b (S10 empty-env) rows added | §7 |
| N14 | **Fixed** — S10.4 added; §3.2, §3.4, R4, R9 all qualified; D3 warning delivered before ratification | S10.4, §3.2, §3.4, §9 |
| N15 | **Resolved, finding inverted** — the *audit row* is stale, not the justification: Scooling records P8 done 2026-07-26. Tension now disclosed, with the "no live smoke" caveat kept | §10 |
| N16 | **Fixed** — header note corrected; round-1 row's "all verified" claim amended | header, §10, §11 |
| N17 | **Fixed** — `resolveHostedActorRole` cited at `:2949` with the `:2969` early return called out | S2.1, S9 |
| N18 | **Fixed, with a correction to the finding** — the proposals-POST frontmatter extraction is `:1371`, not `:1372` (`:1372` is `base_state_id`); `:1361` correctly identified as the notes branch and dropped | G19.4 |

| # | Sev | Category | Citation | Finding |
| --- | --- | --- | --- | --- |
| **N1** | **BLOCKER** | **security** | `hub/gateway/task-approve-hosted.mjs:11`, `:17-19`, `:36-38`, `:56`; `lib/task/task-hosted-proposal.mjs:18-23`, `:60-77`, `:85-156`; `hub/gateway/server.mjs:3386` | **Parser differential — the round-1 F3 fix does not close the hole.** Seam *classification* (S3.1) reads `frontmatter.proposal_kind`; the task *apply hook* dispatches on `frontmatter.knowtation_proposal_source` / `proposal.source` / a `meta/tasks/proposals/` path prefix, and takes the kind from `frontmatter.task_proposal_kind` → `task_meta.proposal_kind` → `JSON.parse(proposal.body).proposal_kind`. **`task_proposal_kind` and `proposal_kind` are different keys** (`:20` vs `lib/task/task-write.mjs:494`). Honest hosted proposals carry both (`mergeTaskFrontmatter:60-77` merges the FM_* keys over the base frontmatter), so S3.1 works on honest traffic and fails exactly on crafted traffic: a proposal that matches an admitted allowlist entry, omits `proposal_kind`, and sets `knowtation_proposal_source` + `task_proposal_kind` classifies **non-seam** while still firing the task apply. The hook runs on the same generic approve route self-apply authorizes (`PROPOSAL_APPROVE_RE:11` + 2xx, invoked at `hub/gateway/server.mjs:3386`). Containment today is the bridge task-writes env gate, not this freeze |
| **N2** | **BLOCKER** | completeness / gates_tier3 | artifact S1 conditional vs §12 D1 option C and the S9 "only if D1 = A" row | Round 1 added D1 **option C** without a matching rule. A C selection leaves Auto with no spec: build S1.2/S1.3 without the mint claim (every seam self-apply permanently refused) or drop S1 as under B (`legacy_session` counts as bound)? Those differ by a whole security property. S1's option-B clause also mis-cites S1.4 as a "negative test" and contradicts S1.3 |
| **N3** | MAJOR | completeness | `lib/task/task-write.mjs:374`, `:494`; `lib/attachments/attachment-write.mjs:356`, `:499`; `lib/agent/delegation-hosted-proposal.mjs:20-24` | **Ten of twelve `SEAM_SURFACE_INTENTS` entries are `proposal_kind` values, not intents.** Only the two delegation entries are real intents. The `intent` branch of the S3.1 union is therefore inert for task and media, and S3.2.2's "renaming the intent costs the attacker eligibility" argument is empty — a real task proposal's intent was never in the set. The set needs renaming and re-keying |
| **N4** | MAJOR | consistency | artifact S2.2 vs S3.1 | S2.2 still says obligations attach "when the proposal's **intent** is in `SEAM_SURFACE_INTENTS`". Implemented literally that reinstates the F3 defect. S2.2 must call `isSeamSurfaceProposal` |
| **N5** | MAJOR | completeness | `lib/hub-proposal-personal-self-apply.mjs:110`, `:120`, `:88-89` | Two non-seam trigger descriptions misstate the live guard, and S6 mandates re-implementing the boolean as `reason === null`, so a literal build **changes live behavior**: the real role guard is `opts.role != null && !roleEligible(...)`, and status is `String(proposal.status ?? 'proposed')` — an absent status is treated as proposed today |
| **N6** | MAJOR | completeness | artifact S2.3, S10.2, S6 table; `lib/hub-proposal-personal-self-apply.mjs:108` | Refusal **precedence** is only partly specified (S10 first, seam before fingerprint). Nothing orders seam evaluation against `hasVaultWrite` / `partitionOwned` / role / status. Since exactly one code is returned and seam codes are HTTP-visible while non-seam are not, ordering decides what leaks |
| **N7** | MAJOR | consistency (security-adjacent) | artifact S6 seam table vs S10.2 | `SELF_APPLY_SUBJECT_INELIGIBLE` is listed HTTP-visible but S10.2 applies it to non-seam proposals too — contradicting S6's "none may change what the caller returns over HTTP", and disclosing blocklist membership |
| **N8** | MAJOR | completeness | artifact S10.1 and §3.2 vs `hub/gateway/access-token-authz.mjs:75-77`, `:55-66`, and `hub/gateway/server.mjs:156-160` | S10.1's "model it on the existing admin-allowlist pattern" cites the wrong functions: `:75-77` is `mayApplyAdminAllowlistOverride` and `:55-66` consults no allowlist. The env→`Set` pattern S10 wants is `hub/gateway/server.mjs:156-160` |
| **N9** | MAJOR | completeness | `hub/server.mjs:308-316`, `:326-332` | There are **two** self-hosted mint sites, not "the self-hosted equivalent", and §10 defers finding them to Auto. Stamping only login leaves refreshed tokens `legacy_session`, so seam self-apply silently starts refusing after a refresh — on the path S2.1 says has live effect before T1 |
| **N10** | MAJOR | completeness | `hub/proposals-store.mjs:212`, `:271-289` | The **self-hosted** store persists `frontmatter` as an *object* and keeps `task_meta.proposal_kind`. S3.1 was written for the hosted string-shaped frontmatter (its parse-failure rule presumes a string), so the self-hosted input shape is unspecified and an available signal is discarded |
| **N11** | MINOR | completeness | `hub/gateway/device-oauth-provider.mjs:199`, `:257`; `hub/gateway/mcp-oauth-provider.mjs:235`, `:306` | G3.1 says `mcp_access` is minted at two further sites; there are **four** (refresh-rotation paths missed). Conclusion unchanged — all four stamp the class — but F2 was specifically about exhaustive enumeration |
| **N12** | MINOR | consistency | artifact S8 vs S9 "Nothing else." and C6 | S8 requires an edit to `~/scooling/docs/ADAPTER-CONTRACTS.md` that S9's exhaustive table omits and C6 assigns to Scooling |
| **N13** | MINOR | completeness | artifact S5, S10.3 vs §7 | No test row for S5's "learner roles can still propose" assertion, and none for S10.3's empty-env branch — the one S10 branch whose failure takes the live notes tray down |
| **N14** | MINOR | **security** | artifact S10, §9 R9, §12 D3 | S10 keys on the approver's `sub`, and the shared token is a JWT for a **human operator account** (G3 — there is no machine-credential mint path). Listing that `sub` also disables that human's own legitimate self-apply from their browser. §3.2's indistinguishability applies to S10 itself; the "closes the single-shared-identity case" claim must be qualified and D3 must warn the operator |
| **N15** | MINOR | other (honesty) | artifact S2.4, §9 R3, S10.3 vs `~/scooling/docs/PRE-BUILD-SECURITY-AUDIT-FINDINGS-PASS2.md:86` | Three deferrals are justified by "would break the live notes review tray", but the driving audit (a frozen input) records `SCOOLING_HOSTED_REVIEW_WRITE_BACK` as **absent** from production, so approve returns `hosted_write_env_off`. Either the audit is stale or the justification is; §10 does not disclose the tension. (Note: the Scooling handover records the env as **set on 2026-07-26**, after the audit — this needs one verification, not an assumption) |
| **N16** | MINOR | other (honesty) | artifact header note, §11 round-1 row | The header says the mechanical gate "is run with `--dry-run` between rounds" but no run or verdict is recorded; and round 1's "all verified against source" is overstated given N3 and N11 |
| **N17** | MINOR | consistency | `hub/gateway/server.mjs:2949`, `:2969`, `:3077` | S2.1 cites `:3077`, which is the call-site destructure. `resolveHostedActorRole` begins at `:2949` and has an early return at `:2969` that also needs the payload added. Return shape otherwise correct |
| **N18** | MINOR | consistency | `hub/icp/src/hub/main.mo:1361`, `:1372` | G19.4's claim holds but `:1361` is the note-write branch; the proposals-POST extraction is `:1372` |

---

### 11.2 Round-3 findings — the work list for round 4

Round 3's fixes are **not** withdrawn: the reviewer independently confirmed 15 of 18 round-2 findings
resolved and confirmed the D4 = A rewrite closes N1 by construction. What follows is new.

**Verification status.** The round-3 session re-checked V1, V2, V3, V5, V7 and V8 against source
before recording them — including **executing** V3's counterexample. All six reproduce. V4, V6, V9,
V10, V11 are recorded as cited but **not yet independently re-derived**; round 4 must verify them
before amending, per this document's standing rule.

| # | Sev | Category | Citation | Finding |
| --- | --- | --- | --- | --- |
| **V1** | MAJOR | **security** | `netlify/functions/consolidation-scheduler.mjs:72-73`, used `:146`; vs. this artifact §3.2, S10.4, §9 R9 | **"There is no machine-credential mint path" is false.** `signServiceJwt` mints `{sub, role: 'service'}` with `SESSION_SECRET` — **verified by reading source**. It carries no `type`, so it classifies `legacy_session` (fail-closed, so not a live exploit). But three passages rest the N14 cost-argument on that premise, and **D3 was ratified on it**. S1's "bar a future machine credential" rationale is also weaker than stated when a present one is unenumerated |
| **V2** | MAJOR | completeness (security-adjacent) | `hub/lib/local-auth.mjs:179-192`, called `:401`, mounted `hub/gateway/server.mjs:97` **and** `hub/server.mjs:202` | **A fifth learner-session mint site.** `issueLocalToken` mints the exact web-session shape `{sub: 'local:…', provider, id, name, role}` on interactive sign-in — **verified by reading source**. Unstamped, every local-auth / offline-locked session is `legacy_session`, so after T5 those users' seam self-apply refuses permanently and silently — precisely the failure N9 was raised to prevent. **Third consecutive round in which an enumeration declared exhaustive was not** (F2 → N9 → V2). Note the operator's ratified D1 wording says "all mint sites", which already covers this |
| **V3** | MAJOR | consistency | this artifact S6.1 "No live behavior change", and §2.1's justification | **Disproved by execution.** A proposal carrying the review-tray fingerprint **and** `knowtation_proposal_source` + `task_proposal_kind` satisfies `matchesScoolingReviewTrayFingerprint` **and** S3.1 condition #1; `isPersonalSelfApplyClass` returns **`true`** today and would refuse under S6.1 — the boolean flips. Reachable: frontmatter is client-controlled on the canister proposals-POST (`hub/icp/src/hub/main.mo:1371`) and returned by the GET serializer (`:1156`). Fail-closed in direction, so not a hole — but it is a **live notes-tray regression**, the one thing S2.4 / §9 R3 promise cannot happen. Root cause: §2.1 argues from `intent`, and D4 = A made classification intent-independent; §2.1 was never updated |
| **V4** | MAJOR | consistency | this artifact §9 "Nothing else." vs. S6 and §7 tier 2 | S6 requires the four seam codes to be HTTP-visible at `hub/gateway/server.mjs:3116-3120`, but §9's exhaustive table stops at `:3102-3111`. An Auto build honoring "Nothing else." literally **cannot** make any seam code HTTP-visible on the hosted path |
| **V5** | MAJOR | completeness | `lib/hub-proposal-personal-self-apply.mjs:171-173`, called `hub/gateway/server.mjs:3103`, `hub/server.mjs:476` | **The function both approve gates actually call — `personalSelfApplyAllowsApprove` — appears zero times in this artifact** (verified: `rg -c` returns 0). It is a boolean wrapper, and nothing says how a refusal *code* traverses it to reach the HTTP layer. Auto must invent that: change the wrapper, bypass it, or add a parallel call. **An open design decision inside a freeze** |
| **V6** | MAJOR | completeness | this artifact S10.1 vs. §7 tier 7b | S10.1 freezes "parsed into a `Set` **once at module load**"; tier 7b requires unset / `''` / `',, '` exercised in one run. Not buildable together without a seam the freeze does not specify. Sits on the branch D3 makes the one that actually ships |
| **V7** | MAJOR | completeness (security-adjacent) | `hub/gateway/server.mjs:1049`; `hub/bridge/task-routes.mjs:351`; `hub/bridge/delegation-routes.mjs:181` | **The correspondence table's exhaustiveness claim is wrong** — **verified**: two further `apply-approved` routes exist. Both require the proposal to be already `approved`, so the approve-time gate still stands and **this is not a self-apply bypass**; the defect is that G30 searched for *hooks*, not *apply triggers*, and S7.6 builds a future-surface obligation on that enumeration |
| **V8** | MAJOR | completeness | `hub/server.mjs:3056`, `:3064`, same handler guarded by `requireApproveRole:467-491`; `~/scooling/src/adapters/flowHubTransport.ts:983`, `:1043`, token `:1119` | **Flow and flow_capture are apply-bearing, self-apply-gated, and absent from this freeze** — **verified**: the self-hosted approve route fires **five** applies, not three. Scooling drives flow creates over the same shared env token — the identical P3 shape. At T5 a flow proposal would be self-appliable and unbound by S2. Needs either inclusion in S3.1 or an explicit reasoned exclusion (**operator scope decision — see D5**) |
| **V9** | MINOR | consistency | this artifact S6 code table | `SELF_APPLY_INTENT_NOT_ELIGIBLE` names a concept S3.0 abolished, and covers two structurally different refusals the operator cannot distinguish in logs |
| **V10** | MINOR | completeness | this artifact S3.1 import-safety vs. §9 and S6.1 step 1 | The cycle check covers the three predicate modules but not the new `lib/**` → `hub/gateway/**` edge S10 introduces, which also drags gateway code into the self-hosted server |
| **V11** | MINOR | other | `hub/gateway/server.mjs:2953-2962`, `:2972-2978` vs. S2.1 | `sessionBound` is unspecified when the resolved payload is `null`. The reviewer records honestly that it could not construct a *reachable* null, since `getUserId` requires a verifiable bearer under the same secret — a spec gap, not a demonstrated defect |

**Undisclosed risk the reviewer names, and it is the sharpest observation in the round.**
`normalizeCanisterProposalForTaskPrecheck` was written as an *enabling* predicate ("does this row have
enough metadata to apply?"). S3.1 reuses it as a *restricting* one. The two purposes pull in opposite
directions: a future change making the normalizer more permissive, in order to apply more rows, also
silently pulls more proposals — **including review-tray ones** — into the seam refusal branch. That
is the mechanism behind V3. **Round 4 extended §9 R10** to state this explicitly and accepted it
under D4 = A (fail-closed overlap), with tier-7 overlap tests as the build-time tripwire.

### 11.3 Round-4 resolutions (V1–V11)

| # | Resolution |
| --- | --- |
| **V1** | §3.2, S10.4, §9 R9, §3.4 rewritten: `signServiceJwt` enumerated (G35); "no machine-credential mint path" withdrawn; D3 empty-list outcome unchanged; cost of listing the human `sub` restated accurately |
| **V2** | S1.1 expanded to **five** learner-session mint sites including `issueLocalToken` (G36); mounts cited at call sites `:510` / `:625` |
| **V3** | §2.1 and S6.1 rewritten from execution: honest notes unchanged; overlap flips fail-closed; absolute "no live behavior change" withdrawn; R10 extended |
| **V4** | S9 table now includes `hub/gateway/server.mjs:3116-3120` and `hub/server.mjs:486-490` for S6.2 HTTP seam codes |
| **V5** | New S6.2 freezes `personalSelfApplyAllowsApprove` + reason→HTTP traversal at both call sites |
| **V6** | S10.1 + §7 tier 7b: pure `parseSelfApplyIneligibleSubs` for empty-env cases; module-load Set for production |
| **V7** | G37 + correspondence table: post-approve `apply-approved` routes recorded; not a self-apply bypass; approve-time coverage complete |
| **V8 / D5** | **D5 = A** — S3.1 conditions #6/#7 (`FLOW_PROPOSAL_SOURCE` / `FLOW_CAPTURE_PROPOSAL_SOURCE`); G32–G34 |
| **V9** | `SELF_APPLY_INTENT_NOT_ELIGIBLE` deleted; replaced by `SELF_APPLY_DELEGATION_REFUSED` + `SELF_APPLY_NOT_ADMITTED` |
| **V10** | S10 parser lives under `lib/`; self-apply must not import `hub/gateway/**`; import-safety + S9 updated |
| **V11** | S2.1: `sessionBound === false` when payload is `null`; `isSessionBoundActor(null) === false` |

### 11.4 Round-4 independent review — W1–W5 (addressed in round 5)

| # | Sev | Resolution |
| --- | --- | --- |
| **W1** | MINOR | S2.1 + S9 now require payload on `resolveHostedActorRole` main return `:3025` as well as `:2969` |
| **W2** | MINOR | Self-hosted import of `access-token-authz.mjs` for S1 helpers explicitly authorized; module verified side-effect-free |
| **W3** | MINOR | Admission frozen empty this phase; step 11 unconditional seam refusal; no admission input/env/allowlist in `SEC-SEAM-1b` |
| **W4** | MINOR | §3.4 + S9: `docs/ROADMAP.md:49` already has the disclaimer; closing commit = status refresh + D2 media row |
| **W5** | MINOR | G19.5 + S4.2 record Paperclip `hub-client.mjs:65` sending `X-User-Id`; inert; out of scope to remove |

---

## 12. Operator decisions required before SEC-SEAM-1b (escalated)

Per `.cursor/skills/freeze-review-loop/SKILL.md`, `security`-category items stop the loop for a human.
**This session does not ratify either decision.** A general "proceed" is not a selection (SEC-KN-4a
round 2 precedent); the operator must name an option.

### D1 — `security` — stamp a session class claim on minted JWTs?

Adding `type: 'session'` touches the live authentication mint path (G3, G4).

- **Option A (recommended).** Stamp the claim at both mint sites; treat absent `type` as
  `legacy_session` — accepted for propose, ineligible for self-apply. Additive and backward
  compatible: verification never requires the claim (S1.5), so no existing token breaks. Buys the
  ability to bar a future dedicated machine credential by name.
- **Option B.** Do not touch the mint path. `sessionBound` then means only "not `mcp_access` and not
  an unknown payload", which is nearly vacuous — S2's author-equals-approver clause and S10 carry the
  whole rule, and a future machine credential could not be distinguished from a learner session by
  class.
- **Option C** (added after freeze review round 1, F13). Do not touch the mint path, and rely on
  **S10** to bar named subjects instead. This delivers most of what option A is wanted for — a
  future machine credential can be barred by `sub` the day it is created — without changing live
  authentication at all. It is weaker than A only in that it is per-subject and operator-maintained
  rather than by-construction.

**Recommendation: A, with C as the low-risk alternative.** A is additive and backward compatible
(S1.5), and it is the only option where a machine credential is ineligible *by construction* rather
than by an operator remembering to list it. Choose C if touching the authentication mint path is not
acceptable in this phase; S10 ships either way, so C is not "do nothing".

### D2 — Tier 2 — media surface disposition

Hosted media proposals have no route (G17, G18); self-hosted media propose requires `editor`/`admin`
(`hub/server.mjs:1304`) while task propose is `viewer`-inclusive (G16).

- **Option A (recommended).** Keep media out of scope; record the gap (S7) and open a roadmap row for
  a hosted media proposal surface. `SEC-SEAM-1b` ships without it.
- **Option B.** Expand `SEC-SEAM-1b` to build the hosted media route. This is new-surface work inside
  a security-remediation phase and would need its own freeze.

**Recommendation: A.**

### D3 — operational input — which subject backs the shared token?

S10 is inert until the operator names a subject. Knowtation cannot derive it: the `sub` behind
`KNOWTATION_AUTH_TOKEN` is a Scooling-side operator account, and this session deliberately did not
inspect the secret (§10).

The operator must supply the `sub` value(s) for `HUB_SELF_APPLY_INELIGIBLE_SUBS` — or state that the
list starts empty and S10 ships as a dormant control. Setting the variable in production is Tier 3
(gate T3). **Do not** put a token, secret, or any credential material in this list or in this
document; the value is an account identifier of the form `provider:id`.

### D4 — where seam enforcement lives (raised by round-2 N1 — decide before any fix round)

N1 proved that a *parallel* field list cannot classify seam proposals safely: classification read
`frontmatter.proposal_kind` while the task apply hook dispatches on
`frontmatter.knowtation_proposal_source` / `proposal.source` / the `meta/tasks/proposals/` path and
takes its kind from `frontmatter.task_proposal_kind` → `task_meta.proposal_kind` → `body.proposal_kind`
(`lib/task/task-hosted-proposal.mjs:85-156`). Any list this artifact writes by hand can drift from the
list the effect honors, and the gap between them **is** the evasion. Three ways out:

| Option | Shape | Trade-off |
| --- | --- | --- |
| **A — reuse the effect's own predicate** | `isSeamSurfaceProposal` calls `normalizeCanisterProposalForTaskPrecheck(p) != null` for tasks, the delegation marker predicate for delegation, and the media equivalent — no hand-written field list at all | Single source of truth: a proposal that can trigger the apply is by construction classified seam. Requires one predicate per surface to exist and be import-safe from the self-apply module |
| **B — move enforcement to the apply hooks** | Leave classification alone; make each apply hook refuse when the approve was self-applied by a non-session-bound actor | Enforces exactly where the effect happens, so drift is impossible. But the proposal is already `approved` on the canister when the hook runs — refusal leaves approved-but-unapplied state, and the media/delegation hooks may not have a comparable choke point |
| **C — both** | A for classification, B as defence in depth | Most robust; largest diff, and B's partial-state problem still needs an answer |

**Recommendation: A**, and treat "no hand-written seam field list may exist in the built code" as a
frozen rule so the next drift cannot reappear. A also dissolves N3 and N4, and makes N10's
self-hosted shape question moot for tasks, because the normalizer already handles both shapes.

This is a design decision that changes S3 substantially, which is why the loop stopped here instead of
rewriting S3 a second time inside a review round.

### D5 — scope — are Flow and Flow-capture seam surfaces? (raised by round-3 V8)

**RATIFIED as option A** (§12.1). Round 4 read `lib/flow/**`, executed the forgeability check, and
recommended A before asking; the operator selected A explicitly.

The self-hosted approve route fires **five** index applies (G32): flow (`hub/server.mjs:3056`) and
flow_capture (`:3064`) sit beside task, delegation and media on the same handler, behind the same
`requireApproveRole` self-apply gate (`:467-491`). Scooling drives flow proposal creates over the
**same shared env token** (`~/scooling/src/adapters/flowHubTransport.ts:1119` — G34). A forged
fingerprint on `source: 'flow'` is self-applicable today (executed). Under D5 = A, S3.1 conditions
#6 and #7 bind those surfaces with the same `proposal.source === …` expressions the apply path uses.

| Option | Shape | Trade-off |
| --- | --- | --- |
| **A (ratified)** | Add flow + flow_capture as S3.1 conditions #6 and #7 (`proposal.source === FLOW_PROPOSAL_SOURCE` / `FLOW_CAPTURE_PROPOSAL_SOURCE`) | Closes the gap now, S3.0-compliant (same dispatch field). Widens the phase; ground truth G32–G34 recorded |
| **B (not selected)** | Exclude explicitly, with a stated reason and a §9 residual risk, and a roadmap row before T5 | Would have kept the freeze narrower at the cost of leaving an apply-bearing, self-apply-gated P3 surface unbound by S2 until a later row |

**Why B was offered at all.** Round 3 had not read the flow write path and correctly refused to guess
a security scope boundary. B is the scope-brake for that state: freeze what was reviewed, track the
gap, hard-gate T5 on closing it. After round 4's ground-truth pass, B would only re-open a known
hole; A is the recommendation and the selection.

### D3 — reopened by round-3 V1 (the ratified premise is false) — DISCLOSED

**This was not a request to re-ratify; it is a disclosure.** D3 was presented with the warning that
S10 "cannot be used without cost" because the shared token belongs to a human operator account and
**"there is no machine-credential mint path"**. V1 disproved that premise from source: `signServiceJwt`
(`netlify/functions/consolidation-scheduler.mjs:72-73`) mints a `role: 'service'` JWT with
`SESSION_SECRET` (G35).

The operator's selection — start empty, ship S10 dormant — is **unaffected in outcome**: an empty
list has the same effect either way, and a service JWT is already self-apply-ineligible under S1
because it carries no `type` claim. Round 4 corrected §3.2, S10.4 and §9 R9 so the cost argument for
listing the human `sub` is accurate before T3 ever populates the list.

### 12.1 Ratification record

**RATIFIED 2026-07-27 — D1–D4** by explicit operator selection in the round-3 fix session (four-question
prompt that named each option). **RATIFIED 2026-07-27 — D5 = A** by explicit operator selection in
the round-4 fix session after a grounded recommendation (not a bare "proceed").

| Decision | Operator selection (verbatim) |
| --- | --- |
| **D1** | *"A (freeze's recommendation) — stamp the claim at all mint sites; absent type is treated as legacy_session: accepted for propose, ineligible for self-apply. Additive and backward compatible; a future machine credential is ineligible by construction"* |
| **D2** | *"A (freeze's recommendation) — keep media out of scope, record the gap as S7, open a roadmap row for a hosted media proposal surface. SEC-SEAM-1b ships without it"* |
| **D3** | *"Start empty — S10 ships as a dormant control, no subject named yet. Avoids the N14 side effect; the list can be populated later (setting it in production is Tier 3 gate T3)"* |
| **D4** | *"A (freeze's recommendation) — classification reuses the effect's own predicate (normalizeCanisterProposalForTaskPrecheck + per-surface siblings); no hand-written seam field list may exist in built code. Also dissolves N3, N4, most of N10"* |
| **D5** | *"D5 = A — include flow + flow_capture in S3.1"* |

**Scope of this ratification.** It authorizes the **`SEC-SEAM-1b` code build only**. Tier-3 gates
**T1–T5 (§8) remain unexecuted and unauthorized** — in particular T3 (setting
`HUB_SELF_APPLY_INELIGIBLE_SUBS`, or any seam env flip, in production) and T2 (merge / `muse-mirror`
pull request). Ratification is **not** freeze clearance: `SEC-SEAM-1b` may not start until §11 records
an independent reviewer verdict of `pass`.

**D3 consequence, recorded explicitly.** `HUB_SELF_APPLY_INELIGIBLE_SUBS` ships **empty**. S10 is
therefore a **dormant control in this phase** — it bars nobody until an operator populates it, which
is Tier 3 (T3). Every claim in this document about S10 "closing" the shared-identity case is
conditional on that population and is qualified as such (S10.4, §3.2, §9 R9 — see N14 / V1).

**Governance note (preserved deliberately).** A general instruction to proceed is **not** a
selection, and an authoring session may never ratify its own escalations
(`docs/SEC-KN-4-DELEGATION-PRINCIPAL-BINDING-FREEZE.md:504-509`). Round 3 opened with the
paste-ready prompt in `docs/OVERSEER-HANDOVER.md` whose text read "fix N1 per D4 option A".
That clause was **prior-session authorship** and was **not** treated as ratification. Round 4
likewise obtained an explicit D5 selection before touching S3.1 scope.
