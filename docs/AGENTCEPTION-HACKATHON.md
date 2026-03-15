# AgentCeption + Knowtation — Hackathon Integration (March 2026)

This document describes the **AgentCeption integration** implemented as part of this weekend's hackathon. It is specific to [AgentCeption](https://github.com/cgcardona/agentception): how Knowtation supplements it, how they fit together, and how to use them in combination.

---

## Why AgentCeption and Knowtation fit

**AgentCeption** turns a brain dump into a structured plan (PlanSpec), GitHub issues, and an agent org (CTO → coordinators → engineers) that work in isolated worktrees and open PRs. **Knowtation** is a personal and team knowledge vault: Markdown notes, semantic search, imports, capture, and transcription—all under your control.

AgentCeption's agents need **context** and **memory**. Knowtation provides both: a shared vault that the planner, coordinators, and engineers can read from and write to, with token-efficient retrieval and no vendor lock.

---

## How Knowtation supplements AgentCeption

| AgentCeption need | Knowtation provides |
|-------------------|---------------------|
| Brain dump or spec as input | Vault notes: put the brain dump or spec in the vault; planner pulls from it to create the PlanSpec. |
| Project and component context for engineer agents | Search and filters: `--project`, `--tag`, `--entity` so engineers get only relevant notes. |
| Phase summaries and decisions to persist | Write-back: pipe phase summaries into `knowtation write` with frontmatter; vault accumulates "what the org decided." |
| Low token cost when agents pull context | Tiered retrieval: `--fields path`, `--limit`, `--count-only`; then `get-note` only for chosen paths. |
| Agents in worktrees (no MCP) | CLI: `knowtation search ... --json`, parse output, `get-note` for paths. |
| Orchestrator or CTO in Cursor/Claude | MCP: tools `search`, `get_note`, `list_notes`, `write`, etc. appear directly. |

---

## Integration paths

### Option A: MCP (orchestrator, CTO, Cursor/Claude)

1. Run `knowtation mcp` (or configure the MCP server in your Cursor/Claude config).
2. Set `KNOWTATION_VAULT_PATH` to the shared vault.
3. Tools appear: `search`, `get_note`, `list_notes`, `index`, `write`, `export`, `import`.

The planner or CTO can search the vault before creating the PlanSpec; coordinators can query for project context; all use the same tools.

### Option B: CLI (engineer agents in worktrees)

Engineer agents run in isolated worktrees and typically don't have MCP. Install Knowtation in the agent environment and use the CLI:

```bash
# Search for relevant context
knowtation search "auth flow decisions" --project myapp --limit 3 --json

# From the results, fetch only the paths you need
knowtation get-note vault/projects/myapp/decisions/auth.md --json

# Write phase summary back
echo "Phase 1: Implemented auth module..." | knowtation write vault/projects/myapp/decisions/phase-1.md --stdin --frontmatter source=agentception date=2026-03-15 project=myapp
```

Use `--fields path` or `path+snippet` to keep payloads small; then `get-note` only for the 1–2 paths that matter.

### Option C: Hub API (agents with JWT)

Agents that have a Hub JWT (e.g. from a headless login or env `KNOWTATION_HUB_TOKEN`) can call the Hub REST API directly: `GET /api/v1/notes`, `POST /api/v1/search`, `GET /api/v1/notes/:path`, `POST /api/v1/notes`, `POST /api/v1/proposals`. Use `knowtation propose --hub <url>` to create a proposal for human review before commit. See [HUB-API.md](./HUB-API.md), [AGENT-INTEGRATION.md](./AGENT-INTEGRATION.md).

### Bridge script

The repo includes `scripts/write-to-vault.sh` for piping content into the vault from agent workflows:

```bash
echo "Phase 1 summary: ..." | ./scripts/write-to-vault.sh vault/projects/myapp/decisions/phase-1.md --source agentception --project myapp
```

---

## Workflow: AgentCeption with Knowtation

1. **Input** — Put the brain dump or spec in the vault (e.g. `vault/projects/myapp/spec.md` or import from ChatGPT/Claude).
2. **PlanSpec creation** — Planner (human or agent) pulls from vault via `search` / `get-note`; creates PlanSpec; AgentCeption runs as usual.
3. **During execution** — Engineer agents in worktrees call `knowtation search ... --json` for project/component context; use `get-note` for chosen paths.
4. **After phases** — Pipe phase summaries into `knowtation write ... --stdin` with `source=agentception`, `date`, `project`; next phases can search them.
5. **Index** — Run `knowtation index` after writes so new content is searchable.

No change to AgentCeption's core flow; Knowtation is an optional **context and memory layer** that the org calls via CLI or MCP.

---

## Token and cost savings

| Lever | Effect |
|-------|--------|
| `--limit 5` | Fewer results per search/list. |
| `--fields path` or `path+snippet` | Paths only or short snippets; use `get-note` for full content only when needed. |
| `--count-only` | Just the count, no result payload. |
| `--snippet-chars 200` | Cap snippet length. |
| `--body-only` / `--frontmatter-only` | On `get-note`, return only one part. |

Tiered flow: narrow with `--project`/`--tag`, then `search` or `list-notes` with small `--limit` and `--fields path`, then `get-note` for the 1–2 paths that matter. See [RETRIEVAL-AND-CLI-REFERENCE.md](./RETRIEVAL-AND-CLI-REFERENCE.md).

---

## Vault Git and messaging

**Vault Git:** Vault can live in a Git repo; config `vault.git.enabled` and `vault.git.remote`. Optional `knowtation vault sync` to commit and push. See [PROVENANCE-AND-GIT.md](./PROVENANCE-AND-GIT.md).

**Messaging:** Slack, Discord, Telegram → Hub capture or adapters (`scripts/capture-slack-adapter.mjs`, `scripts/capture-discord-adapter.mjs`) → vault inbox. See [MESSAGING-INTEGRATION.md](./MESSAGING-INTEGRATION.md).

---

## What was built this weekend

- **Backend access** — AgentCeption (or any agent orchestrator) can invoke Knowtation via CLI or MCP.
- **Hub API** — Agents can use Hub REST API and `knowtation propose` for review-before-commit.
- **Shared vault** — One vault path (`KNOWTATION_VAULT_PATH`) for the planner, coordinators, and engineers.
- **Write-back** — Phase summaries and decisions written to vault with `source=agentception` (or similar) for traceability.
- **Token levers** — `--limit`, `--fields`, `--count-only`, `--snippet-chars`, tiered retrieval.
- **Vault Git config** — Optional sync; vault in repo for backup and history.
- **Messaging adapters** — Slack and Discord adapters; capture contract documented.
- **Bridge script** — `scripts/write-to-vault.sh` for piping content from agent workflows.
- **Docs** — This document; [AGENT-ORCHESTRATION.md](./AGENT-ORCHESTRATION.md), [AGENT-INTEGRATION.md](./AGENT-INTEGRATION.md), [HUB-API.md](./HUB-API.md), [MESSAGING-INTEGRATION.md](./MESSAGING-INTEGRATION.md).

---

## References

| Document | Role |
|----------|------|
| [AGENT-ORCHESTRATION.md](./AGENT-ORCHESTRATION.md) | MCP and CLI setup, tiered retrieval, generic patterns |
| [AGENT-INTEGRATION.md](./AGENT-INTEGRATION.md) | CLI, MCP, Hub API one-pager for agents |
| [HUB-API.md](./HUB-API.md) | Hub REST API, auth, proposals |
| [RETRIEVAL-AND-CLI-REFERENCE.md](./RETRIEVAL-AND-CLI-REFERENCE.md) | Token levers, `--fields`, `--limit`, examples |
| [PROVENANCE-AND-GIT.md](./PROVENANCE-AND-GIT.md) | Vault under Git |
| [MESSAGING-INTEGRATION.md](./MESSAGING-INTEGRATION.md) | Slack, Discord, capture adapters |
| [SPEC.md](./SPEC.md) | CLI semantics, frontmatter, vault format |
| [AgentCeption](https://github.com/cgcardona/agentception) | AgentCeption repo |
