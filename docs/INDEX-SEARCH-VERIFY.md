# Index and search verification

Use this to confirm **local** indexing and semantic search before relying on the Hub UI, MCP, or hosted bridge. Complements [HOSTED-HUB-VERIFY.md](./HOSTED-HUB-VERIFY.md) (deploy and CORS).

## Config checklist

| Item | Source |
|------|--------|
| Vault path | `config/local.yaml` → `vault_path`, or env `KNOWTATION_VAULT_PATH` (loaded via `lib/load-env.mjs` for the CLI) |
| Vector backend | Default `vector_store` is **qdrant** (`lib/config.mjs`). **Qdrant:** `qdrant_url` in YAML or `QDRANT_URL`. **sqlite-vec:** `vector_store: sqlite-vec` and `data_dir`, or `KNOWTATION_VECTOR_STORE=sqlite-vec` |
| Embeddings | `embedding.provider` / `embedding.model` in YAML (defaults: `ollama`, `nomic-embed-text`). OpenAI: `OPENAI_API_KEY` + `provider: openai` |
| Ollama base URL | `embedding.ollama_url` in YAML, or env **`OLLAMA_URL`** (overrides YAML when set; `lib/config.mjs` — same variable name as hub bridge) |

**Note:** `lib/embedding.mjs` still defaults to `http://localhost:11434` when neither YAML nor `OLLAMA_URL` provides a base URL.

## Ollama

- If `ollama serve` fails with `bind: address already in use` on `127.0.0.1:11434`, a process (usually the Ollama app) is **already** listening. Do not start a second server on that port.
- Check the API: `curl -sS http://127.0.0.1:11434/api/tags` should return HTTP **200** and JSON listing models.
- Ensure the embed model is pulled (default in code: `nomic-embed-text`): `ollama list`.

## CLI verification (recorded on this repo)

1. **Default Qdrant without URL**  
   Command: `node cli/index.mjs index` with no `config/local.yaml` and no `QDRANT_URL`.  
   **Result:** exits **2** with:  
   `qdrant_url is required for indexing when using Qdrant. Set in config/local.yaml or QDRANT_URL.`

2. **sqlite-vec path (full loop)**  
   Command:  
   `KNOWTATION_VECTOR_STORE=sqlite-vec node cli/index.mjs index`  
   **Result:** success — vault notes chunked, embedded via Ollama, vectors stored under project `data_dir` (default `data/`).  
   Then:  
   `KNOWTATION_VECTOR_STORE=sqlite-vec node cli/index.mjs search "<query>" --json`  
   **Result:** JSON with `results` array (paths, scores, snippets).

3. **Ollama API**  
   `GET http://127.0.0.1:11434/api/tags` → **200**; `nomic-embed-text` present in `ollama list`.

## Hub UI (self-hosted)

- Semantic search is triggered by the **Search** button or **Enter** in the search field (`web/hub/hub.js`: `runVaultSearch`, bound to `#search-query` keydown and `#btn-search`).
- The global shortcut **Enter** on the notes list (when focus is not in an input) still opens the selected note.

After changing `hub.js`, bump the `hub.js?v=` query string in `web/hub/index.html` so CDNs pick up the new bundle ([HOSTED-HUB-VERIFY.md](./HOSTED-HUB-VERIFY.md) §1).

## Hosted (bridge)

With `BRIDGE_URL` set, search/index use bridge env for embeddings and per-user sqlite-vec storage. See [hub/bridge/README.md](../hub/bridge/README.md) and [DEPLOY-HOSTED.md](./DEPLOY-HOSTED.md).

## Security

Keep secrets in `.env` only; `.env` is gitignored. Do not commit API keys or JWT material.
