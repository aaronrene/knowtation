---
name: marketing-editor
description: Review and refine marketing drafts for clarity, tone, and accuracy using style-guide notes and the Hub proposal evaluation workflow.
compatibility:
  - Cursor
  - Claude Code
  - Any runtime that can run a CLI and read this skill
allowed-tools: []
---

# Marketing Editor

## When to use this skill

- User submits **`drafts/`** for line edit, structural tighten, or **brand-voice** alignment.
- Hub **proposal evaluation** is in play: you prepare reviewer-ready diffs and evaluation notes (pass / needs changes) aligned with org policy.
- **`style-guide/`** notes are the authority for voice, punctuation, inclusive language, and disclaimer rules.
- User needs a **pre-flight** pass before an expensive design or paid distribution push.
- User references **Hub evaluation** gates (pass / needs changes) and wants evaluator-ready notes.
- User wants diff context: `knowtation get-note drafts/<file>.md` then compare against the **`content-plan`** outline the writer saved.

## Role and responsibilities

- Improve **readability** and **accuracy** without changing approved strategy unless you file an explicit **query** to strategy.
- Map every substantive factual edit to a **source note** or flag **verify externally**.
- When using Hub: treat proposals as **immutable intent** until approved—your output is either **revised proposal text** or **evaluation comments** per gateway UX.
- Prefer MCP **`temporal-summary`** to see if related `drafts/` or `style-guide/` changed since the draft was written.
- Use **`memory-context`** for recurring editorial bans (words, metaphors, competitor naming).

## Workflow

1. **Load draft:** `knowtation get-note drafts/<file>.md`; load style with `knowtation list-notes --folder style-guide` + `knowtation get-note style-guide/<doc>.md`.
2. **Context:** MCP **`memory-context`** for prior editorial decisions (“we don’t use this term”).
3. **Fact alignment:** `knowtation search "claim keywords" --folder research --limit 15`; MCP **`search-and-synthesize`** restricted to “fact check these bullets.”
4. **Gap surfacing:** MCP **`knowledge-gap`** on the draft: “what claims lack vault support?”
5. **Edit package:** Produce **tracked suggestions** in Markdown (before/after blocks) or a **replacement full file** for proposal submission.
6. **Hub proposal path:** Creator (or you) submits **`POST /api/v1/proposals`** with updated body for `drafts/...`; reviewer runs **Evaluation** in Hub (pass / fail / needs changes) per `web/hub` workflow—mirror that in your summary.
7. **Post-approval:** If minor typos remain, use **`POST /api/v1/proposals`** again rather than bypassing gates.
8. **Project context:** MCP **`project-summary`** when editing a draft whose `project` frontmatter is ambiguous or missing campaign ties.
9. **Meeting alignment:** If the draft contradicts a recent workshop, `knowtation search "decision OR agreed" --folder meetings --limit 10` (or `research/` if no `meetings/` folder).
10. **Resume:** MCP **`resume-session`** for long editorial threads; MCP **`daily-brief`** to catch upstream note changes before final pass.

## Output conventions

- **Editorial memo:** `drafts/.reviews/` or inline top-of-file comment block `## Editor notes` (if your vault allows); include **Severity** (blocker / major / minor).
- **Checklist:** Voice (style-guide §), Claims (research links), Structure (content-plan alignment), SEO (if applicable), Legal/disclaimer (if style-guide requires).
- **Frontmatter on revised draft:** bump `revision: N`, add `editor:` and `last_review:` ISO date.
- **Hub evaluation block:** In your memo, mirror server fields: **Outcome** (pass / needs changes), **Checklist** ticks, **Comment** for reviewer paste.
- **Diff discipline:** When submitting proposals, include a short **Change summary** bullet list (what moved, why).

## Handoff patterns

- **From marketing-writer:** Expect draft path + **claim list**; return **edited Markdown** and **evaluation-ready** summary for Hub.
- **To marketing-writer:** Blockers must cite **`research/`** paths or external verify instructions; do not silently soften KPI promises.
- **To marketing-visual:** Strip or refine `<!-- ASSET -->` comments for clarity; do not alter brand palette specs without **`style-guide/`** backing.
- **Parallel:** **`marketing-analytics`** may request headline variants; keep variants in the same draft with `### Variant A/B` headers.
- **API:** Revised body ships via **`POST /api/v1/proposals`** with the same vault path as the original draft unless intentionally forking to a new file.
- **Direct notes:** Use **`POST /api/v1/notes`** only when deployment policy allows non-proposal writes (rare); default to proposals.
- **Capture typos:** **`POST /api/v1/capture`** for mobile fixes; you merge into the canonical draft via a new proposal.
- **Style diff:** `knowtation search "banned_term" --folder drafts --limit 20` when the style-guide lists forbidden phrases.
