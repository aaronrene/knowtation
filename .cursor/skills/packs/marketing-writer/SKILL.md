---
name: marketing-writer
description: Draft blogs, landing pages, emails, and social posts using the content-plan MCP prompt and vault-backed context from research and outlines.
compatibility:
  - Cursor
  - Claude Code
  - Any runtime that can run a CLI and read this skill
allowed-tools: []
---

# Marketing Writer

## When to use this skill

- User wants **long-form** (blog, guide), **landing copy**, **email sequences**, or **social threads** grounded in existing notes.
- A **`content-plan`** pull should shape structure: headings, hooks, and CTA aligned to project notes.
- Drafts belong in **`content-creation`** paths: `drafts/`, with sources in `research/` and `outlines/`.
- User requests **repurposing** one pillar asset into email + social + landing variants under the same campaign.
- User wants drafts that **quote** or **paraphrase** vault research only with explicit paths for fact-check.
- User needs a **full read** of a style rule: `knowtation get-note style-guide/voice-and-tone.md` (adjust filename after `list-notes`).

## Role and responsibilities

- Follow **`style-guide/`** notes when present (`knowtation list-notes --folder style-guide` then `knowtation get-note ...`).
- Preserve factual claims tied to **`research/`** paths; mark anything promotional as **approved messaging** vs **draft hypothesis**.
- Produce channel-ready Markdown; avoid vault-internal jargon in customer-facing copy unless intentional.
- After writing, run `knowtation search "same headline keywords" --folder drafts --limit 10` to avoid accidental duplicate topics.
- Use MCP **`knowledge-gap`** on your own draft when the user asks “what’s weak or missing?” before editor review.

## Workflow

1. **Plan from vault:** Invoke MCP prompt **`content-plan`** with the target asset (e.g., “pillar post on X for ICP Y”).
2. **Load strategy:** `knowtation get-note outlines/positioning-*.md` or `outlines/campaign-*.md` from **`marketing-strategy`** handoff.
3. **Evidence pass:** `knowtation search "proof OR stat OR case study" --folder research --limit 20`; MCP **`search-and-synthesize`** for “supporting arguments only.”
4. **Voice & memory:** MCP **`memory-context`** if the user references brand voice sessions; **`write-from-capture`** to turn rough bullets in `inbox/` into a structured draft outline first.
5. **Draft:** `knowtation write drafts/<YYYY-MM-DD>-<slug>.md` with frontmatter `status: draft`, `tags: [draft, blog|email|social]`, `project`.
6. **Continuity:** MCP **`resume-session`** when continuing a long piece across sessions; **`daily-brief`** to see what changed in the vault yesterday.
7. **Human gate:** Submit polished Markdown via **`POST /api/v1/proposals`** (path `drafts/...`) for Hub review; avoid direct canonical publish paths unless policy allows **`POST /api/v1/notes`**.
8. **Meeting hooks:** If the draft responds to a workshop, MCP **`meeting-notes`** output can seed the **Intro** section—link the meeting note path.
9. **Search polish:** MCP **`search-and-synthesize`** with “tighten this argument using only these vault paths” after first draft is saved.
10. **Import path:** Raw chat exports → `knowtation import markdown <file>` → `knowtation get-note inbox/<imported>.md` → reshape into `drafts/`.

## Output conventions

- **Blog / LP:** `drafts/<date>-<slug>.md`; include an **Outline** HTML comment or H2 structure matching **`content-plan`** output.
- **Email sequence:** `drafts/email-<campaign>-NN-<subject-slug>.md` numbered in order; shared **CTA** block in part 1 only unless style-guide says otherwise.
- **Social:** `drafts/social-<platform>-<date>-<slug>.md`; keep under platform limits noted in frontmatter `limits:`.
- **Claims footnotes:** Use `[^1]` style footnotes mapping to `research/...` paths when the style-guide allows; otherwise inline **Source:** lines.
- **Frontmatter:** Always set `project` to match `outlines/campaign-*.md` for downstream search filters.

## Handoff patterns

- **From marketing-strategy:** Consume `outlines/campaign-*.md` and persona files; ask for missing **`knowledge-gap`** items before claiming stats.
- **To marketing-editor:** Pass draft path + **`content-plan`** summary + list of **claims requiring fact-check** with `research/` links.
- **To marketing-visual:** Insert `<!-- ASSET: ... -->` comments describing hero/OG image needs without blocking text review.
- **To marketing-distribution:** Provide **suggested publish order** and **dependencies** (e.g., blog before email-02) in draft frontmatter `publish_order:`.
- **Capture:** For voice memos, MCP **`write-from-capture`** → `inbox/` → you promote to `drafts/` after structuring.
- **Stakeholder skim:** MCP **`project-summary`** + link to `drafts/<file>.md` for approval routing before **`POST /api/v1/proposals`**.
- **Parallel analytics:** When they ask for variants, add `### Variant A/B` blocks in one draft to keep **`temporal-summary`** coherent.
- **List drafts:** `knowtation list-notes --folder drafts --since <ISO-date>` to avoid filename collisions on high-volume campaigns.
