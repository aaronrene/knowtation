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

### Product-order relay (2026-08-27, KN0 DONE)

Scooling PRIMARY advances to **RHF-b-SC** (Scooling Auto) per product order; Knowtation **RHF-b-KN0
COMPATIBILITY** is **DONE** (BV round 1 **`pass`**, seven-tier **17/17**). **NEXT on this board:**
**RHF-b-KN1 DELEGATION-RETAIL** — blocked on deployed KN0 proof + operator cutover authorization.
Freeze: `~/scooling/docs/reviews/2026-08-27-retail-helper-finish.md`. **Paste (Scooling):**
`~/scooling/docs/OVERSEER-HANDOVER-PASTE.txt`.

**MuseHub (2026-08-26):** Gabriel granted AWS SSO. Deploy smoke is **queued after Scooling Codex 29** — not a Knowtation task. F7b/KD-6b wait on Gabriel until smoke passes. Relay: `~/scooling/docs/reviews/2026-08-26-musehub-aws-sso-deploy-smoke.md`.

---

<!-- overseer:next role=lane_tip lane=auth status=live -->
## NEXT SESSION — RHF-b-KN1 delegation retail (blocked)

**Date:** 2026-08-27  
**Model:** **Operator + Auto**  
**Program:** `~/scooling/docs/reviews/2026-08-27-retail-helper-finish.md`  
**Product order:** Scooling row **22b RHF-b-KN1** after **RHF-b-SC**. **Hard stop:** no candidate/marker/cutover until operator authorizes Tier 3.

### THE ONE NEXT STEP — **Model: Operator + Auto**

**BLOCKED** until KN0 compatibility is deployed and proof recorded, then operator authorizes
authority-envelope cutover. Do **not** start Auto until those gates clear.

When unblocked, build KN1 only: `DelegationAuthorityStore`, `renew-personal`, `validate`, and
`helper-access` from the passed freeze. No Scooling edits in the KN1 session.

```text
Step: RHF-b-KN1 DELEGATION-RETAIL (blocked)

Prerequisites:
1. KN0 compatibility deployed; generic session mint denial proven on hosted bridge.
2. Operator Tier-3 authorization for candidate/marker cutover path.

Then implement KN1 from ~/scooling/docs/reviews/2026-08-27-retail-helper-finish.md §B2–B7.
Seven-tier + BV pass. No production marker without operator authorization.

Model: Operator + Auto
Branch: feat/retail-helper-finish-b-kn1 (create when unblocked)
```

### This session — RHF-b-KN0 Auto **DONE** (2026-08-27)

Implemented KN0 compatibility on `feat/retail-helper-finish-b-kn0`: Bridge generic grant mint rejects
human session tokens before catalog resolution; immutable reserved `agent_codex_retail` catalog;
marker-aware fail-closed compatibility reads; seven-tier **17/17**; BV round 1 **`pass`**
(`docs/reviews/2026-08-27-rhf-b-kn0-bv-round1-pass.md`). Related delegation suites **79/79**. No
candidate/marker/cutover/deploy/consent/grant mint/env flip/spend.

### Archived — RHF-b-KN0 paste block (completed)

```text
Step: RHF-b-KN0 COMPATIBILITY

Implement only Knowtation KN0 from Scooling's passed freeze:
~/scooling/docs/reviews/2026-08-27-retail-helper-finish.md.

Required:
1. Generic Bridge POST api/v1/delegation/grants rejects session-bound human tokens.
2. Compatibility reads follow only a valid active marker; absent marker uses legacy stores;
   unknown/missing/mismatched marker/envelope fails closed.
3. Add immutable reserved provider catalog entry agent_codex_retail exactly as frozen; reserved id
   cannot be shadowed by legacy/proposed records.
4. Seven-tier tests including proof generic session mint is denied before catalog resolution.
5. Run independent /build-verification-review; pass required before DONE.
6. Update Knowtation ROADMAP + OVERSEER-HANDOVER together and commit on the feature branch.

Do not build KN1 renewal/cutover, create a candidate/marker, approve consent, mint a grant, change
production env, deploy, or spend money.

Model: Auto
Branch: feat/retail-helper-finish-b-kn0
```

### Archived — CODEX-HUB-ACTOR (was PRIMARY after #331 — superseded)

```text
CODEX-HUB-ACTOR — register OpenAI Codex as 7D external_provider on Knowtation Hub.

Repo: knowtation
Model: Operator + Auto
Authority: ~/scooling/docs/CODEX-LIVE-FINISH.md row 25 · docs/skills/external-agent/codex.md
SD-32: do not park.

After Scooling PR #331 is on GitHub main:
1) Register agent_id (e.g. agent_aaron_codex), provider: codex, hashed provider_session_ref, SD-10 consent.
2) Mint one short grant for a draft_only task. Bearer in env only.
3) Record PASS/FINDINGS in docs/reviews/<date>-codex-hub-actor.md — no secrets.

Then start CODEX-HUB-GRANT-UI (auto-mint + needs-input) without waiting.
Never git push origin main. Never feature → GitHub main.
```

### Archived — AIP-b Operator T2 live smoke (parallel residual)

**Date:** 2026-08-24  
**Model:** **Operator**  
AIP-b **landed** ([KN #308](https://github.com/aaronrene/knowtation/pull/308) `@e9300f2`). Does **not** block Codex.

After Netlify deploy from KN #308, production ingest smoke on `api.knowtation.store` may still be recorded in `docs/reviews/<date>-automation-ingest-live-smoke.md` — `rule_id`, disposition, HTTP status + JSON `code` only; **no secrets**.

### This session — SD-21 land AIP-b **DONE** (2026-08-24)

Operator + Auto. SD-21 criteria met (BV r1 **pass**; no live posture/env flip, secrets, real money, or Delegation write env). Muse FF `feat/automation-ingest-policy-b` → `main` `sha256:4f7a536421fec9084b51a924bf9f3f2535fe5d05bf84d2ce36e17a5821c5a2e3`. Then `./scripts/muse-bridge-deploy.sh` → GitHub [PR #308](https://github.com/aaronrene/knowtation/pull/308) `@e9300f25390b42c60bc279e7d8433245c51b7665` (merge commit; required checks green: `test (20)`, `Secret scanning (TruffleHog)`). Never `git push origin main`. Never feature→GitHub-`main`. Born Free templates stay disabled. Evidence: `docs/reviews/2026-08-24-automation-ingest-policy-b-land.md`. Production ingest smoke **not** claimed.

### This session — AIP-b Auto **DONE** (2026-08-24)

Implemented D1–D27 against the freeze. Seven-tier **26/26**. BV r1 **pass**. Branch `feat/automation-ingest-policy-b`. Pack templates stay `enabled: false`. Session `POST api/v1/proposals` unchanged. No Scooling edits.

### Paste-ready prompt — AIP-b Operator T2 live smoke

```text
Run production automation ingest smoke on api.knowtation.store after KN #308 deploy. Use scripts/verify-automation-ingest-smoke.mjs with production target only if credentials are already in env (never paste kt_agent_ or JWTs into git). Record PASS or FINDINGS in docs/reviews/<date>-automation-ingest-live-smoke.md: rule_id, disposition, Review proposed-count delta, HTTP status + JSON code only. No secrets.

Repo: knowtation
Model: Operator
Authority: docs/AUTOMATION-INGEST-POLICY-FREEZE.md T2; docs/reviews/2026-08-24-automation-ingest-policy-b-land.md
```

### Paste-ready prompt — trend-agent propose re-smoke (after deploy; Operator, not AIP-b)

```text
Re-run KN-AUTH-LANE-D live smoke step 4 after propose-path hotfix deploy. POST /api/v1/proposals with agent_access Bearer + X-Vault-Id Business. Expect 200/201 with proposal id. Record PASS or FINDINGS (status + JSON code only, no secrets) in docs/reviews/2026-08-24-kn-auth-lane-d-live-smoke.md.

Repo: knowtation / VideoFactory trend agent
Model: Operator
```

### Paste-ready prompt — Scooling F28b land + F26 smoke (product order — paste in Scooling chat)

```text
SD-21 land feat/auth-lane-honesty-a on Scooling. F28b BV pass. Then Operator F26 DELEGATION-WRITE smoke — signed-in /settings/delegation lists helpers and submit works without Netlify KNOWTATION_AUTH_TOKEN.

Repo: scooling
Model: Operator + Auto (land) then Operator (smoke)
Branch: feat/auth-lane-honesty-a
Authority: docs/reviews/2026-08-24-auth-lane-honesty-a.md; docs/reviews/2026-08-24-auth-lane-honesty-b-bv-round1-pass.md
```

---

<!-- overseer:next role=product_relay lane=product status=live product_order=scooling tip_hash=sha256:ac529a9ce2e2b851e3d4f5f39d69cf3a841f0b1cdadf26c65c0f970c954be0fb -->
## PRODUCT RELAY — RHF-b-KN1 (PRIMARY lives on the Scooling board)

**Date:** 2026-08-27  
**Model:** **Operator + Auto**  
**Ownership:** Product order wins on Scooling. Knowtation owns canonical delegation authority.  
**Product order:** KN0 **DONE**; Scooling PRIMARY = **RHF-b-SC**; Knowtation NEXT = **RHF-b-KN1** (blocked on deploy proof + cutover authorization).

| | |
| --- | --- |
| **ID** | **RHF-b-KN1 DELEGATION-RETAIL** |

### THE ONE NEXT STEP — product order — **Model: Operator + Auto**

**BLOCKED** — do not start until KN0 deployed proof + operator cutover authorization. Scooling
**RHF-b-SC** may proceed in parallel on the Scooling board.

### This session — PRODUCT RELAY → Operator F20 after F32b land (2026-08-20)

Scooling F32b **LANDED** [SC #317](https://github.com/aaronrene/scooling/pull/317) `@7691fba9`. PRIMARY = **Operator F20 HELPER-SMOKE re-smoke** after Netlify redeploy; read class `data-next-step`. Path writes stay **ON**. T5 not admitted. This board does not Auto Scooling. NEXT = **Operator F20** (Scooling).

### This session — PRODUCT RELAY → Thinking F32 after F20 FINDINGS (2026-08-20) — superseded

Scooling F20 after F31b **FINDINGS** — fold `next_helper_endpoint`. PRIMARY was **Thinking F32 HELPER-ENDPOINT-REFUSE-a** (now **pass** → F32b **LANDED**). Path writes stay **ON**. T5 not admitted. **Superseded:** Operator F20 after F32b land.

### This session — PRODUCT RELAY → Operator F20 after F31b land (2026-08-20) — superseded

Scooling F31b **LANDED** [SC #315](https://github.com/aaronrene/scooling/pull/315) `@b2e643b4`. PRIMARY was **Operator F20** after #315; that smoke was **FINDINGS** (`next_helper_endpoint`). Path writes stay **ON**. T5 not admitted. **Superseded:** Thinking F32 → F32b land → Operator F20.

### This session — PRODUCT RELAY → Operator F18-P0 after F19b land (2026-08-19)

Scooling F19b **LANDED** [SC #305](https://github.com/aaronrene/scooling/pull/305) `@8051402`. PRIMARY was **Operator F18-P0 HELPER-INVOKE** (superseded same day by Bearer freeze). Helper invoke still refuses on apex. Path writes stay **ON**. T5 not admitted.

### This session — PRODUCT RELAY → SD-21 land F19b (2026-08-19)

Scooling PRIMARY moved to **Operator + Auto SD-21 land F19b**. F19b **DONE on tip** then **LANDED** same day. Helper invoke still refuses on apex. Path writes stay **ON**. T5 not admitted. This board does not land Scooling.

### This session — PRODUCT RELAY → F18 FINISH-LINE-HONESTY-a (2026-08-19)

Scooling PRIMARY moved to **Thinking FINISH-LINE-HONESTY-a**. Helper invoke still refuses on apex. Path writes stay **ON**. T5 not admitted. This board does not Auto F18. NEXT = **Thinking FINISH-LINE-HONESTY-a** (Scooling).

### This session — Path writes ON + F16/F17 land (2026-08-19)

Operator authorized `PATH_WRITES_ENABLED=1` on gateway+bridge. Rebuilds ready. T5 not admitted. Scooling F16+F17 GitHub [PR #303](https://github.com/aaronrene/scooling/pull/303) `@dff211d`. Evidence: `~/scooling/docs/reviews/2026-08-19-f16-f17-path-writes-land.md`. NEXT was **Operator MuseHub F7** (superseded same day by F18).

### This session — SD-21 land KN-WORK-PATH-LIST-b **DONE** (2026-08-18)

Operator + Auto. SD-21 criteria met (BV r1 **pass**; no live posture/env flip, secrets, real money, or Delegation write env in the diff). Muse FF `feat/kn-work-path-list-b` → `main` `sha256:87cf7a0d6cfdcfee542b0128171cb8406c9366a764efc43e59be8ab25901cfb5`. Then `./scripts/muse-bridge-deploy.sh` → GitHub [PR #299](https://github.com/aaronrene/knowtation/pull/299) `@005d00ff` (merge commit; required checks green: `test (20)`, `Secret scanning (TruffleHog)`). Never `git push origin main`. Never feature→GitHub-`main`. `PATH_WRITES_ENABLED` not flipped. **BRAIN-PAIR-b** stays blocked on the-brain E2. Evidence: `docs/reviews/2026-08-18-kn-work-path-list-b-land.md`. NEXT = **Thinking SOCIAL-OPEN-RANGE-a** (Scooling).

### This session — PRODUCT RELAY refresh (2026-08-18)

Scooling F15 HOME-BIND-a+b **LANDED** ([PR #301](https://github.com/aaronrene/scooling/pull/301) `@9147514`). Product PRIMARY was **Operator + Auto SD-21 land** of `feat/kn-work-path-list-b` (now **LANDED**). `PATH_WRITES_ENABLED` stays default off. **BRAIN-PAIR-b** stays blocked.

### This session — KN-WORK-PATH-LIST-b **DONE** (2026-08-18)

Auto implemented D1–D12 against the freeze. `learning_paths[]` on `hub_flow_store.json`; `GET api/v1/learning-paths` + `GET :path_id`; gated `POST` proposals + apply. Hosted `maybeApplyHostedPathAfterApprove`. T5 not admitted. Seven-tier **44/44**. BV r1 **pass**. `PATH_WRITES_ENABLED` stays default off. No Scooling edits. Tip `feat/kn-work-path-list-b`. NEXT was **Thinking AGENT-WORK-CHAT-HOME-BIND** (Scooling; now DONE).

### This session — KN-WORK-PATH-LIST-a freeze-review **pass** (2026-08-18)

Thinking froze Knowtation path persist + list/get. `/freeze-review-loop` r1–r2 = findings (cited; freeze text only). Round 3 + `ok review --freeze` → **pass**. Digest `sha256:1354ed45531fc4dac329e989727deb9f9f4eb1ed17936a5d65c83b25cb8a1506`. No routes. No env flip. NEXT was **Auto KN-WORK-PATH-LIST-b**.

### This session — KN-DOCS-SYNC-DRIVE-GATE **DONE** (2026-08-17)

Operator authorized Flip Drive gate. Source constant → `true`; seven-tier
docs-oauth tests updated (calendar pattern: `authorizedOverride: false` for
off-path). HUB-API honesty. Notion gate unchanged false. Land via Muse →
muse-mirror → GitHub so Netlify redeploys gateway + bridge.

---

<!-- overseer:next role=lane_tip lane=auth status=live -->
## LANE TIP — Knowtation authorization/security lane

**Date:** 2026-08-11  
**Model:** **Auto**  
**Scope:** Knowtation's own board. Does **not** claim product sequencing.

```text
Step: KN-CRED-STORE-LAND — land the phase8-p1b credential-store repair
Model: Auto
Repo: ~/knowtation (branch feat/knowtation-honesty-gates, committed not landed)
Authority: this board; SD-14 mirror path; Tier 3 for any main merge

Context (verified 2026-08-11, not from memory):
- scripts.test globbed test/*/external-protocol-*.test.mjs, so 29 assertions
  across all seven tiers of phase8-p1b never ran under `pnpm test`.
- Turning them on failed two, both real:
  Argon2id was below its own 50ms floor (median 30.4ms) -> memoryCost raised
  64MiB to 128MiB (median 62ms, OWASP-aligned); DECOY_ARGON2_PHC regenerated to
  match so an unknown username does not become cheaper than a known one.
  The timing-oracle test measured nothing: 40 requests tripped the global
  20/min bucket and the 5-failure lockout, so it compared 31.0ms of half-real
  verifies against 0.72ms of instant rejections. Both guards are now reset per
  sample and each response asserted INVALID_CREDENTIALS.
- Full suite after: 4454 pass, 0 skipped.

Do exactly:
1. Re-run `pnpm test`. Expect 4454 pass / 0 skip.
2. Expect ONE pre-existing unrelated failure:
   test/flow-store-versioned-step-keying-performance.test.mjs asserts p95 <25ms,
   measures ~29.5ms under the parallel suite, passes 3/3 in isolation. Decide
   deliberately: make the budget load-robust, or leave and record as known.
   Do NOT widen the number silently to get green.
3. `ok verify-step --all` -> test_coverage_globs must pass with an
   ARTIFACT_SHA256 (allow_hand_verified is false; you cannot assert it).
4. Muse commit on the feature branch; update this board + docs/ROADMAP.md
   together in that commit.

Do NOT: merge to main without Tier 3; lower ARGON2_PARAMS to make latency
  assertions pass; use assertArgon2ParamsFloor to gate verification of
  already-stored credentials (that would lock out existing users);
  `git push origin main`; touch Scooling CapabilityGates from this board.
```

### PARKED — after APPLE-4-live (do not skip ahead)

| Tip | When |
| --- | --- |
| **APPLE-5-live revisit** | After APPLE-4-live AUTHORIZE → T2+T3 vault |
| **KN-DOCS-SYNC-a/b** | **DONE 2026-08-17** — Drive gate live; Notion remains false. |
| **SEC-KN-P6-ROTATE-b R4–R5** | Independent hygiene; quiet ≥24h window (runbook below) |
| **MuseHub F7** | AWS parked — not required for Apple |

### PARKED — SEC-KN-P6-ROTATE-b R4–R5 (operator 2026-08-01)

**What it is:** Change the shared login-token password (`SESSION_SECRET`) on all
three hosts with a short overlap so nothing drops mid-cutover. **Not** the P6
privilege-escalation fix — that closed at R1/R2.

| Slice | Meaning |
| --- | --- |
| **R4** | Write new secrets: set `SESSION_SECRET_PREVIOUS=OLD` + `SESSION_SECRET=NEW` on Netlify bridge → gateway → EC2 MCP (Tier-3 T2) |
| **R5** | Wait ≥24h (drain OLD tokens) → unset `SESSION_SECRET_PREVIOUS` → verify login / agent exchange / MCP OAuth / vault GitHub status |

**Why parked (recommended):** Live P6 elevation is already closed. Rotation shrinks
blast radius if the old shared secret were ever leaked — valuable hygiene, not an
incident response. Doing it needs a quiet window (≥24h babysit) and may force a
one-time **Connect GitHub** re-connect after the drain closes.

**When to unpark:** A low-traffic stretch where you can watch auth for ~24h+5m,
then paste the runbook below. Until then, P0 (`SESSION_SECRET_PREVIOUS` unset on
all three hosts at `d48fb11c`) is the stable live state.

```text
Step: SEC-KN-P6-ROTATE-b (R4–R5) — UNPARK
Model: Operator + Auto
Authority: knowtation

Consume docs/SEC-KN-P6-ROTATE-FREEZE.md §6 (frozen). P0 code is already live on
gateway+bridge+EC2 (GitHub main d48fb11c, SESSION_SECRET_PREVIOUS unset). Execute
R4 P1 (Tier-3 T2): generate NEW = >=32 random bytes (distinct from OLD; never
commit/log/paste). On ALL THREE hosts in lockstep (bridge -> gateway -> MCP) set
SESSION_SECRET_PREVIOUS = current OLD SESSION_SECRET, then SESSION_SECRET = NEW:
  - Netlify gateway + bridge: `netlify env:set` per site, then redeploy each.
  - EC2 /opt/knowtation/.env: edit both keys, `pm2 restart knowtation-gateway`.
Never leave gateway on NEW-only while bridge still OLD-only. P2: wait >=24h
(HUB_JWT_EXPIRY default 24h + skew; also cover Phase C 900s + MCP OAuth TTL).
P3: unset SESSION_SECRET_PREVIOUS on all three. P4 verify: login/session OK,
Phase C exchange OK, MCP OAuth OK, vault GitHub status OK (§6.4 re-connect once
if decrypt fails), cross-host session 200 with a NEW token, OLD-token control
401 on both hosts. Record evidence in docs/reviews/, mark ROTATE-b DONE,
governance sync. No other posture/env flips. SD-14 muse-mirror only.
```

### After this (queued order)

1. **APPLE-4-live** (Scooling Operator) — T1+T2+T15 together with written evidence.
2. **APPLE-5-live** (Scooling Operator) — T2+T3 vault propose→approve with session vault binding.
3. SEC-KN-P6-ROTATE-b R4–R5 — **PARKED** (unpark runbook above; quiet ≥24h window).
4. MuseHub F7 — AWS-parked.

### This session — KN-APPLE Operator T1 COMPLETE (2026-08-10)

App ID `com.scooling.apple`; Netlify `APPLE_CLIENT_ID` on knowtation-gateway;
live `apple:true`; Xcode Display Name `Scooling` + SIWA capability. Evidence:
`docs/reviews/2026-08-10-kn-apple-t1-complete.md`. PRIMARY → Scooling **APPLE-4-live**.

### This session — KN-APPLE land DONE + T1 partial (2026-08-10)

SD-21 land hygiene **pass**. FF `feat/kn-apple-native-hosted-exchange` → Muse
`main` (`789db7e7…`); audit pins `55930e9c…` + `e2bbdbfa…`; muse-bridge →
[KN #295](https://github.com/aaronrene/knowtation/pull/295) merge `c2a77b1`.
Production gateway ready. Live: `apple:false` + exchange `503 NOT_CONFIGURED`.
Evidence: `docs/reviews/2026-08-10-kn-apple-land-t1-partial.md`. NEXT = set
`APPLE_CLIENT_ID` then APPLE-4-live.

### Prior — KN-APPLE-b Auto DONE + BV pass (2026-08-09)

Implemented `POST /api/v1/auth/native-apple-exchange` + `hub/gateway/apple-identity-token.mjs`
(JWKS verify, allowlists, fail-closed codes); `providers.apple`; env placeholders;
docs/OpenAPI honesty; seven-tier **13/13**; BV round 1 **`pass`**
(`docs/reviews/2026-08-09-kn-apple-b-bv-round1-pass.md`). Bootstrap used Muse tree
with `issueToken` `type:'session'`. No Scooling gate flips; no vault-write authorize;
no App Store; no live Apple probe. Feature branch only.

### Prior this session — KN-APPLE-a Thinking CLEARED (2026-08-09)

Froze `docs/KN-APPLE-NATIVE-HOSTED-EXCHANGE-FREEZE.md` (`frozen: true`). Freeze-review
loop round 2 **`pass`** (`ok review --freeze`; digest `sha256:4ec69573…`). Route
`POST api/v1/auth/native-apple-exchange`; Apple JWKS verify; `issueToken` mint
`provider:apple`; C7 introspect unchanged; Layer-2 HMAC stays in Scooling; not
Passport; not `api/v1/auth/native` PKCE. No route implementation in Thinking.
NEXT = **KN-APPLE-b Auto**.

### Prior — SITE-FINISH-FLOW-RUN-SMOKE / WEB-FINISH / Apple 0–5 (closed on Scooling board)

Product FLOW-RUN SMOKE **PASS** 2026-08-07; WEB-FINISH declared; APPLE-0–5 scaffold
landed inert; APPLE-4-live + APPLE-5-live **DEFER**. Do **not** re-open those tips
from this Knowtation board. See `~/scooling/docs/OVERSEER-HANDOVER.md`.

### This session — board sync (2026-08-09)

Synced KN PRIMARY to **KN-APPLE-NATIVE-HOSTED-EXCHANGE Thinking**. Stale relays
(APPLE-2 / FLOW-RUN-SMOKE as PRIMARY) retired. No Apple exchange code in this tip.

### Prior — SITE-FINISH-FLOW-RUN-KN-b LANDED Muse main (2026-08-06)

FF `feat/site-finish-flow-run-kn-b` → Muse `main` (`a33cba5c…`). Envs remain off
until SMOKE. Hub GitHub/Netlify publish follows muse-bridge this session.

### Prior — SITE-FINISH-FLOW-RUN-KN-b DONE (BV, 2026-08-06)

**Done:** Gateway→bridge proxies for §FR.0.4 run/consent family; bridge
`registerBridgeFlowRunRoutes` + flow-store blob sync; async submit-review for
hosted canister create; seven-tier **10/10**; BV round 1 **`pass`**.
`FLOW_RUN_WRITES_ENABLED` / `FLOW_AUTOMATABLE_EXECUTION_ENABLED` remain default
**off**. No SC posture flip. Branch `feat/site-finish-flow-run-kn-b`.
Evidence: `docs/reviews/2026-08-06-site-finish-flow-run-kn-b-bv-round1-pass.md`.

### Prior — hosted attach kn1 LANDED + Hub published (2026-08-04)

Root cause: `stageCanisterNoteToTempVault` yaml→`readNote` uses `parseFrontmatterAndBody`
`trimEnd` on body; Hub GET keeps trailing newlines → client `kn1_` ≠ staged `kn1_` →
false `MEDIA_LINEAGE_CONFLICT`. Fix: `liveStateId` from canister GET on stage;
`liveStateIdOverride` on propose + approve precheck; attach write-back prefers canister
body. Tests: `test/sec-seam-media-hosted.test.mjs`. Muse merge →
[PR #290](https://github.com/aaronrene/knowtation/pull/290) `baa41bf` MERGED; Netlify
bridge+gateway production **ready** at `baa41bf`. Audit overrides commit
`6518a12b…` included in land. NEXT = **Scooling attach SMOKE**.

### Prior — SEC-SEAM-MEDIA-b DONE (BV pass, 2026-08-01)

Auto on `feat/sec-seam-media-b` implemented SM-C1–C12: gateway media approve hook
after capture; `media-hosted-proposal.mjs` normalize/create/apply; S3.1 media
normalize in `isSeamSurfaceProposal` same change; bridge media routes + blob sync;
media_attach temp-stage canister note RMW + propose-time `media_pointer` stamp;
OpenAPI apply-approved + PROPOSAL-LIFECYCLE honesty; S7.3 sentinel updated for
hosted routes. Seven-tier + SEC-SEAM-1 **50/50** (sha256 `2f7bf57d…`). BV round 1
= `pass`. Contained in Muse `main` at `364c712a…` (parent of kn1-stage branch).
No MEDIA_*/SCOOLING_MEDIA_* flips; no SESSION_SECRET writes; P6 R4–R5
untouched.

### Prior this session — SEC-SEAM-MEDIA-a DONE (freeze pass, 2026-08-01)

Thinking on `feat/sec-seam-media-a`. Wrote `docs/SEC-SEAM-MEDIA-FREEZE.md`
(`frozen: true`, SM-C1–C12). Freeze-review loop: mechanical C4 rewrite → semantic
media_attach IO-adapter + OpenAPI in-scope → `ok review --freeze` **pass**
(`sha256:f9c58fd3…`). No product code, no deploy, no env/posture flips, P6 R4–R5
untouched. NEXT was **SEC-SEAM-MEDIA-b** Auto.

### Prior this session — SEC-KN-P6-ROTATE-b R1–R3 + P0 deploy; R4–R5 PARKED (2026-08-01)

Operator + Auto. **R1 (T1):** EC2 `knowtation-mcp-gateway` (`i-025679d93cf47aeab`,
`/opt/knowtation`, PM2) fast-forwarded `257ef705 → 15fba5f5` (current main, SEC-KN-3
markers present), `npm ci` clean on Node v20, PM2 restart healthy. **R2 (§5.1) PASS:**
scopes-exact `["propose","vault:read"]` `agent_access` discard of a nonexistent proposal →
**gateway 401 / MCP 401** (pre-deploy MCP gave `200`); controls green. **R3:**
`hub/lib/session-secret-rotation.mjs` (`verifyJwtWithSecretRotation`, fail-closed) wired at
**all nine G10 sites**; signing/HMAC/encrypt stay primary-only; README §Post-deploy #4;
seven-tier suite `test/sec-kn-p6-session-secret-rotation.test.mjs` 30/30 incl. G10 source
scan; 2 stale single-secret source-shape assertions refreshed (property preserved). Full
suite 4378/4380 (1 unrelated flow-store perf flake, green in isolation). **BV round 1 =
`pass`** (independent verifier; corrected claim: SEC-KN-3 suite is **19/19**, not "31/31").
Muse `635cfdef` → Muse `main` (ff), muse-mirror **PR #288 merged** `d48fb11c` (SD-14/SD-21;
CI + TruffleHog green). **P0 deploy:** Netlify gateway + bridge + EC2 all pulled `d48fb11c`
and restarted healthy (local `/health` 200) with `SESSION_SECRET_PREVIOUS` unset.
**Operator parked R4–R5** (hygiene, not emergency; unpark when a ≥24h babysit window
exists). Evidence: `docs/reviews/2026-08-01-sec-kn-p6-rotate-b-r1-r2-deploy-probe.md`.

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
- [x] **SEC-SEAM-MEDIA-a** — hosted media freeze (**Thinking**) — **DONE 2026-08-01** (`docs/SEC-SEAM-MEDIA-FREEZE.md`, digest `sha256:f9c58fd3…`)
- [x] **SEC-SEAM-MEDIA-b** — hosted media build (**Auto**) — **DONE 2026-08-01** (BV round 1 = `pass` on `feat/sec-seam-media-b`; not merged)
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
| **Overseer Kit** | `initialized: true`, `lock.kit_version: 0.1.0`, `footprint_self_integrity: ok`, `muse_sync: synced` — **re-verified 2026-08-18** via `ok -C ~/knowtation status --json` |
| **KN-WORK-PATH-LIST** | **LANDED** 2026-08-18 — Muse `main` `sha256:87cf7a0d…` → [PR #299](https://github.com/aaronrene/knowtation/pull/299) `@005d00ff`. `PATH_WRITES_ENABLED` default off. |
| **Footprint deviation (intentional)** | `ok status --check-footprint` → `footprint_integrity: mismatch`. Cause: `MUSE-BRIDGE-WORKFLOW.md` and `scripts/muse-bridge-deploy.sh` were restored to Knowtation's live versions (sha256 `ef8a50b5…` and `fcc17c36…`) after `init --force` overwrote them with kit templates. Knowtation's bridge script is 10,004 bytes and is the live deploy path; the kit template is 3,842 bytes and is **not** a substitute. **Do not "repair" these two files.** Recorded in `.overseer/config.yaml` → `kit.notes`. |
| **Canister gateway auth secret** | **SET** (2026-07-26) — hub `rsovz-byaaa-aaaaa-qgira-cai`; `GET /vaults` without `X-Gateway-Auth` → `403 GATEWAY_AUTH_REQUIRED`. `operator_status` does not exist on canister. |
| **SEC-KN-1 fail-closed** | **On Muse `main`** (tip contained). Live health `gateway_auth_configured:true` + `/vaults` → `403 GATEWAY_AUTH_REQUIRED` (**re-verified 2026-07-31**). |
| **SEC-KN-2 server-only eval** | **On Muse `main`** (finish/SEC land path). |
| **SEC-KN-3 mcp_access role cap** | **On Muse `main`** (tip `5954c433…` ancestor; GitHub mirror since `69a7673`). **EC2 MCP host on current main** (`d48fb11c`, 2026-08-01 R1); R2 discard probe **401/401**. |
| **SEC-KN-4 P4 (delegation principal)** | **On Muse `main`** (SEC-KN-4a tip contained). SEC-KN-4c identity restore **DONE + landed 2026-08-01** (BV `pass`; Muse `main` `2466ad64…` + muse-mirror). Live module hash `0x039360a0…` re-verified 2026-08-01 (matches T4); no redeploy. Live proposal `created_by` **CONFIRMED-POPULATED** (2026-08-01 P6-VERIFY sidecar). |
| **SEC-KN-3a (RBAC assertion refresh)** | **DONE** (BV round 1 = `pass`); on Muse `main` via SEC-KN-4a lineage. |
| **SEC-KN-5 (P12 TTL clamp + P13 admin mint)** | **DONE** (BV round 1 = `pass`); on Muse `main` path. |
| **SEC-KN-6 (P14 constant-time compare)** | **On Muse `main`** (tip contained); live health surface present 2026-07-31. |
| **SEC-SEAM-1 (P3 session-bound identity)** | **On Muse `main`** (tip contained 2026-07-31). Scooling L-SEAMb already landed (SC #219). |
| **Knowtation Netlify env** | Site `knowtation-gateway` (`api.knowtation.store`, id `3123cc84-…`): `CANISTER_AUTH_SECRET` present, `SESSION_SECRET` present, `HUB_ADMIN_USER_IDS` present, `HUB_EVALUATOR_MAY_APPROVE` **absent** (fail-safe). |
| **MCP host / gateway `SESSION_SECRET` sharing** | **VERIFIED-SHARED** (2026-08-01). Dual-verify helper **P0 live** on gateway+bridge+EC2 (`d48fb11c`, `SESSION_SECRET_PREVIOUS` unset). **R4–R5 secret rotation PARKED** — unpark runbook in NEXT PARKED block. Evidence: share doc + `docs/reviews/2026-08-01-sec-kn-p6-rotate-b-r1-r2-deploy-probe.md`. |

## Hard stops

- Never `git push origin main` — GitHub `main` only via a `muse-mirror → main` PR after a Tier 3 Muse `main` merge
- Never merge to Muse `main` without operator authorization (Tier 3)
- Never claim a runtime/security state without running the check in the same session
- **Delegation intents are never eligible for personal self-apply** (P4) — this is not a tuning knob
- Do not re-sync `MUSE-BRIDGE-WORKFLOW.md` / `scripts/muse-bridge-deploy.sh` from the kit

## Change log

| Date | Event |
| --- | --- |
| 2026-08-24 | **AIP-b LANDED (SD-21).** Muse FF `feat/automation-ingest-policy-b` → `main` `sha256:4f7a536…`; muse-bridge → GitHub [PR #308](https://github.com/aaronrene/knowtation/pull/308) `@e9300f2`. Born Free templates stay disabled. Production ingest smoke **not** claimed — Operator T2 next. Evidence: `docs/reviews/2026-08-24-automation-ingest-policy-b-land.md`. **AIP-c** not started. |
| 2026-08-20 | **PRODUCT RELAY → Operator F20 after F31b land.** Scooling F31b **LANDED** [SC #315](https://github.com/aaronrene/scooling/pull/315) `@b2e643b4`. PRIMARY = F20 re-smoke after Netlify redeploy; read `data-next-step` (endpoint / malformed / abort / runtime). Canonical fence on Scooling board. MuseHub F7 parallel. This board does not Auto Scooling. Path writes stay ON. T5 not admitted. |
| 2026-08-20 | **PRODUCT RELAY → Operator F20 HELPER-SMOKE re-smoke.** Scooling F30b **LANDED** [SC #313](https://github.com/aaronrene/scooling/pull/313) `@52aaac5c`. PRIMARY = F20 re-smoke after Netlify redeploy; read `data-next-step`. Canonical fence on Scooling board. MuseHub F7 parallel. This board does not Auto Scooling. Path writes stay ON. T5 not admitted. |
| 2026-08-20 | **PRODUCT RELAY → Thinking F30 HELPER-RUNTIME-REFUSE-a** (superseded same day by F30b land → F20). Scooling F20 re-smoke **FINDINGS** after F29b [SC #311](https://github.com/aaronrene/scooling/pull/311) redeploy. Bearer + JSON contract on apex; helper still refuses. Path writes stay ON. T5 not admitted. |
| 2026-08-19 | **PRODUCT RELAY → Thinking F18-P0a HELPER-API-KEY.** Operator Groq + Netlify env reported. Bearer freeze is Scooling PRIMARY. Helper still refuses until code + smoke. MuseHub F7 parallel. This board does not Auto Scooling. Path writes stay ON. T5 not admitted. |
| 2026-08-19 | **PRODUCT RELAY → Operator F18-P0 after F19b land.** Scooling F19b **LANDED** [SC #305](https://github.com/aaronrene/scooling/pull/305) `@8051402`. PRIMARY was helper URL (superseded same day). Helper invoke still refuses. MuseHub F7 parallel. This board does not land Scooling. Path writes stay ON. T5 not admitted. |
| 2026-08-19 | **PRODUCT RELAY → SD-21 land F19b.** Scooling PRIMARY is land of `feat/drive-home-copy-b` after F19b BV pass. Helper invoke still refuses. MuseHub F7 parallel. This board does not land Scooling. Path writes stay ON. T5 not admitted. |
| 2026-08-19 | **PRODUCT RELAY → F18 FINISH-LINE-HONESTY-a.** Scooling PRIMARY is Thinking freeze-review of `~/scooling/docs/reviews/2026-08-19-finish-line-honesty.md`. Helper invoke still refuses. MuseHub F7 parallel. This board does not Auto F18. Path writes stay ON. T5 not admitted. |
| 2026-08-19 | **Path writes ON + Scooling F16/F17 LANDED.** `PATH_WRITES_ENABLED=1` Netlify gateway+bridge (prod+DP); rebuilds ready. T5 not admitted. Scooling [PR #303](https://github.com/aaronrene/scooling/pull/303) `@dff211d`. Product NEXT was **Operator MuseHub F7** (same-day superseded by F18). Evidence: `~/scooling/docs/reviews/2026-08-19-f16-f17-path-writes-land.md`. |
| 2026-08-18 | **PRODUCT RELAY refresh.** Scooling PRIMARY = **Thinking AGENT-WORK-CHAT-LIVE-a** (F16). Honesty inventory on Scooling. MuseHub F7 parallel. This board does not Auto F16 or SOCIAL. `PATH_WRITES_ENABLED` stays off. |
| 2026-08-18 | **PRODUCT RELAY refresh.** Scooling SOCIAL-OPEN-RANGE-a freeze-review **pass** (`sha256:89a7f2e0…`). Product NEXT was **Operator MuseHub F7**. SOCIAL-OPEN-RANGE-b Auto parked. This board does not Auto SOCIAL. `PATH_WRITES_ENABLED` stays off. |
| 2026-08-18 | **Standing brief.** Launch-finish 1–4 done. Product NEXT remains **Thinking SOCIAL-OPEN-RANGE-a** (Scooling). Leftovers stay labeled; this board does not Auto SOCIAL. `PATH_WRITES_ENABLED` stays off. |
| 2026-08-18 | **KN-WORK-PATH-LIST-b LANDED (SD-21).** Muse FF `feat/kn-work-path-list-b` → `main` `sha256:87cf7a0d…`; muse-bridge → GitHub [PR #299](https://github.com/aaronrene/knowtation/pull/299) `@005d00ff`. `PATH_WRITES_ENABLED` stays off. Evidence: `docs/reviews/2026-08-18-kn-work-path-list-b-land.md`. Product NEXT = **Thinking SOCIAL-OPEN-RANGE-a** (Scooling). **BRAIN-PAIR-b** stays blocked. |
| 2026-08-18 | **PRODUCT RELAY refresh.** Scooling F15 HOME-BIND **LANDED** ([PR #301](https://github.com/aaronrene/scooling/pull/301) `@9147514`). Product NEXT was **Operator + Auto SD-21 land** of `feat/kn-work-path-list-b` (now landed). `PATH_WRITES_ENABLED` stays off. |
| 2026-08-18 | **KN-WORK-PATH-LIST-b DONE — BV round 1 = `pass`.** D1–D12 on `feat/kn-work-path-list-b`: `learning_paths[]` in `hub_flow_store.json`; list/get REST; gated propose/apply (`PATH_WRITES_ENABLED` default off); hosted `maybeApplyHostedPathAfterApprove`; T5 not admitted. Seven-tier **44/44** (`test/path-list-*.test.mjs`, sha256 `a733bb9f…`). Evidence: `docs/reviews/2026-08-18-kn-work-path-list-b-bv-round1-pass.md`. No Scooling edits. No write-gate flip. Product NEXT = **Thinking AGENT-WORK-CHAT-HOME-BIND** (Scooling). |
| 2026-08-06 | **SITE-FINISH-FLOW-RUN-KN-b DONE — BV round 1 = `pass`.** Gateway→bridge §FR.0.4 run/consent proxies + bridge `registerBridgeFlowRunRoutes` (flow-store blob sync); async submit-review for hosted canister create; seven-tier **10/10** (`test/site-finish-flow-run-kn-b.test.mjs`, sha256 `0f6d17ac…`). `FLOW_RUN_WRITES_ENABLED` / `FLOW_AUTOMATABLE_EXECUTION_ENABLED` stay default off. No SC posture flip. Branch `feat/site-finish-flow-run-kn-b`. Evidence: `docs/reviews/2026-08-06-site-finish-flow-run-kn-b-bv-round1-pass.md`. Product NEXT = **SITE-FINISH-FLOW-RUN-flip**. |
| 2026-08-04 | **Hosted attach kn1 LANDED + published.** Muse `main` `d3f6da81…` + audit `6518a12b…` → [PR #290](https://github.com/aaronrene/knowtation/pull/290) `baa41bf` MERGED; Netlify bridge+gateway production ready at `baa41bf`. Canister GET `liveStateIdOverride` clears yaml-stage `trimEnd` false `MEDIA_LINEAGE_CONFLICT`. NEXT = Scooling HMS attach SMOKE. |
| 2026-08-04 | **Hosted attach kn1 stage fix (code).** `feat/hosted-media-attach-kn1-stage`: canister GET `liveStateId` / `liveStateIdOverride` so yaml-stage `trimEnd` cannot false-`MEDIA_LINEAGE_CONFLICT`; attach write-back keeps canister body. Tests in `test/sec-seam-media-hosted.test.mjs`. No posture/env flips. |
| 2026-08-01 | **SEC-SEAM-MEDIA-b DONE — BV round 1 = `pass`.** SM-C1–C12 on `feat/sec-seam-media-b`: gateway `maybeApplyHostedMediaAfterApprove` after capture; `lib/attachments/media-hosted-proposal.mjs`; S3.1 media normalize in `isSeamSurfaceProposal` same change; bridge propose/consent/list/get/apply-approved + `media-blob-store`; media_attach temp-stage canister note RMW + propose-time `media_pointer`; OpenAPI + PROPOSAL-LIFECYCLE honesty; S7.3 sentinel updated. Seven-tier + SEC-SEAM-1 **50/50** (sha256 `2f7bf57d…`). No MEDIA_*/SCOOLING_MEDIA_* flips; no SESSION_SECRET writes; P6 R4–R5 untouched. Contained in Muse `main` `364c712a…`. |
| 2026-08-01 | **SEC-SEAM-MEDIA-a DONE — freeze-review `pass`.** `docs/SEC-SEAM-MEDIA-FREEZE.md` (`frozen: true`, digest `sha256:f9c58fd3…`): SM-C1–C12 hosted media propose+apply; S3.0 same-change hook+`normalizeCanisterProposalForMediaPrecheck`; media_attach canister note IO adapter; blob media stores; no posture/env flip; P6 R4–R5 stayed parked. Branch `feat/sec-seam-media-a`. NEXT was **SEC-SEAM-MEDIA-b** Auto. |
| 2026-08-01 | **SEC-KN-P6-ROTATE-b R1–R3 DONE; R4–R5 PARKED.** EC2 deploy + R2 discard 401/401 (elevation closed); dual-verify helper P0 live on gateway+bridge+EC2 (`d48fb11c`, PR #288); BV `pass`. Operator parked R4–R5 (hygiene, not emergency — need ≥24h babysit window). NEXT was **SEC-SEAM-MEDIA-a** Thinking; unpark runbook stays in handover PARKED block. |
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

