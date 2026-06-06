# Companion App — Phase 3 Session Prompt (OAuth Native/Public Client — PKCE + Loopback Redirect, JWT in OS Keychain)

**Use this to seed a fresh chat session.** Start that session on a **thinking model (Opus)** — Phase 3
is a full 🧠 phase (auth-protocol/crypto correctness; subtle deviations create real account-compromise
paths), not Hybrid. Stay on a thinking model for the whole phase.

---

## 0. Copy-paste prompt (paste this into the new session)

```text
You are continuing the Knowtation Companion App build on the Muse branch feat/companion-app.
This is PHASE 3 — OAuth native/public client: PKCE + loopback redirect (RFC 7636 / RFC 8252),
no device-side client secret, JWT in the OS keychain. It is a 🧠 Thinking phase: auth-protocol and
crypto correctness, where a subtle mistake is an account-compromise path, not a style nit. Argue
each control against an attacker model; do not pattern-match. Stay on a thinking model the whole phase.

FIRST, read these in full (do not skip):
  - docs/COMPANION-APP-DESIGN-AND-AUTHORIZATION-GATE.md  (§3 OAuth model; §4.1 the per-session
    bearer token; §12 phase table row 3; the "DOES NOT approve (no code)" list — ESPECIALLY
    "Any change to OAuth client registration or scopes" and "no new local HTTP listener")
  - docs/COMPANION-APP-MODEL-ROUTING-AND-ENRICHMENT-ARCHITECTURE.md  (§5 OAuth for the companion,
    §3 client-side constraint)
  - docs/COMPANION-APP-PHASE-1-ADAPTER-SEAM.md and lib/model-runtime-lane.mjs  (the seam; lane logic)
  - docs/COMPANION-APP-PHASE-2-LOOPBACK-SECURITY.md and lib/companion-loopback-guard.mjs  (Phase 2
    output: the per-session loopback bearer token whose CUSTODY this phase defines; both the loopback
    inference socket AND this phase's loopback redirect listener are bound together in Phase 5)
  - hub/gateway/mcp-oauth-provider.mjs  (EXISTING server-side "PKCE + dynamic client registration"
    OAuth provider — read it to learn what a native/public + loopback-redirect client needs, and to
    determine whether that is already supported or would require a server-side OAuth change)
  - hub/auth-session.mjs and hub/lib/refresh-token-core.mjs  (EXISTING JWT session + refresh-token
    custody patterns; the browser uses an HttpOnly cookie — the companion uses the OS keychain instead)
  - hub/bridge/server.mjs  (EXISTING patterns to stay consistent with: signState/verifyState HMAC
    state, userIdFromJwt = jwt.verify(token, SESSION_SECRET), and the GitHub OAuth connect flow)
  - lib/github-connection.mjs  (existing OAuth connection helper)

RESOLVE THESE SCOPE QUESTIONS BEFORE WRITING ANY LISTENER / NETWORK / KEYCHAIN CODE (ask me):
  1. PURE-THEN-BIND scope (mirrors Phase 1 and Phase 2). Proposed: Phase 3 builds the OAuth/PKCE
     PROTOCOL CORE as pure, fully-tested functions (PKCE pair + S256 challenge, state/nonce generate
     + constant-time validate, RFC 8252 loopback-redirect validation, authorization-response
     validation, token-REQUEST builder, token-RESPONSE validator, JWT expiry/refresh DECISION) with
     NO socket bind, NO network fetch, and NO real OS-keychain I/O. The loopback redirect LISTENER
     bind, the actual TLS POST to the token endpoint, opening the system browser, and the real
     Keychain/DPAPI/libsecret calls are deferred to Phase 5 (the shared bind gate that also opens the
     Phase 2 inference socket), or a separate explicit gate. Confirm this scope, or approve real I/O
     in Phase 3.
  2. CLIENT REGISTRATION boundary. The gate's "DOES NOT approve" list forbids "Any change to OAuth
     client registration or scopes." Confirm whether the existing provider
     (hub/gateway/mcp-oauth-provider.mjs) ALREADY supports a native/public client with a loopback
     redirect at the SAME scopes as the web session — in which case Phase 3 is purely client-side
     protocol code — or whether enabling that is a SERVER-SIDE OAuth change that needs its own gate
     before Phase 3 can target it. Do NOT register a new client or alter scopes in this phase.

THEN produce, in order:
  1. A short adversarial THREAT MODEL section. Attacker capabilities and the EXACT control that stops
     each: (a) authorization-code interception by a malicious local app on the loopback redirect
     (→ PKCE S256, code bound to code_verifier); (b) CSRF / session-fixation on the callback
     (→ state, constant-time compare); (c) authorization-server / redirect mix-up (→ exact loopback
     redirect validation per RFC 8252; consider RFC 9207 `iss`); (d) PKCE downgrade to "plain"
     (→ enforce method=S256, reject plain); (e) open-redirect / redirect_uri manipulation (→ strict
     loopback-literal allowlist, no wildcard); (f) JWT/refresh-token theft at rest (→ OS keychain,
     never a plaintext file, never logged); (g) client-secret extraction from the distributed binary
     (→ public client, NO secret on device); (h) authorization-response replay (→ one-time state,
     single-use code); (i) embedded-webview phishing (→ system browser only, RFC 8252).
  2. lib/companion-oauth-pkce.mjs — pure functions, no I/O, no env reads, no network, no socket:
       createPkcePair()                         → { codeVerifier, codeChallenge, method:'S256' }  (CSPRNG)
       computeCodeChallenge(codeVerifier)       → base64url(SHA-256(verifier))  (pure, S256 only)
       createOAuthState() / createNonce()       → high-entropy values  (CSPRNG)
       buildAuthorizationUrl({...})             → pure; response_type=code, S256, scope = web-session
                                                  scopes, exact loopback redirect_uri
       validateRedirectUri(uri, { allowedHosts })→ RFC 8252 loopback rules  (pure, fail-closed)
       validateAuthorizationResponse({ params, expectedState }) → constant-time state compare; reject
                                                  on error param; extract code  (fail-closed; NO
                                                  secret/code/state in any reason or thrown error)
       buildTokenRequest({...})                 → pure request descriptor (grant_type=authorization_code,
                                                  code, code_verifier, redirect_uri, client_id);
                                                  NO fetch — returns the body for Phase 5 to send
       validateTokenResponse(json)              → shape-validate; extract { accessToken, refreshToken?,
                                                  expiresIn, tokenType }; fail-closed on anything off
       decideTokenRefresh({ expiresAt, now, skewMs }) → 'valid' | 'refresh' | 'reauth'  (pure)
     Enforce: S256 only (reject 'plain'); constant-time comparisons; fail-closed on anything
     ambiguous/missing; NEVER put a token/JWT/refresh-token/code/code_verifier/state into a returned
     reason, a return value meant for logging, or any thrown error.
     (If a token-CUSTODY decision layer is warranted, add lib/companion-token-custody.mjs as a pure
     module that takes an INJECTED keychain adapter interface — no real keychain calls — defining
     what is stored, JWT/refresh lifecycle, and the per-session loopback token from Phase 2.)
  3. The 7-tier test suite test/companion-oauth-pkce-*.test.mjs (and custody tests if that module
     exists). The SECURITY tier is the centerpiece and must cover, at minimum: code_challenge is
     correct S256 of the verifier and verifier has sufficient entropy/length (RFC 7636 §4.1);
     'plain' method is rejected (no downgrade); state mismatch → reject (constant-time, no oracle);
     an authorization-server error response is surfaced without leaking; a non-loopback or
     wildcard/foreign redirect_uri is rejected (RFC 8252); the authorization URL never contains a
     client secret and uses response_type=code + S256; the token request carries the code_verifier
     (proves PKCE binding) and no client secret; a malformed/oversized token response fails closed;
     replay (reused state) is rejected; and NO secret (code, code_verifier, state, access/refresh
     token, JWT) appears in any output, reason, log, or thrown error.
  4. docs/COMPANION-APP-PHASE-3-OAUTH-PKCE.md — the accepted design + the module contract + the
     threat-model→control mapping + the RFC citations (7636/8252, and 9207 if adopted) + EXACTLY what
     Phase 5 must do to bind safely: open the system browser (never an embedded webview), bind the
     loopback redirect listener on 127.0.0.1 with an ephemeral port, perform the token-endpoint POST
     over TLS, store the JWT + refresh token in the OS keychain (Keychain/DPAPI/libsecret), and the
     custody/rotation rules for both the JWT and the Phase 2 per-session loopback token.

CONSTRAINTS:
  - Muse-canonical (knowtation). Commit on feat/companion-app via `muse code add` + `muse commit`.
    Do NOT open a docs-only PR to main (owner policy). Do NOT use git/gh for knowtation work.
  - Honor the gate "DOES NOT approve" list: no new local HTTP listener bound this phase; NO change to
    OAuth client registration or scopes; the companion acts at the SAME scopes as the web session.
  - RFC-correct: cite RFC 7636 (PKCE, S256 only), RFC 8252 (native apps: system browser + loopback
    redirect + exact match with variable loopback port), and consider RFC 9207 (iss) for mix-up
    defense. Use Node's crypto (randomBytes / createHash / timingSafeEqual) — NEVER hand-roll crypto.
  - Aaron's standards: 7 test tiers + strong docstrings; no temporary fixes; no assumptions stated as
    fact (verify against the files above); fail-closed on anything ambiguous; security first.
  - Verify the full suite is green before committing. Give a plain-language + technical summary and a
    clear recommendation when done (Rule #7).

When Phase 3 is complete and committed, recommend the sequencing of Phase 4 (bundled runtime manager,
⚡ Sonnet/auto) vs Phase 5 (companion shell — the SHARED BIND GATE that opens BOTH the Phase 2
inference socket AND this phase's loopback redirect listener, and performs the real network/keychain
I/O). Note that Phase 5's bind step is itself security-critical and may warrant its own 🧠 gate.
```

---

## 1. Where we are (state at start of Phase 3)

**Branch:** `feat/companion-app` (Muse-canonical, knowtation). Commits on it so far:
- Phase 0 Decision Record (gate §13, D1–D3).
- Phase 1 seam + 7-tier tests (`lib/model-runtime-lane.mjs`).
- **Phase 2 loopback security core** (`lib/companion-loopback-guard.mjs` + 7-tier suite, 102 cases
  green; `docs/COMPANION-APP-PHASE-2-LOOPBACK-SECURITY.md`). Pure request-guard; **no socket bound**;
  the real listener bind was deferred to Phase 5.

**Why Phase 3 now (gate §12, row 3 — 🧠 Thinking):**
> **OAuth native/public client** — PKCE + loopback redirect (RFC 7636/8252), no device-side secret,
> JWT in OS keychain (Keychain/DPAPI/libsecret) (§3). Depends on Phase 1.

Phase 3 is auth/crypto protocol correctness. It also closes the custody loop for Phase 2: the
per-session loopback bearer token (`expectedToken` in the guard) is generated and stored alongside
the OAuth JWT in the OS keychain.

## 2. The pure-then-bind discipline (carried from Phases 1–2)

Build the protocol/crypto **decisions** as pure, deterministic, fully-tested functions; defer every
real-world **bind/I/O** action to Phase 5 behind an explicit gate. This is the pattern that has kept
the most dangerous surfaces closed while proving the logic:

| Pure in Phase 3 (this phase) | Deferred to Phase 5 (bind gate) |
| --- | --- |
| PKCE pair + S256 challenge, state/nonce gen (CSPRNG) | Opening the **system browser** to the authorize URL |
| RFC 8252 loopback redirect validation | **Binding** the loopback redirect HTTP listener (127.0.0.1, ephemeral port) |
| Authorization-response validation (state, code) | Receiving the real callback request on that listener |
| Token-**request** builder + token-**response** validator | The actual **TLS POST** to the token endpoint |
| JWT expiry/refresh **decision**; custody contract | Real **OS keychain** read/write (Keychain/DPAPI/libsecret) |

## 3. Mandatory controls / standards to argue against the attacker

1. **PKCE S256 only** (RFC 7636). `code_challenge = base64url(SHA-256(code_verifier))`; verifier is a
   high-entropy 43–128-char string. **Reject `plain`** — no downgrade.
2. **No client secret on the device** — public/native client. The distributed binary contains no
   secret; security comes from PKCE + loopback redirect, not a shared secret.
3. **System browser, not an embedded webview** (RFC 8252 §8.12) — embedded webviews enable
   credential phishing and defeat SSO.
4. **Loopback redirect, exact validation** (RFC 8252 §7.3) — `http://127.0.0.1:<ephemeral-port>/...`
   (prefer the IP literal over `localhost`); allow the variable loopback port; reject any non-loopback
   or wildcard redirect.
5. **`state` (CSRF) + one-time use** — high-entropy, compared constant-time, single-use; reject
   replay. Optionally **`nonce`** if an ID token is involved, and **`iss`** (RFC 9207) for AS mix-up.
6. **JWT + refresh token in the OS keychain** — never a plaintext file; never logged; never in a URL
   or an error. Consistent with `hub/lib/refresh-token-core.mjs` semantics (reuse/expiry handling).
7. **Same scopes as the web session; no client/scope change** (gate "DOES NOT approve").
8. **No secret in any output/log/error** — code, code_verifier, state, access/refresh token, JWT.
9. **Fail-closed** on anything ambiguous, missing, malformed, or unrecognised.

## 4. Threat model to reason against (argue each — do not pattern-match)

- **Authorization-code interception** by another local app racing the loopback redirect → PKCE S256
  binds the code to the `code_verifier` the attacker never saw; a stolen code is useless.
- **CSRF / session fixation** on the callback → `state` constant-time match + single-use.
- **AS / redirect mix-up** → exact loopback redirect validation; consider RFC 9207 `iss`.
- **PKCE downgrade** (server or MITM forces `plain`) → client enforces S256 and refuses `plain`.
- **Open redirect / redirect_uri manipulation** → strict loopback-literal allowlist, no wildcard.
- **Token theft at rest** → OS keychain custody; never plaintext; never logged.
- **Client-secret extraction from the binary** → there is none (public client).
- **Authorization-response replay** → one-time state; single-use code.
- **Embedded-webview phishing** → system browser only.

## 5. Proposed deliverables (confirm scope first — see §0 scope questions)

- `lib/companion-oauth-pkce.mjs` — pure PKCE/redirect/state/token-shape functions; constant-time
  compares; fail-closed; no I/O. **No listener bound, no fetch, no keychain call in Phase 3.**
- *(optional)* `lib/companion-token-custody.mjs` — pure custody/refresh decisions over an **injected**
  keychain adapter interface (no real keychain); covers the JWT, the refresh token, and the Phase 2
  per-session loopback token.
- `test/companion-oauth-pkce-*.test.mjs` (+ custody tests) — 7 tiers; security tier is the centerpiece.
- `docs/COMPANION-APP-PHASE-3-OAUTH-PKCE.md` — accepted design + module contract + threat→control map
  + RFC citations + the safe-bind checklist Phase 5 must satisfy.

## 6. Definition of done

- Both scope questions resolved with the owner **before** any listener/network/keychain code.
- Protocol core enforces: S256-only PKCE, exact loopback redirect validation, constant-time state
  compare, token-request carries `code_verifier` + no secret, token-response validated fail-closed,
  JWT/refresh expiry decision.
- 7-tier suite green; security tier covers every threat in §4.
- No secret (code/verifier/state/JWT/refresh) in any return value, log, or error.
- No new listener bound; no OAuth client/scope change.
- Committed on `feat/companion-app` via Muse; no docs-only PR to `main`.
- Plain + technical summary with a recommendation (Rule #7), and a Phase 4-vs-Phase 5 sequencing call.

## 7. Open questions to settle at session start

1. **Pure-then-bind scope:** protocol core now, listener/fetch/keychain deferred to Phase 5
   (recommended) — or approve real I/O in Phase 3?
2. **Client registration:** does `hub/gateway/mcp-oauth-provider.mjs` already support a native/public
   client + loopback redirect at the web-session scopes, or is that a server-side OAuth change that
   needs its own gate first? (Phase 3 must not change client registration or scopes.)
3. **Redirect literal:** `127.0.0.1` (RFC-preferred) vs `localhost`; how the ephemeral port is chosen
   and reflected into `redirect_uri` and `validateRedirectUri`.
4. **State custody:** in-process random + constant-time compare (recommended for a native client that
   holds state between authorize and callback) vs the bridge's `signState`/`verifyState` HMAC pattern.
5. **Token custody + rotation:** keychain layout for JWT + refresh token + the Phase 2 per-session
   loopback token; refresh strategy consistent with `hub/lib/refresh-token-core.mjs`; what triggers
   re-auth vs silent refresh (`decideTokenRefresh`).
6. **ID token / nonce / iss:** is an OIDC ID token in play (→ add `nonce`), and do we adopt RFC 9207
   `iss` for mix-up defense?
```
