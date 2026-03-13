# Setup

1. **Copy seed to repo** — See [COPY-TO-REPO.md](../COPY-TO-REPO.md) to create the Knowtation repo and open it in Cursor.
2. **Config** — Copy `config/local.example.yaml` to `config/local.yaml` and set `vault_path` (absolute path to `vault/`). Optionally set `qdrant_url` and embedding provider. Do not commit `config/local.yaml`.
3. **Vault** — Open the `vault/` folder in Obsidian as your vault.
4. **Index** — Run the indexer once: `knowtation index` or `node scripts/index-vault.mjs` (requires Qdrant at `qdrant_url` and Ollama for default embedding). After indexing, search (Phase 3) will have data.
5. **CLI** — From repo root: `node cli/index.mjs --help`, `node cli/index.mjs list-notes`, `node cli/index.mjs get-note <path>`, `node cli/index.mjs index`. Use `node cli/index.mjs search "query"` once Phase 3 (search) is implemented.
6. **Capture (optional)** — File-based: `echo "Note" | node scripts/capture-file.mjs --source file --source-id id123`. Webhook: `node scripts/capture-webhook.mjs --port 3131` then POST `/capture` with JSON. See [docs/CAPTURE-CONTRACT.md](./CAPTURE-CONTRACT.md).
7. **Agents** — The skill in `.cursor/skills/knowtation/SKILL.md` is auto-discovered by Cursor when this repo is open. For global use, copy that skill folder to `~/.cursor/skills/knowtation/`.
