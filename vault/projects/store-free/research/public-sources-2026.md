---
title: Public sources of truth — registry (2026)
date: 2026-04-26
project: store-free
tags: [meta, sources, registry, gtm, store-free, born-free]
last_reviewed: 2026-04-26
depends_on: []
---

# Public sources of truth — 2026 registry

**Purpose:** Single **canonical list** of URLs and “where the full text lives” in the vault so agents and humans **fetch or `get_note` from here** instead of hardcoding links in every brief. **Update this file** when domains, paths, or PDFs change; bump `last_reviewed` and add a line under **Change log**.

**How to use**

- **Agents:** Read this note first → **fetch** public URLs (or browser for heavy JS) → cite **URL + access date** in outputs. If a page is paywalled or fetch fails, use the **vault copy** path in the “Imported materials” section.
- **Humans:** Treat anything **not** listed here as **non-canonical** until added (or mark explicitly “draft” in campaign docs).

**Your list (from handoff—expand as you add properties)**

- [ ] Add any landing pages, partner pages, or region-specific sites you use in campaigns.
- [ ] Add **public white paper URL** when it is hosted (if different from a direct PDF link).
- [ ] Add **terms / privacy** URLs if they are the compliance-approved versions for Store Free and Born Free.

---

## Born Free — marketing and app (public)

| What | URL | Notes |
|------|-----|--------|
| Marketing / main site | `https://bornfree.io` | Also `https://www.bornfree.io` — confirm which is primary for external links. |
| Web app (signed-in experience) | `https://app.bornfree.io` | CORS and production app URL in `bornfree-hub` docs. |
| Store Free (in-app area) | `https://app.bornfree.io/storefree` | Public path referenced in PWA / Store Free docs. |
| PWA / debug (ops) | `https://app.bornfree.io/pwa-debug.html` | For troubleshooting, not standard GTM copy. |

**Last checked:** 2026-04-26 (URLs taken from `bornfree-hub` repo; re-verify in browser before major launch.)

---

## Knowtation — hosted product (public)

| What | URL | Notes |
|------|-----|--------|
| Hosted Hub / product | `https://knowtation.store` | Product site (separate from Born Free; see Knowtation repo for product docs). |

**Last checked:** 2026-04-26

---

## White paper and long-form (public + vault)

| What | Public URL | Vault copy (after you import) |
|------|------------|---------------------------------|
| White paper (Born Free / ecosystem — **add when you import**) | `[ADD public PDF or landing URL]` | See **Imported materials** below — recommended path for the import. |

**Note:** If the only stable artifact is a **file in the vault** (no public URL yet), keep the URL cell as “N/A” and list the vault path as the **internal** source of truth until a public link ships.

---

## Optional additions (add rows as they become important)

- **Docs / help center** — `[URL]` (single canonical help base, if you split marketing vs support.)
- **Status / incidents** — `[URL]`
- **GitHub (public org or repos for trust)** — `[URL]`
- **Block explorer / contract links** (for technical audiences only; align with `docs` before using in mass marketing)
- **Social (official only)** — X / LinkedIn / YouTube: `[URLs]` (reduces off-brand or stale account risk)

---

## Imported materials (vault) — not a substitute for public review

Place **the full imported white paper** (or extracted Markdown) where search and agents can see it, **next to** other Store Free **research** inputs.

**Recommended (simple):** `projects/store-free/research/primary/whitepaper.md` (or `.pdf` if your pipeline keeps binary + sidecar; many teams use **folder** `primary/` or `sources/` **under** `research/` so briefs and snapshots stay in `research/` while long PDFs and imports stay grouped and obvious.)

**Why not a separate top-level `resources` project:** For Store Free, **research** is the right **home** so `depends_on` and semantic search stay under one `project: store-free`. Add **`research/primary/`** (or `research/sources/`) only if you want a **clear split** between “synthesis notes” and “raw / imported primary sources” without a whole new project. A separate `resources` **project** is better when the **same** PDF is referenced by **multiple** products (e.g. ecosystem-wide); then you might use `projects/bornfree-ecosystem/resources/...` and link from Store Free.

**After import:** Add a row under **White paper and long-form** with the **exact** vault path and the **import date**; run **`knowtation index`** (or your hosted reindex) so search finds the content.

---

## Related vault strategy notes (link, do not duplicate)

- `projects/store-free/outlines/positioning-and-messaging-2026-04.md` — positioning (reference this registry in `depends_on` when you next edit).
- `projects/store-free/research/competitive-snapshot-2026-04-24.md`
- `projects/store-free/style-guide/voice-and-boundaries.md`
- Ecosystem: `projects/born-free/style-guide/voice-and-boundaries.md`, `projects/knowtation/style-guide/voice-and-boundaries.md` (paths as in your Business vault; adjust if your tree differs).

---

## Change log

- **2026-04-26** — Registry created. URLs from the `knowtation` and `bornfree-hub` repositories; public white paper URL and help URLs left as TBD. Import path for white paper: **`projects/store-free/research/primary/`** (create folder on first import; filename your choice, e.g. `bornfree-whitepaper-2026.md`).
