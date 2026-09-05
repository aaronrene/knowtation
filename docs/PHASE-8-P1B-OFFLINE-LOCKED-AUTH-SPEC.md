# Phase 8 P1b-a — Offline-Locked Auth Spec (Frozen Thinking Outline)

Status: **P1b-a frozen · P1b-b implemented (inert; gates hard-false). Bundled Tier 3 merge to `main`.**

This document freezes WHAT and HOW for the offline-locked auth feature in Knowtation so the
Auto build (P1b-b) implements mechanically against a fixed spec, per RULE #8 (Orchestrator) and
SD-3 (`Thinking → Auto` split). It is the contract layer; the running credential store, live login
route, and live CLI bootstrap are **build-later** (P1b-b and beyond).

Authored on branch **`feat/phase-8-p1b-offline-locked-auth-spec`** (Knowtation).

---

## §0 — Scope reminder (P1b-a Thinking only)

This Thinking step freezes the **contract** for offline-locked auth. It does **not** ship code.

**In scope (P1b-a):**
1. Precondition + gap recap (§1) — why P1b is OPEN, what closes it.
2. Deployment mode + env gate (§2).
3. Local credential store contract (§3) — Argon2id, no OAuth when gate on.
4. First-admin bootstrap on air-gapped install (§4).
5. JWT `sub` format + role-store parity (§5).
6. Gateway + bridge route parity + fail-closed OAuth blocking (§6).
7. Rate limiting, lockout, audit events — no secrets in logs (§7).
8. CLI / MCP token issuance path for offline-locked mode (§8).
9. Seven-tier test matrix (§9).
10. Scooling impact note (§10).
11. Posture constants, all hard-`false` (§11).

**Not in scope (build-later, P1b-b):** any production code, any live credential store file, any
live login route, any live CLI bootstrap command, any env flip (Tier 3). This doc adds **no
production code**.

**Design-now vs build-later boundary:** P1b-a freezes contract/seam shapes and parameters. P1b-b
implements those seams as **live code + seven-tier tests**, then a separate Tier 3 session flips
the env gate.

---

## §1 — Precondition + gap recap (why P1b is OPEN)

From `scooling/docs/PHASE-8A-LOCAL-OFFLINE-INFRASTRUCTURE-OUTLINE.md` §1:

| # | Precondition | State | Owner | Gap |
| --- | --- | --- | --- | --- |
| P1b | True offline-**locked** auth (no internet for login at all) | **OPEN → this spec closes it (design only)** | Knowtation | Self-hosted login still uses Google/GitHub OAuth (own client id/secret) → needs provider reachability. No documented air-gapped local-credential login. |

**What "offline-locked" means (frozen definition):**

- The Hub process can start, serve, and authenticate users with **zero outbound network calls
  during the login flow**. No OAuth provider (Google, GitHub) is contacted.
- The credential verifier is **local-only**: the Argon2id hash lives on disk under `DATA_DIR`,
  verification happens in-process, and no third party can validate or reset the credential.
- A login attempt that tries to reach an OAuth provider (e.g. legacy `/auth/login?provider=google`)
  **fails closed** when the gate is on (§6).
- This is strictly stronger than "self-hosted with OAuth" — self-hosted today still requires
  provider reachability at login time. Offline-locked removes that dependency.

**What this spec does NOT change:**

- Hosted path (knowtation.store gateway + canister) — unaffected. The hosted gateway is never
  offline-locked; it always uses OAuth. The env gate has no effect on hosted Netlify deploys.
- Connected-private and local-network profiles — unaffected. They may keep using OAuth when
  network is available; offline-locked is an opt-in for the strict fully-local/offline profile.
- Existing `sub` format `provider:id` for OAuth users — unchanged. P1b adds a new `local:` prefix,
  it does not alter OAuth subjects.

**Gate consequence:** Once P1b-b is built and the env gate is flipped on a given install, that
install's Scooling consumer reads `sign_in_auth: "available"` for the `fully_local_offline`
profile (§10). Until then it stays `open_precondition`.

---

## §2 — Deployment mode + env gate

### §2.1 Env gate

```bash
KNOWTATION_OFFLINE_LOCKED_AUTH=enabled   # default: not set (= off)
```

- **Off (default):** Behavior is **identical to today**. OAuth is the only login path. The local
  credential store, if present, is ignored. No new routes are active. This is the safe default
  for hosted, connected-private, and any install that has not explicitly opted in.
- **On (`enabled`):** The Hub activates the local credential verifier (§3), the local login route
  (§6), the local CLI/MCP token issuance path (§8), and **fails closed on any OAuth attempt** (§6).
  Outbound calls to `accounts.google.com`, `github.com`, and passport OAuth strategies are
  blocked at the route layer before any network egress.

### §2.2 Where the gate is read

The gate is read **once at Hub boot** (process startup), cached as a boolean, and used by:

1. `hub/server.mjs` (self-hosted legacy Hub) — login route dispatch.
2. `hub/gateway/server.mjs` (gateway) — login route dispatch + OAuth fail-closed.
3. `hub/bridge/server.mjs` (bridge) — credential store + role resolution parity.
4. CLI bootstrap (`bin/knowtation.mjs` or equivalent) — admin bootstrap command (§4, §8).

Reading once at boot means flipping the gate requires a Hub restart — this is intentional (no
mid-flight auth-mode switching; eliminates a whole class of TOCTOU race conditions).

### §2.3 Fail-closed on misconfiguration

If `KNOWTATION_OFFLINE_LOCKED_AUTH=enabled` **but** no local credential store exists yet (no
admin bootstrapped), the Hub:

- Starts normally.
- Refuses all login attempts with `503 OFFLINE_LOCKED_NOT_BOOTSTRAPPED` (§4).
- Logs the bootstrap instruction to stdout exactly once at boot.

This prevents an operator from accidentally bricking an install by enabling the gate without
bootstrapping — they get a clear, actionable error instead of a silent 401 loop.

---

## §3 — Local credential store contract

### §3.1 Store location + file format

The credential store lives at **`DATA_DIR/hub_local_credentials.json`** — same directory
convention as the existing `hub_roles.json`, `hub_invites.json`, `hub_workspace.json` (verified
in `hub/bridge/server.mjs` lines 126–130).

```json
{
  "schema": "knowtation.hub_local_credentials/v0",
  "credentials": {
    "local:admin_001": {
      "userId": "admin_001",
      "username": "admin",
      "argon2id": "$argon2id$v=19$m=65536,t=3,p=4<base64-salt>$<base64-hash>",
      "createdAt": "2026-07-01T18:00:00.000Z",
      "mustRotatePassphrase": false
    }
  },
  "userCounter": 1
}
```

- **`userId`** is an opaque, monotonically-incrementing local identifier (`admin_001`, `user_002`,
  …). Never the username — usernames can change; userIds are stable.
- **`username`** is the login identifier the user types. Case-sensitive, normalized at write time
  (NFC, trimmed, lowercase-folded for comparison only).
- **`argon2id`** is the standard PHC string format (`$argon2id$v=19$m=…$…`). The store never
  holds the plaintext passphrase.
- **`mustRotatePassphrase`** — set `true` after bootstrap with a setup token (§4) so the user is
  forced to set their own passphrase on first login. Cleared after a successful rotation.

### §3.2 Argon2id parameters (OWASP 2024 — frozen)

From `knowtation/docs/COMPANION-APP-MODEL-ROUTING-AND-ENRICHMENT-ARCHITECTURE.md` §9.2:

```
time_cost (t)      ≥ 3
memory_cost (m)    ≥ 65536 KiB (64 MiB)
parallelism (p)    = 4
hash_length        = 32 bytes
salt_length        = 16 bytes (random, per-credential)
variant            = 2 (Argon2id)
version            = 0x13 (19)
```

- These are the **minimum** parameters. P1b-b may tune `time_cost` upward on capable hardware;
  it must never tune below these floors.
- The salt is generated with `crypto.randomBytes(16)` at credential-write time and embedded in
  the PHC string. No reused salts, no hardcoded salts.

### §3.3 Verification flow

```
1. Receive (username, passphrase) over HTTPS (or localhost HTTP).
2. Lookup credential by normalized username. If absent → 401 INVALID_CREDENTIALS
   (same error as bad passphrase — never reveal which failed).
3. argon2id.verify(storedPHC, passphrase) → boolean.
4. On true: issue JWT (§5). On false: increment failure counter (§7).
5. Plaintext passphrase is zeroed from memory immediately after verify.
```

**Timing-safe comparison:** Argon2id verification is inherently constant-time per attempt, but
the lookup-by-username step must not leak whether a username exists. The implementation must
perform a dummy Argon2id verify against a fixed decoy hash when the username is not found, so
the response time is indistinguishable from a real verify. (Prevents username enumeration via
timing.)

### §3.4 At-rest protection

- The file is JSON plaintext. This matches the existing convention (`hub_roles.json` is also
  plaintext JSON). Filesystem permissions are the primary at-rest control: `0600` mode, owned
  by the Hub process user. P1b-b must `fs.chmod(0o600)` on every write.
- The Argon2id hash itself is the credential; stealing the file does not yield passphrases
  without an offline brute-force attack that the 64 MiB memory cost makes expensive.
- **Envelope encryption of the credential store is out of scope for P1b-b** — it is a ZK-tier
  concern (companion doc §9.3) and would conflict with the bootstrap flow (§4) which must
  work before any user-derived key exists.

---

## §4 — First-admin bootstrap on air-gapped install

The bootstrap problem: when `KNOWTATION_OFFLINE_LOCKED_AUTH=enabled` and no credential store
exists, **nobody can log in**. There must be a deterministic, auditable way to create the first
admin without any network call. Two frozen mechanisms; P1b-b implements both.

### §4.1 Mechanism A — Setup token (one-time, out-of-band)

```bash
# Operator runs this on the air-gapped host, once:
KNOWTATION_OFFLINE_LOCKED_BOOTSTRAP_TOKEN=$(node bin/knowtation.mjs auth \
  generate-setup-token --username admin --expires-in 15m)
```

- Generates a 256-bit random token (`crypto.randomBytes(32)` → base64url).
- Hashes it (SHA-256) and writes a **one-time bootstrap record** to
  `DATA_DIR/hub_local_bootstrap.json` with `{ username, tokenHash, expiresAt, consumed: false }`.
- Prints the raw token **once** to stdout. The operator copies it to the user out-of-band
  (paper, secure messenger, in-person). It is never persisted in plaintext.
- The user submits `POST /api/v1/auth/local/bootstrap` with
  `{ setupToken, username, passphrase }`.
- The handler verifies the token hash, checks `expiresAt` (default 15 minutes) and
  `consumed: false`, then creates the credential (§3), sets role `admin` (§5), and atomically
  marks `consumed: true`.
- The bootstrap record is **single-use**: a second submission with the same token returns
  `410 BOOTSTRAP_TOKEN_CONSUMED`. This prevents replay.

**Hard rules:**
- The setup-token command **refuses to run** if a credential store already exists with ≥1 admin.
  This prevents privilege escalation via re-bootstrap.
- `expiresAt` is capped at 60 minutes; the CLI rejects longer windows.
- The file is `0600` and is deleted (`fs.unlink`) after the first successful consume. If the
  file exists on next Hub boot and is expired, P1b-b prunes it automatically.

### §4.2 Mechanism B — CLI bootstrap (interactive, on-host)

```bash
# Operator runs this on the air-gapped host, once, interactively:
node bin/knowtation.mjs auth bootstrap-admin --username admin
# (prompts for passphrase, does not echo, uses readline with muted output)
```

- The command reads the passphrase from a TTY prompt (not argv, not stdin pipe — prevents the
  passphrase appearing in shell history or `ps`).
- Writes the credential directly to `DATA_DIR/hub_local_credentials.json` with role `admin`.
- Refuses to run if a credential store already exists with ≥1 admin (same guard as §4.1).
- Prints only `{ ok: true, userId: "admin_001" }` on success — never the passphrase or hash.

**Which to use when:**
- **Mechanism A** is for the case where the operator is not the user (e.g. IT sets up the box,
  hands the token to the teacher).
- **Mechanism B** is for the case where the operator is the user (single-admin air-gapped laptop).

Both produce identical state: one credential in the store, one `admin` role in `hub_roles.json`,
zero network calls.

---

## §5 — JWT `sub` format + role-store parity

### §5.1 JWT payload shape

P1b reuses the **exact** `issueToken` payload shape from `hub/gateway/server.mjs` lines 185–200
and `hub/server.mjs` lines 278–286. The only difference is the `sub` and `provider`/`id` fields:

| Field | OAuth (existing) | Local (P1b) |
| --- | --- | --- |
| `sub` | `google:123` / `github:456` | **`local:admin_001`** |
| `provider` | `google` / `github` | **`local`** |
| `id` | provider-specific numeric id | **`admin_001`** (the local `userId`) |
| `name` | displayName from OAuth | username from credential store |
| `role` | from `roleForSub` / `effectiveRole` | same resolver, same values |
| `iat` / `exp` | jwt standard | jwt standard |

```javascript
// P1b-b will add to hub/lib/local-auth.mjs (frozen shape):
function issueLocalToken(credential, role) {
  const sub = `local:${credential.userId}`;
  return jwt.sign(
    {
      sub,
      provider: 'local',
      id: credential.userId,
      name: credential.username,
      role,
    },
    SESSION_SECRET,   // same secret as OAuth path; never a separate one
    { expiresIn: JWT_EXPIRY }   // same expiry; default '24h'
  );
}
```

**Parity guarantee:** a downstream consumer (`getUserId`, `requireAdmin`, the bridge role
resolver, the canister proxy) cannot distinguish a local-issued JWT from an OAuth-issued JWT
except by inspecting the `provider` field. Authorization logic is identical.

### §5.2 Role-store parity

P1b reuses the existing `hub_roles.json` store and the `effectiveRole()` resolver
(`hub/bridge/server.mjs` lines 772–777) unchanged:

```javascript
function effectiveRole(uid, storedRoles) {
  if (!uid) return 'member';
  const stored = storedRoles && storedRoles[uid];
  if (stored && VALID_ROLES.has(stored)) return stored;
  return adminUserIdsSet.has(uid) ? 'admin' : 'member';
}
```

- `VALID_ROLES = admin | editor | viewer | evaluator` — unchanged.
- The `uid` passed in is the `sub` (`local:admin_001`), so role lookups key on the full `sub`.
- Bootstrap (§4) writes `roles['local:admin_001'] = 'admin'` into `hub_roles.json`.
- Admin can promote other local users via the existing `POST /api/v1/roles` route — same
  contract, same validation, same audit. No new RBAC surface.

### §5.3 Self-hosted default-admin parity

The self-hosted Hub (`hub/server.mjs`) has a special case: when `roleMap.size === 0`, **everyone
gets `admin`** (line 280, 297). This makes a fresh OAuth install work with no manual role setup.

For offline-locked mode this special case is **dangerous** (anyone who bootstraps first becomes
unrestricted admin, and there is no OAuth allowlist to bound who can log in). P1b-b must
**disable** the empty-roleMap default for the offline-locked path: when
`KNOWTATION_OFFLINE_LOCKED_AUTH=enabled`, the role resolver treats an empty store as **denied**
rather than **admin-for-everyone**. Bootstrap (§4) is the only way to seed the first admin.

This is the one place where offline-locked diverges from self-hosted OAuth parity, and it is
the security-critical divergence.

---

## §6 — Gateway + bridge route parity + fail-closed OAuth blocking

### §6.1 New local login route (mounted only when gate on)

```
POST /api/v1/auth/local/login
Content-Type: application/json

{ "username": "admin", "passphrase": "…" }

→ 200 { "token": "<jwt>", "expiresIn": "24h" }
→ 401 { "error": "Invalid credentials", "code": "INVALID_CREDENTIALS" }
→ 401 { "error": "Account locked", "code": "ACCOUNT_LOCKED", "retryAfterSeconds": 900 }
→ 429 { "error": "Rate limit exceeded", "code": "RATE_LIMITED", "retryAfterSeconds": 60 }
→ 503 { "error": "Offline-locked not bootstrapped", "code": "OFFLINE_LOCKED_NOT_BOOTSTRAPPED" }
```

- Issued when: gate on AND credential store has ≥1 admin.
- Sets the same HttpOnly refresh cookie as OAuth path (reuses `issueRefreshCookieSafe`).
- Response body shape matches the OAuth redirect fragment (`token=…`) so the Hub UI's
  `postLoginRedirect` logic works unchanged.
- Mounted on `hub/server.mjs` (self-hosted) and `hub/gateway/server.mjs` (gateway). The hosted
  Netlify gateway never mounts it — hosted is never offline-locked.

### §6.2 Bootstrap route (mounted only when gate on)

```
POST /api/v1/auth/local/bootstrap
Content-Type: application/json

{ "setupToken": "…", "username": "admin", "passphrase": "…" }

→ 200 { "ok": true, "userId": "admin_001" }
→ 410 { "error": "Bootstrap token consumed", "code": "BOOTSTRAP_TOKEN_CONSUMED" }
→ 410 { "error": "Bootstrap token expired", "code": "BOOTSTRAP_TOKEN_EXPIRED" }
→ 409 { "error": "Already bootstrapped", "code": "ALREADY_BOOTSTRAPPED" }   (≥1 admin exists)
→ 400 { "error": "Passphrase too weak", "code": "WEAK_PASSPHRASE" }
```

- Passphrase strength policy (frozen): ≥12 characters, ≥1 of each of (lowercase, uppercase,
  digit, symbol), not in a small known-breached-password list (P1b-b uses a 100k-entry
  HIBP-style SHA-1 hash set bundled offline — no network lookup).
- The route is the **only** way to consume a setup token (Mechanism A, §4.1). The CLI
  (Mechanism B, §4.2) writes the store directly and never calls this route.

### §6.3 Fail-closed OAuth blocking (when gate on)

When `KNOWTATION_OFFLINE_LOCKED_AUTH=enabled`, every OAuth-touching route must fail closed
**before** any network egress:

| Route | Behavior when gate on |
| --- | --- |
| `GET /auth/login` | `403 { error: "OAuth disabled in offline-locked mode", code: "OAUTH_DISABLED" }` |
| `GET /auth/login?provider=google\|github` | same 403 |
| `GET /auth/callback/google` | same 403 |
| `GET /auth/callback/github` | same 403 |
| `GET /api/v1/auth/login` | same 403 |
| `GET /api/v1/auth/providers` | `200 { google: false, github: false, local: true }` — reports local available |
| MCP OAuth 2.1 router (`mcp-oauth-provider.mjs`) | **not mounted** at boot |
| Native OAuth 2.1 router (`native-oauth-provider.mjs`) | **not mounted** at boot |
| `passport.use(GoogleStrategy)` | **not registered** at boot |
| `passport.use(GitHubStrategy)` | **not registered** at boot |

**Critical invariant:** the OAuth strategies are not just "disabled at runtime" — they are
**never registered with passport**. This means there is no code path through which an
OAuth callback can execute, even if an attacker tricks the browser into hitting
`/auth/callback/google`. The route handler returns 403 before passport is consulted.

P1b-b implements this as an early-return guard at the top of each OAuth route + a conditional
around each `passport.use(...)` call, gated on the cached boot-time boolean (§2.2).

### §6.4 Bridge parity

The bridge (`hub/bridge/server.mjs`) does not handle login itself today — it proxies to the
canister and resolves roles. For offline-locked mode:

- The bridge's `effectiveRole()` resolver (line 772) works unchanged because local `sub`s are
  just another key in `hub_roles.json`.
- The bridge's `POST /api/v1/roles` validation (`VALID_ROLES.has(r)`, line 938) works unchanged.
- **No new bridge routes.** The bridge does not need to know whether auth was OAuth or local;
  the JWT carries the `provider:local` marker but authorization is role-based, not provider-based.

This parity is the reason §5 reuses the JWT shape so strictly — the bridge and canister see
the same `X-User-Id` they always have.

---

## §7 — Rate limiting, lockout, audit events (no secrets in logs)

### §7.1 Per-username rate limit

- **5 failed attempts per username per 15 minutes**, then the username is **locked** for 15
  minutes. Counter is reset on a successful login.
- Implementation: a small JSON file at `DATA_DIR/hub_local_login_attempts.json` with shape
  `{ "local:admin_001": { "failures": 3, "firstFailureAt": "…", "lockedUntil": null } }`.
  P1b-b may use an in-memory map with periodic flush, but the on-disk copy is authoritative
  across restarts.
- The lock is **per-username**, not per-IP. Offline-locked deployments are typically
  single-origin (the user's own machine), so IP-based limiting would be useless and
  username-based limiting is the correct defense against brute force.
- A locked account returns `401 ACCOUNT_LOCKED` with `retryAfterSeconds` even if the passphrase
  is correct — the user cannot "guess their way through" a lockout.

### §7.2 Global rate limit

- **20 login attempts per minute per Hub process** (all usernames combined). This is a
  backstop against an attacker spraying many usernames.
- Implemented as a token bucket in-process. Resets on Hub restart. Logged when tripped.

### §7.3 Audit events (frozen event names)

All audit events are written to the existing `data/hub_audit.log` (or equivalent). The event
names are frozen; the field schema is frozen. **No secrets appear in any event.**

| Event name | When emitted | Fields (never the passphrase or hash) |
| --- | --- | --- |
| `local_auth.login_success` | Successful local login | `sub`, `username`, `ip`, `ua`, `ts` |
| `local_auth.login_failure` | Failed local login (bad passphrase OR unknown user) | `username_attempted`, `ip`, `ua`, `ts`, `reason:"invalid_credentials"` |
| `local_auth.account_locked` | Lockout threshold reached | `sub` or `username_attempted`, `ip`, `ts`, `lockedUntil` |
| `local_auth.bootstrap_consumed` | Setup token used successfully | `sub`, `username`, `ip`, `ts`, `bootstrapTokenId` (opaque, not the token) |
| `local_auth.bootstrap_rejected` | Setup token rejected (consumed/expired/unknown) | `reason`, `ip`, `ts` (no token value) |
| `local_auth.passphrase_rotated` | User rotated passphrase after `mustRotatePassphrase=true` | `sub`, `ts` |
| `local_auth.oauth_blocked` | OAuth route hit while gate on | `route`, `ip`, `ts` |
| `local_auth.role_changed` | Local user role changed via `/api/v1/roles` | `sub`, `oldRole`, `newRole`, `actorSub`, `ts` |

**Hard log rule (RULE #6):** the passphrase, the Argon2id hash, the setup token, and the JWT
must **never** appear in any log line, audit event, crash report, or error response. P1b-b
tests enforce this in the security tier (§9).

### §7.4 Setup-token rate limit

- **5 bootstrap attempts per 15 minutes** per Hub process. Prevents token brute-force.
- Each attempt against an unknown token hash still triggers a dummy SHA-256 verify against a
  fixed decoy hash, so timing does not reveal whether the token exists.

---

## §8 — CLI / MCP token issuance path for offline-locked mode

### §8.1 The gap

Today (per `docs/AGENT-INTEGRATION.md` line 282), a CLI/MCP user obtains a token by:
1. Logging into the Hub UI via OAuth.
2. Clicking **Settings → Integrations → Copy Hub URL, token & vault**.
3. Pasting `KNOWTATION_HUB_TOKEN` (the raw JWT) into their env.

In offline-locked mode, step 1 is impossible (OAuth blocked). There must be a CLI path that
issues a JWT directly from the credential store, without a browser.

### §8.2 CLI token issuance command

```bash
node bin/knowtation.mjs auth token \
  --username admin \
  --vault-id default \
  [--expires-in 24h]

# Prompts for passphrase (TTY-muted, same as bootstrap-admin).
# On success, prints to stdout (and only stdout):
#   KNOWTATION_HUB_URL=http://localhost:3333
#   KNOWTATION_HUB_TOKEN=eyJhbGciOi...
#   KNOWTATION_HUB_VAULT_ID=default
```

- Verifies the passphrase against the credential store (§3.3).
- Issues a JWT with the **same shape** as the login route (§5.1) — `provider: local`,
  `sub: local:<userId>`, role from `effectiveRole`.
- Respects the same rate limit + lockout (§7.1) — a CLI brute-force is no easier than a web one.
- The command writes the env-export lines to **stdout only**, never to a file, never to a
  shell-history file. The operator pipes it into their env as needed:
  `eval "$(node bin/knowtation.mjs auth token -u admin -v default)"`.
- Optional `--expires-in` overrides the default 24h; capped at 168h (7 days).

### §8.3 MCP usage of the token

- The token works against `/mcp` exactly as an OAuth-issued token does — same `Authorization:
  Bearer <token>` header, same `getUserId` resolution, same role-based access.
- **MCP OAuth 2.1 dynamic registration is not available** in offline-locked mode (the OAuth
  router is not mounted, §6.3). MCP clients that require OAuth 2.1 (rather than bearer JWT)
  cannot be used offline-locked; they must use the bearer path. This is a documented limitation.
- The Hub UI's **Settings → Integrations** panel, when gate on, shows a **Copy CLI command**
  button instead of the OAuth-derived token — it copies the `auth token` command (without the
  passphrase), and the user runs it in their terminal.

### §8.4 Token revocation

- A CLI-issued JWT is revoked the same way as an OAuth-issued one: it expires (24h default), or
  the admin rotates the user's passphrase (which invalidates the refresh cookie family), or the
  admin deletes the user's credential entirely.
- There is **no server-side JWT blocklist** in scope for P1b-b. Short expiry + rotation is the
  revocation mechanism. (A blocklist is a future ZK-tier concern, out of scope.)

---

## §9 — Seven-tier test matrix (test file names, not impl)

P1b-b ships all seven tiers (RULE #0). File naming follows the existing Knowtation convention
`test/<tier>/phase8-p1b-<focus>.test.mjs` (or `.test.ts` where the harness is TS). All run with
the env gate **off** by default; the security + data-integrity tiers additionally exercise the
gate-on path against a fixture store.

| Tier | Focus (frozen) | File name (P1b-b) |
| --- | --- | --- |
| **unit** | Argon2id hash/verify round-trip; PHC string parse; parameter floor enforcement (rejects `t<3`, `m<65536`, `p!=4`); username normalization (NFC, trim, case-fold); credential store CRUD with `0600` perms; `issueLocalToken` payload shape equals OAuth payload minus provider; `effectiveRole` parity for `local:` subs; empty-store-denied (§5.3) vs empty-store-admin-for-everyone (legacy OAuth). | `test/unit/phase8-p1b-local-credential-store.test.mjs` |
| **integration** | Full login flow against a fixture Hub: bootstrap-admin (Mechanism B) → `POST /api/v1/auth/local/login` → JWT → `GET /api/v1/auth/session` → role resolves → `GET /api/v1/roles` returns the bootstrapped admin. OAuth routes return 403 when gate on. Refresh-cookie issuance mirrors OAuth path. Bridge `/api/v1/role` resolves a local sub correctly. | `test/integration/phase8-p1b-local-login-flow.test.mjs` |
| **e2e** | Air-gapped install walkthrough on a fixture host: enable gate → boot → `503 OFFLINE_LOCKED_NOT_BOOTSTRAPPED` → run `auth generate-setup-token` → consume via bootstrap route → login → issue CLI token → MCP `/mcp` call succeeds with bearer. Network stub asserts zero outbound calls to `accounts.google.com` or `github.com` during the entire walkthrough. | `test/e2e/phase8-p1b-airgapped-walkthrough.test.mjs` |
| **stress** | 10,000 rapid failed logins against one username → lockout engages at 5, never lets the 6th through even with correct passphrase, unlocks at 15min. 1,000 concurrent bootstrap attempts against one token → exactly one succeeds, rest get `410 BOOTSTRAP_TOKEN_CONSUMED`. Argon2id verify under concurrent load does not exhaust file descriptors or memory. | `test/stress/phase8-p1b-lockout-and-bootstrap-contention.test.mjs` |
| **data-integrity** | Credential store file survives Hub restart (write → stop → start → verify reads back). Bootstrap record is `fs.unlink`'d after consume (not left on disk). Login-attempts file is authoritative across restart. Role store (`hub_roles.json`) and credential store (`hub_local_credentials.json`) stay consistent on role change + passphrase rotation. `mustRotatePassphrase` cleared only after a successful rotation, never on a failed one. | `test/data-integrity/phase8-p1b-store-persistence.test.mjs` |
| **performance** | Argon2id verify latency on the floor parameters (`t=3,m=64MiB,p=4`) is measured: assert `≥50ms` (sanity — proves the KDF is actually memory-hard) and `≤2000ms` on the test hardware class (regression — prevents a future param bump that bricks login). Login route end-to-end latency `≤500ms` excluding the Argon2id verify. Bootstrap latency `≤300ms`. | `test/performance/phase8-p1b-argon2id-latency.test.mjs` |
| **security** | (a) No-secret rule: grep all log output, audit events, error responses, and crash fixtures for the test passphrase, hash, setup token, and JWT → zero matches. (b) Timing-safe username lookup: response time for unknown-username vs known-username-with-bad-passphrase is within ±10ms over 100 samples. (c) OAuth fail-closed: every OAuth route returns 403 before any outbound `fetch()` call (stub `fetch` and assert never called with an OAuth provider URL). (d) Setup-token replay rejected. (e) `mustRotatePassphrase` forces rotation before any non-rotate route succeeds. (f) File perms on `hub_local_credentials.json` are `0600` after every write. (g) Passphrase zeroed from process memory after verify (best-effort; tested by stub). | `test/security/phase8-p1b-no-secrets-and-fail-closed.test.mjs` |

**Tier-7 security is split across two files** because the surface is large; P1b-b may also ship
`test/security/phase8-p1b-bootstrap-replay.test.mjs` as a focused replay-attack file if the
combined file becomes unwieldy.

**Cross-slice e2e target (frozen):** the air-gapped walkthrough (e2e tier) must complete with
**zero outbound network calls** — verified by a global `fetch` stub that fails the test if any
call hits a non-localhost host. This is the single most important acceptance criterion for the
entire spec.

---

## §10 — Scooling impact note

**File:** `src/phase8/offlineConnectedMatrices.ts` (Scooling repo)

**Current state (verified, line 49):**
```typescript
fully_local_offline: {
  // …
  sign_in_auth: "open_precondition",   // ← line 49
  // …
}
```

The `sign_in_auth` capability for the `fully_local_offline` profile is the **only** matrix cell
that P1b closes. When P1b-b is built and a given Knowtation install has the gate on, this cell
becomes `"available"` for that install.

**Why this matters:** the offline-mode capability matrix (`OFFLINE_CAPABILITY_MATRIX` in this
file) is the Scooling consumer's source of truth for what a fully-local-offline deployment can
do. Today, sign-in is the lone `open_precondition` cell — meaning the entire profile is marked
"works offline except login." Closing P1b removes that caveat.

**P1b-verify scope (5c, after P1b-b merge):**

1. No change to the `OFFLINE_CAPABILITY_KEYS` tuple — `sign_in_auth` is already a key (line 22).
2. The `OFFLINE_CAPABILITY_MATRIX.fully_local_offline.sign_in_auth` cell flips from
   `"open_precondition"` to `"available"`.
3. The two other profiles (`local_network`, `connected_private`) already read `"available"`
   (lines 65, 81) — no change.
4. The frozen provenance/local-meter shapes (`phase8ProvenanceRecordSchema`,
   `localMeterRecordSchema`) are unaffected — they never carried auth-mode metadata.
5. Seven-tier Scooling tests for the matrix change:
   - `test/unit/phase8-8b6-offline-connected-matrices.test.ts` — update the one assertion.
   - The other six tiers — assert no behavioral regression; offline/connected transitions stay
     consistent; the now-`available` cell does not enable any cloud lane (cloud lanes remain
     gated off independently).

**Hard boundary (frozen):** Scooling is a **consumer** of Knowtation auth, never the authority.
The matrix cell reports capability; it does not perform auth. Scooling must not implement its
own credential verifier, its own Argon2id, or its own bootstrap flow — all of that is Knowtation.
The Scooling adapter (`signInAdapter` or equivalent) continues to call the Knowtation Hub route;
it merely stops gating the call behind the `open_precondition` caveat.

**No posture flip in P1b sessions (hard stop from the handover prompt):** the matrix cell change
is a **P1b-verify** deliverable (5c), not a P1b-a or P1b-b deliverable. P1b-a (this spec) does
not touch the Scooling repo at all.

---

## §11 — Posture constants (all hard-`false` until a separate Tier 3 authorization)

P1b-b introduces **one** new compile-time constant in Knowtation (not Scooling — Scooling has
no auth posture constant of its own for this; the matrix cell is the Scooling-side signal):

| Constant | Value | Gate |
| --- | --- | --- |
| `KNOWTATION_OFFLINE_LOCKED_AUTH_AVAILABLE` | **`false`** | Later Tier 3 — feature-flag for whether the offline-locked code paths ship enabled |

Wait — re-reading the existing Knowtation codebase, the gate is **env-driven** (`KNOWTATION_OFFLINE_LOCKED_AUTH=enabled`), not compile-time. This matches the existing Knowtation convention
(everything auth-related reads env at boot: `SESSION_SECRET`, `GOOGLE_CLIENT_ID`, `HUB_ADMIN_USER_IDS`).
Scooling's `PHASE8_*` gates are compile-time; Knowtation's are env-time. The two repos have
different conventions and we respect both.

**Frozen decision: env-gate, not compile-time.** There is no new compile-time posture constant.
The env var `KNOWTATION_OFFLINE_LOCKED_AUTH` is the sole gate. This is consistent with:

- `GOOGLE_CLIENT_ID` / `GITHUB_CLIENT_ID` (env gates OAuth)
- `HUB_ADMIN_USER_IDS` (env gates admin role list)
- `TASK_WRITES_ENABLED` (env gates task writes on the bridge)

The only compile-time signal P1b-b adds is a **feature-flag** in case we need to ship the code
inert before any operator enables it:

| Flag | File | Value | Purpose |
| --- | --- | --- | --- |
| `OFFLINE_LOCKED_AUTH_CODE_SHIPPED` | `hub/lib/local-auth-feature-flag.mjs` (new in P1b-b) | **`false`** in P1b-b's first commit, flipped `true` when tests green | Lets P1b-b ship the code path inert; even with `KNOWTATION_OFFLINE_LOCKED_AUTH=enabled`, login refuses until the flag is `true`. Double-lock with the env gate. |

This double-lock (compile-time flag **AND** env gate, both must be on) mirrors the Scooling
pattern (`PHASE8_*` compile + `SCOOLING_*` env) adapted to Knowtation's env-first convention.

---

## Acceptance (P1b-a — this Thinking step)

- [x] Gap recap with owner + evidence (§1).
- [x] Deployment mode + env gate frozen, fail-closed on misconfig (§2).
- [x] Local credential store contract — file format, Argon2id parameters (OWASP 2024),
      timing-safe verify, at-rest controls (§3).
- [x] First-admin bootstrap — setup token (Mechanism A) + CLI interactive (Mechanism B) (§4).
- [x] JWT `sub` format (`local:<userId>`) + role-store parity; self-hosted default-admin
      divergence frozen (§5).
- [x] Gateway + bridge route parity; OAuth fail-closed before any network egress (§6).
- [x] Rate limiting (per-username + global), lockout, 8 audit event names, no-secret log rule (§7).
- [x] CLI/MCP token issuance path; MCP OAuth 2.1 limitation documented (§8).
- [x] Seven-tier test matrix with file names (§9).
- [x] Scooling impact note — `sign_in_auth` cell flip in P1b-verify, hard boundary restated (§10).
- [x] Posture constants — env gate + compile-time feature flag, double-lock (§11).

## Non-goals (P1b-a)

- No production code, no live credential store, no live login route, no live CLI command.
- No env flip or Tier 3 authorization.
- No envelope encryption of the credential store (ZK-tier, out of scope).
- No server-side JWT blocklist (ZK-tier, out of scope).
- No MCP OAuth 2.1 support in offline-locked mode (documented limitation, §8.3).
- No change to hosted path (knowtation.store gateway) — hosted is never offline-locked.
- No change to OAuth `sub` format for OAuth users — only adds `local:` prefix.
- No Scooling posture flip — Scooling repo untouched in P1b-a.
- No SD-8 / MuseHub plugin work.
- No bundling with Phase 2F-b or Track C.

## Governance sync (both docs together, per RULE #8)

- `knowtation/docs/KNOWTATION-ROADMAP.md` (if present) — Phase P1b-a status row → **DONE on branch**;
  P1b-b → TODO.
- `knowtation/docs/KNOWTATION-OVERSEER-HANDOVER.md` (if present) — PRIMARY rotated to P1b-b Auto build
  prompt when this branch merges.
- Scooling `docs/KNOWTATION-OVERSEER-HANDOVER.md` — 5a row → **DONE on branch / 5b TODO**; this update
  happens in the Scooling repo, not here, and is a separate Tier 1 commit.

## Branch

- `feat/phase-8-p1b-offline-locked-auth-spec` off Knowtation Muse `main` @ `sha256:8f2c3eae…`.
- Muse + Git commit on the feature branch (Tier 1, pre-authorized per Knowtation `AGENTS.md`).
- **No PR to `main`** in this session — SD-11 forbids docs-only PRs to `main`. Merge waits for
  P1b-b code+tests to bundle, **or** explicit operator request for an urgent docs merge.
- When spec is committed and test matrix is complete, **stop and ask operator for Tier 3 merge
  approval** (per handover prompt).
