# Hosted roles and invites via the bridge

> **Note (Phase 3.1):** References to `?token=JWT` throughout this doc reflect the original design. The OAuth redirect mechanism was updated in Phase 3.1 to use a URL fragment (`#token=JWT`) instead of a query parameter to prevent tokens appearing in server logs and referrer headers.

**Summary:** Yes — adding full Team/invites to the **hosted** product is relatively quick because the **bridge** is already deployed and has the right building blocks. This doc explains why and what to implement.

**Reference:** [PARITY-PLAN.md](./PARITY-PLAN.md) (Phase 4 optional, Option B), [hub/bridge/README.md](../hub/bridge/README.md), [hub/gateway/README.md](../hub/gateway/README.md).

---

## Why the bridge is a good fit

| Piece | Already in place |
|--------|-------------------|
| **Persistence** | Bridge uses **Netlify Blobs** (prod) or **DATA_DIR** (local) for GitHub tokens and per-user vector DBs. Same pattern can store `hub_roles` and `hub_invites` (one key each, JSON). |
| **Auth** | Bridge already verifies JWT (`userIdFromJwt`, same `SESSION_SECRET` as gateway) for vault/sync, search, index. |
| **Gateway → bridge** | Gateway already proxies vault/sync, github-status, search, index to the bridge when `BRIDGE_URL` is set. Adding proxy for `/api/v1/roles` and `/api/v1/invites` is a small addition. |
| **Contract** | Self-hosted Hub uses `hub/roles.mjs` and `hub/invites.mjs` with the same API contract (GET/POST roles, GET/POST/DELETE invites, same JSON shapes). Bridge can mirror that logic. |

No canister changes. No new service. Same Hub UI — it already calls the same endpoints.

---

## What to implement

### 1. Bridge: storage and routes

- **Storage:** Add `loadRoles(blobStore)` / `saveRoles(blobStore)` and `loadInvites(blobStore)` / `saveInvites(blobStore)` using the same Blobs keys or files as tokens (e.g. Blobs keys `hub_roles`, `hub_invites`; or `DATA_DIR/hub_roles.json`, `DATA_DIR/hub_invites.json`). Format matches self-hosted: `{ "roles": { "provider:id": "admin"|"editor"|"viewer" } }` and `{ "invites": { "token": { "role", "created_at" } } }`.
- **Bootstrap admins:** Optional env **`HUB_ADMIN_USER_IDS`** on the bridge (same comma-separated list as gateway). Effective role = stored roles[uid] ?? (uid in HUB_ADMIN_USER_IDS ? 'admin' : 'member'). Ensures at least one admin before any POST /roles.
- **Routes (bridge):**
  - **GET /api/v1/roles** — Require JWT + admin. Return `{ roles: { [user_id]: role } }` from stored + bootstrap.
  - **POST /api/v1/roles** — Require JWT + admin. Body `{ user_id, role }` or `{ roles: { ... } }`; merge into stored roles.
  - **GET /api/v1/invites** — Require JWT + admin. Return `{ invites: [ { token, role, created_at, expires_at }, ... ] }`.
  - **POST /api/v1/invites** — Require JWT + admin. Body `{ role }`; create invite, return `{ invite_url, token, role, created_at, expires_at }`.
  - **DELETE /api/v1/invites/:token** — Require JWT + admin. Revoke invite.
  - **POST /api/v1/invites/consume** — Require JWT (any authenticated user). Body `{ token }`. Consume invite for JWT’s `sub`; add user to roles, remove invite. Used when user lands on Hub with `?invite=TOKEN` after login.

### 2. Gateway: proxy when BRIDGE_URL is set

- Inside the existing `if (BRIDGE_URL) { ... }` block, add proxy handlers for:
  - GET/POST `/api/v1/roles`
  - GET/POST `/api/v1/invites`
  - DELETE `/api/v1/invites/:token`
  - POST `/api/v1/invites/consume`
- Forward request (method, headers, body) to the bridge; return bridge response. Keep existing **requireAdmin** (or equivalent) so only admins hit roles/invites list/create/revoke; consume is any authenticated user.
- When `BRIDGE_URL` is set, these proxy routes are registered **before** the current stub routes, so the bridge handles the request. When `BRIDGE_URL` is not set, the existing stubs remain (empty list, POST invites 400).

### 3. Invite flow on hosted (optional but recommended)

- **Today (self-hosted):** OAuth state includes `invite` token; after callback the server consumes the invite and redirects to Hub with `?token=JWT&invite_accepted=1`.
- **Hosted option A (minimal):** No gateway change. User with `?invite=TOKEN` in URL signs in; after redirect they land on Hub with `?token=JWT` but **without** `invite` in URL (gateway doesn’t pass state yet). So they’d need to use the invite link again while logged in and have the Hub call `POST /api/v1/invites/consume` when the UI sees `?invite=TOKEN` + token. That requires the login link to preserve `?invite=TOKEN` (e.g. redirect to Hub with both token and invite so the UI can call consume).
- **Hosted option B (parity):** Gateway accepts `?invite=TOKEN` on login, puts it in OAuth state; in callback, redirect to Hub with `?token=JWT&invite=TOKEN`. Hub UI on load, when it has both token and invite, calls `POST /api/v1/invites/consume` with body `{ token: inviteToken }`, then replaces URL with `?invite_accepted=1`. No gateway call to bridge; the browser sends the request with the user’s JWT.

So: bridge **POST /api/v1/invites/consume** + Hub UI calling it when URL has `token` and `invite` is enough. Gateway only needs to **preserve** `invite` in the post-login redirect (pass invite in OAuth state, then redirect to `.../hub/?token=JWT&invite=TOKEN`). That’s a small gateway change (state serialization + redirect query).

---

## Effort estimate

| Task | Effort |
|------|--------|
| Bridge: load/save roles and invites (Blobs + DATA_DIR), mirror `roles.mjs` / `invites.mjs` logic | Small (same patterns as tokens) |
| Bridge: 6 routes above + admin check (HUB_ADMIN_USER_IDS + stored roles) | Small |
| Gateway: 5 proxy routes inside `if (BRIDGE_URL)` | Small |
| Gateway: invite in OAuth state + redirect with `?invite=TOKEN` | Small |
| Hub UI: on load with `token` + `invite`, call consume then update URL | Trivial (one API call) |
| Bridge README + PARITY-PLAN update | Trivial |

**Total:** On the order of a single focused implementation pass (bridge + gateway + optional invite flow). No new infrastructure; bridge and Netlify Blobs already exist.

---

## Checklist (when implementing)

- [ ] Bridge: `loadRoles` / `saveRoles`, `loadInvites` / `saveInvites` (Blobs + DATA_DIR fallback).
- [ ] Bridge: `HUB_ADMIN_USER_IDS` env (optional), effective role = stored ∨ bootstrap.
- [ ] Bridge: GET/POST /api/v1/roles, GET/POST/DELETE /api/v1/invites, POST /api/v1/invites/consume; JWT + admin where required.
- [ ] Gateway: proxy those routes to bridge when `BRIDGE_URL` is set.
- [ ] Gateway (optional): pass `invite` in OAuth state and in redirect URL so Hub can call consume.
- [ ] Hub UI (if gateway passes invite): when `token` + `invite` in URL, call POST /api/v1/invites/consume then set `?invite_accepted=1`.
- [ ] Docs: bridge README (env, new routes), PARITY-PLAN Phase 4 (mark Option B as implemented).
