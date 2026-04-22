# 🤖 AI-Assisted Setup Guide

Set up Knowtation with an AI coding assistant. Each phase below has a **simple title**, a **one-line goal**, a **copy-paste prompt**, then **technical notes** in short bullets so nothing feels like a wall of text.

**How to use this page:** If you use the **hosted Hub** at [knowtation.store](https://knowtation.store/hub/), read **[Hosted Hub](#hosted-hub-knowtationstore)** first. The numbered **phases** below are for **self-hosted** installs (clone repo, local vault, `npm run hub`). Pick a phase → paste the prompt into your assistant → skim the technical notes only if something fails or you want to know *why*.

---

## ☁️ Hosted Hub (knowtation.store)

**Goal:** Sign in, copy integration values for your AI tools, and know where **agent and CLI edits** wait for you ([human gate](./AGENT-INTEGRATION.md#4-proposals-review-before-commit): proposals stay out of the canonical vault until approval).

**You need**

- A browser
- A Google or GitHub account (sign-in)

**Steps in the Hub**

1. Open the hosted Hub (for example **[https://knowtation.store/hub/](https://knowtation.store/hub/)** — or your operator’s `/hub/` URL if different).
2. **Sign in** with Google or GitHub.
3. Open **Settings → Integrations**. Copy what your assistant needs:
   - **Hub base URL** — gateway root for REST and MCP.
   - **Bearer token** and **vault id** — used as `Authorization: Bearer …` and `X-Vault-Id` on requests (see [AGENT-INTEGRATION.md](./AGENT-INTEGRATION.md)).
   - **Copy MCP** — paste into your MCP client configuration.
   - **Copy prime** — small JSON for MCP bootstrap; after your client connects to MCP, it can `readResource` **`knowtation://hosted/prime`**. The prime blob does **not** contain your JWT.
4. **Review proposals** — Queued edits from agents or the CLI appear under the **Suggested** tab (also reachable from the **Suggested** button in the header when signed in). Approve writes to the vault or discard. See [WHITEPAPER.md](./WHITEPAPER.md) (product framing) and [AGENT-INTEGRATION.md §4](./AGENT-INTEGRATION.md#4-proposals-review-before-commit).
5. **In-app help** — Click **How to use** in the header for guides: **Getting started** (includes **Open setup walkthrough** — the onboarding wizard), **Setup**, **Knowledge & agents** (includes a short take on linked notes, synthesis, and a link to **popular prompts** on GitHub), and more. Full prompt list: [POPULAR-PROMPTS-AND-STARTERS.md](./POPULAR-PROMPTS-AND-STARTERS.md).

**Paste this prompt into your assistant**

```
I'm using Knowtation on the hosted Hub in the browser (not a local clone). Help me:
1. Confirm I can sign in and open Settings → Integrations.
2. Explain what to copy: Hub base URL, Bearer token, vault id, Copy MCP, and Copy prime — and that prime is read after MCP connects (no JWT in the prime blob).
3. Tell me where to review agent/CLI proposals (Suggested tab) and point to docs/AGENT-INTEGRATION.md §4 (human gate).
4. Mention the in-app How to use modal and the setup walkthrough wizard for onboarding.
```

**Technical notes**

- Hosted OAuth and gateway configuration are operator concerns; you do not need `config/local.yaml` on your PC for the cloud vault.
- Client-specific MCP wiring beyond the copy buttons: [AGENT-INTEGRATION.md](./AGENT-INTEGRATION.md), [AGENT-ORCHESTRATION.md](./AGENT-ORCHESTRATION.md).
- Running your **own** Hub on localhost or a server follows **Phase 1–4** below and [setup.md](./setup.md).

---

## 🖥️ Compatible AI IDEs and agents

Works anywhere you can run shell commands and edit files:

- **Cursor** (recommended — auto-discovers `.cursor/skills/knowtation/SKILL.md`)
- **Windsurf**, **Claude Code**, **GitHub Copilot Workspace**
- **Cline / Continue / Aider**
- **Any MCP-capable agent** that can execute commands

Prompts are IDE-agnostic unless noted.

**Popular starters (all assistants):** For a **printable** list of MCP prompt names, **copy-paste** instructions that work even without MCP, and **CLI** one-liners (search, propose, consolidate, etc.), use **[POPULAR-PROMPTS-AND-STARTERS.md](./POPULAR-PROMPTS-AND-STARTERS.md)**. The **Hosted Hub** also links to the same page from **How to use → Knowledge & agents** (short summary in-app, full detail on GitHub).

---

## ✅ Before you start

**Goal:** Confirm you have the basics before phase 1.

**You need** (skip Node and the repo if you only use the browser Hub — see [Hosted Hub](#hosted-hub-knowtationstore))
- Node.js **18+**
- A terminal
- This repo open in your AI IDE
- *(Optional)* `OPENAI_API_KEY` — cloud embeddings + transcription
- *(Optional)* **Ollama** — local embeddings (`nomic-embed-text`)

**Time:** ~15 minutes with an assistant (~30 manual).

**Technical notes**
- Knowtation never requires committing `config/local.yaml` or `.env`.
- Default path in docs assumes repo root as current directory.

---

## 📦 Phase 1 — Clone, install, and configure (~3 min)

**Goal:** Dependencies installed + `config/local.yaml` points at your vault.

**Paste this prompt into your assistant**

```
Clone and set up Knowtation for local use. Run these steps in order:

1. Clone: git clone https://github.com/aaronrene/knowtation.git && cd knowtation && npm install
2. Copy config/local.example.yaml to config/local.yaml
3. In config/local.yaml, set:
   - vault_path: <absolute path to where I want my vault> (create the directory if needed)
   - vector_store: sqlite-vec
   - data_dir: data/
   - embedding provider: ollama with model nomic-embed-text (or openai with text-embedding-3-small if I have OPENAI_API_KEY)
4. If I'm using OpenAI, create .env from .env.example and set OPENAI_API_KEY
5. Do NOT commit config/local.yaml or .env

Show me the final config before moving on.
```

**Technical notes**
- **`sqlite-vec`** keeps vectors on disk under `data/` — no separate vector DB process.
- **Ollama:** run `ollama serve` and `ollama pull nomic-embed-text` before first index if you pick Ollama.
- **`vault_path`** must be absolute on most setups.

---

## 🔎 Phase 2 — Index and verify search (~2 min)

**Goal:** Embeddings built; search returns real rows.

**Paste this prompt**

```
Now index my vault and verify search works:

1. If I'm using Ollama, make sure it's running (ollama serve) and the model is pulled (ollama pull nomic-embed-text)
2. Run: npm run index
3. Test search: node cli/index.mjs search "test query" --json
4. Test listing: node cli/index.mjs list-notes --limit 5 --json
5. Show me the results and confirm indexing worked (check note count and chunk count)
```

**Technical notes**
- Re-run **`npm run index`** after bulk imports or config changes to embedding model.
- **`--json`** makes output agent-friendly; omit for human-readable CLI text.

---

## 🌐 Phase 3 — Hub setup (optional, ~3 min)

**Goal:** Browser UI at `http://localhost:3333` for **self-hosted** installs.

Skip if you only want CLI/MCP. **Hosted** users already use the Hub in the browser ([Hosted Hub](#hosted-hub-knowtationstore)); this phase runs the Hub from a clone.

**Paste this prompt**

```
Set up the Knowtation Hub for web-based access:

1. cd hub && npm install && cd ..
2. Set these environment variables (in .env or shell):
   - KNOWTATION_VAULT_PATH=<same vault path from config>
   - HUB_JWT_SECRET=<generate a random 64-char secret>
   - SESSION_SECRET=<generate a random 32-char secret>
3. Run: npm run hub
4. Open http://localhost:3333 and confirm the Hub loads
5. Show me the startup logs so I can verify everything connected

For OAuth (Google/GitHub sign-in), I'll need my own OAuth app credentials later.
See docs/setup.md for OAuth configuration details.
```

**Technical notes**
- **OAuth** is optional for local smoke tests; full sign-in flow needs app credentials (see [setup.md](./setup.md)).
- Port **3333** must be free; change in hub config if you collide.

---

## 🔌 Phase 4 — MCP server for AI agents (~2 min)

**Goal:** Your IDE can call Knowtation’s **33 tools** over MCP.

**Paste this prompt**

```
Set up the Knowtation MCP server so AI agents can use my vault:

1. Test the MCP server starts: npm run mcp (it should connect via stdio)
2. Show me the MCP config I need to add to my AI IDE:
   - For Cursor: show the .cursor/mcp.json configuration
   - For Claude Desktop: show the claude_desktop_config.json snippet
   - For other MCP clients: show the generic stdio config
3. The server exposes 33 tools, 23 resources, and 13 prompts — list the key ones I should know about

Reference: docs/AGENT-ORCHESTRATION.md has full MCP configuration examples.
```

**Technical notes**
- **Cursor:** `.cursor/skills/knowtation/SKILL.md` teaches the agent Knowtation patterns even before MCP is wired.
- **HTTP MCP:** `npm run mcp:http` when your client needs a URL instead of stdio.
- Full examples: [AGENT-ORCHESTRATION.md](./AGENT-ORCHESTRATION.md).

---

## 🧠 Phase 5 — Memory layer (optional, ~2 min)

**Goal:** Persistent **memory** events across sessions.

**Paste this prompt**

```
Enable the Knowtation memory layer so my agents have persistent recall:

1. In config/local.yaml, add:
   memory:
     enabled: true
     provider: file        # or: vector, mem0, supabase
     retention_days: 90    # null = keep forever
2. Restart the Hub if it's running
3. Test memory: node cli/index.mjs memory stats --json
4. Test storing: node cli/index.mjs memory store '{"type":"user","data":{"note":"test memory"}}'
5. Test listing: node cli/index.mjs memory list --limit 5 --json
6. Confirm memory is working

For encrypted memory, also set:
   memory.encrypt: true
   KNOWTATION_MEMORY_SECRET=<your-secret> in .env
```

**Technical notes**
- **`provider: file`** is the simplest; **vector / Mem0 / Supabase** scale up with extra config.
- **Encryption:** set `KNOWTATION_MEMORY_SECRET` in `.env`; never commit it.
- Consolidation (phase 7) compresses these events later.

---

## 📥 Phase 6 — Import existing knowledge (optional, ~5 min)

**Goal:** External exports land in your vault as Markdown + frontmatter.

**Paste this prompt**

```
Help me import my existing knowledge into Knowtation. I want to import from:
[Tell your assistant which sources you have. Options:]
- ChatGPT export (conversations.json from OpenAI data export)
- Claude export (markdown folder from Anthropic)
- Mem0 export (JSON)
- Notion pages (needs NOTION_API_KEY)
- Google Drive docs (exported markdown folder)
- NotebookLM (markdown or JSON)
- Jira CSV export
- Linear CSV export
- Audio files (needs OPENAI_API_KEY for Whisper transcription)
- Wallet/exchange CSV (Coinbase, Binance, Ledger Live, etc.)
- Generic markdown files or folders

For each source:
1. Run: node cli/index.mjs import <source-type> <input-path> --dry-run --json
2. Show me what would be imported (dry run)
3. If it looks good, run without --dry-run
4. After all imports, re-index: npm run index

Reference: docs/IMPORT-SOURCES.md has formats and details for each source.
```

**Technical notes**
- Imports are **idempotent** (`source`, `source_id`, `date` in frontmatter).
- Always **`npm run index`** after large imports.
- Per-source flags and formats: [IMPORT-SOURCES.md](./IMPORT-SOURCES.md).

---

## 🔄 Phase 7 — Consolidation daemon (optional, ~2 min)

**Goal:** Background job merges memory events (and optional **Discover** insights).

**Paste this prompt**

```
Set up the consolidation daemon for automatic memory improvement:

1. In config/local.yaml, ensure memory is enabled (Phase 5)
2. Start the daemon: node cli/index.mjs daemon start
3. Check status: node cli/index.mjs daemon status
4. Show me the daemon log: node cli/index.mjs daemon log --tail 20
5. Test a manual consolidation: node cli/index.mjs memory consolidate --dry-run

The daemon runs three passes:
- Consolidate: group events by topic, merge facts
- Verify: check memories against current vault state
- Discover: surface insights, contradictions, and open questions
```

**Technical notes**
- **Discover** adds LLM cost; often off until you want cross-topic insights.
- Hosted deployments may enforce cooldowns and cost caps — see [MEMORY-CONSOLIDATION-GUIDE.md](./MEMORY-CONSOLIDATION-GUIDE.md).

---

## 📤 Phase 8 — Vault Git backup (optional, ~2 min)

**Goal:** Vault directory tracked and pushable to a remote.

**Paste this prompt**

```
Set up Git backup for my vault:

1. In config/local.yaml, add:
   vault:
     git:
       enabled: true
       remote: <my-vault-git-repo-url>
       auto_commit: false
       auto_push: false
2. Initialize git in my vault directory if not already done
3. Test sync: node cli/index.mjs vault sync
4. Confirm the vault committed and pushed to the remote
```

**Technical notes**
- Start with **`auto_commit: false`** until you trust the flow.
- Remote URL is your **vault** repo, not necessarily the Knowtation app repo.

---

## ✔️ Verification checklist

**Goal:** One prompt to sanity-check everything you enabled.

**Paste this prompt**

```
Run a health check on my Knowtation setup. For each item, tell me pass/fail:

1. Config: read config/local.yaml and confirm vault_path exists and is accessible
2. Index: run "node cli/index.mjs search 'test' --count-only --json" and confirm it returns a count
3. Memory (if enabled): run "node cli/index.mjs memory stats --json" and confirm events object exists
4. Hub (if set up): curl http://localhost:3333/health and confirm response
5. MCP (if configured): confirm npm run mcp starts without error
6. Show me a summary of what's working and what needs attention
```

**Technical notes**
- **`/health`** path assumes default Hub; adjust host/port if you customized them.

---

## 🔧 Troubleshooting prompts

**Goal:** Drop-in debug prompts — still one block per issue.

**Search returns zero results**

```
My Knowtation search returns no results. Debug this:
1. Check if the vault has any .md files: find <vault_path> -name "*.md" | head -10
2. Check index stats: node cli/index.mjs search "anything" --count-only --json
3. Check if embedding provider is running (Ollama: curl http://localhost:11434/api/tags)
4. If needed, re-index: npm run index -- and show me the output
```

**Hub won't start**

```
The Knowtation Hub won't start. Debug this:
1. Check if port 3333 is already in use: lsof -i :3333
2. Verify environment variables: echo $KNOWTATION_VAULT_PATH, echo $HUB_JWT_SECRET
3. Check hub/node_modules exists (run: cd hub && npm install && cd ..)
4. Try starting with verbose output: NODE_DEBUG=http npm run hub
5. Show me any error messages
```

**Memory not capturing events**

```
Knowtation memory isn't capturing events. Debug this:
1. Check config: is memory.enabled true in config/local.yaml?
2. Check memory dir exists: ls data/memory/
3. Run a search and check if an event was stored: node cli/index.mjs search "test" && node cli/index.mjs memory list --limit 1 --json
4. If using vector/mem0/supabase provider, verify the connection
```

---

## 🧭 Next steps

- **Hosted path:** [WHITEPAPER.md](./WHITEPAPER.md) (positioning), [TOKEN-SAVINGS.md](./TOKEN-SAVINGS.md) (cost discipline), [Hosted Hub](#hosted-hub-knowtationstore) above
- **Whitepaper (thesis + depth):** [WHITEPAPER.md](./WHITEPAPER.md)
- **MCP tools to try:** `search`, `memory_query`, **`daily-brief`** prompt
- **Imports:** [IMPORT-SOURCES.md](./IMPORT-SOURCES.md)
- **All CLI flags:** [RETRIEVAL-AND-CLI-REFERENCE.md](./RETRIEVAL-AND-CLI-REFERENCE.md)
- **Teams / roles:** [TEAMS-AND-COLLABORATION.md](./TEAMS-AND-COLLABORATION.md)

---

*Prompts are self-contained — your assistant can run each phase end-to-end. Technical notes are optional reading.*
