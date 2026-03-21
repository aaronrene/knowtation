# MCP Issue #1 — Phase D (Streamable HTTP) — D1 shipped

**In plain terms:** Besides the default “pipe” transport (stdio), Knowtation can expose MCP over **HTTP** on your machine so a client that prefers URLs can connect. This is still **local** by default (loopback only). Authenticated “hosted MCP through the Hub” remains future work (D2/D3).

## D1 — Local Streamable HTTP

- **Entry:** `MCP_TRANSPORT=http` or `KNOWTATION_MCP_TRANSPORT=http` with `node mcp/server.mjs`, or `npm run mcp:http`.
- **Endpoint:** `GET|POST|DELETE /mcp` on [`mcp/http-server.mjs`](../mcp/http-server.mjs) using SDK `StreamableHTTPServerTransport` + `createMcpExpressApp`.
- **Session:** Stateful sessions with `Mcp-Session-Id` (new UUID per new client). Each session gets its own [`createKnowtationMcpServer()`](../mcp/create-server.mjs) instance.
- **Listen:** `config/local.yaml` → `mcp.http_port` (default **3334**), `mcp.http_host` (default **127.0.0.1**). Env **`KNOWTATION_MCP_HTTP_PORT`** overrides port.
- **Code layout:** Shared registration in [`mcp/create-server.mjs`](../mcp/create-server.mjs); stdio in [`mcp/stdio-main.mjs`](../mcp/stdio-main.mjs); router in [`mcp/server.mjs`](../mcp/server.mjs).

### HTTP vs stdio differences

- **Vault watcher (Phase E):** Started only for **stdio** (single server). HTTP mode does **not** run chokidar per session (would only notify one session). Use `resources/read` / polling, or run stdio MCP for live subscriptions.

### Security

- Default bind is **loopback**. **`http_host: 0.0.0.0`** exposes the MCP surface without authentication (**D2/D3 not implemented**). Do not expose to the internet without a gateway, TLS, and auth.

## D2 / D3 — Backlog

- **D2:** Hub as authenticated MCP reverse proxy (`hub/gateway/mcp-proxy.mjs`), session pool, role-scoped tools.
- **D3:** OAuth 2.1 metadata + token exchange for remote clients.

See [issue-1-supercharge-mcp.md](./issues/issue-1-supercharge-mcp.md) Phase D.
