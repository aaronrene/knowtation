---
title: Public sources of truth — registry (2026)
date: 2026-04-26
project: store-free
tags: [meta, sources, registry, gtm, store-free, born-free]
last_reviewed: 2026-04-27
depends_on: []
hosted_hub_path: projects/store-free/research/public-sources-2026.md
---

# Public sources of truth — 2026 registry

**Purpose:** Single **canonical list** of URLs and “where the full text lives” in the vault so agents and humans **fetch or `get_note` from here** instead of hardcoding links in every brief. **Update this file** when domains, paths, or PDFs change; bump `last_reviewed` and add a line under **Change log**.

**Hosted mirror:** On Knowtation Hub (IC-backed vault), this registry lives at **`projects/store-free/research/public-sources-2026.md`** (`hosted_hub_path` in front matter). It is **not** automatically the same file as the Git-tracked copy under `knowtation/vault/` until you import or sync.

## Local Git vs hosted Hub — edit order (anti-drift)

1. **Default:** Edit the **Git-tracked** file first: `knowtation/vault/projects/store-free/research/public-sources-2026.md` in the Knowtation repo, commit when appropriate, then **re-import** to the hosted Hub (markdown import, same `project` / `output_dir` as this note) **or** apply an equivalent `write` on Hub and backfill Git in the same session.
2. **After import or Hub-only edits:** Run **Re-index** on the hosted Hub; for semantic search against the **local** vault, run `knowtation index` (requires a working embedding backend per `config/local.yaml` / env).
3. **Never leave hotfixes only on Hub:** If you change the hosted note without updating Git, **copy the canonical Markdown back** to the repo before closing the session so agents and CI do not diverge.

**Ecosystem-wide paths (optional move):** Sources that should serve multiple products might eventually live under e.g. `projects/born-free/research/` or `projects/bornfree-ecosystem/`; that is a **single PR** move (paths + `depends_on` + links), not incremental renames.

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
| White paper (Born Free / ecosystem — technical, hosted Hub) | `[ADD public PDF or landing URL]` | **Hosted vault:** `projects/bornfree/research/whitepaper.md` (imported; verified 2026-04-27). **Web / repo SoT:** `bornfree-pwa/public/whitepaper.md` and `bornfree-hub/docs/01-COMPREHENSIVE-WHITEPAPER.md` — reconcile when editing either side. |

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

- **2026-04-27** — **Hosted Hub import:** This file was imported via hosted MCP `import` (`source_type: markdown`, `project: store-free`, `output_dir: projects/store-free/research`, filename `public-sources-2026.md`). **Hosted path:** `projects/store-free/research/public-sources-2026.md` (matches Git intent). **Parity notes from `get_note`:** Hub stores `tags` as a comma-separated string and adds import provenance (`author_kind`, `knowtation_editor`, `knowtation_edited_at`); empty `depends_on: []` may round-trip as an empty string — **maintain list-shaped `depends_on` in Git** and re-import when needed. **Re-index:** hosted index run completed same session (`notesProcessed` / `chunksIndexed` returned by bridge). **Whitepaper row:** hosted canonical note path set to **`projects/bornfree/research/whitepaper.md`** (semantic search on Hub).
- **2026-04-26** — Registry created. URLs from the `knowtation` and `bornfree-hub` repositories; public white paper URL and help URLs left as TBD. Recommended import folder for a **Store Free–scoped** copy was **`projects/store-free/research/primary/`**; actual hosted import for the technical paper is under **`projects/bornfree/research/`** (see row above).
