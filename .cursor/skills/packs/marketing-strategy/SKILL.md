---
name: marketing-strategy
description: Define positioning, messaging frameworks, campaigns, and audience segmentation by reading research outputs and grounding plans in the vault.
compatibility:
  - Cursor
  - Claude Code
  - Any runtime that can run a CLI and read this skill
allowed-tools: []
---

# Marketing Strategy

## When to use this skill

- User is moving from **research** to **positioning**, **personas**, **messaging pillars**, or **campaign architecture**.
- User references prior **`marketing-research`** deliverables under `research/*-brief.md` or competitor sheets.
- Outputs should live beside creative work: `outlines/` and `drafts/` adjacent folders in **`content-creation`** layout.
- User is **repivoting** after new research and needs explicit **decision deltas** vs the old positioning doc.
- User wants **one narrative** that sales, product, and marketing can all cite from `outlines/`.
- User needs alignment with product reality: `knowtation search "roadmap OR ship OR GA" --folder research --limit 15` before promising dates.

## Role and responsibilities

- Read research artifacts first; **do not contradict** cited evidence without flagging a **hypothesis**.
- Translate insights into **decisions** (what we say, to whom, in which channels) with measurable hooks for downstream analytics.
- Keep strategy docs **stable**; put volatile copy experiments in `drafts/`, not in the strategy canonical note without review.
- When **`search-and-synthesize`** surfaces conflicts, document them in **`outlines/`** under **Open conflicts** before choosing a line.
- Run MCP **`meeting-notes`** on strategy workshops and store under `meetings/` if the vault includes that folder (or `research/` for smaller vaults).

## Workflow

1. **Ingest research:** `knowtation get-note research/<dated-brief>.md` (or path from handoff); MCP **`memory-informed-search`** for “prior positioning decisions.”
2. **Situation snapshot:** MCP **`project-summary`** focused on product + GTM; CLI `knowtation search "positioning OR narrative OR ICP" --folder outlines --limit 20`.
3. **Synthesis check:** MCP **`search-and-synthesize`**: “Given these research notes, what are the top 3 strategic choices?”
4. **Segmentation:** Use **`extract-entities`** on interview notes in `research/` to build persona **evidence tables** (pain, trigger, objection).
5. **Campaign skeleton:** Create `outlines/campaign-<slug>.md` with **Objective**, **Audience**, **Channels**, **Timeline**, **Success metrics**; link `research/` sources per section.
6. **Risk scan:** MCP **`knowledge-gap`** → “what we must validate before spend”; MCP **`causal-chain`** if the narrative depends on a specific market mechanism.
7. **Publish internally:** Submit major updates via **`POST /api/v1/proposals`** when writes require approval; otherwise `knowtation write outlines/<file>.md`.
8. **Morning alignment:** MCP **`daily-brief`** before rewriting strategy if the vault changed overnight; **`temporal-summary`** for “strategy-relevant shifts this week.”
9. **Memory:** MCP **`memory-informed-search`** for “prior campaign lessons”; MCP **`memory-context`** for brand boundaries the user stated in chat.
10. **Entities:** MCP **`extract-entities`** on customer interview notes to ensure personas map to real titles and use cases.

## Output conventions

- **Positioning doc:** `outlines/positioning-<product>-vN.md` with **For / Who / Our product / Unlike / We** blocks plus **Proof points** linking `research/` paths.
- **Personas:** `outlines/personas-<segment>.md`; each claim footnoted with `research/...` or `meetings/...` if present.
- **Frontmatter:** `title`, `date`, `tags: [strategy, gtm]`, `project`, `depends_on:` (list of research note paths).
- **Campaign brief:** `outlines/campaign-<slug>.md` must include **Primary CTA**, **Secondary CTA**, and **Forbidden claims** (legal/compliance).
- **Versioning:** Bump `vN` when changing **target segment** or **category definition**; use changelog H2 at top of positioning doc.

## Handoff patterns

- **From marketing-research:** Required input: latest `research/*-brief.md`; optional: competitor sheets and **`knowledge-gap`** output.
- **To marketing-writer:** Deliver `outlines/campaign-*.md` + **message hierarchy** (pillar → proof → CTA); reference **`content-plan`** prompt name for their workflow.
- **To marketing-distribution:** Provide channel **priority order** and **non-goals** (what not to say where).
- **To marketing-analytics:** List **KPI definitions** and **baseline hypotheses** to track in `research/` or a shared metrics note.
- **To marketing-editor:** Flag **claims that must not be softened** vs **copy-flexible** areas in a short preamble at top of `outlines/campaign-*.md`.
- **Hub:** Use **`POST /api/v1/proposals`** for any `outlines/positioning-*` change when reviewers require diff-based approval.
- **Capture-heavy workshops:** Route raw input through **`POST /api/v1/capture`** first, then distill into `outlines/` via proposals.
- **List outlines:** `knowtation list-notes --folder outlines --order date --limit 30` to avoid duplicating `campaign-` or `positioning-` files.
