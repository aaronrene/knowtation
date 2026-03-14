---
name: knowtation
description: Query and search a personal knowledge vault (Obsidian-style) via the knowtation CLI or MCP. Use when the user wants to find notes, get note content, list notes by folder/tag, trigger re-indexing, write, export, or import from other platforms. CLI with subcommands; optional MCP server (knowtation mcp) for runtimes that speak MCP. Knowtation = know + notation (notation for what you know).
compatibility:
  - Cursor
  - Claude Code
  - Any runtime that can run a CLI and read this skill (e.g. Windsurf, GNO, custom)
allowed-tools: []
---

# Knowtation — Use the knowledge vault via CLI or MCP

Knowtation (*know* + *notation*) is a personal knowledge and content system. The vault is Markdown (Obsidian-style); search is semantic (vector store). Use the **knowtation** CLI for terminal and agent environments, or the **MCP server** (`knowtation mcp`) when the runtime speaks MCP (Cursor, Claude Desktop). See **docs/AGENT-ORCHESTRATION.md** for MCP config.

## When to use this skill

- User asks to search their notes, find something in their vault, or get content of a specific note.
- User wants to list recent or filtered notes (e.g. from inbox, by project, or by tag).
- User wants to re-index the vault (after adding or changing notes).
- User wants to create or update a note (write), export notes to a file/dir, or **import** from ChatGPT, Claude, Mem0, MIF, markdown, or audio/video.

## Commands (run in project root or where `knowtation` is installed)

- **Search (semantic):**  
  `knowtation search "your query"`  
  Optional: `--json`, `--folder <path>`, `--project <slug>`, `--tag <tag>`, `--since`, `--until`, `--chain`, `--entity`, `--episode`, `--order date|date-asc`, `--limit <n>`, `--fields path|path+snippet|full`, `--snippet-chars <n>`, `--count-only`.

- **Get one note:**  
  `knowtation get-note <vault-relative-path>`  
  Optional: `--body-only`, `--frontmatter-only`, `--json`. Example: `knowtation get-note vault/projects/default/notes.md`.

- **List notes:**  
  `knowtation list-notes`  
  Optional: `--folder`, `--project <slug>`, `--tag <tag>`, `--since`, `--until`, `--chain`, `--entity`, `--episode`, `--limit`, `--offset`, `--order date|date-asc`, `--fields path|path+metadata|full`, `--count-only`, `--json`.

- **Re-index vault:**  
  `knowtation index`  
  (Runs the indexer: vault → chunk → embed → vector store. Optional: `--json` for `{ ok, notesProcessed, chunksIndexed }`. Requires Qdrant and embedding provider in config.)

- **Write note:**  
  `knowtation write <path>` with optional `--stdin`, `--frontmatter k=v`, `--append`, `--json`. Inbox and non-inbox; AIR may apply to non-inbox (see spec).

- **Export:**  
  `knowtation export <path-or-query> <output-dir-or-file>` with optional `--format`, `--project`, `--json`. Records provenance; AIR when enabled.

- **Import (from other platforms):**  
  `knowtation import <source-type> <input>` with optional `--project`, `--output-dir`, `--tags`, `--dry-run`, `--json`. Source types: `chatgpt-export`, `claude-export`, `mem0-export`, `notebooklm`, `gdrive`, `mif`, `markdown`, `audio`, `video`. See docs/IMPORT-SOURCES.md.

## Introspection

To see current usage and options, run:
- `knowtation --help`
- `knowtation search --help`

Output is JSON when you pass `--json`, so you can pipe to `jq` or parse in code.

## Tiered retrieval (token-optimal)

To minimize token use: (1) Use **list-notes** or **search** with a small `--limit` and `--fields path` or default path+snippet; (2) From the paths or snippets, pick one or two notes; (3) Call **get-note** only for those paths. **Token levers:** `--fields` (path | path+snippet | full for search; path | path+metadata | full for list-notes), `--snippet-chars <n>`, `--count-only`; for get-note use `--body-only` or `--frontmatter-only` when you need only one part. Use `--count-only` when you only need "how many?" before deciding to run a full search. See **docs/RETRIEVAL-AND-CLI-REFERENCE.md** for all levers.

## Config

The CLI reads vault path and vector store from `config/local.yaml` or env vars (`KNOWTATION_VAULT_PATH`, `QDRANT_URL`). Vector store is **Qdrant** (sqlite-vec available when so configured; see config and README). Do not commit secrets; ensure the project has a vault and has been indexed at least once before searching.
