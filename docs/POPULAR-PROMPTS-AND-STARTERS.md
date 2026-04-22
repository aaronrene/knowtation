# Popular prompts, copy-paste starters, and workflows

**What this page is:** A single place to find **MCP prompt names** (for clients that support them), **copy-paste text** you can use in *any* chat (Cursor, Copilot, web LLMs, etc.), and **CLI one-liners**—plus a short plain-English take on **wiki-style linking**, **synthesis pages**, and **surfacing disagreements** in your notes.

**Where the short version lives in the app:** **Hub → How to use → Knowledge & agents** (summary + link here).

---

## 1. Four ways assistants connect to your vault

| Kind | What it is | You use it when |
|------|------------|-----------------|
| **MCP tools** | Actions: search, list notes, read a note, write, propose, memory tools, import, index, etc. | Your IDE or agent app has Knowtation MCP connected ([AGENT-INTEGRATION.md](./AGENT-INTEGRATION.md)). |
| **MCP prompts** | **Named recipes** the client calls: they **pull live vault (or memory) data** and build a full message list. | Same as above; the client offers a **prompt picker** (names below). |
| **MCP resources** | **Read-only** URIs: e.g. knowledge graph, prime/bootstrap, config hints—not a “chat template.” | Agent calls `read resource` for structure, not for a user-written instruction. |
| **Copy-paste starters** | **Plain text** you put in the chat yourself. Works **without** MCP (any LLM). | You want a quick behavior without wiring tools, or the tool is CLI-only on your machine. |

**Skill packs** (e.g. under `.cursor/skills/packs/`) are **longer playbooks**—how to behave in a domain, which searches to run, which MCP prompts to prefer. They are **not** a fourth transport; they **guide** the same three layers above.

---

## 2. Wiki-style expansion, synthesis pages, research (plain language)

- **Wiki-style expansion** — You link notes with `[[Another note]]` (Obsidian-style). The system can list **backlinks** (who links here) and show **graph** relationships. You are building a **web of ideas** in your vault, not one long file.
- **Synthesis pages** — A **short “current story”** note: what you believe *so far* on a topic, with **links** to source clips and related pages. **Raw** material stays in **source** or **inbox** notes; synthesis is **rewritten** as you learn, so you are not re-deriving everything from scratch every time.
- **Research** — Not a separate product. It is **a project** (`project:` in frontmatter or a `projects/<name>/` folder) plus **habits**: import → search → relate → optional synthesis note. **Templates** and **skill packs** (e.g. research-oriented) make that easier; they are optional.
- **Surfacing disagreements** — If two sources **conflict**, you can (a) log both and add a line in a synthesis or sidecar note **“Tension: A says …, B says …”**, (b) use **memory consolidation** with the optional **Discover** pass (works on **memory** topic summaries—see [MEMORY-CONSOLIDATION-GUIDE.md](./MEMORY-CONSOLIDATION-GUIDE.md)), or (c) paste the **contradiction audit** starter below and point the model at a folder of notes.

---

## 3. Built-in MCP prompt IDs (server-side; data-aware)

After MCP connects, these **prompt names** are what clients list (some may be **role-gated** on hosted—see [AGENT-INTEGRATION.md](./AGENT-INTEGRATION.md) § Hosted MCP).

| Prompt ID | What it does (short) |
|-----------|----------------------|
| `daily-brief` | Notes since a date; themes and open threads. |
| `search-and-synthesize` | Semantic search, embeds top notes; asks for synthesis + gaps. |
| `project-summary` | Executive-style summary for a **project** slug. |
| `write-from-capture` | Turn pasted raw text into a proper note (optional capture template). |
| `temporal-summary` | What happened between two dates; optional topic filter. |
| `extract-entities` | JSON people/places/decisions/goals from notes in scope. |
| `meeting-notes` | Transcript → structured meeting note + suggested path. |
| `knowledge-gap` | Search hits → what is missing, what to capture next. |
| `causal-chain` | Notes sharing `causal_chain_id` in order. |
| `content-plan` | Content calendar / plan from project notes. |
| `memory-context` | Recent memory events (skeptical: verify paths). |
| `memory-informed-search` | Search + recent search memory → what is new. |
| `resume-session` | Pick up from session summaries + recent activity. |

**Implementation:** [`mcp/prompts/register.mjs`](../mcp/prompts/register.mjs).

---

## 4. Copy-paste starters (work in any LLM; adapt paths)

When you do **not** have MCP, combine these with **manual** steps: you search in the Hub or run `knowtation search` in a terminal, paste **snippets** into chat, then save the result yourself—or use **proposals** if your agent is wired to the Hub.

### Wiki + synthesis (first-time layout)

```
I'm building a personal wiki in my Knowtation vault. Conventions:
- Raw clips and PDFs live under `projects/MYPROJECT/sources/`.
- Short "what I think so far" lives under `projects/MYPROJECT/synthesis/` with links to sources using [[note name]].
- When I add a source, suggest updates to the relevant synthesis file without deleting my raw notes.
Start by asking me the project slug and one topic to draft a synthesis outline.
```

### Knowledge gap (after you paste search results or note titles)

```
Here are my vault search results (titles/paths) for TOPIC:
[paste list]

What is missing from my note set? What should I read or capture next? List 3 concrete next notes to create.
```

### Contradiction or tension pass

```
I have several notes in PROJECT/FOLDER that may disagree. I will paste excerpts or paths.
1) List claims that cannot all be true at once.
2) For each, quote or cite the note path.
3) Do not resolve into a single answer—show the tension. Suggest one note title for a "tensions" or "open questions" file.
```

### Daily stand-up from notes

```
Summarize my focus for today from these note titles and one-line descriptions (paste from list-notes or Hub).
Group: urgent, waiting on others, deep work. If something looks stale, say so.
```

### Meeting → actions (no MCP)

```
Turn this meeting transcript into:
- Decisions
- Action items (owner, due if known)
- Open questions
I'll save it as a markdown note with YAML frontmatter (title, date, project, tags).
[transcript]
```

### Resume where I left off (when memory is in use on self-hosted / MCP)

Use MCP prompt `resume-session` if connected. **Otherwise:**

```
Here are my last few notes (titles and dates) [paste]. Infer what I was working on and suggest 3 next steps. Ask one clarifying question.
```

### Import and index reminder (for assistants helping setup)

```
After I import markdown into the vault, remind me to run semantic indexing (`npm run index` or Hub Re-index) so search and agents see new files.
```

---

## 5. High-value CLI one-liners

Run from a machine with `config/local.yaml` or `KNOWTATION_VAULT_PATH` set. Shapes: [RETRIEVAL-AND-CLI-REFERENCE.md](./RETRIEVAL-AND-CLI-REFERENCE.md).

```bash
# Meaning search, tight limit, JSON for agents
knowtation search "your question" --project myapp --limit 5 --json

# Keyword (literal) when you need exact terms
knowtation search "exact phrase" --keyword --project myapp --limit 20 --json

# List recent notes
knowtation list-notes --project myapp --since 2026-01-01 --json

# Propose a change (needs Hub token for remote)
export KNOWTATION_HUB_URL=https://your-hub.example.com
export KNOWTATION_HUB_TOKEN=…
knowtation propose "inbox/idea.md" --hub "$KNOWTATION_HUB_URL" --body "..." --json
```

```bash
# One-shot memory consolidation (self-hosted; optional passes)
knowtation memory consolidate --json
```

**Doctor check:** `knowtation doctor` (vault path, optional Hub reachability).

---

## 6. More “power user” ideas (MCP or CLI)

| Goal | How |
|------|-----|
| **Neighbor notes (semantic)** | Tool `relate` with a path ([phase-c tools](../mcp/tools/phase-c.mjs)). |
| **Backlinks to this note** | Tool `backlinks` — who links *to* a path. |
| **Graph overview** | Resource / graph ([PARITY-MATRIX-HOSTED.md](./PARITY-MATRIX-HOSTED.md) for hosted). |
| **Inbox capture from automation** | `POST /api/v1/capture` or CLI capture; [AGENT-INTEGRATION.md](./AGENT-INTEGRATION.md). |
| **Enrich frontmatter (tags/title suggestion)** | Tool `enrich` (optional `apply: true`). |
| **Proposals workflow** | Tools `propose` / `evaluate_proposal` / Hub UI **Suggested** tab. |
| **Transcription** (self-hosted) | `knowtation import audio …` with your key — [IMPORT-SOURCES.md](./IMPORT-SOURCES.md). |

---

## 7. Hosted vs self-hosted (prompts and tools)

- **Hosted Hub:** connect MCP to your **gateway** with JWT; prompts list may be **scoped by role**; some tools (e.g. `import` with `file_base64`) are hosted-friendly. See [PARITY-MATRIX-HOSTED.md](./PARITY-MATRIX-HOSTED.md).
- **Self-hosted:** stdio `knowtation mcp` with local vault; full tool surface; `knowtation://prime` for bootstrap.

---

## 8. See also

- [AI-ASSISTED-SETUP.md](./AI-ASSISTED-SETUP.md) — phased copy-paste setup.
- [TEMPLATES-AND-SKILLS.md](./TEMPLATES-AND-SKILLS.md) — templates + skills + MCP prompt list.
- [AGENT-INTEGRATION.md](./AGENT-INTEGRATION.md) — CLI, MCP, Hub API, proposals.
- [RETRIEVAL-AND-CLI-REFERENCE.md](./RETRIEVAL-AND-CLI-REFERENCE.md) — filters and token levers.
- [TOKEN-SAVINGS.md](./TOKEN-SAVINGS.md) — search-then-open patterns.

---

*This file is the canonical, versioned “long form.” The Hub’s **How to use** modal points here for the full set.*
