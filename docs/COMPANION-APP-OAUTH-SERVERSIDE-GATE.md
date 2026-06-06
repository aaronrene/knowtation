# Companion App — Server-Side OAuth Gate (client registration + scopes)

**Status:** ✅ **RATIFIED 2026-06-06 + IMPLEMENTED 2026-06-06.** All four decisions (D-SS.1–D-SS.4) accepted. All six changes (C1–C6) implemented and tested (86/86 tests green across 7 tiers).
**Branch:** `feat/companion-app` (Muse-canonical; paired with the Phase 3/4 code already on this
branch — **not** a docs-only PR to `main`).
**Resolves:** [`COMPANION-APP-PHASE-3-OAUTH-PKCE.md`](COMPANION-APP-PHASE-3-OAUTH-PKCE.md) §7 (the four
server-side items Phase 3 explicitly deferred) and §1 D-P3.2.
**Unblocks:** Phase 5 (companion shell) — it cannot obtain a web-session-equivalent identity until
this gate is accepted.
**Touches the protected list:** this gate decides **OAuth client registration and scopes** — the exact
items
[`COMPANION-APP-DESIGN-AND-AUTHORIZATION-GATE.md`](COMPANION-APP-DESIGN-AND-AUTHORIZATION-GATE.md)
§"DOES NOT approve" guards. A wrong default here is an over-privilege or account-compromise path, so
every decision below is argued against an attacker and defaults **fail-closed**.

---

## Simple summary

The companion app (a helper that runs AI on your own computer) needs to sign in the **same way the
website does**, and end up with the **same kind of pass** the website gives you — no weaker, no
stronger. Phase 3 already built the safe sign-in handshake as pure math (PKCE), but it left four
questions about the **server** side unanswered, because answering them changes who gets what
permissions — and getting that wrong could over-grant access or open an account-takeover path. This
document answers those four questions, argues each one against an attacker, and lists exactly what
the server team must build and test next. It writes **no server code**.

The four questions: (1) what permissions should the companion's pass carry, and how is it issued?
(2) the sign-in server is currently turned off on our hosted (Netlify) deployment — where does it
run instead? (3) should the sign-in reply include a tamper-proof "who sent this" stamp (RFC 9207)?
(4) does the server correctly accept a desktop app's "reply to me on my own computer" address even
though its exact door number changes every time?

## Technical summary

Phase 3 shipped a **provider-agnostic, pure PKCE client core** (`lib/companion-oauth-pkce.mjs`) plus
pure custody (`lib/companion-token-custody.mjs`) and deferred all server-side OAuth to this gate
(Phase 3 §1 D-P3.2, §7). Verified against source, the existing hosted OAuth surface does **not** yet
deliver the gate's "**same JWT / same scopes as the web session**" promise
([design gate §3](COMPANION-APP-DESIGN-AND-AUTHORIZATION-GATE.md)):

| Verified fact | Source |
| --- | --- |
| Web-session JWT = `{ sub, provider, id, name, role }`; **no `scopes` claim, no `type` claim** | `hub/gateway/server.mjs:177` `issueToken` |
| `scopesForRole`: `member → [vault:read, vault:write]`; `admin → [vault:read, vault:write, admin]` | `hub/gateway/server.mjs:225` |
| MCP provider mints `type:'mcp_access'`, scopes **default `['vault:read']`** (read-only) | `hub/gateway/mcp-oauth-provider.mjs:170-198` |
| MCP provider refresh = **in-memory `randomUUID()` Map, no reuse-detection family-revoke, lost on restart** | `hub/gateway/mcp-oauth-provider.mjs:80-83,183-241` |
| `verifyToken`/`getUserId` accept **any** `SESSION_SECRET`-signed JWT with a `sub` — **no `type` check, no `scopes` enforcement** | `hub/gateway/server.mjs:194-201,1087-1091` |
| Data-plane authority is **re-derived server-side** (role/scope from the bridge), not from the JWT's `scopes` | `hub/gateway/server.mjs:1178-1206` `getHostedAccessContext`; `hub/gateway/mcp-proxy.mjs:160-205` |
| `/api/v1/auth/session` (consumed by Scooling, gate §8) reads `provider/id/name/role` from the JWT | `hub/gateway/server.mjs:412-432` |
| Loopback redirect carries `code` + `state` only — **no `iss`** | `hub/gateway/mcp-oauth-provider.mjs:146-149` |
| `exchangeAuthorizationCode`'s `redirectUri` argument is **ignored** (`_redirectUri`) | `hub/gateway/mcp-oauth-provider.mjs:158` |
| OAuth router mounted only when `SESSION_SECRET && !process.env.NETLIFY` — **skipped on Netlify** | `hub/gateway/server.mjs:540,568-570` |
| Refresh rotation + reuse detection + family-revoke (the lifecycle Phase 3 custody mirrors) | `hub/lib/refresh-token-core.mjs:259-319`; `hub/auth-session.mjs:104-156` |

The decisions below resolve the four §7 items on top of these facts. The headline finding that
reframes Decision 1: **the JWT `scopes` claim is not the gateway's enforcement point today** — data
authority is governed by the signature + `sub` + server-side role resolution — so the meaningful
parity question is the **token shape and refresh lifecycle**, not the scope string.

---

## 1. Decision D-SS.1 — Scope / identity parity for the native client

> Phase 3 §7(1): *either (a) the MCP provider issues role-derived web scopes instead of the read-only
> `mcp_access` default, or (b) a dedicated native-client path issues the web-session JWT.*

### Verified state

The companion must write `ai_summary` enrichment back to the partition it can already read
([design gate §6, D3](COMPANION-APP-DESIGN-AND-AUTHORIZATION-GATE.md); Phase 0 D1.3). That requires
**`vault:write`**, which is exactly what a web **member** already holds (`scopesForRole`,
`server.mjs:225`). So **web-session-equivalent IS least-privilege for this client** — read-only
(`mcp_access` default) breaks the function; anything above `[vault:read, vault:write]` (e.g. `admin`)
over-grants.

Critically, on the REST data plane authority is **not** read from the JWT `scopes` claim
(`verifyToken` ignores it, `server.mjs:194`); it is re-derived from the bridge hosted-context
(`getHostedAccessContext`, `server.mjs:1178`) keyed on `sub`. Therefore the choice between (a) and (b)
is decided by **token shape, identity fidelity, and refresh lifecycle**, not by the scope string.

### Adversarial argument

| Threat / property | Option (a): bump `mcp_access` default to role scopes | Option (b): dedicated native path → web-session JWT |
| --- | --- | --- |
| **Identity fidelity** (Scooling reads `/api/v1/auth/session`, `server.mjs:412`) | ❌ `mcp_access` carries no `provider/id/name/role`; introspection returns **empty identity + default `member`** — breaks "same identity as the web session." | ✅ Byte-for-byte the web JWT `{sub,provider,id,name,role}` → introspection + Scooling unaffected. |
| **Refresh blast radius** (theft of the refresh token) | ❌ In-memory UUID Map, **no reuse-detection family-revoke**, **lost on every restart** (silent forced re-auth). A replayed rotated token only returns "unknown" — it does **not** burn the family. | ✅ `refresh-token-core` rotation + **reuse → family revoke** (`refresh-token-core.mjs:287-290`) — the exact lifecycle Phase 3 custody §4 was built to mirror (`invalid_grant`/reuse → `clearSession` → fresh browser login). |
| **Over-grant of the access token** | The read-only default is a **false floor**: an `mcp_access` JWT is *already* accepted on the REST plane by `verifyToken` regardless of its `['vault:read']` scope. Bumping the default does not add capability it lacked — it papers over the identity/lifecycle gap. | The token is the web session — a stolen companion JWT is **no worse than a stolen web JWT**, and strictly better on the refresh side. |
| **Confused-deputy with real MCP clients** | ❌ Changing the shared `mcp_access` default also widens **every** MCP-tool client (Claude Desktop, etc.) from read-only to read+write — collateral over-grant. | ✅ The native path is **distinct**; the `mcp_access` path for MCP-tool clients is left untouched at its read-only default. |
| **New attack surface** | None beyond today. | One: a native authorization/token route. Bounded by Phase 3's PKCE + `state` + `iss` + loopback-literal allowlist (threat model a–j) and public-client (no device secret). |

### Recommendation — **Option (b)** (product + eng call → owner ratification requested, [§9](#9-approval-table))

Issue the **web-session JWT** (`issueToken` shape) to the native/loopback client through a
**dedicated native-client authorization path**, with the issued scope **bound to `scopesForRole(role)`
— never a superset, never `admin` unless the user is already admin** (identical to the web ceiling).
Drive its refresh through **`refresh-token-core`** (rotation + reuse-detection family-revoke),
delivered in the **token-response body** (the companion is not a browser — no `HttpOnly` cookie),
stored by Phase 5 in the OS keychain per Phase 3 custody.

**Implementation note (allowed, not required):** the path MAY reuse the MCP SDK auth-router's PKCE /
dynamic-registration / authorization / token **protocol plumbing** as machinery, but the **token it
mints must be the web-session JWT** (via the shared `issueToken`) and its **refresh must be backed by
`refresh-token-core`** — i.e. option (b)'s semantics, regardless of which plumbing is reused. The
companion is **not** an MCP-tool client; it is a native app acting as the user against the REST data
plane, so it does **not** need the `type:'mcp_access'` token and the existing `mcp_access` path must
remain unchanged for actual MCP clients.

**Fail-closed defaults:** missing/unknown role → treat as `member` ceiling (`[vault:read,
vault:write]`), never elevate; never issue a non-rotating or long-lived token.

---

## 2. Decision D-SS.2 — Hosted availability of the authorization/token endpoints

> Phase 3 §7(2): the PKCE provider is skipped on Netlify (`SESSION_SECRET && !NETLIFY`,
> `server.mjs:540`). The companion targets the hosted gateway — where are the endpoints served?

### Verified state

The OAuth router is gated off on Netlify because the SDK MCP **session** transport needs stateful
SSE + shared memory incompatible with serverless (`server.mjs:534-539`), and the provider keeps
`_pendingCodes` + `_refreshTokens` in **in-memory Maps** (`mcp-oauth-provider.mjs:80-83`). The web
refresh path, by contrast, already runs on Netlify against a **durable blob store** through
`refresh-token-core` + `auth-session.mjs` — so durable AS state on serverless is not without
precedent.

### Verified live server inventory (owner-confirmed 2026-06-06)

> The former AWS `paperclip-prod` (t3.xlarge) has been **decommissioned**; Paperclip migrated to
> the iMac. Two servers remain in AWS `us-east-2`:

| Name | Instance ID | Type | Public IP | Security Group | Role |
| --- | --- | --- | --- | --- | --- |
| Discord Bot | i-00ffa62e50bd41080 | t3.micro | 3.19.27.252 | launch-wizard-1 | Bot / automation |
| **knowtation-mcp-gateway** | **i-025679d93cf47aeab** | **t3.small** | **18.221.120.124** | **knowtation-mcp-sg** | **Persistent MCP/OAuth gateway** |

The hosted REST API runs on **Netlify** (serverless); the OAuth/MCP router is skipped there
(`server.mjs:540,568`). `hub/gateway/README.md:62` documents the intended split — **API on Netlify,
persistent MCP on a separate host** — and `knowtation-mcp-gateway` **is that host**.

### Adversarial argument

- **Discord Bot (t3.micro) — REJECTED.** Automation/bot workload; same privilege-separation failure
  as the old Paperclip box. A compromise yields the ability to mint identity for every Knowtation
  user if the gateway's `SESSION_SECRET` is co-located there.
- **`knowtation-mcp-gateway` (t3.small) — ACCEPTED for reuse.** Purpose-built for this exact role
  (the name and dedicated `knowtation-mcp-sg` security group confirm it), has a public IP, is already
  the intended co-location for `/mcp` and the OAuth AS per `hub/gateway/README.md`. It runs **no
  automation/bot workloads** — it is the gateway itself. The privilege-separation requirement is
  satisfied: identity is isolated on a host whose only job is serving the Knowtation persistent
  gateway. A t3.small (2 vCPU, 2 GB) is correctly sized — the gateway is I/O-bound, runs no
  inference, no Postgres, no agent subprocesses.
- **New host — not needed.** `knowtation-mcp-gateway` already exists, is already dedicated, and
  already has the right posture. Provisioning a third server would duplicate it for no security gain.
- **(ii) Durable-state-on-Netlify — viable fallback, not needed.** Acceptable if the owner ever
  wants to decommission the persistent host, but adds bespoke AS-state porting work (expired/replayed
  codes must be atomic across isolated invocations) and this host already exists.

### Recommendation — **DECIDED: reuse `knowtation-mcp-gateway`** (no new server)

**The companion's OAuth authorization/token/registration endpoints co-locate on
`knowtation-mcp-gateway` (i-025679d93cf47aeab, t3.small, 18.221.120.124)**, alongside the existing
`/mcp` endpoint, exactly as `hub/gateway/README.md` planned. No third server is needed.

**Implementation obligations** for the follow-up phase:
- TLS must terminate on the host (Caddy/Let's Encrypt or an ACM-backed ALB) — the OAuth endpoints
  MUST be HTTPS-only; the companion's `buildAuthorizationUrl` enforces HTTPS on the AS endpoint.
- `SESSION_SECRET` stored in **AWS SSM Parameter Store / Secrets Manager** under a
  least-privilege IAM role scoped to this instance only — never in the process environment of the
  Discord bot or any other host.
- The `knowtation-mcp-sg` security group must allow inbound 443 (HTTPS) from `0.0.0.0/0` for OAuth
  redirects (the companion's system browser hits the authorization endpoint) and inbound from the
  Netlify gateway IP range for the MCP proxy path. No other ports.
- Durable AS state (pending codes + native refresh records) must survive process restart — use the
  **same blob/file store** the web refresh path uses, or a small SQLite/Redis local to the host.
  **No in-memory Maps** for production AS state.

**Either way:** the endpoints must serve over **HTTPS**, advertise discovery metadata whose `issuer`
exactly matches the emitted `iss` (D-SS.3), and never rely on in-memory Maps for code/refresh state
(that would silently drop valid sessions and break reuse detection).

---

## 3. Decision D-SS.3 — RFC 9207 `iss` emission on the redirect

> Phase 3 §7(3) and D-P3.3: emit `iss` so clients passing `expectedIssuer` get full mix-up defense.

### Verified state

`completeMcpAuthorization` (`mcp-oauth-provider.mjs:146-149`) builds the loopback redirect with `code`
and `state` only — **no `iss`**. Phase 3's client validates `iss` **constant-time when present** and
**tolerates absence** for back-compat (D-P3.3). So today, even a client that passes `expectedIssuer`
gets **no** mix-up protection (threat **c**), because absent-`iss` is tolerated.

### Recommendation — **CONFIRM (emit `iss`)**

Add `iss` to the authorization-**response** redirect (the loopback redirect built in
`completeMcpAuthorization`), set to the **issuer identifier string** — identical to the `issuerUrl`
the SDK auth-router advertises in discovery metadata (`server.mjs:557`, `new URL(BASE_URL)`), with no
trailing-slash drift. Specification:

- Value = the AS issuer identifier, URL-encoded, **exactly equal** to the `issuer` in the
  authorization-server metadata (RFC 9207 §2 / RFC 8414).
- Emitted on the **authorization response** (the redirect), **not** the token response.
- Purely additive: a Phase 3 client passing `expectedIssuer` now gets **constant-time mix-up defense
  with zero client change** (Phase 3 threat **c**, `ISSUER_MISMATCH`); a client that does not pass
  `expectedIssuer` is unaffected.
- Carries no secret. Absent-`iss` remains tolerated **only** for any pre-existing client; new native
  clients SHOULD pass `expectedIssuer` and SHOULD treat a mismatch as fatal.

---

## 4. Decision D-SS.4 — Loopback redirect registration with a variable ephemeral port

> Phase 3 §7(4): confirm the provider/SDK auth-router accepts a native client registering a loopback
> `redirect_uri` with a **variable ephemeral port** (RFC 8252 §7.3), and that `redirect_uri` is
> validated against the registration at the token exchange.

### Verified state

- The provider **stores** `params.redirectUri` at `authorize` and redirects to it at
  `completeMcpAuthorization` (`mcp-oauth-provider.mjs:97-118,146-149`), but **does not re-validate it
  at the token exchange** — `exchangeAuthorizationCode`'s `_redirectUri` argument is **ignored**
  (`:158`).
- Whether a loopback `redirect_uri` with a variable port is accepted at **registration** and
  **authorization** is governed by the **`@modelcontextprotocol/sdk` auth-router**
  (`mcpAuthRouter`, mounted `server.mjs:555`), whose source/version this gate has **not** inspected.
  This is therefore a **CONFIRM-WITH-VERIFICATION**, not an assertion.

### Adversarial argument

If neither the SDK nor the provider validates `redirect_uri` at token exchange, a code intercepted on
the loopback could in principle be exchanged from a different redirect. **PKCE still blocks the
exchange** (the attacker lacks the `code_verifier`, Phase 3 threat **a**), so this is not a
stand-alone compromise — but `redirect_uri` validation is **defense-in-depth required by RFC 6749
§4.1.3** and must not be skipped.

RFC 8252 §7.3 nuance the implementation must respect: the AS **MUST allow variable ports** for
loopback redirects, i.e. registration/authorization matching must be **port-agnostic on the loopback
literal**. But within a **single** attempt the companion binds one ephemeral port, derives the
`redirect_uri` from it, and uses that **same** value for both authorization and token exchange — so
the §4.1.3 **equality** check (same `redirect_uri` for a given code) holds per attempt. "Variable
port" is a property **across** attempts/registration, not within one exchange. Both are satisfiable
simultaneously.

### Recommendation — **CONFIRM, with a hard implementation obligation**

1. **Verify** against the pinned `@modelcontextprotocol/sdk` version that (a) a native client can
   dynamically register a loopback `redirect_uri`, and (b) the authorization request's loopback
   `redirect_uri` is accepted with a variable/ephemeral port (port-agnostic loopback match, RFC 8252
   §7.3) — `127.0.0.1`/`[::1]` literals only, never `localhost`-wildcard, never a non-loopback host.
2. **Enforce** `redirect_uri` validation **at the token exchange**: the `redirect_uri` presented with
   a code MUST equal the one bound to that code at `authorize` (RFC 6749 §4.1.3). If the SDK does not
   already enforce this upstream, **change the provider** to compare against `pending.redirectUri`
   (replacing the ignored `_redirectUri`). The comparison is per-code **equality** (the same attempt's
   value), not a port-agnostic match — port-agnosticism applies only to registration/authorization
   acceptance.
3. Reject any registered/presented redirect that is not an RFC 8252 loopback literal (mirrors the
   client-side `validateRedirectUri`, Phase 3 threat **e**), fail-closed.

---

## 5. Threat model → control (server side)

Extends Phase 3 §2 (client side) to the server changes this gate authorizes.

| # | Attacker capability | Control mandated by this gate | RFC |
| --- | --- | --- | --- |
| S-a | Over-privileged companion token (write where read suffices, or `admin`) | Issued scope **bound to `scopesForRole(role)`**, never a superset; native path distinct from `mcp_access` so MCP clients are not widened (D-SS.1) | RFC 6749 §3.3; RFC 9700 |
| S-b | Refresh-token theft / replay | `refresh-token-core` rotation + **reuse → family revoke** for the native client (D-SS.1) | RFC 6819 §5.2.2.3; RFC 9700 |
| S-c | AS / redirect **mix-up** (client juggling >1 AS) | Emit `iss` = issuer identifier on the redirect; Phase 3 client constant-time-matches `expectedIssuer` (D-SS.3) | RFC 9207 |
| S-d | Authorization-**code interception** on loopback | PKCE S256 verifier binding (Phase 3) **+** `redirect_uri` equality at token exchange (D-SS.4) | RFC 7636; RFC 6749 §4.1.3 |
| S-e | **Open-redirect** via registered `redirect_uri` | Loopback-literal-only registration, port-agnostic per RFC 8252 §7.3, no wildcard host (D-SS.4) | RFC 8252 §7.3, §8.3 |
| S-f | Degraded/forged identity to Scooling introspection | Web-session JWT shape `{sub,provider,id,name,role}` so `/api/v1/auth/session` is unchanged (D-SS.1) | — (internal contract, gate §8) |
| S-g | AS-state loss / cross-instance drift admitting stale codes or breaking reuse detection | Durable code/refresh state on the chosen host; no in-memory Maps in serverless/multi-instance (D-SS.2) | RFC 6819 §5.1.5 |
| S-h | Second secret-holder compromise (new host) | Persistent host shares `SESSION_SECRET` over a controlled channel; HTTPS only; minimal surface (D-SS.2) | RFC 9700 |

---

## 6. Precise server-side change list (for the FOLLOW-UP implementation phase)

✅ **Implementation complete 2026-06-06. 86/86 tests green across all 7 tiers.**

| # | Change | Implementation | Decision |
| --- | --- | --- | --- |
| ✅ C1 | Native-client authorization path mints the **web-session JWT** (`issueToken` shape), scopes **bound to `scopesForRole(role)`**; `mcp_access` path untouched | `hub/gateway/native-oauth-provider.mjs` — `createNativeOAuthRouter()`; mounted in `server.mjs` at `/api/v1/auth/native` | D-SS.1 |
| ✅ C2 | Native-client refresh backed by **`refresh-token-core`** (rotation + reuse→family-revoke); token in response body (no cookie); reason codes aligned to `auth-session.mjs` | `hub/gateway/native-oauth-provider.mjs` — `grant_type=refresh_token` via `opts.refreshStore.rotate()` (shared `createGatewayRefreshStore()`) | D-SS.1 |
| ✅ C3 | **`iss`** = issuer identifier on loopback redirect in both MCP and native paths, equal to discovery `issuer` | `hub/gateway/mcp-oauth-provider.mjs:completeMcpAuthorization` + `hub/gateway/native-oauth-provider.mjs:completeNativeAuthorization` | D-SS.3 |
| ✅ C4 | **Durable** pending auth codes (survive restart) + native refresh via durable gateway store | `hub/gateway/native-as-store.mjs` (atomic JSON file); refresh via `createGatewayRefreshStore()` | D-SS.2 |
| ✅ C5 | **`redirect_uri` validated at token exchange** (per-code equality, RFC 6749 §4.1.3); loopback-only at registration; SDK v1.27.1 variable-port loopback verified | `hub/gateway/native-oauth-provider.mjs` — exact equality check; `hub/gateway/mcp-oauth-provider.mjs:exchangeAuthorizationCode` — validates when provided | D-SS.4 |
| ✅ C6 | Scope ceiling guard in every token-mint path; unknown/missing role → `member` ceiling; applied at code exchange AND on every refresh rotation | `hub/gateway/native-oauth-provider.mjs:applyScopeCeiling()` | D-SS.1 |

**New files:** `hub/gateway/native-as-store.mjs`, `hub/gateway/native-oauth-provider.mjs`, `test/native-oauth-c1-c6-{unit,integration,e2e,stress,data-integrity,performance,security}.test.mjs`

**Modified files:** `hub/gateway/mcp-oauth-provider.mjs` (C3, C5), `hub/gateway/server.mjs` (native router mount at `/api/v1/auth/native`, IDP callback `native:` state prefix)

**Explicitly out of scope (unchanged):** the existing `verifyToken` behavior of not enforcing the
JWT `scopes` claim (`server.mjs:194`) is a separately tracked concern. Authority is re-derived
server-side by role. Changing data-plane scope enforcement requires its own gate.
---

## 7. 7-tier test obligations (per change C1–C6)

Aaron's Rule #0. Each change above ships all seven tiers before merge to `main`.

| Tier | Obligation |
| --- | --- |
| **Unit** | Native path mints exactly `{sub,provider,id,name,role}` with scope == `scopesForRole(role)`; `iss` value == discovery `issuer`; `redirect_uri` equality compare; scope-ceiling guard rejects supersets; unknown role → `member` ceiling. |
| **Integration** | Full native authorization → token exchange against the chosen host; refresh rotation via `refresh-token-core`; reuse → family-revoke → `REFRESH_REUSE`; `/api/v1/auth/session` returns full identity for the native JWT (parity with web). |
| **End-to-end** | Companion sign-in → web-session JWT → write `ai_summary` back (D3/§6) → introspection identity intact; `mcp_access` clients **unchanged** (regression: still read-only by default, still `type:'mcp_access'`). |
| **Stress** | Many concurrent native authorizations; refresh-rotation storm with interleaved reuse attempts (zero family-revoke misses); durable-store contention on the chosen host; ephemeral-port variety across attempts. |
| **Data-integrity** | Single-use codes never double-spend across instances; refresh family invariants hold under durable store; no scope drift on refresh (subset-only, `mcp-oauth-provider.mjs:211-213` analogue); `iss` byte-stable vs discovery. |
| **Performance** | Token-exchange + introspection latency bounds; durable-store read/write within the host budget (and within 26 s if D-SS.2 (ii) is chosen). |
| **Security** | **Centerpiece.** No superset/`admin` over-grant; PKCE still required (no `plain`); `redirect_uri` non-loopback rejected; mix-up rejected when `expectedIssuer` set + wrong `iss`; refresh reuse burns the family; no secret (`SESSION_SECRET`, JWT, refresh token, code, verifier) in any log/error/redirect; second-host secret handling reviewed; `mcp_access` clients not widened. |

---

## 8. Constraints honored

- **Decisions only — no server code.** This document changes no `hub/` runtime; it records what a
  follow-up phase must build and test.
- **Muse-canonical**, on `feat/companion-app`, paired with the Phase 3/4 code already there — **not** a
  docs-only PR to `main` (per the owner's no-docs-only-PR-to-`main` policy).
- **Security first; fail-closed defaults.** Every default above denies/least-privileges on ambiguity.
- **No assumptions stated as fact.** Every claim is anchored to a verified file:line; the one item
  this gate could **not** verify (SDK loopback variable-port behavior) is marked
  CONFIRM-WITH-VERIFICATION (D-SS.4), not asserted.

---

## 9. Approval table

| Decision | Recommendation | Owner approval |
| --- | --- | --- |
| **D-SS.1** — native client gets the **web-session JWT** (option b), scope == `scopesForRole(role)`, refresh via `refresh-token-core`; `mcp_access` path untouched | **ACCEPT (option b)** | ✅ approved 2026-06-06 |
| **D-SS.2** — hosted availability: **reuse `knowtation-mcp-gateway`** (i-025679d93cf47aeab, t3.small, us-east-2c) — no new server needed | **DECIDED: reuse `knowtation-mcp-gateway`** | ✅ approved 2026-06-06 |
| **D-SS.3** — emit `iss` = issuer identifier on the redirect (RFC 9207) | **CONFIRM** | ✅ approved 2026-06-06 |
| **D-SS.4** — loopback variable-port registration (RFC 8252 §7.3) + `redirect_uri` equality at token exchange (RFC 6749 §4.1.3) | **CONFIRM (with SDK verification)** | ✅ approved 2026-06-06 |

D-SS.1–D-SS.4 are ratified. The four Phase 3 §7 items are resolved. The **server-side implementation
phase** (changes C1–C6, §6) is unblocked — itself gated on the §7 7-tier test obligation before any
merge to `main`. That phase in turn unblocks **Phase 5** (companion shell).
