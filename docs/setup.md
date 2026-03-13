# Setup

1. **Copy seed to repo** — See [COPY-TO-REPO.md](../COPY-TO-REPO.md) to create the Knowtation repo and open it in Cursor.
2. **Config** — Copy `config/local.example.yaml` to `config/local.yaml` and set `vault_path` (absolute path to `vault/`). Optionally set `qdrant_url` and embedding provider. Do not commit `config/local.yaml`.
3. **Vault** — Open the `vault/` folder in Obsidian as your vault.
4. **Index** — Run the indexer once (implement `scripts/index-vault.mjs` then `node scripts/index-vault.mjs` or `knowtation index`) so search has data.
5. **CLI** — From repo root: `node cli/index.mjs --help` and `node cli/index.mjs search "query"` (after indexer is implemented).
6. **Agents** — The skill in `.cursor/skills/knowtation/SKILL.md` is auto-discovered by Cursor when this repo is open. For global use, copy that skill folder to `~/.cursor/skills/knowtation/`.
