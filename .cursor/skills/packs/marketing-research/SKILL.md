---
name: marketing-research
description: Gather market intelligence, analyze competitors, spot trends, and produce research briefs in a content-creation vault using Knowtation MCP prompts and CLI.
compatibility:
  - Cursor
  - Claude Code
  - Any runtime that can run a CLI and read this skill
allowed-tools: []
---

# Marketing Research

## When to use this skill

- User needs **market sizing**, **competitive landscape**, **trend scans**, or **source-grounded briefs** before strategy or creative work.
- User points at the **`content-creation`** pattern: primary outputs land in `research/` with optional `inbox/` captures (`docs/TEMPLATES-AND-SKILLS.md`).
- User wants synthesis that **cites vault notes** and flags what is still unverified.
- User is preparing for **launch, fundraising narrative, or category creation** and needs a defensible fact base.
- User pasted long articles or call transcripts into notes and needs them **structured** without losing citations.
- User requests a **source map**: `knowtation search "URL OR DOI OR report title fragment" --folder research --limit 25`.

## Role and responsibilities

- Collect and structure evidence; distinguish **primary sources** (user-provided), **vault notes**, and **model inference** (label inference clearly or omit).
- Produce **briefs** that downstream agents (strategy, writer) can execute without re-reading the entire vault.
- De-duplicate overlapping clips; normalize competitor names and categories.
- Use tiered retrieval: `knowtation search` with `--fields path+snippet` first, then `knowtation get-note` on 2–5 paths.
- When the user names a competitor, run `knowtation search "<name>" --folder research --limit 15` before creating a new `research/competitors/` file.

## Workflow

1. **Baselines:** MCP **`project-summary`** for the product or campaign context; CLI `knowtation search "ICP OR competitor OR category" --folder research --limit 25`.
2. **Wide pull:** MCP **`search-and-synthesize`** with the research question (e.g., “Why buyers switch from A to B in 2026?”).
3. **Entity map:** MCP **`extract-entities`** on long articles already pasted into notes; merge into a competitor/customer **entity list** in the brief.
4. **Trends over time:** MCP **`temporal-summary`** on `research/` for “what changed this quarter”; pair with `knowtation list-notes --folder research --since <ISO-date> --order date`.
5. **Unknowns:** MCP **`knowledge-gap`** to output explicit **open questions** and **data to collect** (surveys, interviews, filings).
6. **Causality:** When user asks “what caused the shift,” MCP **`causal-chain`** with links to supporting notes.
7. **New clips:** Save raw inputs under `inbox/` via **`write-from-capture`** or **`POST /api/v1/capture`**; promote to `research/` with `knowtation write research/<topic>-sources.md`.
8. **Index:** After bulk imports, run `knowtation index` so semantic search includes new research notes.
9. **Session memory:** MCP **`memory-context`** if the user says “continue the competitor matrix”; **`resume-session`** for multi-day deep dives.
10. **Project framing:** MCP **`project-summary`** before a new brief so research aligns with active `project` slugs in frontmatter.

## Output conventions

- **Brief:** `research/YYYY-MM-DD-<topic>-brief.md` with sections: **Executive summary**, **Market**, **Competitors**, **Trends**, **Risks**, **Sources** (vault paths + external titles/URLs if provided).
- **Frontmatter:** `title`, `date`, `tags: [research, brief]`, `project`, optional `status: draft|reviewed`.
- **Competitor sheets:** `research/competitors/<name>.md` for living files; link from the brief instead of duplicating tables.
- **Source hygiene:** Every non-obvious number gets a **Source:** sub-bullet (vault path or user-provided doc name); unknown → **TBD** in **`knowledge-gap`**.
- **Snippets:** Prefer short quotes with attribution in the brief; park long paste-ins in `inbox/` or dedicated `research/raw-*.md`.

## Handoff patterns

- **To marketing-strategy:** Pass the brief path + **`knowledge-gap`** block; highlight **`causal-chain`** notes if positioning depends on a narrative.
- **To marketing-writer:** Provide **three bullets** of “must-include claims” each with a **source note path**.
- **From capture:** You own triage from `inbox/` → `research/`; use **`POST /api/v1/proposals`** when Hub policy blocks direct writes.
- **To marketing-analytics:** Flag which claims should become **measurable** (e.g., adoption %) and which remain **qualitative** only.
- **From `knowtation import`:** After notebook or markdown ingest, `knowtation list-notes --folder inbox` then file under `research/` and re-run `knowtation index`.
- **PR / comms:** Hand off **`search-and-synthesize`** + brief path; they should not re-run wide search without indexing first.
- **API:** Prefer **`POST /api/v1/proposals`** for `research/` canonical competitor sheets; use **`POST /api/v1/notes`** only if policy allows.
- **List-first triage:** `knowtation list-notes --folder research --order date --limit 25` before opening many files for a competitor refresh.
