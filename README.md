# Knowtation 📓

**Accurate context. Lowest cost. Your data.**

Knowtation (*know* + *notation*) was built to solve one problem: **agents waste tokens and get worse answers when retrieval is dumb.** Three mechanisms work together to fix this — two-step retrieval (narrow first, expand selectively), memory consolidation (compress history so future context is smaller), and memory-aware prompts (skip searches the agent already did). Everything else exists to make those levers practical: 14 importers, a 33-tool MCP server, five memory provider tiers, and an optional Hub — all backed by Markdown files you own.

---

## 💡 Why Knowtation exists

An agent that dumps 5,000 tokens of unfiltered context into every prompt is **expensive and inaccurate**. Knowtation gives agents the tools to fetch 500 tokens of the *right* context instead:

1. **Two-step retrieval** — Narrow search returns paths and snippets; selective `get-note` fetches only what matters. Filters (`--project`, `--tag`, `--since`, `--entity`) and token levers (`--fields`, `--snippet-chars`, `--count-only`) keep every request lean.
2. **Memory consolidation** — Raw memory events pile up; the consolidation engine merges them by topic into compact summaries via LLM, verifies them against vault state, and optionally discovers cross-topic insights. Future sessions start with summaries, not raw logs.
3. **Memory-aware prompts** — `resume-session`, `memory-informed-search`, and `memory-context` inject prior knowledge so agents avoid redundant searches and pick up where they left off.

The result: agents get **better answers at a fraction of the cost**, and that advantage compounds with every session.

---

## ✨ How Knowtation is different

Most knowledge tools put a database at the center. Knowtation puts **files** at the center.

- **Your vault is Markdown.** Open it in Obsidian, VS Code, Foam, SilverBullet, or any text editor. Version it with Git. Copy it to another machine. No export step, no vendor lock.
- **Agents get depth, not a thin wrapper.** 33 MCP tools, 23 resources, 13 prompts, a full CLI with JSON output, and a Hub REST API. Memory, consolidation, verification, proposals, enrichment, clustering, task extraction — not just search-and-return.
- **Memory compounds.** Five provider tiers (file, vector, Mem0, Supabase, encrypted), 15 event types, LLM consolidation, session summaries. Your agent's second question costs less than the first.
- **Trust is built in.** Proposals go through human review with rubric scoring. Attestation records can anchor to the Internet Computer blockchain for immutable audit.
- **Self-hosted or hosted.** Same codebase, same vault format. Migrate by copying a folder.

---

## 🚀 Quick start (~5 minutes)

**At a glance:** clone the repo → `npm install` → copy `config/local.example.yaml` to `config/local.yaml` (set **`vault_path`**, vector store, embeddings) → **`npm run index`** → run **`node cli/index.mjs search "your query"`**. Optional: **Hub** (`npm run hub`) and **MCP** (`npm run mcp`).

```bash
git clone https://github.com/aaronrene/knowtation.git
cd knowtation
npm install
```

**Configure:** Copy `config/local.example.yaml` to `config/local.yaml`. Set `vault_path` (absolute path to your vault). For vectors: `sqlite-vec` + `data_dir: data/` (zero extra servers) or `qdrant` + `qdrant_url`. Set embedding provider: Ollama (`ollama pull nomic-embed-text`) or OpenAI (`OPENAI_API_KEY` in `.env`).

```bash
npm run index          # index your vault
node cli/index.mjs search "your query"   # search it
```

**Hub (optional):**

```bash
cd hub && npm install && cd ..
npm run hub            # http://localhost:3333
```

**MCP (optional):**

```bash
npm run mcp            # stdio transport
# or
npm run mcp:http       # HTTP transport
```

**Detailed guides:** [Getting Started](./docs/GETTING-STARTED.md) | [Setup (full)](./docs/setup.md) | [Self-Hosted Checklist](./docs/SELF-HOSTED-SETUP-CHECKLIST.md) | [Hosted](./docs/TWO-PATHS-HOSTED-AND-SELF-HOSTED.md)

---

## 🧩 Feature highlights

### 📥 Imports — 14 sources, one vault

ChatGPT, Claude, Mem0, NotebookLM, Google Drive, Notion, Jira, Linear, MIF, Supabase, generic Markdown, audio (Whisper), video (Whisper), wallet/exchange CSV. Each import is idempotent with `source`, `source_id`, `date` frontmatter. Four capture channels (file, webhook, Slack/Discord/Telegram adapters) for live ingestion.

### 🔍 Search and retrieval

Semantic search (vector similarity) and keyword search over an indexed vault. Filters: `--project`, `--tag`, `--since`, `--until`, `--chain`, `--entity`, `--episode`. Token levers: `--fields`, `--snippet-chars`, `--count-only`, `--body-only`, `--frontmatter-only`. Designed for agents that need precision without over-fetch.

### 🧠 Memory — 5 providers, persistent recall

File (default), vector, Mem0, Supabase/pgvector, and AES-256-GCM encrypted. Fifteen event types captured automatically. CLI: `memory query|list|store|search|clear|export|stats|index|consolidate`. MCP: `memory_query`, `memory_store`, `memory_list`, `memory_search`, `memory_clear`, `memory_verify`, `memory_consolidate`, `memory_summarize`. Cross-vault or per-vault scope. Retention enforcement.

### 🔄 Consolidation daemon

Three-pass LLM engine: consolidate (merge by topic), verify (check against vault state), discover (surface insights). Runs as a background daemon with configurable interval and cost caps.

### 🤖 MCP — 33 tools, 23 resources, 13 prompts

Full vault operations, memory operations, Hub proposal operations. Resources for vault browsing, templates, media, index stats, graph, tags, projects, config, AIR log, and memory. Prompts for daily briefs, search synthesis, project summaries, meeting notes, knowledge gaps, causal chains, content plans, and memory-aware sessions. Hosted MCP adds role-gated access with OAuth 2.1.

### 🌐 Hub — proposals, review, collaboration

Web UI and REST API. Google/GitHub OAuth. Proposals with LLM-assisted enrichment and rubric scoring. Team roles (viewer, editor, admin), multi-vault, GitHub backup, settings, and Stripe billing.

### 🔏 Attestation and ICP

Intent attestation before writes and exports. HMAC-signed records with optional ICP blockchain anchoring for immutable, decentralized audit trails.

### 🔗 Wallet and blockchain

Import transaction CSVs from Coinbase, Binance, Ledger Live, and others. Per-transaction vault notes with chain, hash, amount, and date frontmatter — searchable and filterable alongside all other notes.

### 💳 Billing

Stripe-backed tiers (free, plus, growth, pro) with token packs, indexing quotas, consolidation pass limits, and note count caps. Shadow mode for usage tracking without enforcement.

---

## 🤝 Agent integration

Knowtation is designed as a **knowledge backend** for agents and orchestrators.

- **CLI:** `knowtation search|write|import|export|memory|propose ... --json` — same commands for humans and agents.
- **MCP:** 33 tools appear directly in Cursor, Claude Desktop, or any MCP-speaking runtime. Configure per [Agent Orchestration](./docs/AGENT-ORCHESTRATION.md).
- **Hub API:** REST with JWT auth. `KNOWTATION_HUB_TOKEN` for agent access. Proposals for human-in-the-loop review.
- **SKILL.md:** `.cursor/skills/knowtation/SKILL.md` teaches Cursor agents how to use Knowtation without tool-definition bloat.

See [Agent Integration](./docs/AGENT-INTEGRATION.md) for patterns and examples.

---

## 📂 Repository layout

```
knowtation/
├── README.md
├── ARCHITECTURE.md
├── cli/                  ← CLI entry point and routing
├── lib/                  ← Core library (search, memory, importers, AIR, etc.)
├── mcp/                  ← MCP server (33 tools, 23 resources, 13 prompts)
├── hub/                  ← Hub: gateway, bridge, ICP canister
│   ├── gateway/          ← Auth, billing, proxy, attestation
│   ├── bridge/           ← Vault operations, teams, import, memory
│   └── icp/              ← Motoko attestation canister
├── scripts/              ← Indexer, transcription, capture adapters, seeding
├── test/                 ← Test suite
├── config/               ← Example config (copy to local.yaml)
├── docs/                 ← Whitepaper, spec, guides, plans
├── web/                  ← Landing page and Hub web UI
│   └── hub/              ← Hub single-page app (HTML/CSS/JS)
├── vault/                ← Example vault structure (inbox, projects, media, …)
├── data/                 ← Generated index and memory data (gitignored)
└── .cursor/skills/       ← SKILL.md for agent discovery
```

---

## 📖 Documentation

| Document | What it covers |
|----------|----------------|
| **[Whitepaper](./docs/WHITEPAPER.md)** | Why vault-centric knowledge, thesis, full product inventory |
| **[Getting Started](./docs/GETTING-STARTED.md)** | Clone → config → index → search → Hub → MCP |
| **[Setup (full)](./docs/setup.md)** | Transcription, OAuth, memory, capture, all options |
| **[Spec](./docs/SPEC.md)** | Frontmatter, CLI commands/flags, config, MCP, contracts |
| **[Agent Integration](./docs/AGENT-INTEGRATION.md)** | CLI, MCP, Hub API patterns for agents |
| **[Agent Orchestration](./docs/AGENT-ORCHESTRATION.md)** | Multi-agent setup with Cursor/Claude |
| **[Import Sources](./docs/IMPORT-SOURCES.md)** | All 14 importers with formats and usage |
| **[Memory Consolidation](./docs/MEMORY-CONSOLIDATION-GUIDE.md)** | Consolidation daemon operation |
| **[Hub API](./docs/HUB-API.md)** | REST API, auth, proposals |
| **[Self-Hosted Checklist](./docs/SELF-HOSTED-SETUP-CHECKLIST.md)** | Step-by-step self-hosted setup |
| **[Hosted Deployment](./docs/DEPLOY-HOSTED.md)** | Hosted platform deployment |
| **[Two Paths](./docs/TWO-PATHS-HOSTED-AND-SELF-HOSTED.md)** | Self-hosted vs hosted comparison |
| **[Teams](./docs/TEAMS-AND-COLLABORATION.md)** | Team roles and collaboration |
| **[Retrieval Reference](./docs/RETRIEVAL-AND-CLI-REFERENCE.md)** | All CLI commands, token levers |
| **[Implementation Plan](./docs/IMPLEMENTATION-PLAN.md)** | Development phases and status |
| **[AI-Assisted Setup](./docs/AI-ASSISTED-SETUP.md)** | Phased prompts for Cursor, Windsurf, Claude Code, etc. |

Full docs index: **[docs/README.md](./docs/README.md)**

---

## ✅ Prerequisites

- **Node.js 18+**
- **Ollama** (optional, for local embeddings): [ollama.ai](https://ollama.ai) → `ollama pull nomic-embed-text`
- **OpenAI API key** (alternative embeddings, transcription): set `OPENAI_API_KEY` in `.env`

---

## 🧭 Set up with an AI coding assistant

Knowtation can be installed and configured entirely through an AI-powered IDE. The **[AI-Assisted Setup Guide](./docs/AI-ASSISTED-SETUP.md)** provides copy-paste prompts organized into eight phases:

| Phase | What it does | Time |
|-------|-------------|------|
| 1. Clone & configure | Repo, dependencies, `config/local.yaml` | ~3 min |
| 2. Index & search | Embed vault, verify semantic search | ~2 min |
| 3. Hub (optional) | Web UI, proposals, settings | ~3 min |
| 4. MCP server | Connect agents to your vault | ~2 min |
| 5. Memory (optional) | Persistent recall across sessions | ~2 min |
| 6. Import (optional) | Bring in ChatGPT, Claude, Notion, audio, etc. | ~5 min |
| 7. Consolidation (optional) | Background memory improvement | ~2 min |
| 8. Git backup (optional) | Version your vault | ~2 min |

Works with **Cursor**, **Windsurf**, **Claude Code**, **GitHub Copilot Workspace**, **Cline**, **Continue**, **Aider**, and any MCP-capable agent. Each prompt is self-contained — paste it into your assistant's chat and follow along.

---

## 🙌 Contributing

Contributions welcome. Please open an issue or PR on [GitHub](https://github.com/aaronrene/knowtation).

## ⚖️ License

Use and extend as you like. See LICENSE file for details.
