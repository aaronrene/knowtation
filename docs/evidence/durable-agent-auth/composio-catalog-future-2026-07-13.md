# Future: Composio / Hermes catalog packaging (Knowtation)

**Date:** 2026-07-13  
**Status:** Research note only — **does not block** Phase B device authorization.  
**Related:** [`DURABLE-AGENT-AUTH-ROADMAP.md`](../DURABLE-AGENT-AUTH-ROADMAP.md) Phase B · Born Free already uses Composio MCP in Hermes for Sheets (`connect.composio.dev`).

## Simple summary

Composio is useful for third-party app tools (Sheets, etc.). It is **not** required for Knowtation vault auth. There is no zero-cost self-serve “publish Knowtation into Composio’s public catalog so Hermes one-clicks vault OAuth” path verified today. Treat catalog packaging as a **future distribution** option after Hub Connect cloud agent ships.

## Technical summary

- Composio MCP APIs let projects create **custom** MCP servers / sessions (`POST …/mcp/servers/custom`, session `mcp.url`) bound to **Composio toolkits** and Composio-managed auth configs — not a public “submit your OAuth MCP URL to the Hermes marketplace” self-serve listing for arbitrary vault servers.
- Knowtation must remain the auth authority (MCP OAuth / device code / scoped agent credentials). Do **not** replace Knowtation vault auth with Composio API keys.
- If a future partnership or toolkit listing appears, require that the install still completes Knowtation OAuth or device authorization (refreshable, revocable, vault-bound).

## When to revisit

1. After Phase B device connect is live and documented for Hermes.
2. If Composio or Hermes documents a public MCP catalog that accepts external OAuth resource servers without wrapping vault secrets in Composio keys.
3. Only as optional one-click distribution — never as a substitute for Knowtation SoT.

## Do not

- Block Phase B on Composio partnership work.
- Teach users to put Hub session JWTs into Composio or Hermes `.env` as durable vault auth.
