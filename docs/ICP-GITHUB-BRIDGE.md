# ICP–GitHub bridge (hosted product)

The **bridge** is a small service that connects the hosted Knowtation vault (in the ICP canister) to GitHub for "Back up now". The canister does **not** store GitHub tokens; the bridge does.

---

## 1. Role

- **Bridge** stores a GitHub OAuth token per user (encrypted at rest). It exposes:
  - **Connect GitHub:** OAuth flow (`scope=repo`); callback stores the token keyed by user id.
  - **Back up now:** Fetches the full vault from the canister (GET `/api/v1/export` with `X-User-Id`), then pushes all notes to the user’s GitHub repo via the GitHub API (create blobs, tree, commit, push).
- **Canister** exposes GET `/api/v1/export` (read-only, all notes for the authenticated user) so the bridge can pull in one request. The canister does not talk to GitHub.

---

## 2. Flow

1. User clicks **Connect GitHub** in the Hub UI (hosted). UI redirects to the bridge’s `/auth/github-connect` (with the user’s JWT in query or the UI sends it after redirect). Bridge verifies JWT, gets user id, redirects to GitHub OAuth; on callback, bridge stores the token for that user id and redirects back to the UI.
2. User optionally sets **repo** (e.g. `owner/backup-repo`) in Settings or in the first "Back up now" request body.
3. User clicks **Back up now**. UI calls the bridge `POST /api/v1/vault/sync` with `Authorization: Bearer <jwt>` and optional body `{ "repo": "owner/name" }`. Bridge verifies JWT, gets user id, loads GitHub token and repo, fetches vault from canister (`GET /api/v1/export` with `X-User-Id`), then creates a commit on the default branch with all note files and pushes via GitHub API.

---

## 3. What the bridge stores

- **Per user:** GitHub access token (encrypted with `SESSION_SECRET`), optional default `repo`.
- Stored in `data/hub_github_tokens.json` (or `DATA_DIR`). Production should use a proper secrets store; encryption at rest is implemented with the shared secret.

---

## 4. Sync frequency

- **On-demand:** "Back up now" triggers one sync. Optional: cron or scheduled job can call sync for connected users.

## 4b. Search (Phase 4)

- **Indexer** runs in the bridge: on "Re-index" (POST `/api/v1/index`) the bridge fetches the vault from the canister, chunks notes, embeds (Ollama or OpenAI from env), and upserts to a per-user sqlite-vec store under `DATA_DIR/vectors/<user_id>/`.
- **Search** (POST `/api/v1/search`) is served by the bridge against that store. The gateway proxies `/api/v1/search` and `/api/v1/index` to the bridge when `BRIDGE_URL` is set. The canister does not implement search.

---

## 5. Implementation

- **hub/bridge/** — Node (Express) service. See [hub/bridge/README.md](../hub/bridge/README.md) for env, routes, and deploy.
- **Canister** — GET `/api/v1/export` returns `{ "notes": [ { "path", "frontmatter", "body" } ] }` for the authenticated user (same `X-User-Id` / `X-Test-User` as other endpoints).

---

## 6. Reference

- [CANISTER-AUTH-CONTRACT.md](./CANISTER-AUTH-CONTRACT.md) — gateway/canister auth
- [HUB-API.md](./HUB-API.md) — POST /vault/sync contract (self-hosted; hosted uses bridge)
