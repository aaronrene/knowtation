# Overseer Handover — Knowtation

**Living relay for Knowtation-owned work.** Paste the **NEXT SESSION** block into a fresh chat to
resume without prior history.

**Authority split (changed 2026-07-26).** This file is **no longer a thin pointer**. Knowtation now
has the Overseer Kit installed and owns its own security/authorization board
(`docs/ROADMAP.md`). Cross-repo **product order** still lives on the Scooling board
(`~/scooling/docs/OVERSEER-HANDOVER.md` + `~/scooling/docs/ROADMAP.md`). When the two disagree about
**product sequencing**, Scooling wins. When they disagree about **Knowtation's own authorization
behavior**, this board wins.

**Why this changed:** the independent Pass 2 security audit
(`~/scooling/docs/PRE-BUILD-SECURITY-AUDIT-FINDINGS-PASS2.md`, verdict `findings`) put **7 of 11
code-level findings in Knowtation**. Knowtation was doing the highest-risk work with no governed
roadmap, no freeze review, and no build-verification gate.

---

<!-- overseer:next role=owner lane=security status=live product_order=scooling -->
## NEXT SESSION — SEC-KN-P6-ROTATE-b (deploy EC2 → dual-secret rotation)

**Date:** 2026-08-01  
**Model:** **Operator + Auto**

**Why this is next:** SEC-KN-P6-ROTATE-a freeze is **CLEARED**
(`docs/SEC-KN-P6-ROTATE-FREEZE.md`, freeze-review `pass`, digest `sha256:958c8add…`).
Decisions frozen: **D1 one signing domain** (gateway + bridge + MCP; naive MCP split
rejected — README §Post-deploy #3 + cross-host agent JWTs); **D2 deploy-before-rotate**.
Board correction: SEC-KN-3 tip is an **ancestor of Muse `main`** (stale "not merged"
row fixed). EC2 runtime is **pre-current-main** — identical Phase C `agent_access`
token → gateway discard `401`, MCP discard `200` (evidence:
`docs/reviews/2026-08-01-sec-kn-p6-rotate-ec2-code-divergence.md`). Share remains
**VERIFIED-SHARED**. No secret rotation / env flip / deploy ran in Thinking.

> Hub dashboard UI redesign is **not** this baton — that lane lives in
> [`HUB-UI-HANDOVER.md`](./HUB-UI-HANDOVER.md) + [`HUB-UI-ROADMAP.md`](./HUB-UI-ROADMAP.md).

### THE ONE NEXT STEP — **execute the frozen P6 rotate runbook** — **Model: Operator + Auto**

```text
Step: SEC-KN-P6-ROTATE-b
Model: Operator + Auto
Authority: knowtation

Consume docs/SEC-KN-P6-ROTATE-FREEZE.md (frozen: true, review pass) as ground truth.
Execute D2 order: R1 deploy current main to EC2 MCP host (Tier 3 / T1) → R2 role-cap
probe (§5.1 must not see MCP 2xx on agent_access discard) → R3 implement P6-C1–C5
dual-secret verify helper + seven-tier tests → BV pass → R4–R5 operator Tier-3 dual-secret
env rotation (T2) across gateway+bridge+MCP with drain window. Keep ONE signing domain
(D1). No secret split. No approve of real pending proposals. No posture/env flips beyond
SESSION_SECRET / SESSION_SECRET_PREVIOUS. F7 AWS-parked. SD-14: muse-mirror only to GitHub main.
```

### After this (queued order)

1. SEC-SEAM-MEDIA (Thinking → Auto) — still TODO, not urgent (no hosted media route exists).
2. MuseHub F7 — AWS-parked.

### This session — SEC-KN-P6-ROTATE-a DONE (freeze pass, 2026-08-01)

Thinking on `feat/sec-kn-p6-rotate` (ff-merged `feat/sec-kn-p6-verify` first). Wrote
`docs/SEC-KN-P6-ROTATE-FREEZE.md` (`frozen: true`). Freeze-review loop: mechanical C4
rewrites → semantic expand G10 `jwt.verify` wire-up + D2 ordering → `ok review --freeze`
**pass** (`sha256:958c8add…`). Top input resolved: SEC-KN-3 **on main**; EC2 **behind**
(discard 401 vs 200). No T1–T4. Evidence sidecar:
`docs/reviews/2026-08-01-sec-kn-p6-rotate-ec2-code-divergence.md`.

### Prior this session — SEC-KN-P6-VERIFY DONE (Outcome B, evidence-only, 2026-08-01)

Operator + Auto, read-only. Resolved the P6 `SESSION_SECRET` share carried UNVERIFIED
since 2026-07-26. **Hosts proven distinct** first (Netlify `server: Netlify`+`x-nf-request-id`
with CORS `Allow-Origin: https://knowtation.store`; MCP host `Server: nginx/1.24.0 (Ubuntu)`
HTTP/1.1 with CORS `Allow-Origin: https://knowtation-gateway.netlify.app`), ruling out a
reverse-proxy explanation. **Cross-acceptance probe:** minted one gateway-signed `agent_access`
JWT via `POST /api/v1/auth/agent/token` (credential from `~/.config/knowtation/agent_cred`,
never printed); `GET /api/v1/auth/session` → **200 on the gateway (control) AND 200 on the MCP
host (probe)**; garbage token → 401 and no-auth → 401 on the MCP host (controls).
**Verdict: SHARED (Outcome B)** → board marked **VERIFIED-SHARED**; opened **SEC-KN-P6-ROTATE**
(Thinking) — no improvised fix. **Optional `created_by` sidecar CONFIRMED:** `GET /api/v1/proposals`
returned 64; the 7 newest (post-SEC-KN-4) carry a server-derived `created_by` (`google:…`)
incl. `prop-1785500300353491755`; the older 57 are empty by design. No posture/env flip, no
rotation, no deploy, no GitHub PR. Probes archived: `scripts/archive/2026-08-01-*.mjs`.

### This session (later) — SEC-KN-4c LANDED (operator Tier 3, 2026-08-01)

Operator authorized the Tier 3 land in-session. `muse checkout main` +
`muse merge feat/sec-kn-4c-land` → **fast-forward `4179ed46… → 2466ad64…`** (8 files).
Suites re-run on `main`: `test/sec-kn-4c-migration-hook-restore.test.mjs` **11/11**,
SEC-KN-4 **31/31**, `canister:verify-migration` exit 0. Mirrored via
`muse-bridge-deploy` → GitHub `muse-mirror` → `main` PR (SD-14 path; merge SHA in the
change log). No `dfx deploy`; live hash `0x039360a0…` still the T4 module. Board
residual is now only: P6 MCP/`SESSION_SECRET` share (NEXT), optional `created_by`
probe, SEC-SEAM-MEDIA, F7 (parked).

### Earlier this session — SEC-KN-4c-b Auto land code DONE, BV round 1 pass (2026-08-01)

Auto on fresh `feat/sec-kn-4c-land` (freeze §4 option B; the 2026-07-28
`feat/sec-kn-4c-identity-migration` branch was 73 files behind main, so only the
in-scope delta came forward). One Muse commit `ec1e80b3…`: identity
`Migration.migration` on `StableStorage` + post-T1 header invariant (4C-R1–R4,
`hub/icp/src/hub/Migration.mo:455-457`), verify-script contract flips (4C-R5),
SEC-KN-4 unit assertion flipped off `TODO(SEC-KN-4c)` with title rename (4C-R6),
new seven-tier suite `test/sec-kn-4c-migration-hook-restore.test.mjs` **11/11**
(unit/integration/e2e/stress/data-integrity/performance/security incl. scrubbed-env
`dfx build --check hub`), SEC-KN-4 **31/31**, `canister:verify-migration` exit 0.
4C-R8 honored: live `dfx canister --network ic info rsovz-byaaa-aaaaa-qgira-cai` →
`Module hash: 0x039360a0985c79e2ec993e0d0b81dc6e6b85e4d924c1123f5d1af26cdfd69bae`
(exact frozen match); `/health` → `{"ok":true,"gateway_auth_configured":true}`;
**no deploy run**. BV round 1 = **`pass`** by an independent verifier subagent
(`docs/reviews/2026-08-01-sec-kn-4c-b-bv-round1-pass.md`; re-ran all evidence and
re-read the live hash itself). No posture/env flips; F7 untouched; P6 untouched; no
GitHub PR opened. Untracked leftovers (`docs/KNOWTATION-ROADMAP.md`,
`backups/pre-t1-snapshot-20260728T205623Z/`) intentionally left per 2026-07-31 note.

### Prior session — 9-kn-c + 9-kn-d landed; 9-apply verified live; hygiene (2026-07-31)

Operator + Auto. **9-kn-c** blob persistence landed (muse-mirror PR #284, green CI) and
**9-kn-d** warm-lambda stale merge landed (muse-mirror PR #285, green CI); both
live-verified — approve of `prop-1785528026964024269` auto-applied via the CHA-C1 hook
(`flow_cap_ca8f2945`), CHA-C5 confirmed both sides. Regression suite
`test/capture-store-blob-persist.test.mjs` **14/14** (pre-fix 7/11 then 3/14 fail).
Token churn ended: durable `kt_agent_` credential at `~/.config/knowtation/agent_cred`;
`scripts/verify-agent-credential-smoke.mjs` now tracked (live **PASS** — exchange +
vaults + notes read; default vault aligned to credential scope `default`). GitHub-only
UI-change audit: muse-mirror and GitHub main tree hashes identical in both Knowtation
(`8ef5f536…`) and Scooling (`6c5c531f…`) — the 2026-07-17 status-tips/product-pages UI
commits are already in Muse; nothing to sync. Untracked leftovers intentionally not
committed: `docs/KNOWTATION-ROADMAP.md` (orphan from abandoned K13 rename) and
`backups/pre-t1-snapshot-20260728T205623Z/`.

### Prior session — CAPTURE-HOSTED-APPLY-KN-b DONE (2026-07-31, BV round 1 pass)

Auto on `feat/flow-capture-live`. BV round 1 = **pass**
(`docs/reviews/2026-07-31-capture-hosted-apply-kn-b-bv-round1-pass.md`,
`sha256:3b6a1e5a…`; independent verifier subagent — Claude thinking-high slugs were
API-limited, review ran on Grok 4.5 high, fresh non-build session). Implemented
CHA-C1–C11 exactly:

- **CHA-C1:** `hub/gateway/capture-approve-hosted.mjs` — `maybeApplyHostedCaptureAfterApprove`
  + `mergeCaptureApplyIntoApproveResponse`; called after the task hook in the approve
  success block of `hub/gateway/server.mjs`; failure is non-fatal to approve status and
  surfaces `capture_index_applied: false` + `capture_apply_error/_code`.
- **CHA-C2/C3/C10:** `lib/flow/flow-capture-hosted-apply.mjs` —
  `applyApprovedCaptureProposalFromCanister` (sibling module to avoid the
  flow-capture → proposals-store → self-apply → hosted-proposal load cycle); reuses
  shared `precheckApprovedCaptureProposal` + `applyCaptureProposal`; canister `body`
  kept intact; 400 non-capture / 409 non-approved / precheck refusal passthrough.
  Bridge route `POST api/v1/flows/capture/proposals/:proposal_id/apply-approved` in
  `hub/bridge/flow-capture-routes.mjs` wrapped in `withExternalProtocolBlobSync`
  (hydrate-before-precheck for cold lambdas; persist after apply).
- **CHA-C5:** bridge `GET api/v1/flows` + `GET api/v1/flows/:id`
  (self-hosted `handleFlowListRequest`/`handleFlowGetRequest`, blob hydrate before
  read, registered after `flows/candidates`); gateway proxies registered after
  projection/external-grants/candidates and before the canister catch-all.
- **CHA-C4:** no T5 change — `lib/hub-proposal-personal-self-apply.mjs` untouched;
  capture stays `SELF_APPLY_NOT_ADMITTED` (regression-tested).
- **CHA-C6:** `docs/PROPOSAL-LIFECYCLE.md` Wave 2 subsection now states Hub-complete
  approve applies (promote/merge/dismiss) while T5 stays refuse-all; “propose-only”
  clarified; media hosted apply still absent.
- **Tests:** `test/capture-hosted-apply-kn-b.test.mjs` seven tiers **15/15**;
  `flow-capture-live-kn-b` + capture/gateway/T5 suites re-run green; full repo suite
  4281/4285 pass with 3 pre-existing perf-budget flakes (calendar oauth, flow-authoring
  p95, flow-store step-keying p95) that pass standalone — unrelated to this diff.
- **Hard stops honored:** no T5 admission; no `FLOW_CAPTURE_*` env/posture flip;
  `prop-1785500300353491755` not approved; no GitHub PR.

### Prior session — CAPTURE-HOSTED-APPLY-a freeze pass (2026-07-31)

Thinking on `feat/flow-capture-live`: froze `docs/CAPTURE-HOSTED-APPLY-FREEZE.md`
(CHA-C1–C11). Freeze-review loop R1 findings fixed (abs-path citation; body-intact
precheck; approve-then-hook asymmetry); round 2 + `ok review --freeze` = **pass**
(`sha256:6db36223…`). No product code / env / posture flip. NEXT = **9-kn-b Auto**.

### Prior session — CAPTURE-APPLY-CHECK on Scooling found hosted gap (2026-07-31)

Scooling tip `sha256:f5f2a53d…`: 9-apply verified T5 capture refuse-all (KN-b
**13/13** re-run) + PLAIN-LANG capture copy (**67/67**) + no Scooling-side apply
path, then **BLOCKED** on the missing hosted capture apply hook. No approve
performed; no posture/env flip. Between relay refreshes, Scooling also completed
HOSTEDb (DONE 2026-07-30), flip (DONE 2026-07-30), FLOW-CAPTURE-LIVE-SMOKE
(**PASS** 2026-07-31, created `prop-1785500300353491755`), and PLAIN-LANG-a/b
(DONE 2026-07-31). Knowtation relay refreshed this session. Product NEXT =
**9-kn-a CAPTURE-HOSTED-APPLY-a** (Thinking, this repo).

### Prior session — FLOW-CAPTURE-LIVE-HOSTEDa freeze pass on Scooling (2026-07-30)

Scooling tip `sha256:6499d790…`: `docs/FLOW-CAPTURE-LIVE-HOSTED-FREEZE.md`
freeze-review `pass` (`sha256:f01e9c5b…`); FCH-C1–C8; no posture/env flip.
Knowtation relay only. Product NEXT = **FLOW-CAPTURE-LIVE-HOSTEDb**.

### Prior session — FLOW-CAPTURE-LIVEb DONE on Scooling (2026-07-30)

Scooling tip `sha256:3eedc438…`: factory select live capture + FCL-C9 honesty +
`/flows` gates; postures false; BV `pass`. Knowtation relay only. Product NEXT was
**FLOW-CAPTURE-LIVE-HOSTEDa** (now DONE).

### Prior session — FLOW-CAPTURE-LIVE-KN-b DONE (2026-07-30)

Knowtation Auto on `feat/flow-capture-live`: T5 non-admission regression for
promote/merge/dismiss; gateway→bridge capture proxies; bridge
`registerBridgeFlowCaptureRoutes` + `createCaptureProposalOnCanister`;
PROPOSAL-LIFECYCLE Wave 2 note; seven-tier **13/13**; BV round 1 = `pass`.
No capture env ON; no T5 admit. NEXT = **FLOW-CAPTURE-LIVEb** (Scooling Auto).

### Prior session — FLOW-CAPTURE-LIVEa freeze pass on Scooling (2026-07-30)

Scooling Muse `sha256:29a8720da…`; freeze `pass` (`sha256:f0ca2edd…`); SD-23;
NEXT was FLOW-CAPTURE-LIVE-KN-b (now DONE).

### Prior session — Scooling NEXT reassessed (2026-07-30)

Scooling tip `sha256:056b11031…`: 0.7b confirmed DONE; NEXT → FLOW-CAPTURE-LIVEa;
F7 AWS parked. This relay refreshed.

### Prior session — KIT-PRESERVE land DONE (2026-07-30)

Kit Muse/`main` `sha256:746fa8e3…` + [OK #47](https://github.com/aaronrene/overseer-kit/pull/47)
@ `302549e`. Scooling board 0.7b → DONE. No Knowtation product code that turn.

### Prior session — Operator land L-SC DONE on Scooling (2026-07-29)

Scooling SD-21: Muse FF → `main` (`sha256:531a4243…`); muse-bridge; SC #230
@ `efc84a8` + SC #231 land docs. No Knowtation product code.

### Prior session — SEC-REMEDIATION L-SC DONE on Scooling (2026-07-29)

Scooling Auto: P5/P10/P11/P15; seven-tier **18/18**; BV `pass` on
`feat/sec-remediation-l-sc`. No Knowtation product code. NEXT was **Operator land
L-SC** on Scooling board.

### Prior session — LAB-LIVE-SMOKE PASS on Scooling (2026-07-29)

Scooling Operator + Auto: local Lab fixture dry-run PASS; CONFLICT-adopt for
pre-approved Wave 1 fixture; BV `pass`; prod Lab env unset. No Knowtation
product code. NEXT was **SEC-REMEDIATION L-SC (0.8b)** on Scooling board.

### Prior session — LAB-LIVE-flip on Scooling (2026-07-29)

Scooling Operator + Auto: posture `true` only; seven-tier `lab-live*` **33/33**;
BV `pass`. Prod Lab env unset. No Knowtation product code. NEXT was
**LAB-LIVE-SMOKE** on Scooling board.

### Prior session — LAB-LIVEb Auto + BV pass on Scooling (2026-07-29)

Scooling Auto: double-lock + honesty + fixture pin; seven-tier **20/20**;
BV `pass`. No Knowtation product code. NEXT was **LAB-LIVE-flip** on Scooling board.

### Prior session — LAB-LIVEa freeze pass on Scooling (2026-07-29)

Scooling Thinking: freeze-review loop → **pass**; SD-22. No Knowtation
product code. NEXT was **LAB-LIVEb** on Scooling board.

### Prior session — §FWL.9 FLOW-WRITE-LIVE-SMOKE PASS (2026-07-29)

Scooling Operator: signed-in `/flows` personal draft after bridge
`FLOW_AUTHORING_WRITES` redeploy → Flow saved / applied /
`prop-1785355841721526922` / canonical write yes. GATEWAY-PROXY + env path
proven. NEXT = **LAB-LIVEa** on Scooling board.

### Prior session — FLOW-WRITE-LIVE-GATEWAY-PROXY DONE (2026-07-29)

**Model:** Auto · Branch `feat/fwl9-smoke-fail-gateway-gap`

Gateway proxies `POST /api/v1/flows`, `…/:id/proposals`, `…/import` → BRIDGE_URL;
bridge `registerBridgeFlowRoutes` + `createFlowProposalOnCanister`; seven-tier
**12/12**; BV round 1 = **`pass`**
(`docs/reviews/2026-07-29-flow-write-live-gateway-proxy-bv-round1-pass.md`).
No capture/run/Delegation flip; no `FLOW_AUTHORING_WRITES` flip this session.

### Prior session — §FWL.9 SMOKE FAIL recorded on Scooling (2026-07-29)

Operator smoke: prod `/flows` signed-in draft → `unknown_flow`. Gateway gap in
`hub/gateway/server.mjs`. No Knowtation env flip that turn.

### Prior session — Knowtation PRODUCT RELAY refresh (2026-07-29)

Synced to Scooling PRIMARY tip_hash `sha256:38c2305e…` after draft-500 land SC #226.
SD-21 land-hygiene + scooling-stack workspace restore recorded on Scooling board.

### Prior session — Scooling L-SEAMa freeze pass; Knowtation relay was stale

**Date:** 2026-07-27 · **Model:** Thinking (Scooling) → governance fix (this board)

Scooling L-SEAMa completed freeze-review `pass` and advanced its PRIMARY to **L-SEAMb Auto**.
This Knowtation handover still showed the old Thinking paste (L-SEAM C1–C4). That was **not**
an Overseer Kit install failure — the kit does not cross-update consumer handovers. Fix:
regenerate this NEXT block to relay L-SEAMb Auto.

### Prior session — governance sync: Overseer verified; NEXT → C1–C4 Thinking

**Date:** 2026-07-27 · **Model:** Auto

Operator asked to confirm Overseer live and point NEXT at C1–C4. Verified both repos with
`ok status --json` / `verify-overseer-live.sh`. Live HTTP: `api.knowtation.store/health` →
`{"ok":true}`; canister `/vaults` without gateway auth → `403 GATEWAY_AUTH_REQUIRED`.
Browser MCP: `knowtation.store/` landing loads (Sign in Google/GitHub visible). Production
CORS still advertises `X-User-Id` — expected until SEC-SEAM-1b deploys (not merged).

### Prior session — SEC-SEAM-1b Auto build + BV pass

**Date:** 2026-07-27 · **Model:** Auto (build) → thinking-high (BV)

Implemented S1–S10 against the cleared freeze: five mint stamps (`type:'session'`),
`resolveActorTokenClass` / `isSessionBoundActor`, seam classification via apply-path predicates
(S3.0; seven conditions incl. flow/flow_capture), `personalSelfApplyRefusalReason` + S6.2 HTTP
seam codes on both approve gates, S10 empty parser module, CORS `X-User-Id` advertisement removed,
PROPOSAL-LIFECYCLE S7/S8. Seven-tier **33/33**. BV round 1 = **`pass`**. T1–T5 unexecuted. No merge.

### Prior session — SEC-SEAM-1a rounds 4–7: D5 = A, freeze CLEARED

**Date:** 2026-07-27 · **Model:** Thinking

Operator selected **D5 = A** after a grounded recommendation from `lib/flow/**` (forgeability
executed). Fixed V1–V11, then W1–W5 / X1–X2 / Y1 through freeze-review-loop. Round-7 independent
reviewer = **`pass`**. Mechanical gate pass; stamp retained only after semantic clearance.
Opened roadmap row `SEC-SEAM-MEDIA` (D2). T1–T5 unexecuted. No merge.

### Prior session — SEC-SEAM-1a round 3: D1–D4 ratified, N1 closed, loop blocked at round 3

**Date:** 2026-07-27 · **Model:** Thinking

Opened by **refusing to treat the paste-ready prompt as a ratification.** That prompt said "fix N1 per
D4 option A", but it was written by the round-2 session itself, so acting on it would have been an
authoring session clearing its own escalation — the defect that reverted SEC-KN-4a §12.1. Stopped,
asked, and recorded four verbatim operator selections in freeze §12.1 before editing any rule.

Then fixed all 18 round-2 findings, verifying every citation against source first and correcting two
of the reviewer's own (N15 was inverted — the *audit row* is stale, not the justification; N18's line
number was off by one). Rewrote S3 around D4 = A: classification now calls the same predicate the
apply hook calls, with S3.0 forbidding any hand-written seam list. Reproduced the N1 evasion **and**
its fix by executing the predicates.

Round-3 independent review (`thinking-high`, fresh) = **`blocked`, 11 findings**, but it confirmed
15 of 18 round-2 fixes and confirmed N1 is closed by construction. Its three sharpest findings
disprove claims round 3 had asserted — see the NEXT block for V1/V2/V3. Loop halted for the operator
per the skill's `security`-and-`blocked` hard stops rather than attempting a fourth self-directed
round.

### Prior session — SEC-SEAM-1a freeze authored, loop blocked at round 2

**Date:** 2026-07-26 · **Model:** Thinking

Wrote the freeze (frozen inputs: ROADMAP, this file, Pass 2 P3, Scooling ROADMAP `L-SEAM`,
SEC-KN-4 freeze, PROPOSAL-LIFECYCLE). Verified against source rather than assumed: gateway JWT mint
sites, `X-Actor-Id` being server-set and client-injection blocked, `task_meta` **absent** from
canister proposal records while `frontmatter` is serialized, and Scooling's three transports
(`taskWriteHubTransport`, `mediaWriteHubTransport`, `delegationHubTransport`) all sending the shared
env token while `hostedReviewWriteBack` sends the learner's own session JWT — the contrast that makes
P3 real. Round 1 = `blocked` (14 findings, all fixed). Round 2 = `blocked` (18 findings, none fixed;
round 1's F3 and F13 fixes did not hold). Loop halted per
`.cursor/skills/freeze-review-loop/SKILL.md:28-36` because N1 escalates `security` and changes design.

### Prior session — SEC-KN-6 BV round 1 = pass

**Date:** 2026-07-26 · **Model:** Auto (build) → thinking-high (BV)

P14: `constantTimeTextEqual` (OR-of-XOR, full scan) replaces `got == expected` in both
`gatewayAuthorized` and `operatorExportAuthorized`. Seven-tier **18/18**; Motoko compile
verified; SEC-KN-1 still **19/19**. T1–T4 not executed.

---

<!-- overseer:next role=archived status=archived -->
## ARCHIVED SESSION — SEC-KN-6 build prompt

**Date:** 2026-07-26
**Model:** **Auto**

**SEC-KN-5 is DONE** (BV round 1 = `pass` on `feat/sec-kn-5-delegation-ttl-viewer-mint`).
Next: P14 constant-time secret compare in Motoko gateway auth.

**Branch:** open `feat/sec-kn-6-constant-time-secret-compare` (or continue on a feature branch). Muse feature-branch only.

```text
SEC-KN-6 — Auto: constant-time gateway auth secret compare.

Model: Auto.
Read docs/ROADMAP.md (SEC-KN-6 row) + docs/OVERSEER-HANDOVER.md.
P14: replace `==` after length check in hub/icp/src/hub/main.mo:919-939
(gateway auth + operator export) with a constant-time compare.
Seven-tier tests + security regression vs pre-fix; /build-verification-review before DONE.
T1–T4 remain unexecuted. No merge to main. No canister deploy.
```

### Prior session — SEC-KN-5 BV round 1 = pass

**Date:** 2026-07-26 · **Model:** Auto (build) → thinking-high (BV)

P12: `readVaultDelegationPolicy` clamps `max_ttl_seconds` to `MAX_TTL_SECONDS` (86400).
P13: self-hosted grant mint is `requireRole('admin')` only. Seven-tier + security
regressions green (**26/26** with route file; related delegation **64/64**).
T1–T4 not executed.

---

<!-- overseer:next role=archived status=archived -->
## ARCHIVED SESSION — SEC-KN-5 build prompt

**Date:** 2026-07-26
**Model:** **Auto**

**SEC-KN-3a is DONE** (BV round 1 = `pass` on `feat/sec-kn-4a-delegation-principal-binding-freeze`).
Next: P12 clamp vault-policy `max_ttl_seconds` + P13 restrict self-hosted grant mint to `admin`.

**Branch:** open `feat/sec-kn-5-delegation-ttl-viewer-mint` (or continue on current feature branch). Muse feature-branch only.

```text
SEC-KN-5 — Auto: clamp policy TTL + block viewer grant mint.

Model: Auto.
Read docs/ROADMAP.md (SEC-KN-5 row) + docs/OVERSEER-HANDOVER.md.
P12: clamp vault policy max_ttl_seconds to MAX_TTL_SECONDS (86400) in
lib/agent/delegation.mjs — currently accepts any value > 0, silently widening SD-10.
P13: restrict self-hosted grant mint to admin — hub/server.mjs currently allows viewer.
Seven-tier tests + security regression vs pre-fix; /build-verification-review before DONE.
T1–T4 remain unexecuted. No merge to main.
```

### Prior session — SEC-KN-3a BV round 1 = pass

**Date:** 2026-07-26 · **Model:** Auto (build) → thinking-high (BV)

Refreshed 4 stale `resolveHostedActorRole` source-shape assertions; isolated billing-repair DB
(no replica gate — false diagnosis). RBAC trio + SEC-KN-3 + billing-repair **82/82**.
T1–T4 not executed.

---

<!-- overseer:next role=archived status=archived -->
## ARCHIVED SESSION — SEC-KN-3a build prompt

**Date:** 2026-07-26
**Model:** **Auto**

**SEC-KN-4b is DONE** (BV round 2 = `pass` on `feat/sec-kn-4a-delegation-principal-binding-freeze`).
Next: fix the 4 stale `resolveHostedActorRole` source-shape assertions left by SEC-KN-3 so the full
suite can go green again (blocks frozen §7.2 DoD for later SEC phases). Also decide whether
`test/gateway-admin-billing-repair.test.mjs` should gate behind a replica-available guard.

**Branch:** continue on `feat/sec-kn-4a-delegation-principal-binding-freeze` or open
`feat/sec-kn-3a-rbac-assertion-refresh` — either is fine; keep Muse feature-branch only.

```text
SEC-KN-3a — Auto: refresh stale resolveHostedActorRole source-shape assertions.

Model: Auto.
Read docs/ROADMAP.md (SEC-KN-3a row) + docs/OVERSEER-HANDOVER.md.
Failing files: test/proposal-approve-rbac-fix-{data-integrity,security,unit}.test.mjs
(4 failures). They assert a pre-SEC-KN-3 shape of resolveHostedActorRole in
hub/gateway/server.mjs. Update assertions to match the post-SEC-KN-3 scope-capped
implementation; do not weaken SEC-KN-3's security properties.
Also: decide whether test/gateway-admin-billing-repair.test.mjs should skip/gate when
no canister replica is available (it hangs plain npm test).
Seven-tier not required if this is assertion-only hygiene; still run the three RBAC
files + sec-kn-3 suite green, then /build-verification-review before DONE.
T1–T4 remain unexecuted. No merge to main.
```

### Prior session — SEC-KN-4b BV round 2 = pass

**Date:** 2026-07-26 · **Model:** thinking-high

BV round 2 re-verified BV1–BV4, R1–R9, tests **31/31**, migration exit 0, Motoko compile verified.
One new MINOR (R5 docs `:245`) fixed in-session. SEC-KN-4b marked DONE. T1–T4 not executed.

---

<!-- overseer:next role=archived status=archived -->
## ARCHIVED SESSION — SEC-KN-4b build prompt

**Date:** 2026-07-26
**Model:** **Auto**

**SEC-KN-4a freeze is ratified.** The P4 contract is in
`docs/SEC-KN-4-DELEGATION-PRINCIPAL-BINDING-FREEZE.md` (`frozen: true`), the mechanical gate passes,
**two independent review rounds** ran, and the operator **ratified both escalated decisions on
2026-07-26** — recorded verbatim in freeze §12.1:

- **D1 (`security`) — RATIFIED, fail closed.** The canister must **never** fall back to `X-User-Id`
  when `X-Actor-Id` is absent. `X-User-Id` is `effectiveCanisterUid`, i.e. the workspace **owner**
  (`hub/bridge/delegation-routes.mjs:68`; `hub/bridge/server.mjs:698-736`), so a fallback would write
  the owner's derived principal into a consent the owner never authored — the same bug shape the fix
  exists to close. Store `""` and let apply refuse `DELEGATION_AUTHOR_UNVERIFIED`.
- **D2 (`irreversible`) — RATIFIED, one-shot hook.** Adding `created_by` makes the upgrade hook
  non-identity (`Migration.mo:8`), so a repeat deploy either fails compatibility or resets every
  author to `""`. **Exactly one** release may carry it; the next release restores identity — roadmap
  row `SEC-KN-4c`, freeze gate **T4**, to be scheduled in the same operator session as the T1 upgrade.

**Freeze review = `pass`** (round 3, 2026-07-26, recorded in freeze §11): C1–C8 all pass, nothing open
in an escalating category, implementable with zero design decisions left open. **Both preconditions
are met — the freeze is CLEARED for the 4b code build.** Still not authorized: T1 canister upgrade,
T2 any merge, T3 gate flip, T4 identity restore.

Design decision the build must respect:
the principal is re-derived from the **server-recorded proposal author**, never from the
authenticated actor at apply (freeze §3.1). Code on
`feat/sec-kn-4a-delegation-principal-binding-freeze`. **Not merged to main.**

```text
SEC-KN-4b — Auto: build P4 principal binding at apply + proposal authorship.

Model: Auto. PRECONDITIONS (both already met as of 2026-07-26 — re-verify, do not assume):
freeze §12.1 records the operator's D1/D2 selection, and freeze §11 shows a round-3 `pass`.
If either is missing, STOP and ask — never ratify on the operator's behalf (round 2 blocked
exactly that). Ratification covers the CODE build only: no canister deploy, no merge, no gate flip.

Read first (the freeze is ground truth — do NOT redesign):
- docs/SEC-KN-4-DELEGATION-PRINCIPAL-BINDING-FREEZE.md (R1-R9, R2.1 check order, §5 scope,
  §6 test matrix, §8 Tier-3 gates, §12 decisions)
- docs/ROADMAP.md (SEC build queue) and docs/OVERSEER-HANDOVER.md (this file)

Do (implement exactly R1-R9; nothing outside freeze §5):
1) R1 canister authorship: add created_by to Migration.ProposalRecord; pin
   StableStorageV5/V6/V7 AND the two historical row maps (Migration.mo:233, :268) to
   ProposalRecordV7; add _proposalV7ToCurrent setting created_by = "" plus the
   TODO(SEC-KN-4c) identity-restore marker on the hook; in main.mo proposal create set
   created_by from X-Actor-Id ONLY — no X-User-Id fallback, no truncation (store "" when
   absent/empty/over 128), never from the JSON body; emit it in both GET serializers;
   extend scripts/verify-canister-migration.mjs.
2) R2 + R2.1 precheckApprovedDelegationProposal(dataDir, proposal, { author }) — author
   REQUIRED, fail closed (DELEGATION_AUTHOR_UNVERIFIED), checks in the frozen order.
   Wire all call sites listed in R2 (hub/server.mjs:3072 proposed_by;
   lib/agent/delegation-hosted-proposal.mjs:299 created_by; three test fixtures on
   TEST_USER_ID).
3) R3/R4 re-derive principal_ref / owner_ref from the author; refuse on mismatch AND
   overwrite with the derived value. R5 reject org_ref: in delegation paths (apply + mint).
4) R6 drop ownerRef from the identity propose input. R7 add checkDelegationGate to apply.
   R8 lock no-cross-partition apply by test. R9 keep delegation out of self-apply.
5) Seven-tier tests in test/sec-kn-4-delegation-principal-binding.test.mjs per freeze §6,
   including the security regression that PASSES the attack against a body-trusted replica
   and refuses it against the fixed code, plus the R1.5 anti-regression (empty created_by
   must never bind to the partition owner). npm test green; npm run
   canister:verify-migration exit 0. If dfx build does not resolve locally, record the
   compile UNVERIFIED — do not claim it passed.
6) Update ROADMAP + this handover; Muse commit on a feature branch.

Do NOT: deploy or upgrade the canister, merge to main, flip the delegation gate, widen
self-apply, or "fix" the audit-append principal (freeze §2.1 — already grant-bound).
If a frozen rule cannot be implemented as written, STOP and return to Thinking.

Governance gates (§KH1.9 — mandatory; silence is not pass):
- [x] Freeze review — round 3 = **pass**; operator ratified §12 D1/D2 (freeze §12.1). Re-verify.
- [ ] Build verification — /build-verification-review must be pass before DONE.
- [ ] Governance sync — ROADMAP + this file in the closing Muse commit (SD-17).
- [ ] Verify claims — ok -C ~/knowtation status --json (initialized, kit_version, footprint ok).
```

### Knowtation-owned findings (from Pass 2)

| ID | Sev | Finding | Primary citation |
| --- | --- | --- | --- |
| **P1** | **CRITICAL**-conditional | `gatewayAuthorized` fails **open** on empty secret; identity from raw `X-User-Id` | `hub/icp/src/hub/main.mo` — **SEC-KN-1 on Muse `main`**; live health `gateway_auth_configured:true` (2026-07-31) |
| **P2** | **MAJOR** | Client-supplied `evaluation_status: "passed"` / `evaluated_by` persisted verbatim outside the fingerprint class | `lib/hub-proposal-create-augment.mjs` — **fixed in tree (SEC-KN-2)** |
| **P4** | **MAJOR** | Delegation apply trusts `proposal.body.principal_ref`; no `created_by` on the record → approval mints a grant for an attacker-named principal | `lib/agent/delegation.mjs`; `Migration.mo` — **SEC-KN-4b on Muse `main`**; SEC-KN-4c hook restore **DONE + landed 2026-08-01** (BV `pass`; Muse `main` `2466ad64…` + muse-mirror); live proposal `created_by` field UNVERIFIED |
| **P6** | **MAJOR** | `mcp_access` tokens get admin-allowlist role lookup, contradicting `access-token-authz.mjs`; agent tokens also satisfy the self-apply human-review predicate | `hub/gateway/server.mjs` + `access-token-authz.mjs` + `hub-proposal-personal-self-apply.mjs` — **fixed in tree (SEC-KN-3)**; stale assertion hygiene **SEC-KN-3a DONE** |
| **P12** | **MINOR** | Vault policy `max_ttl_seconds` accepted with no ceiling → silently widens SD-10's 24h cap | `lib/agent/delegation.mjs:124-136` with `:996-1003` — **fixed in tree (SEC-KN-5)** |
| **P13** | **MINOR** | Self-hosted `viewer` may mint delegation grants (runtime bearer authority) | `hub/server.mjs:1872,1912` — **fixed in tree (SEC-KN-5)**; mint is `admin` only |
| **P14** | **INFO** | Non-constant-time secret comparison | `main.mo` — **SEC-KN-6 on Muse `main`**; live health surface present 2026-07-31 |
| **P3** | **MAJOR** (shared) | Task/media/delegation proposals arrive with a **shared service token**, not a learner session — no ownership proof for self-apply | Scooling `src/adapters/taskWriteHubTransport.ts:210,298` and siblings |

**What Pass 2 found CLEAN in Knowtation** (do not re-litigate): `PROXY_HEADER_ALLOWLIST` never
forwards client `authorization` or `cookie` to the canister; no secret appears in logs, errors, or
results; `principal_ref` is hashed before it reaches a result; delegation TTL is server-clamped
(default 3600s, max 86400s) with no client-supplied expiry accepted; JWT `role` claims are not
trusted (role is re-derived from `sub`); AIR attestation is fail-open and does not weaken the write
gate; canister proposals are partitioned by effective user id with no gateway-path IDOR.

### Governance gates checklist

- [x] **Overseer Kit installed** — 2026-07-26, `initialized: true`, `kit_version: 0.1.0`, `footprint_self_integrity: ok`, `muse_sync: synced`
- [x] **SEC-KN-0** — canister gateway auth secret verified **SET** (2026-07-26 live probe) — **DONE**
- [x] **SEC-KN-1** — P1 fail-closed + security-tier regression test (**Auto**) — **DONE** (on Muse `main`; live `gateway_auth_configured` 2026-07-31)
- [x] **SEC-KN-2** — P2 server-only evaluation fields (**Auto**) — **DONE** (code landed via finish/SEC path on Muse `main`)
- [x] **SEC-KN-3** — P6 `mcp_access` role cap + no self-apply for agent tokens (**Auto**) — **DONE**
- [x] **SEC-KN-4a** — **DONE** — P4 spec frozen; tip **contained in Muse `main`** (2026-07-31 board clear)
- [x] **SEC-KN-4b** — P4 build against the frozen spec (**Auto**) — **DONE** (BV round 2 = `pass`; on Muse `main`)
- [x] **SEC-KN-4c** — migration hook restored to identity (**Operator + Auto**) — **DONE + landed 2026-08-01** (BV round 1 = `pass`; Muse `main` `2466ad64…` + muse-mirror; operator Tier 3)
- [x] **SEC-KN-3a** — 4 stale RBAC source-shape assertions + billing-repair isolation (**Auto**) — **DONE** (BV round 1 = `pass`)
- [x] **SEC-KN-5** — P12 clamp policy TTL + P13 `viewer` cannot mint (**Auto**) — **DONE** (BV round 1 = `pass`)
- [x] **SEC-KN-6** — P14 constant-time compare (**Auto**) — **DONE** (tip contained in Muse `main`; live health 2026-07-31)
- [x] **SEC-SEAM-1** — P3 session-bound identity for task/media/delegation/flow writes (**Thinking → Auto**) — **DONE** (tip contained in Muse `main` 2026-07-31)
- [ ] **SEC-SEAM-MEDIA** — hosted media proposal surface (**Thinking → Auto**) — **TODO** (post–SEC-SEAM-1b; D2 = A)
- [x] **KN-b** — FINISH-COMPLETE-APPLY self-apply policy — **DONE + landed** KN #275; board clear closed P1 Motoko/health gate 2026-07-31

---

## Status (Knowtation product)

| | |
| --- | --- |
| **API** | `api.knowtation.store` live |
| **MCP public** | `https://mcp.knowtation.store/mcp` |
| **Durable agent auth** | MCP OAuth durable refresh + Hub **Connect cloud agent** (RFC 8628) shipped on `main` ([KN #271](https://github.com/aaronrene/knowtation/pull/271)). Public recipes: [`AGENT-INTEGRATION.md`](./AGENT-INTEGRATION.md) § Always-on cloud agents. Device routes require the **persistent MCP gateway** deploy. |
| **Calendar 1D** | LIVE (gate on) |
| **Overseer Kit** | **Live** (2026-07-26) — see deviation note below |

## Verified snapshot (what exists now)

| Area | State |
| --- | --- |
| **Overseer Kit** | `initialized: true`, `lock.kit_version: 0.1.0`, `footprint_self_integrity: ok`, `muse_sync: synced`, `substrate: healthy` — **re-verified 2026-07-27** via `ok -C ~/knowtation status --json` |
| **Footprint deviation (intentional)** | `ok status --check-footprint` → `footprint_integrity: mismatch`. Cause: `MUSE-BRIDGE-WORKFLOW.md` and `scripts/muse-bridge-deploy.sh` were restored to Knowtation's live versions (sha256 `ef8a50b5…` and `fcc17c36…`) after `init --force` overwrote them with kit templates. Knowtation's bridge script is 10,004 bytes and is the live deploy path; the kit template is 3,842 bytes and is **not** a substitute. **Do not "repair" these two files.** Recorded in `.overseer/config.yaml` → `kit.notes`. |
| **Canister gateway auth secret** | **SET** (2026-07-26) — hub `rsovz-byaaa-aaaaa-qgira-cai`; `GET /vaults` without `X-Gateway-Auth` → `403 GATEWAY_AUTH_REQUIRED`. `operator_status` does not exist on canister. |
| **SEC-KN-1 fail-closed** | **On Muse `main`** (tip contained). Live health `gateway_auth_configured:true` + `/vaults` → `403 GATEWAY_AUTH_REQUIRED` (**re-verified 2026-07-31**). |
| **SEC-KN-2 server-only eval** | **On Muse `main`** (finish/SEC land path). |
| **SEC-KN-3 mcp_access role cap** | **On Muse `main`** (tip `5954c433…` ancestor; GitHub mirror since `69a7673`). **EC2 MCP host runtime lagging** current main (P6-ROTATE evidence). |
| **SEC-KN-4 P4 (delegation principal)** | **On Muse `main`** (SEC-KN-4a tip contained). SEC-KN-4c identity restore **DONE + landed 2026-08-01** (BV `pass`; Muse `main` `2466ad64…` + muse-mirror). Live module hash `0x039360a0…` re-verified 2026-08-01 (matches T4); no redeploy. Live proposal `created_by` **CONFIRMED-POPULATED** (2026-08-01 P6-VERIFY sidecar). |
| **SEC-KN-3a (RBAC assertion refresh)** | **DONE** (BV round 1 = `pass`); on Muse `main` via SEC-KN-4a lineage. |
| **SEC-KN-5 (P12 TTL clamp + P13 admin mint)** | **DONE** (BV round 1 = `pass`); on Muse `main` path. |
| **SEC-KN-6 (P14 constant-time compare)** | **On Muse `main`** (tip contained); live health surface present 2026-07-31. |
| **SEC-SEAM-1 (P3 session-bound identity)** | **On Muse `main`** (tip contained 2026-07-31). Scooling L-SEAMb already landed (SC #219). |
| **Knowtation Netlify env** | Site `knowtation-gateway` (`api.knowtation.store`, id `3123cc84-…`): `CANISTER_AUTH_SECRET` present, `SESSION_SECRET` present, `HUB_ADMIN_USER_IDS` present, `HUB_EVALUATOR_MAY_APPROVE` **absent** (fail-safe). |
| **MCP host / gateway `SESSION_SECRET` sharing** | **VERIFIED-SHARED** (2026-08-01) — evidence `docs/reviews/2026-08-01-sec-kn-p6-verify-session-secret-share.md`. Freeze CLEARED: `docs/SEC-KN-P6-ROTATE-FREEZE.md`. NEXT = ROTATE-b (deploy EC2 then dual-secret rotate). |

## Hard stops

- Never `git push origin main` — GitHub `main` only via a `muse-mirror → main` PR after a Tier 3 Muse `main` merge
- Never merge to Muse `main` without operator authorization (Tier 3)
- Never claim a runtime/security state without running the check in the same session
- **Delegation intents are never eligible for personal self-apply** (P4) — this is not a tuning knob
- Do not re-sync `MUSE-BRIDGE-WORKFLOW.md` / `scripts/muse-bridge-deploy.sh` from the kit

## Change log

| Date | Event |
| --- | --- |
| 2026-08-01 | **SEC-KN-P6-ROTATE-a DONE — freeze-review `pass`.** `docs/SEC-KN-P6-ROTATE-FREEZE.md` (`frozen: true`, digest `sha256:958c8add…`): D1 one signing domain; D2 deploy-before-rotate; dual-secret runbook; G10 full `jwt.verify` wire-up. Top input: SEC-KN-3 on Muse/`main` (stale "not merged" corrected); EC2 pre-current-main (discard 401 vs 200). Evidence: `docs/reviews/2026-08-01-sec-kn-p6-rotate-ec2-code-divergence.md`. No T1–T4. NEXT = **SEC-KN-P6-ROTATE-b** (Operator + Auto). |
| 2026-08-01 | **SEC-KN-P6-VERIFY DONE (Outcome B VERIFIED-SHARED).** Cross-acceptance probe: gateway-signed `agent_access` JWT accepted on both `api.knowtation.store` and distinct EC2 `mcp.knowtation.store` session route; garbage/no-auth 401. Optional `created_by` CONFIRMED-POPULATED. Evidence: `docs/reviews/2026-08-01-sec-kn-p6-verify-session-secret-share.md`. |
| 2026-08-01 | **SEC-KN-4c LANDED (operator Tier 3).** `feat/sec-kn-4c-land` fast-forwarded into Muse `main` (`4179ed46… → 2466ad64…`); suites green on `main` (11/11, 31/31, verify exit 0); bridged to GitHub `muse-mirror` → `main` [PR #287](https://github.com/aaronrene/knowtation/pull/287) — **MERGED**, merge commit `15fba5f5d897…`; mirror/main tree hashes identical (`b6a558ca…`). No canister deploy. |
| 2026-08-01 | **Land CI fix-forward.** PR #287 first run failed `test (20)` on two stale/toolchain items: `test/phase3-security.test.mjs:358` still asserted the pre-4c explicit field-mapping hook (property now holds by identity — assertion flipped to identity shape + `StableStorage` field presence), and the new integration tier ran `dfx build --check` on a runner without dfx (now explicit skip with reason when dfx absent; enforced locally/BV). Full local suite **4349 pass / 0 fail** (1 pre-existing attestation-replica skip). |
| 2026-08-01 | **SEC-KN-4c-b code DONE (BV round 1 `pass`).** Identity `Migration.migration` on `StableStorage` + verify-script flips + SEC-KN-4 test flip + seven-tier `test/sec-kn-4c-migration-hook-restore.test.mjs` (11/11; SEC-KN-4 31/31; `canister:verify-migration` exit 0; `dfx build --check hub` exit 0) landed on fresh `feat/sec-kn-4c-land` (`sha256:ec1e80b3…` off main `4179ed46…`). Live hash `0x039360a0…` re-read — matches frozen expected, **no redeploy** (4C-R8). BV: `docs/reviews/2026-08-01-sec-kn-4c-b-bv-round1-pass.md`. NEXT = Tier 3 / SD-21 land of the branch (D6). |
| 2026-07-30 | **Relay → FLOW-CAPTURE-LIVE-HOSTEDb.** Scooling tip `sha256:6499d790…`: HOSTEDa freeze `pass` (`sha256:f01e9c5b…`); product NEXT = HOSTEDb Auto (Scooling). Optional KN parallel: SEC-KN land + WASM. |
| 2026-07-30 | **Relay → FLOW-CAPTURE-LIVE-KN-b.** Scooling tip `sha256:29a8720da…`: FLOW-CAPTURE-LIVEa freeze `pass` (`sha256:f0ca2edd…`); SD-23; product NEXT = KN-b Auto (this repo). Optional KN parallel: SEC-KN land + WASM. |
| 2026-07-30 | **Relay → FLOW-CAPTURE-LIVEa.** Scooling tip `sha256:056b11031…`: 0.7b DONE (OK #47); F7 AWS-parked; product NEXT = Wave 2 capture Thinking freeze. Optional KN parallel: SEC-KN land + WASM. |
| 2026-07-29 | **Relay → KIT-PRESERVE-SHARED-ASSETS 0.7b.** Scooling L-SC landed SC #230 @ `efc84a8` + land-docs SC #231. Product NEXT = kit `--preserve-shared-assets` (F7 AWS-blocked). tip_hash `sha256:2b6ff141…`. No Knowtation product code. |
| 2026-07-29 | **LAB-LIVE-SMOKE PASS (product).** Scooling local Lab fixture dry-run under double-lock; BV `pass`; CONFLICT-adopt for pre-approved Wave 1 fixture; prod Lab env unset. Knowtation relay only. Product NEXT = **SEC-REMEDIATION L-SC (0.8b)**. |
| 2026-07-29 | **LAB-LIVE-flip DONE (product BV pass).** Scooling `TRAINING_LAB_SUBMIT_AUTHORIZED=true`; seven-tier **33/33**; BV `pass`; prod Lab env unset. Knowtation relay only. Product NEXT was **LAB-LIVE-SMOKE**. |
| 2026-07-29 | **LAB-LIVEb DONE (product BV pass).** Scooling double-lock wire + honesty; posture `false`; seven-tier **20/20**; BV `pass`. Knowtation relay only. Product NEXT was **LAB-LIVE-flip**. |
| 2026-07-29 | **LAB-LIVEa DONE (product freeze pass).** Scooling `docs/LAB-LIVE-FREEZE.md` freeze-review `pass` (`sha256:f651643b…`); SD-22. Knowtation relay only — no Lab/billing code. Product NEXT was **LAB-LIVEb** (Scooling Auto). |
| 2026-07-29 | **§FWL.9 FLOW-WRITE-LIVE-SMOKE PASS (product).** Scooling signed-in personal draft → `hosted_flow_saved` / applied / canonical write yes (`prop-1785355841721526922`) after GATEWAY-PROXY + bridge `FLOW_AUTHORING_WRITES` redeploy. Product NEXT was **LAB-LIVEa** (Scooling Thinking). |
| 2026-07-29 | **FLOW-WRITE-LIVE-GATEWAY-PROXY DONE — BV round 1 = `pass`.** Gateway proxies Flow authoring POSTs to bridge; bridge `registerBridgeFlowRoutes` + canister propose; seven-tier **12/12** (`test/gateway-flow-authoring-proxy.test.mjs`). No capture/run/Delegation or `FLOW_AUTHORING_WRITES` flip. NEXT = Operator §FWL.9 retry (confirm bridge env). |
| 2026-07-27 | **Relay fix — NEXT → Scooling L-SEAMb Auto.** Scooling L-SEAMa freeze-review `pass` had already advanced `~/scooling/docs/OVERSEER-HANDOVER.md` to L-SEAMb Auto; this Knowtation relay still showed the old Thinking paste. Not a kit outage — the kit does not cross-update consumer handovers. Regenerated this NEXT to relay L-SEAMb. Archived SEC-KN-5/6 prompts below are history, not competing PRIMARYs. |
| 2026-07-27 | **Governance sync — Overseer re-verified; NEXT → Scooling L-SEAM C1–C4.** `ok -C ~/knowtation status --json`: `initialized: true`, `kit_version: 0.1.0`, `footprint_self_integrity: ok`. Scooling `verify-overseer-live.sh` → `live: true`. Live HTTP `api.knowtation.store/health` → `{"ok":true}`; canister auth still SET (`403 GATEWAY_AUTH_REQUIRED`). Browser MCP confirmed `knowtation.store/` landing loads. PRIMARY product next is consumer C1–C4 on the Scooling board (freeze §6). |
| 2026-07-27 | **SEC-SEAM-1 DONE — BV round 1 = `pass`.** S1–S10 on `feat/sec-seam-1-session-bound-writes`: five mint stamps (`type:'session'`), `resolveActorTokenClass` / `isSessionBoundActor`, seam classify via apply-path predicates (S3.0; seven conditions incl. flow/flow_capture), `personalSelfApplyRefusalReason` + S6.2 HTTP seam codes on both approve gates, S10 empty parser (`lib/hub-self-apply-ineligible.mjs`), CORS `X-User-Id` advertisement removed, PROPOSAL-LIFECYCLE S7/S8. Seven-tier **33/33** (`test/sec-seam-1-session-bound-identity.test.mjs`, sha256 `bd57bfe8868175096589c4dac823586ddd6ce683066ccef92fdef65cfaedd361`). T1–T5 unexecuted. No merge. NEXT = Scooling `L-SEAM` / `SEC-SEAM-MEDIA` Thinking / Operator Tier-3 merge (pick one). |
| 2026-07-27 | **SEC-SEAM-1a CLEARED — round 7 = `pass`.** Operator **D5 = A** (flow + flow_capture in S3.1). Fixed V1–V11 (V3 overlap executed; V1 machine-credential premise corrected; fifth mint `issueLocalToken`; S6.2 / S10 lib parser / seven S3.1 conditions). Loop cleared W1–W5 / X1–X2 / Y1. Independent clearance [round-7](b7e481c0-c3d4-437b-ae86-1865e895397f). Mechanical gate pass; stamp retained after semantic clearance. Roadmap row `SEC-SEAM-MEDIA` opened (D2). NEXT = **SEC-SEAM-1b Auto**. T1–T5 unexecuted. No merge. |
| 2026-07-27 | **SEC-SEAM-1a round 3 — D1–D4 RATIFIED, BLOCKER N1 closed, round-3 review = `blocked` (11 new findings).** Session refused to read the handover's own paste-ready prompt ("fix N1 per D4 option A") as ratification — it was round-2's authorship, and acting on it would repeat the SEC-KN-4a self-ratification defect. Operator selections obtained and quoted verbatim in freeze §12.1: **D1 = A** (stamp `type: 'session'` at all mint sites; absent = `legacy_session`, propose-OK / self-apply-ineligible), **D2 = A** (media out of scope, roadmap row), **D3 = start empty** (S10 ships dormant), **D4 = A** (classification reuses the apply path's predicate). All 18 round-2 findings fixed; **S3 rewritten** with frozen anti-drift rule **S3.0** — no hand-written seam field list may exist in built code — plus new ground truth G27–G31 and a full 14-step refusal precedence (S6.1). N1's evasion **and** its fix reproduced by **execution**. Round-3 independent reviewer (`thinking-high`, fresh) confirmed **15/18** round-2 fixes and that **N1 is closed by construction**, but returned **`blocked`** with 11 findings — incl. `security` **V1** (a machine-credential mint path *does* exist: `netlify/functions/consolidation-scheduler.mjs:72`, which is the premise **D3 was ratified on**), **V2** (fifth learner-session mint site `hub/lib/local-auth.mjs:179`), and **V3** (S6.1's "no live behavior change" **disproved by execution**). Loop halted per the skill's `security`/`blocked` hard stops. **New operator decision D5** (are Flow / Flow-capture seam surfaces? — apply-bearing and self-apply-gated at `hub/server.mjs:3056`/`:3064`, absent from the freeze). Mechanical `ok review --freeze` = **pass, 0 findings**; its auto-written `review_stamp` removed by hand every run since the semantic verdict is `blocked`. Muse branch `feat/sec-seam-1-session-bound-writes` (canonical, unchanged; git is parked on an unrelated stale branch and was not touched). **`SEC-SEAM-1b` not started. T1–T5 unexecuted. No merge.** |
| 2026-07-26 | **SEC-KN-6 DONE — BV round 1 = `pass`.** P14: Motoko `constantTimeTextEqual` (OR-of-XOR over every character; no early-exit `==`) wired into both `gatewayAuthorized` and `operatorExportAuthorized`; JS mirror in `lib/gateway-authorized.mjs`. Seven-tier + security regressions vs length-then-`==` early-exit in `test/sec-kn-6-constant-time-secret-compare.test.mjs` (**18/18**, sha256 `67db4bca…`); SEC-KN-1 still **19/19**; Motoko compile **VERIFIED** (`env -i … NO_COLOR=1 TERM=dumb dfx build --check hub`). Branch `feat/sec-kn-6-constant-time-secret-compare`. T1–T4 not executed. No canister deploy. NEXT = **SEC-SEAM-1** (Thinking). |
| 2026-07-26 | **SEC-KN-5 DONE — BV round 1 = `pass`.** P12: `readVaultDelegationPolicy` clamps `max_ttl_seconds` via `Math.min(..., MAX_TTL_SECONDS)` so a vault policy of `604800` cannot widen SD-10. P13: self-hosted `POST /api/v1/delegation/grants` is `requireRole('admin')` only (consent propose stays viewer-inclusive). Seven-tier + security regressions vs unclamped legacy / viewer-inclusive mint in `test/sec-kn-5-delegation-ttl-viewer-mint.test.mjs`; route assertion updated. Evidence: SEC-KN-5 + route **26/26** (sha256 `0f4a1219…`), related delegation suites **64/64**. Branch `feat/sec-kn-5-delegation-ttl-viewer-mint`. T1–T4 not executed. NEXT = **SEC-KN-6**. |
| 2026-07-26 | **SEC-KN-3a DONE — BV round 1 = `pass`.** Refreshed 4 stale `resolveHostedActorRole` source-shape assertions (unit/security/data-integrity) to match SEC-KN-3: one entry `jwt.verify`, `isMcpAccess` return field, bridge fallback via `roleFromVerifiedAccessPayload(bearerPayload)`, allowlist override gated by `mayApplyAdminAllowlistOverride`. SEC-KN-3 suite still green (security properties not weakened). **Billing-repair decision:** do **not** skip on canister replica — root cause was corrupt shared `data/hosted_billing.json`; `billing-store.mjs` now resolves path at call time from `KNOWTATION_BILLING_DB_PATH` / `KNOWTATION_GATEWAY_DATA_DIR`, and the repair test uses an isolated temp DB. Evidence: RBAC trio + SEC-KN-3 + billing-repair **82/82** (sha256 `c587e459…`). T1–T4 not executed. NEXT = **SEC-KN-5**. |
| 2026-07-26 | **SEC-KN-4b DONE — BV round 2 = `pass`.** Independent verifier re-checked BV1–BV4 and R1–R9 against the freeze: security regression still discriminates; R5 checks both refs + cross-kind test; performance read-count test green; R1.5 owner-never-persisted assertion real; Motoko compile verified via `env -i PATH=… HOME=… NO_COLOR=1 TERM=dumb dfx build --check hub` (plain `NO_COLOR` alone can still hit `ColorOutOfRange`); `canister:verify-migration` exit 0; SEC-KN-4 tests **31/31**; related delegation suites **24/24**. One new MINOR: freeze R5 required `docs/AGENT-DELEGATION-V0-SPEC.md:245` to mark `org_ref:` reserved — it did not; amended in-session, then re-verified. SEC-KN-3a pre-existing proof strengthened: `muse snapshot-diff` from SEC-KN-3 tip → HEAD lists no `hub/gateway/server.mjs` and no `proposal-approve-rbac-fix-*.test.mjs`. T1–T4 not executed. NEXT = **SEC-KN-3a**. |
| 2026-07-26 | **SEC-KN-4b build verification round 1 = `findings`** (4 MINOR, nothing escalating) — all fixed; round 2 pending. The verifier confirmed the two things most likely to be faked: the security regression **genuinely discriminates** (`precheckLegacyBodyTrusted` is a branch-for-branch copy of the pre-fix function, accepts the attacker-named principal, and the test fails if the fix is reverted), and the "pre-existing" label on the failing suite is **proven** — the asserted-on source and the asserting test files are sha256-identical before and after the build commit, so the 4 real failures are stale `resolveHostedActorRole` assertions from **SEC-KN-3**, now tracked as **SEC-KN-3a**. Fixes: tautological `assert.notEqual` on two constants replaced with a real "owner principal never persisted" check; **R5 now checks both `principal_ref` and `owner_ref` for every record kind** (the literal frozen wording) with a cross-kind test; performance tier now asserts the "no extra filesystem read" clause; the non-green full suite is disclosed instead of omitted. **Motoko compile VERIFIED** — the `dfx build` panic was terminal-colour detection, and `NO_COLOR=1 TERM=dumb dfx build --check hub` succeeds, which also discharges the one static risk BV could not check (`createdByFromRequest` forward-referencing `isAsciiSpace`). **Upgrade behaviour measured:** first upgrade accepted (exit 0), repeat deploy **refused** with `Compatibility error [M0216]` — the freeze's hedge resolves to "no silent erasure, but un-upgradeable until T4", and R1.4 + gate T4 now carry the measurement. SEC-KN-4 tests **31/31**; `canister:verify-migration` exit 0. T1–T4 not executed. |
| 2026-07-26 | **SEC-KN-4b WIP (code)** — R1–R9 built on `feat/sec-kn-4a-delegation-principal-binding-freeze`: canister `created_by` + V7 migration hook (TODO SEC-KN-4c), author-required `precheckApprovedDelegationProposal`, principal/owner re-derive, apply gate, `org_ref:` rejection, seven-tier `test/sec-kn-4-delegation-principal-binding.test.mjs`. `canister:verify-migration` exit 0. **Awaiting /build-verification-review** before DONE. T1–T4 not executed. |
| 2026-07-26 | **SEC-KN-4a DONE — freeze review round 3 = `pass`.** A third fresh reviewer re-derived every claim from source: all 5 round-2 findings resolved; the §12.1 ratification accepted as legitimate (a quoted operator **selection**, and the recorded option A matches what R1.5 and R1.4 + T4 actually say, with T1–T4 correctly excluded); RR6 confirmed accurate (the consent branch has no duplicate check and the hosted `status === 'active'` shortcut can never match a stored consent, which carries only `revoked_at`); `created_by` reaches precheck with no unlisted file; C1–C8 all `pass`; **nothing open in an escalating category**; implementable with **zero design decisions** left open. One MINOR fixed in place: R3(2) now reads "non-empty **after trim**" so a whitespace-only `principal_ref` cannot both refuse (R3) and apply (§6). Freeze **CLEARED for the 4b code build only**. |
| 2026-07-26 | **SEC-KN-4a D1/D2 RATIFIED by operator** — explicit selection received (both option **A**): D1 fail-closed author (no `X-User-Id` fallback, no truncation; apply refuses `DELEGATION_AUTHOR_UNVERIFIED`), D2 one-shot migration hook with mandatory identity-restore follow-up (`SEC-KN-4c`, freeze gate **T4**) scheduled in the same operator session as the T1 upgrade. Quoted verbatim in freeze §12.1, which also preserves the governance distinction that a general "proceed" is **not** a selection. Ratification covers the **code build only** — T1–T4 remain Tier 3 and unexecuted. Round-3 freeze review launched so clearance rests on a reviewer verdict rather than this session's judgement; `SEC-KN-4b` starts on `pass`. |
| 2026-07-26 | **SEC-KN-4a freeze review round 2 = blocked (governance, not design)** — a fresh independent reviewer re-derived every claim from source and confirmed **all 8 round-1 amendments hold**: `Migration.mo:233`/`:268` are private with **zero callers** so the `ProposalRecordV7` re-pin is type-correct and `canister:verify-migration` still passes; no `userId(req)` author fallback survives and `PROXY_HEADER_ALLOWLIST` (`hub/gateway/server.mjs:1351-1356`) blocks client injection of `x-actor-id`; the `precheckApprovedDelegationProposal` call-site list is exhaustive (5 callers + 1 source assertion); all 6 production `validateChain` callers pass `requireGrant: true`. The blocker was **mine**: §12.1 had recorded ratification of the escalated D1/D2 after a general "continue" instruction whose selection payload never arrived — flagged `gates_tier3` and **reverted to UNRATIFIED**. Also amended: R2.1/§6 "malformed" wording that contradicted R3(2)'s mismatch refusal (a build session could have softened the loud-failure property), the data-integrity idempotency row scoped to `agent_identity` with the pre-existing consent duplicate-append recorded as RR6, and the repeat-deploy consequence restated as "fails compatibility **or** silently resets" since Motoko's actual behavior is not provable from this tree. `ok review --freeze` = pass. **P4 remains open; SEC-KN-4b still not started.** |
| 2026-07-26 | **SEC-KN-4a BLOCKED (freeze written, review escalated)** — P4 contract in `docs/SEC-KN-4-DELEGATION-PRINCIPAL-BINDING-FREEZE.md` (`frozen: true`) binds the delegation principal to the server-recorded proposal **author** (canister `created_by` from `X-Actor-Id`, self-hosted `proposed_by`), refuses on mismatch, rejects `org_ref:` authority refs in v0, gates the previously ungated apply path, and freezes the check order. New analysis beyond the audit: the `org_ref:` variant needs **no secret knowledge** (path A); exploit path C is persisted forgery but **not reachable** (all `validateChain` callers pass `requireGrant: true`); the audit-append principal is **already grant-bound** (`lib/agent/delegation.mjs:613-615`) so it stays out of scope. Round-1 independent review = **blocked**: 6 findings amended, 2 escalated to the operator (§12 D1 fail-open author fallback; D2 non-idempotent migration hook). `ok review --freeze` = pass. Branch `feat/sec-kn-4a-delegation-principal-binding-freeze`. NEXT = **operator ratification**, then SEC-KN-4b. |
| 2026-07-26 | **SEC-KN-3 DONE (code)** — mcp_access scope-capped role; never allowlist elevate; agent tokens never self-apply; seven-tier + security regression vs legacy inheritance; BV **pass**. Branch `feat/sec-kn-3-mcp-access-role-cap`. NEXT = **SEC-KN-4** (Thinking first). |
| 2026-07-26 | **SEC-KN-2 DONE (code)** — strip client `evaluation_status` / `evaluated_by` / `evaluated_at` on create augment; E1 server-audit only; seven-tier + security regression vs forge-preserving legacy; BV **pass**. Branch `feat/sec-kn-2-server-only-evaluation`. NEXT = **SEC-KN-3**. |
| 2026-07-26 | **SEC-KN-1 DONE (code)** — `gatewayAuthorized` fail-closed; health `gateway_auth_configured`; seven-tier + security regression vs fail-open; BV **pass**. Branch `feat/sec-kn-1-gateway-auth-fail-closed`. Canister upgrade **not** deployed (Tier 3). |
| 2026-07-26 | **SEC-KN-0 DONE** — canister gateway auth secret verified SET via live HTTP probe (hub `rsovz-byaaa-aaaaa-qgira-cai` → `403 GATEWAY_AUTH_REQUIRED`). Knowtation gateway env keys confirmed present. MCP/`SESSION_SECRET` share still UNVERIFIED. Cross-board: Scooling L-ENV (P7/P8/P9) also closed same day. |
| 2026-07-26 | **Overseer Kit installed** (`init --regime muse+git-mirror --migrate --force`, option A) on `feat/overseer-kit-install`. Existing `docs/OVERSEER-HANDOVER.md` preserved; `docs/ROADMAP.md` + `docs/CROSS-REPO-COORDINATION.md` seeded; live bridge assets restored over kit templates (known footprint deviation). Verified `initialized: true`. |
| 2026-07-26 | **SEC queue opened** from independent Pass 2 audit (`~/scooling/docs/PRE-BUILD-SECURITY-AUDIT-FINDINGS-PASS2.md`, verdict `findings`) — Knowtation owns P1, P2, P4, P6, P12, P13, P14 and shares P3. Scooling's `FINISH-COMPLETE-APPLY-KN-b` is NO-GO until SEC-KN-0 is verified and SEC-KN-2 ships. |
| 2026-07-13 | Docs hygiene: durable-auth freeze/evidence moved to local `development/` (not public). |
| 2026-07-13 | Connect cloud agent + honesty UI merged — [KN #271](https://github.com/aaronrene/knowtation/pull/271) |
| 2026-07-12 | Durable MCP OAuth refresh (strong store) merged — [KN #270](https://github.com/aaronrene/knowtation/pull/270) |

## Shared context (prepend to any phase prompt)

Knowtation is the **canonical store and permission authority** — notes, calendar, tasks, Flows, and
the authorization decisions over them. Scooling is a **consumer** and stores nothing canonical.
MuseHub **enriches** (version/provenance/social); it does not own.

Read first: `docs/ROADMAP.md`, this file, `AGENTS.md`, `MUSE-BRIDGE-WORKFLOW.md`,
`docs/PROPOSAL-LIFECYCLE.md`, `docs/AGENT-DELEGATION-V0-SPEC.md`, and
`~/scooling/docs/PRE-BUILD-SECURITY-AUDIT-FINDINGS-PASS2.md` for the SEC queue.

Tests: seven tiers (unit, integration, e2e, stress, data-integrity, performance, security) for new
slices. Every SEC phase additionally needs a security-tier test that **fails against the pre-fix
code**.

Governance: update **both** `docs/ROADMAP.md` and this file in the closing commit (SD-17). Muse
feature branch → (Tier 3) Muse `main` → `muse-mirror` PR only.

**Model labeling:** every NEXT block and paste-ready prompt must include **`Model:`** —
Thinking, Auto, Thinking → Auto, or Operator + Auto.

