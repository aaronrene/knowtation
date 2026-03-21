# MCP Issue #1 — Phase B (prompts) — shipped

**In plain terms:** Prompts are **saved recipes** an AI client can open—like “give me a daily brief from my notes” or “turn this search into a summary”—without you retyping the same instructions every time. They bundle vault content via MCP resources so the model starts from real notes, not an empty thread.

Server-defined prompts live in [`mcp/prompts/`](../mcp/prompts/) and register via `registerKnowtationPrompts` from [`mcp/prompts/register.mjs`](../mcp/prompts/register.mjs) in [`mcp/create-server.mjs`](../mcp/create-server.mjs).

## Prompt names (hyphenated, `prompts/get`)

| Name | Purpose |
|------|---------|
| `daily-brief` | Notes since date (default today UTC) + snippets; assistant prefill. |
| `search-and-synthesize` | Semantic search → up to 12 embedded notes. |
| `project-summary` | Recent project notes embedded; `format`: brief / detailed / stakeholder. |
| `write-from-capture` | Raw text + source; optional `templates/capture.md` as embedded resource. |
| `temporal-summary` | `since` / `until` + optional topic search intersection. |
| `extract-entities` | JSON schema instructions + embedded notes in scope. |
| `meeting-notes` | Transcript → structured meeting note; suggested `write` path. |
| `knowledge-gap` | Search results → “what’s missing?” prompt. |
| `causal-chain` | `causal_chain_id` notes via [`listNotesForCausalChainId`](../mcp/resources/graph.mjs). |
| `content-plan` | Project notes → content plan (`blog` / `podcast` / `newsletter` / `thread`). |

## MCP details

- **Roles:** MCP prompt messages only allow `user` and `assistant` (no `system`); instructions use `user` role.
- **Arguments:** Protocol passes string key/value args; numeric limits are parsed in handlers (e.g. `limit` on `search-and-synthesize`).
- **Embedded resources:** Notes use `type: resource` with `knowtation://vault/…` URIs and markdown text (Issue #1 B link to Phase A resources).

## Graph helper

[`listNotesForCausalChainId`](../mcp/resources/graph.mjs) is exported from the graph module for prompts (and reuse elsewhere).
