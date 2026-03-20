# Plan: GitHub, agents, and human knowledge — clarity before build

This document answers three questions and recommends a clear path so both you and your users know: (1) how GitHub fits in, (2) how agents vs humans interact with the vault/repo, and (3) how human-provided knowledge is consumed by agents and how we explain it (including how-to, menu items, and future chatbot/local-model settings). **No implementation yet** — plan and advise first.

---

## 1. How do users interact with their GitHub repositories within Knowtation? Is there a clear project or repository to start?

### Two different concepts (keep them explicit)

| Term in Knowtation | Meaning | Count per Hub instance |
|--------------------|--------|--------------------------|
| **Vault** | The folder of Markdown notes (your knowledge base). One root path, e.g. `./vault` or `~/knowtation-vault`. | **One** |
| **Git backup repository** | The GitHub (or other) repo where that **entire vault** is pushed for backup and version history. Set in **Settings → Backup** (Git remote URL). | **One** |
| **Project** | A **logical grouping inside the vault**: either a folder `vault/projects/<slug>/` or frontmatter `project: <slug>` on any note. Used for filtering (search, list-notes, Hub UI). | **Many** |

So:

- **One vault** → **one Git repo** for backup. That’s the only “repository” users configure in Knowtation (via Setup / Connect GitHub).
- **Projects** are not GitHub repos; they are labels/folders inside the vault so users and agents can filter (e.g. “everything for project myapp”).

### Recommended clarity for users

- **Starting point:** “You have one vault (your notes). Optionally, you connect one GitHub repo to back it up. Inside the vault you organize by projects (folders or tags) so you and agents can filter.”
- **Where to say it:** In **How to use** (and in any new “Knowledge & agents” section): add one short subsection that states:
  - One vault, one backup repo (Settings → Backup).
  - Projects = way to organize and filter inside the vault; they are not separate GitHub repos.

No new product concept is required; we only make the distinction explicit in copy and one diagram if helpful.

---

## 2. How will agent interaction with repositories be differentiated?

Agents do **not** interact with GitHub directly. They interact with the **vault** (read/write). The human (or automation they control) is responsible for backup to GitHub.

### Who does what

| Actor | Interacts with vault | Interacts with Git backup |
|-------|----------------------|----------------------------|
| **Human** | Hub UI: browse, search, + New note, approve/discard proposals. CLI/API if they want. | Sets remote in Settings; clicks “Back up now” or uses auto_commit/auto_push. “Connect GitHub” stores token for push. |
| **Agent** | CLI, MCP, or Hub API: search, list-notes, get-note, write, or **create proposals**. | No direct access. After human approves a proposal, Hub (or sync job) can commit/push. |

So differentiation is:

1. **Proposals** — Agent-originated changes are created as proposals; human approves or discards in the Hub. That’s the main “agent vs human” distinction for writes.
2. **Source/frontmatter** — When agents write (direct write or approved proposal), use frontmatter like `source: agentception` (or `source: cli` / `source: hub-api`) so you can filter “what did agents write?” in list-notes/search.
3. **Optional policy** — You could require agents to **only** use proposals (no direct POST /notes or `knowtation write` outside inbox) for non-inbox paths; then all non-inbox agent writes go through human approval. That’s a governance choice to document, not a code change for this plan.

### Recommended clarity for users

- In **How to use** and **Knowledge & agents**: “Agents read and write the vault via CLI/MCP/API. They do not push to GitHub. You approve their changes (proposals) in the Hub; you control backup to GitHub (Back up now or auto-sync).”
- In docs (e.g. AGENT-INTEGRATION, AGENTCEPTION-HACKATHON): keep stating that the vault is the interface for agents; Git is for backup and is human/automation-controlled.

---

## 3. How will the human “nodes” be consumed by the agent? Clarity in how-to, menu items, chatbot, and local models

### How human knowledge is consumed today

- **“Nodes”** = notes in the vault (any Markdown with optional frontmatter).
- **Human adds notes** via: Hub UI (+ New note, capture), CLI `write`, imports, capture webhooks. They can put notes under `vault/projects/<slug>/` or set `project: slug` and `tags` in frontmatter.
- **Agent consumes them** by:
  - **Search:** `knowtation search "query" --project myapp --limit 5 --json` (semantic search scoped to project).
  - **List:** `knowtation list-notes --project myapp --limit 20 --json`.
  - Then **get-note** for the paths they need.

So: **human adds a note to the vault (optionally under a project or with tags) → agent finds it via search/list-notes with the same project/tag.** No extra “node” type; the vault and filters are the contract.

### Recommended clarity in the product

- **How-to (existing modal):** Keep Steps 1–6; add a short **“Projects and filters”** bullet under Step 5 (or a small new step): “Organize notes by project (folder or frontmatter) and tags so you and agents can filter. Agents use `--project` and `--tag` to read only what’s relevant.”
- **New menu item: “Knowledge & agents” (or “For agents”)**: A **separate** modal/section (like How to use / Settings) that is the single place for “how does my vault feed agents?” Content should cover:
  1. **Giving agents context** — Add notes to the vault; use project and tags so agents can filter (e.g. `--project myapp`).
  2. **How agents find it** — Search and list-notes with project/tag/folder; get-note for full content. Link to CLI/MCP/Hub API docs.
  3. **Proposals** — Agents can create proposals; you approve in the Hub so you control what gets into the vault (and thus what gets backed up to GitHub).
  4. **Optional:** One paragraph on AgentCeption (and similar): “If you use AgentCeption (or another orchestrator), point it at this vault and the same project slugs; use CLI or MCP as in the integration docs.”
- **Chatbot / knowledge base per “queue” later:** You mentioned “at some point a chatbot or knowledge base for every queue that incorporates AI.” Treat that as a **later phase**: e.g. an “Ask” or “Chat” tab that runs queries over the vault (and maybe over proposals). For now, the win is: **clear how-to + “Knowledge & agents”** so users know how human notes become agent context. The chatbot can sit on top of the same search/list/get-note contract.

### Local models (Ollama, etc.) and AgentCeption

- **Today:** Knowtation already supports local embedding (e.g. Ollama, `nomic-embed-text`) in `config/local.yaml` and env. AgentCeption (or any agent runtime) has its **own** config for LLM/embedding.
- **User need:** “Use the same local model setup in AgentCeption” so they don’t configure Ollama twice and stay consistent.

**Options:**

- **A. Document only** — In “Knowledge & agents” and AGENTCEPTION-HACKATHON: “Use the same Ollama URL and model name in AgentCeption as in your Knowtation config (embedding section).” User copies from `config/local.yaml` (or env) into AgentCeption.
- **B. Settings surface (read-only)** — In Hub **Settings**, add a section (e.g. under a new “Agents” or “Local model” tab, or under Appearance): “Embedding / local model (for agents)”. Show current embedding config (e.g. “Ollama, nomic-embed-text, http://localhost:11434”) and a short line: “Use this in AgentCeption: set OLLAMA_BASE_URL=... and model ...”. No editing in the Hub; config stays in `config/local.yaml` and env. This gives one place to **see** what agents should use.
- **C. Settings + export** — Same as B, plus a “Copy env snippet” or “Download snippet for AgentCeption” that outputs something like `OLLAMA_BASE_URL=http://localhost:11434` and the model name so the user can paste into AgentCeption’s env or config.

**Recommendation:** Start with **B** (read-only “Local model (for agents)” in Settings) so there’s one place users see “this is what my agents should use.” Add **C** if you want to reduce copy-paste. **A** is the minimum (docs only) if you prefer no Settings changes for now.

---

## Summary: what to do first (easiest path)

| Priority | What | Where |
|----------|------|--------|
| 1 | Make “one vault, one backup repo; projects = filters” explicit | How to use (short subsection or Step 6 bullet) + optional 1–2 sentence in Settings Backup section. |
| 2 | Make “agents use vault, not GitHub; you approve and backup” explicit | How to use Step 6 + “Knowledge & agents” content. |
| 3 | Add **“Knowledge & agents”** menu item (modal or page) | Same place as “How to use” and “Settings” in the header. Content: how human notes become agent context, filters, proposals, link to AgentCeption. |
| 4 | Optional: **Settings → “Local model (for agents)”** (read-only) | Show embedding provider/URL/model so users (and AgentCeption) can use the same local setup. |
| 5 | Later | Chatbot / “Ask” tab over vault; “Copy env for AgentCeption” if you add Settings surface. |

This gives users and you a single mental model: **one vault, one GitHub backup, projects for filtering; agents read/write the vault and you control approval and backup; human notes are consumed by agents via search/list by project and tags; and we explain it in How to use plus a dedicated “Knowledge & agents” entry point, with optional Settings for local model visibility.**

---

## File and UI reference (for when you implement)

- **How to use:** `web/hub/index.html` — modal `#modal-how-to-use`, steps 1–7. Add a small “Projects and backup” / “Agents and GitHub” clarification.
- **New “Knowledge & agents”:** New modal (e.g. `#modal-knowledge-agents`) and a header button “Knowledge & agents” (or “For agents”), content as in section 3 above.
- **Settings:** `web/hub/index.html` — Settings modal; add either a third tab “Agents” or a subsection under Backup/Appearance for “Local model (for agents)” (read-only from config/env).
- **Docs:** `docs/AGENT-INTEGRATION.md`, `docs/AGENTCEPTION-HACKATHON.md` — add one line each that “agents use the vault; Git backup is user-controlled” and “for local models, use the same Ollama (or embedding) config as Knowtation.”

No code changes in this repo beyond the plan; implement when you’re ready.


---

## Implemented (this phase)

- **How to use:** Step 6 now includes "Vault and backup" and "Projects and filters" notes (one vault, one backup repo; agents use vault, you control backup; projects = filters). GitHub backup detail is Step 7. See **Knowledge & agents** for the full picture.
- **Knowledge & agents:** New header button and modal with: Giving agents context, How agents find it, Proposals and GitHub, AgentCeption and other orchestrators (with pointer to Settings → Agents).
- **Settings → Agents tab:** Read-only "Local model (for agents)" (provider, model, Ollama URL from `embedding_display`). "Copy env for AgentCeption" button copies `OLLAMA_BASE_URL` and a comment line for the embedding model.
- **API:** `GET /api/v1/settings` now returns `embedding_display: { provider, model, ollama_url }` (safe, no secrets).

---

## Future phases (don't forget)

Items to do in a later phase; add to your backlog or a "Phase N" doc so they aren't lost.

| Phase / area | Item | Notes |
|--------------|------|--------|
| **Chatbot / Ask** | "Ask" or "Chat" tab over the vault | Queries over vault (and optionally proposals); incorporates AI. Per-queue or global. |
| **Security** | Encrypt GitHub token at rest | Today `data/github_connection.json` is plaintext; optional encrypt with key from env or secrets manager. |
| **Security** | Audit setup and Connect GitHub | Log setup changes and Connect GitHub success/failure for compliance. |
| **Testing** | API tests for Hub | GET/POST /setup, POST /vault/sync, auth; run against test server or mock. |
| **Testing** | E2E flow | One flow (e.g. login → create note → setup → backup) to guard regressions. |
| **Hosted** | Multi-tenant backend and auth | One deployment; tenant-scoped vault and GitHub connection; then billing and limits. See HOSTED-PLUG-AND-PLAY.md. |
| **UX** | Copy env: more runtimes | Extend "Copy env" to other runtimes (e.g. Cursor MCP env snippet, Abacus) if needed. |
| **Docs** | DEPLOYMENT: data dir files | One line that `data/hub_setup.yaml` and `data/github_connection.json` live under data/ and should not be committed (already in .gitignore). |
| **Docs** | AGENT-INTEGRATION / AGENTCEPTION | One line each: "Agents use the vault; Git backup is user-controlled" and "For local models, use the same Ollama (or embedding) config as Knowtation; see Hub Settings → Agents." |
| **Phase 12** | Blockchain / agent payments | Reserved frontmatter and config; implement when ready. See BLOCKCHAIN-AND-AGENT-PAYMENTS.md. |

When you implement any of these, tick them off here or in your main roadmap.
