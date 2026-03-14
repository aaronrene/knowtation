# Phase 9 — MCP Server Manual Test

## Prerequisites

- Config at `config/local.yaml` with `vault_path` (or `KNOWTATION_VAULT_PATH`)
- Vault with at least one note; indexed (Qdrant) for search
- MCP client (Cursor, Claude Desktop, or `npx @modelcontextprotocol/inspector`)

## Start the MCP server

```bash
# Option 1: via CLI
node cli/index.mjs mcp

# Option 2: via npm script
npm run mcp

# Option 3: direct
node mcp/server.mjs
```

Server runs on stdio; configure your MCP client to spawn it (see AGENT-ORCHESTRATION.md).

## Cursor configuration

Add to `.cursor/mcp.json` or Cursor Settings → MCP:

```json
{
  "mcpServers": {
    "knowtation": {
      "command": "node",
      "args": ["/path/to/knowtation/mcp/server.mjs"],
      "env": { "KNOWTATION_VAULT_PATH": "/path/to/your/vault" }
    }
  }
}
```

Replace paths with your actual paths.

## Tool verification

1. **search** — Call with `query: "your search"`, optional `limit`, `project`, `tag`, etc. Expect JSON with `results` or `count`.
2. **get_note** — Call with `path: "vault/inbox/foo.md"`. Expect `path`, `frontmatter`, `body`.
3. **list_notes** — Call with optional filters. Expect `notes` and `total`.
4. **index** — Call (no args). Expect `ok`, `notesProcessed`, `chunksIndexed`.
5. **write** — Call with `path`, `body`, optional `frontmatter`. Expect `path`, `written: true`.
6. **export** — Call with `path_or_query`, `output`. Expect `exported`, `provenance`.
7. **import** — Call with `source_type`, `input`. Expect `imported`, `count`.

Outputs match CLI `--json` shapes per SPEC §4.2.
