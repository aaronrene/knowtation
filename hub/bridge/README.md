# Knowtation Hub Bridge

GitHub connect + **Back up now** + **index + search** for the hosted product. Stores GitHub token per user; sync fetches vault from the ICP canister and pushes to the user’s repo. Roles, invites, **workspace owner**, **vault access**, and **scope** persist in Blobs (or DATA_DIR). See [docs/ICP-GITHUB-BRIDGE.md](../../docs/ICP-GITHUB-BRIDGE.md), [docs/HOSTED-ROLES-VIA-BRIDGE.md](../../docs/HOSTED-ROLES-VIA-BRIDGE.md), [docs/HOSTED-WORKSPACE-ACCESS.md](../../docs/HOSTED-WORKSPACE-ACCESS.md).

## Routes

- **GET /auth/github-connect?token=&lt;jwt&gt;** — Redirect to GitHub OAuth (`scope=repo`). User must be authenticated (pass JWT in query or cookie). Callback stores token for user id.
- **GET /auth/callback/github-connect** — GitHub OAuth callback (do not call directly).
- **POST /api/v1/vault/sync** — Back up now. Requires `Authorization: Bearer <jwt>`. Body optional: `{ "repo": "owner/name" }`. Fetches vault from canister, pushes to GitHub.
- **GET /api/v1/vault/github-status** — Returns `{ github_connected, repo }` for the authenticated user.
- **GET /api/v1/role** — Returns `{ role, may_approve_proposals }` for the authenticated user (gateway **settings** + approve gate). **may_approve_proposals** is true for **admin**; for **evaluator** it follows per-user blob **`hub_evaluator_may_approve`** and env **`HUB_EVALUATOR_MAY_APPROVE=1`** when no row exists. Requires Bearer JWT.
- **GET /api/v1/roles** — List roles (admin only). Returns `{ roles, evaluator_may_approve }` (map of user id → boolean).
- **POST /api/v1/roles** — Add or update role (admin only). Body `{ user_id, role, evaluator_may_approve? }`. When **role** is **evaluator**, optional **evaluator_may_approve** (boolean) sets or clears the per-user approve flag in blob **`hub_evaluator_may_approve`**. Changing a user to a non-evaluator role removes their entry from that map.
- **POST /api/v1/roles/evaluator-may-approve** — Admin only. Body `{ user_id, evaluator_may_approve: boolean }`. Target user must already be **evaluator**.
- **GET /api/v1/invites** — List pending invites (admin only).
- **POST /api/v1/invites** — Create invite link (admin only). Body `{ role }`. Returns `{ invite_url, token, role, created_at, expires_at }`.
- **DELETE /api/v1/invites/:token** — Revoke invite (admin only).
- **POST /api/v1/invites/consume** — Consume an invite for the authenticated user. Body `{ token }`. Adds user to roles and removes invite.
- **GET /api/v1/workspace** — Returns `{ owner_user_id }` (admin only). Canonical canister partition for the team when set.
- **POST /api/v1/workspace** — Body `{ owner_user_id: string | null }` (admin only). `null` disables delegation.
- **GET /api/v1/vault-access**, **POST /api/v1/vault-access** — Same contract as Node Hub `hub_vault_access.json` (admin only).
- **GET /api/v1/scope**, **POST /api/v1/scope** — Same contract as Node Hub `hub_scope.json` (admin only).
- **GET /api/v1/hosted-context** — JWT. Returns effective canister user, `allowed_vault_ids`, scope, **role**, and **may_approve_proposals** for current **`X-Vault-Id`** (used by the gateway).
- **POST /api/v1/index** — Re-index vault (chunk → embed → sqlite-vec per **effective** user + vault). Requires Bearer JWT.
- **POST /api/v1/search** — Semantic search. Body: `{ "query": "...", "limit?", ... }`. Requires Bearer JWT.

## Environment

| Variable | Required | Description |
|----------|----------|-------------|
| **CANISTER_URL** | Yes | Canister HTTP URL (e.g. `https://<canister-id>.ic0.app`). |
| **SESSION_SECRET** or **HUB_JWT_SECRET** | Yes | Same as gateway: verify JWT and encrypt stored tokens. |
| **HUB_BASE_URL** | Yes (prod) | Public URL of this bridge (for OAuth callback). E.g. `https://bridge.knowtation.com`. |
| **HUB_UI_ORIGIN** | No | Origin of Hub UI (post-connect redirect). Defaults to HUB_BASE_URL. Must match the host users actually use (e.g. `https://www.knowtation.store` if they use www; otherwise redirect can land on the wrong host and show the landing page). |
| **HUB_UI_PATH** | No | Path under origin where the Hub lives (e.g. `/hub`). Default `/hub`. Empty = root. Redirects after Connect GitHub use this so users land on the Hub. |
| **GITHUB_CLIENT_ID**, **GITHUB_CLIENT_SECRET** | No | GitHub OAuth for "Connect GitHub". Use a separate GitHub App or same as gateway. |
| **DATA_DIR** | No | Directory for tokens, per-user vector DBs, and roles/invites (default: repo `data/`). Ignored on Netlify when Blobs are used. |
| **HUB_ADMIN_USER_IDS** | No | Comma-separated user IDs (e.g. `google:123,github:456`) who are **admin** on hosted (bootstrap; can also add admins via POST /api/v1/roles). Should match gateway's `HUB_ADMIN_USER_IDS` so Settings shows the correct role. |
| **HUB_EVALUATOR_MAY_APPROVE** | No | Set to **`1`** so **evaluators** without an explicit row in blob **`hub_evaluator_may_approve`** may **approve** proposals. Per-user **false** in the blob still denies. |
| **BRIDGE_PORT** or **PORT** | No | Port (default 3341). |
| **EMBEDDING_PROVIDER** | No | `ollama` (default) or `openai`. **On Netlify/serverless, prefer `openai`** — the default Ollama URL is `http://localhost:11434`, which the function cannot reach. |
| **EMBEDDING_MODEL** | No | Model name (default `nomic-embed-text` for Ollama; e.g. `text-embedding-3-small` for OpenAI). |
| **OLLAMA_URL** | No | Ollama **API** base URL (default `http://localhost:11434`). Must include **`http://` or `https://`**. Must be reachable from this process. On **Netlify**, use a **public** Ollama endpoint or switch to OpenAI. `https://ollama.com` is the marketing site, not the API. |
| **OLLAMA_API_KEY** | No | Required for Ollama Cloud; add `Authorization: Bearer` header. |
| **OPENAI_API_KEY** | No | Required if `EMBEDDING_PROVIDER=openai`. **Set this on the bridge site** for hosted Hub Re-index / Search. |
| **INDEXER_CHUNK_SIZE**, **INDEXER_CHUNK_OVERLAP** | No | Chunking params (default 2048, 256). |

## Run locally

The bridge is an **API server** (default **http://localhost:3341**), not a separate browser app. It **requires** a real **`CANISTER_URL`** and **`SESSION_SECRET`** (or **`HUB_JWT_SECRET`**) — if `npm start` exits immediately, those are missing. Copy **`hub/bridge/.env.example`** into the **repository root** `.env` (the bridge loads `../../.env` automatically) and fill in your canister URL and secret.

```bash
cd hub/bridge
npm install
# Option A — vars in repo root .env (recommended; see .env.example)
npm start
# Option B — export in shell
export CANISTER_URL=https://<canister-id>.ic0.app
export SESSION_SECRET=your-secret
export HUB_BASE_URL=http://localhost:3341
export GITHUB_CLIENT_ID=... GITHUB_CLIENT_SECRET=...
npm start
```

**Self-hosted Hub** (`npm run hub` → usually **http://localhost:3333**) uses **`hub/server.mjs`** and local files; it does **not** use the bridge unless you run the **gateway** with **`BRIDGE_URL`** pointing at this process.

Hub UI (hosted) must call this bridge for Connect GitHub and Back up now. Either set a separate bridge URL in the UI config, or run gateway and bridge on the same host and have the gateway proxy `/api/v1/vault/sync` and `/auth/github-connect` to the bridge.

## Netlify Blobs (persistence on Netlify)

When the bridge is deployed as a Netlify function (`netlify/functions/bridge.mjs`), tokens, per-user vector DBs, **roles/invites**, and **hub_evaluator_may_approve** (per-evaluator approve permission) are stored in **Netlify Blobs** (store name: `bridge-data`) so they persist across cold starts. Use a **second Netlify site** with **Package directory** `deploy/bridge` (see [docs/BRIDGE-DEPLOY-AND-PREROLL.md](../../docs/BRIDGE-DEPLOY-AND-PREROLL.md)). Enable **Blobs** for that site in the Netlify dashboard (Site configuration → Data & storage or Build & deploy). No extra environment variables are required; the function wrapper attaches the store per request. Locally, or if Blobs are not available, the bridge falls back to `DATA_DIR` (filesystem).

## Reference

- [ICP-GITHUB-BRIDGE.md](../../docs/ICP-GITHUB-BRIDGE.md)
- [CANISTER-AUTH-CONTRACT.md](../../docs/CANISTER-AUTH-CONTRACT.md)
