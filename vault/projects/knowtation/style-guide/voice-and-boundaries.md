---
title: "Voice and boundaries — Knowtation"
project: knowtation
tags: [style-guide, voice, boundaries, knowtation]
date: 2026-04-23
---

## 1. Audience (one paragraph each)

- **Who we help:** We help **individuals and teams** who want a **durable, searchable** knowledge and content system—people who work with notes, research, and agents and need **clarity, provenance, and control** over what is captured and what ships.
- **What they already believe:** They already believe that **context matters** and that “just search my entire drive” is not a strategy. They are willing to adopt a workflow if the tradeoffs are described honestly.
- **What they fear or are tired of:** Bloat, black-box memory, and marketing that overpromises “perfect recall” or hands-off automation that quietly misstates reality. [NEEDS HUMAN CONFIRMATION: hosted vs self-serve ICP if you split messaging.]

## 2. Positioning (one short paragraph)

- **One-sentence promise:** **Knowtation** (*know* + *notation*) is the place to **capture, index, and find** your notes and media, with a **CLI and optional agents** that stay in sync with *your* source material—not a second truth.
- **What we are NOT (anti-positioning):** We are not a generic “all-knowing” assistant that replaces your judgment, not a data broker, and not a product that will quietly publish or export on your behalf without a clear, reviewable path.

## 3. Voice (how we sound)

- **Practical and plain**—favor the user’s outcome over our engineering cleverness.
- **Specific commands and paths** when we document (CLI names, subcommands, vault-relative paths).
- **No hype** about “revolutionary search”; describe **what the indexer does and what it does not**.
- **Respect time:** quickstarts first; deep spec later.
- **Open about model limits:** retrieval quality depends on what you put in, how you chunk, and your settings. [NEEDS HUMAN CONFIRMATION: if you have SLAs, link them; otherwise keep qualitative.]
- **Friendly to builders** without being gatekeepy; define jargon once, then use it consistently.
- **Steady tone**—we are a tool people rely on, not a viral stunt.

**Good (on-brand) examples**

- Your vault stays yours: the CLI reads Markdown under your `KNOWTATION_VAULT_PATH`—we index what is on disk, not a second secret copy you did not ask for. [NEEDS HUMAN CONFIRMATION: for hosted, replace with the accurate storage story.]
- Re-index when you have bulk-imported or restructured folders; the search store catches up to your files. [As configured in your environment.]
- If you are about to run an export, confirm scope and check the log line so provenance is obvious.

**Bad (avoid)**

- The AI that knows you better than you do—no setup required, infinite wisdom.
- Our graph database quantum search knows everything in your life.
- Just click ship and we will autonomously post to all your channels; trust the algorithm.

## 4. Vocabulary

- **We prefer:** vault, index, search, get-note, write, export, import, project slug, frontmatter, Hub, token-saving, provenance, opt-in, audit trail, documented behavior.
- **We avoid:** empty “AI-native” bragging; “your second brain” if it implies infallible recall; vague “enterprise-grade” without criteria; shaming people for not self-hosting or for self-hosting.
- **Names:** **Knowtation** (never “KnowTation” or “Knowtation™” in running copy unless trademark guidance says otherwise [NEEDS HUMAN CONFIRMATION]). Ecosystem: **Born Free** (`born-free`), **Store Free** (`store-free`).

## 5. Claims and boundaries (non-negotiable)

- We do not promise **investment, legal, tax, or medical** outcomes. Knowtation is a knowledge system, not a regulated product unless you explicitly offer one under separate terms. [NEEDS HUMAN CONFIRMATION: if any SKU is different, add a one-line cross-link.]
- We do not invent **benchmarks**, “95% faster,” or user quotes we cannot verify. Case studies use **verifiable** facts and consent. [NEEDS HUMAN CONFIRMATION: if you have approved stats, replace bracketed areas.]
- If we discuss **data location**, **backups**, **compliance** (e.g. GDPR, HIPAA alignment), or **on-chain** hooks, we keep language accurate and point to your official policies and, where needed, to professional advisors.
- We compare **other tools** on features and fit, not on attacks against people, companies, or user communities. No defamation.

## 6. CTAs and urgency

- **Allowed urgency:** true release dates, end-of-trial and billing dates we state in product, documented deprecations, capacity-constrained betas with real selection criteria, conference or webinar dates.
- **Forbidden urgency:** “Last chance” without an end, fake stock for digital goods, manipulative “your vault will be deleted” unless that is a real policy and timing with prior notice, or spammy re-engagement that misstates account state.

## 7. AI and disclosure

- We disclose **AI assistance** in marketing and docs per **channel rules** and in-product **settings / policies** you maintain.
- A **human** must approve **claims about security, data handling, and roadmap dates** before publish. [NEEDS HUMAN CONFIRMATION: named approvers.]
- For any **synthetic** audio/video/image, follow platform and regional disclosure requirements and your brand rules.

## 8. Review checklist (10 yes/no items)

1. [ ] Is every “how it works” statement true for self-hosted, hosted, or both—whichever this piece targets? [NEEDS HUMAN CONFIRMATION: if split, add two check rows.]
2. [ ] Are all numbers, performance claims, and “used by / trusted by” claims provable and current?
3. [ ] Is **Knowtation** (and other product names) spelled and capitalized correctly?
4. [ ] Have we avoided implying perfect recall, omniscient agents, or autonomous publishing?
5. [ ] If we mention the Hub, OAuth, or tokens, is the user-facing text aligned with the actual auth model? [NEEDS HUMAN CONFIRMATION: if hosted-only features differ, note it.]
6. [ ] If AI helped draft, is disclosure in place and facts reviewed by a human who can own the note?
7. [ ] If we reference blockchain or on-chain features, is the phrasing non-misleading and in line with your legal guidance?
8. [ ] Is urgency, if any, bound to a real event or date?
9. [ ] Do we stay respectful when naming alternatives or “why not spreadsheets”?
10. [ ] Is the CTA a honest next step (e.g. install CLI, start Hub, sign up) without hidden preconditions?
