# Companion App — Phase 5: Bind Gate (sockets · spawn · keychain · download)

**Status:** 🧠 Thinking design gate — **RATIFICATION REQUESTED.** This document makes design
decisions only. **No companion shell code is written or approved to run by this document.** It fixes
the contract under which the Phase 5 implementation may, for the first time, open a real socket,
spawn a real process, read the real OS keychain, and perform a real TLS download.
**Branch:** `feat/companion-app` (Muse-canonical; paired with the Phase 1–4 code already on this
branch — **not** a docs-only PR to `main`, per the owner's no-docs-only-PR-to-`main` policy).
**Phase table ref:** Gate §12, Phase 5 ("companion app shell, integrating phases 2–4"). The phase
table marks the *implementation* ⚡ Sonnet/auto; this **bind-gate design** is elevated to 🧠 Thinking
because it is the first phase that performs ambient-authority-bearing I/O, and a wrong seam here is an
ambient-authority vulnerability, a supply-chain compromise, or an OS-permission overreach. Mirrors
the 🔀 Hybrid pattern: design the seam with a thinking model, implement against the fixed contract
with Sonnet/auto.
**Depends on (all accepted):**
[`COMPANION-APP-DESIGN-AND-AUTHORIZATION-GATE.md`](COMPANION-APP-DESIGN-AND-AUTHORIZATION-GATE.md)
(§4 the eight loopback controls, §4.6 no ambient authority, §7 packaging, §12 phase table, the
"DOES NOT approve" list); Phase 0 (gate §13, D1–D3); Phase 1
([`COMPANION-APP-PHASE-1-ADAPTER-SEAM.md`](COMPANION-APP-PHASE-1-ADAPTER-SEAM.md),
`lib/model-runtime-lane.mjs`); Phase 2
([`COMPANION-APP-PHASE-2-LOOPBACK-SECURITY.md`](COMPANION-APP-PHASE-2-LOOPBACK-SECURITY.md),
`lib/companion-loopback-guard.mjs`); Phase 3
([`COMPANION-APP-PHASE-3-OAUTH-PKCE.md`](COMPANION-APP-PHASE-3-OAUTH-PKCE.md),
`lib/companion-oauth-pkce.mjs`, `lib/companion-token-custody.mjs`); Phase 4
([`COMPANION-APP-PHASE-4-RUNTIME-MANAGER.md`](COMPANION-APP-PHASE-4-RUNTIME-MANAGER.md),
`lib/companion-runtime-manager.mjs`); the **server-side OAuth gate** ✅ DONE
([`COMPANION-APP-OAUTH-SERVERSIDE-GATE.md`](COMPANION-APP-OAUTH-SERVERSIDE-GATE.md),
`hub/gateway/native-oauth-provider.mjs`).

---

## Simple summary

Until now, every piece of the companion app has been built as **pure rules with no hands** — it can
*decide* whether a request is safe, whether a sign-in is valid, whether a downloaded model is
genuine, and whether the runtime may serve a request, but it cannot actually open a door, start a
program, read your password vault, or download a file. This phase is where the rules **grow hands**.

That is the single most dangerous step in the whole project, so this document does not write any of
that code. It writes the **rulebook the hands must obey** — and argues every rule against a specific
attacker:

- **The two doors** (one for local AI requests, one for the brief sign-in reply) open on a *random*
  internal number, on your machine only, never to the outside network.
- **The password vault** (OS keychain) is touched through the narrowest possible opening: store one
  secret, read one secret, delete one secret — nothing that can list or dump everything.
- **Starting the AI program** is done in a locked-down way: exact program, no shell, a stripped-down
  environment so the AI program can never see your sign-in token or vault, and it dies when the
  companion dies.
- **Downloading a model** checks the file's fingerprint against a trusted record *before* the program
  is ever run on it, and the trusted record comes from somewhere the download server can't forge.
- **Checking how much memory/GPU is in use** is scoped to the AI program only, and must never spy on
  what your other apps are doing.
- The "**AI is ready on this device**" switch only flips on after the file is verified, the program
  is genuinely up, and a real round-trip check succeeds — and flips off the instant anything is wrong.
- Finally: the parts with hands (start a program, download a file) are physically built so they can
  **never** hold your sign-in token, your vault handle, or the keychain — they only get a file path,
  a port, and a URL.

## Technical summary

Phases 1–4 and the server-side OAuth gate delivered every **decision core** and the one server-side
route (`/api/v1/auth/native`) the companion needs. Each pure module deferred its real I/O to "Phase 5
behind an explicit gate." This document **is** that gate. It ratifies eight decisions (D5.1–D5.8)
covering the four I/O-bearing seams that converge in the companion shell: **socket bind** (the Phase 2
inference listener and the Phase 3 OAuth loopback redirect listener), the **OS-keychain adapter**
(custody of the JWT, refresh token, and Phase 2 loopback token), the **spawn adapter** (the bundled
Ollama/llama.cpp runtime), the **download adapter** (TLS model fetch wired into Phase 4's
`createIntegrityAccumulator`), and the **resource-probe adapter** — plus the **Phase 1 seam
activation** rule (`companionAvailable`) and the **no-ambient-authority enforcement mechanism**.

Every decision defaults **fail-closed**: any ambiguity at bind, custody, spawn, download, or probe
denies rather than proceeds. No secret (loopback token, JWT, refresh token, authorization code,
`code_verifier`, `SESSION_SECRET`, model digest) appears in any log, error, adapter interface, or
redirect. The implementation that follows this gate runs **from source on a first-party machine** and
must ship its own 7-tier suite for the bind/lifecycle layer before any merge to `main`; **packaging,
code-signing, notarization, and auto-update remain Phase 7** and are *not* approved here.

---

## 0. What this gate lifts — and what it deliberately does not

The design gate's ["DOES NOT approve (no code)"](COMPANION-APP-DESIGN-AND-AUTHORIZATION-GATE.md)
list named, among others, *"opening any new local HTTP listener / loopback model endpoint"* and
*"shipping any companion binary … or bundled runtime."* Phase 5 is the gate that lifts a **bounded
subset** of that list — and only that subset.

| Item from the design gate's "DOES NOT approve" list | Phase 5 disposition |
| --- | --- |
| Opening a new local HTTP listener / loopback model endpoint | **LIFTED** for the **two loopback listeners** specified in D5.1/D5.2 (inference + OAuth redirect), bound `127.0.0.1`/`[::1]` only, under the Phase 2 guard. |
| Running an integrated companion process that binds sockets, spawns the runtime, reads the keychain, downloads a model | **LIFTED** for **first-party run-from-source** on the owner's/developer's machine, under D5.1–D5.8. |
| Shipping a companion **binary**, tray installer, **auto-updater**, code-signing/notarization | **NOT lifted** — remains **Phase 7** (distribution gate). Phase 5 runs from source; it does not produce or distribute a signed artifact. |
| New canister routes / new Hub REST endpoints / wire-protocol changes | **NOT needed** — the one required server route (`/api/v1/auth/native`) was delivered by the server-side OAuth gate (✅ DONE). Phase 5 adds none. |
| New derived-artifact storage paths / encryption scheme | **NOT lifted** — remains **Phase 6**. Phase 5 performs **inference**; enrichment write-back storage is Phase 6. |
| Any change to OAuth client registration or scopes | **NOT lifted / already bounded** — the server-side OAuth gate fixed the native client + scope ceiling (`scopesForRole`). Phase 5 only *consumes* it as a client; it changes nothing server-side. |

**Net:** Phase 5 means "the rules may now have hands, on a first-party machine, under the contract
below." It does **not** mean "ship a product." Distribution is a separate, later gate.

---

## 1. Adversarial threat model (the bind surface)

Phases 2 and 3 modelled the *request* and the *protocol*. Phase 5 adds the **physical I/O**, so the
threat model expands to the host itself. Each attacker is paired with the **exact Phase 5 control**
that stops it, argued against the attacker — not pattern-matched.

| # | Attacker capability | Exact Phase 5 control | Decision |
| --- | --- | --- | --- |
| **P-a** | **Malicious web page** issues `fetch()` to the companion's loopback listener (and to the runtime's internal port). | Phase 2 guard on the front-door (token + `Host` + `Origin`/`Sec-Fetch-Site` + no permissive CORS); the runtime's internal port emits **no CORS** and carries **no authority** (a no-cors POST can spend compute but can never read a response cross-origin or reach data). | D5.1, D5.4 |
| **P-b** | **DNS-rebinding** to reach the loopback bind. | Loopback-only bind (`127.0.0.1`/`[::1]`, never `0.0.0.0`/`::`) + Phase 2 `Host` allowlist. Ephemeral port is *not* relied on as a control. | D5.1 |
| **P-c** | **Local same-user malware** connects directly to the listener or the runtime's internal port, bypassing the front-door. | Per-session bearer token on the front-door (Phase 2); the runtime back-end is reachable only via a **Unix-domain socket (mode `0600`)** where supported, else a loopback TCP port that carries **inference only, no authority and no secret** — so direct access spends local compute but exfiltrates nothing. Rate-limited. | D5.1, D5.4, D5.8 |
| **P-d** | **Local process races to bind** the OAuth redirect port / inference port, or steals it after the companion exits. | OS-assigned ephemeral port chosen per use; redirect listener is **one-shot** (bound only for one auth attempt, closed after one callback); no `SO_REUSEPORT`; stale-runtime reclaim on start; loopback token rotated each start so a stale listener is **inert** against the new session. | D5.1, D5.2, D5.4 |
| **P-e** | **Keychain read** by another same-user process (or a backup/cloud-sync exfil). | Narrowest adapter surface (`get`/`set`/`delete` on four fixed accounts — no enumerate/dump); macOS `…ThisDeviceOnly` accessibility (**no iCloud sync**); ACL bound to the app where the OS supports it; the loopback token is **separate, per-session, rotated** so its compromise is not the JWT's compromise. Linux Secret Service's weaker same-user isolation is documented as a known platform limitation. | D5.3 |
| **P-f** | **Supply-chain**: poisoned model file from a compromised CDN/mirror or MITM (valid TLS, malicious bytes). | Phase 4 `createIntegrityAccumulator`: SHA-256 + exact size, **constant-time** digest compare, **before** spawn. The trust anchor (`expectedDigest`) comes from a **first-party signed manifest**, *not* the model host — so the entity that controls the download cannot also forge the digest. Atomic temp→verified move; spawn only from the verified path. | D5.5 |
| **P-g** | **Escaped/orphaned runtime** keeps running, holding a port or compute, after the companion crashes; or a **poisoned runtime** attempts RCE→data exfil. | Spawn in the companion's process group (dies with it); stale-runtime detect-and-kill on start; **scrubbed environment** (no `SESSION_SECRET`/JWT/keychain in the child env); no shell, argv array, absolute binary path; the runtime is handed **only** a file path + port + resource flags — **never** a vault/JWT/keychain handle. | D5.4, D5.8 |
| **P-h** | **Resource-probe privacy leak**: GPU telemetry exposes *other* apps' processes/VRAM. | Probe is scoped to the **runtime's own PID**; VRAM read as **aggregate headroom only**; other processes' PIDs/names/usage are **never enumerated, logged, or persisted**; no privilege escalation for telemetry (skip VRAM rather than escalate). | D5.6 |
| **P-i** | **Premature lane selection**: the local lane is chosen against a runtime that is downloading, starting, dead, or unverified. | `companionAvailable` flips true **only** after integrity verified **and** lifecycle `ready` **and** a real health round-trip succeeded, backed by a recency bound; flips false immediately on drain/stop/health-fail/crash. Fail-closed default false. | D5.7 |
| **P-j** | **Ambient-authority pivot**: the spawn/download/probe path acquires a vault handle, the JWT, or keychain capability and exfiltrates. | Object-capability segregation: the **authority group** (keychain + OAuth/session + canister) and the **runtime group** (spawn/download/health/stat) are constructed in disjoint scopes with no shared reference; enforced by an architecture/import test + a child-env-scrub test. | D5.8 |
| **P-k** | **Secret in logs/errors** at any I/O boundary (the new, dangerous surface). | All adapters log fixed reason codes only; never the token, JWT, refresh token, code, `code_verifier`, digest, URL, or model path. Reuses Phases 2–4's "no secret in output" posture at the I/O layer. | all |

---

## 2. Decision D5.1 — Inference loopback socket bind contract

> Question: what port-selection strategy for the loopback inference listener, and what is the threat
> model for port fixation?

### Verified state

Phase 2 §6 already specifies the bind obligations the guard cannot enforce by itself: `listen(0,
'127.0.0.1')`, never `0.0.0.0`; non-predictable ephemeral port; build `allowedHosts` from the actual
bound port; never emit permissive CORS. Phase 4 §5.2 repeats the loopback-bind + ephemeral-port
requirement for the runtime. The Phase 2 guard (`verifyLoopbackRequest`) is the admission control;
the bind is the deferred I/O.

### Decision — **OS-assigned ephemeral port, loopback-only, port secrecy is NOT a control**

1. **Bind `listen(0, '127.0.0.1')`** — the OS assigns an ephemeral port. If IPv6 loopback is offered,
   bind `[::1]` **explicitly**; **never** bind `0.0.0.0`, `::`, or any routable interface. A bind that
   can only be satisfied on a non-loopback interface is a **hard startup abort** — never a fallback to
   a broader interface.
2. **Port fixation threat model (confirmed):** an ephemeral port raises the cost of *blind* probing,
   but a local process can scan the ~16k-wide ephemeral range in milliseconds, and a web page can fire
   no-cors requests across it. Therefore the ephemeral port is **defense-in-depth only**; the real
   controls are the Phase 2 bearer token + `Host` allowlist + `Origin`/`Sec-Fetch-Site` check + rate
   limit. **The design must never treat the port as a secret or as an access control.** (This is why a
   *fixed* well-known port is rejected: it gives an attacker a free, stable target and a fingerprint,
   for zero security benefit.)
3. **Exclusive ownership:** do **not** set `SO_REUSEPORT` (it would let a second local process bind
   the same port and split/hijack traffic). The listener owns its port for the session.
4. **Port persistence:** the bound port may be recorded for the local session only, in a
   **user-private** location (file mode `0600` / per-user keychain-adjacent store), never world-readable
   and never logged at info level. It is **not** a secret, but minimizing its broadcast is free
   defense-in-depth.
5. **Two-listener separation (critical, see D5.4):** the *guarded front-door* the companion exposes is
   distinct from the *runtime's own internal listener*. Both are loopback; the front-door enforces the
   Phase 2 guard, the back-end carries no authority. Direct access to the back-end must never bypass an
   authority boundary (it bypasses only the rate limiter and serves inference — acceptable because the
   back-end holds no secret and no data path; see D5.4/D5.8).

### Fail-closed

Cannot bind loopback → abort startup (no listener, `companionAvailable` stays false). Port-store write
fails → continue (the port is not a secret) but never broaden the bind to compensate.

---

## 3. Decision D5.2 — OAuth redirect loopback listener bind

> Question: same ephemeral strategy for the PKCE loopback redirect? Confirm it can be a **different**
> port from the inference socket.

### Verified state

Phase 3 §6 requires the redirect listener bound `listen(0, '127.0.0.1')` (or `[::1]`), the
`redirect_uri` constructed from the actual bound port and re-validated by `validateRedirectUri`, and
the `state` discarded after one callback. The server-side gate (✅ DONE) confirmed the native provider
accepts any loopback ephemeral port at registration and exact-matches it within one flow (RFC 8252
§7.3 + RFC 6749 §4.1.3); `native-oauth-provider.mjs` `isLoopbackUri` enforces `127.0.0.1`/`[::1]`
literals only and rejects `localhost`.

### Decision — **Separate, short-lived, one-shot ephemeral redirect listener**

1. **Different listener, different port.** The OAuth redirect listener is a **distinct** server from
   the inference listener, bound independently via `listen(0, '127.0.0.1')` (or `[::1]`). They are
   different listeners with different lifecycles, so they get different ports — confirmed and required.
   Confusing them (or reusing the inference port for the redirect) is forbidden.
2. **One-shot lifecycle.** The redirect listener is bound **only** for the duration of a single
   authorization attempt and is **torn down immediately** after it receives exactly one callback (or on
   timeout/abort). This minimizes the window in which a local process (P-d) can race the port. PKCE
   already makes an intercepted code useless (Phase 3 threat **a**), but a one-shot listener also
   shrinks the race surface.
3. **Strict request handling.** Accept only `GET` on the exact registered callback path; hand the query
   params to `validateAuthorizationResponse({ params, expectedState, expectedIssuer })`. The native
   provider now emits `iss` (server-side gate C3), so Phase 5 **MUST pass `expectedIssuer`** and treat a
   mismatch as fatal (full mix-up defense, Phase 3 threat **c**). No bearer-token check here — this
   listener authenticates by `state` + `iss` + PKCE, not by the loopback token.
4. **Per-attempt secrets in memory only.** `code_verifier`, `state`, and `nonce` live in memory for the
   attempt; `state` is single-use and discarded after one callback. Never written to disk, never logged.
5. **System browser only.** The authorization URL (from `buildAuthorizationUrl`) is opened in the OS
   default browser; an embedded webview is forbidden (RFC 8252 §8.12, Phase 3 threat **i**).

### Fail-closed

Redirect listener cannot bind loopback → abort the auth attempt (no browser launch). Callback fails
`validateAuthorizationResponse` (bad `state`/`iss`/error) → abort, generic message, never log the raw
callback. Timeout with no callback → tear down the listener and surface a generic failure.

---

## 4. Decision D5.3 — OS-keychain adapter surface

> Question: the minimal keychain API the companion needs; per-OS backends; what does a keychain read
> grant?

### Verified state

Phase 3 custody (`companion-token-custody.mjs`) is written against an **injected**
`{ get, set, delete }` adapter over four fixed accounts (`KEYCHAIN_ACCOUNTS`: `accessToken`,
`refreshToken`, `sessionMeta`, `loopbackToken`), with `MAX_SECRET_LEN` bounds and fail-closed loads.
The adapter calls are awaited (sync or Promise both work). Phase 5 supplies the real backend.

### Decision — **Exactly `get`/`set`/`delete` on four named accounts; nothing wider; device-local**

1. **Minimal surface.** The real adapter implements **only** `get(account)`, `set(account, secret)`,
   `delete(account)`. **No `list`, no `enumerate`, no `getAll`, no wildcard/prefix query, no "dump."** A
   compromised or buggy adapter cannot discover what it does not already name. Unknown account names are
   **rejected fail-closed** (the adapter accepts only the four `KEYCHAIN_ACCOUNTS` literals); enforce
   `MAX_SECRET_LEN`; never log or return a secret in an error.
2. **Per-OS backends (least-privilege, device-local):**
   - **macOS — Keychain Services** generic-password items, accessibility
     **`kSecAttrAccessibleWhenUnlockedThisDeviceOnly`** (no iCloud Keychain sync — the JWT/refresh
     token must **not** leave the device), with the item ACL bound to the companion's signed code
     identity where available (tightened further by Phase 7 signing).
   - **Windows — DPAPI** (`CryptProtectData`) at **per-user** scope (never `LOCAL_MACHINE`), optionally
     surfaced through Credential Manager; entropy parameter set per item.
   - **Linux — libsecret** (Secret Service API) with schema-scoped attributes in the default
     collection. **Known limitation:** the Secret Service does not isolate by application — any
     unlocked-session same-user process can read the collection. This is a platform constraint, not a
     defect we can close in the adapter; it is the primary reason the loopback token is **separate,
     per-session, and rotated** (so its blast radius is one session) and a reason Linux users who want
     stronger isolation should run a locked keyring.
3. **Threat — what a keychain read grants (confirmed, sobering):** a successful read of these accounts
   yields the **access-token JWT** (act as the user against the hosted gateway with the `scopesForRole`
   ceiling — read **and** write), the **refresh token** (mint new JWTs until reuse-detection family-
   revoke trips), and the **loopback token** (drive the local inference front-door). That is
   **data-plane account compromise**, not merely local-inference access. Consequences and bounds:
   - The JWT is **no worse than a stolen web-session JWT**, and strictly better on refresh (the
     server-side gate backs native refresh with `refresh-token-core` rotation + reuse→family-revoke).
   - macOS `…ThisDeviceOnly` + ACL and Windows per-user DPAPI raise the bar to a same-user, same-device
     attacker; Linux is weaker (above).
   - The loopback token's separation means stealing it does **not** yield the JWT and vice-versa
     (Phase 3 custody §4: stored under its own account, rotated each start, independent of OAuth logout).
4. **No plaintext fallback, ever.** If the OS keychain is unavailable/locked, the adapter **fails
   closed** (the operation errors and the dependent flow aborts) — it **never** falls back to a dotfile,
   env var, or plaintext store. A locked keychain means "re-auth / retry," not "store insecurely."

### Fail-closed

Unknown account → reject. Keychain unavailable/locked → error (no plaintext fallback). Corrupt/oversize
stored value → custody `loadSession` already returns `null` → caller treats as `reauth`.

---

## 5. Decision D5.4 — Spawn adapter (process-management surface)

> Question: the minimal spawn/kill/health-probe surface; what happens if the spawned process escapes
> supervision?

### Verified state

Phase 4 `RuntimeAdapterFns` types the surface as `spawn(opts) → SpawnHandle`, `handle.kill()`,
`healthCheck(handle) → boolean`, `statResources()` (the last is D5.6). `SpawnOpts` carries
`{ binaryPath, modelPath, port, maxRamBytes }` — **no** vault/JWT/keychain field by construction.
Phase 4 §5.2 mandates spawn only after integrity passes, bind `127.0.0.1`, ephemeral port, and the
Phase 2 guard in front.

### Decision — **`spawn` + `kill` + `healthCheck` only; hardened launch; supervised lifetime**

1. **Minimal surface.** `spawn`, `kill`, `healthCheck` — nothing else (resources = D5.6, download =
   D5.5). The handle exposes `pid` + `kill()` only.
2. **Hardened launch (every item is a control, not a style choice):**
   - **Absolute `binaryPath`** to the bundled runtime — **never** a `PATH` lookup (prevents
     `PATH`-injection of a malicious `ollama`).
   - **`shell: false`** + **argv array** — never a concatenated command string (no shell-injection from
     any spec field).
   - **Scrubbed environment** — the child receives a **minimal allowlist** of env vars
     (`HOME`/`TMPDIR`/locale as needed); it is **explicitly stripped** of `SESSION_SECRET`, any
     `*_API_KEY`, the JWT, refresh token, loopback token, and anything keychain-related. Env is the
     classic ambient-authority leak; this closes it (see D5.8).
   - **Loopback bind flag** passed to the runtime so it binds `127.0.0.1`/UDS only, plus the resource
     ceiling flags derived from `maxRamBytes`.
   - **`detached: false`**, child placed in the companion's **process group** so it cannot outlive an
     orphaning parent.
3. **The runtime back-end is not a second authority-bearing endpoint (resolves P-a/P-c at the runtime
   port):** the companion exposes the **guarded front-door** (D5.1); the runtime listens **behind** it.
   Preference order for the back-end channel:
   - **Preferred:** a **Unix-domain socket with mode `0600`** (owner-only) where the runtime supports
     it — this makes the back-end reachable only by the companion's user and removes the loopback-TCP
     bypass entirely.
   - **Fallback (TCP-only runtimes):** bind the runtime to `127.0.0.1` on its own ephemeral port,
     emit **no CORS**, and accept the **documented residual**: any same-user local process (and a web
     page via no-cors, write-only) can spend local inference compute on it. This is acceptable **only
     because** the back-end holds **no secret and no data path** — it serves inference and nothing
     else (D5.8), so a direct hit wastes compute but exfiltrates nothing. The front-door remains the
     sole *authenticated* path; the rate limiter lives there.
4. **Escape / supervision threat model (confirmed):**
   - **Orphan holding the port/compute after a companion crash:** on every start, the companion
     **probes the persisted port for a stale runtime and kills it before rebinding** (detect-and-reclaim).
     Because the loopback token is **rotated each start** (Phase 3 custody), a stale runtime from a prior
     session is **inert** — the new front-door's `expectedToken` no longer matches, and a stale
     back-end serves no one useful. On clean shutdown, kill the **process group**.
   - **Poisoned runtime (model-driven RCE):** the **only** path to spawn is a **verified** model
     (D5.5 + Phase 4 single-path-to-`ready`); the child runs with the **scrubbed env** (no secrets, no
     keychain, no JWT — D5.8) and **loopback/UDS bind only**, so even arbitrary code in the runtime
     process cannot read the keychain handle (it was never in scope), cannot read the JWT (not in env),
     and cannot reach the canister as the user (no token). Stronger OS sandboxing (seatbelt/AppContainer/
     seccomp, entitlements) is **Phase 7**; D5.4 mandates the env-scrub + no-shell + argv + process-group
     + loopback-bind baseline now.
5. **Health probe** goes through the **same admission path** the runtime serves (the front-door, with
   the loopback token) so there is exactly **one** way to reach inference; the probe is `GET /v1/models`
   / `GET /api/tags`. A health success drives `transitionLifecycle(state,'health_ok')` (Phase 4).

### Fail-closed

Spawn fails / binary missing / integrity not yet verified → no spawn, lifecycle stays `stopped`,
`companionAvailable` false. Health probe fails the retry budget → `transitionLifecycle(state,
'health_fail')` → kill the child → `stopped`.

---

## 6. Decision D5.5 — Download adapter + Phase 4 integrity wiring

> Question: how does the real TLS download feed bytes into `createIntegrityAccumulator`; where does
> `finalize()` live; who decides the model spec (`allowedSourceUrls`, `expectedDigest`,
> `expectedSizeBytes`)?

### Verified state

Phase 4 `createIntegrityAccumulator({ expectedDigest, expectedSizeBytes, sourceUrl, allowedSourceUrls })`
exposes `update(chunk)` / `finalize()` / `getReceivedBytes()` / `abort()`; `validateSourceUrl`
enforces `https:`-only + allowlist; `validateIntegritySpec` enforces 64-char lowercase-hex digest +
positive integer size; `finalize()` uses constant-time digest compare + exact size. Phase 4 §3 fixes
the single path to `ready`: validate spec → accumulate → `finalize().ok` → `start` → spawn →
`health_ok`. `RuntimeAdapterFns.download(url, onChunk)` is the dumb byte pump.

### Decision — **Dumb download adapter; accumulator + `finalize()` owned by the orchestrator; trust anchor is a first-party manifest**

1. **Adapter is a dumb, verifying-transport byte pump.** `download(url, onChunk)`:
   - Performs an **HTTPS-only** GET with **full TLS verification** (`rejectUnauthorized` stays true;
     **no** insecure flag, ever). The `url` MUST have already passed `validateSourceUrl` against the
     spec's `allowedSourceUrls`.
   - **Streams**: calls `onChunk(chunk)` for **every** received byte, in order, no buffering of the
     whole file (multi-GB models must not be loaded into RAM).
   - **Makes no integrity decision.** It does not compute or compare the digest; it cannot "report
     success." This separation means a compromised download adapter cannot fake verification — the
     decision lives elsewhere.
2. **Where `finalize()` lives — the orchestrator, not the adapter.** The companion's **runtime-manager
   orchestration layer** (the code wiring Phase 4's pure core to the real adapters) owns the
   accumulator:
   - Before the download: `validateSourceUrl` + `validateIntegritySpec` (fail-closed), then
     `createIntegrityAccumulator({...spec})`.
   - During: `await adapter.download(spec.url, (chunk) => acc.update(chunk))`.
   - After the stream ends: `const verdict = acc.finalize()`.
   - **`verdict.ok === true` is the precondition** for `transitionLifecycle(state,'start')` and spawn.
     On `verdict.ok === false`: **delete the downloaded file**, log only the fixed reason code, and
     **refuse to spawn** (lifecycle stays `stopped`). This is exactly Phase 4 §3 / §5.1.
3. **Atomic, TOCTOU-aware file handling.** Download to a **temp path in a companion-private directory**
   (`0700`), `fsync`, verify via `finalize()`, then **atomically rename** into the verified model path.
   **Spawn only from the verified path.** To avoid a verify-then-swap (TOCTOU) where another same-user
   process replaces the file between verify and spawn, keep the verified file in the companion-private
   directory and prefer launching from a held descriptor / re-stat the inode identity at spawn; treat
   any mismatch as integrity failure.
4. **Who decides the spec — the trust anchor (most security-critical answer):** the model spec
   (`allowedSourceUrls`, `expectedDigest`, `expectedSizeBytes`) comes from a **first-party, signed
   model manifest** that is **independent of the model download channel**. Concretely, the
   `expectedDigest` must originate from a source the **download/CDN attacker does not control**:
   - **Preferred:** a manifest **fetched from the Knowtation hosted gateway over TLS** (a trusted
     first-party origin, distinct from the model CDN), and/or **baked into the signed companion**
     (Phase 7). The manifest fetch is performed by the **authority group** (it may carry the JWT); only
     the **plain resolved values** (`url`, `digest`, `size`) are then handed to the **runtime group** —
     the download adapter never sees the JWT (D5.8).
   - **Forbidden:** taking the digest/size from the **same host that serves the model bytes** (circular
     trust — an attacker who controls the CDN would control both bytes and "expected" digest), or from
     **user-supplied** input, or from an unauthenticated channel.
   - Manifest authenticity itself (signature scheme, key rotation) is the supply-chain detail; the
     binding decision here is: **the trust anchor is first-party and out-of-band from the model host,
     fail-closed if it cannot be authenticated.**

### Fail-closed

No authenticated manifest → no download. `validateSourceUrl`/`validateIntegritySpec` fail → no
download. Stream error mid-flight → `acc.abort()` → `finalize()` returns `accumulator_aborted` →
delete temp, no spawn. `finalize().ok === false` (size/digest mismatch) → delete, no spawn.

---

## 7. Decision D5.6 — Resource-probe adapter

> Question: what OS APIs; what privacy risk (does probing VRAM expose what other apps are doing); is
> it acceptable?

### Verified state

Phase 4 `evaluateResourceLimits(observation, limits)` consumes a `ResourceObservation`
`{ ramBytes, vramBytes, cpuPercent }` and fails closed on malformed input. `RuntimeAdapterFns.statResources()`
is the deferred probe. Phase 4 §4 suggests caching the observation ≤ 500 ms.

### Decision — **Probe the runtime's own PID; VRAM as aggregate headroom only; never enumerate other processes; no privilege escalation**

1. **OS APIs (scoped to the runtime PID):**
   - **RAM (RSS):** macOS `proc_pidinfo`/`task_info`; Linux `/proc/<pid>/statm` or `smaps_rollup`;
     Windows `GetProcessMemoryInfo`. **Keyed on the runtime child's PID only** — never system-wide RAM.
   - **CPU%:** per-process CPU time deltas for the runtime PID (same per-OS sources), sampled over an
     interval.
   - **VRAM:** the privacy-sensitive one. There is no portable per-process VRAM accounting without
     vendor tooling (`nvidia-smi`, Metal/`IOKit` counters, DXGI). `nvidia-smi --query-compute-apps`
     reports per-process VRAM **across all GPU processes**, which would expose **other applications'**
     PIDs/names/footprints.
2. **Privacy risk + decision (confirmed):** probing VRAM **can** expose what other apps are doing on
   the GPU. Therefore Phase 5 **MUST**:
   - Read VRAM as **aggregate device headroom** (total/free) **or** the runtime PID's own usage — and
     **discard everything else immediately**. Other processes' PIDs, names, and usage are **never
     parsed into the observation, never logged, never persisted**.
   - **Never enumerate** the GPU process table for any purpose beyond extracting the runtime's own line
     / the aggregate scalar.
   - **No privilege escalation for telemetry.** If per-process VRAM requires elevated rights, **skip
     it** (treat `vramBytes = 0` / `maxVramBytes = Infinity`) rather than escalate. Telemetry must
     never be a reason to ask for more OS privilege than inference needs.
3. **Acceptable? Yes**, under (1)+(2): scoped to the runtime PID, aggregate-only VRAM, no enumeration,
   no escalation, nothing about other apps retained. This keeps resource enforcement (the OOM defense,
   Phase 4 threat **b**) while honoring the design gate's privacy posture.
4. **Cache** the observation ≤ 500 ms (Phase 4 §4) to bound syscall overhead.

### Fail-closed

Probe fails / returns malformed → `evaluateResourceLimits` returns `malformed_observation` → the
per-request gate **denies** inference (refuse-rather-than-run-blind into OOM). A self-inflicted denial
is the safe outcome; the alternative (running blind) risks the user's whole machine.

---

## 8. Decision D5.7 — Phase 1 seam activation (`companionAvailable`)

> Question: when exactly does `companionAvailable` flip to true? (Must be **after** integrity verified
> **and** lifecycle `ready` **and** a health round-trip succeeds.)

### Verified state

Phase 1 `lib/model-runtime-lane.mjs`: `selectLane` returns `'local'` when `inBrowserAvailable ||
companionAvailable`; `companionAvailable` defaults **false** (fail-closed) and is documented as "set
by Phase 5 only when `canServeInference(lifecycle)` is true." Phase 4 §3 step 8 + §5.3 step 10 fix the
ordering: set true only after `health_ok`, false on drain/stop.

### Decision — **True only when ALL of {integrity-verified ∧ lifecycle `ready` ∧ recent health round-trip} hold; false on any doubt**

1. **Flip to `true` only when every condition holds simultaneously:**
   - **Integrity verified:** the model's `acc.finalize().ok === true` for the running model (D5.5).
   - **Lifecycle `ready`:** `canServeInference(lifecycle) === true`, reached **only** via
     `stopped → starting → ready` on a successful `health_ok` (Phase 4 — there is no direct
     `stopped → ready`).
   - **Real health round-trip:** at least one **end-to-end** probe **through the guarded front-door**
     (loopback token presented, admitted, runtime answered correctly) has succeeded — not merely "the
     process spawned."
   - Plus: the front-door listener is bound and the loopback token is stored (`rotateLoopbackToken`
     done), so an admitted caller can actually be served.
2. **Recency bound (anti-staleness, P-i):** `companionAvailable` must be backed by a **recent**
   successful health round-trip. Phase 5 re-probes on an interval; if the last success is older than the
   threshold (or a probe fails), treat the flag as **false** until re-confirmed. This stops `selectLane`
   from routing to a silently-dead runtime.
3. **Flip to `false` immediately on any of:** `drain`/`stop` (Phase 4 `transitionLifecycle`),
   `health_fail`, a resource-limit-triggered drain, detected runtime crash/exit, keychain/loopback-token
   loss, or companion shutdown. **Default and ambiguity → false.** Never set true optimistically.
4. **Scope of the flag.** `companionAvailable` means "**local inference is reachable and ready on this
   device**." It does **not** assert auth/consent — write-back of enrichment still passes Phase 1's
   `enforceConsentPolicy` and needs a valid session (D5.3 custody `decide() !== 'reauth'`). Keeping the
   flag scoped to inference-readiness avoids conflating lane *capability* with lane *permission*.
5. **Mechanism.** Phase 5's binding layer computes the flag strictly from
   `canServeInference(lifecycle)` ∧ recent-health-ok and writes it into the **live `LaneCapabilities`**
   passed to `selectLane`. The value is never cached beyond the recency bound.

### Fail-closed

Any missing condition, stale health, or ambiguity → `companionAvailable = false` → `selectLane` falls
through the chain (in-browser → self_hosted → … → `disabled`), exactly the D2.2 fallback.

---

## 9. Decision D5.8 — No-ambient-authority enforcement mechanism

> Question: what mechanism prevents the spawn/download adapter from **ever** holding a vault handle,
> JWT, or keychain read capability?

### Verified state

Phase 4 already guarantees the **decision core** imports no vault/canister/keychain/auth module and
that `RuntimeAdapterFns` carries no authority accessor (structural). Design gate §4.6 forbids ambient
authority on the loopback endpoint. The gap Phase 5 closes: the **real adapters and the wiring layer**
must preserve that separation when authority objects (keychain, JWT) finally exist in the same process.

### Decision — **Object-capability segregation, enforced by tests, not convention**

1. **Two disjoint capability groups, constructed in separate scopes:**
   - **Authority group** (holds secrets/handles): the **OS-keychain adapter** (D5.3), the **OAuth/
     session controller** (JWT + refresh via `companion-token-custody` / `companion-oauth-pkce`), and
     the **canister/vault client**. Instantiated and held **only** by the session/auth controller.
   - **Runtime group** (no secrets): the `RuntimeAdapterFns` implementations — `spawn`, `download`,
     `healthCheck`, `statResources`. Constructed with **no reference** to any authority-group object.
2. **The runtime group receives only inert data:** a verified **file path**, a **port**, a validated
   **URL**, and **resource limits**. It is **never** passed the keychain adapter, the JWT, the refresh
   token, or a canister handle. The model **manifest fetch** (which may need the JWT) is done by the
   **authority group**, which hands the runtime group only the resolved `{ url, digest, size }`
   (D5.5) — so the download adapter sees a URL, never a token.
3. **Environment scrub is part of the capability boundary** (D5.4): the spawned child's env is a
   minimal allowlist with `SESSION_SECRET`, `*_API_KEY`, JWT, refresh/loopback tokens, and keychain
   references **removed** — closing the env-as-ambient-authority leak that an import-graph check alone
   would miss.
4. **Enforced, not merely intended** — Phase 5's 7-tier suite MUST include:
   - an **architecture/import test** asserting the runtime-adapter module and `companion-runtime-manager`
     import **none** of `{ companion-token-custody, companion-oauth-pkce, keychain backend, canister/
     vault client }`;
   - a **child-env-scrub security test** asserting the spawned process environment contains **none** of
     the secret-bearing keys;
   - a **surface test** asserting `RuntimeAdapterFns` and `SpawnOpts`/`SpawnHandle` expose no authority
     accessor (Phase 4 already; re-assert against the real impl);
   - a **download-adapter test** asserting it receives only a URL + chunk sink, never a token.
5. **The Phase 2 guard remains the only admission path** and its verdict the only output — an admitted
   inference request reaches the runtime and nothing else; it cannot pivot to vault/JWT because those
   handles do not exist anywhere reachable from the runtime group (structural, now test-enforced).

### Fail-closed

If the wiring cannot construct the runtime group without an authority reference (e.g., a refactor
introduces a shared singleton), the architecture test **fails the build** — the merge is blocked, not
shipped with a warning.

---

## 10. How Phase 5 discharges the prior phases' deferred obligations

| Source obligation | Discharged by |
| --- | --- |
| Phase 2 §6 (1) loopback bind, (2) ephemeral port, (4) `allowedHosts` from bound port, (7) no permissive CORS | D5.1 |
| Phase 2 §6 (3) CSPRNG per-session token to keychain | D5.3 + Phase 3 `rotateLoopbackToken` |
| Phase 3 §6 (1) system browser, (2) loopback redirect bind + ephemeral port, (4) callback validation w/ `expectedIssuer`, (5) TLS token POST, (6) keychain custody, (7) refresh drive, (8) loopback-token rotate | D5.2 (browser, redirect bind, callback), D5.3 (keychain), and the orchestration calling Phase 3's pure descriptors |
| Phase 4 §5.1 download + integrity, §5.2 spawn, §5.3 health loop, §5.4 per-request gate, §5.6 minimal logging, §5.7 no ambient authority | D5.5 (download/integrity), D5.4 (spawn/health), D5.6 (resource probe), D5.8 (no ambient authority) |
| Phase 4 §3 step 8 / §8 G2 — Phase 1 seam activation | D5.7 |
| Server-side OAuth gate (✅ DONE) — native client at `/api/v1/auth/native`, `iss` emission, loopback variable-port, scope ceiling | Consumed by D5.2 (the companion is the native client; passes `expectedIssuer`, binds the loopback redirect) |

**Remaining external dependency:** none for first-party run-from-source. The server-side gate (G1) is
DONE; this document is G2 (Phase 4 §8). Phase 5 implementation may proceed against this contract.

---

## 11. 7-tier test obligations (Phase 5 bind/lifecycle layer)

Aaron's Rule #0. The pure cores' suites (Phases 2–4: 102 + 100 + 35 + 219 cases) do **not** absolve
the bind layer of its own tests. Before any merge to `main`, the Phase 5 shell ships all seven tiers:

| Tier | Focus |
| --- | --- |
| **Unit** | Bind helpers (loopback-only assertion, ephemeral-port allocation, `allowedHosts` from bound port); keychain adapter per backend (get/set/delete on the four accounts; unknown-account reject; no-list surface); spawn-opts hardening (absolute path, `shell:false`, argv, env-scrub); download adapter HTTPS-only + chunk pump; resource probe PID-scoping; `companionAvailable` predicate. |
| **Integration** | OAuth PKCE loopback round-trip against the native provider (browser-open stubbed) → keychain custody; download → `createIntegrityAccumulator` → `finalize()` → `start` → spawn → `health_ok` → `companionAvailable=true`; guard-in-front-of-runtime request path; refresh rotation → `updateAccessToken`; reuse → `clearSession`. |
| **End-to-end** | Sign in → fetch manifest (first-party) → download → verify → spawn → enrich a note locally via the guarded front-door → result handled per §5/D3 policy; failure branches: integrity fail (no spawn), health fail (`stopped`), keychain locked (`reauth`). |
| **Stress** | Concurrent inference through the front-door at `maxInFlight`/`queueBound`; many auth attempts (redirect-listener bind/teardown churn); stale-runtime reclaim across forced restarts; large streamed download to the accumulator. |
| **Data-integrity** | Provenance fields on derived artifacts (deferred write-back is Phase 6, but the inference result's metadata is asserted); `finalize()` rejects 1-bit corruption end-to-end; loopback token rotates each start (old token inert); no secret persisted outside the keychain. |
| **Performance** | Front-door admission overhead bound; runtime cold-start; resource-probe ≤ 500 ms cache honored; no event-loop starvation under streamed download. |
| **Security (centerpiece)** | Loopback-only bind (reject `0.0.0.0`/`::`/routable); ephemeral-port not used as a control; DNS-rebinding + cross-origin still 403 at the front-door; runtime back-end carries no authority and emits no CORS; keychain read surface minimal + device-local (no iCloud sync); **child-env contains no secret**; **architecture/import test: runtime group imports no authority module**; manifest trust-anchor is out-of-band from the model host; resource probe never enumerates other GPU processes; `companionAvailable` fail-closed; **no secret in any log/error/redirect/adapter interface**; global fail-closed posture. |

---

## 12. Constraints honored

- **Decisions only — no companion shell code.** This document writes none; it fixes the contract the
  implementation must obey.
- **Muse-canonical**, on `feat/companion-app`, paired with the Phase 1–4 code already there — **not** a
  docs-only PR to `main`.
- **Fail-closed on every ambiguous design point** (bind, custody, spawn, download, probe, seam).
- **Security first; no ambient authority; no secret in any log, error, or adapter interface.**
- **No assumptions stated as fact** — every cross-reference is anchored to a verified file/section in
  Phases 1–4 and the server-side OAuth gate.
- **Phase 5 lifts only the bounded I/O subset of the design gate's "DOES NOT approve" list (§0);**
  packaging/signing/notarization/auto-update remain Phase 7 and are not approved here.

---

## 13. Approval table

| Decision | Recommendation | Owner approval |
| --- | --- | --- |
| **D5.1** — inference loopback bind: OS-assigned ephemeral, loopback-only, port-secrecy not a control, no `SO_REUSEPORT`, two-listener separation | **ACCEPT** | ☐ pending |
| **D5.2** — OAuth redirect: separate, one-shot, ephemeral loopback listener; pass `expectedIssuer`; system browser only | **ACCEPT** | ☐ pending |
| **D5.3** — keychain adapter: `get`/`set`/`delete` on four fixed accounts only; device-local (macOS ThisDeviceOnly / Windows per-user DPAPI / Linux libsecret w/ documented limit); no plaintext fallback | **ACCEPT** | ☐ pending |
| **D5.4** — spawn adapter: `spawn`/`kill`/`healthCheck`; absolute path, `shell:false`, argv, env-scrub, process-group; runtime back-end via UDS `0600` (else loopback TCP, no authority); detect-and-reclaim stale runtime | **ACCEPT** | ☐ pending |
| **D5.5** — download adapter: dumb HTTPS-only byte pump; accumulator + `finalize()` owned by orchestrator; trust anchor = first-party signed manifest, out-of-band from the model host; atomic temp→verified, TOCTOU-aware | **ACCEPT** | ☐ pending |
| **D5.6** — resource probe: runtime-PID-scoped; VRAM aggregate-only, never enumerate other processes; no privilege escalation; fail-closed deny on probe failure | **ACCEPT** | ☐ pending |
| **D5.7** — `companionAvailable` true only when integrity-verified ∧ `ready` ∧ recent health round-trip; recency-bounded; false on any doubt | **ACCEPT** | ☐ pending |
| **D5.8** — no ambient authority: object-capability segregation (authority vs runtime groups), env-scrub, enforced by architecture/import + env-scrub tests (build-blocking) | **ACCEPT** | ☐ pending |

On owner approval of D5.1–D5.8, the **Phase 5 implementation** (companion shell, run-from-source) is
unblocked — itself gated on the §11 7-tier test obligation before any merge to `main`. **Phase 7**
(packaging, signing, notarization, auto-update integrity) remains a separate, later gate and is **not**
approved by this document.
