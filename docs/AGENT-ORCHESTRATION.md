# Knowtation and agent orchestration

Knowtation is designed as a **knowledge backend** for multi-agent orchestration systems. Orchestrators and their agents can read from and write to the vault via **CLI** or **MCP**. This doc describes both options and how to integrate with systems like [AgentCeption](https://github.com/cgcardona/agentception).

---

## Why both CLI and MCP?

| Context | Use |
|--------|-----|
| **MCP** | Agent runtimes that speak MCP (Cursor, Claude Desktop, or an orchestrator that exposes MCP to its agents). One config block; tools appear as `search`, `get_note`, `list_notes`, etc. |
| **CLI** | Agents that run in containers, worktrees, or headless processes (e.g. engineer agents in [AgentCeption](https://github.com/cgcardona/agentception) worktrees). No MCP server in that process; they exec `knowtation` and parse `--json` output. |

Recommendation: support **both**. Use MCP where the runtime already has MCP; use CLI where agents run in isolated environments (Docker, git worktrees) and only have the binary and env.

---

## Option A: MCP

1. **Run the Knowtation MCP server** (e.g. `knowtation mcp` or your package’s MCP entry point).
2. **Configure your client** (Cursor, Claude Desktop, or the orchestrator’s MCP client) to use it. Example (Cursor / Claude):

   ```json
   {
     "mcpServers": {
       "knowtation": {
         "command": "node",
         "args": ["/path/to/knowtation/mcp/server.mjs"],
         "env": { "KNOWTATION_VAULT_PATH": "/path/to/vault" }
       }
     }
   }
   ```

3. **Tools** (same semantics as CLI): `search`, `get_note`, `list_notes`, `index`, `write`, `export`, `import`. Same filters and JSON shapes as in [SPEC §4](./SPEC.md).

Use **tiered retrieval** from the SKILL: small `limit`, `--fields path` or path+snippet, then `get_note` only for chosen paths. See [RETRIEVAL-AND-CLI-REFERENCE.md](./RETRIEVAL-AND-CLI-REFERENCE.md).

---

## Option B: CLI in the agent environment

1. **Install Knowtation** in the environment where the agent runs (e.g. in the Docker image used by engineer agents, or on the host that runs the orchestrator).
2. **Set env (and optional config):**  
   - `KNOWTATION_VAULT_PATH` — path to the vault (required).  
   - Optionally `config/local.yaml` or other env (e.g. `QDRANT_URL`, `KNOWTATION_DATA_DIR`).  
   For read-only (search, list-notes, get-note), vault path and index are enough; for write/export, config may be needed (e.g. AIR).
3. **Invoke from the agent:**  
   - `knowtation search "auth flow" --project myapp --limit 3 --json`  
   - Parse JSON; then `knowtation get-note <path> --json` for the 1–2 paths you need.  
   - To write back: `knowtation write vault/projects/myapp/decisions/phase-1.md --stdin --frontmatter source=agentception date=2026-03-13` (body from stdin).

Same **tiered retrieval** pattern: use `--limit`, `--fields path`, `--count-only` to keep payloads small; then fetch full content only for selected paths.

---

## Patterns

### Vault as knowledge backend (read)

- **Before or during planning:** Search the vault for requirements, decisions, or prior context (e.g. `search "decisions about X" --project myapp --limit 5 --json`). Use results to enrich the plan or the brain dump.
- **During execution:** When an engineer agent runs, it can call Knowtation (CLI or MCP) to get notes for the current project/component so code and PRs align with existing decisions.

### Write-back (plans and summaries)

- After a phase or after “Create Issues,” write a short summary or the plan into the vault so the next phase or the next run can search it. Example: pipe a phase summary into `knowtation write` with frontmatter `source: agentception`, `date`, `project`. See the optional bridge script in `scripts/write-to-vault.sh` (or equivalent in this repo).

### Token and cost

- Use retrieval levers: `--limit`, `--fields path`, `--snippet-chars`, `--count-only` for search/list-notes; `--body-only` or `--frontmatter-only` for get-note when you only need one part. This keeps context small and cost low when agents pull vault content into their context.

---

## AgentCeption specifically

[AgentCeption](https://github.com/cgcardona/agentception) turns a brain dump into a structured plan (PlanSpec), GitHub issues, and an agent org (CTO → coordinators → engineers) that works in isolated worktrees and opens PRs.

- **Knowtation as backend:** Point the orchestrator (or its agents) at a shared Knowtation vault. CTO/coordinators/engineers use **MCP** if they run in a context where MCP is configured (e.g. Cursor), or **CLI** inside the Docker/worktree environment. They search/list/get-note for project and component context; optionally write phase summaries or decisions back into the vault.
- **Vault as input:** The brain dump or spec can live in the vault (e.g. a note or an export). The planner (or human) pulls from the vault to create the PlanSpec; then AgentCeption runs as usual.
- **Bridge script:** Use a small script (e.g. after a phase) that pipes the phase summary into `knowtation write ... --stdin --frontmatter ...` so the vault accumulates “what the org decided” and remains searchable.

No change to AgentCeption’s core flow; Knowtation is an optional **context and memory layer** that agents call via CLI or MCP.

---

## Summary

| Goal | Use |
|------|-----|
| Agents in Cursor / Claude (MCP) | Option A: configure Knowtation MCP server; use tools search, get_note, list_notes, write, etc. |
| Agents in containers / worktrees (no MCP) | Option B: install Knowtation CLI, set `KNOWTATION_VAULT_PATH`, run `knowtation ... --json` and parse output. |
| Write-back (plans, summaries) | `knowtation write <path> --stdin --frontmatter source=... date=...`; optional script in `scripts/` to wrap this. |
| Keep token cost low | Tiered retrieval: small limit, path/snippet only, then get-note for 1–2 paths. See [RETRIEVAL-AND-CLI-REFERENCE.md](./RETRIEVAL-AND-CLI-REFERENCE.md). |

Spec and CLI/MCP semantics: **[docs/SPEC.md](./SPEC.md)**. Retrieval and token levers: **[docs/RETRIEVAL-AND-CLI-REFERENCE.md](./RETRIEVAL-AND-CLI-REFERENCE.md)**.
