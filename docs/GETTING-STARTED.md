# Getting started

This page is the shortest path from **clone** to **using** Knowtation: CLI, search, optional Hub and landing, and **AgentCeption** integration with examples.

---

## Two ways to follow the same setup

| Path | Order | Best for |
|------|--------|----------|
| **This doc (CLI-first)** | §1 Clone → §2 Configure → §3 Index & search → §4 Hub → … | Terminal, agents, MCP |
| **Hub UI (“How to use”)** | Seven steps in the app: vault & config → run Hub → log in → **index & search** → import → use & automate → GitHub backup | Browser-first self-hosted |

Both use the **same** `config/local.yaml`, `.env`, and vault folder. **Hosted** users (knowtation.store) skip local vault, Hub install, and local indexing — we run search for you. **Self-hosted:** semantic search needs §3 (index) after config; listing notes in the Hub works without indexing.

**Longer guides:** [setup.md](./setup.md) · [TWO-PATHS-HOSTED-AND-SELF-HOSTED.md](./TWO-PATHS-HOSTED-AND-SELF-HOSTED.md#quick-start-self-hosted) · [SELF-HOSTED-SETUP-CHECKLIST.md](./SELF-HOSTED-SETUP-CHECKLIST.md)

---

## Prerequisites

- **Node.js 18+**
- **Ollama** (for semantic search): [ollama.ai](https://ollama.ai) → install → run `ollama pull nomic-embed-text`.  
  Or use **OpenAI** embeddings: set `OPENAI_API_KEY` in `.env` and `embedding: { provider: openai, model: text-embedding-3-small }` in config.

---

## 1. Clone and install

```bash
git clone https://github.com/aaronrene/knowtation.git
cd knowtation
npm install
```

---

## 2. Configure

**Config (required for CLI and search):**

```bash
cp config/local.example.yaml config/local.yaml
```

Edit `config/local.yaml`:

- **vault_path** — Absolute path to the vault. From repo root you can use the repo’s vault, e.g.  
  `vault_path: /Users/you/knowtation/vault`  
  (or `$(pwd)/vault` if your shell expands it when you run commands from repo root).
- **Vector store** — **`sqlite-vec`** + `data_dir: data/` stores vectors in a local SQLite file (no Qdrant server). **Or** use **`qdrant`** + `qdrant_url:` if you run Qdrant separately. Same purpose; different deployment.
- **Embedding** — **Ollama** (local) or **OpenAI** (API key in `.env`) turns text into vectors — this is for search, not chat. For Ollama (default):
  ```yaml
  embedding:
    provider: ollama
    model: nomic-embed-text
  ```

Do **not** commit `config/local.yaml`.

**Secrets (optional):**

```bash
cp .env.example .env
```

Add keys as needed (e.g. `OPENAI_API_KEY` for transcription, `HUB_JWT_SECRET` for the Hub). Do not commit `.env`.

---

## 3. Index and search

**Index once** (builds the vector store so **semantic search** works in the CLI and in the self-hosted Hub **Search vault**). Requires Ollama running with your chosen model, or `OPENAI_API_KEY` if you use OpenAI embeddings in config:

```bash
npm run index
```

Or:

```bash
node cli/index.mjs index
```

**Try search:**

```bash
node cli/index.mjs search "your query"
```

**Other useful commands:**

```bash
node cli/index.mjs --help
node cli/index.mjs list-notes
node cli/index.mjs get-note vault/inbox/foo.md
node cli/index.mjs write vault/notes/new-note.md --stdin   # pipe body
```

You can also use the `knowtation` binary if you install globally or use `npx knowtation` from the repo.

---

## 4. Optional: Hub (web UI)

From repo root:

```bash
cd hub && npm install && cd ..
```

Set in `.env`:

- `KNOWTATION_VAULT_PATH` — same as `vault_path` in config (absolute path to `vault/`).
- `HUB_JWT_SECRET` — any long random string (required for the Hub).

Start the Hub:

```bash
npm run hub
```

Open **http://localhost:3333/** in a browser. You get the Rich Hub UI (list notes, search, proposals, settings). **Demo notes:** the repo includes **`vault/showcase/`** (inbox, projects, areas, tags)—visible immediately when `vault_path` points at this vault. **Hosted:** seed the same folder with `npm run seed:hosted-showcase` after login; see [SHOWCASE-VAULT.md](./SHOWCASE-VAULT.md). **OAuth:** credentials are **not** in the repo — register your own Google/GitHub OAuth app and add `GOOGLE_*` / `GITHUB_*` to `.env` plus callback URLs; see [hub/README.md](../hub/README.md). **Search in the Hub:** after §3 index (or **Re-index** in the UI), **Search vault** uses the same vector store as the CLI. In-app walkthrough: **How to use** (seven steps, matches [TWO-PATHS](./TWO-PATHS-HOSTED-AND-SELF-HOSTED.md#quick-start-self-hosted)).

---

## 5. Optional: Landing page (static site)

From repo root:

```bash
npx -y serve web -p 8888
```

Open **http://localhost:8888** for the landing page; **http://localhost:8888/hub/** for the static Hub UI (same content as the Node Hub when configured).

---

## 6. Optional: MCP (for Cursor / Claude)

Run the MCP server:

```bash
npm run mcp
```

Configure your Cursor or Claude Desktop MCP config to point at this server. Then tools like `search`, `get_note`, `list_notes`, `write` appear for the agent. See [AGENT-ORCHESTRATION.md](./AGENT-ORCHESTRATION.md).

---

## AgentCeption

[AgentCeption](https://github.com/cgcardona/agentception) turns a brain dump into a structured plan (PlanSpec), GitHub issues, and an agent org (CTO → coordinators → engineers) that work in isolated worktrees and open PRs. **Knowtation** acts as a shared context and memory layer: one vault for specs, decisions, and phase summaries; semantic search and filters so agents get a small, relevant slice; and write-back so the org’s understanding accumulates without blowing context windows.

### How AgentCeption uses Knowtation

| Who | How |
|-----|-----|
| **Planner / CTO** | MCP or CLI: search vault for brain dump or spec, pull context before creating PlanSpec. |
| **Engineer agents (worktrees)** | CLI only (no MCP in worktrees): `knowtation search ... --json`, then `get-note` for chosen paths. |
| **After each phase** | Write phase summaries and decisions into the vault with `knowtation write` or the bridge script; next phases can search them. |

### Example: Engineer agent (CLI in a worktree)

Agents in worktrees usually don’t have MCP. Use the CLI with `--json` and keep payloads small: get paths first, then fetch only the notes you need.

**1. Search for relevant context (paths only to save tokens):**

```bash
knowtation search "auth flow decisions" --project myapp --limit 3 --fields path --json
```

**2. Fetch full content only for the path(s) you need:**

```bash
knowtation get-note vault/projects/myapp/decisions/auth.md --json
```

**3. Write a phase summary back to the vault:**

```bash
echo "Phase 1: Implemented auth module; JWT in cookie; next: rate limiting." | \
  knowtation write vault/projects/myapp/decisions/phase-1.md --stdin \
  --frontmatter source=agentception date=2026-03-15 project=myapp
```

**4. Optional: use the bridge script (pipes content into vault with frontmatter):**

```bash
echo "Phase 1 summary: ..." | ./scripts/write-to-vault.sh vault/projects/myapp/decisions/phase-1.md --source agentception --project myapp
```

After writing, run `knowtation index` (or `npm run index`) so new content is searchable.

### Example: Orchestrator / CTO (MCP)

If the planner or CTO runs in Cursor or Claude with MCP:

1. Run `knowtation mcp` (or add the Knowtation MCP server to your Cursor/Claude config).
2. Set `KNOWTATION_VAULT_PATH` to the shared vault directory.
3. Use tools: **search**, **get_note**, **list_notes**, **write**, **index**, etc.

The orchestrator can search the vault before creating the PlanSpec, and coordinators can query for project context; all use the same tools.

### Example: Two-step fetch (token-efficient)

Use narrow scope and light responses first, then full content only when needed:

```bash
# Step 1: Get only paths, limit 3
knowtation search "API error handling" --project myapp --limit 3 --fields path --json

# Step 2: From the JSON output, pick the single path that matters and fetch it
knowtation get-note vault/projects/myapp/decisions/errors.md --json
```

This pattern (search with `--fields path` and small `--limit`, then `get-note` for 1–2 paths) keeps token cost down. See [RETRIEVAL-AND-CLI-REFERENCE.md](./RETRIEVAL-AND-CLI-REFERENCE.md) and [AGENT-INTEGRATION.md](./AGENT-INTEGRATION.md).

### AgentCeption workflow summary

1. **Input** — Put the brain dump or spec in the vault (e.g. `vault/projects/myapp/spec.md`) or import from ChatGPT/Claude.
2. **PlanSpec** — Planner pulls from vault via search / get-note; creates PlanSpec; AgentCeption runs as usual.
3. **Execution** — Engineer agents in worktrees call `knowtation search ... --json` for project context; use `get-note` for chosen paths.
4. **Write-back** — Pipe phase summaries into `knowtation write ... --stdin` with `source=agentception`, `project`, `date`; next phases can search them.
5. **Index** — Run `knowtation index` after writes so new content is in the vector store.

No change to the orchestrator’s core flow; Knowtation is an optional **context and memory layer** called via CLI or MCP. See [AGENT-INTEGRATION.md](./AGENT-INTEGRATION.md) and [AGENT-ORCHESTRATION.md](./AGENT-ORCHESTRATION.md).

---

## Next steps

- **Self-hosted checklist** — Quick start → config → index → OAuth → GitHub backup (How to use **Step 7**): [SELF-HOSTED-SETUP-CHECKLIST.md](./SELF-HOSTED-SETUP-CHECKLIST.md).
- **Full setup** — Transcription, OAuth, memory, capture: [setup.md](./setup.md).
- **Spec and CLI** — [SPEC.md](./SPEC.md), [RETRIEVAL-AND-CLI-REFERENCE.md](./RETRIEVAL-AND-CLI-REFERENCE.md).
- **Hub API** — [HUB-API.md](./HUB-API.md), [hub/README.md](../hub/README.md).
- **Agents** — [AGENT-ORCHESTRATION.md](./AGENT-ORCHESTRATION.md), [AGENT-INTEGRATION.md](./AGENT-INTEGRATION.md).
