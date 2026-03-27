# Hosted vs self-hosted parity plan

This document lists **everything** needed to bring the **hosted** product (gateway + canister + bridge) to parity with **self-hosted** (Node Hub) so the same Hub UI works on both paths. Work is split into phases; implement in order before starting Phase 15 (multi-vault) or full deploy.

**Product order (2026-03):** **`POST /api/v1/import` on hosted** is **live** when the gateway has **`BRIDGE_URL`** (bridge → canister batch). **Stripe checkout, subscriptions, and billing enforcement** follow per [IMPLEMENTATION-PLAN.md](./IMPLEMENTATION-PLAN.md) strategic sequencing. **Metadata bulk on hosted:** **`POST /notes/delete-by-project`** and **`POST /notes/rename-project`** are implemented on the **gateway** ([`hub/gateway/metadata-bulk-canister.mjs`](../hub/gateway/metadata-bulk-canister.mjs)); self-hosted metadata bulk remains **PR #63**. Design: [HUB-METADATA-BULK-OPS.md](./HUB-METADATA-BULK-OPS.md).

**Reference:** [IMPLEMENTATION-PLAN.md](./IMPLEMENTATION-PLAN.md) (build status, Phase 11/13/14), [HUB-API.md](./HUB-API.md) (API contract), [STATUS-HOSTED-AND-PLANS.md](./STATUS-HOSTED-AND-PLANS.md) (canister/deploy), [DEPLOY-HOSTED.md](./DEPLOY-HOSTED.md) (deploy steps).

**Order of work:** We do **Option B (Muse protocol alignment)** first per [IMPLEMENTATION-PLAN.md](./IMPLEMENTATION-PLAN.md) — document variation protocol and canister extensibility; then Phase 1 (gateway stubs) below.

**Relation to MCP (GitHub Issue #1):** Implement **Hub MCP gateway + OAuth (D2/D3)** only **after** hosted operations are stable (bridge deployed, `BRIDGE_URL`, env verified, pre-roll). Otherwise the MCP proxy may not match production auth and routing. Rationale: [BACKLOG-MCP-SUPERCHARGE.md](./BACKLOG-MCP-SUPERCHARGE.md) § Strategic sequencing.

**What we fixed (Phase 1, merged):** On hosted, the Hub UI used to 404 when opening Settings → Team (roles, invites), clicking Save setup (POST /api/v1/setup), using the filter dropdowns (GET /api/v1/notes/facets), or using Import. The canister does not implement those routes. We **fixed** this by adding **gateway stubs** in `hub/gateway/server.mjs`: each of those requests is now handled by the gateway with a valid response (empty list, no-op, or 501 for import) before the request is ever proxied to the canister. No canister changes; the fix is entirely in the gateway. Option B (Muse protocol alignment) and Muse in How to use were shipped in the same branch.

**After Phase 15.1 (merged to `main`, 2026-03 — PR #46–#48):** Hosted **multi-vault data path** (canister partition by `vault_id`, gateway vault list, bridge index/backup per **`X-Vault-Id`**) and Hub UX (**Settings → Create vault**, **busy** states on slow POSTs) match the checklist in [MULTI-VAULT-AND-SCOPED-ACCESS.md](./MULTI-VAULT-AND-SCOPED-ACCESS.md).

**Team vault access + scope (hosted):** Implemented in repo: bridge stores **`hub_workspace`** (owner id), **`hub_vault_access`**, **`hub_scope`**; gateway proxies **`GET/POST /api/v1/workspace`**, **`vault-access`**, **`scope`**, **`GET /api/v1/hosted-context`** when **`BRIDGE_URL`** is set; gateway sets **`X-User-Id`** to the **effective canister user** and **`X-Actor-Id`** to the JWT `sub`; notes list / single GET / facets apply **scope** in the gateway; index/search/sync on the bridge use the owner partition for delegated users. Spec: [HOSTED-WORKSPACE-ACCESS.md](./HOSTED-WORKSPACE-ACCESS.md). Operators must set **`POST /api/v1/workspace`** `{ owner_user_id }` for team sharing.

**Remaining parity vs self-hosted:** Track in [STATUS-HOSTED-AND-PLANS.md](./STATUS-HOSTED-AND-PLANS.md) and this file’s tables. **Metadata bulk** — done on gateway (same routes as Node); redeploy gateway to enable in production.

---

## Current state (after Phase 1)

### Self-hosted (Node Hub — `hub/server.mjs`)

| Area | Endpoints / behavior | Status |
|------|----------------------|--------|
| Auth | OAuth (Google/GitHub), JWT, login/callback | ✅ |
| Health | GET /health, GET /api/v1/health | ✅ |
| Auth providers | GET /api/v1/auth/providers | ✅ |
| Notes | GET/POST /api/v1/notes, GET /api/v1/notes/:path, DELETE /api/v1/notes/:path, POST /api/v1/notes/delete-by-prefix, POST /api/v1/notes/delete-by-project, POST /api/v1/notes/rename-project, GET /api/v1/notes/facets | ✅ (project-slug bulk on **Node**; hosted uses **gateway** — [HUB-METADATA-BULK-OPS.md](./HUB-METADATA-BULK-OPS.md)) |
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
| Notes (incl. delete-by-prefix), proposals, export | Canister (proxy) | ✅ |
| POST /api/v1/notes/delete-by-project, POST /api/v1/notes/rename-project | Gateway ([`metadata-bulk-canister.mjs`](../hub/gateway/metadata-bulk-canister.mjs)) — orchestrates canister list/delete/write + proposal discard; not Motoko routes | ✅ ([HUB-METADATA-BULK-OPS.md](./HUB-METADATA-BULK-OPS.md)) |
| Notes facets (filter dropdowns) | Gateway stub (GET /api/v1/notes/facets) | ✅ |
| Search, index | Bridge (proxy from gateway) | ✅ |
| Vault/sync, github-status | Bridge (proxy from gateway) | ✅ |
| Settings | Gateway **stub** (GET only) | ✅ |
| Setup | Gateway **stub** (GET only) | ✅ |
| Roles | Gateway → **bridge** when `BRIDGE_URL` set; else stubs (empty / no-op) | ✅ |
| Invites | Gateway → **bridge** when `BRIDGE_URL` set; else stubs | ✅ |
| Workspace owner, vault-access, scope | Bridge persistence; gateway proxy when `BRIDGE_URL` | ✅ (see [HOSTED-WORKSPACE-ACCESS.md](./HOSTED-WORKSPACE-ACCESS.md)) |
| POST /api/v1/setup | Gateway stub (200 no-op) | ✅ |
| Import | Gateway → **bridge** when **`BRIDGE_URL`** set (multipart to bridge → canister batch); **501** when bridge unset | ✅ |

The Hub UI calls roles, invites, and POST setup from Settings → Team and Settings → Setup. With **`BRIDGE_URL`**, roles and invites are **live** on the bridge; without it, gateway stubs apply.

**Multi-vault on hosted:** Canister stores notes keyed by **`(userId, vault_id)`** (Phase 15.1 in repo). Production must match git after deploy — see [MULTI-VAULT-AND-SCOPED-ACCESS.md](./MULTI-VAULT-AND-SCOPED-ACCESS.md) § Hosted and [DEPLOY-HOSTED.md](./DEPLOY-HOSTED.md) §5.1.

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

### 1.5 Facets (filter dropdowns)

| Method | Path | Hosted (stub) response |
|--------|------|-------------------------|
| GET | /api/v1/notes/facets | 200, body `{ "projects": [], "tags": [], "folders": [] }`. |

**Auth:** Require JWT. 401 if no token. Route registered in gateway before the canister proxy.

### 1.6 Checklist (Phase 1)

- [x] GET /api/v1/roles — 200, `{ "roles": [] }` (or current user as member).
- [x] POST /api/v1/roles — 200 no-op or 400 “not supported.”
- [x] GET /api/v1/invites — 200, `{ "invites": [] }`.
- [x] POST /api/v1/invites — 200 with stub body or 400/501 with clear error for UI.
- [x] DELETE /api/v1/invites/:token — 200 no-op.
- [x] POST /api/v1/setup — 200 no-op.
- [x] POST /api/v1/import — 501 with clear error (or defer to later phase).
- [x] GET /api/v1/notes/facets — 200, `{ "projects": [], "tags": [], "folders": [] }`.
- [x] DELETE /api/v1/notes/:path — canister + gateway proxy; editor/admin; 200 `{ "path", "deleted": true }` or 404.
- [x] POST /api/v1/notes/delete-by-prefix — canister + Node Hub; body `{ "path_prefix" }`; 200 `{ "deleted", "paths", "proposals_discarded" }`; editor/admin; gateway billing counts as `note_write` when enforced.
- [x] All above require JWT; 401 when missing.
- [x] **Hosted admin:** Optional env `HUB_ADMIN_USER_IDS` (comma-separated user IDs) on the gateway; users in that list get role **admin** (JWT + GET /api/v1/settings). Roles and invites routes require admin (403 for non-admins). Full Team/invites (persistent role store, invite links) are Phase 2 (see below).
- [x] Update PARITY-PLAN and IMPLEMENTATION-PLAN when Phase 1 is done.

---

## Hosted roles and invites (full parity — optional)

**Current state:** On hosted, **admin** is determined by **HUB_ADMIN_USER_IDS** in the gateway env (comma-separated `provider:id`). Those users get Edit, Team tab, and 200 on GET /api/v1/roles and GET /api/v1/invites (empty list). POST /api/v1/roles is a no-op; POST /api/v1/invites returns 400 "not supported yet." So: parity for **who is admin** and **who can open Team**; no parity yet for **adding/removing members** or **creating invite links**.

**Full parity** (Team and invites working on hosted like self-hosted) requires **persistent storage** for roles and invites. Options:

| Option | Where | Pros | Cons |
|--------|--------|------|------|
| **A. Canister** | Add stable storage + endpoints (or extend existing) for roles and invites; gateway proxies or calls canister for GET/POST roles and invites; on login gateway asks canister for role for this user. | Single source of truth; scales with canister. | Canister changes; migration if already deployed. |
| **B. Bridge** | Bridge stores `hub_roles.json` and `hub_invites.json` (e.g. per vault or global); gateway proxies /api/v1/roles and /api/v1/invites to bridge; on login gateway asks bridge for role. | No canister change; bridge already has backend and Blobs/DATA_DIR. | Bridge becomes stateful; need to define scope (per user? per vault?). |

**Recommendation:** Option **B (bridge)** is the quickest path: the bridge is already deployed, has Netlify Blobs (or DATA_DIR), and the gateway already proxies to it. See **[HOSTED-ROLES-VIA-BRIDGE.md](./HOSTED-ROLES-VIA-BRIDGE.md)** for a concrete implementation outline (storage, routes, gateway proxy, optional invite-in-redirect). No change to the Hub UI — it already calls the same endpoints.

---

## Phase 2 — Deploy hosted

**What Phase 2 is:** Phase 2 is **deployment and operations only**. There is no in-repo code to write. You run deploy commands and configure infrastructure (canister, gateway, bridge, web, DNS) so the stack is live. The parity code is already in the repo (Phase 1 gateway stubs); Phase 2 is executing the deploy checklist below.

**Goal:** Get the full stack live so users can use “Use in the cloud (beta)” at knowtation.store/hub/.

**Prerequisite:** Phase 1 complete so Settings → Team and Setup don’t 404.

**Reference:** [DEPLOY-HOSTED.md](./DEPLOY-HOSTED.md), [CANISTER-AND-SINGLE-URL.md](./CANISTER-AND-SINGLE-URL.md), [STATUS-HOSTED-AND-PLANS.md](./STATUS-HOSTED-AND-PLANS.md).

**Deploy order (run when ready; no need to push between steps):** 1) Canister (`dfx deploy`). 2) Gateway + bridge (Netlify or Node host; set env). 3) Web to 4Everland (landing + Hub); set custom domain knowtation.store and `HUB_API_BASE_URL` in `web/hub/config.js` to gateway URL. 4) DNS. 5) Pre-roll checklist. Push/merge this branch once when in-repo work is done; actual deploy steps use your accounts and don't require further commits unless you change production config.

### 2.1 When you have already deployed (canister, 4Everland, Netlify, DNS)

You have: canister on ICP, web/ on 4Everland at knowtation.store, gateway on Netlify, DNS. **Pre-roll is not confirmed** (see [STATUS-VERIFICATION.md](./STATUS-VERIFICATION.md)); it includes bridge env, so it cannot be done until the bridge is deployed and wired. What remains:

| Action | What it does |
|--------|----------------|
| **Canister redeploy** | Merged code added `base_state_id` and `external_ref` to proposals (Option B). To have them live: `cd hub/icp && dfx deploy --network ic`. Same canister; this updates it with the new code. |
| **Netlify rebuild** | Gateway must run the **merged** code (Phase 1 stubs: roles, invites, setup, import, facets). Trigger a new deploy from main so the gateway serves the latest server.mjs. |
| **4Everland rebuild** | So knowtation.store/hub/ serves the latest web/ (e.g. Muse in How to use). Trigger build from main if it does not auto-deploy. |
| **Bridge (required)** | The **bridge** (`hub/bridge/`) is **required** for Connect GitHub, Back up now, and search on hosted. It is a **separate** service (not part of the Netlify gateway). Deploy `hub/bridge/` somewhere; set its env (CANISTER_URL, SESSION_SECRET, GITHUB_*, EMBEDDING_*, DATA_DIR); set **BRIDGE_URL** in the **gateway's** Netlify env to the bridge URL. Do not leave on the shelf; Phase 2 is not complete until the bridge is deployed and wired. See [STATUS-VERIFICATION.md](./STATUS-VERIFICATION.md) and [STATUS-HOSTED-AND-PLANS.md](./STATUS-HOSTED-AND-PLANS.md) section 1. |

**Do not start Phase 3 (multi-vault)** until Phase 2 is complete: canister redeploy (if desired), Netlify rebuild, 4Everland rebuild, **bridge deploy and wire**, and pre-roll verified.

### 2.2 First-time deploy checklist (only if stack is not yet live)

- [ ] **Canister:** `dfx deploy --network ic`. Set `CANISTER_URL` in gateway (and bridge if used) env.
- [ ] **Web:** Deploy `web/` to 4Everland. Custom domain knowtation.store; set `HUB_API_BASE_URL` in `web/hub/config.js` to your gateway URL.
- [ ] **Gateway:** Deploy to Netlify (or Node host). Env: CANISTER_URL, SESSION_SECRET, HUB_BASE_URL, HUB_UI_ORIGIN, OAuth IDs/secrets, HUB_CORS_ORIGIN. Optional: BRIDGE_URL if bridge is deployed.
- [ ] **Bridge (required):** Deploy `hub/bridge/`; set its env; set BRIDGE_URL in gateway. Connect GitHub, Back up now, and search depend on it. Do not treat as optional.
- [ ] **DNS:** knowtation.store to 4Everland (and gateway URL as needed).
- [ ] **Pre-roll:** Canister /health ok; OAuth callbacks set; **bridge env set**; no secrets in repo/client. Verify per [DEPLOY-HOSTED.md](./DEPLOY-HOSTED.md) §5.

---

## Phase 3 — Hosted multi-vault (canister + gateway)

**Self-hosted Phase 15:** ✅ **Done** in repo — Node Hub, `hub_vaults.yaml`, access, scope, vault switcher, `X-Vault-Id`; bridge index/search keyed by `(user, vault_id)` when deployed.

**Hosted Phase 15.1:** ✅ **Done** in repo (PR #46–#48) — canister partition by `vault_id`, gateway passes **`X-Vault-Id`**, Hub **Create vault**, bridge vectors per `(uid, vault_id)`.

**Team access + scope on hosted:** ✅ **Done** in repo — bridge **`hub_workspace`**, **`hub_vault_access`**, **`hub_scope`**; gateway delegation headers and scope filtering — [HOSTED-WORKSPACE-ACCESS.md](./HOSTED-WORKSPACE-ACCESS.md).

**Prerequisite:** Phase 1 and 2 done (parity + deploy + bridge wired). Design: [MULTI-VAULT-AND-SCOPED-ACCESS.md](./MULTI-VAULT-AND-SCOPED-ACCESS.md), Phase 15 in IMPLEMENTATION-PLAN.

### 3.1 Scope (summary)

- Multiple vaults per user on the canister; optional per-user **scope** (projects/folders) enforced in the gateway (hosted) and Node Hub (self-hosted).
- Hub UI: vault switcher; Settings → Vaults: hosted **YAML vault list** remains N/A (501 POST vaults); **vault access** + **scope** JSON editable when bridge is wired.

### 3.2 Checklist (Phase 3)

- [x] Direction documented in IMPLEMENTATION-PLAN and MULTI-VAULT-AND-SCOPED-ACCESS.
- [x] Canister + gateway: `vault_id` / `X-Vault-Id` for notes, proposals, export.
- [x] Gateway: vault list from canister; **effective user** + allowlist + scope for delegated teammates ([HOSTED-WORKSPACE-ACCESS.md](./HOSTED-WORKSPACE-ACCESS.md)).
- [x] Bridge: index/search/sync use effective owner uid for team members; scope filter on index/search/export path.
- [x] Hub UI: vault switcher; hosted **vault access** + **scope** panels (YAML list hidden on hosted).
- [x] Update PARITY-PLAN (this section); keep STATUS-HOSTED-AND-PLANS §2.1 in sync after production smoke.

---

## Phase 4 — Full hosted roles/invites (bridge store)

**Goal:** Real team behavior on hosted (assign roles, invite by link). Implemented via **bridge** storage (Option B): roles and invites persist in bridge Blobs/DATA_DIR; gateway proxies to bridge when `BRIDGE_URL` is set. See [HOSTED-ROLES-VIA-BRIDGE.md](./HOSTED-ROLES-VIA-BRIDGE.md).


### 4.1 Checklist (Phase 4)

- [x] Bridge: persist roles (user_id → role) and pending invites (token, role, created_at) in Blobs or DATA_DIR.
- [x] GET/POST /api/v1/roles, GET/POST/DELETE /api/v1/invites, POST /api/v1/invites/consume, GET /api/v1/role implemented in bridge.
- [x] Gateway proxies roles/invites/consume to bridge when BRIDGE_URL set; GET /api/v1/settings uses bridge GET /api/v1/role for role.
- [x] Gateway: invite in OAuth state and post-login redirect; Hub UI calls consume when URL has token + invite.
- [x] Document in bridge README and PARITY-PLAN.

---

## Summary: phase order

| Phase | What | When |
|-------|------|------|
| **1** | API parity (gateway stubs: roles, invites, POST setup, optional import 501) | **Done.** Implemented in hub/gateway/server.mjs. |
| **2** | Deploy hosted (canister, 4Everland, gateway, **bridge**, DNS); **bridge required** — not optional | **Next.** After Phase 1. Do not start Phase 3 until Phase 2 including bridge is complete. See [STATUS-VERIFICATION.md](./STATUS-VERIFICATION.md). |
| **3** | Multi-vault (Phase 15) | After Phase 2 **complete** (including bridge deploy and wire); per MULTI-VAULT-AND-SCOPED-ACCESS. |
| **4** | Full hosted roles/invites (bridge store) | **Done.** Bridge stores roles/invites; gateway proxies; invite flow via state + consume. |
| **4b** | Workspace owner + vault-access + scope (bridge + gateway) | **Done.** See [HOSTED-WORKSPACE-ACCESS.md](./HOSTED-WORKSPACE-ACCESS.md). |

**Do not start implementation** of Phase 1 until this plan (and IMPLEMENTATION-PLAN updates) are agreed. After Phase 1 is implemented, update this doc and IMPLEMENTATION-PLAN to mark parity complete and “Next” as Phase 2 (deploy).

**See also:** [STATUS-HOSTED-AND-PLANS.md](./STATUS-HOSTED-AND-PLANS.md) §2.1 for a current **parity snapshot** table (teams/bridge, multi-vault, import, facets).
