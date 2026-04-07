---
name: OB1 vs Knowtation Analysis
overview: Strategic comparison with OB1, interop, product inventory, aligned README/whitepaper/site refresh, and Hub UI polish — phased for execution.
todos:
  - id: phase1-ui-polish
    content: "Phase 1 (Sonnet): Hub UI polish — merge Agents into Integrations, widen settings, section spacing, border brightness +10-20%, button visibility, media toolbar borders, search hover, chip/label boldness"
    status: completed
  - id: phase2-whitepaper
    content: "Phase 2 (Opus): Revise docs/WHITEPAPER.md with full product inventory from section 4"
    status: completed
  - id: phase3-readme
    content: "Phase 3 (Sonnet): Overhaul README.md — quick-start, feature highlights, positioning, links"
    status: completed
  - id: phase4-website
    content: "Phase 4 (Opus): Redesign web/index.html — vertical flow, 8 sections, icons + plain language + accordions"
    status: completed
  - id: phase5-interop-docs
    content: "Phase 5 (Sonnet): Dual MCP + Supabase bridge documentation in docs/AGENT-INTEGRATION.md"
    status: completed
  - id: phase6-future
    content: "Phase 6 (Future): Import Guides, Integrations UX, starter templates, skill packs, setup wizard"
    status: pending
isProject: false
---

# Knowtation — Execution Plan (Phased)

This plan covers UI polish, content (whitepaper + README), marketing site redesign, and interop docs. Sections 1-9 from the analysis are preserved below for reference; the execution phases start at section 10.

---

## 10. Execution phases

### Phase 1 — Hub UI polish (Sonnet)

Scoped CSS and minor HTML changes to [`web/hub/hub.css`](web/hub/hub.css) and [`web/hub/index.html`](web/hub/index.html). No JS logic changes.

**1a. Settings menu: merge Agents tab into Integrations**
- In `index.html`: remove the Agents settings tab button (`data-settings-tab="agents"`)
- Move the Agents panel content (`#settings-panel-agents`) into the bottom of `#settings-panel-integrations` with a clear separator heading ("Agent Configuration" or similar)
- This reduces the tab count from 8 to 7, giving each tab more breathing room

**1b. Settings modal width**
- In `hub.css`: increase `.modal-card-settings` `max-width` from `680px` to `820px` so the Consolidation panel and other wide content no longer clips

**1c. Settings section spacing**
- Add `margin-bottom` and optional subtle dividers (`border-top` on section headings) within settings panels for clearer visual separation between groups

**1d. Border / outline brightness — global +10%**
- Dark theme `:root` `--border` goes from `#262626` to `#333333` (~+10% brightness)
- All 12 palette dark variants: bump `--border` by roughly 10% brightness
- Light theme `--border` stays as-is (already visible)
- This affects: search bar, view tabs (List/Calendar/Overview), filter chips, tag pills, list items, card outlines — all use `var(--border)`

**1e. Button borders — +20% brightness + hover**
- `.media-toolbar .btn-small`: change border from `var(--border)` to `color-mix(in srgb, var(--border) 60%, var(--text))` (roughly 20% brighter than the new border)
- Keep existing hover behavior (`.btn-small:hover` → `border-color: var(--accent)`)
- General `button` default border already uses `var(--border)`, which gets the +10% from step 1d; media toolbar buttons get the extra +10% on top

**1f. Quick filter chips and labels — bolder**
- `.filter-chips .chip-btn`: add `font-weight: 600` and change `color` from `var(--muted)` to `var(--text)` (or `var(--accent)` for active chips — already done)
- `.view-tab` labels: add `font-weight: 600`

**1g. Search button hover**
- The global `button:hover { border-color: var(--accent); }` should already cover the search button. Verify; if the search button has a different selector or is an `<input>`, add explicit hover rule.

**Files touched:** [`web/hub/hub.css`](web/hub/hub.css), [`web/hub/index.html`](web/hub/index.html)
**No JS changes needed** (settings tab switching already uses `data-settings-tab` attribute matching)

---

### Phase 2 — Whitepaper update (Opus)

Revise [`docs/WHITEPAPER.md`](docs/WHITEPAPER.md) to incorporate:
- The full product inventory from section 4 of this plan
- Shipped features replace "planned" language
- New sections on: encrypted memory, consolidation daemon, wallet/blockchain imports, attestation/ICP, Supabase bridge, MCP depth (tools/resources/prompts), media pointers
- Positioning vs OB1 and similar tools (without naming OB1 directly — frame as "database-centric vs vault-centric")

**Why Opus:** This requires thesis-quality prose, architectural reasoning, and the ability to weave dozens of technical features into a coherent narrative. The whitepaper sets the tone for everything downstream.

**Files touched:** [`docs/WHITEPAPER.md`](docs/WHITEPAPER.md)

---

### Phase 3 — README overhaul (Sonnet)

Restructure [`README.md`](README.md) to:
- Lead with a one-line tagline + 2-sentence description
- Quick-start section with estimated setup time
- Feature highlights (concise, scannable — not the full inventory)
- "How Knowtation is different" positioning section
- Links to whitepaper, setup docs, SKILL.md, Hub
- Repository layout section (existing, refresh)
- Contributing / license

**Why Sonnet:** The whitepaper provides the narrative; the README is shorter and more structured. Sonnet handles this well.

**Files touched:** [`README.md`](README.md)

---

### Phase 4 — Marketing site redesign (Opus)

Replace [`web/index.html`](web/index.html) with the vertical-flow design from section 6 of the analysis:
- 8 sections, each: icon (SVG or emoji) → headline → 2-3 plain sentences → `<details>` accordion with technical depth
- Mobile-first single column; optional two-column on desktop where natural
- No tables anywhere (marketing page may use cards/grids; principle: scannable layout)
- Password gate removed for public landing (ship ungated `web/index.html`)
- Sign-in links preserved
- Fonts: keep Instrument Serif + Outfit (or upgrade if better pairing found)

**Why Opus:** Largest piece — requires creative writing for layman copy, technical accuracy in accordions, responsive HTML/CSS layout decisions, and visual design sensibility.

**Files touched:** [`web/index.html`](web/index.html), possibly a new `web/site.css` if the inline styles get too large

---

### Phase 5 — Interop documentation (Sonnet)

Add to [`docs/AGENT-INTEGRATION.md`](docs/AGENT-INTEGRATION.md):
- Dual MCP configuration examples (Knowtation + a second brain in Claude Desktop / Cursor)
- Supabase bridge documentation (import from any Supabase table, optional memory dual-write)
- Not framed as OB1-specific; general interoperability

**Files touched:** [`docs/AGENT-INTEGRATION.md`](docs/AGENT-INTEGRATION.md)

---

### Phase 6 — Future work (deferred)

Not in this session. Tracked for later:
- Per-source Import Guides with icons
- Hub Integrations tab UX (icons, status indicators, grouping)
- Starter vault templates (3-5) + seed script extension
- Domain-specific agent skill packs (2-3)
- Interactive first-run setup wizard

---

## Reference: product inventory, site sections, differentiation

(Preserved from the analysis for use during execution — see sections 1-9 of the original plan content below.)

---

## Original analysis sections (reference)

### Architecture comparison
OB1: PostgreSQL + pgvector (Supabase). Knowtation: Markdown vault + optional vector store. Supabase is optional bridge in Knowtation.

### Interoperability
Dual MCP (both servers in one client). Supabase import ([`lib/importers/supabase-memory.mjs`](lib/importers/supabase-memory.mjs)) + optional memory provider ([`lib/memory-provider-supabase.mjs`](lib/memory-provider-supabase.mjs)).

### Product inventory
See section 4 in the previous plan revision — all items from authentication through configuration.

### Marketing site sections (8 steps)
1. Get started in seconds (OAuth, teams, scoping)
2. Bring everything into one place (14 imports, 4 capture channels, transcription, wallet CSV, Supabase)
3. Organize your way (tags, projects, entities, episodes, causal chains)
4. Find anything instantly (semantic + keyword search, filters, calendar, dashboard)
5. Your agents, supercharged (35+ MCP tools, 20+ resources, 13 prompts, subscriptions)
6. Memory that gets smarter over time (consolidation, encryption, session summaries)
7. Propose, review, and trust (proposals workflow, attestation, ICP anchoring)
8. Your data, your infrastructure (self-hosted, hosted, GitHub, billing)

### Differentiation vs OB1
Knowtation: data portability, agent depth, memory intelligence, trust pipeline, monetization, deployment flexibility, Supabase bridge, wallet/blockchain.
OB1: README polish, community framework, multiple dashboards, domain skill packs.
