---
title: Public sources of truth — Knowtation registry (2026)
date: 2026-04-29
project: knowtation
tags: [meta, sources, registry, gtm, knowtation]
last_reviewed: 2026-04-29
depends_on: []
hosted_hub_path: projects/knowtation/research/public-sources-2026.md
---

# Public sources of truth — 2026 registry (Knowtation)

**Purpose:** Single canonical list of **public URLs** and **in-repo / vault** locations for Knowtation so agents and humans **fetch or `get_note` from here** instead of hardcoding links in every brief. **Update this file** when domains, paths, or social handles change; bump `last_reviewed` and add a line under **Change log**.

**Product:** Knowtation (*know* + *notation*) — open source (MIT). Repo: **`aaronrene/knowtation`**. Hosted product: **`knowtation.store`**.

**Hosted mirror:** On Knowtation Hub, this note should live at **`projects/knowtation/research/public-sources-2026.md`** (`hosted_hub_path` above). Keep Git-tracked copy under `knowtation/vault/` in sync with Hub per your usual anti-drift workflow.

**How to use**

- **Agents:** Read this note first → **fetch** public URLs (or use **raw GitHub** links below for stable Markdown) → cite **URL + access date** in outputs. For vault-specific drafts, use paths under `projects/knowtation/` in this vault.
- **Humans:** Treat anything **not** listed here as **non-canonical** until added (or mark explicitly “draft” in campaign docs).

**Checklist**

- [ ] Confirm primary site hostname for campaigns: `https://knowtation.store` vs `https://www.knowtation.store` (both may exist; gateway CORS docs mention listing both in prod).
- [ ] Add **terms / privacy** URLs when you have compliance-approved public pages for the hosted product.
- [ ] Add **status / incidents** URL if you publish one.

---

## Knowtation — product and marketing (public)

| What | URL | Notes |
|------|-----|--------|
| Marketing / landing | `https://knowtation.store` | `web/` deploy; landing at `/`. |
| Hub (signed-in web app) | `https://knowtation.store/hub/` | Trailing slash per `web/README.md`; API may be same origin or separate gateway per deploy. |
| Discord | `https://discord.com/invite/NrtzhZtrED` | Community; verify invite does not expire or replace when Discord settings change. |
| YouTube | `https://www.youtube.com/@Knowtation` | Official channel handle `@Knowtation`. |
| X (Twitter) | `https://x.com/Knowtation1111` | Official account. |

**Last checked:** 2026-04-29 (URLs assembled from user-provided socials + repo `README.md` / `web/README.md`. Re-verify in browser before major launch.)

---

## GitHub — open source (public)

| What | URL | Notes |
|------|-----|--------|
| Repository (HTTPS clone) | `https://github.com/aaronrene/knowtation.git` | From `README.md` quick start. |
| Repository (web) | `https://github.com/aaronrene/knowtation` | Issues and PRs per contributing section. |
| Issues | `https://github.com/aaronrene/knowtation/issues` | Support and contributions entry point. |
| License (MIT) | `https://github.com/aaronrene/knowtation/blob/main/LICENSE` | Copyright 2025–2026 The Knowtation Authors (see file). |

---

## Whitepaper and long-form (public + vault)

Knowtation’s long-form product thesis is **`docs/WHITEPAPER.md`** in the repo (not the Born Free ecosystem paper).

| What | Public URL (stable for agents / fetch) | Vault / repo copy |
|------|----------------------------------------|-------------------|
| Knowtation whitepaper (rendered on GitHub) | `https://github.com/aaronrene/knowtation/blob/main/docs/WHITEPAPER.md` | `docs/WHITEPAPER.md` in clone; **Version 3.3 (April 2026)** per file header (2026-04-29). |
| Knowtation whitepaper (raw Markdown) | `https://raw.githubusercontent.com/aaronrene/knowtation/main/docs/WHITEPAPER.md` | Same content; use for programmatic fetch without GitHub HTML wrapper. |
| README (overview + doc table) | `https://github.com/aaronrene/knowtation/blob/main/README.md` | `README.md` at repo root. |
| Documentation index | `https://github.com/aaronrene/knowtation/blob/main/docs/README.md` | Start-here map to SPEC, Hub API, agents, imports. |

**Note:** If you **import** the whitepaper into a Hub vault for semantic search, add the **exact** vault path in a second row or under **Imported materials** and run **Re-index**. Until then, **GitHub `main`** is the public SoT for long-form text.

---

## Key technical references (public repo)

| What | URL |
|------|-----|
| SPEC (formats, CLI, config contracts) | `https://github.com/aaronrene/knowtation/blob/main/docs/SPEC.md` |
| Hub API | `https://github.com/aaronrene/knowtation/blob/main/docs/HUB-API.md` |
| Agent integration | `https://github.com/aaronrene/knowtation/blob/main/docs/AGENT-INTEGRATION.md` |
| Agent orchestration | `https://github.com/aaronrene/knowtation/blob/main/docs/AGENT-ORCHESTRATION.md` |
| Architecture (repo overview) | `https://github.com/aaronrene/knowtation/blob/main/ARCHITECTURE.md` |

Use **`main`** in links unless you intentionally pin a release tag; then replace `main` with `vX.Y.Z` in GitHub URLs.

---

## Ecosystem (optional — not Knowtation product URLs)

Born Free / Store Free marketing and their whitepaper live in **other** vaults and repos (see `projects/store-free/research/public-sources-2026.md` and Born Free registry under `projects/born-free/`). Do not merge those URLs into Knowtation campaigns unless the copy is explicitly cross-product.

---

## Imported materials (vault) — optional

If you keep a **Hub-only** or **vault** copy of `WHITEPAPER.md` for RAG, record the path here, for example:

- `projects/knowtation/research/whitepaper.md` *(only if you import — not required when using GitHub raw URL above).*

**After import:** Bump `last_reviewed`, add a **Change log** line, re-index.

---

## Related vault notes (link, do not duplicate)

- `projects/knowtation/style-guide/voice-and-boundaries.md`
- `docs/marketing-internal/AGENT-MARKETING-STRUCTURE.md` (repo path — not vault unless mirrored)

---

## Change log

- **2026-04-29** — Registry created: product URLs, socials (Discord, YouTube, X), GitHub and **raw** whitepaper URL, key docs links; aligned with `docs/WHITEPAPER.md` v3.3 header and `README.md` repo URL.
