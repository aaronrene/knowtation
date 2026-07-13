# Durable agent / MCP auth for remote co-founders — frozen decision

**Status:** Thinking freeze (2026-07-12) — **revised 2026-07-12 after adversarial security/identity review** (§4 review findings folded into §1, §5, §8, §14). **No Build code in this session.**  
**Branch:** `feat/durable-agent-mcp-auth-thinking`  
**Companion plan:** [`DURABLE-AGENT-AUTH-ROADMAP.md`](./DURABLE-AGENT-AUTH-ROADMAP.md)  
**Approval gate:** Aaron must accept §2 Verdict + §5 Recommended architecture before Phase A Build.

---

## Simple summary

Remote always-on agents (like Hermes on Hostinger) cannot stay connected by pasting the Hub “Copy token” JWT into `.env`. That paste is a short-lived access token with **no refresh**. The Hub UI stays signed in because the browser has a refresh cookie; the paste button does not copy that. Marketing copy that makes “connect your agent” sound finished overstates what ships for cloud agents. The product gap is real: we need a Hub flow that issues **refreshable, revocable, scoped** credentials (prefer MCP OAuth / device connect), not longer god JWTs.

## Technical summary

Verified code: `btn-copy-hub-api-env` pastes `localStorage hub_token` only (`web/hub/hub.js`); browser renewal uses HttpOnly cookie → `POST /api/v1/auth/refresh` (`credentials: 'include'`). Gateway access JWT default `HUB_JWT_EXPIRY || '24h'` (`hub/gateway/server.mjs`); MCP OAuth issues `type: mcp_access` (1h) + in-memory refresh (~24h) (`hub/gateway/mcp-oauth-provider.mjs`); native companion OAuth is loopback-only + body refresh via `refresh-token-core` (`hub/gateway/native-oauth-provider.mjs`). Netlify returns `MCP_NETLIFY_UNSUPPORTED` for `/mcp`; public MCP URL is `https://mcp.knowtation.store/mcp` (`web/hub/config.js`). Hermes Agent documents MCP `auth: oauth` with PKCE, auto-refresh, and headless paste-back — **research spike still required** against Aaron’s Hostinger Hermes build before claiming production readiness.

---

## 1. Incident (truth vs claims)

| Claim / belief | Verified truth |
| --- | --- |
| Paste Hub JWT into Hermes `/data/.env` for durable vault access | **False.** Paste is access JWT only; no refresh token on that path (`web/hub/hub.js` copy handler; refresh is cookie-only for Hub UI). |
| Hub UI “staying logged in” means the pasted token stays valid | **False.** UI uses `refreshAccessToken()` → `POST /api/v1/auth/refresh` with `credentials: 'include'`. |
| Hosted MCP works on the Netlify gateway URL | **False for stateful MCP.** `NETLIFY` → `/mcp` 503 `MCP_NETLIFY_UNSUPPORTED` (`hub/gateway/server.mjs`). Use `HUB_MCP_PUBLIC_URL` / `mcp.knowtation.store`. |
| `HUB-API.md`: “There is no API-key-only path” | **True today.** Login-issued JWT (or MCP/native OAuth tokens) only. |
| Landing “Hermes Agent” tile = connect Hermes as vault client | **False.** Tile is under **import** (“Agent memory + profile”) in `web/index.html`. |
| Hosted MCP OAuth exists | **True** on persistent gateway (`mcp-oauth-provider.mjs` + `mcpAuthRouter`). Refresh store is **in-memory plaintext `Map`** (`mcp-oauth-provider.mjs:89,201-207`) — no hash-at-rest, no reuse→family revoke; TTL access **3600s**, refresh **86400s**. |
| A durable, hardened refresh store must be built for MCP | **False — it already exists.** `hub/gateway/refresh-token-store.mjs` (`createGatewayRefreshStore()`) wraps `refresh-token-core` (hash-at-rest, rotation, reuse→family revoke) and is **already wired into native OAuth on the same persistent MCP host** (`server.mjs:355,670`). Phase A is *reuse*, not *build*. |
| MCP `mcp_access` tokens are scope-limited on REST | **False.** REST `verifyToken` returns only `sub` (`server.mjs:221-228`); authz re-derives role via `roleForSub`→`scopesForRole` and **ignores the token's `scopes`**. A `vault:read` MCP token already writes over REST today (live scope-elevation — see §8). |
| Companion/native OAuth is the Hostinger answer | **False.** Loopback-only redirect URIs (`isLoopbackUri`); designed for on-device companion. |
| Docs tell users to re-copy on 401 | **True** (`docs/AGENT-INTEGRATION.md` §3; Hub Settings copy). That is ops honesty, not a consumer product for always-on agents. |
| Observed ~15m expiry on paste | **Ops observation.** Code default on gateway is **`24h`** (`JWT_EXPIRY = process.env.HUB_JWT_EXPIRY \|\| '24h'`). Native access is hardcoded **15m**. Self-hosted Hub defaults **`1h`**. Treat 15m as either deployment override of `HUB_JWT_EXPIRY` or a different token class — verify production env before changing defaults. |

---

## 2. Verdict (1 paragraph)

**This is a missing product surface, not user error.** Aaron followed the documented power-user path (Settings → Integrations → Copy Hub URL, token & vault → Bearer / `.env`). That path is designed for short interactive sessions and scripts that can re-copy; it has no refresh delivery outside the browser cookie jar. Always-on remote agents need either (1) an OAuth client that stores and rotates refresh tokens, or (2) a first-class **agent credential** with revoke/scope/rotation. Lengthening `HUB_JWT_EXPIRY` alone is rejected as the sole fix: it widens the blast radius of `/data/.env` theft without revoke or scope. Marketing claims that imply “agents connect easily” for cloud co-founders are ahead of the durable auth story; reword now, build the connect flow next.

---

## 3. Personas — shipped vs promised

| Persona | Shipped durable auth | Documented / promised | Gap |
| --- | --- | --- | --- |
| **(a) Desktop Cursor / Claude** | Hosted MCP OAuth Sign-in (discovery + PKCE) **or** Bearer paste (expires); local stdio MCP with vault path | Landing + `AGENT-INTEGRATION.md` | Paste path still over-taught vs OAuth; OAuth refresh durability weak (in-memory MCP refresh) |
| **(b) Headless always-on (Hermes VPS/Hostinger)** | **None durable.** Static JWT paste expires; health without vault auth succeeds | Landing ecosystem / “add agents” language; Hermes **import** tile | **Primary gap.** Need MCP OAuth (Hermes-capable) + durable refresh and/or device-connect UX |
| **(c) Paperclip / orchestrator** | Bearer JWT in env/secrets; ops must rotate | Smoke scripts use `KNOWTATION_HUB_TOKEN` | Needs agent credential or refresh-capable secret store; no Knowtation-side SSM pattern found in this workspace’s Paperclip tree |
| **(d) Local CLI vault** | `KNOWTATION_VAULT_PATH` — no Hub JWT | `AGENT-INTEGRATION.md` §1 | Shipped. Not hosted SoT unless sync/propose added |

---

## 4. Claims audit — overstatement + honest copy

| Surface | Quote / paraphrase (current) | Problem | Honest copy (proposed) |
| --- | --- | --- | --- |
| `web/index.html` hero | “One place for you and your agents.” | Implies any agent can stay connected | “One place for you and your agents — desktop MCP sign-in today; cloud agents via Connect agent (shipping).” |
| `web/index.html` band | “Add agents” / MCP common path in Cursor | Undersells headless limits | “Desktop: MCP OAuth in Cursor/Claude. Cloud agents: use Connect agent or MCP OAuth with refresh — not a pasted Hub JWT.” |
| `web/index.html` | “Hosted MCP adds OAuth-gated access aligned with Hub roles.” | True for MCP OAuth clients; users still taught JWT paste | Keep OAuth claim; add: “Do not put Copy-Hub JWTs in always-on server `.env` files.” |
| Hermes tile | “Hermes Agent — Agent memory + profile” under imports | Easy to misread as connect | Rename caption: “Import Hermes memory/profile into vault” (not “connect Hermes”). |
| Hub Integrations | Copy button as “key card” for tools outside the browser | Correct for short-lived tools; fails for always-on | Split UI: **Session token (expires)** vs **Connect cloud agent** (refreshable). |
| `docs/AGENT-INTEGRATION.md` | Re-copy on 401 | Accurate but positions babysitting as normal | Keep for session tokens; point always-on agents to Connect agent / MCP OAuth. |
| `docs/HUB-API.md` §1.1 | “There is no API-key-only path.” | Blocks agent credentials until we deliberately amend | Amend when Phase C ships: “No unscoped API keys; scoped agent credentials are the machine path.” |

---

## 5. Recommended end-state architecture

### Primary (freeze)

**Hosted MCP OAuth 2.1 + durable refresh**, consumed by agents that speak MCP OAuth (Hermes: `auth: oauth` → `https://mcp.knowtation.store/mcp`).

Hardening required before this is “consumer durable”:

1. Persist MCP client registrations + refresh tokens by **wiring `KnowtationOAuthProvider` into the existing `createGatewayRefreshStore()` / `refresh-token-core`** already used by native OAuth (`server.mjs:355,670`). **Do not build a second store** — reuse the audited one (hash-at-rest, rotation, reuse→family revoke).
2. Align refresh lifetime with native/web policy (target: **~30d inactivity**, **~90d family cap** — the `DEFAULT_TOKEN_TTL_MS` / `DEFAULT_FAMILY_TTL_MS` constants already in `hub/lib/refresh-token-core.mjs`).
3. **Strong consistency is mandatory for MCP refresh.** The store MUST be file/DB-backed on the persistent MCP host; it **MUST NOT** use the eventual-consistency Netlify blob path (`refresh-token-store.mjs` documents a ≤60s reuse-detection lag on blob). MCP OAuth already mounts only on the persistent host (`server.mjs:629`), so the file backend applies — freeze it explicitly.
4. Document Hermes config + headless paste-back / SSH forward; **spike** Hostinger Managed Hermes version for OAuth support (hard gate — see Roadmap Phase A: if unsupported, device code becomes primary).
5. Hub UI: “Connect cloud agent (MCP)” checklist that points at `KNOWTATION_MCP_URL`, not Netlify `/mcp`.

### Fallback (freeze)

**Hub “Connect agent” device authorization (RFC 8628) and/or scoped agent credentials** for:

- hosts that cannot complete loopback/paste-back OAuth,
- REST-only runners (cron, Paperclip, curl),
- propose-only marketing bots.

Agent credential invariants (non-negotiable):

- Bound to `sub` + vault id(s) + role/scopes (`vault:read` / `vault:write` / `propose` ceiling).
- Shown **once** at mint; stored hashed; list + revoke in Hub.
- Rotatable; default TTL with hard max; audit events; never god-admin by default.
- Amends “no API-key-only path” to “no unscoped long-lived keys.”

### Explicitly not primary

| Option | Why not primary |
| --- | --- |
| Lengthen `HUB_JWT_EXPIRY` only | No revoke/scope/rotation; `/data/.env` theft = full session until expiry |
| Companion native OAuth | Loopback-only; not Hostinger |
| Vault-local CLI on agent host | Fine offline; does not keep **hosted** vault as live SoT without sync |
| Human-mediated sync only | Valid **interim**, not end-state product |

---

## 6. Options ranking (security × UX)

| Rank | Option | Security | UX for (b) | Notes |
| --- | --- | --- | --- | --- |
| 1 | MCP OAuth 2.1 + durable refresh inside Hermes | High if refresh hashed + rotatable | High if Hermes version supports `auth: oauth` | **Spike required** on Hostinger build; paste-back documented by Hermes |
| 2 | Device authorization / Hub “Connect agent” code | High (user confirms in Hub; short device codes) | Highest for non-SSH users | Best “one Hub flow” product; may mint MCP or agent refresh |
| 3 | Long-lived **scoped agent credential** | Medium–High with revoke/scope/rotation | High for REST; still a secret in `.env` | Despite today’s “no API-key path”; required for Paperclip-class runners |
| 4 | Companion-style native OAuth | High on device | **Fails** on Hostinger (no trusted loopback to user browser) | Keep for companion |
| 5 | Vault-local + sync to hosted | High local | Medium | Sync/propose still needs auth |
| 6 | Human-mediated (agent local → Cursor promotes) | High (human gate) | Low automation | **Interim only** |

---

## 7. Refresh token delivery threat model

**Question:** Can we issue refresh (or agent credential) to a remote agent without HttpOnly cookies?

**Answer:** Yes — that is exactly what native OAuth already does (refresh in **response body**, OS keychain on companion). Remote agents store secrets on disk (`.env`, `~/.hermes/mcp-tokens/`). Cookies are a browser delivery mechanism, not a security requirement for machine clients.

| Threat | Mitigation (required) |
| --- | --- |
| Theft from `/data/.env` or Hostinger shared CLI | Scoped credential; short access TTL; refresh rotation; Hub revoke; no admin scope by default |
| Telegram / chat paste of secrets | Hub UI warns; prefer device-code display of user code only (not refresh secret); never log tokens |
| Refresh replay after theft | `refresh-token-core` reuse detection → revoke family |
| Gateway restart wiping MCP OAuth | Persist store (Phase A) |
| Confused deputy / over-scope | Path/prefix + propose-only scopes (Phase D); role ceiling like native C6 |
| Netlify MCP confusion | Keep MCP on `mcp.knowtation.store`; never teach Netlify `/mcp` |

**Do not** put web-session refresh cookies into agent `.env`. Issue **agent-class** refresh or MCP refresh only.

---

## 8. MCP URL vs REST for always-on agents

| Path | When |
| --- | --- |
| **MCP** `https://mcp.knowtation.store/mcp` | Interactive tools, Hermes/Cursor with OAuth, prompts/resources |
| **REST** `https://api.knowtation.store` | Batch writes, scripts, Paperclip, when MCP session state is undesirable |

Both need durable auth. Prefer MCP OAuth for Hermes; prefer agent credential for REST-only.

**Confused deputy is a live scope-elevation, not just an audience collision.** `mcp_access` JWTs are signed with the same `SESSION_SECRET`; REST `verifyToken` (`server.mjs:221-228`) returns **only `sub`**, and downstream authz re-derives privileges via `roleForSub(sub)`→`scopesForRole` — it **never reads the token's `scopes`**. Consequence today: a `vault:read`-only `mcp_access` token performs **full read/write** over REST. This directly nullifies the Phase D “propose-only” promise.

Freeze:
- **Phase A:** shared `SESSION_SECRET` verification stays, **but** add scope-aware REST verification tests proving an `mcp_access` token cannot exceed its minted scope. (Closing the enforcement gap may land in A or the earliest phase that mints a reduced-scope token.)
- **Do NOT advertise Phase D propose-only / path-prefix scopes until scope-aware REST enforcement is closed** — otherwise a reduced-scope agent token silently writes.
- **Phase C** may add `typ`/`aud` separation (RFC 8707 resource indicators) when agent credentials mint separately.

---

## 9. Scopes / roles for Born Free marketing agents

| Need | Recommendation |
| --- | --- |
| Read research / drafts under `projects/born-free/**` | `vault:read` + optional path prefix |
| Write drafts | Prefer **`propose` only** (Hub review) for co-founder agents; direct `write` only if owner opts in |
| Index / import / admin | Denied for agent credentials |
| Role mapping | Start from Hub `viewer` / `editor` / `evaluator` ACL (`mcp-tool-acl.mjs`); add **propose-only** agent mode that exposes `hub_create_proposal` without direct `write` |

---

## 10. Migration message (existing Copy-Hub → `.env` users)

1. **Session tokens** remain for curl, one-off scripts, smoke tests — expect expiry; re-copy or use Hub UI.
2. **Always-on agents:** migrate to MCP OAuth (`auth: oauth`) or Connect agent / agent credential when shipped.
3. Hub Settings copy text: label paste as **“Session access token (expires)”**, not “API key.”
4. Do not silently extend paste JWT lifetime as the migration.

---

## 11. Doc / marketing edits list (when approved)

1. `web/index.html` — clarify Hermes import tile; soften “add agents” for cloud; mention Connect agent roadmap.
2. `web/hub/index.html` + `onboarding-wizard.mjs` — split session token vs cloud agent connect.
3. `docs/AGENT-INTEGRATION.md` — always-on section; ban `.env` JWT as durable path; Hermes MCP OAuth recipe pointing at `mcp.knowtation.store`.
4. `docs/HUB-API.md` §1 — amend when agent credentials ship.
5. `docs/PARITY-MATRIX-HOSTED.md` — auth row: OAuth durable vs Bearer session.
6. Landing meta description — optional: “desktop MCP OAuth; cloud agent connect.”

*(Docs-only PR to `main` is forbidden by owner policy; ship copy with the Build PR that implements Connect agent / Phase A.)*

---

## 12. Interim Born Free runbook (≤10 lines)

1. **Do not** rely on `KNOWTATION_HUB_TOKEN` from Copy Hub in Hostinger `/data/.env` for vault writes — it will 401.
2. Point Hermes MCP at **`https://mcp.knowtation.store/mcp`**, not the Netlify gateway `/mcp`.
3. If Hostinger Hermes supports MCP OAuth: set `auth: oauth`, run headless paste-back once; treat as **interim** until durable MCP refresh ships (in-memory refresh today).
4. Else: Hermes writes drafts to Sheet/local; promote into Knowtation via **Cursor hosted MCP OAuth** or Hub UI / proposals (Knowtation stays SoT).
5. Prefer **propose** over direct write for co-founder drafts.
6. Re-auth when MCP tools 401; do not lengthen JWT “for now” as the plan.
7. Track end-state on `docs/DURABLE-AGENT-AUTH-ROADMAP.md` Phase A+.

---

## 13. Evidence index (files read)

- `docs/AGENT-INTEGRATION.md`, `docs/HUB-API.md`, `docs/PARITY-MATRIX-HOSTED.md`
- `docs/COMPANION-APP-DESIGN-AND-AUTHORIZATION-GATE.md`, `docs/PHASE-8-P1B-OFFLINE-LOCKED-AUTH-SPEC.md` §8
- `web/hub/hub.js` (`refreshAccessToken`, `btn-copy-hub-api-env`), `web/hub/config.js`, `web/index.html`
- `hub/gateway/server.mjs`, `mcp-oauth-provider.mjs`, `native-oauth-provider.mjs`, `mcp-tool-acl.mjs`
- `hub/lib/refresh-token-core.mjs`
- External: Hermes MCP docs (`auth: oauth`, headless paste-back) — spike still required on Hostinger build

---

## 14. Offline-lock interaction (Phase 8)

**Verified:** MCP OAuth **and** native OAuth endpoints mount only when `!offlineLockedActive` (`hub/gateway/server.mjs:629`). Under Phase-8 offline-locked mode, **there is no durable remote-agent auth path at all** — the discovery/token/refresh endpoints are not mounted.

Freeze:
- Phase A DoD MUST **explicitly document** that durable agent auth is **unsupported while offline-locked** (a stated, tested behavior — not a silent absence).
- This is expected and acceptable: offline-locked is a local-only security posture; always-on cloud agents are out of scope in that mode.
- Do not attempt to “fix” this by mounting agent-auth endpoints under offline-lock without a separate Thinking freeze — it would widen the offline-locked trust boundary.
