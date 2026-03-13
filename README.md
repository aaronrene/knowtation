# Knowtation

**Knowtation** (*know* + *notation*) is a general-purpose **personal knowledge and content system**: one place to capture, transcribe, index, and search your notes and media, with a **CLI + Skill Manifest** interface so many AI agents can use it without tool-definition context bloat. Optional support for **memory** and **intent attestation (AIR)** for traceable, authorized workflows (content, marketing, analysis).

- **Source of truth:** Obsidian-style vault (Markdown + frontmatter + media).
- **Search:** Vector store (Qdrant or sqlite-vec) for semantic and hybrid search.
- **Interface:** Single CLI (`knowtation search`, `get-note`, `list-notes`, `index`, etc.) + **SKILL.md** for agent discovery (Cursor, Claude Code, and others). Optional MCP server for clients that only speak MCP.
- **Use cases:** Capture (Telegram, WhatsApp, Discord), transcription (audio/video → vault), content creation (blog, podcast, reels, book), marketing, analysis—all with one vault and one CLI.

## Quick start

1. **Copy this seed** to your own repo (see [COPY-TO-REPO.md](./COPY-TO-REPO.md)).
2. **Configure** `config/local.yaml` (vault path) and optionally `.env` (Qdrant URL, etc.). Do not commit secrets.
3. **Open the vault** in Obsidian (open folder `vault/`).
4. **Run the CLI:** `node cli/index.mjs --help` then `node cli/index.mjs search "your query"` (after you run the indexer once).
5. **Use from agents:** The included skill is in `.cursor/skills/knowtation/` (or copy to `~/.cursor/skills/knowtation/`); agents discover it and invoke the CLI.

## Repository layout

```
knowtation/
├── README.md
├── COPY-TO-REPO.md       ← Instructions to create this as its own repo
├── ARCHITECTURE.md
├── cli/                  ← CLI entry and subcommands
├── .cursor/skills/knowtation/   ← SKILL.md for agent discovery
├── vault/                ← Obsidian vault (inbox, projects, areas, media, …)
├── config/               ← Example config (copy to local, do not commit)
├── scripts/              ← Indexer, transcribe, export
├── docs/                 ← Plan, setup guides, memory & AIR
└── data/                 ← Generated (gitignored)
```

## Docs

- **[COPY-TO-REPO.md](./COPY-TO-REPO.md)** — Turn this seed into its own Git repo and open in Cursor.
- **[ARCHITECTURE.md](./ARCHITECTURE.md)** — Vault, vectors, CLI, optional MCP, memory, AIR.
- **[docs/STANDALONE-PLAN.md](./docs/STANDALONE-PLAN.md)** — Full product and architecture plan (CLI-first, SKILL.md, memory, AIR, scenarios).

## License

Use and extend as you like. Add a LICENSE file when you publish.
