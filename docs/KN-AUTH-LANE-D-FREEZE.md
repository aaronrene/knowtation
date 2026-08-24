---
frozen: true
step: KN-AUTH-LANE-D-a
model: "Thinking (thinking-high)"
date: 2026-08-24
branch: feat/kn-auth-lane-d-a
status: thinking-freeze-2026-08-24
supersedes: "Phase C kt_agent_ design stays. This freeze is operability only — Hub health, store isolation, no silent mass-invalidate, 503 must not 401 robots, one automation path. Does not authorize KN-AUTH-LANE-D-b Auto until freeze-review pass. Does not edit Scooling. Does not live-revoke existing credentials in Thinking."
evidence: "Knowtation PRIMARY 2026-08-24 (ROADMAP KN-AUTH-LANE-D-a). Born Free 2026-08-23: weeks of 401 on POST api/v1/auth/agent/token plus SESSION_STORE_UNAVAILABLE and a 47-row pending queue. Sibling lock ~/scooling/docs/reviews/2026-08-24-auth-lane-honesty.md. Phase C landed; list/UI omit last-failure and revoked-at; file/blob miss can look like an empty store."
---

# KN-AUTH-LANE-D — machine-lane operability (health + isolation)

**Ground truth** for KN-AUTH-LANE-D-b Auto. Downstream Auto may treat this document as ground truth without re-deriving. Phase C (`docs/DURABLE-AGENT-AUTH-PHASE-C-FREEZE.md`) remains the token-shape and mint/exchange contract. This freeze does **not** redesign `kt_agent_` wire format, scopes, consume-on-use, or access JWT claims. It does **not** edit Scooling, invent unscoped long-lived API keys, admit inbound-pull product, teach JWT-as-env as the SOP, accept `ktn_refresh` as an agent credential (Phase C T4), Auto BRAIN-PAIR-b, or live-revoke existing credentials in Thinking.

```yaml
phase: KN-AUTH-LANE-D-a
outputs:
- id: kn-auth-lane-d
  path: docs/KN-AUTH-LANE-D-FREEZE.md
  frozen: true
  notes: Hub UI agent-credential health (no secrets). Isolate kt_agent_ store from ktn_refresh / gateway-auth. No silent mass-invalidate on session-store restart. 503 SESSION_STORE_UNAVAILABLE must not 401 robots. One automation path documented.
frozen_inputs:
- id: phase-c-freeze
  path: docs/DURABLE-AGENT-AUTH-PHASE-C-FREEZE.md
  notes: Token shape, mint/exchange, T4 (never accept ktn_refresh as agent credential). Lane D does not reopen those decisions.
- id: agent-integration
  path: docs/AGENT-INTEGRATION.md
  notes: Phase C row exists; Copy-Hub JWT is still documented as a REST obtain path. Lane D documents one machine path.
- id: hub-api
  path: docs/HUB-API.md
  notes: No unscoped long-lived API key already stated. Lane D adds 503-vs-401 honesty for machines.
- id: auth-session
  path: hub/auth-session.mjs
  notes: SESSION_STORE_UNAVAILABLE is the browser refresh rotate-throw path (503; cookie kept).
- id: agent-core
  path: hub/lib/agent-credential-core.mjs
  notes: Record already has revoked_at; list omits it and has no last_failure_*.
- id: agent-store
  path: hub/gateway/agent-credential-store.mjs
  notes: Dedicated blob name already; load() can degrade to empty; Netlify missing-global falls through to file.
- id: agent-routes
  path: hub/gateway/agent-credential-routes.mjs
  notes: Exchange already 503 AGENT_CREDENTIAL_STORE_UNAVAILABLE on I/O throw; no health persist on fail.
- id: refresh-store
  path: hub/gateway/refresh-token-store.mjs
  notes: gateway-auth / refresh-tokens-v1 / hosted_refresh_tokens.json — browser+MCP refresh only.
- id: netlify-gateway
  path: netlify/functions/gateway.mjs
  notes: Two blob names already provisioned. Isolation must stay; Auto must not merge them.
- id: hub-ui-js
  path: web/hub/hub.js
  notes: List shows last used; omits last failure code and revoked-at; empty list copy can look like wipe.
- id: hub-ui-html
  path: web/hub/index.html
  notes: Settings → Integrations → Agent credentials section. Banner element does not exist yet.
- id: auth-lane-honesty
  path: ~/scooling/docs/reviews/2026-08-24-auth-lane-honesty.md
  notes: Sibling lock. KN tip does not edit Scooling. F28 is human session reads.
review_stamp:
  reviewed_at: '2026-08-24T12:17:21Z'
  verdict: pass
  reviewer_mode: agent
  reviewer_model: thinking-high
  reviewer_provider: local
  kit_version: 0.1.0
  artifact_digest: sha256:e5c48a8fa0e80a61b2fd1505d7b7a857db94c904c3107eafc51d95b62e59f972
downstream:
- id: KN-AUTH-LANE-D-b
  model: Auto
  consumes_as_ground_truth: true
  notes: Implement health + isolation + banner + docs path. Starts only after freeze-review pass. Auto does not edit Scooling. Auto does not live-revoke production credentials. Auto does not invent unscoped API keys.
- id: F28-AUTH-LANE-HONESTY
  model: Thinking → Auto
  consumes_as_ground_truth: false
  notes: Scooling sibling. Session-bound Helpers reads. Not this Knowtation tip.
tier3_gates:
- T1 Muse main or muse-mirror to GitHub main (SD-14) outside SD-21 land hygiene
- T2 Production deploy of gateway or Hub that changes live agent-credential store behavior
- T3 Live revoke, rotate, or wipe of existing production credentials
- T4 Any change that accepts browser ktn_refresh / session refresh cookies as agent credentials
- T5 Inventing or documenting unscoped long-lived API keys
- T6 Editing Scooling from this Knowtation tip
- T7 Teaching JWT-as-env (Copy Hub access JWT into Netlify or cron env) as the supported automation path
- T8 Feature branch to GitHub main / non-muse-mirror head
```

Auto must not build until freeze review **pass**. This Thinking tip does **not** implement routes. This Thinking tip does **not** call live mint/revoke/wipe. This Thinking tip does **not** flip any env.

## Review record

| Round | Reviewer | Verdict | Resolution |
| --- | --- | --- | --- |
| 0 | Thinking (this session) | draft | Freeze authored from Phase C + session-store 503 + Hub list/UI gaps + honesty lock |
| 1 | Freeze-review loop (thinking) | findings | R1-F1–F5 fixed below. Mechanical dry-run was already pass. |
| 2 | Freeze-review loop (thinking) | findings | R2-F1–F3 fixed below. |
| 3 | Freeze-review loop (thinking) | findings | R3-F1 fixed below. |
| 4 | Freeze-review loop (thinking) + `ok review --freeze` | **pass** | R1–R3 hold. Interfaces, fail-closed, seven-tier matrix, Tier-3 gates present. No open design decisions for Auto. No escalating category. Cleared for KN-AUTH-LANE-D-b Auto. Auto must not edit Scooling, invent unscoped keys, or live-revoke. |

### Round 1 findings (cited — file+line)

| ID | Sev | Cat | Citation | Finding | Fix |
| --- | --- | --- | --- | --- | --- |
| R1-F1 | MAJOR | completeness | docs/KN-AUTH-LANE-D-FREEZE.md:204 (prior “or a sibling helper”) | Auto could invent a second persist path or change `verifyCredential` return ad hoc. | Locked `recordCredentialFailure` in core; verify return table for known-id failures includes `records`. |
| R1-F2 | MAJOR | consistency | docs/KN-AUTH-LANE-D-FREEZE.md:247 (prior list 503) + `hub/gateway/agent-credential-routes.mjs:137-142` | Routes already map any throw to `AGENT_CREDENTIAL_STORE_UNAVAILABLE`. Auto could swallow D8. | `err.code` must stay `AGENT_CREDENTIAL_STORE_INCONSISTENT` on list/mint/exchange/rotate/revoke. |
| R1-F3 | MAJOR | completeness | docs/KN-AUTH-LANE-D-FREEZE.md:247 (prior “router adds store”) | `store.list` is an array today (`hub/gateway/agent-credential-store.mjs:134-137`). Unbound return shape. | `list(sub)` returns `{ credentials, store }` ; `listCredentialsForSub` stays a row array. |
| R1-F4 | MINOR | completeness | docs/KN-AUTH-LANE-D-FREEZE.md:414 (prior “UI-contract fields”) | Auto could add a browser e2e driver. | e2e is HTTP; banner id/copy asserted from Hub source in unit. |
| R1-F5 | MINOR | completeness | docs/KN-AUTH-LANE-D-FREEZE.md:318 (prior D8) | Deleting both agent data+meta keys looks virgin; Auto might put meta on `gateway-auth`. | Residual documented as T3 whole-store wipe; meta must stay on the agent store. |

### Round 2 findings (cited — file+line)

| ID | Sev | Cat | Citation | Finding | Fix |
| --- | --- | --- | --- | --- | --- |
| R2-F1 | MAJOR | consistency | docs/KN-AUTH-LANE-D-FREEZE.md:294 (prior “hidden when HTTP 200”) | “Hidden when flags false **and** 200” shows the banner on 401 signed-out. | Banner only for 200+`wipe_required` or 503 those two codes. Hidden on 401. |
| R2-F2 | MAJOR | completeness | docs/KN-AUTH-LANE-D-FREEZE.md:326 (prior “same agent blob store”) | File backend had no meta path. Auto could skip D8 in tests/self-run. | Sibling `hosted_agent_credentials.meta.json`; never the refresh file. |
| R2-F3 | MAJOR | consistency | docs/KN-AUTH-LANE-D-FREEZE.md:324 (prior D7) vs D8 | Zero-credential envelope + `nonempty_seen` could be read as virgin. | D8 wins whenever `nonempty_seen` is true. File ENOENT is virgin only if meta file is also missing. |

### Round 3 findings (cited — file+line)

| ID | Sev | Cat | Citation | Finding | Fix |
| --- | --- | --- | --- | --- | --- |
| R3-F1 | MINOR | completeness | web/hub/hub.js:5830-5832; docs/KN-AUTH-LANE-D-FREEZE.md:303 | Today the UI branches on `res.status` only. Auto could show one generic 503 banner for both codes. | §5.4 item 7: parse JSON `code` / `store`; do not pick copy from status alone. D2 also names the meta key/file. |

## Citation discipline

Every freeze-review finding MUST cite **file+line** (OVERSEER-KIT-SPEC §6). Do not
trust uncited review output. HTTP routes in this doc omit the leading slash
(`api/v1/…`) so the freeze mechanical gate does not treat them as absolute machine
paths. Cross-repo paths use `~/scooling/…`. Never leading-slash absolute paths.

---

## 1. Plain-language summary

Robots already have the right kind of password (`kt_agent_`). Operators cannot see *why* one is dead, and a browser session-store blip still looks like “every robot is unauthorized.” Lane D keeps Phase C. It adds a Hub health row (created, last successful exchange, last failure code, vaults, revoked-at — never the secret), keeps the robot store off the browser cookie store, refuses silent mass-invalidate when the session store restarts, and documents one path: robots exchange `kt_agent_`; humans use the browser cookie.

### Technical summary

Lane D extends Phase C list + Hub UI with owner-visible health fields; persists last-failure reason on **known** credential ids only; hard-isolates `gateway-agent-credentials` / `agent-credentials-v1` / `hosted_agent_credentials.json` from `gateway-auth` / `refresh-tokens-v1` / `hosted_refresh_tokens.json`; fail-closes Netlify to the agent blob (no ephemeral file fallback); treats blob/file I/O and inconsistent-empty as **503** (not 401, not empty-200); never emits `SESSION_STORE_UNAVAILABLE` from agent routes; shows an operator banner when wipe is required or the store is inconsistent. Docs name one automation path and retract JWT-as-env as SOP.

---

## 2. Ground truth — what the code does today (file+line)

Every row was read in this session.

| # | Fact | Citation |
| --- | --- | --- |
| G1 | List metadata omits `revoked_at` and any last-failure fields | `hub/lib/agent-credential-core.mjs:334-347` |
| G2 | Successful verify writes `last_used_at` only; no failure persist | `hub/lib/agent-credential-core.mjs:271-281` |
| G3 | Persist record already has `revoked_at` (null until revoke) | `hub/lib/agent-credential-core.mjs:228-240` |
| G4 | File load: `ENOENT` → `{}`; other file errors also → `{}` (silent empty) | `hub/gateway/agent-credential-store.mjs:58-64` |
| G5 | Blob load: missing/foreign JSON → `normalizeRecords` → `{}` | `hub/gateway/agent-credential-store.mjs:38-56` |
| G6 | Store `verify` saves only when `result.ok` (empty load does not overwrite on 401) | `hub/gateway/agent-credential-store.mjs:108-112` |
| G7 | Mint after empty load **does** save `{ credentials: { newOnly } }` — can replace a missed blob | `hub/gateway/agent-credential-store.mjs:94-106` |
| G8 | Missing blob global → file fallback (`hosted_agent_credentials.json`) | `hub/gateway/agent-credential-store.mjs:34-36`, `:52-65` |
| G9 | Netlify already provisions **two** blobs; agent uses `gateway-agent-credentials` | `netlify/functions/gateway.mjs:21-26` |
| G10 | Browser refresh rotate throw → **503** `SESSION_STORE_UNAVAILABLE`; cookie kept | `hub/auth-session.mjs:141-145` |
| G11 | Native OAuth refresh catch also returns `SESSION_STORE_UNAVAILABLE` | `hub/gateway/native-oauth-provider.mjs:482-488` |
| G12 | Agent exchange I/O throw → **503** `AGENT_CREDENTIAL_STORE_UNAVAILABLE` (does not revoke) | `hub/gateway/agent-credential-routes.mjs:198-206` |
| G13 | Non-`kt_agent_` bearer or body on exchange → **401** `AGENT_CREDENTIAL_INVALID` (no JWT verify) | `hub/gateway/agent-credential-routes.mjs:180-196` |
| G14 | `revokeAllRefreshTokensForSub` writes refresh records only | `hub/gateway/refresh-token-store.mjs:186-190` |
| G15 | Hub UI list shows created / expires / last used / revoked flag; no last failure; no revoked-at | `web/hub/hub.js:5846-5863` |
| G16 | Hub UI non-OK list → “unavailable on this host”; empty array → “No agent credentials yet.” | `web/hub/hub.js:5830-5838` |
| G17 | Phase C T4 forbids accepting `ktn_refresh` as agent credential | `docs/DURABLE-AGENT-AUTH-PHASE-C-FREEZE.md:44` |
| G18 | Honesty lock — machine lane = `kt_agent_`; human lane = session; no JWT-as-env SOP | `~/scooling/docs/reviews/2026-08-24-auth-lane-honesty.md:10-17`, `:44-55` |
| G19 | AGENT-INTEGRATION still teaches Copy-Hub JWT as a REST obtain path | `docs/AGENT-INTEGRATION.md:355` |
| G20 | OpenAPI list is “metadata only”; no health fields; exchange already documents 401 and 503 | `docs/openapi.yaml:57-62`, `:87-98` |

**Consumer evidence (operator-reported, not in this workspace):** Born Free / VideoFactory 2026-08-23 — weeks of 401 on `POST api/v1/auth/agent/token`, `SESSION_STORE_UNAVAILABLE` 503, 47-row pending queue. Trend-agent source is not a Knowtation tree. Lane D Auto does **not** edit VideoFactory. The Hub must stop making a session-store blip look like a dead robot credential, and must show health so operators do not remint blindly.

---

## 3. Incident diagnosis — why operability failed

### 3.1 Error classes (do not collapse)

| Code | Who it belongs to | Meaning | Robot action |
| --- | --- | --- | --- |
| `SESSION_STORE_UNAVAILABLE` | **Browser / native refresh only** (`G10`, `G11`) | Refresh **store I/O threw**. Cookie kept. | **Not a robot signal.** Do not remint `kt_agent_`. Do not treat as 401. |
| `AGENT_CREDENTIAL_STORE_UNAVAILABLE` | Agent store I/O (`G12`) | Agent blob/file threw. Credential **not** revoked. | Retry. Do not remint. |
| `AGENT_CREDENTIAL_STORE_INCONSISTENT` | Lane D new | Meta says the agent store was nonempty; data read is empty/missing. | Retry. Operator banner. Do **not** remint. Do **not** mint over the hole. |
| `AGENT_CREDENTIAL_INVALID` | Agent exchange (`G13`) | Unknown / bad secret / expired / revoked / wrong prefix. Uniform wire (no oracle). | Credential is not usable. Check Hub health **before** reminting. |
| `REFRESH_REUSE` / `REFRESH_REVOKED` / `REFRESH_EXPIRED` | Browser refresh family | Session cookie family burned or stale. | Humans sign in again. Robots must not be on this path. |

Phase C already separated stores **by name** (`G9`). Operability still fails because:

1. **Health is incomplete** (`G1`, `G2`, `G15`) — operator cannot see last success vs last failure vs revoked-at, so remint is the only tool.
2. **Empty-load is silent** (`G4`, `G5`, `G7`) — a blob miss plus a mint writes a new singleton map and can replace the real set.
3. **Netlify file fallback** (`G8`) — missing agent blob global uses ephemeral disk; next isolate looks empty → 401 every robot **or** empty-200 “No agent credentials yet.”
4. **Clients collapse 503 → 401** — robots still on `ktn_refresh` hit `SESSION_STORE_UNAVAILABLE` and die as if unauthorized (`G10`, `G18`).
5. **Docs still teach Copy-Hub JWT** (`G19`) — JWT-as-env SOP fights the machine lane.

### 3.2 What Phase C already got right (do not reopen)

- Prefix `kt_agent_`; hash-at-rest; shown once; **not** consume-on-use.
- Dedicated blob name `gateway-agent-credentials` and persist key `agent-credentials-v1`.
- Exchange store fault → 503 without revoke (`G12`).
- Non-`kt_agent_` material rejected at exchange (`G13`, `G17`).
- Scope ceiling, no admin scopes, propose allowlist, `aud` / `typ` checks.

Lane D Auto **extends** those modules. It does **not** add a second credential family.

---

## 4. Frozen product goal

An operator signed into Hub can:

1. Open **Settings → Integrations → Agent credentials (REST / Paperclip / cron)**.
2. See each credential’s **created**, **last successful exchange**, **last failure code**, **vaults**, **revoked-at** — never the secret, never the hash, never `lookup_id`.
3. See an **operator banner** if the agent store is inconsistent or marked wipe-required — and **not** a “No agent credentials yet” empty state in those cases.
4. Trust that restarting or clearing the **browser session store** (`gateway-auth` / `ktn_refresh`) does **not** revoke or empty `kt_agent_` records.
5. Follow **one** documented automation path: mint `kt_agent_` → exchange at `POST api/v1/auth/agent/token` → short `agent_access` JWT. Humans stay on the browser cookie.

Success metric: a `SESSION_STORE_UNAVAILABLE` blip does not 401 robots that present `kt_agent_`; an operator can explain a dead robot from the Hub row without reminting first.

---

## 5. Interfaces (frozen)

### 5.1 Health fields (list + UI)

`GET api/v1/auth/agent/credentials` (session JWT, owner-only — Phase C §6.3) remains the only list. Additive fields on each row:

| Field | Type | Rule |
| --- | --- | --- |
| `created_at` | number or null | Already present. Unchanged. |
| `last_used_at` | number or null | Last **successful** exchange. Already present. UI label **last successful exchange**. |
| `last_failure_code` | string or null | Last persisted failure on this **known** id. Vocabulary **only**: `invalid` \| `revoked` \| `expired`. Null if none. |
| `last_failure_at` | number or null | Timestamp companion of `last_failure_code`. Null iff code is null. |
| `vault_ids` | string[] | Already present. |
| `revoked` | boolean | Already present. |
| `revoked_at` | number or null | Already on the persist record (`G3`); **must** appear on list. Null when not revoked. |

Still **forbidden** on list/get: raw credential, secret, hash, `lookup_id`, any cookie value.

Existing Phase C fields (`id`, `name`, `scopes`, `expires_at`) stay. Auto does not remove them. Every list row **must include** the §5.1 keys; persist records that lack them (legacy Phase C rows) serialize those keys as `null`.

`last_failure_code` / `last_failure_at` are **not** cleared on a later successful exchange. Last success and last failure are independent.

Wire exchange **stays** uniform **401** `{ "code": "AGENT_CREDENTIAL_INVALID" }` for invalid / revoked / expired / wrong prefix (Phase C §6.2). Health is owner-list only — not an exchange oracle.

### 5.2 When to persist a failure

Export **`recordCredentialFailure(records, cid, reason, now)`** from `hub/lib/agent-credential-core.mjs`. Do **not** invent a second persist path. `verifyCredential` **must** call it on known-id failures and return the stamped `records` so the store can save.

`recordCredentialFailure` rules:

- `reason` must be one of `invalid` \| `revoked` \| `expired`; otherwise no-op (return records unchanged).
- Unknown `cid` → no-op.
- Sets `last_failure_code` and `last_failure_at` only. **Must not** change `last_used_at`, hash, `lookup_id`, `revoked`, or `revoked_at`.

`verifyCredential` return shape after Lane D:

| Outcome | Return |
| --- | --- |
| Parse fail / unknown lookup | `{ ok: false, reason: 'invalid' }` — no `records`, no `id` |
| Known id, hash mismatch | `{ ok: false, reason: 'invalid', id, records }` |
| Known id, revoked | `{ ok: false, reason: 'revoked', id, records }` |
| Known id, expired | `{ ok: false, reason: 'expired', id, records }` |
| Success | Existing Phase C success object (`ok: true`, `records`, `id`, `sub`, `scopes`, `vault_ids`, `name`) plus unchanged last-failure fields on the record |

Store `verify`: if `result.ok` → save success records (Phase C). Else if `result.records` present → save failure records. Else no save.

| Presented material | Persist? | `last_failure_code` |
| --- | --- | --- |
| Not `kt_agent_` / parse fail | No (no id) | — |
| Unknown `lookup_id` | No (no record) | — |
| Known id, hash mismatch | Yes | `invalid` |
| Known id, `revoked` | Yes | `revoked` |
| Known id, expired | Yes | `expired` |
| Store I/O throw | No (cannot write) | — |
| Rate limit after successful verify | No | — |

If the health **save** throws after a known-invalid verify, exchange still returns **401** `AGENT_CREDENTIAL_INVALID` (do not turn a known-invalid into 503). **503** only when the **load** threw or D8 inconsistent fired **before** verify.

### 5.3 List envelope (banner signal)

**200** body becomes:

```json
{
  "credentials": [],
  "store": {
    "wipe_required": false,
    "inconsistent": false
  }
}
```

`store` is required after Lane D. Old clients that ignore unknown keys keep working.

| Condition | HTTP | Body | UI |
| --- | --- | --- | --- |
| Signed-out / no session | 401 | Phase C unauthorized | “Sign in to manage agent credentials.” |
| Load I/O throw | 503 | `AGENT_CREDENTIAL_STORE_UNAVAILABLE` | Banner + “unavailable” — **not** empty-list copy |
| Inconsistent empty (`D8`) | 503 | `AGENT_CREDENTIAL_STORE_INCONSISTENT` + `store.inconsistent: true` | Banner — **not** “No agent credentials yet.” |
| Readable, `wipe_required` true | 200 | credentials + `store.wipe_required: true` | Banner — remint only after operator wipe |
| Readable, empty, flags false | 200 | `credentials: []` | “No agent credentials yet.” |
| Readable, rows present | 200 | health rows | Table/list with §5.1 columns |

Mint / rotate / revoke HTTP bodies stay Phase C-shaped. They do not echo `store` (list + banner is the operator surface).

**Store method lock:** `createAgentCredentialStore().list(sub)` **must** return `{ credentials, store }` after Lane D (not a bare array). `credentials` is the `listCredentialsForSub` row array (health fields included). `store` is `{ wipe_required, inconsistent: false }` from the loaded envelope. I/O and D8 throw **before** returning. Update Phase C tests that treated `list` as an array.

`listCredentialsForSub` itself stays a **row array** (pure). The router uses `store.list(sub)` and must not rebuild `store` flags from guesswork.

**Error-code lock:** store/core throws for D8 **must** set `err.code = 'AGENT_CREDENTIAL_STORE_INCONSISTENT'`. Agent routes (list, mint, exchange, rotate, revoke) map that code to **503** with the **same** code. Do **not** swallow it as `AGENT_CREDENTIAL_STORE_UNAVAILABLE`. Other I/O throws stay `AGENT_CREDENTIAL_STORE_UNAVAILABLE`.

### 5.4 Hub UI

Location unchanged: Settings → Integrations → **Agent credentials (REST / Paperclip / cron)** (`web/hub/index.html` heading already exists).

**Controls Auto must add or change:**

1. List row (or table) columns, in this order: **name**, **vaults**, **created**, **last successful exchange**, **last failure code**, **revoked-at**, then existing Revoke / Rotate. Scopes and expires may remain as secondary text. Never render secrets.
2. Banner element id **`agent-cred-store-banner`** (`role="status"`). **Show** only when (HTTP 200 and `store.wipe_required`) **or** (HTTP 503 and code is `AGENT_CREDENTIAL_STORE_INCONSISTENT` or `AGENT_CREDENTIAL_STORE_UNAVAILABLE`). **Hidden** on 401, on network failure that is not those codes, and on 200 with both store flags false. Do **not** show this banner for signed-out.
3. Banner copy (locked):
   - Inconsistent / 503 `AGENT_CREDENTIAL_STORE_INCONSISTENT`: `Agent credential store is inconsistent. Do not remint. Existing robots should retry; this is not a dead credential.`
   - 503 `AGENT_CREDENTIAL_STORE_UNAVAILABLE`: `Agent credential store is temporarily unavailable. Do not remint. Retry.`
   - `wipe_required`: `Operator wipe required on the agent credential store. Robots will fail exchange until reminted after the wipe. This is not a browser session blip.`
4. Empty-list copy **only** on 200 + empty `credentials` + both store flags false.
5. Honesty line (keep Phase C sentence; append): `Robots use kt_agent_ and POST api/v1/auth/agent/token. Humans use the browser session cookie. A session-store 503 does not revoke robot credentials.`
6. Calls stay on REST `apiBase`, not `deviceAuthBase()`.
7. `refreshAgentCredList` must read JSON `code` on non-OK and `store` on 200. Do **not** pick banner copy from HTTP status alone (`G16` today uses only `res.status`).

No live Revoke in Thinking. Auto may keep the existing Revoke button; it must not add a “wipe all” button.

### 5.5 Store isolation (hard)

| Store | Blob name | Persist key | File fallback | Global |
| --- | --- | --- | --- | --- |
| Browser / native refresh | `gateway-auth` | `refresh-tokens-v1` | `hosted_refresh_tokens.json` | `__knowtation_gateway_auth_blob` |
| Agent credentials | `gateway-agent-credentials` | `agent-credentials-v1` | `hosted_agent_credentials.json` (non-Netlify only) | `__knowtation_gateway_agent_cred_blob` |

**D1.** `hub/gateway/agent-credential-store.mjs` must not read or write `gateway-auth`, `refresh-tokens-v1`, `hosted_refresh_tokens.json`, or `__knowtation_gateway_auth_blob`.

**D2.** `hub/gateway/refresh-token-store.mjs` / `hub/auth-session.mjs` must not read or write `gateway-agent-credentials`, `agent-credentials-v1`, `agent-credentials-v1-meta`, `hosted_agent_credentials.json`, `hosted_agent_credentials.meta.json`, or `__knowtation_gateway_agent_cred_blob`.

**D3.** `revokeAllRefreshTokensForSub` and refresh rotate/reuse burns must not iterate or revoke agent records.

**D4.** Agent routes must never return `SESSION_STORE_UNAVAILABLE`.

**D5.** When `process.env.NETLIFY` is a nonempty string, the agent store **must** use the agent blob global. If the global is missing, **throw** (routes map to 503 `AGENT_CREDENTIAL_STORE_UNAVAILABLE`). **No** file fallback on Netlify.

**D6.** File/blob I/O throw and JSON parse errors **throw**. They must not return `{}` (`G4` is the defect).

**D7.** Virgin empty is allowed only when meta says the store was never nonempty: **both** data and meta missing, **or** well-formed data with zero credentials **and** (`wipe_required` false) **and** (meta absent or `nonempty_seen` false). **D8 wins** whenever `nonempty_seen` is true — a zero-credential map in that case is inconsistent, not virgin. File `ENOENT` is virgin **only when the sibling meta file is also missing** (see D8 file rule).

**D8.** Sentinel meta (same **agent** backend, **not** `gateway-auth`):

- **Blob:** key `agent-credentials-v1-meta` on `gateway-agent-credentials`.
- **File (non-Netlify only):** sibling `hosted_agent_credentials.meta.json` in the same directory as `hosted_agent_credentials.json`. Never `hosted_refresh_tokens.json`.

Shape: `{ "schema_version": 1, "nonempty_seen": true, "count": <number>, "updated_at": <ms> }`. Write meta on every successful save where `count > 0`. `load` used by verify **and** mint **and** list **and** rotate **and** revoke must read meta. If data is missing/empty **and** `nonempty_seen` is true → throw inconsistent (`err.code = 'AGENT_CREDENTIAL_STORE_INCONSISTENT'`); **do not save** the empty map (blocks `G7` remint-over-miss).

**D8 residual (explicit):** deleting **both** the data key and the meta key (or the entire Netlify store `gateway-agent-credentials`) looks like a virgin store. That is an **operator whole-store wipe (T3)**, not a session-store restart. Auto must **not** move meta onto `gateway-auth` to “detect” that case — that would break D1/D2. Session-store blips (`gateway-auth` down) never delete these keys.

**D9.** If data is present and meta is missing, repair meta on the next successful save. Do not 503.

**D10.** Envelope for the data key (additive; Auto must read legacy `{ "credentials": { … } }` without `schema_version`):

```json
{
  "schema_version": 1,
  "credentials": {},
  "wipe_required": false,
  "wipe_reason": null,
  "wipe_set_at": null
}
```

`wipe_reason` is a bounded string (max 128 chars) or null. Allowed reason literals: `operator` \| `inconsistent` \| null. Auto **does not** add a public wipe-all route. Auto **does not** set `wipe_required` at runtime when D8 fires (D8 throws; it does not flip the flag). Auto **reads** `wipe_required` for the banner. Setting `wipe_required` on production is **T3**. Tests may set the flag in a temp store.

**D11.** Session-store restart (process bounce, `gateway-auth` blob recreate, `ktn_refresh` family revoke, `SESSION_STORE_UNAVAILABLE`) is **not** an agent wipe and must not call agent `save` with `{}`.

### 5.6 Exchange and session 503 (robots)

`POST api/v1/auth/agent/token` (Phase C §6.2) plus:

| Input | Status | Code |
| --- | --- | --- |
| `ktn_refresh` cookie or body refresh material (no `kt_agent_` prefix) | 401 | `AGENT_CREDENTIAL_INVALID` |
| Access JWT / `mcp_access` bearer (not `kt_agent_`) | 401 | `AGENT_CREDENTIAL_INVALID` |
| Valid `kt_agent_` while `gateway-auth` is down or empty | **200** (if agent store verifies) | — |
| Agent store I/O throw | 503 | `AGENT_CREDENTIAL_STORE_UNAVAILABLE` |
| Agent store inconsistent | 503 | `AGENT_CREDENTIAL_STORE_INCONSISTENT` |

Agent exchange **must not** call `createRefreshHandler`, `rotateRefreshToken`, or read `ktn_refresh`.

Browser `POST api/v1/auth/refresh` 503 remains `SESSION_STORE_UNAVAILABLE` (`G10`). That path must not revoke agent credentials.

### 5.7 One automation path (docs + UI)

Document exactly one machine path. Names only — no env assignment lines in this freeze (mechanical secret-pattern gate).

| Lane | Who | Durable material | Short JWT | Exchange |
| --- | --- | --- | --- | --- |
| Human | Hub UI / Scooling session | Browser cookie `ktn_refresh` | `type: session` access JWT in memory | `POST api/v1/auth/refresh` |
| Machine | REST / cron / Paperclip | Opaque `kt_agent_…` in the env name **KNOWTATION_HUB_AGENT_CREDENTIAL** | `type: agent_access` | `POST api/v1/auth/agent/token` |

**Forbidden as the machine SOP:** Copy-Hub access JWT in Netlify or cron env; `KNOWTATION_HUB_REFRESH_TOKEN`; reading `ktn_refresh`; lengthening access JWT expiry; unscoped long-lived API keys.

Same-PR doc edits (Auto D-b):

| Doc | Change |
| --- | --- |
| `docs/AGENT-INTEGRATION.md` | One boxed machine path (Lane Machine above). Keep MCP OAuth / device-code for MCP hosts. Retract Copy-Hub JWT as the always-on REST SOP (`G19`). One-off curl may still copy a short session JWT. |
| `docs/HUB-API.md` §1 | 503-vs-401 table from §3.1. Restate no unscoped long-lived API key. |
| `docs/openapi.yaml` | List schema: health fields + `store` object; 503 `AGENT_CREDENTIAL_STORE_INCONSISTENT` on list and exchange. |
| Hub UI | §5.4 honesty line. |

No docs-only PR to `main`.

---

## 6. Explicit non-goals (out)

- Unscoped long-lived API keys on Netlify or anywhere else.
- Inbound-pull product (later P1).
- Any Scooling source edit (F28 owns human session reads).
- JWT-as-env SOP (Copy Hub access JWT into Netlify / Paperclip / cron).
- Redesign of Phase C token shape, scopes, propose allowlist, or consume-on-use.
- Live revoke / rotate / wipe of production credentials in Thinking **or** as a silent Auto side effect.
- JWT denylist (Phase C: in-flight access JWTs die at `exp` ≤ 900s).
- Path-prefix scoping (Phase C called that Phase D of **scopes** — not this lane).
- Fixing Netlify `gateway-auth` HA (browser ops). Isolation + 503 honesty is enough.
- VideoFactory / Born Free client code (follow-on outside this repo).
- MCP OAuth / device-code redesign.
- Auto BRAIN-PAIR-b; T5 path-kind admission.

---

## 7. Fail-closed rules (checklist)

1. Never accept `ktn_refresh` / non-`kt_agent_` opaque material at `api/v1/auth/agent/token`.
2. Never return `SESSION_STORE_UNAVAILABLE` from agent routes.
3. Never write agent records into the refresh store (or the reverse).
4. Never file-fallback the agent store when `NETLIFY` is set.
5. Never treat I/O / parse errors as empty `{}`.
6. Never save an empty credential map when meta `nonempty_seen` is true.
7. Never show “No agent credentials yet” on 503 or `wipe_required` / inconsistent.
8. Never put secrets, hashes, or `lookup_id` on list or in the UI.
9. Never remint-as-fix in product copy for 503.
10. Never log or commit secrets.
11. Never elevate `agent_access` via admin allowlist (Phase C).
12. Never live-wipe or mass-revoke in Auto without T3.

---

## 8. Implementation map (Auto; no redesign)

| Piece | Path | Change |
| --- | --- | --- |
| Core | `hub/lib/agent-credential-core.mjs` | Health fields on `listCredentialsForSub`; `recordCredentialFailure`; `verifyCredential` return table §5.2 |
| Store | `hub/gateway/agent-credential-store.mjs` | D1, D5–D11; meta key; throw on I/O; Netlify blob-only; `list(sub)` → `{ credentials, store }`; save failure records when `verify` returns `records` |
| Router | `hub/gateway/agent-credential-routes.mjs` | Pass through `store.list` envelope; map `err.code === 'AGENT_CREDENTIAL_STORE_INCONSISTENT'` to 503 same code; persist failure via store.verify; never `SESSION_STORE_UNAVAILABLE` |
| Netlify | `netlify/functions/gateway.mjs` | Keep two blob names. Do not merge. Do not write agent data into `gateway-auth`. |
| Refresh | `hub/gateway/refresh-token-store.mjs` | No agent imports/writes (assert in tests). No behavior change required if already isolated. |
| UI | `web/hub/index.html`, `web/hub/hub.js` | §5.4 columns + banner |
| Docs | §5.7 table | Same PR as Auto |
| Tests | Existing `test/agent-credentials-*.test.mjs` (extend) | §9 |

---

## 9. Test matrix (seven-tier — Aaron standard)

Extend the Phase C files. Do not invent a parallel glob. Security-tier cases **must fail against pre-Lane-D code** where the defect is missing (empty-`{}` load, Netlify file fallback, list without `revoked_at` / last-failure, empty-200 on inconsistent).

| Tier | File | Must prove |
| --- | --- | --- |
| unit | `test/agent-credentials-unit.test.mjs` | List includes `revoked_at`, `last_failure_code`, `last_failure_at`; known-id failure persist; success does not clear last failure; parse still rejects browser-style refresh; envelope + meta inconsistent throws; I/O/parse does not become `{}` |
| integration | `test/agent-credentials-integration.test.mjs` | Mint → exchange 200 while a parallel refresh store is empty or throws; exchange never returns `SESSION_STORE_UNAVAILABLE`; `ktn_refresh`-shaped body → 401; agent store I/O throw → 503 `AGENT_CREDENTIAL_STORE_UNAVAILABLE`; inconsistent → 503 `AGENT_CREDENTIAL_STORE_INCONSISTENT` and **no** save of empty |
| e2e | `test/agent-credentials-e2e.test.mjs` | HTTP session list returns health rows + `store` object; 503 list body has the inconsistent/unavailable **code** and is **not** `{ credentials: [] }` with HTTP 200. Do **not** add a browser driver. Banner id `agent-cred-store-banner` and the three copy strings are asserted from `web/hub/index.html` / `web/hub/hub.js` source in **unit** (same file as other UI-source asserts, or a new `it` in the unit file). |
| stress | `test/agent-credentials-stress.test.mjs` | Concurrent exchanges still do **not** revoke (Phase C). Add: concurrent verify + failure persist does not drop other records |
| data-integrity | `test/agent-credentials-data-integrity.test.mjs` | Agent module source/runtime never writes `refresh-tokens-v1` / `gateway-auth`; persist never contains raw secret; list omits hash and `lookup_id`; file meta is `hosted_agent_credentials.meta.json` not the refresh file; `NETLIFY` set + missing agent blob global → throw and **no** write of `hosted_agent_credentials.json` or the meta sibling |
| performance | `test/agent-credentials-performance.test.mjs` | Exchange p95 stays within the existing local-store budget after health writes (do not silently widen) |
| security | `test/agent-credentials-security.test.mjs` | `ktn_refresh` / non-prefix rejected; agent routes cannot emit `SESSION_STORE_UNAVAILABLE`; list/health never includes secret or hash; wipe_required / inconsistent cannot be set by `agent_access` or `mcp_access`; no public wipe-all route |

---

## 10. Tier-3 gates (do not execute in Auto)

- Merge / muse-mirror / production deploy (`T1`, `T2`)
- Live credential mint into real Paperclip secrets, or live revoke/rotate/wipe (`T3`)
- Re-allowing browser refresh as automation auth (`T4`)
- Unscoped API keys (`T5`)
- Scooling edits (`T6`)
- JWT-as-env as documented SOP (`T7`)

---

## 11. Definition of Done (Phase D Auto) — after this freeze passes review

- [ ] §5.1–§5.6 implemented on the existing Phase C modules
- [ ] Hub UI §5.4
- [ ] Docs §5.7 in the same PR
- [ ] Seven-tier tests §9 green
- [ ] build-verification-review → `pass`
- [ ] Roadmap KN-AUTH-LANE-D-b + handover NEXT updated together (SD-17)
- [ ] No secrets in git
- [ ] No Scooling edits
- [ ] No live revoke/wipe of production credentials
- [ ] VideoFactory wiring remains a **follow-on**, not marked done inside this Hub PR
