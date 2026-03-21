# MCP Issue #1 — Phase G (scope / roots alignment) — shipped

**In plain terms:** This phase helps AI clients understand *which folders* Knowtation actually uses—your Markdown vault and the local index data—without reading the code. It does not grant extra filesystem access beyond what the server was already configured to use.

## What MCP “roots” really are

In the [Model Context Protocol](https://modelcontextprotocol.io/docs/concepts/roots), **roots are normally declared by the MCP client** (the IDE or host). The client sends `roots/list` when the server asks, or the user configures workspace folders. There is **no** `server.setRoots` in the official TypeScript SDK for Node—the Issue #1 sketch used that name as a conceptual stand-in.

## What we implemented

1. **Initialize `instructions`** — On each [`createKnowtationMcpServer()`](../mcp/create-server.mjs), the underlying `Server` receives plain-language text plus **`file://` URIs** for `vault_path` and `data_dir` (and per-vault lines when `vaultList` has more than one entry). Built in [`mcp/server-instructions.mjs`](../mcp/server-instructions.mjs). Clients may surface this text to the model as a usage hint (same field as other MCP servers’ `instructions`).

2. **Optional client roots logging** — After `notifications/initialized`, if the client advertises the **roots** capability, the server calls `roots/list` once and emits a structured **`notifications/message`** (`event: client_roots`) so logging-capable clients can see what the host reported. This is diagnostic only; it does not change tool behavior.

## Operational notes

- **HTTP (D1):** Each session gets fresh instructions from `loadConfig()` at server construction time.
- **Aligning hosts:** Users can add the same `file://` paths as workspace roots in Cursor, Claude Desktop, or other MCP hosts so the assistant’s file picker and context match Knowtation’s vault.

## References

- Issue #1 Phase G: [issue-1-supercharge-mcp.md](./issues/issue-1-supercharge-mcp.md)
- [BACKLOG-MCP-SUPERCHARGE.md](./BACKLOG-MCP-SUPERCHARGE.md)
