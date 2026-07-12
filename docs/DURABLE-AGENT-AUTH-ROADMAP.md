# Durable agent auth — roadmap

**Spec freeze:** [`DURABLE-AGENT-AUTH-SPEC.md`](./DURABLE-AGENT-AUTH-SPEC.md) (2026-07-12)  
**Branch (thinking):** `feat/durable-agent-mcp-auth-thinking`  
**Owner approval required** before any Build phase marked Auto starts.

## Phase routing

| Phase | Name | Mode | Status |
| --- | --- | --- | --- |
| 0 | Thinking freeze (this track) | Thinking | **DONE** (pending Aaron approve) |
| A | Durable MCP OAuth refresh + Hermes spike | Thinking spike → **Auto** Build | TODO |
| B | Hub “Connect cloud agent” UX (device code and/or guided MCP OAuth) | Thinking (UX freeze) → **Auto** | TODO |
| C | Scoped agent credentials (REST) + revoke | Thinking (token shape) → **Auto** | TODO |
| D | Propose-only / path-prefix scopes for marketing agents | Thinking → **Auto** | TODO |
| E | Marketing + docs honest positioning (with code PR) | **Auto** (with A/B/C) | TODO |

Never Outline/Plan on Auto. Never mark DONE without green required tests.

---

## Phase 0 — Thinking freeze

**DoD:** Spec answers all design questions; recommendation + interim labeled; Build-ready Phase A prompt in OVERSEER handover.  
**Status:** DONE pending Aaron approval of Spec §2 + §5.

---

## Phase A — Durable MCP OAuth refresh + Hermes spike

**Mode:** Spike (Thinking, short) then **Auto** Build against frozen interfaces below.

### Spike (HARD GATE — must complete before Build claims Hermes)

- Confirm Hostinger Managed Hermes version supports `mcp_servers.*.auth: oauth`, token cache path, headless paste-back.
- Record: works / partial / missing.
- **Pre-frozen contingency (no re-freeze required):** if the spike is anything but a clean pass, **Rank 1 ↔ Rank 2 swap** — Phase B device authorization (RFC 8628) becomes the **primary** and critical path, and durable MCP OAuth refresh (this phase) drops to fallback. A headless VPS without reliable loopback is the canonical RFC 8628 use case.

### Frozen interfaces (Build)

1. **Reuse the existing store — do NOT build a new one.** Wire `KnowtationOAuthProvider` into `createGatewayRefreshStore()` (`hub/gateway/refresh-token-store.mjs`), the same durable store already consumed by native OAuth (`server.mjs:355,670`). It already provides hash-at-rest, rotation, and reuse→family revoke via `refresh-token-core`.
2. **Strong consistency required; Netlify blob backend prohibited for MCP refresh.** The store must be file/DB-backed on the persistent MCP host (`server.mjs:629` already restricts MCP OAuth to that host). The eventual-consistency blob path (≤60s reuse-detection lag, per `refresh-token-store.mjs`) is not acceptable for MCP.
3. Lifetimes (freeze unless spike finds Hermes incompatibility):
   - access: ≤ 1h (keep ~3600s or align to gateway access TTL)
   - refresh inactivity: **30d** (`DEFAULT_TOKEN_TTL_MS`)
   - family absolute: **90d** (`DEFAULT_FAMILY_TTL_MS`)
4. Discovery + token endpoints remain MCP OAuth 2.1 compatible (Hermes / Cursor); do not break Cursor OAuth Sign-in.
5. Public URL remains `HUB_MCP_PUBLIC_URL` / `https://mcp.knowtation.store/mcp`.
6. **Record shape:** add an agent label/name field to the refresh record `meta` (today `refresh-token-core` `meta` only keeps `ua`/`ip`) so the revoke list can distinguish multiple Hermes instances per user (§A9).
7. **Offline-lock:** durable agent auth is unmounted under `offlineLockedActive` (`server.mjs:629`). Document as unsupported-under-offline-lock; do not mount agent-auth endpoints in that mode.

### DoD

- Gateway restart does not invalidate unexpired MCP refresh families.
- Unit + integration + security **+ data-integrity + security-stress** tests for rotate/reuse/revoke (this is a credential surface — Aaron RULE #0; do not defer integrity/stress to a later phase).
- Scope-aware REST verification test: an `mcp_access` token cannot exceed its minted scope on REST (§8 confused-deputy guard).
- Offline-lock behavior documented + asserted (agent-auth endpoints unmounted).
- Hermes spike notes checked into `docs/evidence/durable-agent-auth/` (no secrets).
- Docs delta for always-on MCP OAuth **in the same PR** as code.

### Test tiers (minimum for Phase A)

| Tier | Focus |
| --- | --- |
| unit | `refresh-token-core` integration with MCP provider; TTL math; hash-at-rest |
| integration | authorize → token → refresh → tool call; restart → refresh still works; **offline-lock → endpoints unmounted** |
| e2e | scripted OAuth client against local gateway fixture |
| security | no secrets in logs; reuse revokes family; revoked refresh rejected; **`mcp_access` scope not exceeded on REST** |
| data-integrity | concurrent refresh (no double-spend / lost rotation); corrupt store → fail-closed (`normalizeRecords`) |
| security-stress | refresh storm / family churn does not degrade reuse detection or leak |

(Broad performance benchmarking may follow in A2, but functional latency under the `validate:false` rate-limit config — `server.mjs:641` — should be sanity-checked in Phase A.)

---

## Phase B — Hub “Connect cloud agent”

**Mode:** Thinking (wireframes + device-code vs guided OAuth) → Auto.

### Frozen product goal

A non-SSH user completes “connect my cloud agent to my vault” in **one Hub flow** (device code preferred when loopback impossible).

### DoD

- Settings → Integrations → **Connect cloud agent**
- Issues user_code / verification URL **or** deep-links Hermes MCP OAuth steps
- Agent ends with refreshable credential (MCP and/or agent refresh)
- Revoke from same panel
- Docs + Hub copy updated in same PR

### Test tiers

unit (device code store), integration (poll → token), e2e (Hub UI happy path), security (code brute-force limits, single-use).

---

## Phase C — Scoped agent credentials (REST)

**Mode:** Thinking (JWT/`kt_agent_` prefix shape, OpenAPI) → Auto.

### Frozen invariants

- Scoped, rotatable, vault-bound, Hub-revocable
- Default: no admin; prefer propose-only option
- Amends `HUB-API.md` “no API-key-only path”

### DoD

- Mint once + list + revoke APIs + Hub UI
- REST accepts credential; MCP optional bridge
- Seven-tier tests for credential module (Aaron standard)

---

## Phase D — Propose-only + path prefix

**Mode:** Thinking → Auto.

- Agent may create proposals under `projects/<slug>/**` without direct `POST /notes`
- Enforce in gateway + MCP ACL
- **Hard dependency:** the §8 confused-deputy scope-elevation (REST ignores token `scopes`) MUST be closed first. Do not advertise or ship propose-only / path-prefix scopes while a reduced-scope token can still write over REST.

---

## Phase E — Marketing honesty

Ship with whichever of A/B/C lands first that changes the user-visible connect story. No docs-only PR to `main`.

---

## Build status table

| Phase | Status | Notes |
| --- | --- | --- |
| 0 Thinking freeze | WIP → DONE on Aaron approve | Spec + this roadmap |
| A Durable MCP OAuth | TODO | First Build |
| B Connect agent UX | TODO | |
| C Agent credentials | TODO | |
| D Propose-only scopes | TODO | |
| E Marketing/docs | TODO | With code PR |
