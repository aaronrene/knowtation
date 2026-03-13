---
name: knowtation
description: Query and search a personal knowledge vault (Obsidian-style) via the knowtation CLI. Use when the user wants to find notes, get note content, list notes by folder/tag, or trigger re-indexing. Single CLI with subcommands; no MCP schema in context. Knowtation = know + notation (notation for what you know).
compatibility:
  - Cursor
  - Claude Code
allowed-tools: []
---

# Knowtation — Use the knowledge vault via CLI

Knowtation (*know* + *notation*) is a personal knowledge and content system. The vault is Markdown (Obsidian-style); search is semantic (vector store). You interact with it **only** via the **knowtation** CLI so that tool context stays small.

## When to use this skill

- User asks to search their notes, find something in their vault, or get content of a specific note.
- User wants to list recent or filtered notes (e.g. from inbox, or by tag).
- User wants to re-index the vault (after adding or changing notes).

## Commands (run in project root or where `knowtation` is installed)

- **Search (semantic):**  
  `knowtation search "your query"`  
  Optional: `--json` for machine output, `--folder <path>`, `--limit <n>`.

- **Get one note:**  
  `knowtation get-note <vault-relative-path>`  
  Example: `knowtation get-note vault/projects/default/notes.md`.

- **List notes:**  
  `knowtation list-notes`  
  Optional: `--folder vault/inbox`, `--tag tagName`, `--limit 10`, `--offset 0`, `--json`.

- **Re-index vault:**  
  `knowtation index`  
  (Runs the indexer: vault → chunk → embed → vector store.)

## Introspection

To see current usage and options, run:
- `knowtation --help`
- `knowtation search --help`

Output is JSON when you pass `--json`, so you can pipe to `jq` or parse in code.

## Config

The CLI reads vault path and vector store URL from `config/local.yaml` or env vars (`KNOWTATION_VAULT_PATH`, `QDRANT_URL`). Do not commit secrets; ensure the project has a vault and has been indexed at least once before searching.
