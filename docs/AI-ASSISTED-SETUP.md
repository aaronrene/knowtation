# AI-Assisted Setup Guide

Set up Knowtation with the help of an AI coding assistant. This guide provides **copy-paste prompts** organized into phases so your assistant handles the details while you make the decisions.

---

## Compatible AI IDEs and agents

This guide works with any AI-powered development environment that can run terminal commands and edit files:

- **Cursor** (recommended — includes SKILL.md auto-discovery)
- **Windsurf**
- **Claude Code**
- **GitHub Copilot Workspace**
- **Cline / Continue / Aider**
- **Any MCP-capable agent** that can execute shell commands

The prompts below are IDE-agnostic. Paste them into your assistant's chat and follow along.

---

## Before you start

**What you need:**
- Node.js 18+ installed
- A terminal
- An AI IDE with the Knowtation repo open
- (Optional) An OpenAI API key for transcription and cloud embeddings
- (Optional) Ollama installed for local embeddings

**Time estimate:** ~15 minutes with an AI assistant (vs ~30 minutes manually).

---

## Phase 1 — Clone, install, and configure (~3 minutes)

Paste this prompt into your AI assistant:

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

**What this does:** Sets up the repo, dependencies, and your personal config file. The assistant will ask you for your vault path and embedding preference.

---

## Phase 2 — Index and verify search (~2 minutes)

```
Now index my vault and verify search works:

1. If I'm using Ollama, make sure it's running (ollama serve) and the model is pulled (ollama pull nomic-embed-text)
2. Run: npm run index
3. Test search: node cli/index.mjs search "test query" --json
4. Test listing: node cli/index.mjs list-notes --limit 5 --json
5. Show me the results and confirm indexing worked (check note count and chunk count)
```

**What this does:** Embeds your vault content into the vector store and confirms semantic search returns results.

---

## Phase 3 — Hub setup (optional, ~3 minutes)

Skip this phase if you only want CLI/MCP access.

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

**What this does:** Starts the Hub web interface where you can browse notes, review proposals, manage settings, and run searches from a browser.

---

## Phase 4 — MCP server for AI agents (~2 minutes)

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

**What this does:** Connects your vault to any MCP-compatible AI agent. After this, your assistant can search, read, and write to your vault through MCP tools.

**Cursor-specific:** Knowtation includes a SKILL.md at `.cursor/skills/knowtation/SKILL.md` that Cursor auto-discovers when the repo is open. This teaches the agent how to use Knowtation commands without needing MCP.

---

## Phase 5 — Memory layer (optional, ~2 minutes)

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

**What this does:** Enables persistent memory so agents remember what they searched, wrote, and exported across sessions. The consolidation daemon can later compress these events into insights.

---

## Phase 6 — Import existing knowledge (optional, ~5 minutes)

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

**What this does:** Brings your existing knowledge from other platforms into one vault. Each import is idempotent — safe to re-run.

---

## Phase 7 — Consolidation daemon (optional, ~2 minutes)

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

---

## Phase 8 — Vault Git backup (optional, ~2 minutes)

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

---

## Verification checklist

After completing the phases you chose, paste this final prompt:

```
Run a health check on my Knowtation setup. For each item, tell me pass/fail:

1. Config: read config/local.yaml and confirm vault_path exists and is accessible
2. Index: run "node cli/index.mjs search 'test' --count-only --json" and confirm it returns a count
3. Memory (if enabled): run "node cli/index.mjs memory stats --json" and confirm events object exists
4. Hub (if set up): curl http://localhost:3333/health and confirm response
5. MCP (if configured): confirm npm run mcp starts without error
6. Show me a summary of what's working and what needs attention
```

---

## Troubleshooting prompts

If something goes wrong, paste the relevant prompt:

**Search returns zero results:**
```
My Knowtation search returns no results. Debug this:
1. Check if the vault has any .md files: find <vault_path> -name "*.md" | head -10
2. Check index stats: node cli/index.mjs search "anything" --count-only --json
3. Check if embedding provider is running (Ollama: curl http://localhost:11434/api/tags)
4. If needed, re-index: npm run index -- and show me the output
```

**Hub won't start:**
```
The Knowtation Hub won't start. Debug this:
1. Check if port 3333 is already in use: lsof -i :3333
2. Verify environment variables: echo $KNOWTATION_VAULT_PATH, echo $HUB_JWT_SECRET
3. Check hub/node_modules exists (run: cd hub && npm install && cd ..)
4. Try starting with verbose output: NODE_DEBUG=http npm run hub
5. Show me any error messages
```

**Memory not capturing events:**
```
Knowtation memory isn't capturing events. Debug this:
1. Check config: is memory.enabled true in config/local.yaml?
2. Check memory dir exists: ls data/memory/
3. Run a search and check if an event was stored: node cli/index.mjs search "test" && node cli/index.mjs memory list --limit 1 --json
4. If using vector/mem0/supabase provider, verify the connection
```

---

## Next steps

Once your setup is verified:

- **Read the whitepaper** for the full thesis and architecture: [docs/WHITEPAPER.md](./WHITEPAPER.md)
- **Explore MCP tools** in your AI IDE — try `search`, `memory_query`, `daily-brief` prompt
- **Set up imports** from your existing tools: [docs/IMPORT-SOURCES.md](./IMPORT-SOURCES.md)
- **Review the CLI reference** for all commands and flags: [docs/RETRIEVAL-AND-CLI-REFERENCE.md](./RETRIEVAL-AND-CLI-REFERENCE.md)
- **Configure team access** if collaborating: [docs/TEAMS-AND-COLLABORATION.md](./TEAMS-AND-COLLABORATION.md)

---

*This guide is designed to be pasted into any AI coding assistant. The prompts are self-contained — your assistant has everything it needs to execute each phase.*
