# Hosted vs self-hosted parity plan

This document lists **everything** needed to bring the **hosted** product (gateway + canister + bridge) to parity with **self-hosted** (Node Hub) so the same Hub UI works on both paths. Work is split into phases; implement in order before starting Phase 15 (multi-vault) or full deploy.

**Reference:** [IMPLEMENTATION-PLAN.md](./IMPLEMENTATION-PLAN.md) (build status, Phase 11/13/14), [HUB-API.md](./HUB-API.md) (API contract), [STATUS-HOSTED-AND-PLANS.md](./STATUS-HOSTED-AND-PLANS.md) (canister/deploy), [DEPLOY-HOSTED.md](./DEPLOY-HOSTED.md) (deploy steps).

---

## Current state (before parity work)

### Self-hosted (Node Hub — `hub/server.mjs`)

| Area | Endpoints / behavior | Status |
|------|----------------------|--------|
| Auth | OAuth (Google/GitHub), JWT, login/callback | ✅ |
| Health | GET /health, GET /api/v1/health | ✅ |
| Auth providers | GET /api/v1/auth/providers | ✅ |
| Notes | GET/POST /api/v1/notes, GET /api/v1/notes/:path, GET /api/v1/notes/facets | ✅ |
| Search | POST /api/v1/search | ✅ |
| Index | POST /api/v1/index | ✅ |
| Export | POST /api/v1/export | ✅ |
| Import | POST /api/v1/import | ✅ |
| Proposals | GET/POST /api/v1/proposals, GET /api/v1/proposals/:id, approve, discard | ✅ |
| Settings | GET /api/v1/settings | ✅ |
| Setup | GET /api/v1/setup, POST /api/v1/setup | ✅ |
| Vault/sync | POST /api/v1/vault/sync | ✅ |
| GitHub connect | GET /api/v1/auth/github-connect, callback; vault/github-status | ✅ |
| Roles | GET /api/v1/roles, POST /api/v1/roles | ✅ |
| Invites | GET /api/v1/invites, POST /api/v1/invites, DELETE /api/v1/invites/:token | ✅ |

### Hosted (gateway → canister / bridge)

| Area | Handled by | Status |
|------|------------|--------|
| Auth | Gateway (OAuth, JWT) | ✅ |
| Health | Gateway (local) | ✅ |
| Auth providers | Gateway (local) | ✅ |
| Notes, proposals, export | Canister (proxy) | ✅ |
| Search, index | Bridge (proxy from gateway) | ✅ |
| Vault/sync, github-status | Bridge (proxy from gateway) | ✅ |
| Settings | Gateway **stub** (GET only) | ✅ |
| Setup | Gateway **stub** (GET only) | ✅ |
| **Roles** | Canister (not implemented) → **404** | ❌ |
| **Invites** | Canister (not implemented) → **404** | ❌ |
| **POST /api/v1/setup** | Canister (not implemented) → **404** | ❌ |
| Import | Canister (not implemented) → **404** | ❌ |

The Hub UI calls roles, invites, and POST setup from Settings → Team and Settings → Setup. On hosted, those requests are proxied to the canister and return 404, so Team tab and “Save setup” break without parity work.

---

## Phase 1 — API parity (gateway stubs)

**Goal:** Register routes in the **gateway** for every endpoint the canister does not implement, so the Hub UI receives valid responses and does not 404. No canister changes in this phase.

**Where:** `hub/gateway/server.mjs`. Add handlers **before** `app.use('/api/v1', proxyToCanister)` so these routes are never proxied to the canister.

### 1.1 Roles

| Method | Path | Self-hosted behavior | Hosted (stub) response |
|--------|------|----------------------|-------------------------|
| GET | /api/v1/roles | Returns `{ "roles": [ { "user_id", "role" }, ... ] }` from `data/hub_roles.json`. | 200, body `{ "roles": [] }`. Optionally: return single entry for current user as `member` so “Your role” in Settings shows something. |
| POST | /api/v1/roles | Body `{ "user_id", "role" }`; writes to hub_roles.json. | 200, body `{ "ok": true }` (no-op), or 400 with message that role assignment is not supported on hosted (if we want to be explicit). |

**Auth:** Require JWT (same as proxy). For GET, 401 if no token. For POST, stub can accept and succeed or return “not supported.”

### 1.2 Invites

| Method | Path | Self-hosted behavior | Hosted (stub) response |
|--------|------|----------------------|-------------------------|
| GET | /api/v1/invites | Returns `{ "invites": [ { "token", "role", "created_at" }, ... ] }`. | 200, body `{ "invites": [] }`. |
| POST | /api/v1/invites | Body `{ "role" }`; creates invite link, returns `{ "invite_url", "token", "role" }`. | 200, body e.g. `{ "invite_url": "", "token": "", "role": "<requested>" }` with a message in UI, or 400/403 with `{ "error": "Invites are not supported on hosted", "code": "NOT_SUPPORTED" }` so UI can show a friendly message. |
| DELETE | /api/v1/invites/:token | Revokes invite. | 200, body `{ "ok": true }` (no-op). |

**Auth:** Require JWT. 401 if no token.

### 1.3 Setup (POST only)

| Method | Path | Self-hosted behavior | Hosted (stub) response |
|--------|------|----------------------|-------------------------|
| GET | /api/v1/setup | Already stubbed in gateway (returns vault_path: "", vault_git: { enabled: false, remote: "" }). | No change. |
| POST | /api/v1/setup | Body `{ vault_path?, vault_git? }`; writes hub_setup.yaml, reloads config. | 200, body `{ "ok": true }` (no-op; hosted vault is canister, no local setup to persist). |

**Auth:** Require JWT. 401 if no token.

### 1.4 Import (optional in Phase 1)

| Method | Path | Self-hosted behavior | Hosted (stub) response |
|--------|------|----------------------|-------------------------|
| POST | /api/v1/import | Multipart: source_type, file; optional project, tags. Runs import, returns `{ "imported": [...], "count": n }`. | Canister does not implement. Options: (A) Gateway returns 501 with message “Import not yet available on hosted,” or (B) Gateway proxies to bridge if bridge can pull from canister, run import, push back (larger scope). For Phase 1, (A) is sufficient so UI doesn’t 404; document as known gap. |

**Recommendation:** In Phase 1, add a single gateway route `POST /api/v1/import` that returns 501 and JSON `{ "error": "Import is not yet available on hosted", "code": "NOT_AVAILABLE" }` so the UI can show a clear message. Full import-on-hosted can be a later phase.

### 1.5 Checklist (Phase 1)

- [x] GET /api/v1/roles — 200, `{ "roles": [] }` (or current user as member).
- [x] POST /api/v1/roles — 200 no-op or 400 “not supported.”
- [x] GET /api/v1/invites — 200, `{ "invites": [] }`.
- [x] POST /api/v1/invites — 200 with stub body or 400/501 with clear error for UI.
- [x] DELETE /api/v1/invites/:token — 200 no-op.
- [x] POST /api/v1/setup — 200 no-op.
- [x] POST /api/v1/import — 501 with clear error (or defer to later phase).
- [x] All above require JWT; 401 when missing.
- [x] Update PARITY-PLAN and IMPLEMENTATION-PLAN when Phase 1 is done.

---

## Phase 2 — Deploy hosted

**Goal:** Get the full stack live so users can use “Use in the cloud (beta)” at knowtation.store/hub/.

**Prerequisite:** Phase 1 complete so Settings → Team and Setup don’t 404.

**Reference:** [DEPLOY-HOSTED.md](./DEPLOY-HOSTED.md), [CANISTER-AND-SINGLE-URL.md](./CANISTER-AND-SINGLE-URL.md), [STATUS-HOSTED-AND-PLANS.md](./STATUS-HOSTED-AND-PLANS.md).

### 2.1 Checklist (Phase 2)

- [ ] **Canister:** `dfx deploy` (local or `--network ic`). Set `CANISTER_URL` in gateway and bridge env.
- [ ] **Web (landing + Hub UI):** Deploy `web/` to 4Everland (or equivalent). Custom domain knowtation.store; `/` = landing, `/hub/` = Hub.
- [ ] **Hub UI API base:** Set `window.HUB_API_BASE_URL` (e.g. `https://knowtation.store`) so Hub at `/hub/` calls the gateway.
- [ ] **Gateway:** Deploy to Netlify (or Node host). Env: CANISTER_URL, SESSION_SECRET, HUB_BASE_URL, HUB_UI_ORIGIN, BRIDGE_URL (if separate), OAuth client IDs/secrets, callback URLs.
- [ ] **Bridge:** Deploy (same host as gateway or separate). Env: CANISTER_URL, GitHub OAuth for Connect GitHub, embedding config, DATA_DIR. Gateway proxies /api/v1/vault/sync, /api/v1/vault/github-status, /api/v1/search, /api/v1/index to bridge.
- [ ] **DNS:** knowtation.store points to 4Everland (and gateway/bridge hosts if different).
- [ ] **Pre-roll:** Canister GET /health ok; OAuth callbacks registered; no secrets in repo/client.

---

## Phase 3 — Multi-vault (Phase 15)

**Goal:** Support multiple vaults per Hub (or scoped visibility) so hosted can match self-hosted “multiple vaults” story when we add it.

**Prerequisite:** Phase 1 and 2 done (parity + deploy). Design and dependency: [MULTI-VAULT-AND-SCOPED-ACCESS.md](./MULTI-VAULT-AND-SCOPED-ACCESS.md), Phase 15 in IMPLEMENTATION-PLAN.

### 3.1 Scope (summary)

- Choose direction: multiple vaults per instance (vault list in config/setup) or one vault with scoped visibility (project/folder allowlists per user/role).
- Backend: config/setup vault list or scope rules; API and canister scope list/search/get-note by vault or scope; gateway and canister honor `vault_id` beyond default.
- Hub UI: vault switcher or scope hint; Settings/Team: assign vault(s) or scope if applicable.
- CLI/MCP (optional): `--vault <id>` or equivalent.

### 3.2 Checklist (Phase 3)

- [ ] Direction documented in IMPLEMENTATION-PLAN and MULTI-VAULT-AND-SCOPED-ACCESS.
- [ ] Config/setup: vault list or scope rules.
- [ ] Backend (Node Hub and canister): scope list, search, get-note by vault_id/scope.
- [ ] Gateway: pass X-Vault-Id through; optional gateway-side vault list for hosted.
- [ ] Hub UI: vault switcher or “This view: vault X”.
- [ ] Update STATUS-HOSTED-AND-PLANS and PARITY-PLAN when done.

---

## Phase 4 — Optional: full hosted roles/invites (later)

**Goal:** If we want real team behavior on hosted (assign roles, invite by link that adds user to a hosted role store), implement roles and invites in the **canister** or in a **gateway-backed store** (e.g. DB or file store behind gateway), and remove or replace the Phase 1 stubs.

**When:** After Phase 2 (deploy) when we prioritize “team vault” on hosted. Not required for parity of “same UI works”; Phase 1 stubs are enough for that.

### 4.1 Checklist (Phase 4, when implemented)

- [ ] Canister (or gateway store): persist roles (user_id → role); persist pending invites (token, role, created_at).
- [ ] GET/POST /api/v1/roles and GET/POST/DELETE /api/v1/invites implemented in canister or gateway with real persistence.
- [ ] Gateway routes for roles/invites either proxy to canister or read/write gateway store; remove stub responses.
- [ ] Document in HUB-API and PARITY-PLAN.

---

## Summary: phase order

| Phase | What | When |
|-------|------|------|
| **1** | API parity (gateway stubs: roles, invites, POST setup, optional import 501) | **Done.** Implemented in hub/gateway/server.mjs. |
| **2** | Deploy hosted (canister, 4Everland, gateway, bridge, DNS) | **Next.** After Phase 1. |
| **3** | Multi-vault (Phase 15) | After Phase 2; per MULTI-VAULT-AND-SCOPED-ACCESS. |
| **4** | Full hosted roles/invites (canister or gateway store) | Optional; when we want real team behavior on hosted. |

**Do not start implementation** of Phase 1 until this plan (and IMPLEMENTATION-PLAN updates) are agreed. After Phase 1 is implemented, update this doc and IMPLEMENTATION-PLAN to mark parity complete and “Next” as Phase 2 (deploy).
