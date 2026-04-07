---
name: marketing-distribution
description: Plan and track multi-channel distribution—social, email, partnerships—using vault notes, MCP prompts, and Hub APIs where gated writes apply.
compatibility:
  - Cursor
  - Claude Code
  - Any runtime that can run a CLI and read this skill
allowed-tools: []
---

# Marketing Distribution

## When to use this skill

- User is ready to **schedule**, **sequence**, and **track** content across channels after drafts exist in `drafts/`.
- User needs a **single plan** that links assets, copy variants, owners, and publish dates.
- Vault uses **`content-creation`** folders: `drafts/`, `outlines/`, `published/`, `research/`.
- User is coordinating **paid + organic** and needs one table showing **asset**, **copy**, and **landing** dependencies.
- User wants **go/no-go** criteria per channel before spend (approvals, disclaimers, locale).
- User needs to confirm **what shipped**: `knowtation list-notes --folder published --order date --limit 30`.

## Role and responsibilities

- Build **channel plans** with dependencies (legal hold, editor sign-off, asset delivery).
- Reflect **reality**: only mark “shipped” when `published/` note or external tracker confirms; vault is source of narrative, not always the cron system.
- Capture **UTM and tracking** parameters in a repeatable table without leaking secrets (tokens stay out of vault).
- Use MCP **`meeting-notes`** after syncs with partners; file under `meetings/` when that folder exists, else `outlines/distribution-*-log.md`.
- Run `knowtation list-notes --folder published --since <date>` to backfill distribution status accurately.

## Workflow

1. **Inputs:** `knowtation get-note outlines/campaign-*.md`; list ready drafts `knowtation list-notes --folder drafts --order date --limit 40`.
2. **Window scan:** MCP **`temporal-summary`** for “what launches this week”; MCP **`daily-brief`** for last-minute vault changes affecting schedule.
3. **Channel fit:** MCP **`content-plan`** repurposing pass: “turn this draft into channel-specific hooks” (store results in distribution note, not always in canonical draft).
4. **Checklist note:** `knowtation write outlines/distribution-<campaign>-<phase>.md` with tables: **Channel**, **Asset brief path**, **Draft path**, **Owner**, **Date**, **Status**.
5. **Partnerships:** `knowtation search "partner OR co-marketing" --folder research --limit 15`; link obligations and talking points.
6. **Post-publish log:** On ship, add row + move or copy summary to `published/YYYY-MM-DD-<slug>.md` with **URLs** (user-supplied) and **metrics placeholder** for analytics agent.
7. **Gates:** If schedule changes canonical copy, use **`POST /api/v1/proposals`**; quick captures from the field go to **`POST /api/v1/capture`** then you file under `outlines/` or `published/`.
8. **Entity clarity:** MCP **`extract-entities`** on partner agreements pasted into `research/` to ensure channel owners and handles are correct in the plan.
9. **Search:** `knowtation search "launch OR embargo OR hold" --folder outlines --limit 15` before publishing dates.
10. **Resume:** MCP **`resume-session`** for multi-week launches; MCP **`daily-brief`** for schedule drift detection.

## Output conventions

- **Plan:** `outlines/distribution-*.md` frontmatter `tags: [distribution, campaign]`, `project`, `status: planned|active|complete`.
- **Published index:** `published/` entries with **Canonical URL**, **Syndications** list, **Related drafts/** paths.
- **Social batch:** Reference `drafts/social-*` files; do not duplicate full thread text—link instead.
- **UTM table:** Columns **Channel**, **Source**, **Medium**, **Campaign**, **Content**; use placeholders like `{INSERT_TOKEN}` for secrets configured outside the vault.
- **Risk column:** In the main table, add **Blockers** (legal, brand, tech) with owner initials.

## Handoff patterns

- **From marketing-strategy:** Campaign priorities and **non-goals**; from **writer/editor:** final `drafts/` paths and approval state.
- **To marketing-analytics:** Hand off `published/` URLs + campaign IDs (non-secret) for KPI tracking; include **`temporal-summary`** snapshot date range.
- **From marketing-visual:** Embed asset brief paths in the distribution table; block channel rows until **brief status: ready**.
- **Imports:** `knowtation import markdown <scheduling-export.md>` → triage into `outlines/` → `knowtation index`.
- **Notes API:** Prefer proposals for schedule tables that others rely on; **`POST /api/v1/notes`** only if your Hub treats schedules as non-gated.
- **Field updates:** Mobile **`POST /api/v1/capture`** for “delayed 2d” notes; you reconcile the master `outlines/distribution-*.md` table.
- **Strategy sync:** When channels change, `knowtation get-note outlines/campaign-*.md` and adjust the distribution plan in the same edit batch (via proposal).
- **Snippet pass:** `knowtation search "UTM OR tracking" --folder outlines --limit 15` to align tables across distribution docs.
