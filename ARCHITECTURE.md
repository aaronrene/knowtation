# Knowtation — Architecture

**Canonical spec:** All data formats, CLI surface, and contracts are defined in **[docs/SPEC.md](./docs/SPEC.md)**. This document summarizes the system and points to the spec for details.

## High-level

```
Capture (Telegram/WhatsApp/Discord, JIRA, Slack, or any message interface) → vault/inbox or vault/projects/<project>/inbox
Audio/Video → transcribe → vault (one note per recording)
                    ↓
        Obsidian-style vault (Markdown + frontmatter) ← source of truth, editor-agnostic
                    ↓
        Index: chunk → embed → Qdrant (or sqlite-vec); store project + tags in metadata
                    ↓
        CLI: knowtation search | get-note | list-notes | index  [--project] [--tag]
                    ↓
        Agents (Cursor, Claude, etc.) discover via SKILL.md and run CLI
                    ↓
        Optional: memory layer (Mem0/SAME, Mem), AIR (Null Lens) before write/export/analysis
```

## Interface: CLI first, MCP optional

- **Primary:** One CLI, `knowtation`, with subcommands. Agents discover usage via SKILL.md and `knowtation --help`; no large tool schema in context. Full command set and JSON shapes: **docs/SPEC.md**.
- **Optional:** MCP server that wraps the same backend for clients that only speak MCP. When present, MCP MUST expose the same operations and semantics as the CLI (search, get-note, list-notes, index, write, export, import); same filters and output; MCP is transport only. Run `knowtation mcp` or see **docs/AGENT-ORCHESTRATION.md**.
- **Exit codes:** 0 success, 1 usage error, 2 runtime error. With `--json`, errors return `{ "error": "...", "code": "..." }`.

## Agent orchestration (e.g. AgentCeption)

Knowtation is a first-class **knowledge backend** for multi-agent orchestration. We support **both** interfaces so orchestrators can choose per environment:

- **MCP:** When the agent runtime speaks MCP (Cursor, Claude Desktop, or an orchestrator that exposes MCP), configure the Knowtation MCP server; agents get tools like `search`, `get_note`, `list_notes`, `write`.
- **CLI:** When agents run in containers or git worktrees (e.g. [AgentCeption](https://github.com/cgcardona/agentception) engineer agents), install the Knowtation CLI in that environment, set `KNOWTATION_VAULT_PATH`, and run `knowtation ... --json`; parse output in the agent.

The vault acts as the **org brain**: agents read it for context (search → get-note with token-optimal retrieval) and can write back plans or summaries. See **docs/AGENT-ORCHESTRATION.md** for setup, patterns, and a write-back bridge example.

## Vault layout and format

- **Format:** Markdown + YAML frontmatter. Obsidian-style folder layout; the *format* is the contract, not the Obsidian app. You can use Obsidian, SilverBullet, Foam, VS Code, or any editor that works on this folder. Full frontmatter schema and project/tag normalization: **docs/SPEC.md §1–2**.
- **Folders:**  
  - `vault/inbox/` — Global raw captures (inbox frontmatter required).  
  - `vault/captures/` — Processed captures.  
  - `vault/projects/<project-slug>/` — Per-project notes (e.g. `born-free`, `dreambolt-network`); may contain `inbox/`.  
  - `vault/areas/`, `vault/archive/`, `vault/media/audio|video/`, `vault/templates/`, `vault/meta/`.
- **Project slug / tags:** Lowercase; `a-z0-9` and hyphen only (see SPEC).

## Multi-project and tags

- **One vault, many projects:** Notes live under `vault/projects/<name>/` and/or carry `project: <name>` and `tags: [a, b]` in frontmatter.
- **Scoped vs full:** By default, search and list-notes see the whole vault. Use `--project <name>` or `--tag <tag>` to restrict to a project or tag. All information remains available across projects; filters are for scope, not isolation.
- **Indexer:** Chunk and embed as today; store `project` and `tags` (from path and frontmatter) in vector store metadata so `search --project` and `list-notes --tag` are efficient (metadata filter or post-filter).

## Message interfaces (capture plugins)

- **Contract:** See **docs/SPEC.md §3**. Plugin writes Markdown notes to `vault/inbox/` or `vault/projects/<project>/inbox/` with required inbox frontmatter (`source`, `date`; `source_id` recommended for dedup). Filename and idempotency are plugin-defined; webhooks are allowed (same contract).
- **Discovery:** No built-in discovery. User runs plugins via cron, scheduler, or manual run; config can list which capture scripts or services run.
- **Built-in / recommended:** Telegram, WhatsApp, Discord; JIRA, Slack. Any other interface (Teams, email, custom) implements the same contract.

## Memory and AIR

- **Memory:** Optional (config: `memory.enabled`, `memory.provider`). Knowtation = *what you captured and wrote*; memory = *what the agent remembers*. Hooks: after search (store last query/results), after export (store provenance), optional `knowtation memory ...` subcommand. See **docs/SPEC.md §7**.
- **AIR:** Optional (config: `air.enabled`, `air.endpoint`). Required before: `write` outside inbox, `export`. Inbox writes exempt. Log AIR id with the action. See **docs/SPEC.md §7**.

## Optional integrations

- **Airtable:** Structured project data (tasks, campaigns, people). Agents can use Airtable MCP separately; optional sync of vault summaries into Airtable. Knowtation remains the primary context store.
- **Mem / Mem0 / SAME:** Implement the memory layer; plug in via config and SPEC §7 hooks.

## Intention and temporal understanding

- **Goal:** Give agents intention and an overarching view over time — temporal sequence, causation, long-horizon context. Many systems lack this; we spec it now to avoid backtracking.
- **Optional frontmatter:** `follows`, `causal_chain_id`, `entity`, `episode_id`, `summarizes`, `summarizes_range`, `state_snapshot` (see **docs/INTENTION-AND-TEMPORAL.md** and SPEC §2.3). Notes remain valid without them.
- **Optional CLI filters:** `--since`, `--until` (time range); `--chain`, `--entity`, `--episode` (causal/relational); `--order date|date-asc`. Indexer stores these in metadata when present.
- **Hierarchical memory:** Chunk → note → episode (optional) → project. State snapshots and summary notes support state space compression for long-horizon context. Evals reserved (optional `knowtation eval`).

## Backup and portability

- **Vault directory** = primary backup; copy/sync to move or backup. Optional: include `data/` and (redacted) config. Vault under git recommended for history. See **docs/SPEC.md §8**.

---

See **docs/SPEC.md** for the full specification; **docs/INTENTION-AND-TEMPORAL.md** for intention, temporal, causal, and eval design; **docs/STANDALONE-PLAN.md** for scenario coverage. Internal planning may live in **development/** (gitignored).
