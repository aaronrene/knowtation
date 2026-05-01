---
title: "Born Free agentic marketing framework"
project: born-free
tags: [playbook, framework, ai-agents, marketing-ops, born-free, openclaw]
date: 2026-04-30
last_review: 2026-04-30
source: bornfree-hub
source_id: docs/marketing/AGENTIC-MARKETING-FRAMEWORK.md
upstream_path: /Users/aaronrenecarvajal/bornfree-hub/docs/marketing/AGENTIC-MARKETING-FRAMEWORK.md
upstream_created: 2026-02-21
intent: "How OpenClaw + Knowtation agents discover, draft, and follow up with creators while staying inside the Born Free voice gates."
depends_on:
  - projects/born-free/style-guide/voice-and-boundaries.md
  - projects/born-free/outlines/positioning-and-messaging-2026-04.md
  - projects/born-free/playbooks/influencer-outreach.md
  - projects/store-free/research/public-sources-2026.md
---

# Born Free agentic marketing framework

> **Vault import of `bornfree-hub/docs/marketing/AGENTIC-MARKETING-FRAMEWORK.md` (created 2026-02-21).**
> The upstream file is the canonical source. This vault copy lives here so OpenClaw agents (script,
> social, outreach, blog, etc.) can read it via Knowtation MCP `get_note` together with the Born
> Free voice guide, positioning outline, and the outreach playbook. Re-import on upstream changes
> and re-index. Edits to underlying voice / claims belong in `projects/born-free/style-guide/voice-and-boundaries.md`,
> not here.

---

## 1. Overview

This framework defines how to use AI agents (Cursor, MCP tools, and external AI) for Born Free marketing — **organic influencer outreach**, content creation, and ongoing marketing operations.

### Core principles

- **Human in the loop** — you approve outreach, content, and strategy. AI drafts and researches.
- **Evidence based** — use real data (screenshots, follower counts, engagement) not assumptions.
- **Scalable** — templates and workflows that work for 10 or 1,000 creators.
- **Authentic** — messaging reflects "partners, not promoters" — community building, not transactional.

---

## 2. Tool stack

### Cursor (primary human surface)

- **Agent mode** — multi-step tasks, code, docs, file edits.
- **Chat** — quick drafts, Q&A, strategy.
- **Rules** — `bornfree-hub/.cursor/rules/marketing.mdc` for consistent marketing context.

### MCP tools (when available)

| Tool | Use |
|------|-----|
| **Knowtation MCP** (`search`, `get_note`, `write`) | Read voice guide, outlines, public-sources registry; write drafts back into the vault under `projects/born-free/drafts/`. |
| **Browser** | Navigate, capture screenshots, extract contact info from creator profiles. |
| **Web fetch** | Pull public pages (Linktree, About pages) for contact extraction. |
| **Task / subagents** | Run parallel research (e.g. find 20 creators in parallel). |

### Orchestration (OpenClaw 4.27)

- **Codex Computer Use** for desktop control (open browser, post to social, upload thumbnail).
- **DeepInfra single key** for chat, embeddings, image generation, TTS — same `DEEPINFRA_API_KEY` that hosted Knowtation Hub uses (`KNOWTATION_CHAT_PROVIDER=deepinfra`), so the LLM bill is unified.
- **Cron-driven** content agents wake every morning, draft into vault `drafts/`, then a review dashboard waits for human approve before publish.

### External (optional)

- **Notion / Airtable** — tracker (manual or API).
- **Spreadsheet** — CSV export for bulk import.

---

## 3. Cursor rules for marketing

Maintained in `bornfree-hub/.cursor/rules/marketing.mdc`. Key rules:

- **Positioning:** Partners, not promoters — community building, early believers, human adventure.
- **No cash offers** — Experience Keys, CreditNFTs, Member NFT only.
- **Pre-launch** — properties coming, faith in platform is the caveat.
- **KYC code:** `BORNFREE100` for free signup.
- **Tone:** Warm, direct, human. No corporate jargon. Avoid "paid influencer" language — use "partner", "early believer", "support". Emphasize: credits renew forever, DAO governance, community-owned, Strength In Numbers.

Agent-side enforcement: every draft must cite **`projects/born-free/style-guide/voice-and-boundaries.md`** path in its output and pass that file's §8 ten-question checklist before promotion to `published/`.

---

## 4. Workflows

### A. Influencer discovery from screenshots

Use when sharing screenshots of 0 matches or search results.

- **You provide:** screenshots of Modash / other platform results.
- **Agent analyzes:** search terms used, filters applied, suggested alternative queries, free manual discovery paths.
- **Agent outputs:** refined search strategy + list of free channels to try.

> "I'm sharing screenshots of my influencer search. [Attach screenshots]. I got 0 matches. Help me: (1) analyze what might be wrong with my search, (2) suggest alternative search terms and free discovery methods, (3) create a manual discovery checklist I can follow outside paid platforms."

### B. Screenshot → contact extraction

- **You provide:** screenshots of creator profiles (Instagram, YouTube, etc.).
- **Agent extracts:** name, handle, platform, followers, contact method, content fit notes.
- **Agent outputs:** structured rows for tracker (CSV or markdown table).

> "Extract influencer contact info from these screenshots. For each: name, handle, platform, followers (if visible), email or contact method, content fit. Output as a table I can paste into my tracker."

### C. Personalized outreach draft

- **You provide:** creator name, handle, platform, follower count, content notes.
- **Agent drafts:** personalized email / DM using templates from `projects/born-free/playbooks/influencer-outreach.md`.
- **You review and send.**

> "Draft a [email | Instagram DM | Twitter DM] for [creator name] @[handle]. They have [X] followers, focus on [content topic]. Use the partner positioning from `projects/born-free/playbooks/influencer-outreach.md` and tone from `projects/born-free/style-guide/voice-and-boundaries.md`. Tier: [1K–10K | 10K–50K | …]."

### D. Follow-up sequence

- **Agent drafts:** day-5 and day-10 follow-ups (shorter, warmer).
- **You review and send.**

> "Draft a [day 5 | day 10] follow-up for [creator]. Original outreach was [email / DM]. Keep it brief, no pressure, one clear CTA."

### E. Content creation (general)

- **You provide:** topic, audience, tone.
- **Agent drafts:** using Born Free facts from `projects/born-free/research/whitepaper.md` (when imported) and the public-sources registry.
- **You review and publish.**

> "Draft [content type] for Born Free. Topic: [X]. Audience: [X]. Use facts from `projects/store-free/research/public-sources-2026.md` and `projects/born-free/research/whitepaper.md`. Tone: partner / early believer."

---

## 5. Task decomposition (agentic)

For complex marketing tasks, break into sub-tasks:

| Task | Sub-tasks | Agent role |
|------|-----------|------------|
| **Influencer campaign** | 1) Discover  2) Extract contacts  3) Draft outreach  4) Track follow-ups | Research, draft, structure |
| **Launch content** | 1) Blog  2) Social posts  3) Email to list | Draft, iterate |
| **Landing page** | 1) Copy  2) CTA  3) SEO | Draft, suggest |
| **Analytics review** | 1) Parse data  2) Summarize  3) Recommend | Analyze, summarize |

Use the `todo_write` tool (in Cursor) or OpenClaw's task graph (in production cron jobs) for multi-step tasks. Mark complete as you go.

---

## 6. Screenshot analysis workflow

### Step 1 — you share

- Screenshots of Modash / other platform (search results, filters, 0 matches).
- Or: creator profiles for contact extraction.

### Step 2 — agent analysis

**For 0 matches:**

- Search terms used.
- Filters that might be too narrow.
- Alternative: "travel creator", "lifestyle influencer", "Web3", "property", "community".
- Free manual discovery paths.

**For creator profiles:**

- Extract: name, handle, platform, followers, contact.
- Content fit score (1–5).
- Suggested tier.

### Step 3 — agent output

- Structured table or CSV.
- Refined search strategy.
- Next actions.

---

## 7. Quick reference prompts

| Need | Prompt |
|------|--------|
| **Refine search** | "I got 0 matches on [platform]. Screenshots: [attach]. Suggest alternative search terms and free discovery methods." |
| **Extract contacts** | "Extract influencer info from these screenshots. Output as table: name, handle, platform, followers, contact." |
| **Draft outreach** | "Draft [channel] for [creator]. [follower count], [content notes]. Partner positioning from `projects/born-free/playbooks/influencer-outreach.md`." |
| **Follow-up** | "Draft day-5 follow-up for [creator]. Original was [brief]. Keep it short." |
| **Content** | "Draft [type] for Born Free. Topic: [X]. Audience: [X]. Facts from `projects/born-free/research/`." |
| **Strategy** | "What's the best way to [X] for Born Free's organic influencer campaign? Constraints: no paid platforms, partner positioning." |

---

## 8. File structure (cross-repo + vault)

```
bornfree-hub/docs/marketing/         # source of truth (Git)
├── ORGANIC-INFLUENCER-OUTREACH-PLAN.md
├── AGENTIC-MARKETING-FRAMEWORK.md
└── …

vault/projects/born-free/            # this Knowtation vault (read by agents via MCP)
├── style-guide/voice-and-boundaries.md
├── outlines/positioning-and-messaging-2026-04.md
├── playbooks/
│   ├── influencer-outreach.md       # vault import of upstream plan
│   └── agentic-marketing-framework.md  # this file
└── drafts/                          # OpenClaw agents write here
```

---

## 9. Next steps

1. **Verify `BORNFREE100`** — ensure coupon is active in Stripe / Blockpass.
2. **Wire OpenClaw agents** to Knowtation hosted MCP (JWT + `X-Vault-Id` from Settings → Integrations → Hub API). Outreach agent reads `projects/born-free/style-guide/voice-and-boundaries.md` + this file before drafting.
3. **Share screenshots** — when ready, attach for agent analysis.
4. **Start tracker** — Notion, Airtable, or spreadsheet.
5. **Pilot first 10** — send 10 outreach messages, refine based on replies, log retro under `projects/born-free/research/outreach-retro-<date>.md`.
