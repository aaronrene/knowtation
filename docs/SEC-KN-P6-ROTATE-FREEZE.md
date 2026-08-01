# SEC-KN-P6-ROTATE — frozen spec: JWT signing-domain decision + dual-secret rotation

**Phase:** SEC-KN-P6-ROTATE (`SEC-KN-P6-ROTATE-a` Thinking freeze → `SEC-KN-P6-ROTATE-b` Operator + Auto)
**Freeze status:** **CLEARED for `SEC-KN-P6-ROTATE-b`** — freeze-review `pass` (mechanical + semantic)
**Date:** 2026-08-01
**Model (this artifact):** Thinking
**Owner repo:** Knowtation
**Driving inputs:**
- Pass 2 **P6** — `~/scooling/docs/PRE-BUILD-SECURITY-AUDIT-FINDINGS-PASS2.md` (row `P6`)
- Share evidence — `docs/reviews/2026-08-01-sec-kn-p6-verify-session-secret-share.md` (`VERIFIED-SHARED`)

## Freeze-contract declaration

```yaml
phase: SEC-KN-P6-ROTATE-a
outputs:
- id: sec-kn-p6-rotate-freeze
  path: docs/SEC-KN-P6-ROTATE-FREEZE.md
  frozen: true
  notes: 'One JWT signing domain (gateway+bridge+MCP host). Deploy current main to EC2 before any secret rotation. Dual-secret (SESSION_SECRET + SESSION_SECRET_PREVIOUS) zero-downtime cutover. No rotation/env/posture flip/deploy in Thinking.

    '
frozen_inputs:
- id: p6-share-verify
  path: docs/reviews/2026-08-01-sec-kn-p6-verify-session-secret-share.md
  notes: frozen:true; verdict VERIFIED-SHARED (Outcome B)
- id: pass2-audit
  path: ~/scooling/docs/PRE-BUILD-SECURITY-AUDIT-FINDINGS-PASS2.md
  notes: P6 MAJOR — mcp_access allowlist elevation; exploitability depends on shared SESSION_SECRET
- id: gateway-readme-postdeploy
  path: hub/gateway/README.md
  notes: §Post-deploy verification
- id: resolve-hosted-actor-role
  path: hub/gateway/server.mjs
  notes: SEC-KN-3 resolveHostedActorRole + decodeVerifiedToken / getUserId
- id: access-token-authz
  path: hub/gateway/access-token-authz.mjs
  notes: roleFromMcpAccessScopes + mayApplyAdminAllowlistOverride
review_stamp:
  reviewed_at: '2026-08-01T14:44:54Z'
  verdict: pass
  reviewer_mode: agent
  reviewer_model: thinking-high
  reviewer_provider: local
  kit_version: 0.1.0
  artifact_digest: sha256:958c8add4bfba1d5ab6528673ef8cf0a3f692ecfd6b98a587c82d2f01702b959
downstream:
- id: SEC-KN-P6-ROTATE-b
  model: Operator + Auto
  consumes_as_ground_truth: true
  notes: 'Execute D2 order R1→R5: EC2 deploy of current main (T1), R2 role-cap probe, R3 dual-secret verify helper on every access-JWT jwt.verify site, BV pass, R4–R5 Tier-3 env rotation (T2). No Thinking redesign.

    '
tier3_gates:
- T1 Deploy / restart of the EC2 MCP host process (git pull + npm ci + PM2 restart)
- T2 Any SESSION_SECRET / SESSION_SECRET_PREVIOUS / HUB_JWT_SECRET env write on Netlify gateway, Netlify bridge, or EC2
- T3 Muse main merge outside SD-21 land hygiene; muse push staging; live posture / write-env / Delegation gate flips
- T4 GitHub PR head that is not muse-mirror targeting main (SD-14)
```

## Review record

| Round | Reviewer | Verdict | Resolution |
| --- | --- | --- | --- |
| 0 | Thinking (this session) | draft | Freeze authored from share evidence + source + live probes |
| 1 | `ok review --freeze` (mechanical) | blocked | CLI-F1 C4 absolute-path false positive on leading-slash API routes + cutover cells that looked like `secret` assignments; rewritten to prose / previous←OLD form |
| 2 | Freeze-review loop (thinking) + `ok review --freeze` | findings → **pass** | Sem-F1: expand dual-secret wiring to every access-JWT `jwt.verify` site (not only `decodeVerifiedToken` / bridge `:844`). Sem-F2: downstream stamp notes reordered to match §4 D2 (R1 deploy → R2 probe → R3 code → R4–R5 env). Cleared for ROTATE-b. |

---

## P6-R0 — Citation readiness

Every freeze-review / build-verification finding against this artifact **must** cite
**file+line**. Uncited findings are invalid.

---

## 1. Plain-language summary

The Hub API and the always-on MCP machine currently trust the **same password** for signing
login tokens. That was proven, not guessed. The machine that runs MCP is also running **older
software** than the live Netlify API — a discard call that the API correctly refuses is accepted
on the MCP host. Before anyone changes the password, that machine must be updated to today's
code (which already blocks agent tokens from inheriting admin). After that, rotate the shared
password with a short overlap window so nothing drops mid-cutover. Do **not** give the MCP host
a different password from the API/bridge pair — that would break vault backup / GitHub connect
and cross-host agent tokens.

### Technical summary

`SESSION_SECRET` is **VERIFIED-SHARED** across `api.knowtation.store` (Netlify gateway) and
`mcp.knowtation.store` (EC2 nginx→Node). Gateway↔bridge parity remains mandatory
(`hub/gateway/README.md:113`). SEC-KN-3 (`resolveHostedActorRole` scope-cap for `mcp_access` /
`agent_access`) **is on Muse `main` and GitHub `origin/main`** (board "not merged" row is
stale). EC2 runtime is **behind current main** (live probe: identical `agent_access` JWT →
gateway discard `401`, MCP discard `200`). Frozen path: **one signing domain**, **deploy
current main to EC2 first** (closes live P6 elevation without requiring a split), then
**Tier-3 dual-secret rotation** of the shared secret.

---

## 2. Ground truth (file+line — read this session)

| # | Fact | Citation |
| --- | --- | --- |
| G1 | Gateway verifies JWTs with a single `SESSION_SECRET` (`jwt.verify(token, SESSION_SECRET)`) | `hub/gateway/server.mjs:156`, `:245`, `:262` |
| G2 | Bridge requires the same env for JWT + GitHub-token crypto | `hub/bridge/server.mjs:100`, `:844`; README post-deploy #3 `hub/gateway/README.md:113` |
| G3 | Share is **VERIFIED-SHARED** — gateway-signed JWT accepted on both hosts' session introspection route (`api/v1/auth/session`); hosts proven distinct (Netlify vs nginx) | `docs/reviews/2026-08-01-sec-kn-p6-verify-session-secret-share.md:49-70` |
| G4 | SEC-KN-3 caps `mcp_access` / `agent_access` via early return; allowlist override gated by `mayApplyAdminAllowlistOverride` | `hub/gateway/server.mjs:3098-3134`, `:3175-3188`; `hub/gateway/access-token-authz.mjs:80-84`, `:119-121` |
| G5 | SEC-KN-3 tip `5954c433…` is an **ancestor of Muse `main`**; GitHub `origin/main` contains the SEC-KN-3 markers in `server.mjs` (first mirrored at git `69a7673`, 2026-07-27) | Muse `merge-base feat/sec-kn-3-mcp-access-role-cap main` → `5954c433…`; `git show origin/main:hub/gateway/server.mjs` lines 3098+ |
| G6 | Phase C `agent_access` mutating REST is path-scoped: `propose` allows only create paths, **not** approve/discard | `hub/lib/agent-credential-core.mjs:366-388`; `hub/gateway/access-token-authz.mjs:173-178`; `getUserId` → `subFromVerifiedPayload` at `hub/gateway/server.mjs:1628-1634` |
| G7 | Discard RBAC uses `resolveHostedActorRole`; non-admin → `403` `"Discard requires admin."` | `hub/gateway/server.mjs:3241-3248` |
| G8 | Session introspection (`api/v1/auth/session`) returns **JWT claims only** (`payload.role`), **not** `resolveHostedActorRole` — useless as a SEC-KN-3 detector | `hub/gateway/server.mjs:480-499` |
| G9 | Netlify does **not** mount stateful `/mcp`; MCP lives on the persistent host | `hub/gateway/server.mjs:751-798` (mount posture); Pass 2 P6 row |
| G10 | No dual-secret verify helper exists today — every access-JWT verify is single-secret `jwt.verify(…, SESSION_SECRET)` | Gateway: `hub/gateway/server.mjs:245`, `:262`, `:3114`; `hub/gateway/metadata-bulk-canister.mjs:31`; `hub/gateway/mcp-oauth-provider.mjs:328`. Bridge: `hub/bridge/server.mjs:844`; `hub/bridge/flow-routes.mjs:81`; `hub/bridge/flow-capture-routes.mjs:98`; `hub/bridge/task-routes.mjs:106` |
| G11 | Web-session JWT default expiry is `HUB_JWT_EXPIRY` or **`24h`** — drain window must cover this, not only Phase C's 900s exchange TTL | `hub/gateway/server.mjs:157` |

### 2.1 Live probes this Thinking session (2026-08-01)

| Probe | Result | Meaning |
| --- | --- | --- |
| Host identity `/health` | GW `server: Netlify` + `x-nf-request-id`; MCP `Server: nginx/1.24.0 (Ubuntu)`, distinct CORS | Hosts still distinct (reconfirms G3) |
| Session with gateway-minted `agent_access` | **200** on GW and MCP | Shared secret still holds |
| `POST …/proposals/prop-p6-rotate-probe-nonexistent-0000/discard` with same token | **GW `401 UNAUTHORIZED`**; **MCP `200`** (empty body) | MCP lacks current Phase C `getUserId` refuse for non-create POST → **EC2 runtime ≠ current main** |
| `GET` same fake proposal id | **404 `NOT_FOUND`** on both | Fake id is not a real proposal; MCP `200` discard was not "found and discarded a real row" via GET |

**Interpretation (frozen):** EC2 is **pre-current-main** for agent REST authz. Because SEC-KN-3 and Phase C both live on `main` (G5), deploying current `main` to EC2 is the **first** remediation. The MCP `200` is **not** treated as a completed privilege-escalation proof (approve of a real pending proposal was not run; further mutate probes were stopped by the session mandate / auto-review). It **is** sufficient to gate "deploy before rotate" and to reject "rotation alone fixes P6."

**Board correction (frozen):** ROADMAP row text **"SEC-KN-3 … not merged to main"** is **false as of this session**. Status must be corrected to **landed on Muse/`main` + GitHub `main`**; residual is **EC2 runtime lag**, not missing source.

---

## 3. Decision D1 — one signing domain (not a naive split)

### D1 (selected): **ONE signing domain**

Hosts that must share one HS256 secret (byte-identical `SESSION_SECRET` / `HUB_JWT_SECRET`):

| Host | Why in the domain |
| --- | --- |
| Netlify gateway (`api.knowtation.store`) | Issues web-session + `agent_access` JWTs |
| Netlify bridge | Must verify gateway JWTs for vault routes (`api/v1/vault/*`) + Connect GitHub (`hub/gateway/README.md:113`) |
| EC2 MCP host (`mcp.knowtation.store`) | Runs the same gateway app; mints `mcp_access`; today already verifies gateway-issued JWTs (G3) |

### D1-reject: split MCP host onto a different secret

| Reason | Detail |
| --- | --- |
| Breaks README #3 class of failures | Bridge/gateway mismatch already breaks vault GitHub status; splitting MCP without a dual-verify design repeats that class for agent/MCP tokens |
| Breaks intentional cross-host JWT use | Phase C credentials exchange on the gateway; operators and agents present those JWTs to MCP (G3 proved acceptance) |
| Does not replace SEC-KN-3 | Elevation is a **role-resolution** bug, not a sharing bug; isolation without SEC-KN-3 still elevates **on the MCP host** for tokens it itself mints |
| Extra code + dual cutover | Would need issuer/audience separation or dual-verify on every `jwt.verify` site (G1/G10) — out of scope vs deploy+rotate |

**P6 control plane (frozen):** shared secret is **accepted**. The live control is **SEC-KN-3 (+ Phase C path gates) running on every host that mounts `/mcp` or `resolveHostedActorRole`**. Rotation shrinks blast radius of the shared secret; it is not a substitute for the code deploy.

---

## 4. Decision D2 — remediation order (deploy before rotate)

```text
R0  Confirm / close EC2 code-version (this freeze §2.1 already shows pre-current-main)
R1  Tier-3: deploy current GitHub/Muse main to EC2 MCP host (T1)
R2  Re-probe role-cap (must see SEC-KN-3 shape — §5)
R3  Auto (if needed): land dual-secret verify helper on all verify sites (G10)
R4  Tier-3: dual-secret env rotation across gateway + bridge + MCP (T2) — §6
R5  Drain window → remove SESSION_SECRET_PREVIOUS → final verify
```

| If after R1… | Then |
| --- | --- |
| R2 shows SEC-KN-3 shape on MCP (discard/approve RBAC refuses non-admin agent tokens) | Live P6 elevation path is **closed by deploy**. Continue to R3–R5 for shared-secret hygiene (still required — VERIFIED-SHARED blast radius). |
| R2 still shows pre-cap / anomalous accept | **Stop.** Do not rotate. Escalate — EC2 is not running the tree you think (wrong checkout, failed PM2 restart, second process). |

**Forbidden improvisation:** rotating secrets while EC2 still runs pre-current-main code; splitting secrets without a new freeze; treating session `role` (G8) as proof of SEC-KN-3.

---

## 5. R0 / R2 probe contract (governed — Operator + Auto)

### 5.1 Preferred non-destructive RBAC probe

Goal: observe `assertHostedProposalApproveDiscard` outcome without approving a real pending proposal.

1. Exchange Phase C credential → short-lived `agent_access` with scopes **exactly** `["propose","vault:read"]` (no `vault:write`, no `admin`).
2. `POST` discard on a nonexistent proposal id (`api/v1/proposals/<id>/discard`) on **gateway** and **MCP** with `X-Vault-Id: default`.
3. Expected **after** current-main deploy on both:

| Host | Expected | Why |
| --- | --- | --- |
| Gateway | `401 UNAUTHORIZED` | `getUserId` / `agentScopesPermitMethod` refuses discard path (G6) |
| MCP | `401 UNAUTHORIZED` **or** `403 FORBIDDEN` `"Discard requires admin."` | Same code tree: either scope gate (401) or role cap (403). **Never `200`.** |

4. Controls: session `200` on both (secret still shared); garbage token `401` on MCP; GET nonexistent id `404` on both.

**Pass criterion for R2:** MCP matches gateway's refuse class (`401` or `403`); MCP must **not** return `2xx` for discard of a nonexistent id with a non-admin `agent_access` token.

### 5.2 Optional elevation confirmation (operator-only)

Only if R2 is ambiguous: mint/obtain `mcp_access` for an allowlisted admin `sub` with **non-admin scopes**, attempt discard of nonexistent id, expect `403` (not canister success). Do **not** approve a real pending proposal as a probe. Record evidence under `docs/reviews/` without printing tokens.

### 5.3 Filesystem SHA probe (operator SSH — alternative R0)

On EC2, read the running checkout SHA / `git rev-parse HEAD` and confirm it is a descendant of Muse/GitHub commits that contain `mayApplyAdminAllowlistOverride` in `hub/gateway/server.mjs`. This is Tier 3 only insofar as SSH access is operator-held; it does not flip env.

---

## 6. Dual-secret zero-downtime rotation runbook (Tier 3)

### 6.1 Env contract (frozen names)

| Variable | Role |
| --- | --- |
| `SESSION_SECRET` (or `HUB_JWT_SECRET` fallback — keep today's resolution order) | **Primary** — used to **sign** new JWTs and tried **first** on verify |
| `SESSION_SECRET_PREVIOUS` | **Verify-only** during cutover — accepted if primary verify fails; **never** used to sign |

Bridge and gateway and MCP must move in lockstep through the phases below. Bridge GitHub-token ciphertext is keyed by `SESSION_SECRET` (`hub/bridge/server.mjs:289-328`) — rotating without dual-accept **and** without re-connect guidance can break stored GitHub tokens; see §6.4.

### 6.2 Code prerequisite (R3 — Auto, before env flip)

Introduce a single helper used by **every** HS256 access-JWT verify site listed in **G10** (not a subset — missing one host/path during P1–P2 means OLD tokens 401 on that path while others still accept them):

```text
verifyJwtWithSecretRotation(token, primary, previous) -> payload | null
  try jwt.verify(token, primary)
  if fail && previous: try jwt.verify(token, previous)
  else null
```

**Mandatory wire-up (frozen — Auto may add a shared import but may not omit a G10 site):**

| Site | Citation |
| --- | --- |
| Gateway `verifyToken` | `hub/gateway/server.mjs:243-252` |
| Gateway `decodeVerifiedToken` | `hub/gateway/server.mjs:260-266` |
| Gateway `resolveHostedActorRole` bearer verify | `hub/gateway/server.mjs:3113-3115` |
| Gateway metadata bulk | `hub/gateway/metadata-bulk-canister.mjs:31` |
| Gateway MCP OAuth provider | `hub/gateway/mcp-oauth-provider.mjs:328` |
| Bridge Bearer verify | `hub/bridge/server.mjs:844` |
| Bridge flow / capture / task route verifies | `hub/bridge/flow-routes.mjs:81`; `flow-capture-routes.mjs:98`; `task-routes.mjs:106` |

**Fail-closed rules:**

- Empty/missing primary → refuse configure / refuse verify (no silent "previous-only" sign-in).
- `previous === primary` → treat as misconfig in tests; production may no-op but must not weaken verify.
- Signing (`jwt.sign`, image-proxy HMAC, bridge encrypt of GitHub tokens) uses **primary only**.
- Logs / errors / responses must never echo secret material (existing no-secrets bar).
- HMAC / encrypt paths that are **not** JWT verify (bridge GitHub token encrypt, image-proxy HMAC, internal request HMAC) are **out of** the dual-verify helper — they stay primary-only (§6.4 for GitHub ciphertext).

Seven-tier tests required in ROTATE-b for the helper + wiring (security tier must fail against single-secret-only verify when a previous-signed token is presented during the window; a source-scan tier must assert every G10 site calls the helper).

### 6.3 Cutover phases (operator)

| Phase | Gateway (Netlify) | Bridge (Netlify) | MCP (EC2) | Traffic effect |
| --- | --- | --- | --- | --- |
| **P0** | Deploy dual-verify code; primary secret remains OLD; `SESSION_SECRET_PREVIOUS` unset | Same | Same (after R1) | Identical to today |
| **P1** | Set previous←OLD and primary←NEW | Set previous←OLD and primary←NEW (**same NEW**) | Set previous←OLD and primary←NEW (**same NEW**) | New tokens signed with NEW; OLD tokens still verify |
| **P2** | Wait ≥ max access-token TTL + skew. Floor: web-session default **`24h`** (`hub/gateway/server.mjs:157` / G11) unless operator proves a shorter `HUB_JWT_EXPIRY` on all three hosts; also cover Phase C exchange **900s** and MCP OAuth access TTL. Prefer **max(those)+5m**. | same | same | Drain OLD-signed access JWTs |
| **P3** | Unset `SESSION_SECRET_PREVIOUS` | Unset | Unset | OLD tokens → 401 (expected) |
| **P4** | Verify: session/exchange/MCP OAuth still work; vault GitHub status; cross-host session probe still 200 with a **new** token; OLD-token control → 401 on both | | | Close the rotation |

**Ordering inside P1:** set **verify-capable** dual-secret on **all three** hosts before any host signs with NEW exclusively. Practical order: bridge → gateway → MCP (or all within one operator window). Never leave gateway on NEW-only while bridge still OLD-only.

### 6.4 Bridge GitHub-token ciphertext

Bridge encrypts stored GitHub tokens with `SESSION_SECRET` (`hub/bridge/server.mjs:289-328`). After P1, decrypt with NEW fails for ciphertext encrypted under OLD.

**Frozen handling:** document in ROTATE-b operator notes — after P3, Hub **Connect GitHub** may need a one-time re-connect if decrypt fails (existing user-visible string at `hub/bridge/server.mjs:298`). Optional Auto enhancement (out of band unless pulled into R3): try decrypt with primary then previous during P1–P2 only. Not required to clear P6 if Connect GitHub is re-run once.

### 6.5 Secret generation

- `NEW` = cryptographically random, ≥ 32 bytes, URL-safe or hex; distinct from `OLD`.
- Never commit, never paste into tickets/chat, never log.
- Netlify UI / EC2 env files only; align `.museignore` / `.gitignore` (already ignore `.env`).

---

## 7. Interfaces Auto may implement (ROTATE-b code slice)

| ID | Change | Files (expected) |
| --- | --- | --- |
| P6-C1 | `verifyJwtWithSecretRotation` helper | new small module under `hub/gateway/` or `hub/lib/` + imports from gateway + bridge |
| P6-C2 | Wire **all** gateway G10 sites (server verifyToken/decodeVerifiedToken/resolveHostedActorRole, metadata-bulk, mcp-oauth-provider) | `hub/gateway/server.mjs`; `hub/gateway/metadata-bulk-canister.mjs`; `hub/gateway/mcp-oauth-provider.mjs` |
| P6-C3 | Wire **all** bridge G10 sites (Bearer verify + flow/capture/task route verifies) | `hub/bridge/server.mjs`; `hub/bridge/flow-routes.mjs`; `hub/bridge/flow-capture-routes.mjs`; `hub/bridge/task-routes.mjs` |
| P6-C4 | README / deploy note: `SESSION_SECRET_PREVIOUS` verify-only; post-deploy #3 remains **parity of primary** across gateway+bridge (+ MCP); drain floor cites G11 `24h` | `hub/gateway/README.md` |
| P6-C5 | Seven-tier tests incl. G10 source-scan | `test/sec-kn-p6-session-secret-rotation.test.mjs` (name frozen) |

**Out of scope for ROTATE-b code:** splitting issuer/audience; canister changes; Scooling env; F7 AWS; approving live proposals; `dfx deploy`.

---

## 8. Test matrix (seven tiers — ROTATE-b)

| Tier | Must prove |
| --- | --- |
| unit | Helper accepts primary-signed; accepts previous-signed when previous set; rejects garbage; never signs with previous |
| integration | Gateway `decodeVerifiedToken` path accepts previous during window |
| e2e | Simulated cutover: sign with OLD → set PREVIOUS+NEW → verify OK → clear PREVIOUS → verify fail |
| stress | Rapid alternate OLD/NEW verify calls remain correct under concurrency |
| data-integrity | Bridge encrypt/decrypt primary-only invariant; optional previous-decrypt if implemented |
| performance | Dual verify p95 overhead bound (constant-time enough for two HS256 verifies; no sleep/retry storms) |
| security | Regression: single-secret-only verify **fails** the previous-signed case; secrets never appear in thrown messages; MCP/agent role-cap tests (`test/sec-kn-3-mcp-access-role-cap.test.mjs`) still green |

---

## 9. Tier-3 gates (hard stops)

| Gate | Action | Authority |
| --- | --- | --- |
| T1 | EC2 `git pull` / `npm ci` / PM2 (or systemd) restart to current main | Operator |
| T2 | Write `SESSION_SECRET` / `SESSION_SECRET_PREVIOUS` on Netlify gateway, Netlify bridge, or EC2 | Operator |
| T3 | Muse/`main` merge outside SD-21; `muse push staging`; posture / Delegation / write-env flips | Operator — **out of scope** |
| T4 | Feature-branch → GitHub `main` PR | Forbidden (SD-14) |

Thinking session **must not** execute T1–T4. ROTATE-b Auto may land P6-C1–C5 on a feature branch only; env/deploy remain operator.

---

## 10. Residual risks (explicitly accepted)

| # | Residual | Why accepted |
| --- | --- | --- |
| RR1 | Shared signing domain remains after rotation | Required by README #3 + cross-host agent JWTs; mitigated by SEC-KN-3 on all hosts |
| RR2 | Bridge GitHub token re-connect after rotation | Existing product behavior; documented in §6.4 |
| RR3 | MCP `200` discard anomaly not fully root-caused to allowlist vs missing RBAC | Deploy of current main collapses both; R2 pass criterion forbids `2xx` |
| RR4 | Refresh-cookie / MCP refresh families survive rotation only if still encrypted/verifiable under dual window | Access JWT drain is mandatory; long-lived refresh may need re-login if tied to secret material beyond JWT HS256 — operator watches auth errors in P2 |
| RR5 | Session introspection still reports `scopesForRole(role)` not token scopes (G8) | Separate honesty issue; not P6; do not "fix" inside this freeze |

---

## 11. Non-goals

- Secret split / per-host HS256 keys
- Canister WASM deploy
- Approving or discarding **real** pending proposals as a probe
- Scooling `SCOOLING_*` secret work (Pass 2 P7 — different site)
- F7 AWS (parked)
- Improvised production env edits from Thinking / Auto without operator T2

---

## 12. Definition of Done (phase)

### 12a Thinking (this step) — DONE when

- [x] This artifact exists with `frozen: true` in the freeze-contract YAML
- [x] Freeze-review loop + `ok review --freeze` → **`pass`**
- [x] ROADMAP SEC-KN-P6-ROTATE + SEC-KN-3 board correction + handover NEXT → ROTATE-b (closing commit)
- [x] No T1–T4 executed in Thinking

### 12b Operator + Auto (next) — DONE when

- [ ] R1 EC2 on current main (T1)
- [ ] R2 probe pass (§5.1)
- [ ] P6-C1–C5 merged per SD-14/SD-21 as applicable; BV **`pass`**
- [ ] R4–R5 dual-secret rotation completed (T2) with P4 verify evidence in `docs/reviews/`
- [ ] Governance sync; no secrets in git

---

## 13. Paste-ready ROTATE-b prompt (after freeze `pass`)

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
