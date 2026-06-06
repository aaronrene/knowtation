# Companion App — Phase 3: OAuth Native/Public Client (PKCE + Loopback Redirect)

**Status:** accepted design + implementation (pure protocol core + pure custody; **no socket
bound, no network, no real keychain I/O**).
**Branch:** `feat/companion-app` (Muse-canonical; not a docs-only PR to `main`).
**Phase table ref:** Gate §12, Phase 3 — 🧠 Thinking. "Auth/crypto protocol correctness (PKCE,
redirect handling, keychain). Subtle deviations create real account-compromise paths."
**Depends on:** Phase 0 Decision Record (gate §13, D1–D3), Phase 1 adapter seam
([`COMPANION-APP-PHASE-1-ADAPTER-SEAM.md`](COMPANION-APP-PHASE-1-ADAPTER-SEAM.md)), Phase 2
loopback security core ([`COMPANION-APP-PHASE-2-LOOPBACK-SECURITY.md`](COMPANION-APP-PHASE-2-LOOPBACK-SECURITY.md)).
**Upstream:** [`COMPANION-APP-DESIGN-AND-AUTHORIZATION-GATE.md`](COMPANION-APP-DESIGN-AND-AUTHORIZATION-GATE.md)
§3 (OAuth model), §4.1 (per-session bearer token), §12 phase table row 3, the "DOES NOT approve"
list; [`COMPANION-APP-MODEL-ROUTING-AND-ENRICHMENT-ARCHITECTURE.md`](COMPANION-APP-MODEL-ROUTING-AND-ENRICHMENT-ARCHITECTURE.md)
§3 (client-side constraint), §5 (OAuth for the companion).

---

## Simple summary

When you sign the companion app into Knowtation, it should log you in **the same way a normal
website login works**, but safely for a program running on your own computer. The safe pattern for
"native" apps (desktop/mobile) is well established and written down in internet standards:

- It opens your **real web browser** (never a fake in-app browser), so you can see the genuine
  Knowtation/Google/GitHub login page and your password manager works.
- It uses a trick called **PKCE** so that even if another program on your machine grabs the
  one-time login "code" as it comes back, that code is **useless** without a secret the companion
  kept to itself.
- It carries **no password and no app secret baked into the download** — there is nothing to steal
  by cracking open the installed app.
- It puts the resulting login token in the **operating system's secure keychain**, not a plain file
  and never in a log.

This phase builds and exhaustively tests the **rules of that handshake as pure math** — generate
the secret, build the login link, check the reply hasn't been tampered with, build the token
request, check the token reply, and decide when to refresh. It deliberately does **not** yet open
any network port, talk to the internet, open the browser, or touch the real keychain. Those
physical actions are the single most dangerous step and are bundled into a later, separately
approved step (Phase 5), exactly as Phase 2 did with its socket.

## Technical summary

Phase 3 delivers two pure modules and their 7-tier suites:

- **`lib/companion-oauth-pkce.mjs`** — the Authorization-Code-with-PKCE protocol core for a
  **native/public client** (RFC 7636, RFC 8252), **S256-only**, with RFC 9207 `iss` support:
  `createPkcePair`, `computeCodeChallenge`, `createOAuthState`, `createNonce`,
  `buildAuthorizationUrl`, `validateRedirectUri`, `validateAuthorizationResponse`,
  `buildTokenRequest`, `buildRefreshRequest`, `validateTokenResponse`, `decideTokenRefresh`,
  plus the `constantTimeEqual` primitive. No socket, no `fetch`, no env, no clock, no logging.
- **`lib/companion-token-custody.mjs`** — pure custody logic over an **injected** keychain adapter
  (`{ get, set, delete }`): `buildSessionMeta`, `createTokenCustody(...)` →
  `storeSession`/`loadSession`/`clearSession`/`updateAccessToken`/`decide` plus the Phase 2
  per-session loopback-token lifecycle (`storeLoopbackToken`/`getLoopbackToken`/
  `rotateLoopbackToken`/`clearLoopbackToken`). It performs **no real keychain I/O** — Phase 5
  supplies the OS-backed adapter (Keychain / DPAPI / libsecret); tests inject an in-memory fake.

This scope is deliberate and gate-compliant. The gate's "DOES NOT approve" list forbids **"no new
local HTTP listener"** and **"Any change to OAuth client registration or scopes."** Phase 3 binds
no listener (the RFC 8252 loopback **redirect** listener is bound, together with the Phase 2
inference socket, only at the Phase 5 bind gate), registers no OAuth client, and alters no scopes
(the authorization server, `client_id`, and scope list are all **injected inputs** — the core is
provider-agnostic). Everything is **fail-closed**: any missing/ambiguous/malformed input denies,
and no token / JWT / refresh token / authorization code / `code_verifier` / `state` ever appears in
a `reason`, a log value, or a thrown error.

---

## 1. Scope decisions (owner-approved 2026-06-05)

### D-P3.1 — Pure-then-bind (CONFIRMED)

Phase 3 builds the OAuth/PKCE **protocol core** and the **custody decision layer** as pure,
fully-tested, I/O-free functions. **No socket bind, no network fetch, no system-browser launch, no
real OS-keychain I/O.** The loopback redirect listener bind, the TLS POST to the token endpoint,
opening the system browser, and the real Keychain/DPAPI/libsecret calls are deferred to **Phase 5**
(the shared bind gate that also opens the Phase 2 inference socket) — see [§6](#6-what-phase-5-must-do-to-bind-safely).
This mirrors how Phase 1 and Phase 2 shipped pure logic and deferred I/O.

### D-P3.2 — Provider-agnostic core; client-registration boundary respected (CONFIRMED)

Verified against source (`hub/gateway/mcp-oauth-provider.mjs`, `hub/gateway/server.mjs`):

- The existing MCP OAuth provider **is already a public client + PKCE + dynamic client
  registration** (it mints a `client_id` and stores **no `client_secret`**), and the MCP SDK token
  handler performs the actual PKCE verification (`challengeForAuthorizationCode` → stored challenge,
  then `S256(code_verifier)` compare). A native client **can** register a loopback `redirect_uri`
  via dynamic registration.
- **However**, two facts mean "the companion gets the **same JWT / same scopes** as the web
  session" (gate §3, brief §5) is **not** delivered by that provider as-is:
  1. **Token/scope mismatch.** The web-session JWT (`issueToken`) is `{ sub, provider, id, name,
     role }` with **no `scopes` claim** — scopes are role-derived at introspection
     (`scopesForRole`: member → `[vault:read, vault:write]`). The MCP path issues a **different**
     token, `type:'mcp_access'`, defaulting to **`['vault:read']`** (read-only).
  2. **Deployment.** The MCP OAuth provider is mounted only when `SESSION_SECRET && !NETLIFY`
     (persistent server) and is **explicitly skipped on the hosted Netlify gateway**.

**Decision:** Phase 3 is **provider-agnostic**. `authorizationEndpoint`, `tokenEndpoint`,
`clientId`, and `scopes` are all **injected inputs**; the core hardcodes none of them, registers no
client, and changes no scope. Whether the native/loopback client is issued **web-session-equivalent
scopes** (read **and** write — required for the companion to write `ai_summary` enrichment back per
D3/§6) and whether the PKCE provider runs on the hosted deployment is a **separate server-side OAuth
gate** and a **Phase 5 prerequisite** (see [§7](#7-server-side-oauth-gate-phase-5-prerequisite)).
This keeps Phase 3 strictly inside the gate while making the server-side gap explicit rather than
smuggled in.

### D-P3.3 — RFC 9207 `iss`: optional-but-validated (CONFIRMED)

`validateAuthorizationResponse` supports an `expectedIssuer`. **If** an `expectedIssuer` is supplied
**and** the callback carries `iss`, an exact **constant-time** match is required (a mismatch is
rejected — the property that actually stops a mix-up). If `iss` is absent it is **tolerated** for
back-compat (the current provider does not emit `iss` yet). The day the server emits `iss`, clients
that pass `expectedIssuer` get full mix-up protection with **zero client change**. Emitting `iss`
on the redirect is a documented server-side follow-up (part of the §7 gate).

---

## 2. Adversarial threat model → exact control

The native-app OAuth flow's most dangerous moment is the **authorization-code round-trip on the
loopback redirect**: any local process can race for the code, and any page/AS can try to confuse
the exchange. Each attacker capability below is paired with the **exact** control that stops it,
argued against the attacker — not pattern-matched.

| # | Attacker capability | Exact control | Where |
| --- | --- | --- | --- |
| **a** | **Authorization-code interception** by a malicious local app listening on / racing the loopback redirect. | **PKCE S256**: the code is bound to the `code_verifier`. The attacker captures the code but not the verifier (it never leaves the companion until the TLS token POST), so the token exchange fails (`invalid_grant`). | `createPkcePair` / `computeCodeChallenge` (S256 only); `buildTokenRequest` carries `code_verifier`; proven in `…-e2e` "PKCE interception attack fails". |
| **b** | **CSRF / session-fixation** on the callback (attacker injects their own code/state). | **`state`**: high-entropy CSPRNG value bound to the pending request, compared in **constant time**; mismatch/absence denies. Single-use (caller discards after one callback). | `createOAuthState`; `validateAuthorizationResponse` (`STATE_MISMATCH`/`STATE_MISSING`); `constantTimeEqual`. |
| **c** | **Authorization-server / redirect mix-up** (client juggling >1 AS is fed a response from the wrong one). | **RFC 9207 `iss`** constant-time match when present (D-P3.3); plus exact loopback redirect validation. | `validateAuthorizationResponse` (`ISSUER_MISMATCH`). |
| **d** | **PKCE downgrade to `plain`** (strip S256 so a captured challenge == verifier). | **S256 enforced**: the client never constructs a non-S256 request and there is no `plain` code path at all. | `buildAuthorizationUrl` throws on any non-`S256` method; `computeCodeChallenge` is S256-only. |
| **e** | **Open-redirect / `redirect_uri` manipulation** (point the redirect at an attacker target). | **Strict RFC 8252 loopback-literal allowlist, no wildcard**: only `http://127.0.0.1:<port>` / `[::1]` (or an explicit caller allowlist), explicit numeric port, no userinfo/query/fragment. | `validateRedirectUri`; enforced inside `buildAuthorizationUrl` + `buildTokenRequest`. |
| **f** | **JWT / refresh-token theft at rest** (read a dotfile / env / log). | **OS keychain only**, via the injected adapter — never a plaintext file, never env, never logged. Metadata stored separately holds **no** token. | `companion-token-custody.mjs`; proven in `…-custody-security`. |
| **g** | **Client-secret extraction** from the distributed binary. | **Public client, NO secret on device**: no `client_secret` is ever built into a URL or token request, and `extraParams` cannot inject one. | `buildAuthorizationUrl` / `buildTokenRequest` (no secret; `client_secret` dropped). |
| **h** | **Authorization-response replay** (re-send a captured callback). | **One-time `state`** (caller discards → replay fails closed) + **single-use code** (the AS burns it; a second exchange returns `invalid_grant`). | `validateAuthorizationResponse`; `…-security`/`…-e2e` replay tests. |
| **i** | **Embedded-webview phishing** (a fake login UI harvests credentials). | **System browser only** (RFC 8252 §8.12) — Phase 5 launches the OS default browser; an embedded webview is forbidden. The protocol core emits only a URL for the OS to open. | [§6](#6-what-phase-5-must-do-to-bind-safely) (Phase 5 obligation). |
| **j** | **Secret exfiltration via logs/errors.** | Fixed-constant `reason` codes; thrown errors carry fixed messages; success returns the code only through its legitimate return channel. | both modules; `…-security` "no secret in any output". |

---

## 3. Module contract — `lib/companion-oauth-pkce.mjs`

All functions are pure (no I/O, no env, no clock, no logging). `now` is always injected.

| Function | Purpose | Fail-closed behavior |
| --- | --- | --- |
| `createPkcePair()` | `{ codeVerifier, codeChallenge, method:'S256' }`; verifier = 32 CSPRNG bytes base64url (43 chars, ≥256-bit). | — (generator) |
| `computeCodeChallenge(verifier)` | `base64url(SHA-256(ASCII(verifier)))`, S256 only; validates RFC 7636 §4.1 length+charset. | throws fixed-message (no secret) on invalid verifier. |
| `createOAuthState()` / `createNonce()` | 32 CSPRNG bytes base64url (CSRF / replay). | — (generator) |
| `buildAuthorizationUrl({...})` | Pure auth URL: `response_type=code`, `code_challenge_method=S256`, exact loopback `redirect_uri`, injected `client_id` + space-joined `scope` + `state`; optional `nonce`. HTTPS AS endpoint required. | throws on non-S256, non-https AS, bad redirect, missing field; `extraParams` cannot override security params or inject `client_secret`. |
| `validateRedirectUri(uri,{allowedHosts})` | RFC 8252 loopback rules. | `{ok:false, reason}`; reason never carries the URI. |
| `validateAuthorizationResponse({params, expectedState, expectedIssuer?})` | Constant-time state compare; reject `error`; RFC 9207 `iss`; extract `code`. | `{ok:false, reason[, errorCode]}`; **never** carries code/state; only allowlisted RFC 6749 error codes surface; free-text `error_description` never surfaces. |
| `buildTokenRequest({...})` | Pure `authorization_code` request **descriptor** (`grant_type`, `code`, `code_verifier`, `redirect_uri`, `client_id`). **No `fetch`.** | throws on non-https token endpoint, bad verifier, bad redirect; never a `client_secret`. |
| `buildRefreshRequest({...})` | Pure `refresh_token` request descriptor; optional subset `scope`; no secret. | throws on bad config. |
| `validateTokenResponse(json)` | Shape-validate `{ accessToken, refreshToken?, expiresIn, tokenType:'Bearer', scope? }`; requires `token_type=bearer` + positive-integer `expires_in`; length-bounded. | `{ok:false, reason[, errorCode]}` on anything off (incl. oversized). |
| `decideTokenRefresh({expiresAt, now, skewMs?, refreshExpiresAt?})` | `'valid' \| 'refresh' \| 'reauth'`. | malformed/missing input → `'reauth'` (safest). |
| `constantTimeEqual(a,b)` | SHA-256 + `timingSafeEqual`; no length oracle. | non-string/empty → `false` without compare. |

**Reason codes** (`OAUTH_PKCE_REASONS`, frozen): `ok`, `malformed_input`,
`authorization_server_error`, `state_missing`, `state_mismatch`, `issuer_mismatch`, `missing_code`,
`invalid_redirect_uri`, `unsupported_pkce_method`, `invalid_token_response`.

## 4. Module contract — `lib/companion-token-custody.mjs`

Pure custody over an **injected** `{ get, set, delete }` adapter (sync or Promise-returning; every
call is awaited). Keychain accounts (`KEYCHAIN_ACCOUNTS`): `accessToken`, `refreshToken`,
`sessionMeta` (non-secret), `loopbackToken`.

- `buildSessionMeta(tokenResponse, { now, refreshTtlMs?, issuer? })` → pure non-secret metadata
  (`expiresAt`, `refreshExpiresAt`, `scope`, `tokenType`, `issuer`, `storedAt`).
- `createTokenCustody(adapter)` →
  `storeSession({accessToken, refreshToken?, meta})`, `loadSession()` (fail-closed → `null`),
  `updateAccessToken({accessToken, meta, refreshToken?})` (refresh rotation), `clearSession()`
  (logout / refresh-reuse; removes **both** tokens + meta; **does not** touch the loopback token),
  `decide({now, skewMs?})` (delegates to `decideTokenRefresh`; no session → `'reauth'`), and the
  loopback lifecycle `storeLoopbackToken`/`getLoopbackToken`/`rotateLoopbackToken`/
  `clearLoopbackToken`.

**Custody/rotation rules:**
- **JWT (access token):** short-lived; replaced on every refresh (`updateAccessToken`).
- **Refresh token:** rotated whenever the server returns a new one; on `invalid_grant`/reuse the
  caller invokes `clearSession()` → force a fresh browser login (mirrors the server-side
  reuse-detection family-revoke in `hub/lib/refresh-token-core.mjs`).
- **Phase 2 loopback token:** per-session; **rotated at each companion start**
  (`rotateLoopbackToken`), stored under its **own** account (a compromise of one secret is not a
  compromise of the other), and **independent** of OAuth logout (survives `clearSession`).

---

## 5. RFC conformance

- **RFC 7636 (PKCE).** Verifier per §4.1 (unreserved charset, 43–128 chars, ≥256-bit CSPRNG);
  challenge per §4.2 (`S256 = BASE64URL(SHA-256(ASCII(verifier)))`); **S256 only**, `plain`
  rejected (§7.2 downgrade defense). The RFC 7636 Appendix B test vector is asserted directly in
  `…-unit`.
- **RFC 8252 (OAuth for Native Apps).** Loopback redirect (§7.3) with literal-IP host (§8.3,
  `127.0.0.1`/`[::1]` preferred over `localhost`), plain `http` for the loopback redirect only,
  variable ephemeral port (the AS must permit it), system browser (§8.12, Phase 5), public client
  (§8.5, no secret).
- **RFC 6749 (OAuth 2.0).** Authorization request §4.1.1, token request §4.1.3, refresh §6,
  token/error responses §5.1/§5.2, `state` CSRF §10.12.
- **RFC 9207 (Issuer Identification).** `iss` validated when present (mix-up defense), adopted as
  optional-but-validated (D-P3.3).

Crypto uses **Node `node:crypto`** exclusively (`randomBytes`, `createHash`, `timingSafeEqual`) —
no hand-rolled primitives.

---

## 6. What Phase 5 must do to bind safely

The pure core is the protocol; Phase 5 (companion shell) performs the I/O — the single most
security-critical step, behind an explicit gate, binding **both** the Phase 2 inference socket and
this phase's loopback **redirect** listener. When Phase 5 binds, it MUST:

1. **Open the SYSTEM browser, never an embedded webview** (RFC 8252 §8.12). Launch the OS default
   browser with the string from `buildAuthorizationUrl`. An in-app webview is forbidden (attacker
   capability **i**).
2. **Bind the loopback redirect listener on `127.0.0.1` (or `[::1]`) with an OS-assigned ephemeral
   port** (`listen(0, '127.0.0.1')`); never `0.0.0.0`, never a fixed port. Construct the
   `redirect_uri` from the actual bound port and pass it through `validateRedirectUri`. This listener
   shares the Phase 2 bind gate.
3. **Generate `state`, `nonce`, and the PKCE pair per attempt** with this module; keep the
   `code_verifier` and `state` in memory only; **discard `state` after one callback** (one-time).
4. **On the callback**, parse query params and call `validateAuthorizationResponse({ params,
   expectedState, expectedIssuer })`. On `ok:false`, abort and surface a generic message; never log
   the raw callback.
5. **POST the token request over TLS** using the `buildTokenRequest` descriptor — verify the TLS
   certificate (no `rejectUnauthorized:false`), enforce HTTPS, and never attach a `client_secret`.
6. **Validate the token response** with `validateTokenResponse`, then `buildSessionMeta` and
   `storeSession` into the **OS keychain** via the real adapter (macOS Keychain / Windows DPAPI /
   Linux libsecret). Never write a token to a file or a log.
7. **Drive refresh** with `decide`/`decideTokenRefresh`: `'valid'` → use; `'refresh'` →
   `buildRefreshRequest` → POST → `updateAccessToken` (rotate); `'reauth'` or any
   `invalid_grant`/reuse → `clearSession` → restart the browser flow.
8. **Manage the Phase 2 loopback token** with `rotateLoopbackToken` at each start and
   `clearLoopbackToken` at shutdown; pass it to the Phase 2 guard as `expectedToken`.
9. **Ship its own 7-tier suite** for the bind/lifecycle layer (listener bind assertion,
   ephemeral-port randomness, browser-launch invocation, real keychain read/write, TLS POST) per
   gate §10 — the pure cores' suites do not absolve the listener of its own tests.

Until that explicit Phase 5 gate is approved, **no socket is bound, no network call is made, and no
real keychain is touched.**

---

## 7. Server-side OAuth gate (Phase 5 prerequisite)

Phase 3 changes **no** server-side OAuth. Before the companion can obtain a **web-session-equivalent
(read+write) identity** on the **hosted** deployment, a separate server-side OAuth gate must decide:

1. **Native/loopback client at web-session scopes.** Either (a) the MCP OAuth provider issues the
   companion the role-derived web scopes (`[vault:read, vault:write]`) rather than the read-only
   `mcp_access` default, or (b) a dedicated native-client authorization path issues the
   web-session JWT (`issueToken`). Today the MCP path defaults to `['vault:read']` (read-only),
   which would make the companion unable to write `ai_summary` enrichment back (defeating §6/D3).
2. **Hosted availability.** The PKCE provider is currently skipped on Netlify
   (`SESSION_SECRET && !NETLIFY`). The companion targets the hosted gateway, so the gate must decide
   how the PKCE authorization/token endpoints are served on the hosted deployment.
3. **RFC 9207 `iss` emission** on the redirect (enables required mix-up defense for clients that
   pass `expectedIssuer`).
4. **Loopback redirect_uri acceptance** with a variable port for the native client registration
   (RFC 8252 §7.3) — confirm the SDK auth-router/provider permits per-attempt ephemeral ports.

This gate is itself security-sensitive (it touches client registration + scopes — the very items
the companion gate's "DOES NOT approve" list protects) and warrants its own review.

---

## 8. Test obligations satisfied (gate §10, 7 tiers × 2 modules)

`lib/companion-oauth-pkce.mjs` — `test/companion-oauth-pkce-*.test.mjs` (100 cases):

| Tier | Focus |
| --- | --- |
| Unit | Each function in isolation; RFC 7636 Appendix B vector; RFC 8252 redirect rules; token/refresh decisions. |
| Integration | The functions composed across the flow; state + PKCE bindings survive a URL round-trip. |
| End-to-end | Full client sequence vs a simulated PKCE-enforcing AS + token endpoint: happy path, interception failure, user-deny, single-use code. |
| Stress | 50k PKCE pairs / 100k states+nonces (no collisions); 100k wrong-state callbacks (zero admits); 50k malformed token responses (zero admits). |
| Data-integrity | Determinism; no input mutation; env-independence; stable verdict shapes. |
| Performance | Coarse upper bounds (pair/challenge/build/validate at 10k–200k). |
| **Security** | **Centerpiece:** S256 correctness + verifier entropy; `plain` rejected; state mismatch constant-time; AS error without leak; loopback/wildcard/foreign redirect rejected; no client secret + response_type=code + S256; token request carries `code_verifier`; oversized token response fails closed; replay rejected; no secret in any output/reason/error. |

`lib/companion-token-custody.mjs` — `test/companion-token-custody-*.test.mjs` (35 cases): unit,
integration, e2e, stress, data-integrity, performance, and **security** (secrets persist only via
the adapter; no log ever contains a secret; thrown errors carry none; `clearSession` truly removes
both tokens; loopback token isolated from the OAuth session; corrupt-store load fails closed).

---

## 9. Deferred (explicitly not Phase 3)

- The loopback **redirect** listener bind, ephemeral-port allocation, system-browser launch, the
  TLS token POST, and real OS-keychain I/O — **Phase 5** behind the shared bind gate (§6).
- Any **server-side** OAuth change (web-session-equivalent native-client scopes, hosted PKCE
  availability, `iss` emission, loopback redirect registration) — the **separate OAuth gate** (§7).
- Any change to OAuth client registration or scopes in this phase (gate "DOES NOT approve" —
  unchanged).
