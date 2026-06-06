# Companion App — Phase 2: Loopback Endpoint Security Core

**Status:** accepted design + implementation (pure request-guard; **no socket bound**).
**Branch:** `feat/companion-app` (Muse-canonical; not a docs-only PR to `main`).
**Phase table ref:** Gate §12, Phase 2 — 🧠 Thinking. "DNS-rebinding and cross-origin abuse are
adversarial; the defense must be argued against an attacker model, not pattern-matched."
**Depends on:** Phase 0 Decision Record (gate §13, D1–D3 accepted) and Phase 1 adapter seam
([`COMPANION-APP-PHASE-1-ADAPTER-SEAM.md`](COMPANION-APP-PHASE-1-ADAPTER-SEAM.md)).
**Upstream:** [`COMPANION-APP-DESIGN-AND-AUTHORIZATION-GATE.md`](COMPANION-APP-DESIGN-AND-AUTHORIZATION-GATE.md)
§4 (the 8 loopback controls), §10 (7-tier test obligations);
[`COMPANION-APP-MODEL-ROUTING-AND-ENRICHMENT-ARCHITECTURE.md`](COMPANION-APP-MODEL-ROUTING-AND-ENRICHMENT-ARCHITECTURE.md)
§3 (client-side constraint), §8.1 (localhost security), §8.3 (prompt injection).

---

## Simple summary

The companion app runs a tiny AI server **on your own laptop** so your private notes can be
processed locally and never leave the device. The most dangerous moment in that whole feature is
when that little server **opens its door** to the network: every web page open in your browser can
knock on `http://127.0.0.1:<port>`, and a trick called **DNS-rebinding** can make a stranger's
website *look* like it's coming from your own machine.

This phase builds the **bouncer** that stands at the door and decides, for every single knock,
whether to let it in. The bouncer checks: *do you carry the right one-time pass (token)? are you
actually knocking on the loopback door and not a disguised one (Host)? are you a page from this same
local app and not some random website (Origin)? have there been too many knocks too fast
(rate-limit)?* If anything is missing or even slightly off, the answer is **no** — the bouncer
fails safe.

Crucially, we built and exhaustively tested the **bouncer by itself, before installing the actual
door.** The door (the real listening socket) is deliberately **not** opened in this phase — that is
the single most security-critical action and it stays behind a separate explicit approval (Phase 5).
The bouncer is a pure function: same inputs always give the same answer, it touches no files, no
network, no settings, so we can prove it is incorruptible.

## Technical summary

Phase 2 delivers **`lib/companion-loopback-guard.mjs`** — a pure, I/O-free request-decision core
(`verifyLoopbackRequest`) enforcing gate §4 controls **1, 2, 3, 5, 6, 8** at the request-decision
level, plus the rate-state helpers (`createLoopbackRateState`, `recordLoopbackRequest`,
`evaluateRateLimit`, `shouldCountTowardRateLimit`) and a constant-time comparator
(`constantTimeStringEqual`). It binds **no socket** and reads **no environment**, mirroring how
Phase 1 shipped pure decision logic.

This scope is deliberate and gate-compliant. The gate's
["DOES NOT approve (no code)"](COMPANION-APP-DESIGN-AND-AUTHORIZATION-GATE.md) list forbids
*"opening any new local HTTP listener / loopback model endpoint in any repo,"* and §13.2 restates
that this prohibition is **unchanged** by Phase 0 acceptance. Building the request-guard as a pure,
fully-tested function — and deferring the actual `server.listen()` bind to Phase 5 behind an
explicit gate — keeps the most security-critical surface closed while letting the adversarial
decision logic be proven now. §4's controls 4 (non-predictable port) and 5 (loopback bind) are
**binding-time** properties; this doc specifies exactly what Phase 5 must do to satisfy them
(see [§6](#6-what-phase-5-must-do-to-bind-the-socket-safely)).

The guard is **fail-closed everywhere**: any missing, malformed, ambiguous, or unrecognised input
denies. It never throws (a catch-all converts internal errors to a fixed-reason 403), never logs,
and never copies a token, JWT, or note body into a reason string, a return value, or an error —
satisfying gate §4.8 "never log token, JWT, or note bodies."

---

## 1. Adversarial threat model

The loopback endpoint is the GitHub-analogue of a service bound to `127.0.0.1`: reachable by
anything already running on the machine. We model four attacker capabilities and, for each, the
**exact control** that stops it. The defense is argued against the attacker, not pattern-matched.

### Attacker A — malicious web page in the user's browser (cross-origin)

**Capability.** The user visits `https://evil.example`. That page's JavaScript can issue `fetch()`
/ `XMLHttpRequest` to `http://127.0.0.1:<port>` (the browser will connect to loopback). The attacker
controls the request method, the URL path, and most request headers — but **cannot** set the
Forbidden headers `Origin` and `Sec-Fetch-*` (the browser sets these from the page's real context),
and **cannot** read a cross-origin response unless the server emits permissive CORS.

**Stops it:**
- **`Sec-Fetch-Site: cross-site`** is attached automatically by the browser → guard returns **403**
  (`cross_site_forbidden`). The attacker cannot forge or strip this header.
- **`Origin: https://evil.example`** is attached on the cross-origin request and is **not** the
  loopback origin → guard returns **403** even if `Sec-Fetch-Site` were somehow absent.
- **No wildcard CORS / no Origin reflection** (control §4.3) — Phase 5 must never emit
  `Access-Control-Allow-Origin: *` nor reflect an arbitrary `Origin`, so even a response the
  attacker provokes is unreadable cross-origin. The guard models this by accepting **only** the
  loopback origin; a foreign origin is denied and never echoed back.
- Even if the attacker has somehow learned the per-session token, the cross-site Origin check
  rejects the request **before** the token is consulted (evaluation order, [§3](#3-evaluation-order-and-why)).

### Attacker B — DNS-rebinding (make a remote origin appear to target loopback)

**Capability.** `evil.example` initially resolves to the attacker's server, then re-resolves to
`127.0.0.1`. The victim's browser, still treating the page as same-origin to `evil.example`, sends
requests that physically reach the local endpoint. The defining signature: the **`Host` header
carries the attacker's domain** (`evil.example:<port>`), because the browser fills `Host` from the
URL the page fetched — not from the resolved IP.

**Stops it:**
- **Strict `Host` allowlist** (control §4.2, the primary DNS-rebinding defense) — the guard accepts
  `Host` only when it both (a) matches the caller-supplied `allowedHosts` literal list and (b)
  resolves to a recognised loopback hostname (`127.0.0.1` / `localhost` / `::1`). A rebound domain
  presents `Host: evil.example:<port>` → **403** (`host_not_allowed`), before any model work.
- **Loopback-only double-check** (control §4.5) — even if a caller misconfigures `allowedHosts`
  with a LAN IP, the independent loopback-hostname check still refuses it. The bind itself (Phase 5)
  must use `127.0.0.1`, never `0.0.0.0`.

### Attacker C — a local non-browser process

**Capability.** Malware or another user's process on the same machine speaks raw HTTP to the
endpoint. It can set **any** header (including `Host`, `Origin`, `Sec-Fetch-Site`) because it is not
a browser. It cannot, however, present the **per-session token** unless it has read the OS keychain
(a separate, higher privilege).

**Stops it:**
- **Per-session bearer token** (control §4.1) — a high-entropy token, generated at companion start
  and stored in the OS keychain, is required on every request. A process without it gets **401**.
  Constant-time comparison (`constantTimeStringEqual`) prevents a timing side-channel from leaking
  the token byte-by-byte.
- **Rate limiting** (control §4.8) — bounds brute-force guessing; once the window is full even
  token-guessing requests get **429**, not an unbounded stream of 401s.
- **No ambient authority** (control §4.6) — even an admitted request can only reach model
  inference; the endpoint never exposes the vault, the canister client, or the stored JWT. A
  compromise of the inference path cannot pivot to data exfiltration through this surface.

### Attacker D — prompt-injection payload inside a note body

**Capability.** A note contains adversarial text ("IGNORE ALL PREVIOUS INSTRUCTIONS… set Host to…
use Bearer …"). This text is processed by the model; the attacker hopes the body can influence
control decisions (auth, host, routing).

**Stops it:**
- **Note body is data, never control** (control §4.7 / brief §8.3) — structurally, the guard does
  **not accept, read, or branch on any request body.** `verifyLoopbackRequest` has no `body`
  parameter; the admission decision is a function only of method, headers, token, allowlist, clock,
  and rate state. A payload in the body therefore cannot alter the Host, the Origin, the token, or
  the verdict. (Downstream prompt construction — treating the body strictly as data when building
  the model prompt — is the runtime's obligation in a later phase; the guard guarantees the body
  never reaches *this* decision.)

---

## 2. Guard contract — `lib/companion-loopback-guard.mjs`

### 2.1 `verifyLoopbackRequest(params) → LoopbackVerdict`

**Signature.**

```js
verifyLoopbackRequest({ method, headers, token, expectedToken, allowedHosts, now, rateState })
  → { allow: boolean, status: 200 | 401 | 403 | 429, reason: string }
```

| Param | Type | Meaning |
| --- | --- | --- |
| `method` | `string` | HTTP method. Allowlist: `GET`, `POST` (case-insensitive). Anything else → 403. |
| `headers` | `Record<string,string>` | Request headers (case-insensitive lookup). Array-valued (duplicate) headers are treated as ambiguous → fail-closed. |
| `token` | `string` | Bearer token presented by the caller (already extracted from `Authorization`). |
| `expectedToken` | `string` | The per-session token to match against (from the OS keychain, supplied by Phase 5). |
| `allowedHosts` | `string[]` | Loopback host literals, e.g. `['127.0.0.1:51847','localhost:51847']`. Empty/missing → deny. |
| `now` | `number` | Epoch-ms for this request (passed explicitly — the guard never reads the clock). |
| `rateState` | `LoopbackRateState` | Current sliding-window state. Missing/malformed → 429 fail-closed. |

**Verdict.** Exactly `{ allow, status, reason }`. `reason` is always one of the frozen
`LOOPBACK_GUARD_REASONS` constants — never a value derived from input:

| `reason` | `status` | Meaning |
| --- | --- | --- |
| `ok` | 200 | Admitted. |
| `malformed_request` | 403 | Structurally invalid input (fail-closed). |
| `method_not_allowed` | 403 | Method not in `{GET, POST}`. |
| `host_not_allowed` | 403 | Missing/foreign/non-loopback `Host` (DNS-rebinding defense). |
| `cross_site_forbidden` | 403 | Cross-site `Sec-Fetch-Site` or foreign `Origin`. |
| `rate_state_unavailable` | 429 | Rate state missing/malformed — cannot prove the rate is bounded. |
| `rate_limited` | 429 | Window full. |
| `missing_token` | 401 | No token presented. |
| `invalid_token` | 401 | Token mismatch, or no `expectedToken` configured. |

**Guarantees (all under test):**
- **Pure:** no I/O, no `process.env`, no network, no logging, no clock read. Deterministic.
- **Fail-closed:** anything missing/malformed/ambiguous denies. No fail-open branch exists.
- **Never throws:** a catch-all converts any internal error to `403 malformed_request`, so no
  exception can carry input data outward.
- **No ambient authority:** the verdict is the only output. No vault, canister, or JWT handle.
- **No secret in output:** the presented token, expected token, JWT, and any note body never appear
  in a reason, a return value, or an error.

### 2.2 Rate-limit helpers

- `createLoopbackRateState({ windowMs = 60_000, maxRequests = 60 })` → fresh `{ windowMs,
  maxRequests, timestamps: [] }`.
- `evaluateRateLimit(rateState, now)` → `{ ok: true }` or `{ ok: false, reason }`. Pure; counts
  in-window timestamps; ≥ `maxRequests` → `rate_limited`.
- `recordLoopbackRequest(rateState, now)` → **new** state with `now` appended and out-of-window
  timestamps pruned (pure; input not mutated). The array is bounded by `maxRequests`.
- `shouldCountTowardRateLimit(verdict)` → `true` **only** for verdicts that reached the token stage
  (`ok` / `missing_token` / `invalid_token`). See [§4](#4-the-rate-limit-recording-contract).

### 2.3 Why the Origin allowlist is the loopback origin only

The signature intentionally has **no `allowedOrigins`** parameter. The guard derives the permitted
browser origins from `allowedHosts` (i.e. `http(s)://<allowedHost>`), so the **only** browser origin
that may call the endpoint is its **own loopback origin** (same-origin). A remote origin — including
the hosted Knowtation web app (`https://knowtation.store`) — is cross-origin and is **rejected**.
This is the strictest reading of control §4.3 ("no reflecting arbitrary Origin") and it cleanly
resolves the DNS-rebinding + cross-origin story: the loopback endpoint trusts only same-origin
loopback browser context and non-browser local clients (which send no `Origin`/`Sec-Fetch-Site` and
still must present a valid token).

If a future product decision requires the hosted web tab to *drive* the local companion, that is a
**deliberate, documented allowlist extension** decided at the Phase 5 bind gate — not a silent
default of this guard. Per brief §3/§2, in-browser inference today runs **in the tab via WebGPU**
(reusing the web session), not through the loopback endpoint, so the same-origin-only default is
correct for Phase 2.

---

## 3. Evaluation order (and why)

The order of checks is itself a security decision:

```
1. Structural validity   → 403 malformed_request   (fail-closed on bad input)
2. Method allowlist      → 403 method_not_allowed
3. Host allowlist+loopback → 403 host_not_allowed   (DNS-rebinding; cheap, rejects most abuse)
4. Origin / Sec-Fetch-Site → 403 cross_site_forbidden
5. Rate limit            → 429 rate_limited / rate_state_unavailable
6. Token (constant-time) → 401 missing_token / invalid_token
7. Admit                 → 200 ok
```

- **Host/Origin before rate-limit.** A cross-origin or DNS-rebinding flood is rejected at steps 3–4
  and is **not** recorded against the rate window (see §4). If those checks came *after* rate-limit,
  an attacker could exhaust the shared budget with cheap 403'd probes and **deny the legitimate
  client** (a budget-exhaustion DoS). Rejecting them first, without consuming budget, prevents that.
- **Rate-limit before token.** Placing the rate check *before* the token check is what **bounds
  token brute-force**: once the window is full, even token-guessing requests receive **429** rather
  than an unbounded stream of `401`s. If token came first, the function would short-circuit at the
  token check and never reach the 429 gate, leaving guessing unbounded.

---

## 4. The rate-limit recording contract

`verifyLoopbackRequest` is pure and does **not** mutate `rateState`. The caller (Phase 5 listener)
advances the window:

```js
const verdict = verifyLoopbackRequest({ ...req, expectedToken, allowedHosts, now, rateState });
if (shouldCountTowardRateLimit(verdict)) {
  rateState = recordLoopbackRequest(rateState, now);
}
```

`shouldCountTowardRateLimit` returns `true` **only** for verdicts that reached the token stage
(`ok`, `missing_token`, `invalid_token`). This is the precise contract that makes two properties
hold simultaneously:

- **Brute-force is bounded** — failed-auth (`401`) requests consume a slot, so a guessing flood
  fills the window and trips `429`.
- **No budget-exhaustion DoS, and the array stays bounded** — pre-rate rejections
  (`malformed`/`method`/`host`/`cross_site`) and rate rejections (`rate_limited`/
  `rate_state_unavailable`) are **not** recorded, so cross-origin/rebinding floods cannot drain the
  budget, and the `timestamps` array can never grow past `maxRequests`.

---

## 5. Mapping: gate §4 controls → Phase 2 enforcement

| Gate §4 control | Where enforced | Status |
| --- | --- | --- |
| **1. Bearer token on every request** | `verifyLoopbackRequest` token stage; `constantTimeStringEqual` | ✅ request-decision |
| **2. Strict `Host` allowlist (DNS-rebinding)** | `allowedHosts` match + `isLoopbackHost` | ✅ request-decision |
| **3. Strict `Origin`/`Sec-Fetch-Site`, no wildcard CORS** | Sec-Fetch-Site allowlist + loopback-origin-only check | ✅ request-decision |
| **4. Non-predictable ephemeral port** | — | ⏭ **Phase 5 (bind-time)** — see §6 |
| **5. Loopback bind only (`127.0.0.1`)** | `isLoopbackHost` double-check at decision level | ✅ partial (decision); bind ⏭ Phase 5 |
| **6. No ambient authority** | Narrow verdict shape; no vault/canister/JWT reachable | ✅ structural |
| **7. Untrusted input (note body as data)** | Guard never reads a body — structurally outside the decision | ✅ structural |
| **8. Rate limiting + minimal logging** | Sliding-window rate gate; guard never logs; no secret in output | ✅ request-decision |

> Gate §4: *"A future implementation that omits any of items 1–3, 5, or 6 fails this gate."* Items
> 1, 2, 3, 6 are fully enforced at the request-decision level; item 5's loopback **assertion** is
> enforced at the decision level and its **bind** is specified for Phase 5 below. No required item
> is omitted.

---

## 6. What Phase 5 must do to bind the socket safely

The pure guard is the bouncer; Phase 5 (companion shell) installs the door. Binding the listener is
the single most security-critical action and **requires an explicit gate**. When Phase 5 binds, it
MUST:

1. **Bind loopback only.** `server.listen(port, '127.0.0.1')` — never `0.0.0.0`, never a public
   interface (control §4.5). Do not bind `::` ; if IPv6 loopback is offered, bind `::1` explicitly.
2. **Allocate a non-predictable ephemeral port.** Let the OS assign an ephemeral port (`listen(0,
   '127.0.0.1')`) and treat the chosen port as a secret-ish capability; do not use a fixed
   well-known port (control §4.4). Persist it only for the local session.
3. **Generate the per-session token with a CSPRNG.** `crypto.randomBytes(32)` (≥ 256-bit),
   base64url-encoded, stored in the **OS keychain** (Keychain / DPAPI / libsecret), regenerated each
   companion start. Pass it to the guard as `expectedToken`. Never log it; never place it in a URL.
4. **Build `allowedHosts` from the actual bound port** — `['127.0.0.1:<port>', 'localhost:<port>']`
   — and pass it to every `verifyLoopbackRequest` call.
5. **Extract the presented token** from `Authorization: Bearer <token>` and pass it as `token`.
   Pass `Date.now()` as `now` and maintain `rateState` per the §4 recording contract.
6. **Call the guard before any model work.** On `allow === false`, return `verdict.status` with a
   generic body and **no** secret; do not proceed to the runtime. On `allow === true`, proceed.
7. **Emit no permissive CORS.** Never `Access-Control-Allow-Origin: *`; if any CORS header is
   emitted at all, set `Access-Control-Allow-Origin` to the **validated loopback origin only** and
   never reflect an arbitrary `Origin`. (Contrast `hub/bridge/server.mjs`, which defaults to
   `Access-Control-Allow-Origin: *` — that pattern MUST NOT be copied to the loopback endpoint.)
8. **Minimal logging.** Log admission decisions by `reason` code only; never log the token, JWT,
   `Authorization` header, `Origin`, or any note body (control §4.8).
9. **Ship its own 7-tier suite** for the bind/lifecycle layer (socket bind assertion, ephemeral-port
   randomness, keychain read/write, concurrent-connection handling) per gate §10 — the pure guard's
   suite does not absolve the listener of its own tests.

Until that explicit Phase 5 gate is approved, **no socket is bound** and the gate's no-listener
prohibition remains in force.

---

## 7. Test obligations satisfied (gate §10, 7 tiers)

All under `test/companion-loopback-guard-*.test.mjs` (102 cases, all green):

| Tier | File | Focus |
| --- | --- | --- |
| Unit | `…-unit.test.mjs` | Each control in isolation; helpers (`parseHostHeader`, `constantTimeStringEqual`, rate helpers). |
| Integration | `…-integration.test.mjs` | Evaluation order under combined faults; rate-state lifecycle; brute-force bounding; budget-DoS prevention. |
| End-to-end | `…-e2e.test.mjs` | Realistic callers: companion UI, local CLI, cross-origin page, DNS-rebinding, stolen-token-still-blocked, full interleaved session. |
| Stress | `…-stress.test.mjs` | 100k wrong-token attempts (zero accidental allows); bounded window under 50k load; 10k-entry allowlist; pathological header bags. |
| Data-integrity | `…-data-integrity.test.mjs` | Determinism (10k identical calls); no input mutation; verdict shape; reason domain; env-independence. |
| Performance | `…-performance.test.mjs` | Sub-ms mean per-decision; 100k decisions < 2s; no super-linear blowup with window size. |
| **Security** | `…-security.test.mjs` | **Centerpiece:** missing/wrong token (constant-time, no length oracle); DNS-rebinding 403; cross-site 403; no wildcard CORS / no Origin reflection; rate-limit 429; no ambient authority; note-body-as-data; no secret in any output/reason/error; global fail-closed posture. |

---

## 8. Deferred (explicitly not Phase 2)

- The real listening socket, ephemeral-port allocation, and loopback bind — **Phase 5** behind an
  explicit gate (§6).
- OS-keychain read/write of the per-session token — Phase 3 (OAuth/keychain) / Phase 5.
- Downstream prompt construction that treats the note body strictly as data when building the model
  prompt — runtime phase (the guard guarantees the body never reaches the admission decision).
- Any change to OAuth client registration or scopes (gate "DOES NOT approve" list — unchanged).
