# Knowtation

**Knowtation** (*know* + *notation*) is a **personal knowledge and notation system**: one place to capture, transcribe, index, and search your notes and media. It is built to be an **open brain**—parseable by any agent—with a **CLI + Skill Manifest** interface so many AI agents can use it without tool-definition context bloat. Optional support for **memory** and **intent attestation (AIR)** keeps workflows traceable and authorized.

- **Source of truth:** Obsidian-style vault (Markdown + frontmatter + media). Use Obsidian or any Markdown vault editor (SilverBullet, Foam, VS Code, etc.); the format is agent-parseable and editor-agnostic.
- **Search:** Vector store (Qdrant or sqlite-vec) for semantic and hybrid search.
- **Interface:** Single CLI (`knowtation search`, `get-note`, `list-notes`, `index`, etc.) + **SKILL.md** for agent discovery (Cursor, Claude Code, and others). Optional MCP server for clients that only speak MCP.
- **Multi-project:** One vault can hold multiple projects (e.g. Born Free, Dream Bold Network). Use folders and tags; filter by `--project` or `--tag` when you want scope, or query across everything.
- **Capture & message interfaces:** Ingest from Telegram, WhatsApp, Discord into the vault; **JIRA** and **Slack** are recommended plugins. The design is open so you can add other message interfaces (Teams, email, etc.) that write to the same inbox contract.
- **Import from other platforms:** Bring in ChatGPT and Claude exports, Mem0, NotebookLM, Google Drive, MIF, and generic Markdown. Any audio (smart glasses, wearables, past blogs/videos) via transcription. One vault; all content searchable and usable for any project. See **[docs/IMPORT-SOURCES.md](./docs/IMPORT-SOURCES.md)**.
- **Use cases:** Capture from chat and tools, transcription (audio/video → vault), **import from LLMs and knowledge bases**, content creation (blog, podcast, reels, book), marketing, analysis—all with one vault and one CLI. Optional integrations (e.g. Airtable, Mem) for structured data and agent memory.

**Spec:** All data formats, CLI surface, and contracts are in **[docs/SPEC.md](./docs/SPEC.md)**. The **final document that lays out all phases** is **[docs/IMPLEMENTATION-PLAN.md](./docs/IMPLEMENTATION-PLAN.md)** (Phases 1–11). Data ownership and vendor independence are in SPEC §0. Internal planning lives in **development/** (gitignored). A **simple landing page** (intent, open source, what’s included, mock pricing) is in **[web/index.html](./web/index.html)** — open in a browser or host it.

## Quick start

1. **Clone or use this repo** — This is the Knowtation repository. If you are copying this seed elsewhere, see [COPY-TO-REPO.md](./COPY-TO-REPO.md).
2. **Configure** — Copy `config/local.example.yaml` to `config/local.yaml` and set your vault path. For vector search: use **Qdrant** (set `qdrant_url`) or **sqlite-vec** (set `vector_store: sqlite-vec`; no server, DB under `data_dir`). Set embedding provider (e.g. Ollama). Do not commit secrets.
3. **Open the vault** — Open the `vault/` folder in Obsidian (or any Markdown vault editor).
4. **Run the CLI** — `node cli/index.mjs --help`. Run `node cli/index.mjs index` once (requires Qdrant and Ollama for default embedding); then `node cli/index.mjs search "your query"`, `write`, `export`, `import`. See [docs/IMPLEMENTATION-PLAN.md](./docs/IMPLEMENTATION-PLAN.md) — Phases 1–9 implemented.
5. **Use from agents** — The skill in `.cursor/skills/knowtation/` is used by Cursor when this repo is open; copy to `~/.cursor/skills/knowtation/` for global use. For **MCP** (Cursor, Claude Desktop), run `knowtation mcp` or `npm run mcp` and configure per [docs/AGENT-ORCHESTRATION.md](./docs/AGENT-ORCHESTRATION.md).

## Repository layout

```
knowtation/
├── README.md
├── COPY-TO-REPO.md       ← Optional: turn this seed into a new repo
├── ARCHITECTURE.md
├── cli/                  ← CLI entry and subcommands
├── .cursor/skills/knowtation/   ← SKILL.md for agent discovery
├── vault/                ← Obsidian-style vault (inbox, projects, areas, media, …)
├── config/               ← Example config (copy to local, do not commit)
├── scripts/              ← Indexer, transcribe, capture/export
├── docs/                 ← Spec, plan, clarifications, setup (public)
├── web/                  ← Landing page (index.html)
├── data/                 ← Generated (gitignored)
└── development/          ← Internal planning (gitignored; not on GitHub)
```

## Message interfaces and plugins

- **Reference plugins:** `scripts/capture-file.mjs` (file/stdin) and `scripts/capture-webhook.mjs` (HTTP POST). Both write to `vault/inbox` per [docs/CAPTURE-CONTRACT.md](./docs/CAPTURE-CONTRACT.md).
- **Recommended (planned):** JIRA, Slack, Telegram—same inbox contract. See [ARCHITECTURE.md](./ARCHITECTURE.md) and [docs/CAPTURE-CONTRACT.md](./docs/CAPTURE-CONTRACT.md).

## Docs

- **[docs/WHITEPAPER.md](./docs/WHITEPAPER.md)** — **Whitepaper:** why fragmented knowledge and weak retrieval motivate a portable vault; Knowtation’s thesis (data liberation, CLI/MCP, indexing); who it’s for; questions for builders. Landing page links here from [web/index.html](./web/index.html).
- **[docs/SPEC.md](./docs/SPEC.md)** — **Spec:** frontmatter, inbox contract, CLI (all commands/flags including `import`), config, indexer, MCP, memory/AIR hooks, import sources, versioning.
- **[docs/IMPLEMENTATION-PLAN.md](./docs/IMPLEMENTATION-PLAN.md)** — **Final document: all phases** (1–11). Core (1–10) + optional Phase 11 (shared vault / hub). Phases 1–9 implemented.
- **[docs/AGENT-ORCHESTRATION.md](./docs/AGENT-ORCHESTRATION.md)** — Using Knowtation with agent orchestration: MCP (Cursor/Claude config) and CLI in agent environments; vault as knowledge backend, write-back patterns.
- **[docs/CLARIFICATIONS.md](./docs/CLARIFICATIONS.md)** — Simple explanations: capture/import contracts, optional memory/AIR, backends behind an abstraction, “plug into any LLM or service.”
- **[docs/INTENTION-AND-TEMPORAL.md](./docs/INTENTION-AND-TEMPORAL.md)** — Intention and temporal understanding: temporal sequence, causation, hierarchical memory, state compression, evals. Optional frontmatter and CLI filters; schema defined now so we don’t backtrack.
- **[docs/RETRIEVAL-AND-CLI-REFERENCE.md](./docs/RETRIEVAL-AND-CLI-REFERENCE.md)** — All CLI commands and add-on features in one place; how they interact; how each helps the retrieval bottleneck and token cost; expansions (e.g. `--fields`, `--snippet-chars`, `--count-only`) for right information at best price token-wise.
- **[docs/CAPTURE-CONTRACT.md](./docs/CAPTURE-CONTRACT.md)** — Capture plugin contract: output location, frontmatter, idempotency. Use when building Telegram, Slack, or custom capture plugins.
- **[docs/IMPORT-SOURCES.md](./docs/IMPORT-SOURCES.md)** — Import from ChatGPT, Claude, Mem0, NotebookLM, Google Drive, MIF, markdown, audio/video; formats and how to run.
- **[ARCHITECTURE.md](./ARCHITECTURE.md)** — High-level design; points to SPEC for details.
- **[docs/STANDALONE-PLAN.md](./docs/STANDALONE-PLAN.md)** — Product plan (CLI-first, SKILL.md, memory, AIR, scenarios).
- **[docs/PROVENANCE-AND-GIT.md](./docs/PROVENANCE-AND-GIT.md)** — What “provenance” and “vault under git” mean (traceability of outputs vs version history); inbox stays file-based.
- **[docs/MUSE-STYLE-EXTENSION.md](./docs/MUSE-STYLE-EXTENSION.md)** — Optional Muse-style variation/review/commit layer for context, intention, and hub-style workflows. Phase 11 (shared vault / hub) for simple agent-to-agent and agent-to-human without GitHub.
- **[docs/setup.md](./docs/setup.md)** — Setup steps.
- **[web/index.html](./web/index.html)** — Landing page: intent, open source, GitHub link, what’s included, phases summary, mock pricing. **To view:** run <code>open web/index.html</code> (macOS) or <code>python3 -m http.server 8000 --directory web</code> then open http://localhost:8000. See [web/README.md](./web/README.md).
- **[COPY-TO-REPO.md](./COPY-TO-REPO.md)** — Use when creating a new repo from this seed.

## License

Use and extend as you like. Add a LICENSE file when you publish.
