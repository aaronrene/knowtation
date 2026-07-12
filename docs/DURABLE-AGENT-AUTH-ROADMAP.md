# Durable agent auth — roadmap

**Spec freeze:** [`DURABLE-AGENT-AUTH-SPEC.md`](./DURABLE-AGENT-AUTH-SPEC.md) (2026-07-12)  
**Branch (thinking):** `feat/durable-agent-mcp-auth-thinking`  
**Branch (Phase A build):** `feat/durable-mcp-oauth-refresh`  
**Owner approval required** before any Build phase marked Auto starts.

## Phase routing

| Phase | Name | Mode | Status |
| --- | --- | --- | --- |
| 0 | Thinking freeze (this track) | Thinking | **DONE** |
| A | Durable MCP OAuth refresh + Hermes spike | Thinking spike → **Auto** Build | **DONE** (tests green; Rank 1↔2 swap after spike) |
| B | Hub “Connect cloud agent” UX (device code **primary** after spike) | Thinking (UX freeze) → **Auto** | TODO |
| C | Scoped agent credentials (REST) + revoke | Thinking (token shape) → **Auto** | TODO |
| D | Propose-only / path-prefix scopes for marketing agents | Thinking → **Auto** | TODO |
| E | Marketing + docs honest positioning (with code PR) | **Auto** (with A/B/C) | TODO |

Never Outline/Plan on Auto. Never mark DONE without green required tests.

---

## Phase 0 — Thinking freeze

**DoD:** Spec answers all design questions; recommendation + interim labeled; Build-ready Phase A prompt in OVERSEER handover.  
**Status:** DONE.

---

## Phase A — Durable MCP OAuth refresh + Hermes spike

**Mode:** Spike (Thinking, short) then **Auto** Build against frozen interfaces below.  
**Status:** **DONE** (2026-07-12).

### Spike (HARD GATE — completed)

- Upstream Hermes: `auth: oauth`, token cache, headless paste-back — **supported** (docs + PR #5420).
- Hostinger Managed Hermes version: **unverified** this session → spike verdict **partial**.
- **Rank 1 ↔ Rank 2 swap applied:** Phase B device authorization is **primary** for headless Hostinger; Phase A durable MCP OAuth remains shipped for Cursor + OAuth-capable Hermes.
- Evidence: [`docs/evidence/durable-agent-auth/hermes-oauth-spike-2026-07-12.md`](./evidence/durable-agent-auth/hermes-oauth-spike-2026-07-12.md).

### Frozen interfaces (Build) — implemented

1. **Reuse existing store** — `KnowtationOAuthProvider` takes `createGatewayRefreshStore({ consistency: 'strong' })` (same instance as native OAuth on persistent host).
2. **Strong consistency** — file backend; blob prohibited for MCP (and for non-Netlify gateway refresh store).
3. Lifetimes: access 3600s; refresh `DEFAULT_TOKEN_TTL_MS` (30d); family `DEFAULT_FAMILY_TTL_MS` (90d).
4. MCP OAuth 2.1 discovery/token unchanged for Cursor Sign-in.
5. Public URL `https://mcp.knowtation.store/mcp`.
6. Refresh `meta.agent` (+ `client_id` / `scopes`) for multi-Hermes revoke.
7. Offline-lock: `shouldMountDurableAgentAuth` — endpoints unmounted; documented.

### DoD checklist

- [x] Gateway restart does not invalidate unexpired MCP refresh families (integration test).
- [x] Unit + integration + e2e + security + data-integrity + security-stress tests.
- [x] Scope-aware REST: `mcp_access` `vault:read` cannot write (`access-token-authz` + `getUserId`).
- [x] Offline-lock documented + asserted.
- [x] Hermes spike notes (no secrets).
- [x] `docs/AGENT-INTEGRATION.md` always-on section in same PR as code.

### Test tiers

| Tier | File(s) |
| --- | --- |
| unit | `test/durable-mcp-oauth-unit.test.mjs` |
| integration | `test/durable-mcp-oauth-integration.test.mjs` |
| e2e | `test/durable-mcp-oauth-e2e.test.mjs` |
| security | `test/durable-mcp-oauth-security.test.mjs` |
| data-integrity | `test/durable-mcp-oauth-data-integrity.test.mjs` |
| security-stress | `test/durable-mcp-oauth-security-stress.test.mjs` |

---

## Phase B — Hub “Connect cloud agent”

**Mode:** Thinking (wireframes + device-code vs guided OAuth) → Auto.  
**Priority:** **Primary** for headless Hostinger after Phase A spike Rank swap.

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
- **Hard dependency:** §8 confused-deputy scope-elevation closed in Phase A for `mcp_access` on REST mutating methods. Do not advertise propose-only / path-prefix scopes until remaining role-elevation edges (if any) are closed in Thinking freeze for D.

---

## Phase E — Marketing honesty

Ship with whichever of A/B/C lands first that changes the user-visible connect story. No docs-only PR to `main`. Phase A docs ship with this code PR.

---

## Build status table

| Phase | Status | Notes |
| --- | --- | --- |
| 0 Thinking freeze | DONE | Spec + this roadmap |
| A Durable MCP OAuth | **DONE** | Strong store + scope guard + spike partial → Rank swap |
| B Connect agent UX | TODO | **Primary** for Hostinger after swap |
| C Agent credentials | TODO | |
| D Propose-only scopes | TODO | Depends on A scope guard (landed) |
| E Marketing/docs | TODO | With code PR |
