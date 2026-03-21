# Knowtation — Full Implementation Plan

This document lays out **all phases** to build Knowtation end-to-end. Nothing is left "for later" as unspecified work: every feature in the [SPEC](./SPEC.md), [ARCHITECTURE](../ARCHITECTURE.md), and [IMPORT-SOURCES](./IMPORT-SOURCES.md) is assigned to a phase and will be implemented. Phases are ordered by dependency; each phase produces testable, shippable increments.

**Reference:** [SPEC.md](./SPEC.md) (data formats, CLI, config), [IMPORT-SOURCES.md](./IMPORT-SOURCES.md) (import source types and formats), [ARCHITECTURE.md](../ARCHITECTURE.md) (high-level design).

**Monetization:** Core is open source. Optional paid layer: hosted “Knowtation Hub” (Phase 11) for users who do not want to self-host; they get shared vault, proposals, and review without running servers. See Phase 11.

**Build status (update at end of each session):** Phases 1–10 complete. Phase 11 (Hub) implemented; Phase 11 Hub UX done (How to use on login, tagline, OAuth note, empty states). **Phase 11.1 Hub first screen** done: login panel has hero (title, tagline, intent), primary CTA (sign in above), secondary (How to use); `login-screen` class on app when shown. **Phase 13 (Teams — roles)** implemented: role store (`data/hub_roles.json`), JWT role from store, requireRole middleware; viewer/editor/admin restrict Setup, approve/discard, write, propose; Hub UI shows role in Settings; **Back up now** disabled for non-admins; **Save setup** always clickable—shows clear error + toast for non-admins, success toast + inline message for admins. **Backup (Git):** How to use and Settings document creating backup repo (empty, HTTPS), vault `git init`, Connect GitHub, Back up now; loadingHtml TDZ fix. **Phase 13 invite** implemented: create invite link (Settings → Team), invitee signs in via link and is added to role; pending list and revoke. **Landing (web/)** refreshed and enhanced (ecosystem, token savings, dual CTA, #hosted, knowtation.store). **Guided Setup in Hub** and **Help in Settings** done. **Hosted (canister) product — code complete:** Phase 0 (vault_id, canister auth doc, Hub API URL config); Phase 1 canister (`hub/icp/` Motoko: vault, proposals, export); Phase 2 gateway (`hub/gateway/`: OAuth, proxy to canister with X-User-Id); Phase 3 bridge (`hub/bridge/`: Connect GitHub, Back up now); Phase 4 bridge (index + search); Phase 5 docs (DEPLOY-HOSTED, CANISTER-AND-SINGLE-URL, single URL knowtation.store). **Production (hosted):** knowtation.store + Hub + Netlify gateway + ICP canister are **live**; bridge when **`BRIDGE_URL`** is set — see [STATUS-HOSTED-AND-PLANS.md](./STATUS-HOSTED-AND-PLANS.md). Ongoing: redeploy when code changes; **Phase 15.1** canister work for true multi-vault. **Phase 14 (Two-path launch):** Landing and Hub offer "Use in the cloud (beta)" and "Run it yourself" (Quick start in TWO-PATHS-HOSTED-AND-SELF-HOSTED.md); beta disclaimer on landing and Hub. Hosting = beta, free until Phase 16 (credits). **Hosted parity (Phase 1):** Done. Gateway stubs for roles, invites, POST setup, import, and facets are in `hub/gateway/server.mjs`; Hub UI no longer 404s on hosted for Settings → Team, Setup, or filter dropdowns. See **[PARITY-PLAN.md](./PARITY-PLAN.md)**. Phase 2 = deploy operations only (dfx, Netlify, 4Everland, DNS); no in-repo code. **Multi-vault:** **Self-hosted Phase 15 implemented** (`hub_vaults.yaml`, access, scope, `X-Vault-Id`). **Hosted:** canister still single map per user — **Phase 15.1** checklist in [MULTI-VAULT-AND-SCOPED-ACCESS.md](./MULTI-VAULT-AND-SCOPED-ACCESS.md) § Hosted multi-vault — what to build. **MCP Issue #1 supercharge** merged to `main` (PR); local MCP complete; Hub MCP D2/D3 after hosted stability. **Phase 12 (blockchain):** Reserved in SPEC and BLOCKCHAIN-AND-AGENT-PAYMENTS.md; implement separately when needed. **Phase 16 (hosted credits) — planning docs:** [HOSTED-STORAGE-BILLING-ROADMAP.md](./HOSTED-STORAGE-BILLING-ROADMAP.md) (single Motoko V0→V1: `vault_id` + reserved `balanceCents`) and [HOSTED-CREDITS-DESIGN.md](./HOSTED-CREDITS-DESIGN.md) — **usage-based** charges on high-cost operations; **1 UI credit = $1** with **internal cents** ledger; **non-transferable** platform balance; **Stripe** primary purchase; optional **USDC / AVAX** top-up crediting the same ledger; **beta** = free + **shadow metering**; then priced deductions; optional **grandfather** early users. Implementation of webhooks/deductions follows 15.1 migration unless you add shadow-only logging earlier.

**Status for next session:** **→ [NEXT-SESSION.md](./NEXT-SESSION.md)**. **Hosted:** live — [STATUS-HOSTED-AND-PLANS.md](./STATUS-HOSTED-AND-PLANS.md). **`npm test` green.** **Next engineering:** **Phase 15.1** hosted multi-vault — align canister V1 with [HOSTED-STORAGE-BILLING-ROADMAP.md](./HOSTED-STORAGE-BILLING-ROADMAP.md); [MULTI-VAULT-AND-SCOPED-ACCESS.md](./MULTI-VAULT-AND-SCOPED-ACCESS.md). **Billing rails:** [HOSTED-CREDITS-DESIGN.md](./HOSTED-CREDITS-DESIGN.md). Parity gaps (import/facets) per [PARITY-PLAN.md](./PARITY-PLAN.md). **Then** MCP **D2/D3**, **F2–F5** — [BACKLOG-MCP-SUPERCHARGE.md](./BACKLOG-MCP-SUPERCHARGE.md). **Issue #2** deferred. Re-verify production with [DEPLOY-HOSTED.md](./DEPLOY-HOSTED.md) §5 after deploys.

**Hosted parity (planning):** Same capabilities on the **hosted (web) service** as self-hosted — API parity, behavior parity (Connect GitHub, Back up now, search, index, proposals, Settings), and clear “coming soon” where not yet available. Brief overview and complexity: **[PLAN-ADDENDUM-HOSTED-PARITY.md](./PLAN-ADDENDUM-HOSTED-PARITY.md)**. Nuts and bolts in a dedicated session using PARITY-PLAN, DEPLOY-HOSTED, and BRIDGE-DEPLOY-AND-PREROLL.

---

## What we're doing next (path and stubs)

| Step | What | When |
|------|------|------|
| **Done** | Phase 13 invite, Landing refresh + enhancement, Help in Settings, Guided Setup. **Hosted (canister):** Phases 0–5 code and docs. **Phase 14 (Two-path launch):** Split messaging (Use in cloud beta / Run it yourself), Quick start doc, beta disclaimer; hosting = beta, free until Phase 16. | Done. |
| **Next (first)** | **Option B — Muse protocol alignment:** Document the variation protocol (baseStateId, intent, lifecycle) and ensure canister proposal metadata stays extensible (optional fields for future Muse refs, e.g. muse_commit_id / external_ref). No Muse runtime; we align our contract with [Muse](https://github.com/cgcardona/muse) so we stay compatible. See [MUSE-STYLE-EXTENSION.md](./MUSE-STYLE-EXTENSION.md) §6.2. | Do first. |
| **Then** | **Hosted parity (Phase 1):** Gateway stubs for GET/POST /api/v1/roles, GET/POST/DELETE /api/v1/invites, POST /api/v1/setup, GET /api/v1/notes/facets so Settings → Team, Setup, and filter dropdowns don’t 404 on hosted. See [PARITY-PLAN.md](./PARITY-PLAN.md). | After Option B. |
| **Done** | **Deploy hosted:** knowtation.store + gateway + canister **live**; bridge when `BRIDGE_URL` set. Ongoing: redeploy when code changes — [STATUS-HOSTED-AND-PLANS.md](./STATUS-HOSTED-AND-PLANS.md), [DEPLOY-HOSTED.md](./DEPLOY-HOSTED.md). | Done (ops ongoing). |
| **Next (hosted)** | **Re-verify after changes:** [DEPLOY-HOSTED.md](./DEPLOY-HOSTED.md) §5 + UI smoke; confirm `BRIDGE_URL`, embeddings, OAuth callbacks. | After any prod deploy. |
| **Then** | **Phase 15.1 hosted multi-vault:** Canister storage by `vault_id` + settings/vault list source + backup/index per vault (see MULTI-VAULT checklist). Greenfield: minimal migration. | Primary product gap vs self-hosted multi-vault. |
| **Later** | **Phase 16:** Hosted usage credits — [HOSTED-CREDITS-DESIGN.md](./HOSTED-CREDITS-DESIGN.md); storage gate [HOSTED-STORAGE-BILLING-ROADMAP.md](./HOSTED-STORAGE-BILLING-ROADMAP.md). **Phase 12:** Blockchain when needed. **MCP D2/D3, F2–F5** per backlog. | After 15.1 + beta metering / pricing clarity. |

Stubs done now mean we don't change JWT shape or add new data files later in a breaking way; Phase 13 implementation only populates `role` from a roles store and enforces permissions.

### Option B (Muse protocol alignment) — do first

**Concrete tasks:**

- [x] **Document the variation protocol** in [HUB-API.md](./HUB-API.md) §3.4 Proposals: add "Variation protocol (Muse-aligned)" — identifiers (`proposal_id`, `base_state_id`), `intent`, optional `external_ref`, lifecycle (propose → review → approve/discard). State alignment with [Muse](https://github.com/cgcardona/muse); no Muse runtime.
- [x] **Canister extensibility:** Add `base_state_id` and `external_ref` (both `Text`, default `""`) to `ProposalRecord` in [hub/icp/src/hub/main.mo](hub/icp/src/hub/main.mo). Parse on POST /proposals; include in GET /proposals and GET /proposals/:id responses.
- [x] **No Muse runtime** — we do not run or depend on Muse; protocol alignment only.

**Upgrade note:** If the canister was deployed before Option B with existing proposals, upgrading adds the new fields; Motoko stable storage may require a migration or re-deploy depending on runtime behavior. For fresh deploys, no migration needed.

### Recommended next steps (after Option B)

1. **Complete Phase 1 parity** — Add GET /api/v1/notes/facets stub in gateway if not already present; verify all Phase 1 stubs (roles, invites, POST setup, import 501) are in place. See [PARITY-PLAN.md](./PARITY-PLAN.md).
2. **Deploy hosted** — Merge parity branch; trigger Netlify rebuild for gateway; no canister redeploy unless hub/icp code changed. See [DEPLOY-STEPS-ONE-PAGE.md](./DEPLOY-STEPS-ONE-PAGE.md) and "Already deployed" path if canister + Netlify already exist.
3. **Suggested prompts for agents** (optional) — Add a Hub section or doc (e.g. SUGGESTED-AGENT-PROMPTS.md) with example prompts, commands, and reasoning strings for agents; backlog in IMPLEMENTATION-PLAN.
4. **Issue #1 MCP leftovers (after hosted parity)** — **D2/D3** (Hub MCP proxy + OAuth), **F2–F5** (sampling beyond `summarize`). Requirements and phase table: [BACKLOG-MCP-SUPERCHARGE.md](./BACKLOG-MCP-SUPERCHARGE.md). **Issue #2** (AgentCeption / Infinite Machine Brain): defer full program; thin slices only later. **Do not** start D2/D3 before hosted parity foundations — see BACKLOG § Strategic sequencing.

### Phase 11.1 and follow-on: order and status

Use this list to see what’s done and what’s not. Update the status when each item is completed.

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | **Hub first screen (login)** | Done | First thing at Hub URL: hero (title, tagline, intent), primary CTA (sign in above), "How to use" secondary. App class `login-screen` when shown; header provider buttons emphasized. |
| 2 | **Phase 13 invite** | Done | Invite by link: admin creates link (role) in Settings → Team; invitee opens link, signs in; added to roles. Pending list and revoke. |
| 3 | **Landing (web/) refresh** | Done | Repo + whitepaper links, tagline, Hub feature card. **Enhancement:** ecosystem graphic (tools → Knowtation → precise fetch), token-savings copy, intent compact/lower, dual CTA (View repo + Try Hub), #hosted section, links to AGENT-INTEGRATION + RETRIEVAL. |
| 4 | **Guided Setup in Hub** | Done | Setup checklist in Settings → Backup: (1) Vault path set, (2) Hub running, (3) Logged in, (4) Backup configured (optional). Steps 2–3 always Done; 1 and 4 derived from /api/v1/settings. "Done" per step with ✓. |
| 5 | **Help in Settings** | Done | "How to use" link in Settings modal header; opens How to use modal with Knowledge & agents tab. |
| 6 | **Hackathon (e.g. Age Inception)** | In progress | Landing reflects whitepaper (token savings, precise fetch); clear connect instructions (CLI/MCP in AGENT-INTEGRATION, RETRIEVAL; landing links to both). Any hackathon-specific doc: e.g. AGENTCEPTION-HACKATHON.md. |
| 7 | **Domain connection** | Ready when you are | **Landing now:** Deploy `web/` to Netlify or 4Everland, add custom domain. **Hub later:** Subdomain when hosted Hub exists. See [DOMAIN-AND-DEPLOYMENT.md](./DOMAIN-AND-DEPLOYMENT.md) for step-by-step (Netlify, 4Everland, Cloudflare). |
| 8 | **Landing: add "API" to tagline** | Later | Tagline currently says "agent-ready MCP and CLI"; add "API" in a later phase when we surface a dedicated public/developer API (Hub REST exists but is not yet called out in landing tagline). |
| 9 | **Phase 14 (Two-path launch)** | Done | Landing and Hub: "Use in the cloud (beta)" and "Run it yourself" (Quick start in TWO-PATHS-HOSTED-AND-SELF-HOSTED.md); beta disclaimer. Hosting = beta, free until Phase 16. |
| 10 | **Edit note in Hub detail panel** | Done | Note detail panel: "Edit" button for editor/admin; inline edit (body + frontmatter JSON); Save → POST /api/v1/notes; Cancel restores read-only. Implemented in web/hub/hub.js; works with Node Hub and canister-hosted. |
| 11 | **Hub Export and Import** | Done | Export: POST /api/v1/export (path, format) returns { content, filename }; note detail panel "Export" button (editor/admin). Import: POST /api/v1/import multipart (source_type, file; optional project, tags); ZIP extracted for folder sources; header "Import" button and modal. lib/export.mjs exportNoteToContent(); hub multer + adm-zip. |
| — | **Hosted / ICP (canister)** | Live | Canister, 4Everland (knowtation.store), Netlify gateway, DNS. Bridge when **`BRIDGE_URL`** set (reported operational). **Re-verify** after deploys: [DEPLOY-HOSTED.md](./DEPLOY-HOSTED.md) §5, [STATUS-HOSTED-AND-PLANS.md](./STATUS-HOSTED-AND-PLANS.md). **Optional:** canister redeploy for Option B proposal fields. **Phase 15 (multi-vault):** self-hosted ✅; hosted **Phase 15.1** = canister `(uid, vault_id)` storage — [MULTI-VAULT-AND-SCOPED-ACCESS.md](./MULTI-VAULT-AND-SCOPED-ACCESS.md) § Hosted. |

---

## Audience, UX principles, and general-public checklist

**Goal:** The **hosted** offering is for the **majority of users who are not technical**. They should be able to sign up, use the Hub, and connect agents or backup without editing config files or running servers. **Self-hosted** remains for technical users who want full control. Every UI and "How to use" decision should keep both in mind; when in doubt, optimize for **non-technical, hosted** users so we don't forget obvious UI/UX.

### Principles (apply as we go)

| Principle | Meaning |
|-----------|--------|
| **Streamline setup** | Minimize steps to first value. Hosted: sign up → land in Hub → add note or import. Self-hosted: How to use + Setup modal guide step-by-step; avoid jargon where possible. |
| **Reduce technical burden** | No YAML or env vars in the main path for hosted users. For self-hosted, document clearly but offer "Copy env" and plain-language explanations (e.g. Settings → Agents). |
| **Plain-language errors** | Error messages and empty states should say what went wrong and what to do next in human terms. Avoid raw stack traces or API codes in the UI. |
| **In-app How to use** | How to use (and Knowledge & agents) must be discoverable: from the header when logged in, and **from the login screen** so new users can read before signing in. |
| **Agents and teams** | Agent integration (CLI, MCP, proposals) is documented and surfaced (e.g. Settings → Agents). Phase 13 (Teams) will add roles and invite; UX for "invite a teammate" and role hints should be non-technical. |

### Checklist: UI/UX and How to use (don't forget)

Use this as a living checklist. As we implement each item, mark it or move it to "Done." Items not done now are assigned to a phase so we don't drop them.

| Item | Phase / when | Notes |
|------|--------------|--------|
| **How to use visible before login** | Phase 11 (Hub UX) ✅ | Link or button on login screen opens How to use modal so new users can read before signing in. |
| **OAuth message for hosted users** | Phase 11 (Hub UX) ✅ | When OAuth not configured, add one line: "If you're on a hosted Knowtation site, the provider has set this up—just sign in above." |
| **Empty states (Notes, Suggested, Activity)** | Phase 11 (Hub UX) ✅ | Friendly copy when no notes or no proposals (e.g. Suggested mentions + New note and agent/CLI; Notes already had "Add a note or clear filters."). |
| **First-run / onboarding wizard (hosted)** | Hosted (HOSTED-PLUG-AND-PLAY) | After sign-up: optional "Get started" flow (create first note, connect GitHub, connect agent). Not for self-hosted. |
| **Guided Setup in Hub** | Phase 11.1 or later | For self-hosted: wizard or checklist in Setup (vault path → run Hub → log in → backup) with "Done" state per step. |
| **Help entry point everywhere** | Phase 11 (Hub UX) / Phase 11.1 | How to use and Knowledge & agents reachable from header and from login screen ✅. Optional "?" or link in Settings modal (Phase 11.1). |
| **Teams: invite and roles UX** | Phase 13 | When we add roles and invite: "Invite teammate" and role labels (viewer / editor / admin) in plain language; no technical jargon. |
| **Landing page: clear value and CTA** | Phase 11 (web/) | Landing explains what Knowtation is and who it's for (humans + agents); primary CTA for hosted sign-up or self-host docs. |
| **Hub first screen (login): simple, user-friendly CTA** | Phase 11.1 ✅ | First thing at Hub URL: hero (title, tagline, intent), sign-in as primary CTA (header buttons), "How to use" secondary. Done. |
| **Proposals: verify with agents/repos** | When integrating agents/repos | Proposals (create/approve/discard) not yet verified with agent integrations or repo flows. When we connect agents or repo workflows, verify end-to-end and update UI copy if needed. |
| **Accessibility and i18n** | Ongoing | Semantic HTML, ARIA, keyboard nav; optional i18n later. |

**Phase 11 (Hub UX)** in the table means: do it as part of the current Hub work (this plan update and the next step). **Phase 11.1** is an optional follow-on for a fuller "Hub UX and onboarding" pass (e.g. guided Setup wizard, **Hub first screen** with landing-style CTA). **Hosted** items live in [HOSTED-PLUG-AND-PLAY.md](./HOSTED-PLUG-AND-PLAY.md) and the multi-tenant phase.

**Landing page (web/index.html):** The existing landing has hero (tagline, intent, CTA), product mock, Why Knowtation, What you get, pricing, etc. Some copy and links are outdated (e.g. repo URL, whitepaper path). When we do **Hub first screen** or refresh the **public landing**, reuse that structure and tone but update for current implementation (Hub, proposals, agents, hosted). See checklist row "Hub first screen" and "Landing page: clear value and CTA."

---

## Phase 1 — Foundation: config, vault paths, and read-only CLI

**Goal:** Load config, resolve vault path, and implement read-only note access. No vector store yet.

**Deliverables:**

1. **Config loader** — Read `config/local.yaml`; override with env (`KNOWTATION_VAULT_PATH`, `QDRANT_URL`, `KNOWTATION_DATA_DIR`, etc.). Validate required `vault_path`. Support all keys in SPEC §4.4 (embedding, memory, air).
2. **Vault utilities** — List Markdown files under vault root; respect optional ignore list (e.g. `templates/`, `meta/`). Parse frontmatter (YAML) + body. Normalize project slug and tags (lowercase, `a-z0-9`, hyphen).
3. **CLI: `get-note`** — Read one note by vault-relative path; output raw or `--json` (frontmatter + body). Support `--body-only` and `--frontmatter-only` per SPEC §4.1–4.2. Exit 0/1/2 per SPEC.
4. **CLI: `list-notes`** — List notes with `--folder`, `--project`, `--tag`, `--limit`, `--offset`. Support `--fields path|path+metadata|full` and `--count-only` per SPEC §4.1–4.2. Filter by path and frontmatter. Output table or `--json` per SPEC §4.2. Order: by date (newest first) or path.
5. **CLI: error handling** — Usage errors → exit 1; missing file, invalid path → exit 2. With `--json`, error object `{ "error": "...", "code": "..." }`.

**Acceptance:** `knowtation get-note vault/inbox/foo.md`, `knowtation list-notes --folder vault/inbox --limit 5 --json` work against a test vault. No stubs.

---

## Phase 2 — Indexer: chunk, embed, vector store ✅

**Goal:** Walk vault, chunk Markdown, embed, store in Qdrant or sqlite-vec with metadata (path, project, tags). Idempotent upsert.

**Deliverables:**

1. **Chunking** — Split Markdown by heading or fixed size (e.g. 256–512 tokens); overlap configurable. Attach to each chunk: vault-relative path, project (from path or frontmatter), tags (array), date if present.
2. **Embedding** — Integrate one provider (e.g. Ollama `nomic-embed-text`) from config (`embedding.provider`, `embedding.model`). Optional: OpenAI or other; use env for API keys.
3. **Vector store** — Implement backend for **Qdrant** (collection with metadata filter support) and/or **sqlite-vec**. Store vectors + metadata; stable chunk id (path + chunk index or content hash) for upsert (no duplicates on re-run).
4. **Script / CLI: `index`** — Run indexer from `knowtation index` (or `node scripts/index-vault.mjs`). Read vault and config; write to configured store. Log progress; exit 0 on success, 2 on failure.
5. **Optional ignore** — Config or default ignore patterns (e.g. `templates/`, `meta/`) so those folders are not indexed.

**Acceptance:** After adding/editing notes, `knowtation index` runs without error. Vector store contains chunks with correct metadata. Re-run does not duplicate points.

**Implemented (Phase 2 session):**
- `lib/chunk.mjs`: Split by `##`/`###` then by configurable size/overlap; stable id `path_index`.
- `lib/embedding.mjs`: Ollama (default `nomic-embed-text`) and OpenAI (`OPENAI_API_KEY`); `embeddingDimension()` for collection creation.
- `lib/vector-store.mjs`: Qdrant only (`@qdrant/js-client-rest`); `ensureCollection(dimension)`, `upsert(points)`; point id = hash of chunk id for idempotent upsert.
- `lib/indexer.mjs`: `runIndex()` — list vault (with ignore), chunk, embed in batches, upsert; config `indexer.chunk_size` / `chunk_overlap`, `embedding` defaults in config.
- CLI `knowtation index` and `node scripts/index-vault.mjs` both call `runIndex()`; `--json` outputs `{ ok, notesProcessed, chunksIndexed }`.
- **sqlite-vec:** Deferred to **Phase 10** (see Phase 10 deliverable below). Until then, `vector_store: qdrant` and `qdrant_url` are required.

---

## Phase 3 — Search

**Goal:** Semantic search over the index with filters; JSON output; exit codes.

**Deliverables:**

1. **CLI: `search`** — Query string; embed query with same model as indexer; search vector store. Filters: `--folder`, `--project`, `--tag` (metadata filter or post-filter). `--limit` (default 10). **Retrieval/token levers:** `--fields path|path+snippet|full` (default path+snippet), `--snippet-chars <n>`, `--count-only` per SPEC §4.1–4.2. Output: ranked list (path, snippet, score, project, tags) or reduced payload per `--fields`/`--count-only`. See docs/RETRIEVAL-AND-CLI-REFERENCE.md.
2. **Hybrid (optional)** — Keyword or BM25 alongside vector search; combine scores. Can be Phase 3.1 if time.
3. **JSON and errors** — `--json` outputs exact shape from SPEC §4.2 (including count-only and fields variants). Exit 0/1/2; JSON error object on failure when `--json`.

**Moved to Phase 3.1:** Time and causal filters (`--since`, `--until`, `--chain`, `--entity`, `--episode`, `--order`) for search and list-notes are implemented in **Phase 3.1** (next). See Phase 3.1 below.

**Acceptance:** `knowtation search "community building" --project born-free --json` returns valid JSON. Unindexed vault or missing store → clear error and exit 2.

**Implemented (Phase 3 session):**
- `lib/vector-store.mjs`: Added `search(queryVector, options)` with Qdrant filter (project, tag), post-filter for folder (path prefix); `count()` for collection. Clear error when collection does not exist ("Run knowtation index first").
- `lib/search.mjs`: `runSearch(query, options)` — load config, embed query, vector store search, apply --fields (path | path+snippet | full), --snippet-chars, --count-only; SPEC §4.2 JSON shape. For `--fields full`, reads note from vault per hit (cached by path).
- CLI `knowtation search <query>`: parses --folder, --project, --tag, --limit, --fields, --snippet-chars, --count-only; table or --json output; exit 2 on runtime errors (missing index, embedding failure, etc.).

---

## Phase 3.1 — Time and causal filters (next)

**Goal:** Add time-bounded and optional causal/entity/episode filters to search and list-notes so retrieval matches SPEC §4.1 and docs/INTENTION-AND-TEMPORAL.md. Completes the retrieval filter set before Phase 4.

**Deliverables:**

1. **search:** `--since <date>`, `--until <date>` — Filter results to chunks/notes with `date` (or `updated`) in range. Use metadata filter in vector store (Qdrant supports range on payload) or post-filter. `--order date|date-asc` — Order search results by date when applicable (post-sort or via store).
2. **list-notes:** `--since`, `--until`, `--order date|date-asc` — Already has date from frontmatter; filter and order by date. Add `--chain <causal_chain_id>`, `--entity <entity>`, `--episode <id>` when optional frontmatter is present (filter list-notes by these fields).
3. **Indexer (optional in 3.1):** If implementing `--chain`, `--entity`, `--episode` for search: store optional frontmatter (`causal_chain_id`, `entity`, `episode_id`) in chunk metadata and vector store payload so search can filter. SPEC §2.3 and INTENTION-AND-TEMPORAL define the fields; indexer already has path, project, tags, date.
4. **Vector store search:** Extend `search()` filter for `since`/`until` (date range) and, if indexed, `causal_chain_id`, `entity`, `episode_id`. Qdrant supports range filters on payload.

**Acceptance:** `knowtation search "decisions" --since 2025-01-01 --until 2025-03-31 --json` returns only hits in that date range. `knowtation list-notes --since 2025-03-01 --order date-asc --limit 5 --json` returns notes in range, oldest first. Optional: `--chain` / `--entity` / `--episode` work when notes carry that frontmatter and indexer stores it.

**Implemented (Phase 3.1 session):**
- `lib/vault.mjs`: readNote() returns `updated`, `causal_chain_id`, `entity` (array), `episode_id` from optional frontmatter; normalized per SPEC §2.3.
- `lib/chunk.mjs` + `lib/indexer.mjs`: Chunks and upsert payload include `causal_chain_id`, `entity`, `episode_id` so vector store can filter.
- `lib/vector-store.mjs`: buildFilter() adds date range (`since`/`until`), `causal_chain_id`, `entity`, `episode_id`; search() accepts and applies them; results sorted by `order` (date | date-asc). Payload stores causal_chain_id, entity, episode_id.
- `lib/search.mjs`: runSearch() accepts since, until, order, chain, entity, episode; passes to store.search().
- `cli/index.mjs`: list-notes parses --since, --until, --chain, --entity, --episode; filters by date range and optional frontmatter; search parses --since, --until, --order, --chain, --entity, --episode and passes to runSearch(). Help text updated for both commands.

**After Phase 3.1:** Proceed to Phase 4 (write, export).

---

## Phase 4 — Write and export

**Goal:** Create/update notes from CLI; export to file or directory; provenance and AIR hook points.

**Deliverables:**

1. **CLI: `write`** — Create or overwrite note at vault-relative path. Options: `--stdin` (body from stdin), `--frontmatter k=v` (merge or set), `--append` (append body). Inbox and non-inbox. If AIR enabled and path outside inbox, call AIR hook before write; log AIR id.
2. **CLI: `export`** — Export one note or a set (by path or by query) to output path or directory. Formats: `md`, `html` (minimal). Record provenance (source_notes) in sidecar or frontmatter. If AIR enabled, attest before export; log AIR id.
3. **Provenance** — When exporting, store which vault paths were used (e.g. in a manifest or in export frontmatter). Optional: write to memory layer (Phase 8).
4. **Error handling** — Write/export failures (e.g. permission, disk full) → exit 2, JSON error when `--json`.

**Acceptance:** `knowtation write vault/inbox/new.md --stdin --frontmatter source=cli date=2026-03-13` creates the note. `knowtation export vault/projects/foo/note.md ./out/ --format md` produces file and provenance.

**Implemented (Phase 4 session):**
- `lib/write.mjs`: writeNote(vaultPath, relativePath, { body, frontmatter, append }); path validation via resolveVaultRelativePath; merge frontmatter; append body; mkdirp parent; toMarkdown serialization.
- `lib/air.mjs`: attestBeforeWrite(config, path) and attestBeforeExport(config, paths); when air.enabled and path outside inbox, call endpoint or return placeholder; inbox exempt.
- `lib/export.mjs`: exportNotes(vaultPath, paths, outputPath, { format: 'md'|'html' }); single file or directory; provenance in exported frontmatter (source_notes); minimal HTML wrapper.
- CLI `write`: --stdin, --frontmatter k=v [k2=v2 ...], --append; AIR hook before write (non-inbox). JSON: `{ path, written: true }`.
- CLI `export`: path-or-query (path or search query); --format md|html, --project; resolve paths via path check or runSearch; AIR hook before export; export to file or dir; JSON: `{ exported: [{ path, output }], provenance }`.

---

## Phase 5 — Capture: one reference message-interface plugin

**Goal:** Prove the message-interface contract with one working plugin (e.g. Slack or Discord webhook, or file-based ingest). Document contract; plugin writes to vault inbox with required frontmatter.

**Deliverables:**

1. **Contract doc** — Already in SPEC §3 and ARCHITECTURE; add a short **docs/CAPTURE-CONTRACT.md** (or section in SPEC) that plugin authors can follow (path, frontmatter, idempotency with `source_id`).
2. **Reference plugin** — One working plugin (e.g. Slack incoming webhook → HTTP server or script that writes one note per event to `vault/inbox/` or `vault/projects/<project>/inbox/` with `source`, `date`, `source_id`). Delivered as script in `scripts/capture-*` or `plugins/` with README.
3. **Optional: webhook server** — Small HTTP server that receives webhook payloads and writes notes (so user can point Slack/Discord at a URL). Config: port, vault path, optional project/tags.
4. **Docs** — README or docs update: how to run the reference plugin; how to add another (JIRA, Telegram, etc.) using the same contract.

**Acceptance:** Sending a test message to the webhook (or running the script with a test file) creates a note in the vault with correct frontmatter. Re-send with same `source_id` → idempotent (skip or update per design).

**Implemented (Phase 5 session):**
- `docs/CAPTURE-CONTRACT.md`: Plugin-author doc (output location, required frontmatter, filename, idempotency, examples).
- `scripts/capture-file.mjs`: File-based capture; stdin or `--file`; `--source`, `--source-id` (idempotent overwrite), `--project`, `--tags`; writes to inbox or projects/<project>/inbox with SPEC §2.2 frontmatter.
- `scripts/capture-webhook.mjs`: HTTP server; POST /capture with JSON `{ body, source_id?, source?, project?, tags? }`; writes to inbox per contract.
- `docs/setup.md`: Added capture step; link to CAPTURE-CONTRACT.

---

## Phase 6 — Import from external sources

**Goal:** Implement `knowtation import <source-type> <input>` for the source types in [IMPORT-SOURCES.md](./IMPORT-SOURCES.md). Each importer produces vault notes with our frontmatter.

**Deliverables:**

1. **CLI: `import`** — Subcommand `knowtation import <source-type> <input> [--project] [--output-dir] [--tags] [--dry-run] [--json]`. Exit 0/1/2; JSON summary when `--json`.
2. **Importers (in order of priority):**
   - **markdown** — Generic: path to file or folder; copy or symlink into vault; add `source: markdown`, `date` if missing. Optional frontmatter normalization.
   - **chatgpt-export** — Parse OpenAI export ZIP or folder with `conversations.json`; one note per conversation (or per thread); frontmatter: `source: chatgpt`, `source_id`, `date`, `title`.
   - **claude-export** — Parse Claude export (ZIP or folder); one note per conversation or memory entry; `source: claude`, `source_id`, `date`.
   - **audio** — Path to audio file (or URL if supported); run transcription pipeline (Phase 7); write one note to vault (e.g. `vault/media/audio/` or inbox) with `source: audio`, `source_id`, `date`.
   - **video** — Same as audio; transcribe; `source: video`.
   - **mif** — Path to `.memory.md` or folder; copy into vault; optionally normalize frontmatter to our schema; add `source: mif`.
   - **mem0-export** — Path to Mem0 export JSON (or API + credentials); map each memory to one note; `source: mem0`, `source_id`, etc.
   - **notebooklm** — If feasible: NotebookLM export or API; one note per source. Document Google auth or export flow.
   - **gdrive** — Google Drive folder or file IDs; export Docs to Markdown/text; write notes with `source: gdrive`, `source_id`.
3. **Idempotency** — Where platform gives stable ids (ChatGPT, Claude, Mem0), skip or update existing note with same `source` + `source_id`.
4. **Docs** — IMPORT-SOURCES.md already describes each type; add "How to run" examples (e.g. where to get ChatGPT export ZIP, how to run `knowtation import chatgpt-export ./chatgpt-export.zip`).

**Acceptance:** For each implemented source type, a test input (e.g. sample ZIP or file) produces the expected vault notes. `knowtation list-notes` and `knowtation search` see them after indexing.

**Implemented (Phase 6 session):**
- `lib/import.mjs`: runImport(sourceType, input, options); dispatches to importers; options: project, outputDir, tags, dryRun.
- `lib/importers/markdown.mjs`: File or folder; preserve frontmatter; add source: markdown, date if missing; merge project/tags.
- `lib/importers/chatgpt.mjs`: Folder with conversations.json; one note per conversation; source: chatgpt, source_id, date, title.
- `lib/importers/claude.mjs`: Folder of .md or JSON; one note per conversation; source: claude, source_id, date.
- `lib/importers/mif.mjs`: .memory.md, .memory.json, or folder; add source: mif; normalize mif:id → source_id.
- `lib/importers/mem0.mjs`: Mem0 export JSON; one note per memory; source: mem0, source_id.
- `lib/importers/audio.mjs` / video: Placeholder note (Phase 7 transcription not yet implemented).
- `lib/importers/notebooklm.mjs`, gdrive.mjs: Stub (throws with guidance).
- CLI: import subcommand with --project, --output-dir, --tags, --dry-run, --json.
- docs/IMPORT-SOURCES.md: Added §6 "How to run" examples.
- docs/PHASE6-MANUAL-TEST.md: Manual testing guide.

---

## Phase 7 — Transcription pipeline

**Goal:** Audio and video files (or URLs) → transcript → one vault note per recording. Reuse or extend for wearable/webhook transcripts.

**Deliverables:**

1. **Transcription** — Integrate one provider (e.g. Whisper via Ollama, or OpenAI Whisper, or Deepgram). Config: provider, model, API key via env. Input: local file or URL (if supported).
2. **Script / `import audio|video`** — `scripts/transcribe.mjs` or equivalent: accept file path (and optional URL); run transcription; write one note to `vault/media/audio/` or `vault/media/video/` (or configurable) with frontmatter `source: audio` or `source: video`, `source_id` (filename or id), `date`, optional `project`/`tags`. Body = transcript text.
3. **Optional: chapters** — For video, optional chapter detection (e.g. timestamps) and store in note structure or frontmatter.
4. **Wearables** — Document that real-time wearable transcripts (e.g. Omi webhook) can be handled by the same message-interface contract: webhook receiver writes transcript to inbox with `source: audio` or `source: wearable`. No separate pipeline; capture plugin suffices.

**Acceptance:** `knowtation import audio ./recording.m4a --project born-free` produces a note in the vault. `knowtation index` then makes it searchable.

**Implemented (Phase 7 session):**
- `lib/transcribe.mjs`: transcribe(filePath) via OpenAI Whisper API; OPENAI_API_KEY required; formats: mp3, mp4, mpeg, mpga, m4a, wav, webm.
- `lib/importers/audio.mjs`: importAudio/importVideo call transcribe(), write note with transcript as body; source: audio|video, source_id, date.
- `scripts/transcribe.mjs`: Standalone script; transcribe to stdout or `--write <vault-path>`.
- Config: transcription.provider, transcription.model (default openai, whisper-1).
- docs/PHASE7-MANUAL-TEST.md: manual testing guide.

---

## Phase 8 — Memory and AIR hooks

**Goal:** Optional memory layer (e.g. Mem0) and AIR (intent attestation) integrated at the spec’s hook points. No new CLI surface beyond config.

**Deliverables:**

1. **Memory** — When `memory.enabled` is true: (1) After search, optionally store "last query + result set" (or hash) in memory backend. (2) After export, store provenance (source_notes → export path) in memory. (3) Optional subcommand `knowtation memory query "last export"` or similar to read from memory. Implement for one backend (e.g. Mem0 API or local).
2. **AIR** — When `air.enabled` is true: Before `write` (non-inbox) and before `export`, call AIR endpoint (or local flow); obtain attestation id; log it (e.g. in log file or in note frontmatter). Inbox writes exempt.
3. **Config** — `memory.enabled`, `memory.provider`, `memory.url`; `air.enabled`, `air.endpoint`. Env overrides where applicable.
4. **Graceful degradation** — If memory or AIR service unavailable, log and either skip (memory) or fail the operation (AIR) per product choice. Document behavior.

**Acceptance:** With memory and AIR configured, running export triggers AIR and stores provenance in memory. With services off, CLI still works (memory optional; AIR can fail the op or be made optional per config).

**Implemented (Phase 8 session):**
- `lib/memory.mjs`: storeMemory(dataDir, key, value), getMemory(dataDir, key); file backend stores in data/memory.json; graceful on error.
- CLI search: after runSearch, if memory.enabled, store last_search (query, paths, count).
- CLI export: after exportNotes, if memory.enabled, store last_export (provenance, exported).
- CLI: `knowtation memory query <key>` — keys: last_search, last_export; requires memory.enabled.
- Config: memory.enabled, memory.provider (file), memory.url; air.enabled, air.endpoint (normalized).
- AIR: already implemented in Phase 4 (lib/air.mjs); calls endpoint or placeholder when unreachable.
- docs/PHASE8-MANUAL-TEST.md.

---

## Phase 9 — MCP server

**Goal:** MCP server that exposes the same operations as the CLI (search, get-note, list-notes, index, write, export, import) with same semantics. For clients that only speak MCP.

**Deliverables:**

1. **MCP server** — Implement MCP server (e.g. stdio or SSE transport). Tools: search, get_note, list_notes, index, write, export, import. Each tool’s inputs map to CLI args; outputs match CLI `--json` shapes. Primary interface for agent runtimes that speak MCP (Cursor, Claude Desktop, AgentCeption-style orchestrators).
2. **CLI in agent environments** — Same operations available via CLI; agents in containers or worktrees (e.g. [AgentCeption](https://github.com/cgcardona/agentception) engineer agents) run `knowtation` with `KNOWTATION_VAULT_PATH` (and config) set. Both MCP and CLI are first-class; orchestrators choose per environment.
3. **Config** — Optional config or env to enable MCP (e.g. for Cursor, Claude Desktop). Document how to run (e.g. `knowtation mcp` or separate entry point).
4. **Single backend** — Server calls the same core logic as the CLI (no duplicate business logic).

**Acceptance:** MCP client (e.g. Cursor with MCP config) can run search, get-note, list-notes, write, export, import and get correct responses. CLI works when invoked from an agent process (e.g. Docker exec) with vault path and config set.

**Implemented (Phase 9 session):**
- `mcp/server.mjs`: MCP server with stdio transport; tools: search, get_note, list_notes, index, write, export, import. Uses `@modelcontextprotocol/sdk` and zod.
- **Issue #1 Phase A (Resources):** `mcp/resources/*` — `knowtation://` URIs (vault listings, notes, templates, index stats/tags/projects/graph, redacted config, memory keys, AIR log placeholder). Registered via `registerKnowtationResources` from `mcp/server.mjs`. See **docs/MCP-RESOURCES-PHASE-A.md**.
- **Issue #1 Phase C (enhanced tools):** `mcp/tools/phase-c.mjs` — relate, backlinks, capture, transcribe, vault_sync, summarize, extract_tasks, cluster, memory_query, tag_suggest; libs under `lib/` as in **docs/MCP-PHASE-C.md**.
- **Issue #1 Phase E (subscriptions + watcher):** `mcp/resource-subscriptions.mjs` — `resources/subscribe` / `unsubscribe`, chokidar on `vault_path`, debounced `notifications/resources/updated` and `list_changed`; `index` tool notifies index/tags/projects/graph URIs when subscribed. **docs/MCP-PHASE-E.md**.
- **Issue #1 Phase H (progress + logging):** `mcp/tool-telemetry.mjs`; `McpServer` with `capabilities.logging`; `index` / `import` use `_meta.progressToken` + `onProgress` in `lib/indexer.mjs` and markdown importer; structured `notifications/message` for index/import/write. **docs/MCP-PHASE-H.md**.
- **Issue #1 Phase B (prompts):** `mcp/prompts/register.mjs` + `helpers.mjs` — ten prompts (daily-brief, search-and-synthesize, project-summary, write-from-capture, temporal-summary, extract-entities, meeting-notes, knowledge-gap, causal-chain, content-plan); `listNotesForCausalChainId` in `mcp/resources/graph.mjs`. **docs/MCP-PHASE-B.md**.
- **Issue #1 Phase D1 (Streamable HTTP):** `mcp/http-server.mjs`, `mcp/create-server.mjs` (shared mount), `mcp/stdio-main.mjs`, `mcp/server.mjs` transport switch; `config.mcp.http_port` / `http_host`; `express` dependency. **docs/MCP-PHASE-D.md**. D2/D3 (Hub + OAuth) not implemented.
- **Issue #1 Phase G (scope / roots alignment):** `mcp/server-instructions.mjs` — initialize `instructions` with plain language + `file://` URIs for vault and data_dir (multi-vault lines when configured); after `initialized`, optional `roots/list` + structured log when the client supports roots. **docs/MCP-PHASE-G.md**.
- **Issue #1 Phase F1 (sampling — summarize):** `mcp/tools/phase-c.mjs` — when the MCP client advertises `sampling`, `summarize` uses `Server#createMessage` (`sampling/createMessage`); otherwise existing `completeChat` (Ollama/OpenAI). **docs/MCP-PHASE-F.md** (F2–F5 backlog).
- `lib/list-notes.mjs`: Extracted `runListNotes(config, options)` for single backend; CLI and MCP both use it.
- CLI `knowtation mcp`: Starts MCP server; `npm run mcp` runs `node mcp/server.mjs`.
- Tools map to CLI args; outputs match CLI `--json` shapes. Memory and AIR hooks preserved where applicable.
- docs/AGENT-ORCHESTRATION.md: Updated MCP config example (mcp/server.mjs path, `knowtation mcp` option).
- docs/PHASE9-MANUAL-TEST.md: Manual testing guide for MCP server.

---

## Phase 10 — Polish: SKILL, docs, tests, packaging, and sqlite-vec

**Goal:** Production-ready: SKILL.md and docs updated, tests for critical paths, clear install/run instructions, and **sqlite-vec** as second vector store option so SPEC §4.4 / §5 (“Qdrant or sqlite-vec”) has no loose ends.

**Deliverables:**

1. **SKILL.md** — Already documents CLI; add `import` and all retrieval/token flags (`--fields`, `--snippet-chars`, `--count-only`, `--body-only`, `--frontmatter-only`). Document **tiered retrieval pattern**: (1) list-notes or search with small limit + `--fields path` or path+snippet, (2) from paths/snippets pick one or two, (3) get-note only those paths. Ensures agents minimize token use by design. See docs/RETRIEVAL-AND-CLI-REFERENCE.md. Compatibility list and "when to use" include import and write/export.
2. **Agent orchestration guide** — **docs/AGENT-ORCHESTRATION.md**: using Knowtation with agent orchestration systems (e.g. [AgentCeption](https://github.com/cgcardona/agentception)). Option A: MCP (config for Cursor/Claude, tool list). Option B: CLI in agent environment (install, `KNOWTATION_VAULT_PATH`, JSON parsing). Patterns: vault as knowledge backend (search → get-note), write-back (plans/summaries into vault). Optional **bridge script** in `scripts/` that pipes content into `knowtation write` with frontmatter (e.g. phase summary → vault) as a reference for integrators.
3. **Docs** — README: quick start, link to SPEC, IMPORT-SOURCES, IMPLEMENTATION-PLAN, AGENT-ORCHESTRATION. Setup: config, vault, index, capture, import (ChatGPT/Claude, etc.). ARCHITECTURE references SPEC and plan.
4. **Tests** — Unit or integration tests for: config load; vault list/filter; get-note/list-notes; indexer (chunk + metadata); search (mock or real vector store); write; at least one importer (e.g. markdown or chatgpt-export with fixture). Exit codes and JSON output where relevant.
5. **Packaging** — `package.json` scripts: `knowtation`, `index`, optional `transcribe`, `import`. Dependencies pinned. Optional: `npm link` or global install instructions. No secrets in repo; `.gitignore` for `config/local.yaml`, `data/`, `.env`.
6. **sqlite-vec backend** — Implement second vector store backend so users can run without a Qdrant server. Same interface as current Qdrant backend: `ensureCollection(dimension)`, `upsert(points)` with same metadata (path, project, tags, date, text). Config: `vector_store: sqlite-vec`, `data_dir` (or `KNOWTATION_DATA_DIR`); store DB under `data_dir` (e.g. `data/knowtation_vectors.db` or equivalent). Index and search (Phase 3) already use the vector-store abstraction; wire `createVectorStore(config)` to return a sqlite-vec implementation when `vector_store === 'sqlite-vec'`. No duplicate points on re-run (stable chunk id). Document in config example and README when to use Qdrant vs sqlite-vec (e.g. single-machine vs multi-process, scale).
7. **Cleanup** — Remove stub outputs from CLI; ensure all commands implement real behavior or fail with clear errors. COPY-TO-REPO and LICENSE if publishing.

**Implemented (Phase 10 session — docs, packaging, sqlite-vec, tests):** SKILL.md (retrieval levers, tiered retrieval, MCP, when to use); README and setup.md (Phases 1–9, MCP); ARCHITECTURE (MCP import + run); package.json transcribe script; .gitignore verified. **sqlite-vec backend:** lib/vector-store-sqlite.mjs — ensureCollection, upsert, search, count, close(); vec0 TEXT columns use empty string instead of NULL; dimension mismatch detected and throws clear error with recovery instructions; createVectorStore async and delegates to sqlite-vec when vector_store === 'sqlite-vec'; indexer allows sqlite-vec without qdrant_url; config/local.example.yaml and KNOWTATION_VECTOR_STORE env. **Tests:** Node node:test runner; npm test runs test/*.test.mjs. Fixtures: test/fixtures/vault-fs, config, markdown-import. Tests: config load (file + env, missing vault_path); vault (listMarkdownFiles, readNote, parseFrontmatterAndBody, resolveVaultRelativePath, normalizeSlug/Tags); runListNotes (filters, limit/offset, countOnly); chunkNote and stableChunkId; vector-store-sqlite (ensureCollection, upsert, search, count, close, dimension mismatch); writeNote and isInboxPath; importMarkdown (import, dryRun, project/tags, not-found); createVectorStore(sqlite-vec); CLI list-notes/get-note/help exit codes and JSON. **Remaining:** Optional cleanup (stubs, LICENSE, COPY-TO-REPO).

**Acceptance:** New user can clone, copy config, run index, run search, run import on a sample export, and run write/export. Tests pass. SKILL and docs are accurate. With `vector_store: sqlite-vec` and `data_dir` set, index and search work without Qdrant (no loose ends for SPEC’s “Qdrant or sqlite-vec”).

---

## Phase 11 — Shared vault / simplified collaboration (optional)

**Goal:** Make agent-to-agent and agent-to-human interaction **simple without requiring GitHub**. Offer an optional “hub” (hosted or self-hosted) where the vault is shared, proposals exist in a review queue, and users/agents interact via API or simple UI — no branches or PRs required.

**Deliverables:**

1. **Vault + proposals API** — REST (or MCP) endpoints: read vault (list notes, get note, search), write note, **create proposal** (variation: proposed note or diff), **list proposals**, **approve** (apply to vault), **discard**. Same semantics as CLI; proposals stored in sidecar or `.proposals/` (see [MUSE-STYLE-EXTENSION.md](./MUSE-STYLE-EXTENSION.md)). Optional: `baseStateId` for optimistic concurrency. Contract: [HUB-API.md](./HUB-API.md).
2. **Auth: JWT with login** — OAuth 2.0 (e.g. Google, GitHub) as primary login; no password storage. For ICP deployment: Internet Identity. JWT issued after successful login; all Hub API calls use Bearer JWT. Document token lifetime, refresh flow, and scopes (read / write / propose). No API-key-only path; login required. See [HUB-API.md](./HUB-API.md).
3. **Hub service** — Server (or Docker Compose) that: serves the API, stores vault (or syncs from Git), stores proposals, and serves the **Rich Hub UI**. **Deployment options (both in scope from day one):** (a) **Self-hosted (Docker):** Node server, OAuth + JWT, vault/proposals on disk or DB; (b) **Hosted (ICP):** Motoko (or Rust) canister(s) implementing the same API contract, Internet Identity. See "Website and decentralized hosting" below and [HUB-API.md](./HUB-API.md).
4. **Rich Hub UI** — Web UI: search bar (semantic search); category/filter picker (project, tag, folder); task/proposal views (suggested tasks, in progress, problem areas); state and status on every list/detail (draft, proposed, approved, discarded; baseStateId, intention); actions: approve/discard, open note, edit where in scope. Single front-end for self-hosted or ICP Hub. See [HUB-API.md](./HUB-API.md).
5. **Public website (landing)** — The marketing/landing site in **web/** (intent, open source, what's included, pricing, GitHub link) is part of the phased build. Production-ready and deployable so that when you have a domain, the site can go live without backtracking. See "Website and decentralized hosting" below.
6. **CLI integration** — `knowtation hub status` and `knowtation propose --hub <url>`; document local vault only vs vault + hub workflows. See [HUB-API.md](./HUB-API.md).
7. **Docs** — When to use hub vs Git+PRs; how to run self-hosted hub (Docker) and use hosted Hub (ICP); how to get tokens and use the API. Link to MUSE-STYLE-EXTENSION and HUB-API.

**Acceptance:** With the hub running (self-hosted or hosted), a user or agent can log in (OAuth or Internet Identity), create a proposal via API, and another user sees it in the rich UI (search, categories, task views) and approves or discards; canonical vault updates without touching Git. Core Knowtation (Phases 1–10) remains fully usable without the hub. Landing site (web/) is build-complete and deployable.

**Note:** Phase 11 is **optional**. Teams that prefer Git + PRs can skip it. It is for users who want “shared vault + review” without learning GitHub. Monetization: open source core + optional paid hosted hub (this phase).

**Implemented (Phase 11 session):** Hub API (Node): Express, CORS, dotenv from project root; Passport Google + GitHub, JWT issue/verify; routes: health, auth login/callback, notes list/get/write, search, proposals CRUD, approve/discard. Proposals in `data_dir/hub_proposals.json`. Rich Hub UI: `web/hub/` (search, filters, tabs, approve/discard). CLI: `knowtation hub status [--hub <url>]`, `knowtation propose <path> --hub <url>` with `KNOWTATION_HUB_TOKEN`. Dockerfile and hub/README; setup.md step 10; HUB-API.md. ICP: `hub/icp/README.md` placeholder only. Landing (web/) and ICP canisters not built.

**Phase 11 Hub UX (general public):** Per "Audience, UX principles, and general-public checklist" above: How to use link on login screen (before sign-in); OAuth-not-configured message for hosted users; friendly empty states for Notes, Suggested, Activity. Keeps hosted and non-technical users in mind.

---

## Phase 12 — Blockchain, wallets, and agent payments (optional)

**Goal:** Support agent use of **wallets** and **blockchain** (payments, on-chain activity, attestation) without backtracking. Agents are increasingly wallet-enabled; notes may reference transactions, networks, and payment status. This phase reserves schema and adds optional interfaces so we don't redesign later.

**Scope (reserved now; implement when needed):** See **docs/BLOCKCHAIN-AND-AGENT-PAYMENTS.md**.

**Deliverables (Phase 12 or follow-on):**

1. **Optional frontmatter** — `network` / `chain_id`, `wallet_address`, `tx_hash`, `payment_status` (and optional AIR-on-chain id). Indexer stores in chunk metadata; search and list-notes can filter. No collision with existing `--chain` (causal_chain_id); use `--network` and `--wallet` for blockchain.
2. **CLI filters** — `--network <id>`, `--wallet <address>` for search and list-notes when notes carry the reserved frontmatter.
3. **Tags / categories** — Optional reserved or suggested tags for payment/blockchain notes (e.g. `payment`, `on-chain`); no change to core tag semantics.
4. **Capture** — Same message-interface contract (Phase 5): plugins can write notes from on-chain events (webhooks, indexers) with the reserved frontmatter. Optional import source for wallet/transaction history.
5. **AIR and attestation** — Optional backend where attestation is recorded on-chain (e.g. ICP signing); AIR interface unchanged.

**Acceptance:** When implemented: notes can carry network/wallet/tx frontmatter; `knowtation search` and `list-notes` support `--network` and `--wallet`; capture can ingest on-chain events into inbox. Core and Hub remain fully usable without Phase 12.

**Depends on:** 1–4 (and 3.1 for filter consistency). Can follow Phase 10 or 11. No backtracking to earlier phases.

---

## Phase 13 — Teams and collaboration (optional, post–Phase 11)

**Goal:** Add **roles** (viewer / editor / admin) and optionally an **invite flow** so the Hub supports a "team vault" without giving everyone full access. No backtracking: token shape and reserved data/config are prepared in advance (see "Preparation" below).

**Implemented (Phase 13 — roles):** Role store `hub/roles.mjs` (reads `data/hub_roles.json`). JWT role from store at login; default `member` (treated as editor) when not in file; when no roles file (or empty file), everyone receives JWT role admin so the Team tab is visible and no manual setup is needed; once the file has entries, only listed users get that role. Middleware `requireRole()`; GET notes/search/proposals/settings/setup require viewer; POST notes, proposals, index, vault/sync require editor; POST setup, approve, discard require admin. Hub UI: Settings shows "Your role"; **Back up now** disabled for non-admins; **Save setup** always enabled—non-admins get clear error message and toast on click; admins get success toast and inline "Saved. Config applied." Approve/Discard only for admins; + New note hidden for viewers. See hub/README.md (Roles) and TEAMS-AND-COLLABORATION.md. **Invite flow:** Done (create link, invitee signs in, added to role; pending list, revoke). **Not yet:** GitHub-backed access.

**Deliverables (remaining for Phase 13):**

1. **Roles** — ✅ Done. Viewer / editor / admin via `data/hub_roles.json`; JWT and middleware enforce; **Settings → Team** (admin only) lets admins assign roles from the UI; no file editing required. Backup repo is **not** a prerequisite for roles.
2. **Invite flow (next priority)** — **Not user-friendly yet:** today admins must get the User ID from each person (they copy it from Settings) and add it in Team or in the file. An **invite flow** would let an admin enter an **email** (or send a link); the invitee signs in with OAuth and is added to the roles store with the chosen role. **Complexity:** medium (pending-invites store, invite token, one-time link or email step, UI "Invite teammate"). **Planned for Phase 13 (invite)** so we do not leave role assignment as file-only or "paste User ID" only. See checklist and TEAMS-AND-COLLABORATION.
3. **Optional GitHub-backed access** — Sync with GitHub repo collaborators for allowed users or role list; larger design, Phase 13.1 or later.
4. **Multi-vault / scoped access** — Not implemented. Today one Hub = one vault; invitees see the entire vault. To separate personal vs shared, run multiple Hub instances (different vault paths). Per-user or per-role visibility (e.g. “only project X”) would require new design. See [MULTI-VAULT-AND-SCOPED-ACCESS.md](./MULTI-VAULT-AND-SCOPED-ACCESS.md).

**Preparation (do now to avoid backtracking):**

- **JWT payload:** Hub already issues JWT with `sub`, `name`. Add optional **`role`** claim (e.g. `member` by default). All tokens then have a role; Phase 13 only changes how we set it (from config or `data/hub_roles.json`). No token-shape change later.
- **Reserved role store:** Document that Phase 13 will use a **role store**: e.g. `data/hub_roles.json` (or config key `hub.roles_file`) mapping `sub` (or email) → role. No file or key required until Phase 13; Hub continues to treat "no role store" as "everyone is member" and allows current behavior.

**Acceptance (Phase 13 when implemented):** Admin can restrict Setup and approve/discard to admins; viewers can only read. Optional invite flow allows adding users with a role. See [TEAMS-AND-COLLABORATION.md](./TEAMS-AND-COLLABORATION.md).

**Depends on:** Phase 11. Optional. Order: roles first, then invite, then optional GitHub-backed.

---

## Phase 14 — Two-path launch (go live, hosting beta)

**Goal:** Ship the split explicitly so users can "use in the cloud (beta)" or "run it yourself." Hosting is free during beta.

**Deliverables:**

1. **Landing / Hub copy** — Two clear CTAs or sections: (1) Use in the cloud (beta) → knowtation.store/hub/, (2) Run it yourself → Quick start (self-hosted) link.
2. **Quick start (self-hosted)** — One short doc or section (e.g. in [TWO-PATHS-HOSTED-AND-SELF-HOSTED.md](./TWO-PATHS-HOSTED-AND-SELF-HOSTED.md) or [GETTING-STARTED.md](./GETTING-STARTED.md)): clone, set `KNOWTATION_VAULT_PATH` and `HUB_JWT_SECRET`, `npm run hub`, open localhost. Optional: OAuth and hub/README link.
3. **Beta disclaimer** — On landing or Hub: hosted is beta; free to use; usage-based billing (credits) will be added later.
4. **Build status / "What we're doing next"** — Update top of IMPLEMENTATION-PLAN and STATUS-HOSTED-AND-PLANS to say "Two-path launch done; hosting = beta, free."

**Acceptance:** A new user can choose "cloud (beta)" or "self-host" from the site and follow the chosen path. No second codebase.

**Depends on:** Phases 11 and hosted deploy (canister, gateway, 4Everland) already done or in progress. Can be done in one session.

---

## Phase 15 — Multi-vault (optional)

**Goal:** Support multiple vaults per Hub (or scoped visibility) so users can separate e.g. personal vs shared. Design: [MULTI-VAULT-AND-SCOPED-ACCESS.md](./MULTI-VAULT-AND-SCOPED-ACCESS.md).

**Deliverables:**

1. **Direction** — Choose one: (a) multiple vaults per instance (vault list in config/setup, user→vault or role→vault mapping), or (b) one vault with scoped visibility (project/folder allowlists per user/role). Document in IMPLEMENTATION-PLAN and optionally in MULTI-VAULT doc.
2. **Backend** — Config/setup: vault list or scope rules. API and canister: scope list/search/get-note by vault or scope. Gateway and canister honor `vault_id` / scope (extend beyond current default).
3. **Hub UI** — Vault switcher or scope hint (e.g. "This view: vault X" or filter by allowed scope). Settings or Team: assign vault(s) or scope to users/roles if applicable.
4. **CLI / MCP (optional)** — `--vault <id>` or equivalent so agents and CLI can target a vault explicitly.

**Acceptance:** One Hub instance can serve multiple vaults (or one vault with scoped visibility); users only see notes they're allowed to see. Self-hosted and hosted both supported per design.

**Depends on:** Phase 11 (Hub). Can follow Phase 14. Implement in a separate session (or several) when you prioritize multi-vault.

**Status (self-hosted implemented):** Option A (multiple vaults per instance) + Option B (scoped visibility) are implemented. Data: `data/hub_vaults.yaml`, `hub_vault_access.json`, `hub_scope.json`. Config: `vaultList`, `resolveVaultPath`; single-vault default when file absent. Hub server: vault resolution, access check, scope filter; admin routes GET/POST `/api/v1/vaults`, `vault-access`, `scope`; settings returns `vault_list` and `allowed_vault_ids`. UI: vault switcher, Settings → Vaults (admin). Bridge (hosted): vector dirs keyed by (uid, vault_id); gateway forwards X-Vault-Id. **Hosted canister:** Still **one note map per user**; `X-Vault-Id` is **not** applied in Motoko — see [MULTI-VAULT-AND-SCOPED-ACCESS.md](./MULTI-VAULT-AND-SCOPED-ACCESS.md) § Hosted. **Follow-up:** partition canister storage, migrate existing data to `default`, align proposals/backup; then add **automated tests** for hosted multi-vault paths.

**Regression safety (local):** Prefer fixing broken `npm test` cases and adding **hub/server** tests for vault resolution + `X-Vault-Id` (fixtures under `test/`) so self-hosted multi-vault does not regress while canister work proceeds.

---

## Phase 16 — Hosted credits / usage-based (optional)

**Goal:** **Usage-based** billing on hosted: charge mainly for **high-cost** operations (embeddings/index, search, writes, sync). Users hold a **prepaid platform balance**: **1 displayed credit = US $1**; internal ledger in **integer cents**. Credits are **redeemed only** on Knowtation hosted and are **not transferable** off-platform in this design. **Beta** stays **free** while **shadow metering** (logs/metrics) informs pricing; then enable **deductions** and **Stripe** purchase. Optional **grandfather** early users per [HOSTED-CREDITS-DESIGN.md](./HOSTED-CREDITS-DESIGN.md).

**Design docs (authoritative for product shape):**

- [HOSTED-STORAGE-BILLING-ROADMAP.md](./HOSTED-STORAGE-BILLING-ROADMAP.md) — V1 stable storage includes **`balanceCents` per user** (or explicit alternative) alongside **multi-vault** migration.
- [HOSTED-CREDITS-DESIGN.md](./HOSTED-CREDITS-DESIGN.md) — Meter table, Stripe webhook idempotency, optional USDC/AVAX top-up, Resend low-balance email, Hub UI, `INSUFFICIENT_CREDITS`.

**Deliverables (implementation):**

1. **Balance** — Per `user_id` (JWT `sub`); **Nat cents** in canister (recommended) or gateway/bridge store per roadmap doc.
2. **Shadow metering (beta)** — Structured logs on gateway/bridge: user, route, cost-relevant dimensions; **no deduction** until pricing fixed.
3. **Purchase** — **Stripe** Checkout/Payment Links; webhook credits balance **idempotently**; optional crypto rail credits same ledger.
4. **Deduction** — Middleware at choke points (note write, bridge index/search, sync); response with reserved error code when balance insufficient.
5. **Hub UI** — Balance, low-balance banner, link to buy credits; optional **Resend** emails (debounced).

**Acceptance:** Hosted users see balance; paid mode reduces it on priced operations; they can top up via Stripe; beta cohort can be grandfathered per policy. Self-hosted unchanged.

**Depends on:** Phase 11, 14; **Phase 15.1 storage migration** should reserve balance field per roadmap. Order: **roadmap doc approved → V1 migration (15.1 + balance slot) → shadow metering → implement Phase 16 enforcement + Stripe.**

---

## Summary: phase order and dependencies

| Phase | Depends on | Delivers |
|-------|------------|----------|
| 1 | — | Config, vault read, get-note, list-notes, errors |
| 2 | 1 | Indexer (chunk, embed, vector store) |
| 3 | 2 | Search with filters, JSON, exit codes |
| **3.1** | **3** | **Time/causal filters: --since, --until, --order, --chain, --entity, --episode (search + list-notes)** |
| 4 | 1 | Write, export, provenance, AIR hook |
| 5 | 1 | One capture plugin, contract doc, optional webhook |
| 6 | 1, 4 | Import (all source types) |
| 7 | 1 | Transcription; import audio/video |
| 8 | 1, 4 | Memory + AIR integration |
| 9 | 1–4, 6 | MCP server |
| 10 | 1–9 | Docs, SKILL, tests, packaging, **sqlite-vec** backend |
| 11 | 1–4, 9 | Shared vault / hub (API, proposals, review queue, optional UI); public landing site (web/); hosted or ICP (Motoko) deployment; agent-to-agent and agent-to-human without GitHub |
| **12** | **1–4, 9** | **Blockchain, wallets, agent payments (optional): frontmatter, --network/--wallet filters, capture for on-chain events, optional AIR-on-chain. See docs/BLOCKCHAIN-AND-AGENT-PAYMENTS.md.** |
| **13** | **11** | **Teams and collaboration (optional): roles (viewer/editor/admin), optional invite, optional GitHub-backed access. See Phase 13 and TEAMS-AND-COLLABORATION.md. Preparation: JWT `role` stub, reserved role store.** |
| **14** | **11** | **Two-path launch: landing/Hub CTAs (Use in cloud beta / Run it yourself), Quick start (self-hosted), beta disclaimer. Hosting = beta, free until Phase 16.** |
| **15** | **11** | **Multi-vault (optional): multiple vaults per Hub or scoped visibility. Design in MULTI-VAULT-AND-SCOPED-ACCESS.md; backend + UI vault/scope.** |
| **16** | **11, 14, 15.1 storage** | **Hosted usage credits: USD-pegged cents ledger, Stripe (+ optional crypto top-up), shadow metering in beta, deductions on index/search/write/sync. See HOSTED-CREDITS-DESIGN.md + HOSTED-STORAGE-BILLING-ROADMAP.md.** |

**Intention and temporal:** Optional frontmatter and filters (`--since`, `--until`, `--chain`, `--entity`, `--episode`, `--order`) are specified in **docs/INTENTION-AND-TEMPORAL.md** and SPEC §2.3. Implement time-bounded filters in **Phase 3.1 or Phase 4** (search and list-notes); indexer already stores `date` in metadata. Causal/entity/episode and evals remain in an optional later phase so we don’t backtrack.

**Estimated order of implementation:** 1 → 2 → 3 → **3.1** (core loop + temporal filters); then 4 (write/export); then 5 (capture); 6 and 7 in parallel after 4; 8 after 4; 9 after core CLI is stable; 10 last; 11 optional after 10; **12 optional** (blockchain/wallets/agent payments when needed); **13 optional** (teams: roles, invite, after 11). Total scope: core in 1–10; simplified shared collaboration in 11; teams in 13; blockchain and agent payments in 12. Monetization: open source core + optional paid hosted hub (Phase 11). Internal planning may live in `development/` (gitignored) when used.

**Commit after each phase.** Each phase is a shippable increment; commit when its acceptance criteria are met so history stays clear and you can revert or branch by phase.

**When to use a separate session** — Use a new session when a phase is large or crosses many files, so context stays manageable and you don’t lose focus:

| Phase | Suggested session | Why |
|-------|-------------------|-----|
| **1** | Single session | Foundation only; already done in one pass. |
| **2** | **New session** | Indexer: chunking, embedding, vector store (Qdrant/sqlite-vec). Multiple backends and config; good to start fresh with full context. |
| **3** | Same as 2, or new | Search builds on 2. Can do 2+3 in one “core loop” session, or 3 alone if 2 was done earlier. |
| **3.1** | Same or new | Time/causal filters for search and list-notes. Small; can follow 3 in same or next session. |
| **4** | Single or new | Write + export + provenance + AIR hooks. Medium; new session if 2+3 was long. |
| **5** | Single | One capture plugin + contract doc; focused. |
| **6** | **New session** | Many importers (markdown, chatgpt, claude, mem0, audio, video, mif, …). Big; split 6a (first 2–3) and 6b (rest) if needed. |
| **7** | **New session** | Transcription pipeline (Whisper/Deepgram, etc.); external deps and config. |
| **8** | **New session** | Memory + AIR; integration with external services. |
| **9** | **New session** | MCP server; different surface (protocol, tools). |
| **10** | **New session** | Polish: SKILL, docs, tests, packaging, **sqlite-vec** backend; broad. |
| **11** | **New session(s)** | Hub, landing, hosting; can split “Hub API + UI” and “deploy + 4Everland/ICP” if useful. |
| **12** | **New session** | Blockchain, wallets, agent payments; optional; see BLOCKCHAIN-AND-AGENT-PAYMENTS.md. |
| **13** | **New session** | Teams and collaboration (roles, invite); optional; after Phase 11; see TEAMS-AND-COLLABORATION.md. |
| **14** | **Single session** | Two-path launch: copy, Quick start, beta disclaimer; can be same session as plan update. |
| **15** | **New session** | Multi-vault; use MULTI-VAULT-AND-SCOPED-ACCESS.md; one or more sessions. |
| **16** | **New session** | Hosted credits; after beta; separate session(s) when adding billing. |

Rule of thumb: start a **new session** at the start of Phase 2, 6, 7, 8, 9, 10, 11, and 12 (and optionally after 3 or 4). Commit at the end of every phase.

**Update this plan at the end of each session.** Before committing (or when you commit the next phase), update IMPLEMENTATION-PLAN.md to reflect the session: e.g. mark the phase(s) completed, add a short “Last session” or “Status” line (what was done, what’s next), or bump a “Current phase” pointer. That keeps the plan the single place to see where the build stands. Commit those plan updates together with the phase commit (e.g. Phase 2 commit can include both the Phase 2 code and the updated plan from the end of session 1).

---

## Phase 1–2 review (oversights and fixes)

- **Phase 1 (foundation):** No blocking oversights. get-note and list-notes match SPEC §4.1–4.2 (exit codes, JSON shape, --fields, --count-only). Path validation (prevent `../` escape) is called out in "Other considerations / Before first release" and should be implemented before first release (e.g. in Phase 4 for write, or Phase 10 polish).
- **Phase 2 (indexer):** Chunk metadata includes path, project, tags, date. Qdrant payload matches; search filters (project, tag) use same field names. sqlite-vec remains Phase 10.
- **Phase 3 scope:** Core search delivered; time/causal filters assigned to **Phase 3.1** (next). Phase 3 stays shippable without scope creep.

---

## What we're not forgetting

- **Any audio:** Smart glasses, wearables, past blogs/videos → Phase 7 + message-interface for real-time (Phase 5).
- **Any knowledge base / LLM export:** ChatGPT, Claude, Mem0, NotebookLM, Google Drive, MIF, generic Markdown → Phase 6.
- **Multi-project, tags, filters:** Phase 1 (list-notes), Phase 2 (indexer metadata), Phase 3 (search filters).
- **Vector store options:** SPEC §4.4 and §5 allow Qdrant or sqlite-vec. **Qdrant** implemented in Phase 2; **sqlite-vec** (no separate server; uses `data_dir`) is a Phase 10 deliverable so the “or sqlite-vec” is not a loose end.
- **Retrieval and token cost:** All retrieval levers are in scope: `--fields`, `--snippet-chars`, `--count-only` (search, list-notes), `--body-only`/`--frontmatter-only` (get-note). Tiered retrieval (narrow → cheap first → get-note only for chosen paths) documented in SKILL and [RETRIEVAL-AND-CLI-REFERENCE.md](./RETRIEVAL-AND-CLI-REFERENCE.md).
- **Agents and business use:** Phases 1–4 and 9 (CLI + MCP); write, export, provenance, AIR (Phase 4, 8). Content creation (blogs, podcasts, videos, marketing, analysis) uses search + get-note + write + export.
- **Agent orchestration (e.g. AgentCeption):** Knowtation is a first-class **knowledge backend** for multi-agent orchestration. Orchestrators and their agents use **both** CLI and MCP: MCP when the runtime speaks MCP (Cursor, Claude); CLI when agents run in containers/worktrees (e.g. engineer agents). Vault = org brain (read for context, write-back plans/summaries). See **docs/AGENT-ORCHESTRATION.md**.
- **Extensibility:** Phase 5 proves the capture contract; Phase 6 proves import; both documented so others can add plugins and new import types.
- **Simple agent-to-agent and agent-to-human:** Phase 11 (shared vault / hub) — API, proposals, review queue, optional UI — so people who are unfamiliar with or adverse to GitHub can still share a vault and review proposals. Optional; core remains usable without it. See [MUSE-STYLE-EXTENSION.md](./MUSE-STYLE-EXTENSION.md).
- **Website and hosted option:** Public landing site (web/) and the hosted Hub offering are part of the plan so we don't backtrack. Landing is deployable (e.g. 4Everland); Hub can be self-hosted or deployed on ICP (Motoko canisters). See below.
- **bornfree-hub reference:** Existing platform ([bornfree-hub](https://github.com/aaronrene/bornfree-hub)) uses five canisters (Signing, Documents, Identity, Assets, Encryption) with Netlify + 4Everland. Reuse those patterns when implementing the Knowtation Hub on ICP (Phase 11) to avoid redoing work.
- **Blockchain, wallets, and agent payments:** Agents increasingly have wallet access and use blockchain for payments and on-chain activity. **Phase 12** (optional) reserves optional frontmatter (`network`, `wallet_address`, `tx_hash`, `payment_status`), CLI filters (`--network`, `--wallet`), capture for on-chain events, and optional AIR-on-chain. No collision with existing `--chain` (causal chain). See **docs/BLOCKCHAIN-AND-AGENT-PAYMENTS.md**. Implement when needed; no backtracking to earlier phases.
- **Teams and collaboration:** **Phase 13** (optional, after Phase 11) adds roles (viewer / editor / admin) and optional invite so we don't backtrack. Preparation stubs: JWT includes optional `role` claim (default `member`); reserved `data/hub_roles.json` or config for future role store. See **Phase 13** above and **docs/TEAMS-AND-COLLABORATION.md**.
- **Two-path launch (Phase 14):** Go live with hosted (beta) + self-hosted; clear CTAs and Quick start (self-hosted). Hosting = beta, free until **Phase 16 (credits)**. Multi-vault = **Phase 15**; design in [MULTI-VAULT-AND-SCOPED-ACCESS.md](./MULTI-VAULT-AND-SCOPED-ACCESS.md).
- **Hosted parity:** Before deploy, bring hosted API to parity with self-hosted so Settings → Team and Setup work. Gateway stubs for roles, invites, POST setup (canister does not implement them). See [PARITY-PLAN.md](./PARITY-PLAN.md) for phased checklist (parity → deploy → multi-vault).

---

## Website and decentralized hosting (4Everland / ICP)

**Landing site (web/)** — The marketing site is in the repo and part of the build. You can host it on **[4Everland](https://www.4everland.org/hosting/)** (decentralized) in several ways:

- **4Everland → IPFS or Arweave:** Deploy the static `web/` build; 4Everland gives you a URL and supports [custom domains](https://docs.4everland.org/hositng/guides/domain-management). No canister required.
- **4Everland → Internet Computer (ICP):** 4Everland’s [IC Hosting](https://docs.4everland.org/hositng/what-is-hosting/internet-computer-hosting) creates a **front-end canister** for your site automatically (connect repo, build, deploy). Custom domain and SSL supported. So: **you do not need to create a canister yourself for the landing page** — 4Everland creates and manages it.

**Hosted Hub (API + service)** — The Hub is a dynamic service (API, vault/proposal storage, auth). For **decentralized** hosting you have two parts:

1. **Hub API + storage** — This needs a **backend canister** (or canisters) on ICP. 4Everland’s IC Hosting is aimed at front-end/static sites; it does not run your Node/Python server. So for the Hub on ICP you **do need canister(s)** you build and deploy (e.g. with `dfx`). **Motoko is practical here:** you already use it; canisters can expose HTTP, store vault metadata and proposals, and call out to your indexer/search if needed (or replicate minimal logic in-canister). Design the Hub API so it can be implemented as (a) a traditional server (Phase 11 self-hosted) or (b) a Motoko canister backend for ICP.
2. **Hub web UI** — The minimal UI (view vault, search, review queue) can be a static front-end. That can be deployed via **4Everland to ICP** (they create the front-end canister) or served from the same backend when self-hosted. The UI then calls your Hub API (self-hosted URL or canister URL on ICP).

**Summary**

| What | 4Everland? | Canister needed? |
|------|------------|------------------|
| **Landing site** | Yes — deploy `web/` to 4Everland (IPFS, Arweave, or IC). On IC, 4Everland creates the canister for you. | No (4Everland creates it on IC). |
| **Hub API / service** | 4Everland does not run your backend. | **Yes** — build Hub API + storage as Motoko (or Rust) canister(s); deploy with dfx. |
| **Hub web UI** | Yes — deploy the Hub UI as a static site to 4Everland (IC canister) if you want; it talks to your API canister. | Optional (4Everland can create the UI canister on IC). |

**Domain:** Get your domain and attach it in 4Everland’s [domain management](https://docs.4everland.org/hositng/guides/domain-management) for the landing (and optionally the Hub UI). For the API canister, you’d use the canister URL (e.g. `https://<canister-id>.ic0.app`) or route via your domain if you set up a gateway.

**Practical path:** (1) Build landing (web/) and Hub as in Phase 11. (2) Deploy landing to 4Everland (IC or IPFS) and point your domain at it. (3) For hosted Hub: either self-host (Docker) first, or implement a Motoko canister backend for the Hub API and deploy to ICP; then deploy the Hub UI (e.g. via 4Everland to IC) so it calls that canister. No backtracking — the plan explicitly includes the website and the hosting option, with a decentralized path (4Everland + ICP canisters) documented.

**Reference: bornfree-hub (existing canister + Netlify + 4Everland platform)** — When we cross the bridge to Hub-on-ICP, reuse patterns from the existing **[bornfree-hub](https://github.com/aaronrene/bornfree-hub)** platform so we don’t redo work. That repo uses five canisters (Signing, Documents, Identity, Assets, Encryption) and deploys with **Netlify** and **4Everland**. Same deployment and canister-architecture patterns may apply to the Knowtation Hub (e.g. Identity for auth, Documents/Assets for vault and proposals, Signing/Encryption if we need attestation or encrypted storage). Note this here; detailed alignment when we reach Phase 11 Hub implementation.

---

## Other considerations / Before first release

- **Security:** Core CLI has no auth (local vault). Validate vault-relative paths for get-note/write so paths cannot escape the vault (e.g. `../` outside root). Hub (Phase 11): simple auth; document running behind reverse proxy for production.
- **Observability:** Optional logging and metrics (e.g. search latency, result count) for self-hosted or hub; can be an extension point or Phase 11. No telemetry in core without opt-in.
- **Evals:** SPEC §12 and INTENTION-AND-TEMPORAL reserve `knowtation eval` and eval set format. After core retrieval is stable, an optional Evals phase (golden set, accuracy/grounding) can be added; not blocking for first release.
- **Open source hygiene:** LICENSE (e.g. MIT), CONTRIBUTING (how to run tests, PR expectations), optional code-of-conduct and issue/PR templates. Phase 10 mentions COPY-TO-REPO and LICENSE; ensure no secrets or credentials in repo (user rule).
- **Performance:** Index size and search latency depend on vault size and vector store. Document when to re-index (after bulk import, after model change); optional "Operational notes" in docs if needed.

**Future / out of scope (note here; implement in a later phase or when needed):**

- **Rate limiting:** Gateway and Hub API do not yet enforce rate limits. Add in a later phase (e.g. per-IP or per-user) for production hardening.
- **API keys for server-to-server:** JWT from OAuth only today. Optional "Developer" or "API access" in Settings to issue long-lived API keys for scripts/agents; document in HUB-API when added.
- **Muse Option A (Muse as backend):** Out of scope for current plan. Implement only when there is a concrete need (e.g. partner using Muse, or shared DAG with other Muse agents). See [MUSE-STYLE-EXTENSION.md](./MUSE-STYLE-EXTENSION.md) §6.2.
- **Canister proposal migration:** If the canister was deployed before Option B with existing proposals, upgrade to the new ProposalRecord (base_state_id, external_ref) may require migration or re-deploy; document in deploy notes when we have a procedure.
- **Phase 2 exact state and checklist:** [EXACT-STATE-PHASE2.md](./EXACT-STATE-PHASE2.md) records verified live state (canister, gateway, 4Everland), Phase 2 completion checklist (bridge, pre-roll, env), and items not in scope for Phase 2 (multi-vault, MCP supercharge, suggested prompts, import-on-hosted, full roles/invites on hosted). Use it so we do not forget what is left.

You can implement phases in sequence (1 → 2 → … → 11) or parallelize 5, 6, 7 after 4. Phases 11 and 12 are optional. This plan ensures the full product is built with no scope left unspecified; Phase 12 reserves blockchain/wallets/agent payments so we don’t backtrack when agents adopt wallets and on-chain activity.
