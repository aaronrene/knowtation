# Knowtation Hub Bridge

GitHub connect + **Back up now** + **index + search** for the hosted product. Stores GitHub token per user; sync fetches vault from the ICP canister and pushes to the user’s repo. See [docs/ICP-GITHUB-BRIDGE.md](../../docs/ICP-GITHUB-BRIDGE.md).

## Routes

- **GET /auth/github-connect?token=&lt;jwt&gt;** — Redirect to GitHub OAuth (`scope=repo`). User must be authenticated (pass JWT in query or cookie). Callback stores token for user id.
- **GET /auth/callback/github-connect** — GitHub OAuth callback (do not call directly).
- **POST /api/v1/vault/sync** — Back up now. Requires `Authorization: Bearer <jwt>`. Body optional: `{ "repo": "owner/name" }`. Fetches vault from canister, pushes to GitHub.
- **GET /api/v1/vault/github-status** — Returns `{ github_connected, repo }` for the authenticated user.
- **POST /api/v1/index** — Re-index vault (chunk → embed → sqlite-vec per user). Requires Bearer JWT.
- **POST /api/v1/search** — Semantic search. Body: `{ "query": "...", "limit?", ... }`. Requires Bearer JWT.

## Environment

| Variable | Required | Description |
|----------|----------|-------------|
| **CANISTER_URL** | Yes | Canister HTTP URL (e.g. `https://<canister-id>.ic0.app`). |
| **SESSION_SECRET** or **HUB_JWT_SECRET** | Yes | Same as gateway: verify JWT and encrypt stored tokens. |
| **HUB_BASE_URL** | Yes (prod) | Public URL of this bridge (for OAuth callback). E.g. `https://bridge.knowtation.com`. |
| **HUB_UI_ORIGIN** | No | Origin of Hub UI (post-connect redirect). Defaults to HUB_BASE_URL. |
| **GITHUB_CLIENT_ID**, **GITHUB_CLIENT_SECRET** | No | GitHub OAuth for "Connect GitHub". Use a separate GitHub App or same as gateway. |
| **DATA_DIR** | No | Directory for tokens and per-user vector DBs (default: repo `data/`). |
| **BRIDGE_PORT** or **PORT** | No | Port (default 3341). |
| **EMBEDDING_PROVIDER** | No | `ollama` (default) or `openai`. |
| **EMBEDDING_MODEL** | No | Model name (default `nomic-embed-text` for Ollama). |
| **OLLAMA_URL** | No | Ollama base URL (default `http://localhost:11434`). |
| **OPENAI_API_KEY** | No | Required if `EMBEDDING_PROVIDER=openai`. |
| **INDEXER_CHUNK_SIZE**, **INDEXER_CHUNK_OVERLAP** | No | Chunking params (default 2048, 256). |

## Run locally

```bash
cd hub/bridge
npm install
export CANISTER_URL=https://<canister-id>.ic0.app
export SESSION_SECRET=your-secret
export HUB_BASE_URL=http://localhost:3341
export GITHUB_CLIENT_ID=... GITHUB_CLIENT_SECRET=...
npm start
```

Hub UI (hosted) must call this bridge for Connect GitHub and Back up now. Either set a separate bridge URL in the UI config, or run gateway and bridge on the same host and have the gateway proxy `/api/v1/vault/sync` and `/auth/github-connect` to the bridge.

## Reference

- [ICP-GITHUB-BRIDGE.md](../../docs/ICP-GITHUB-BRIDGE.md)
- [CANISTER-AUTH-CONTRACT.md](../../docs/CANISTER-AUTH-CONTRACT.md)
