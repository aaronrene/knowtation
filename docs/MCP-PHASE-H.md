# MCP Issue #1 — Phase H (progress + logging) — shipped

**In plain terms:** Long jobs (re-indexing, big imports) report **progress** to the client when it asks for it, and emit **structured log lines** the host can show—so you see activity instead of a silent hang.

## Progress (`notifications/progress`)

- **`index` tool:** When the client sends `_meta.progressToken` on `tools/call`, the server emits throttled progress (same cadence as indexer: **every 10 items or 5 seconds**, plus first/last batch in embed/upsert). Stages: chunking notes → embedding chunks → upserting chunks. Implemented via `onProgress` in [`lib/indexer.mjs`](../lib/indexer.mjs) and [`mcp/tool-telemetry.mjs`](../mcp/tool-telemetry.mjs) `sendMcpToolProgress` using `extra.sendNotification` (SDK pattern; see MCP SDK `progressExample`).
- **`import` tool:** Emits start (`progress: 0`), markdown folder/file progress from [`lib/importers/markdown.mjs`](../lib/importers/markdown.mjs) (same **10 / 5s** rule), then a final `import complete` with `total` = count. Other source types only get start + final until those importers gain hooks.

## Logging (`notifications/message`)

- Server capability **`logging`** enabled on [`createKnowtationMcpServer()`](../mcp/create-server.mjs) (`capabilities.logging` on the underlying `Server`).
- **Info:** `index_complete`, `import_complete` with structured `data`.
- **Error:** `index_failed`, `import_failed` with `message`.
- **Warning:** `write_missing_title` when `write` is called with non-empty `frontmatter` but no `title` key.

Clients that do not support logging or progress ignore these; stdio remains backward compatible.

## References

- Issue #1 Phase H: [issue-1-supercharge-mcp.md](./issues/issue-1-supercharge-mcp.md)
- [BACKLOG-MCP-SUPERCHARGE.md](./BACKLOG-MCP-SUPERCHARGE.md) — phase table and “gap” line
