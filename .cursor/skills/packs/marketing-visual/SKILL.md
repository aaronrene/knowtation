---
name: marketing-visual
description: Specify visual assets, write image briefs, and keep brand guidelines aligned with marketing content in the vault.
compatibility:
  - Cursor
  - Claude Code
  - Any runtime that can run a CLI and read this skill
allowed-tools: []
---

# Marketing Visual

## When to use this skill

- User needs **hero images**, **social cards**, **diagrams**, **slide visuals**, or **brand-consistent** specs for designers or generative tools.
- Brand rules live under **`style-guide/`**; campaigns reference **`outlines/`** and **`drafts/`** (`content-creation` template layout).
- User needs **storyboard-style** sequence for a short video or carousel without producing final pixels in the vault.
- User is aligning **illustration style** (flat vs photoreal) with **`search-and-synthesize`**-derived brand adjectives.
- User needs a **full asset inventory**: `knowtation list-notes --folder drafts/assets --order date --limit 40`.

## Role and responsibilities

- Translate copy and strategy into **briefs**: aspect ratio, subject, mood, color tokens, typography constraints, and **do-not** list.
- Ensure accessibility: contrast notes, text-in-image limits, alt-text drafts tied to the source paragraph in `drafts/`.
- Stay synchronized with editors: visual specs are **comments** or companion notes, not silent changes to canonical copy.
- Run `knowtation get-note outlines/campaign-*.md` when the brief must reflect **forbidden visual tropes** from strategy.
- Use MCP **`knowledge-gap`** to list missing brand tokens (hex, font files, logo variants) before promising fidelity.

## Workflow

1. **Brand load:** `knowtation get-note style-guide/brand-*.md` (or list `knowtation list-notes --folder style-guide`); MCP **`memory-context`** for “last approved visual direction.”
2. **Asset inventory:** `knowtation search "ASSET OR hero OR diagram" --folder drafts --limit 25` to find `<!-- ASSET: ... -->` markers left by writer/editor.
3. **Narrative fit:** MCP **`project-summary`** for campaign tone; MCP **`search-and-synthesize`**: “visual metaphors that match messaging pillars” (flag as creative hypothesis).
4. **Brief file:** `knowtation write drafts/assets/<YYYY-MM-DD>-<slug>-brief.md` with **Objective**, **Format & sizes** (e.g., 1200×630 OG), **Composition**, **Palette** (token names from style-guide), **Reference links** (internal paths only).
5. **Entities for people/products:** MCP **`extract-entities`** if brief must depict named offerings consistently with `research/competitors/` or product notes.
6. **Handoff for build:** If design happens outside the vault, attach brief path in Hub **`POST /api/v1/proposals`** as a **new note** under `drafts/assets/` for approval.
7. **Temporal check:** MCP **`temporal-summary`** on `style-guide/` before a big refresh—catch recent guideline updates.
8. **Capture:** MCP **`write-from-capture`** for whiteboard photo descriptions into `inbox/`, then distill into `drafts/assets/`.
9. **Search:** `knowtation search "logo OR palette OR illustration" --folder style-guide --limit 15` when brand docs are fragmented.
10. **Resume:** MCP **`resume-session`** when iterating briefs across multiple critique rounds.

## Output conventions

- **Brief:** `drafts/assets/<date>-<campaign>-<channel>-brief.md`; frontmatter `tags: [visual, brief]`, `project`, `related_draft:` path.
- **Alt text:** Section **Alt and caption** with ≤280 char primary alt + extended description for complex diagrams.
- **Versioning:** `v1`, `v2` suffix in filename when iterating after feedback meetings logged in `research/` or `meetings/` (if shared vault).
- **Reference board:** Section **References** listing `style-guide/` paths and **external** mood links only if user supplied them.
- **Legal:** Note **trademark / likeness** constraints when briefs depict real people or third-party marks.

## Handoff patterns

- **From marketing-writer / editor:** Consume `drafts/*.md` and `<!-- ASSET -->` comments; return brief paths.
- **To marketing-distribution:** Provide **per-channel size matrix** (e.g., LinkedIn vs X) in the brief **Appendix**.
- **To marketing-analytics:** Note **UTM-visible** elements if the creative includes promo codes or QR (coordinate copy placement).
- **Hub:** New asset briefs typically enter via **`POST /api/v1/proposals`**; use **`POST /api/v1/capture`** only for raw dumps before filing.
- **From research:** If visuals depend on data visuals, link `research/*-brief.md` **charts** section paths in the brief **Data** subsection.
- **Writer loop:** When copy changes hero claims, re-run MCP **`project-summary`** on the campaign before locking the brief.
- **Notes API:** **`POST /api/v1/notes`** only for scratch moodboards; approved briefs use **`POST /api/v1/proposals`**.
- **Mood guardrails:** MCP **`causal-chain`** only when the user ties a visual metaphor to a specific product outcome—otherwise keep metaphors labeled **creative**.
- **List assets:** `knowtation list-notes --folder drafts/assets --order date` before creating a duplicate brief filename.
