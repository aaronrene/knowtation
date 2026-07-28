# Durable Agent Auth Phase C — frozen spec: scoped REST agent credentials

**Phase:** Durable Agent Auth **Phase C** (`DURABLE-AGENT-AUTH-C-a` Thinking freeze → `DURABLE-AGENT-AUTH-C-b` Auto build)
**Freeze status:** **CLEARED — independent freeze-review `pass` (round 2).** `DURABLE-AGENT-AUTH-C-b` (Auto) may start from this freeze. Tier-3 gates T1–T4 remain unauthorized.
**Date:** 2026-07-27
**Model (this artifact):** Thinking
**Branch:** `feat/durable-agent-auth-phase-c`
**Primary consumer (product):** VideoFactory-trend-agent (Paperclip / launchd) posting Hub proposals to `https://api.knowtation.store`
**Companion track docs (local, gitignored):** `development/durable-agent-auth/DURABLE-AGENT-AUTH-SPEC.md`, `development/durable-agent-auth/DURABLE-AGENT-AUTH-ROADMAP.md`

**Hard truth this freeze restates:** MCP Phase A (durable OAuth refresh) and Phase B (device code) **do not** fix REST-only / Paperclip / cron auth. Those paths still paste browser session material or short-lived Hub JWTs. Phase C is the REST machine credential.

## Freeze-contract declaration

```yaml
phase: DURABLE-AGENT-AUTH-C
outputs:
- id: durable-agent-auth-phase-c-freeze
  path: docs/DURABLE-AGENT-AUTH-PHASE-C-FREEZE.md
  frozen: true
frozen_inputs:
- docs/AGENT-INTEGRATION.md
- docs/HUB-API.md
- docs/openapi.yaml
- hub/gateway/refresh-token-store.mjs
- hub/lib/refresh-token-core.mjs
- hub/gateway/access-token-authz.mjs
- hub/gateway/server.mjs
- hub/auth-session.mjs
- netlify/functions/gateway.mjs
- hub/gateway/device-oauth-provider.mjs
review_stamp:
  reviewed_at: '2026-07-27T19:59:43Z'
  verdict: pass
  reviewer_mode: agent
  reviewer_model: thinking-high
  reviewer_provider: local
  kit_version: 0.1.0
  artifact_digest: sha256:e9e1fb59b1643e183d8834abb710a67f36c4beef48b4ac38ec19533866ac95ee
tier3_gates:
- T1 merge to Muse main or muse-mirror → GitHub main (SD-14)
- T2 production deploy of Netlify gateway that mints/accepts agent credentials
- T3 operator mint of a live credential + placement into Paperclip/Automation secrets
- T4 any change that accepts browser `ktn_refresh` / session refresh cookies as agent credentials
```

Authoring provenance (local gitignored track; Auto must implement from this freeze alone):
`development/durable-agent-auth/DURABLE-AGENT-AUTH-SPEC.md`,
`development/durable-agent-auth/DURABLE-AGENT-AUTH-ROADMAP.md`.

---

## 1. Plain-language summary

Paperclip and cron jobs that talk to Knowtation over HTTP need a **password made for robots**, not a copy of the browser's "stay signed in" cookie. Today the trend-agent still uses a browser refresh secret. When that secret is reused, revoked, or the server store blips, automation dies with session errors — and no amount of "ignore expired JWT" client code can revive a dead browser session family.

Phase C adds a Hub button: mint a **scoped agent credential** once, put it in Paperclip env, revoke it in the Hub when done. That credential is vault-bound, not admin by default, and is a **different family** from browser login. Browser logout or cookie reuse cannot kill it; Hub revoke kills it immediately.

### Technical summary

Phase C ships an opaque credential `kt_agent_<id>.<secret>` (hash-at-rest, shown once), Hub mint/list/revoke/rotate APIs + Settings UI, a Netlify-mounted exchange that returns a short-lived JWT with `type: 'agent_access'` / JWT `typ: 'kt_agent_access'`, and scope-aware REST enforcement that extends the Phase A `mcp_access` guard. Default scopes for the primary consumer are `propose` + `vault:read` on an explicit vault id list. The opaque credential is **not** consume-on-use (unlike OAuth refresh rotation), so concurrent launchd jobs cannot self-revoke via `REFRESH_REUSE`. Browser session refresh (`ktn_refresh` cookie / `refresh-tokens-v1` families) remains a separate store namespace and must never be accepted as an agent credential.

---

## 2. Ground truth — what the code does today (file+line)

**Notation:** HTTP route paths are written without their leading slash (`api/v1/…`) so the freeze mechanical gate does not treat them as absolute machine paths.

Every row was read in this session.

| # | Fact | Citation |
| --- | --- | --- |
| G1 | Roadmap Phase C is TODO: scoped REST agent credentials + revoke | `development/durable-agent-auth/DURABLE-AGENT-AUTH-ROADMAP.md:15`, `:122-136` |
| G2 | Spec ranks long-lived scoped agent credential as the Paperclip/REST path; amends "no API-key-only path" when C ships | `development/durable-agent-auth/DURABLE-AGENT-AUTH-SPEC.md:85-96`, `:115`, `:148` |
| G3 | `AGENT-INTEGRATION.md` still says Phase C not shipped for REST/Paperclip/cron | `docs/AGENT-INTEGRATION.md:177` |
| G4 | `HUB-API.md` still: "There is no API-key-only path" | `docs/HUB-API.md:13` |
| G5 | Web session refresh on Netlify uses eventual blob `gateway-auth`; rotate throws → `SESSION_STORE_UNAVAILABLE` (503), cookie **not** cleared | `netlify/functions/gateway.mjs:14-21`; `hub/auth-session.mjs:141-145` |
| G6 | Native OAuth refresh catch also returns `SESSION_STORE_UNAVAILABLE` | `hub/gateway/native-oauth-provider.mjs:482-488` |
| G7 | Refresh core failures include `revoked` / `reuse` (mapped to `REFRESH_REVOKED` / `REFRESH_REUSE`) | `hub/lib/refresh-token-core.mjs:60-65`, `:300-308`; `hub/auth-session.mjs:65-69` |
| G8 | Blob refresh store documents ≤60s reuse-detection lag; MCP requires `consistency: 'strong'` file backend | `hub/gateway/refresh-token-store.mjs:11-17`, `:209-213` |
| G9 | Gateway chooses strong refresh store only when **not** `NETLIFY` | `hub/gateway/server.mjs:369-374` |
| G10 | MCP / native / device OAuth mount only when `shouldMountDurableAgentAuth` — **false on Netlify** | `hub/gateway/access-token-authz.mjs:165-167`; `hub/gateway/server.mjs:650-654`, `:732-733` |
| G11 | REST `getUserId` is scope-aware only for `type: 'mcp_access'` today | `hub/gateway/server.mjs:1496-1501`; `hub/gateway/access-token-authz.mjs:147-154` |
| G12 | Session JWTs mint `type: 'session'`; MCP/device mint `type: 'mcp_access'` (1h) | `hub/gateway/server.mjs:222-233`; `hub/gateway/device-oauth-provider.mjs:200-208`; `hub/gateway/mcp-oauth-provider.mjs:240-243` |
| G13 | Personal self-apply refuses `mcp_access` / `actorKind: 'agent'` / `humanActor: false` | `lib/hub-proposal-personal-self-apply.mjs:357-360`; `hub/gateway/server.mjs:3116-3118` |
| G14 | Device OAuth revoke exists but issues **MCP** tokens on the **persistent** host — not a Netlify REST agent credential | `hub/gateway/device-oauth-provider.mjs:1-12`, `:328-339`; `web/hub/hub.js:5217-5218` |
| G15 | Hub UI Connect cloud agent talks to `deviceAuthBase()` (MCP origin), not Netlify API host | `web/hub/hub.js:5217-5226` |
| G16 | Login refresh-cookie failure logs `authBlobPresent` distinguishing missing blob vs blob write reject | `hub/gateway/server.mjs:416-429` |

**Consumer evidence (operator-reported, not present in this workspace):** VideoFactory-trend-agent `born_free_trend_scout/knowtation.py` authenticates to `https://api.knowtation.store` via Paperclip env `KNOWTATION_HUB_REFRESH_TOKEN` copied from browser `ktn_refresh`. Client fix `cf07ab2` (ignore expired JWT + persist rotated refresh) is deployed on Automation; it cannot revive `REFRESH_REVOKED` / `REFRESH_REUSE` / `SESSION_STORE_UNAVAILABLE`. Trend-agent source was **not** found under this machine's workspace roots during this Thinking session — consumer wiring remains a **follow-on** after Hub Phase C ships (§9).

---

## 3. Incident diagnosis — why the trend-agent path dies

### 3.1 Error classes (server)

| Code | Meaning in current code | Why Paperclip+browser-refresh hits it |
| --- | --- | --- |
| `SESSION_STORE_UNAVAILABLE` | `store.rotate` **threw** (I/O / blob fault) — 503; cookie kept | Netlify `gateway-auth` blob hiccup, or missing blob → file fallback on read-only FS (`server.mjs:416-429`) |
| `REFRESH_REUSE` | Already-rotated token presented again — family burned | Concurrent launchd jobs sharing one refresh without serialized persist |
| `REFRESH_REVOKED` | Family/token revoked | Prior reuse burn, logout, or explicit revoke |
| `INVALID` / "Invalid session" | Malformed, unknown id, or secret mismatch | Stale paste, wrong env, or store prune after family death |

### 3.2 Why Phase A/B cannot fix this consumer

1. Phase A/B credentials are **MCP** (`mcp_access`) and mount on the **persistent MCP host**, not Netlify REST (`G10`, `G14`, `G15`).
2. Trend-agent is **REST-only** against `api.knowtation.store` (`G3`).
3. Browser refresh families live in `refresh-tokens-v1` on eventual blob (`G5`, `G8`) — hostile to concurrent cron.
4. Client-side JWT ignore + persist cannot recreate a revoked family (`G7`).

### 3.3 Reliability follow-on (server) — in scope for diagnosis, Tier-3 for prod flip

Phase C Auto **must** land credential APIs that do not depend on browser refresh rotate. Separately, hosted gateway-auth blob reliability (`SESSION_STORE_UNAVAILABLE`) remains a **browser-session** ops issue:

| Check | How |
| --- | --- |
| Blob provisioned | Netlify site function logs: `authBlobPresent=true` on refresh cookie issue (`G16`) |
| Rotate throws | Function logs around `@netlify/blobs` / `gateway-auth` during `POST api/v1/auth/refresh` |
| Concurrent reuse | Correlate `REFRESH_REUSE` with overlapping launchd/Paperclip PIDs using the same `ktn_refresh` |

Phase C DoD does **not** require fixing Netlify blob HA. It requires **stopping automation from using that store**.

---

## 4. Frozen product goal

An operator who is signed into Hub can:

1. Open **Settings → Integrations → Agent credentials (REST)**.
2. Mint a credential bound to one or more vault ids and a scope set (default safe set for trend-agent).
3. Copy the secret **once** into Paperclip / launchd env.
4. See the credential listed (metadata only) and **Revoke** it. Revoke blocks **new exchanges immediately**. Already-issued access JWTs die when `exp` elapses (access TTL ≤ **900s** — §5.2). Product copy must not claim sub-second kill of in-flight JWTs without a denylist (denylist is out of Phase C).
5. Browser login / logout / cookie reuse **never** shares a refresh family with that credential.

Success metric (product): trend-agent `script-live` healthcheck → create proposal → no cookie digging, no daily paste.

---

## 5. Token shape (frozen)

### 5.1 Opaque agent credential (long-lived secret)

| Field | Rule |
| --- | --- |
| Wire format | `kt_agent_<id>.<secret>` |
| Prefix | Literal `kt_agent_` (ASCII) before `<id>` — parsers reject tokens that lack this prefix for agent-credential endpoints |
| `<id>` | 128-bit CSPRNG, base64url (lookup key) |
| `<secret>` | 256-bit CSPRNG, base64url |
| At rest | Only `sha256(secret)` (same hash helper spirit as `hashSecret` in `refresh-token-core.mjs:72-74`) |
| Shown | **Once** at mint and once at owner-initiated rotate |
| Consume-on-use | **Forbidden.** Presentation for exchange does **not** rotate or invalidate the opaque credential |
| Prefix collision | Must not parse as browser refresh (`id.secret` without `kt_agent_`) or as JWT |

**Env var name (primary consumer):** `KNOWTATION_HUB_AGENT_CREDENTIAL`  
**Forbidden env reuse:** Do not document `KNOWTATION_HUB_REFRESH_TOKEN` / browser `ktn_refresh` as a Phase C credential.

### 5.2 Access JWT (short-lived)

Minted only by the agent exchange endpoint (§6.2).

| JWT claim | Required value |
| --- | --- |
| `sub` | Owner user id (`provider:id`) from credential record |
| `type` | `'agent_access'` (payload discriminator, parallel to `mcp_access` / `session`) |
| `typ` | Payload claim **required:** `typ: 'kt_agent_access'`. Sign with `jsonwebtoken` options `{ expiresIn, header: { typ: 'kt_agent_access' } }` so the JOSE header matches. Verification requires payload `typ === 'kt_agent_access'` (header typ is defense-in-depth, not a substitute). |
| `aud` | `'knowtation-hub-rest'` (string). REST verification for `agent_access` **must** require this `aud`. Session and `mcp_access` tokens without this `aud` remain accepted on their existing paths; `agent_access` without matching `aud` is rejected |
| `scopes` | string array copied from credential record at mint/exchange (re-checked against ceiling) |
| `vault_ids` | string array copied from credential record |
| `cid` | credential id (public metadata id, not the secret) |
| `agent` | optional label (≤128 chars) from mint |
| `iat` / `exp` | standard; default access TTL **900s** (15m). Max access TTL **900s** (not configurable upward in Phase C). |

Signed with the same `SESSION_SECRET` as other Hub JWTs (shared verification), **but** authorization must be type-aware (`G11` extension) so role allowlists cannot elevate agent tokens (same SEC-KN-3 posture as `mcp_access`).

### 5.3 Explicit non-goals for token shape

- Not a god JWT with extended `HUB_JWT_EXPIRY`.
- Not a copy of HttpOnly refresh cookie.
- Not `type: 'mcp_access'` (MCP Phase A/B remains separate).
- Not `type: 'session'` (SEC-SEAM session-bound self-apply stays human-only).

---

## 6. Hub APIs (frozen)

All paths under `api/v1/auth/agent/*` mount on the **REST gateway including Netlify** (`api.knowtation.store`). They **must not** be gated by `shouldMountDurableAgentAuth` (that helper excludes Netlify — `G10`). Offline-locked mode: endpoints **unmounted / 503** with explicit code `AGENT_CREDENTIALS_UNSUPPORTED_OFFLINE_LOCKED` (parity with durable-agent-auth unsupported under offline-lock — SPEC §14).

### 6.1 Mint — `POST api/v1/auth/agent/credentials`

**Auth:** Bearer **session** JWT only (`type: 'session'` or legacy session). Reject `mcp_access` and `agent_access` as mint callers (fail-closed: agents cannot mint agents).

**Body (JSON):**

```json
{
  "name": "videofactory-trend-agent",
  "vault_ids": ["default"],
  "scopes": ["propose", "vault:read"],
  "ttl_seconds": 7776000
}
```

| Field | Rules |
| --- | --- |
| `name` | required, 1–128 chars, display label |
| `vault_ids` | required, non-empty array of non-empty strings; each id trimmed; max 32 vaults |
| `scopes` | optional; default **`["propose","vault:read"]`**; must be ⊆ allowed set ∩ caller ceiling |
| `ttl_seconds` | optional; default **7_776_000** (90d); min 3600; max **7_776_000** |

**Allowed scope vocabulary (Phase C):**

| Scope | Permits |
| --- | --- |
| `vault:read` | Safe HTTP methods on vault-scoped REST |
| `propose` | Create proposals only (see §7) — **not** approve/discard/apply |
| `vault:write` | Mutating REST including direct note write (opt-in; not default) |
| `admin` / `vault:admin` | **Forbidden** on mint — always rejected |

**Caller ceiling:** scopes ∩ `scopesForRole(roleForSub(sub))` plus the Phase C vocabulary. A member cannot mint scopes their role lacks. `propose` is allowed for member/editor/admin even when not listed in today's `scopesForRole` (it is an agent-only scope additive). `vault:write` still requires the caller's role to include `vault:write`.

**Response 201 (secret once):**

```json
{
  "id": "<cid>",
  "name": "videofactory-trend-agent",
  "credential": "kt_agent_<id>.<secret>",
  "vault_ids": ["default"],
  "scopes": ["propose", "vault:read"],
  "expires_at": 1730000000000,
  "created_at": 1720000000000
}
```

Never log `credential`. Never return `credential` on list/get.

**Soft limit:** reject mint when caller already has **25** non-revoked credentials → **409** `{ "code": "AGENT_CREDENTIAL_LIMIT" }`.

### 6.2 Exchange — `POST api/v1/auth/agent/token`

**Auth:** none via session. Present opaque credential via JSON body `credential` **or** `Authorization: Bearer kt_agent_…`.

**Response 200:**

```json
{
  "access_token": "<jwt>",
  "token_type": "Bearer",
  "expires_in": 900,
  "scopes": ["propose", "vault:read"],
  "vault_ids": ["default"]
}
```

**Fail-closed:** unknown / bad secret / expired / revoked → **401** `{ "code": "AGENT_CREDENTIAL_INVALID" }` (uniform message; no oracle). Store I/O throw → **503** `{ "code": "AGENT_CREDENTIAL_STORE_UNAVAILABLE" }` (does **not** revoke).

**Bearer parsing:** If `Authorization` starts with `Bearer kt_agent_`, treat the remainder as opaque credential material and **never** pass it to `jwt.verify`. Non-`kt_agent_` bearers on this route → 401.

Exchange **updates** `last_used_at` only; does not rotate opaque secret.

**Soft limit:** best-effort rate limit **60/min** per credential id → **429** `{ "code": "AGENT_CREDENTIAL_RATE_LIMIT" }`. On Netlify isolates this is best-effort only and must fail open to 200/401/503 paths rather than throw.

### 6.3 List — `GET api/v1/auth/agent/credentials`

**Auth:** session JWT. Returns only credentials where `sub` matches caller.

**Response 200:** `{ "credentials": [ { id, name, vault_ids, scopes, created_at, expires_at, last_used_at, revoked } ] }` — **no** hashes, **no** secrets.

### 6.4 Revoke — `DELETE api/v1/auth/agent/credentials/:id`

**Auth:** session JWT; must own `id`. Sets `revoked: true` (or deletes record). **Response 200** `{ "ok": true }` even if already revoked (idempotent).

Revoke is immediate for **new** exchanges. Access JWTs already issued remain valid until `exp` (≤900s). No JWT denylist in Phase C.

### 6.5 Rotate — `POST api/v1/auth/agent/credentials/:id/rotate`

**Auth:** session JWT; owner only. Invalidates old secret hash; returns new `credential` once (same metadata id **or** new id — freeze: **keep id**, replace hash). Old opaque secret fails exchange immediately.

### 6.6 Store

| Rule | Value |
| --- | --- |
| Module | New `hub/gateway/agent-credential-store.mjs` (+ pure helpers in `hub/lib/agent-credential-core.mjs` if needed) |
| Blob (Netlify) | Dedicated store: `getStore({ name: 'gateway-agent-credentials', consistency: 'eventual' })` wired in `netlify/functions/gateway.mjs` as `globalThis.__knowtation_gateway_agent_cred_blob`. Persist shape `{ "credentials": { "<cid>": { ... } } }` under blob key `agent-credentials-v1`. **Not** the `gateway-auth` / `refresh-tokens-v1` store. |
| File fallback | `data/hosted_agent_credentials.json` under `KNOWTATION_GATEWAY_DATA_DIR` |
| Namespace | **Must not** write into `refresh-tokens-v1` / `createGatewayRefreshStore` records |
| Meta sanitize | `name`, `vault_ids`, `scopes`, `agent` only — bounded lengths |

---

## 7. REST acceptance + scope enforcement (frozen)

### 7.1 `getUserId` / authz extensions

Extend `hub/gateway/access-token-authz.mjs`:

1. `isAgentAccessPayload(payload)` → `payload.type === 'agent_access'`.
2. `resolveActorTokenClass` adds `'agent_access'`.
3. `isSessionBoundActor` remains true **only** for `type: 'session'` (agent_access → false).
4. `subFromVerifiedPayload(payload, { method, path })`:
   - for `agent_access`: require `aud === 'knowtation-hub-rest'` and `typ === 'kt_agent_access'`; enforce `agentScopesPermitMethod(scopes, method, path)`; return `sub` or null.
   - `getUserId(req)` must pass `path` from the request path (no query).
5. `mayApplyAdminAllowlistOverride` → false for `agent_access` (same as mcp_access).
6. `roleFromVerifiedAccessPayload` / `resolveHostedActorRole`: agent_access role from scopes only (`vault:write`/`admin` → never admin from allowlist; `propose` alone → `member`).

### 7.2 `agentScopesPermitMethod(scopes, method, path)`

Evaluate in order:

1. If scopes include `vault:write` or `admin` or `vault:admin` → allow (read + mutate), same ceiling spirit as `mcpScopesPermitMethod`.
2. Else if method is safe (GET/HEAD/OPTIONS) → allow only when scopes include `vault:read`.
3. Else (mutating) → allow only when scopes include `propose` **and** path is in §7.3; otherwise deny.
4. `propose` without `vault:read` still allows §7.3 mutating creates (trend-agent write path) but denies all reads — mint UI defaults both on; mint API allows `propose`-only only if explicitly requested (not the default).

### 7.2.1 Mint scope defaults

Default mint body scopes: `["propose","vault:read"]`. Reject empty scopes. Reject any admin scope.

### 7.3 Propose-create path allowlist (Phase C)

With `propose` and without `vault:write`, mutating requests are allowed **only** when the normalized path matches one of:

- `api/v1/proposals` (exact)
- `api/v1/tasks/proposals` (exact)
- `api/v1/task-loops/proposals` (exact)

**Normalize:** strip query string; strip a single leading `/` if present; compare case-sensitive. Method must be `POST`.

**Denied** even with `propose`: approve, discard, apply-approved, enrich, evaluation write, direct `POST api/v1/notes`, media write routes, delegation grant mint, admin routes.

Path-prefix scoping (`projects/<slug>/**`) is **Phase D** — out of Phase C Auto. Phase C may still mint vault-bound credentials without path prefixes.

### 7.4 Vault binding

For `agent_access`, every vault-scoped request must send `X-Vault-Id` whose value is in `payload.vault_ids`. Missing header is treated as vault id `default` (same as today's gateway default at `hub/gateway/server.mjs` hosted context resolution) and still must be ∈ `vault_ids`. Non-matching → **403** `{ "code": "AGENT_VAULT_FORBIDDEN" }`.

**Frozen choke point:** export `assertAgentVaultAllowed(payload, vaultId)` from `access-token-authz.mjs` and call it from `getHostedAccessContext` (and any self-hosted twin that resolves vault for agent tokens) **before** bridge/canister forwarding. Unit + integration tests must prove wrong vault and disallowed `default` fail.

### 7.5 Self-apply / SEC-KN-3

`resolveHostedActorRole` must treat `agent_access` like `mcp_access` for `humanActor` / `actorKind: 'agent'` / `tokenType`. Extend `roleEligibleForPersonalSelfApply` to also refuse `tokenType === 'agent_access'`.

### 7.6 MCP optional bridge

Phase C DoD: **REST required**. If an `agent_access` JWT is presented to MCP on the persistent host, behavior is unspecified/optional; do not block Phase C on MCP ACL work. Do not teach MCP OAuth to mint `kt_agent_` secrets.

---

## 8. Hub UI (frozen)

**Location:** Settings → Integrations → new section **Agent credentials (REST / Paperclip / cron)** — sibling to Hub API session copy and Connect cloud agent.

**Controls:**

1. Name + vault multi-select (default current vault) + scope checkboxes (`propose`, `vault:read` default on; `vault:write` off + warning).
2. **Mint** → modal shows secret once + copy button composing:

```text
KNOWTATION_HUB_URL=https://api.knowtation.store
KNOWTATION_HUB_VAULT_ID=<vault>
KNOWTATION_HUB_AGENT_CREDENTIAL=kt_agent_…
```

3. List table: name, vaults, scopes, created, expires, last used, **Revoke**, **Rotate**.
4. Honesty copy: "Not a browser session. Revoke blocks new token exchange immediately; in-flight access JWTs end within 15 minutes. Do not paste Hub refresh cookies into Paperclip."

UI calls Netlify REST base (`apiBase`), **not** `deviceAuthBase()` / MCP origin.

---

## 9. Primary consumer contract — VideoFactory-trend-agent (follow-on)

**Not** part of Knowtation Phase C Auto DoD codepaths, but **frozen interface** for the next session that wires the agent:

| Item | Value |
| --- | --- |
| Hub URL | `KNOWTATION_HUB_URL=https://api.knowtation.store` |
| Vault | `KNOWTATION_HUB_VAULT_ID` |
| Secret | `KNOWTATION_HUB_AGENT_CREDENTIAL` (opaque) |
| Flow | exchange → `Authorization: Bearer <access_token>` + `X-Vault-Id` → healthcheck → `POST api/v1/proposals` |
| Persist | Access JWT may be cached until near `exp`; opaque credential is stable (no rotate-on-use) |
| Concurrency | Multiple launchd jobs may exchange concurrently; **no** shared browser refresh file |
| Forbidden | Reading `ktn_refresh` cookies; using `KNOWTATION_HUB_REFRESH_TOKEN`; HR-4 resume as substitute |
| Prove | healthcheck → create proposal without cookie digging |

Serialize-across-launchd guidance applies only if a future design reintroduces rotate-on-use; Phase C opaque credentials make that unnecessary.

---

## 10. Docs amendments (same PR as Auto)

| Doc | Change |
| --- | --- |
| `docs/HUB-API.md` §1.1 | Replace "no API-key-only path" with: "No unscoped long-lived API keys. Scoped agent credentials (`kt_agent_…`) are the machine path for REST/Paperclip/cron; session JWTs remain for interactive use." |
| `docs/AGENT-INTEGRATION.md` | Mark Phase C shipped; document env vars + exchange; keep MCP Phase A/B rows honest |
| `docs/openapi.yaml` | Add `auth/agent/credentials`, `auth/agent/credentials/{id}`, rotate, `auth/agent/token` |
| `development/durable-agent-auth/DURABLE-AGENT-AUTH-ROADMAP.md` | Phase C → DONE after BV pass (local) |
| Hub Settings copy | Point automations at Agent credentials section |

No docs-only PR to `main`.

---

## 11. Test matrix (seven tiers — Aaron standard)

| Tier | File (Auto creates) | Must prove |
| --- | --- | --- |
| unit | `test/agent-credentials-unit.test.mjs` | parse `kt_agent_`; hash; scope ceiling; propose path allowlist; aud check |
| integration | `test/agent-credentials-integration.test.mjs` | mint→exchange→REST propose; revoke→exchange 401; wrong vault 403 |
| e2e | `test/agent-credentials-e2e.test.mjs` | session mint + list + rotate + revoke against test gateway |
| stress | `test/agent-credentials-stress.test.mjs` | concurrent exchanges with same opaque credential do **not** revoke |
| data-integrity | `test/agent-credentials-data-integrity.test.mjs` | secret never persisted; list omits credential; namespace ≠ refresh-tokens-v1 |
| performance | `test/agent-credentials-performance.test.mjs` | exchange p95 budget under local store (document threshold in test) |
| security | `test/agent-credentials-security.test.mjs` | mcp_access cannot mint; agent cannot admin via allowlist; propose cannot approve; browser refresh token rejected by agent exchange; offline-lock unmount; no secret in logs helpers |

Security tier **must fail against pre-Phase-C code** (regression shape).

---

## 12. Fail-closed rules (checklist)

1. No mint without session human token.
2. No admin scopes on agent credentials.
3. No write of agent records into browser refresh store.
4. No accept of `ktn_refresh` / non-`kt_agent_` opaque at `auth/agent/token`.
5. No elevate via `HUB_ADMIN_USER_IDS` for `agent_access`.
6. No self-apply eligibility for `agent_access`.
7. No Netlify exclusion for Phase C routes (inverse of MCP mount rule).
8. Offline-locked → unsupported.
9. Store fault → 503 without destroying credential.
10. Never log or commit secrets.

---

## 13. Implementation map (Auto; no redesign)

| Piece | Path |
| --- | --- |
| Core | `hub/lib/agent-credential-core.mjs` |
| Store | `hub/gateway/agent-credential-store.mjs` |
| Router | `hub/gateway/agent-credential-routes.mjs` |
| Mount | `hub/gateway/server.mjs` + `netlify/functions/gateway.mjs` blob global |
| Authz | `hub/gateway/access-token-authz.mjs` (+ call sites in `server.mjs` / self-apply) |
| UI | `web/hub/index.html`, `web/hub/hub.js` |
| Docs | §10 list |
| Tests | §11 list |

---

## 14. Tier-3 gates (do not execute in Auto)

- Merge / muse-mirror / production deploy
- Live credential mint into real Paperclip secrets
- Any policy that re-allows browser refresh as automation auth

---

## 15. Review record

| Round | Reviewer | Verdict | Resolution |
| --- | --- | --- | --- |
| 1 | Freeze-review loop (thinking) | findings | F1 leading-slash routes → SEC-SEAM notation; F2 revoke "immediate" vs JWT TTL honesty (900s); F3 JOSE typ weasel → mandatory payload+header; F4 vault choke point named; F5 scope table contradictions collapsed; F6 mint/exchange soft limits; F7 gitignored frozen_inputs demoted to provenance note; F8 `getUserId` must pass `path` |
| 2 | Freeze-review loop (thinking) | pass | Re-read §§1–16 + G1–G16 citations. Fixed residual F9 store "or" weasel → dedicated blob; F10 propose path normalize rule. Completeness: interfaces, fail-closed, seven-tier matrix, Tier-3 gates present. No open design decisions for Auto. Mechanical `ok review --freeze` = pass (stamp present). No escalating category open. |

---

## 16. Definition of Done (Phase C Auto) — after this freeze passes review

- [ ] All §6 APIs implemented and mounted on Netlify-capable gateway
- [ ] Authz §7 enforced; self-apply refuses agent_access
- [ ] Hub UI §8
- [ ] Docs §10 in same PR
- [ ] Seven-tier tests §11 green
- [ ] build-verification-review → `pass`
- [ ] Roadmap Phase C + handover NEXT updated together (SD-17)
- [ ] No secrets in git
- [ ] Trend-agent wiring tracked as **follow-on** (§9), not falsely marked done inside Hub PR
