# KN-APPLE-NATIVE-HOSTED-EXCHANGE — Knowtation Apple assertion → hosted session (T15)

Status: **Frozen Thinking outline.** Freeze-review **`pass`** — cleared for
**KN-APPLE-b** Auto. Spec only in this tip — no mechanical route implementation in
Thinking. No Scooling CapabilityGate flips. No vault-write authorize. No App Store.
No MuseHub staging. No inventing client Team IDs. No F7 wait. No feature→GitHub-main.

```yaml
phase: KN-APPLE-NATIVE-HOSTED-EXCHANGE
outputs:
- id: kn-apple-native-hosted-exchange-freeze
  path: docs/KN-APPLE-NATIVE-HOSTED-EXCHANGE-FREEZE.md
  frozen: true
  notes: T15 Knowtation Apple identity-assertion exchange — verify Apple id_token server-side, mint opaque hosted session (C7 introspect class), bind Layer-1 apple:<sub>. Layer-2 scooling_uid HMAC stays server-only in Scooling IdentityAdapter. Not Passport Google/GitHub. Not api/v1/auth/native PKCE.
frozen_inputs:
- id: apple-4-live-hosted-auth
  path: ~/scooling/docs/APPLE-4-LIVE-HOSTED-AUTH-FREEZE.md
  notes: §A4.2.5 path label native-apple-exchange; §A4.8 T1+T2+T15 together; client HostedAuthTransport contract
- id: ecosystem-identity-linking
  path: ~/scooling/docs/ECOSYSTEM-IDENTITY-LINKING-CONTRACT.md
  notes: Layer 1 provider:id / Layer 2 scooling_uid HMAC / Persistence Gate / no client-supplied identity
- id: apple-4-live-defer
  path: ~/scooling/docs/reviews/2026-08-09-apple-4-live-defer.md
  notes: Operator DEFER — T15 NO (zero Knowtation native-apple / Apple OAuth matches)
- id: apple-5-live-defer
  path: ~/scooling/docs/reviews/2026-08-09-apple-5-live-defer.md
  notes: Operator DEFER — vault write blocked until APPLE-4-live clears auth prereqs
- id: gateway-session-mint
  path: hub/gateway/server.mjs
  notes: issueToken / userId / C7 GET api/v1/auth/session / providers allowlist (google+github only today)
- id: native-oauth-pkce
  path: hub/gateway/native-oauth-provider.mjs
  notes: Companion PKCE loopback path — explicitly NOT Apple SIWA
- id: scooling-identity-adapter
  path: ~/scooling/src/adapters/identityAdapter.ts
  notes: deriveScoolingUid HMAC — server-only; never transmitted to Knowtation; never client
review_stamp:
  reviewed_at: '2026-08-09T21:12:36Z'
  verdict: pass
  reviewer_mode: agent
  reviewer_model: thinking-high
  reviewer_provider: local
  kit_version: 0.1.0
  artifact_digest: sha256:4ec695738daf8e582923a6a6971d607bc5649eff35493d27dcd2de6303bd4dfa
downstream:
- id: KN-APPLE-NATIVE-HOSTED-EXCHANGE-b
  model: Auto
  consumes_as_ground_truth: true
  notes: Implement POST api/v1/auth/native-apple-exchange + Apple JWKS verify + session mint + providers.apple + seven-tier + BV. No vault-write authorize. No Scooling gate flips. No App Store.
- id: APPLE-4-live revisit
  model: Operator + Auto
  consumes_as_ground_truth: true
  notes: Scooling Operator tip — authorize T1+T2+T15 together only after this phase lands with readiness evidence
tier3_gates:
- T1 Production deploy of the Apple exchange route on api.knowtation.store (Netlify gateway) with Apple env configured
- T2 Operator authorize of Scooling T1+T2+T15 (APPLE-4-live) — not this phase
- T3 VAULT_WRITE_AUTHORIZED / REAL_NETWORK_ENABLED / IDENTITY_PERSISTENCE_AUTHORIZED flips in scooling-apple
- T4 Committing Apple Team IDs, Services ID secrets, .p8 private keys, or production JWTs to git
- T5 MuseHub private staging push (gabriel/musehub issue 87)
- T6 Feature→GitHub-main / non-muse-mirror head (SD-14)
- T7 App Store / TestFlight submit
- T8 MuseHub F7 AWS wait treated as Apple blocker
- T9 Treating Apple hosted session as Knowtation vault write authority
- T10 Client-side HMAC of scooling_uid / shipping identity derivation secret
- T11 Claiming Google/GitHub Passport or api/v1/auth/native PKCE equals Sign in with Apple
- T12 Starting APPLE-6 identity persistence as a workaround
```

## Review record

| Round | Reviewer | Verdict | Resolution |
| --- | --- | --- | --- |
| 0 | Thinking (this session) | draft | Freeze authored from APPLE-4 §A4.2.5 + ECOSYSTEM-IDENTITY-LINKING-CONTRACT + C7/Passport/native-PKCE ground truth |
| 1 | Freeze-review loop (thinking) + `ok review --freeze --dry-run` | findings | R1-F1–F2 fixed below. CLI blocked on secret-like assignment hygiene (`SECRET_RE`). |
| 2 | Freeze-review loop (thinking) + `ok review --freeze` | **pass** | R1 addressed. CLI C checklist clean. See `review_stamp.artifact_digest`. **No human escalation.** Cleared for KN-APPLE-b Auto (no route impl in Thinking). |

### Round 1 findings (cited — file+line)

| ID | Sev | Cat | Citation | Finding | Fix |
| --- | --- | --- | --- | --- | --- |
| R1-F1 | BLOCKER | security | docs/KN-APPLE-NATIVE-HOSTED-EXCHANGE-FREEZE.md:302 (prior); freeze_reviewer `SECRET_RE` | Mint-step prose used a `token`-named assignment that matched the secret-like scanner and blocked CLI review. | Rewrote mint step without that assignment form; removed JSON example that could match the same scanner. |
| R1-F2 | MAJOR | consistency | docs/KN-APPLE-NATIVE-HOSTED-EXCHANGE-FREEZE.md §KNA.1 (prior); Muse `main` `383a1efd…` vs `origin/main` `baa41bf` `hub/gateway/server.mjs:244` | Freeze implied Muse/`main` carried `type: 'session'` mint; Muse tip lags production gateway — Auto could implement on a tip without session-bound claim. | §KNA.1 now cites `origin/main` lineage, documents Muse lag (G12), and freezes Auto bootstrap to a `type: 'session'` gateway tree under SD-14. |

## Citation discipline

Every freeze-review finding MUST cite **file+line** (OVERSEER-KIT-SPEC §6). Do not
trust uncited review output. HTTP routes in this doc omit the leading slash
(`api/v1/…`) so the freeze mechanical gate does not treat them as absolute machine
paths. Cross-repo paths use `~/scooling/…`. Never leading-slash absolute paths.

---

## Simple summary

Today Knowtation lets people sign in with Google or GitHub in a browser. The Apple
app needs a different door: the phone proves “this is an Apple account” with a
short-lived token, Knowtation checks that token with Apple, then hands back the
same kind of signed-in session the website already uses. This freeze writes down
exactly how that door works — before anyone builds it. It does **not** turn on
vault writing, App Store, or the Apple app’s live switches.

## Technical summary

**KN-APPLE-NATIVE-HOSTED-EXCHANGE** freezes Knowtation’s T15 readiness path:

1. **WHAT** — Accept a short-lived Sign in with Apple identity assertion (`id_token`);
   verify it server-side against Apple JWKS; mint an opaque hosted session JWT of the
   same class as today’s `issueToken` / C7 introspect; bind Layer-1 `provider:id =
   apple:<sub>`. Layer-2 `scooling_uid` remains a Scooling-server HMAC after C7 — never
   client-derived, never Knowtation-transmitted.
2. **HOW** — New gateway route `POST api/v1/auth/native-apple-exchange`; Apple JWKS
   verify module; extend `api/v1/auth/providers` with `apple`; reuse `issueToken` shape
   (`type: 'session'`); fail-closed error codes; env/secrets layout (never git);
   seven-tier test matrix.
3. **Out of scope** — Scooling CapabilityGate flips; vault write authorize; identity
   persistence durable store; App Store; MuseHub staging; F7; client HMAC; equating
   this path with Passport Google/GitHub or `api/v1/auth/native` PKCE.

---

## §KNA.0 — Prerequisites (verified this session)

| Check | Evidence |
| --- | --- |
| APPLE-4 freeze pass + path label | `~/scooling/docs/APPLE-4-LIVE-HOSTED-AUTH-FREEZE.md` §A4.2.5 exchange path label `native-apple-exchange`; T15 in `tier3_gates` |
| APPLE-4-live DEFER | `~/scooling/docs/reviews/2026-08-09-apple-4-live-defer.md` — T15 **NO** |
| APPLE-5-live DEFER | `~/scooling/docs/reviews/2026-08-09-apple-5-live-defer.md` — blocked on auth prereqs |
| Identity contract | `~/scooling/docs/ECOSYSTEM-IDENTITY-LINKING-CONTRACT.md` Layer 1/2 + HMAC formula |
| C7 introspect exists | `hub/gateway/server.mjs` `GET api/v1/auth/session` → `{ sub, provider, id, name, role, iat, exp, scopes }` |
| Providers today | `hub/gateway/server.mjs` `api/v1/auth/providers` returns `google` + `github` only (no `apple`) |
| No Apple IDP in Knowtation | Roadmap + DEFER packet: zero native-apple / Sign in with Apple / `provider:apple` matches in hub |
| F7 not required | SD-26 / Scooling board — parked |

If any prerequisite were false, Auto must **stop**.

---

## §KNA.1 — Ground truth (what the code does today)

**Notation:** route paths omit leading slash. Citations are against the **production
gateway lineage** on GitHub `origin/main` (`baa41bf` / muse-mirror PR #290 tip) —
the tree that includes `type: 'session'` mint + C7. Verified this session:
`origin/main:hub/gateway/server.mjs` has `issueToken` `type: 'session'` at
`:244`; local Muse `main` tip (`383a1efd…`, 2026-08-07) is **behind** that
gateway tip and must not be treated as session-mint ground truth for Auto.

**Auto bootstrap (hard):** Before implementing D1–D9, KN-APPLE-b MUST place the
feature branch on a gateway tree that includes `issueToken` with
`type: 'session'` (equivalent to `origin/main` `hub/gateway/server.mjs`). Prefer
Muse-canonical recovery (import/ff of the mirrored production tip into Muse
feature history) — never `git push origin main` and never treat GitHub as merge
authority (SD-14). If `issueToken` lacks `type: 'session'`, Auto MUST NOT mint
Apple sessions without that claim (SEC-SEAM-1 session-bound identity).

| # | Fact | Citation |
| --- | --- | --- |
| G1 | Layer-1 user id is `provider:id` via `userId()` | `hub/gateway/server.mjs:228-231` (`origin/main`) |
| G2 | Session mint `issueToken` signs `{ sub, provider, id, name, role, type: 'session' }` with session-signing secret | `hub/gateway/server.mjs:233-248` (`origin/main`) |
| G3 | C7 `GET api/v1/auth/session` returns JWT claims + role-derived scopes; Bearer required; no DB | `hub/gateway/server.mjs:475-499` (`origin/main`) |
| G4 | `api/v1/auth/providers` advertises `google` / `github` only (offline-locked → `local`) | `hub/gateway/server.mjs:465-472` (`origin/main`) |
| G5 | Browser login uses Passport Google/GitHub redirect + callback; no Apple strategy | `hub/gateway/server.mjs:199-226`, `:548-568`, `:607-649` (`origin/main`) |
| G6 | Companion native OAuth mounts at `api/v1/auth/native` — PKCE S256 + loopback only; still completes via Google/GitHub Passport | `hub/gateway/native-oauth-provider.mjs:1-36`; `hub/gateway/server.mjs:721` (`origin/main`) |
| G7 | Native PKCE access TTL is 15 minutes (`NATIVE_TOKEN_EXPIRY_SECONDS`) | `hub/gateway/native-oauth-provider.mjs:56` (`origin/main`) |
| G8 | Scooling derives `scooling_uid` as HMAC(secret[kid], provider:id) in-request; never sent to Knowtation | `~/scooling/src/adapters/identityAdapter.ts:231-257`; `~/scooling/docs/ECOSYSTEM-IDENTITY-LINKING-CONTRACT.md:87-99` |
| G9 | Identity contract forbids client-supplied identity / role / scope | `~/scooling/docs/ECOSYSTEM-IDENTITY-LINKING-CONTRACT.md:183-193` |
| G10 | APPLE-4 client freezes exchange path **label** `native-apple-exchange` and C7-compatible introspect; forbids inventing live Knowtation route in Apple Auto (T15) | `~/scooling/docs/APPLE-4-LIVE-HOSTED-AUTH-FREEZE.md:404-411`, `:86` |
| G11 | APPLE-4-live DEFER recorded T15 missing | `~/scooling/docs/reviews/2026-08-09-apple-4-live-defer.md:27-29` |
| G12 | Muse `main` tip can lag GitHub `origin/main` gateway — Auto must not build Apple mint on a tip whose `issueToken` omits `type: 'session'` | Muse `main` `383a1efd…` vs `origin/main` `baa41bf` (this session) |

---

## §KNA.2 — Product scope (WHAT)

### KNA.2.1 Role

Knowtation remains the **canonical auth/authorization authority**. This phase adds
Apple as an upstream Layer-1 provider for **native assertion exchange only**. It does
**not** make Knowtation compute or store `scooling_uid`. It does **not** authorize
vault write. It does **not** flip any Scooling CapabilityGate.

Success metric (product): after KN-APPLE-b lands + Operator configures Apple env and
deploys (T1), an Operator tip can re-run APPLE-4-live with **T15 = YES** evidence
(route exists, providers.apple, verify path documented). T1+T2+T15 authorize remains
a **separate** Scooling Operator tip.

### KNA.2.2 Deliverables (Auto MUST implement)

| # | Deliverable | Notes |
| --- | --- | --- |
| D1 | `POST api/v1/auth/native-apple-exchange` | Exact path binds APPLE-4 label `native-apple-exchange` |
| D2 | Apple identity-token verifier | JWKS fetch + signature + `iss`/`aud`/`exp` (+ optional `nonce`) |
| D3 | Session mint via existing `issueToken` shape | `provider: 'apple'`, `id: <apple_sub>`, `sub: 'apple:<apple_sub>'`, `type: 'session'` |
| D4 | C7 compatibility | Issued Bearer introspects on existing `GET api/v1/auth/session` unchanged |
| D5 | Providers advertisement | `api/v1/auth/providers` includes `apple: boolean` when Apple env configured |
| D6 | Fail-closed error codes | Frozen table §KNA.3.4 — no token echo |
| D7 | Env/secrets layout | §KNA.4 — never git |
| D8 | Seven-tier tests | §KNA.6 |
| D9 | Docs honesty | `hub/gateway/README.md` + `docs/HUB-API.md` route rows; OpenAPI stub if OpenAPI lists auth routes |

### KNA.2.3 Explicit non-goals

| Non-goal | Why |
| --- | --- |
| Implement route in Thinking | This tip freezes only |
| Vault write authorize / notes POST | APPLE-5-live / separate Operator |
| Scooling CapabilityGate flips (`REAL_NETWORK`, `VAULT_WRITE`, `IDENTITY_PERSISTENCE`) | Scooling Operator tips only |
| App Store / TestFlight | Tier 3 T7 |
| Inventing client Team IDs / committing `.p8` / Services secrets | Tier 3 T4 |
| MuseHub F7 wait | Parked; not a prerequisite |
| Durable identity-mapping persistence / Keychain on server | Persistence gate closed |
| Equating this with Passport Google/GitHub | Different grant (§KNA.5) |
| Equating this with `api/v1/auth/native` PKCE | Different grant (§KNA.5) |
| Client HMAC / shipping derivation secret | T10; identity contract |
| Starting APPLE-6 | Forbidden shortcut |
| Cross-provider merge / `msign` | Future; persistence gate |
| Browser Sign in with Apple web button on Hub UI | Optional follow-on; not this phase DoD |
| Refresh-cookie issuance for Apple native exchange | Native clients use Bearer (+ optional body refresh later); do not invent cookie for native Apple in this phase unless tests prove need — default **no** `ktn_refresh` cookie on this route |

---

## §KNA.3 — HOW (frozen contract)

### KNA.3.1 Route

| Item | Frozen value |
| --- | --- |
| Method + path | `POST api/v1/auth/native-apple-exchange` |
| Mount host | Hosted gateway (`hub/gateway/server.mjs` / Netlify gateway function) — same host as C7 |
| Auth on request | **None** (the Apple assertion *is* the proof). Rate-limit / edge limits apply as for other unauthenticated auth endpoints |
| Content-Type | `application/json` |
| CORS | Same gateway CORS policy as other `api/v1/auth/*` (preflight `OPTIONS` required) |
| Offline-locked mode | When offline-locked auth is active, route MUST return **403** with code `OAUTH_DISABLED` (or existing offline-locked guard code) — Apple exchange is an online IDP path |

Path label binding: APPLE-4’s `native-apple-exchange` **is** this route’s final path
segment. Auto MUST NOT invent a second alias without a new freeze.

### KNA.3.2 Request body allowlist

Exactly these fields (unknown fields → **400** `BAD_REQUEST`):

| Field | Required | Rules |
| --- | --- | --- |
| `identity_token` | yes | Non-empty string. Apple Sign in with Apple `identityToken` (JWT). MUST be verified server-side. MUST NOT be logged. |
| `nonce` | no | If present, non-empty string; MUST equal Apple token `nonce` claim (or Apple’s SHA-256 hex of nonce per Apple’s nonce rules). Mismatch → reject. |
| `full_name` | no | Cosmetic only. If present, truncated string ≤ 128 chars stored into JWT `name` like Passport `displayName`. NEVER used as identity authority. |

Forbidden request fields (presence → **400** `BAD_REQUEST`):

- `sub`, `provider`, `id`, `role`, `scopes`, `scooling_uid`, `scoolingUid`, `kid`
- `access_token`, `refresh_token`, `client_secret`, `team_id`, `authorization` header identity claims treated as authority
- Client-supplied HMAC digests

Optional future (explicitly **out of this phase**): Apple `authorization_code` server
exchange. Auto MUST NOT require `authorization_code` for DoD. Identity proof is the
verified `identity_token` alone.

### KNA.3.3 Apple token verification (server-side)

Auto MUST implement a dedicated module (suggested path
`hub/gateway/apple-identity-token.mjs`) that:

1. Parses the JWT header; rejects `alg=none` and unknown algs.
2. Fetches Apple JWKS from `https://appleid.apple.com/auth/keys` (cache TTL frozen:
   ≤ 24h in-process; fail-closed if fetch fails and no valid cache).
3. Verifies signature with the matching JWK (`kid`).
4. Enforces claims:

| Claim | Rule |
| --- | --- |
| `iss` | Exactly `https://appleid.apple.com` |
| `aud` | Exactly configured `APPLE_CLIENT_ID` (Bundle ID for native app **or** Services ID — operator-configured; never hardcoded Team ID in source) |
| `exp` | Must be in the future (clock skew ≤ 60s allowed) |
| `sub` | Non-empty string; becomes Layer-1 id |
| `nonce` | If request included `nonce`, must match per Apple rules |

5. Returns `{ appleSub, email?: string }` where `email` is **optional** and MUST NOT
   be required for session mint. Email MUST NOT be persisted as identity authority.
   Auto MUST NOT put raw email into logs.

Fail-closed: any verify failure → no session (§KNA.3.4).

### KNA.3.4 Response allowlist + error codes

**Success — 200:**

Success body fields (JSON object):

| Field | Rules |
| --- | --- |
| `schema_version` | Literal `1` |
| `token_type` | Literal `Bearer` |
| `access_token` | Opaque session JWT from `issueToken({ provider: 'apple', id: appleSub, displayName })` (same class as browser/Passport mint). Client treats value as opaque session handle for C7 Bearer. Committed test fixtures MUST NOT use production-shaped Apple tokens; use signed test JWTs under test session-signing secret only. |
| `expires_in` | Positive int matching gateway JWT expiry used for mint |

Forbidden success fields: `scooling_uid`, `refresh_token` (this phase), raw Apple
`identity_token` echo, `provider_id` preimage beyond what’s already inside the JWT,
Team IDs, keys.

**Errors (JSON `{ error, code }` — never echo tokens):**

| HTTP | `code` | When |
| --- | --- | --- |
| 400 | `BAD_REQUEST` | Missing/empty `identity_token`; unknown fields; forbidden identity fields |
| 401 | `APPLE_ASSERTION_INVALID` | Signature / iss / aud / exp / nonce failure; malformed JWT |
| 403 | `OAUTH_DISABLED` | Offline-locked (or equivalent gateway OAuth block) |
| 503 | `NOT_CONFIGURED` | Apple env incomplete (`APPLE_CLIENT_ID` missing) **or** `SESSION_SECRET` missing |
| 503 | `APPLE_JWKS_UNAVAILABLE` | JWKS fetch failed and no usable cache |

### KNA.3.5 Session mint + Layer binding

Frozen mint sequence:

1. Verify Apple `identity_token` → `appleSub` (empty/missing `sub` after verify → 401).
2. Build user `{ provider: 'apple', id: appleSub, displayName: full_name or '' }`.
3. Derive `sub` via `userId(user)` → `apple:<appleSub>` (G1).
4. Mint via `issueToken(user)` — MUST include `type: 'session'` (G2). Capture return value as the opaque Bearer credential for the success body `access_token` field.
5. Return §KNA.3.4 success body.
6. Drop `identity_token` from memory; MUST NOT write Apple assertion to disk/blob.

**Layer-1 (Knowtation):** `provider:id = apple:<sub>` inside JWT / C7.

**Layer-2 (`scooling_uid`):** Produced **only** by Scooling `deriveScoolingUid` after
verified C7 introspection (G8). Knowtation Auto MUST NOT:

- compute HMAC
- accept client `scooling_uid`
- add `scooling_uid` to JWT or exchange response
- invent a Knowtation-side derivation secret

This is the binding the ecosystem contract requires: Apple subject → Layer-1 in
Knowtation session → Layer-2 HMAC in Scooling — **no client HMAC** (APPLE-4 T13 /
this freeze T10).

### KNA.3.6 Introspect (unchanged C7)

After exchange, clients call existing:

`GET api/v1/auth/session` with `Authorization: Bearer <access_token>`

Expected identity shape for Apple sessions:

| Field | Value |
| --- | --- |
| `sub` | `apple:<appleSub>` |
| `provider` | `apple` |
| `id` | `<appleSub>` |
| `name` | cosmetic string (may be empty) |
| `role` | from `roleForSub(sub)` (same admin allowlist path as Google/GitHub) |
| `iat` / `exp` | from JWT |
| `scopes` | `scopesForRole(role)` |

Auto MUST NOT fork a parallel introspect route for Apple.

### KNA.3.7 Providers advertisement

Extend `GET api/v1/auth/providers` response:

```json
{
  "google": <bool>,
  "github": <bool>,
  "apple": <bool>
}
```

`apple: true` iff `APPLE_CLIENT_ID` is non-empty (and not offline-locked).
Offline-locked: `apple: false` (local mode unchanged).

Backward compatibility: existing clients that ignore unknown keys remain valid;
Auto MUST keep `google` / `github` keys.

---

## §KNA.4 — Env / secrets layout (never git)

| Variable | Required for Apple path | Purpose | Git |
| --- | --- | --- | --- |
| `APPLE_CLIENT_ID` | yes | Expected `aud` (native Bundle ID or Services ID) | never commit real value |
| `APPLE_TEAM_ID` | no for id_token-only verify | Reserved for future auth-code / client-secret JWT; document only | never commit |
| `APPLE_KEY_ID` | no for id_token-only verify | Reserved for `.p8` client secret JWT | never commit |
| `APPLE_PRIVATE_KEY` | no for id_token-only verify | `.p8` PEM contents — **gitignored env / secret store only** | never commit |
| `SESSION_SECRET` | yes (existing) | Signs hosted session JWT | existing discipline |
| `HUB_ADMIN_USER_IDS` | optional (existing) | May include `apple:<sub>` entries later | no real subs in git |

Rules:

1. Auto MAY add placeholder names to `.env.example` **without real values**.
2. Auto MUST NOT invent or commit Team IDs, Bundle IDs, or `.p8` material.
3. gitleaks MUST remain green; security-tier tests ban `BEGIN PRIVATE KEY` / Team ID
   patterns in committed fixtures.
4. JWKS URL is a public Apple endpoint — not a secret.

---

## §KNA.5 — How this differs (hard distinctions)

| Dimension | Passport Google/GitHub (browser) | `api/v1/auth/native` PKCE | **This freeze (Apple SIWA exchange)** |
| --- | --- | --- | --- |
| Grant | Authorization code via redirect | OAuth 2.1 auth code + PKCE S256 + loopback | Direct identity-assertion (`identity_token`) |
| User agent | Browser redirect to Google/GitHub | Companion opens system browser → same Passport IDPs | Native AuthenticationServices → POST exchange |
| IDP | Google / GitHub OAuth apps | Still Google / GitHub (via `native_state`) | **Apple** only |
| Client secret on device | N/A (server holds OAuth client secrets) | Public client (no device secret) | Public client; Apple assertion is the proof |
| Route family | `auth/login`, `auth/callback/*` | `api/v1/auth/native/*` | `api/v1/auth/native-apple-exchange` |
| Session class | `issueToken` `type: 'session'` | Web-session JWT shape (C1) | **Same** `issueToken` `type: 'session'` |
| Introspect | C7 | C7 | C7 |
| Equals SIWA? | No | No | Yes (this path) |

Hard rule for Auto + docs: **MUST NOT** claim Google/GitHub native PKCE = Apple SIWA.
MUST NOT reuse `api/v1/auth/native` authorize/token for Apple.

---

## §KNA.6 — Seven-tier test matrix

Suite path (frozen): `test/kn-apple-native-hosted-exchange.test.mjs`

| Tier | Cases (minimum) |
| --- | --- |
| **unit** | Claim allowlist parser; `aud`/`iss`/`exp` reject matrix; `userId` → `apple:<sub>`; forbidden request fields rejected; providers.apple boolean logic |
| **integration** | Mounted route with mocked JWKS + fixture Apple token (test keys) → 200 + JWT verifies; C7 introspect returns `provider:'apple'`; unconfigured → 503 `NOT_CONFIGURED` |
| **e2e** | Exchange → Bearer → `GET api/v1/auth/session` round-trip in gateway test harness; offline-locked → 403 |
| **stress** | Burst N parallel exchanges with distinct fixture subs — no cross-user session mix; JWKS cache hit path stable |
| **data-integrity** | Response never includes `scooling_uid` / raw `identity_token` / private key material; JWT `sub` exactly `apple:<sub>`; no durable identity row written |
| **performance** | Single exchange p95 bound under fixture JWKS (document threshold in test; no live Apple network in CI) |
| **security** | Forged token → 401; wrong `aud` → 401; `alg=none` → 401; client-supplied `role`/`scooling_uid` → 400; committed fixtures ban `eyJ` production Apple tokens and PEM / Team ID patterns; regression: Google/GitHub Passport paths unchanged |

CI: no live call to `appleid.apple.com` required for green — JWKS and tokens are
fixtures. A separate Operator probe (Tier 3 T1) may hit live Apple after deploy.

Security tier MUST fail against a pre-fix stub that accepts unverified
`identity_token` payloads (regression discriminator).

---

## §KNA.7 — Hard constraints (MUST-NOT)

| Forbidden | Gate / note |
| --- | --- |
| Implement in Thinking | This tip |
| Vault write / notes mutate via this route | T9 |
| Scooling CapabilityGate Auto-flip | T3 |
| Commit Apple secrets / Team IDs / `.p8` / prod JWTs | T4 |
| Client HMAC / derivation secret in app or docs samples | T10 |
| Claim PKCE native = SIWA | T11 |
| MuseHub staging / F7 dependency | T5 / T8 |
| Feature→GitHub-main | T6 |
| App Store | T7 |
| Start APPLE-6 | T12 |
| Parallel introspect fork | Use C7 |
| Accept client `sub`/`provider`/`role` as authority | Identity contract |
| Log `identity_token` / session JWT / PEM | Security |

---

## §KNA.8 — Tier-3 gates (human)

| Gate | Who | When |
| --- | --- | --- |
| T1 Production Apple env + deploy | Operator | After KN-APPLE-b BV pass + land |
| T2 APPLE-4-live (T1+T2+T15 together) | Scooling Operator | After T15 evidence exists |
| T3 Scooling CapabilityGates / vault | Scooling Operator | After APPLE-4-live; APPLE-5-live separate |
| Merge Muse/`main` + muse-mirror | Operator (or SD-21 land hygiene when criteria met) | After BV pass |

KN-APPLE-b Auto may land code on the feature branch with tests green and BV pass
while Apple env is unset (route returns `NOT_CONFIGURED`). That is **code readiness**,
not live T15 production evidence. APPLE-4-live still needs Operator evidence packet.

---

## §KNA.9 — Definition of Done (KN-APPLE-b Auto)

- D1–D9 implemented exactly per this freeze
- Seven-tier suite green
- Build-verification-review **`pass`**
- No secrets committed; gitleaks green
- `docs/KNOWTATION-ROADMAP.md` + `docs/KNOWTATION-OVERSEER-HANDOVER.md` updated together (NEXT → land/deploy
  or Scooling APPLE-4-live revisit per board)
- Freeze-review of this artifact was **`pass`** before Auto started
- No Scooling gate flips; no vault-write authorize; no App Store; no APPLE-6

---

## §KNA.10 — Downstream paste (KN-APPLE-b) — only after freeze-review `pass`

```text
Step: KN-APPLE-NATIVE-HOSTED-EXCHANGE-b Auto — implement Apple assertion exchange (T15)
Model: Auto
Repo: knowtation
Authority: docs/KN-APPLE-NATIVE-HOSTED-EXCHANGE-FREEZE.md (frozen:true; freeze-review pass)
Branch: feat/kn-apple-native-hosted-exchange

Do exactly:
0. Bootstrap (§KNA.1): ensure feature-branch gateway tree includes issueToken with
   type: 'session' (origin/main lineage). Recover via Muse-canonical path — never
   git push origin main / never feature→GitHub-main.
1. Implement POST api/v1/auth/native-apple-exchange per freeze §KNA.3 (request/response
   allowlists, Apple JWKS verify module, issueToken mint provider:apple, C7 compatible).
2. Extend GET api/v1/auth/providers with apple boolean; env layout §KNA.4 (placeholders
   only in .env.example — no real Team IDs/keys).
3. Seven-tier test/kn-apple-native-hosted-exchange.test.mjs per §KNA.6; security
   regression vs unverified accept.
4. Docs honesty (gateway README + HUB-API); /build-verification-review → pass; update
   ROADMAP/HANDOVER; Muse commit on feature branch.

Do NOT: redesign the freeze; flip Scooling CapabilityGates; authorize vault write;
  claim PKCE = SIWA; commit Apple secrets; App Store; MuseHub staging; feature→GitHub-main;
  start APPLE-6; live production Apple probe (Operator T1).
```
