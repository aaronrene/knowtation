# MCP Issue #1 — Phase F (sampling) — F1 shipped, F2–F5 backlog

**In plain terms:** **Sampling** means the Knowtation MCP server can ask the **app you’re using** (Cursor, Claude Desktop, etc.) to run the **user’s own LLM** for a task, instead of Knowtation calling Ollama/OpenAI on the server. That way summarization can use the model you already picked in the host, with your keys and approvals.

## Shipped: F1 — Client-delegated summarization

- **Tool:** `summarize` in [`mcp/tools/phase-c.mjs`](../mcp/tools/phase-c.mjs).
- **Behavior:** If the connected MCP client advertises **`sampling`**, the server calls `sampling/createMessage` via the SDK (`Server#createMessage`) with the same prompts as before (`systemPrompt` + user message with note bodies, `includeContext: 'none'`, `maxTokens` aligned with the prior server-side cap). The assistant reply text becomes `summary` in the JSON result (same shape as today: `{ summary, source_paths }`).
- **Fallback:** If sampling is unavailable, declined, errors, or returns empty text, the tool uses the existing **`completeChat`** path (Ollama / OpenAI on the machine running Knowtation).

## Backlog (Issue #1): F2–F5

| Item | Idea | Notes |
|------|------|--------|
| **F2** | Smart import — suggest project/tags/title via sampling | Touches importers; separate commit. |
| **F3** | Post-index enrichment — per-note summaries in metadata | Touches indexer / vector metadata. |
| **F4** | Rerank search hits via sampling | Touches search path; cost/latency sensitive. |
| **F5** | Prompt prefilling — draft assistant turn for MCP prompts | Touches `mcp/prompts/*`. |

See [issue-1-supercharge-mcp.md](./issues/issue-1-supercharge-mcp.md) Phase F for the original wording.

## Manual check (F1)

1. Use an MCP host that supports **sampling** and approve the request if prompted.
2. Call **`summarize`** on a short note; expect `{ summary, source_paths }` as before.
3. Use a host **without** sampling (or decline sampling): expect summary still returned via **server-side** `completeChat` when configured.

## References

- [BACKLOG-MCP-SUPERCHARGE.md](./BACKLOG-MCP-SUPERCHARGE.md)
- [AGENT-ORCHESTRATION.md](./AGENT-ORCHESTRATION.md)
