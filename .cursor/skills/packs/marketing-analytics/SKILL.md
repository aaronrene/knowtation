---
name: marketing-analytics
description: Track marketing KPIs, interpret content performance over time, and recommend optimizations using temporal-summary and vault-linked reports.
compatibility:
  - Cursor
  - Claude Code
  - Any runtime that can run a CLI and read this skill
allowed-tools: []
---

# Marketing Analytics

## When to use this skill

- User wants **performance reviews**, **week-over-week deltas**, or **optimization recommendations** tied to published work.
- User has (or will paste) metrics tables into notes; you **never fabricate** numbers—only interpret supplied data or vault-stated values.
- **`temporal-summary`** is the primary MCP prompt for time-bounded narrative over note changes and logged events.
- User wants **experiment readouts** (A/B subject lines, creative variants) tied to `drafts/` variant headers.
- User is building a **monthly deck** from vault-native tables only.
- User wants funnels tied to URLs: `knowtation search "https:// OR path /signup" --folder published --limit 20`.

## Role and responsibilities

- Connect **metrics** to **creative and distribution decisions** via paths (`published/`, `drafts/`, `outlines/distribution-*.md`).
- Produce **actionable** recommendations: hypothesis, expected impact, measurement, owner—each labeled **data-backed** vs **hypothesis**.
- Maintain a **clean audit trail** of what changed in the narrative when recommendations update strategy.
- If numbers are missing, MCP **`knowledge-gap`** must output a **data request** list before recommending budget shifts.
- Use **`memory-informed-search`** for “last time we reported this KPI, what definition did we use?”

## Workflow

1. **Published index:** `knowtation list-notes --folder published --order date --limit 50`; `knowtation get-note published/<entry>.md` for URLs and campaign tags.
2. **Time window narrative:** MCP **`temporal-summary`** for the review period (e.g., last 14 days); MCP **`daily-brief`** for quick anomaly surfacing.
3. **Hypothesis linking:** MCP **`causal-chain`** only when user supplies plausible events (e.g., “email sent → spike”); otherwise frame as **correlation only**.
4. **Content performance context:** MCP **`search-and-synthesize`**: “Which messages appeared across notes during the surge?” with `--folder drafts` or `published` via CLI filters as needed (`knowtation search "headline OR CTA" --folder drafts --limit 20`).
5. **Memory of past reviews:** MCP **`memory-informed-search`** for “last month’s KPI definitions”; MCP **`memory-context`** for stakeholder preferences.
6. **Gaps:** MCP **`knowledge-gap`** → missing UTMs, missing baseline, missing channel split—feed back to **distribution** and **writer**.
7. **Report note:** `knowtation write research/analytics-<YYYY-MM-DD>-<scope>.md` or propose via **`POST /api/v1/proposals`** if canonical.
8. **Refresh index:** `knowtation index` after importing large metrics Markdown so **`temporal-summary`** sees new material.
9. **Daily pulse:** MCP **`daily-brief`** during active campaigns; MCP **`resume-session`** when analysis spans multiple working sessions.
10. **Entities:** MCP **`extract-entities`** on vendor export filenames or pasted dashboards to normalize campaign names across notes.

## Output conventions

- **Report:** `research/analytics-<date>-<campaign>.md` sections: **Snapshot**, **Top movers**, **Underperformers**, **Experiments**, **Recommendations**, **Data sources** (paste locations, spreadsheet names, API export dates—no secrets).
- **Frontmatter:** `tags: [analytics, report]`, `project`, `period_start`, `period_end`, `related_published:` (list of paths).
- **KPI table:** Markdown table; units explicit; note **confidence** (high/medium/low) per row.
- **Experiment log:** Subsection **Experiments** with **ID**, **Hypothesis**, **Start/End**, **Result**, **Next step**; link `drafts/` variants where applicable.
- **Caveats:** Always include **Data limitations** (sample size, attribution model) when user-supplied metrics are partial.

## Handoff patterns

- **From marketing-distribution:** Receive `published/` URLs, campaign table paths, and scheduling changes (compare to **`temporal-summary`**).
- **To marketing-strategy:** Summarize **what worked** with evidence paths; attach **`knowledge-gap`** for broken tracking.
- **To marketing-writer:** Provide **test hypotheses** (headline/angle) mapped to measurable events; cite **`content-plan`**-eligible topics for rewrites.
- **To marketing-editor:** Flag copy elements correlated with low engagement **as hypotheses**, not verdicts.
- **Hub:** Ship canonical reports via **`POST /api/v1/proposals`** when finance or leadership reviews analytics notes.
- **Broader synthesis:** MCP **`project-summary`** when the user asks how analytics fits the whole GTM program—not just one campaign.
- **Ingest:** Paste CSV summaries into `research/` working notes, then `knowtation index` before **`temporal-summary`** over that week.
- **API:** Publish signed-off reports through **`POST /api/v1/proposals`**; avoid **`POST /api/v1/notes`** for numbers others will cite.
- **Consistency:** `knowtation search "KPI OR metric definition" --folder research --limit 15` before renaming columns in the KPI table.
