# MCP Issue #1 — Phase C (enhanced tools) — shipped

This documents Phase C tools and intentional deviations from the issue wording.

## Implemented tools

Registered from [`mcp/tools/phase-c.mjs`](../mcp/tools/phase-c.mjs) via `registerPhaseCTools` in [`mcp/server.mjs`](../mcp/server.mjs) (after base tools and Resources).

| Tool | Role |
|------|------|
| `relate` | Embed note body, vector search neighbors (excludes self). |
| `backlinks` | Wikilink scan (`[[...]]`) across vault. |
| `capture` | Append or create inbox note (`YYYY-MM-DD-HHMMSS-{slug}.md`); no AIR. |
| `transcribe` | Whisper (OpenAI or local) → optional write to vault path. |
| `vault_sync` | `git add/commit/push` in vault; returns `committed`, `pushed`, `sha`. |
| `summarize` | OpenAI chat or Ollama `/api/chat` over note text. |
| `extract_tasks` | `- [ ]` / `- [x]` with folder/project/tag/since filters. |
| `cluster` | k-means over **fresh embeddings of truncated note text** (cap ~200 notes). |
| `memory_query` | SQLite memory store keyword search (existing `lib/memory.mjs`). |
| `tag_suggest` | Similar notes → tag frequency suggestions. |

## Library modules

- [`lib/llm-complete.mjs`](../lib/llm-complete.mjs) — chat completion (OpenAI / Ollama).
- [`lib/relate.mjs`](../lib/relate.mjs), [`lib/backlinks.mjs`](../lib/backlinks.mjs), [`lib/capture-inbox.mjs`](../lib/capture-inbox.mjs), [`lib/extract-tasks.mjs`](../lib/extract-tasks.mjs).
- [`lib/kmeans.mjs`](../lib/kmeans.mjs), [`lib/cluster-semantic.mjs`](../lib/cluster-semantic.mjs), [`lib/tag-suggest.mjs`](../lib/tag-suggest.mjs).
- [`lib/vault-git-sync.mjs`](../lib/vault-git-sync.mjs) — extended sync result (`committed`, `pushed`, `sha`).

## Deviation from Issue #1 (cluster)

The issue text mentions clustering from **chunk embeddings already in the vector store**. This implementation clusters by **embedding truncated note text** for up to ~200 notes (no Qdrant scroll of arbitrary chunk vectors). Rationale: avoids new vector-store APIs and keeps behavior deterministic for local sqlite-vec and Qdrant. If parity with “chunk-level clusters” is required later, add scroll/sample in `lib/vector-store*.mjs` and a second code path.

## Config / env

- **Summarize:** `OPENAI_API_KEY` and `OPENAI_MODEL` (or Ollama: `OLLAMA_HOST`, model from config `ollama.model`).
- **Transcribe:** `OPENAI_API_KEY` for OpenAI Whisper, or local whisper binary + path in config.
- **Relate / cluster / tag_suggest:** indexer + embedding provider as for `index` / search.

## Review checklist (manual)

1. `node -e` import `registerPhaseCTools` (see Phase A doc pattern) or `npm run mcp` with valid vault config.
2. From an MCP client: call `relate` and `backlinks` on a known note; `extract_tasks` with `status: open`.

Commit message example: `feat(mcp): Phase C enhanced tools (relate, cluster, vault_sync, …)`.
