# Knowtation — Full Implementation Plan

This document lays out **all phases** to build Knowtation end-to-end. Nothing is left "for later" as unspecified work: every feature in the [SPEC](./SPEC.md), [ARCHITECTURE](../ARCHITECTURE.md), and [IMPORT-SOURCES](./IMPORT-SOURCES.md) is assigned to a phase and will be implemented. Phases are ordered by dependency; each phase produces testable, shippable increments.

**Reference:** [SPEC.md](./SPEC.md) (data formats, CLI, config), [IMPORT-SOURCES.md](./IMPORT-SOURCES.md) (import source types and formats), [ARCHITECTURE.md](../ARCHITECTURE.md) (high-level design).

**Monetization:** Core is open source. Optional paid layer: hosted “Knowtation Hub” (Phase 11) for users who do not want to self-host; they get shared vault, proposals, and review without running servers. See Phase 11.

**Strategic sequencing (hosted product — 2026-03):** **Hosted import** (`POST /api/v1/import` → bridge → canister) is **live and verified** on production; **Stripe checkout, subscription UX, and billing enforcement** are the **next commercial gate** (import was the prerequisite). Indexing-token **telemetry** and **`billing/summary`** may already be on `main`; **hard quotas and Customer Portal** follow product priority. See [HOSTED-IMPORT-DESIGN.md](./HOSTED-IMPORT-DESIGN.md), [HOSTED-CREDITS-DESIGN.md](./HOSTED-CREDITS-DESIGN.md), [PARITY-PLAN.md](./PARITY-PLAN.md).

**Build status (update at end of each session):** Phases 1–10 complete. Phase 11 (Hub) implemented; Phase 11 Hub UX done (How to use on login, tagline, OAuth note, empty states). **Phase 11.1 Hub first screen** done: login panel has hero (title, tagline, intent), primary CTA (sign in above), secondary (How to use); `login-screen` class on app when shown. **Phase 13 (Teams — roles)** implemented: role store (`data/hub_roles.json`), JWT role from store, requireRole middleware; viewer/editor/admin restrict Setup, approve/discard, write, propose; Hub UI shows role in Settings; **Back up now** disabled for non-admins; **Save setup** always clickable—shows clear error + toast for non-admins, success toast + inline message for admins. **Backup (Git):** How to use and Settings document creating backup repo (empty, HTTPS), vault `git init`, Connect GitHub, Back up now; loadingHtml TDZ fix. **Phase 13 invite** implemented: create invite link (Settings → Team), invitee signs in via link and is added to role; pending list and revoke. **Landing (web/)** refreshed and enhanced (ecosystem, token savings, dual CTA, #hosted, knowtation.store). **Guided Setup in Hub** and **Help in Settings** done. **Hosted (canister) product — code complete:** Phase 0 (vault_id, canister auth doc, Hub API URL config); Phase 1 canister (`hub/icp/` Motoko: vault, proposals, export); Phase 2 gateway (`hub/gateway/`: OAuth, proxy to canister with X-User-Id); Phase 3 bridge (`hub/bridge/`: Connect GitHub, Back up now); Phase 4 bridge (index + search); Phase 5 docs (DEPLOY-HOSTED, CANISTER-AND-SINGLE-URL, single URL knowtation.store). **Production (hosted):** knowtation.store + Hub + Netlify gateway + ICP canister are **live**; bridge when **`BRIDGE_URL`** is set — see [STATUS-HOSTED-AND-PLANS.md](./STATUS-HOSTED-AND-PLANS.md). Ongoing: redeploy when code changes; **Phase 15.1** multi-vault partition is **implemented in repo** ([hub/icp/](hub/icp/) Motoko + gateway + bridge); **production** must be **redeployed + smoke-tested** ([DEPLOY-HOSTED.md](./DEPLOY-HOSTED.md) §5.1) before relying on per-vault isolation on ICP. **Phase 14 (Two-path launch):** Landing and Hub offer "Use in the cloud (beta)" and "Run it yourself" (Quick start in TWO-PATHS-HOSTED-AND-SELF-HOSTED.md); beta disclaimer on landing and Hub. Hosting = beta, permissive usage for research until Phase 16 (subscriptions). **Hosted parity (Phase 1):** Done. Gateway stubs for roles, invites, POST setup, import, and facets are in `hub/gateway/server.mjs`; Hub UI no longer 404s on hosted for Settings → Team, Setup, or filter dropdowns. See **[PARITY-PLAN.md](./PARITY-PLAN.md)**. Phase 2 = deploy operations only (dfx, Netlify, 4Everland, DNS); no in-repo code. **Multi-vault:** **Self-hosted Phase 15 implemented** (`hub_vaults.yaml`, access, scope, `X-Vault-Id`). **Hosted Phase 15.1:** notes/proposals/export partitioned by **`(userId, vault_id)`** in repo; checklist and status in [MULTI-VAULT-AND-SCOPED-ACCESS.md](./MULTI-VAULT-AND-SCOPED-ACCESS.md) § Hosted; **live canister** must match git after deploy. **Merged to `main` (2026-04-03):** PR **#96** — **AIR Improvements A+B+C:** (A) `writeNote` is now async and stores the returned `air_id` in note frontmatter; duplicate `attestBeforeWrite` calls removed from CLI and MCP. (B) Hosted gateway (`hub/gateway/server.mjs`) calls `attestBeforeWrite` for `POST /api/v1/notes` and `PUT /api/v1/notes/:path` when `KNOWTATION_AIR_ENDPOINT` is set; `air_id` injected via `mergeHostedNoteBodyForCanister`. (C) New `air.required` config flag and `AttestationRequiredError` class — when `true`, a failed endpoint throws instead of returning a placeholder. Default non-blocking behavior preserved. **Merged to `main` (2026-04-03):** PR **#97** — **AIR Improvement D** (built-in attestation endpoint): `POST /api/v1/attest` with HMAC-SHA256 signed records in Netlify Blobs, `GET /api/v1/attest/:id` verification; gateway auto-configures `KNOWTATION_AIR_ENDPOINT` when `ATTESTATION_SECRET` is set. PR **#99** — **AIR Improvement E** (ICP blockchain anchor): Motoko attestation canister `dejku-syaaa-aaaaa-qgy3q-cai` (immutable append-only ledger); dual-write from gateway (Blob + ICP); `GET /api/v1/attest/:id/verify` cross-source consensus; `POST /api/v1/attest/anchor-pending` admin reconciliation; `@icp-sdk/core` client; 26 new tests. See [AIR-IMPROVEMENTS-PLAN.md](./AIR-IMPROVEMENTS-PLAN.md), [DEPLOY-HOSTED.md](./DEPLOY-HOSTED.md) §5.2. **Memory consolidation (Sessions 1–10)** merged to `main` (PR #103 daemon stack + PR #104 Hub UI, 2026-04-05): pointer index, skeptical memory, consolidation engine, daemon lifecycle, verification + discovery passes, multi-provider LLM, cost guardrails, bridge endpoint, Netlify scheduler, MCP consolidation tools, Hub Settings tab, Dashboard card, Billing row, How-to-Use section, MEMORY-CONSOLIDATION-GUIDE.md. 1,077 tests passing. **MCP Issue #1 all phases A–H complete** (Phase C + D1–D3 + F1–F5 + all memory tools). **Next:** Issue #2 (AgentCeption) — deferred until hosted production is stable. Ops: verify consolidation card in Hub UI + Netlify scheduler env var.

**Merged to `main` (2026-03-30):** PR **#79** — **Keyword vault search:** `POST /api/v1/search` accepts **`mode: "keyword"`** (substring / `all_terms` matching over path, body, and key frontmatter) alongside default semantic search; **self-hosted** Node Hub uses `lib/keyword-search.mjs`; **hosted bridge** uses canister export (no embeddings) for keyword; **gateway** forwards the full JSON body to the bridge. **Hub UI:** **Meaning** vs **Keyword** dropdown, two-row search layout (filters on row 1; **Since** / **Until** + actions on row 2). **CLI:** `--keyword`, `--match phrase|all-terms`, `--content-scope`. **MCP:** `search` tool **`mode`** / **`match`** / **`content_scope`**. Docs: [HUB-API.md](./HUB-API.md), [openapi.yaml](./openapi.yaml), [AGENT-INTEGRATION.md](./AGENT-INTEGRATION.md). **Ops:** redeploy **bridge**, **gateway**, and **static Hub** for hosted keyword parity.

**Merged to `main` (2026-03):** PR **#46** — hosted multi-vault parity (Motoko partition, gateway/bridge, docs, smoke script); PR **#47** — Hub **Settings → Vaults → Create vault** on hosted (bootstrap note with **`X-Vault-Id`**); PR **#48** — **busy state** on slow Hub actions (save, sync, reindex, import submit, vault/team/invite/setup, detail note Save) so the UI shows progress. PR **#63** — **Hub bulk housekeeping (self-hosted Node):** `POST /notes/delete-by-project`, `POST /notes/rename-project`, proposal discard by path; Settings → Backup presets for path prefix and project slugs; **New note** folder picker; `GET /vault/folders` on Node + gateway stub for hosted; path-vs-project documentation ([HUB-METADATA-BULK-OPS.md](./HUB-METADATA-BULK-OPS.md), [VAULT-RENAME-SPEC.md](./VAULT-RENAME-SPEC.md)). **Hosted metadata bulk:** `POST /notes/delete-by-project` and `POST /notes/rename-project` are implemented on the **gateway** ([`hub/gateway/metadata-bulk-canister.mjs`](hub/gateway/metadata-bulk-canister.mjs)); Hub shows the same Settings controls for canister vaults. **PR #65** — Hub **no longer blocks** those actions in the browser on hosted (`web/hub/hub.js`); earlier builds showed controls but returned “Node Hub only” before calling the API. **No Motoko change** for this slice — redeploy **gateway** and **static Hub** (`web/hub`) for production parity. **PR #66** — **Delete non-default vault:** `DELETE /api/v1/vaults/:vaultId` (admin); self-hosted removes the vault directory only when it resolves **inside** the repo root, updates `hub_vaults.yaml`, access, scope, proposals, and vector rows; hosted = gateway → bridge → canister + bridge team/vector cleanup. Hub Settings → Backup **danger zone**; spec [HUB-API.md](./HUB-API.md) §3.3.2; test `test/hub-delete-vault.test.mjs`. **Ops:** redeploy **canister**, **bridge**, **gateway**, and **static Hub** for production vault delete. **MCP Issue #1 supercharge** merged to `main` (PR); local MCP complete; Hub MCP D2/D3 after hosted stability. **Phase 12 (blockchain):** Reserved in SPEC and BLOCKCHAIN-AND-AGENT-PAYMENTS.md; implement separately when needed. **Phase 16 (hosted billing) — docs + gateway scaffold:** [HOSTED-CREDITS-DESIGN.md](./HOSTED-CREDITS-DESIGN.md) defines the **target**: **indexing embedding tokens / month** (monthly grant resets) + **rollover token packs**; **search** fair-use (not a separate sold quota in v1). **Code today** is still a **cent-based** scaffold (`COST_CENTS` per search / index **job** / writes) — see design **§4** for the gap. [HOSTED-STORAGE-BILLING-ROADMAP.md](./HOSTED-STORAGE-BILLING-ROADMAP.md). **Implemented so far:** `hub/gateway/billing-*.mjs` — `GET /api/v1/billing/summary`, **Stripe webhook**, file/Blob store, **`BILLING_ENFORCE`** + **`BILLING_SHADOW_LOG`**. Canister V1 billing fields per roadmap when mirroring on-chain.

**Status:** [STATUS-HOSTED-AND-PLANS.md](./STATUS-HOSTED-AND-PLANS.md) · [docs/README.md](./README.md). **`npm test` green.** **Recent:** **Hosted semantic Re-index + meaning-search** verified in production after bridge Netlify **`external_node_modules`** for **sqlite-vec** / **better-sqlite3** (PR **#44**) and gateway **proxy** fix stripping **Content-Encoding** after `fetch().text()` (PR **#45** — avoids `ERR_CONTENT_DECODING_FAILED`). Supporting work: embedding URL validation, bridge env diagnostics, docs in **DEPLOY-HOSTED.md**. **Hosted Hub Import (2026-03):** **Production verified** — `POST /api/v1/import` via bridge → canister **`POST /api/v1/notes/batch`** succeeds after two Motoko fixes on mainnet: **`saveStable`** uses **`Buffer`** (avoids O(n²) `Array.append` when serializing large stable snapshots) and **`textFind`** uses a **single** haystack scan (avoids O(n²) `textSlice`/`Text.toArray` per index on large batch JSON bodies, which caused **503 `canister_error`** / instruction limit). See `hub/icp/src/hub/main.mo`. **Next engineering (ordered — see § “Recommended path forward” below):** (1) **Commit + push** canister fixes if your laptop predates `origin/main`; keep **§5.1 smoke** after deploys. (2) **Phase 15.1 + team access ops** — **redeploy gateway + bridge + canister** when code drifts; confirm **workspace owner** + vault-access/scope ([HOSTED-WORKSPACE-ACCESS.md](./HOSTED-WORKSPACE-ACCESS.md)). (3) **Hosted metadata bulk** — **Shipped:** gateway + Hub client (**PR #65**). **Ops:** redeploy **gateway** and **static Hub**; spec [HUB-METADATA-BULK-OPS.md](./HUB-METADATA-BULK-OPS.md). (4) **Stripe + billing enforcement** — unblocked now that **hosted import** is live ([HOSTED-CREDITS-DESIGN.md](./HOSTED-CREDITS-DESIGN.md)). (5) **Memory path** — Phase 8 file memory and/or **Mem0**. (6) **Proposal evaluation stage** (Option B+ — lifecycle doc, then API/UI); (7) **Retrieval / RAG evals** (eval v2 in golden-fixture / index terms — after stable index + labeled queries). (8) **Muse thin bridge** (optional); (9) MCP **D2/D3**, **F2–F5** — [BACKLOG-MCP-SUPERCHARGE.md](./BACKLOG-MCP-SUPERCHARGE.md). **Billing telemetry** (indexing tokens, summary) may land with merged billing PR; **paid UX** follows import. Parity gaps per [PARITY-PLAN.md](./PARITY-PLAN.md). **Issue #2** deferred. Re-verify production with [DEPLOY-HOSTED.md](./DEPLOY-HOSTED.md) §5 after deploys.

**Hosted parity (planning):** Same capabilities on the **hosted (web) service** as self-hosted — API parity, behavior parity (Connect GitHub, Back up now, search, index, proposals, Settings), and clear “coming soon” where not yet available. Brief overview and complexity: **[PLAN-ADDENDUM-HOSTED-PARITY.md](./PLAN-ADDENDUM-HOSTED-PARITY.md)**. Nuts and bolts in a dedicated session using PARITY-PLAN, DEPLOY-HOSTED, and BRIDGE-DEPLOY-AND-PREROLL.

---

## What we're doing next (path and stubs)

| Step | What | When |
|------|------|------|
| **Done** | Phase 13 invite, Landing refresh + enhancement, Help in Settings, Guided Setup. **Hosted (canister):** Phases 0–5 code and docs. **Phase 14 (Two-path launch).** **Option B (Muse protocol alignment):** HUB-API + canister `base_state_id` / `external_ref`; no Muse runtime. **Hosted parity (Phase 1):** Gateway stubs + real facets aggregation where implemented. **Hosted Hub provenance parity** with self-hosted (PR #40–class fixes: frontmatter as JSON object to canister, list/edit/facets parity). | Done. |
| **Done** | **Hosted semantic index + search (bridge path):** Production verified (Re-index + meaning-search via gateway → bridge); ops fixes **#44** (sqlite-vec not bundled on Netlify), **#45** (gateway proxy headers). Keep **CLI** `npm run index` / `knowtation search` on real vaults as regression habit; document new gaps only if found. | Done for hosted parity of this slice. |
| **Done** | **Memory augmentation — Sessions 1–10 (PRs #103 + #104, 2026-04-05)** — Full memory consolidation daemon stack + Hub UI. (S1) Pointer index + strict write discipline. (S2) Skeptical memory (`verifyMemoryEvent`, `memory_verify`). (S3) Topic-based partitioning. (S4) Core consolidation engine (LLM grouping + merge). (S5) Daemon lifecycle (`daemon start/stop/status`, PID file). (S6) Stale reference verification pass. (S7) Relationship discovery pass. (S8) OpenAI-compatible multi-provider LLM. (S9) Cost tracking + daily guardrails (`max_cost_per_day_usd`). (S10) Bridge endpoint + Netlify scheduler + MCP tools (`memory_consolidate`, `consolidation_settings`, `consolidation_history`) + Hub Settings Consolidation tab + Dashboard consolidation card + Billing consolidation row + How-to-Use section + `docs/MEMORY-CONSOLIDATION-GUIDE.md`. **1,077 tests passing** (128 net new). **MCP Issue #1 all phases A–H complete.** | Merged to `main`. Self-hosted: `config/local.yaml` `daemon.*`. Hosted: bridge + Netlify scheduler. See [MEMORY-CONSOLIDATION-GUIDE.md](./MEMORY-CONSOLIDATION-GUIDE.md). |
| **Done** | **Phase 15.1 hosted multi-vault (repo) + UX:** Canister `(userId, vault_id)` + settings vault list + bridge index/search per **`X-Vault-Id`**; Hub **Create vault** + **busy buttons** — **PR #46–#48**; [MULTI-VAULT-AND-SCOPED-ACCESS.md](./MULTI-VAULT-AND-SCOPED-ACCESS.md) § Hosted checklist. | Merged to `main`. **Production:** redeploy + §5.1 if the live canister predates this code ([STATUS-HOSTED-AND-PLANS.md](./STATUS-HOSTED-AND-PLANS.md) §2). |
| **Done (hosted)** | **Team vault access + scope:** Bridge **`hub_vault_access`** / **`hub_scope`** + **`hub_workspace`** owner; gateway **`X-User-Id`** / **`X-Actor-Id`** delegation and scope on list/get/facets. | **In repo** — [HOSTED-WORKSPACE-ACCESS.md](./HOSTED-WORKSPACE-ACCESS.md); redeploy gateway + bridge to enable in production. |
| **Done (hosted)** | **Hub Import** on hosted (multipart → bridge → canister batch write). **Production smoke:** import succeeds (2026-03); canister upgrades required **`saveStable` Buffer** + **linear `textFind`** for instruction limits. | [HOSTED-IMPORT-DESIGN.md](./HOSTED-IMPORT-DESIGN.md), [PARITY-PLAN.md](./PARITY-PLAN.md). |
| **Done** | **AIR Improvements A+B+C** (PR #96, 2026-04-03): (A) `writeNote` async — stores returned `air_id` in frontmatter; CLI+MCP duplicate calls removed. (B) Gateway calls `attestBeforeWrite` for hosted POST/PUT notes when `KNOWTATION_AIR_ENDPOINT` is set. (C) `air.required` config flag + `AttestationRequiredError` hard-fail class. | Merged to `main`. See [AIR-IMPROVEMENTS-PLAN.md](./AIR-IMPROVEMENTS-PLAN.md). |
| **Done** | **AIR Improvement D — Built-in attestation endpoint** (PR #97, 2026-04-03): `POST /api/v1/attest` (HMAC-signed records in Netlify Blobs) + `GET /api/v1/attest/:id` verify; gateway auto-sets `KNOWTATION_AIR_ENDPOINT` when `ATTESTATION_SECRET` present. See [AIR-IMPROVEMENTS-PLAN.md](./AIR-IMPROVEMENTS-PLAN.md) §D. | Merged to `main`. |
| **Done** | **AIR Improvement E — ICP blockchain anchor** (PR #99, 2026-04-03): Motoko attestation canister (`dejku-syaaa-aaaaa-qgy3q-cai`) — immutable append-only ledger; dual-write from gateway (Blob + ICP); `GET /api/v1/attest/:id/verify` cross-source consensus; `POST /api/v1/attest/anchor-pending` admin reconciliation; `@icp-sdk/core` client. 26 new tests. See [AIR-IMPROVEMENTS-PLAN.md](./AIR-IMPROVEMENTS-PLAN.md) §E, [DEPLOY-HOSTED.md](./DEPLOY-HOSTED.md) §5.2. | Merged to `main`. |
| **Done** | **Hub bulk housekeeping (self-hosted):** Delete and rename notes by **effective project slug** (`POST /api/v1/notes/delete-by-project`, `POST /api/v1/notes/rename-project` on Node Hub); proposal discard for deleted paths; Settings → Backup **presets** (path prefix + project slugs from facets); **New note** folder picker (`listVaultFolderOptions`, `GET /vault/folders`); localhost Hub uses same-origin API; docs [HUB-METADATA-BULK-OPS.md](./HUB-METADATA-BULK-OPS.md), [VAULT-RENAME-SPEC.md](./VAULT-RENAME-SPEC.md). | **Merged:** PR **#63** (2026-03). |
| **Done (hosted)** | **Metadata bulk delete/rename:** Gateway orchestrates the canister (`hub/gateway/metadata-bulk-canister.mjs`); shared `effectiveProjectSlug` in `lib/vault.mjs`; Hub Settings calls the routes on hosted (**PR #65**). **Ops:** redeploy gateway + static Hub. | [HUB-METADATA-BULK-OPS.md](./HUB-METADATA-BULK-OPS.md), [PARITY-PLAN.md](./PARITY-PLAN.md). |
| **Done** | **Delete non-default vault:** Self-hosted + hosted (**PR #66**): Motoko vault purge, bridge orchestration, gateway proxy, Hub danger-zone UI; vectors `deleteByVaultId`. | [HUB-API.md](./HUB-API.md) §3.3.2; [PARITY-PLAN.md](./PARITY-PLAN.md). **Ops:** redeploy canister + bridge + gateway + static Hub for prod. |
| **Done** | **Proposal evaluation stage:** Explicit evaluation step in proposal lifecycle — `POST /api/v1/proposals/:id/evaluation` on both Node Hub and gateway, canister V3 migration, evaluator role, review triggers, rubric, async review hints. Tests in `test/hub-proposal-evaluation.test.mjs`. **Muse thin bridge:** Optional Muse service URL; delegate **history / lineage** queries only; canonical vault + Hub unchanged — see **Option C — Muse thin bridge** below (not yet implemented). | Evaluation: merged. Muse: deferred. |
| **Done (ops)** | **Deploy hosted:** knowtation.store + gateway + canister **live**; bridge when `BRIDGE_URL` set. Ongoing: redeploy when code changes — [STATUS-HOSTED-AND-PLANS.md](./STATUS-HOSTED-AND-PLANS.md), [DEPLOY-HOSTED.md](./DEPLOY-HOSTED.md). | Done (ops ongoing). |
| **Next (hosted)** | **Re-verify after changes:** [DEPLOY-HOSTED.md](./DEPLOY-HOSTED.md) §5 + UI smoke; confirm `BRIDGE_URL`, embeddings, OAuth callbacks. | After any prod deploy. |
| **Done** | **Extended proposal Enrich:** LLM recommends **full note metadata** (`suggested_frontmatter` — project, `causal_chain_id`, `entity`, `episode_id`, `follows`, title, labels, …). Canister V5 adds `assistant_suggested_frontmatter_json`; gateway `POST /api/v1/proposals/:id/enrich`; Node Hub enrich route; `lib/proposal-enrich-llm.mjs` parse/validate/serialize. See [PROPOSAL-ENRICH-EXTENSION-PLAN.md](./PROPOSAL-ENRICH-EXTENSION-PLAN.md) (status: implemented). | Merged to `main` via `feature/enrich`. |
| **Done** | **Phase 16 (Stripe billing):** Checkout sessions, Customer Portal, pack purchase webhooks, billing summary, Netlify Blob store, `BILLING_ENFORCE` + `BILLING_SHADOW_LOG` flags. Race condition fix (single `mutateBillingDb` per webhook event). See [PHASE16-STRIPE-BILLING-PLAN.md](./PHASE16-STRIPE-BILLING-PLAN.md). | **Fully live (2026-04-04).** Stripe live keys active, `BILLING_ENFORCE=true` in production. |
| **Done** | **Phase 17 (Billing UX + note rendering)** (PR #93): (A) Markdown rendering — marked + DOMPurify, note read mode; (B) Tier selector — Free/Plus/Growth/Pro comparison grid with checkout wiring; (C) Operation count metering — searches + index jobs counters in billing middleware and Hub UI; (D) Pack card human-readable equivalents. See [PHASE17-BILLING-UX-PLAN.md](./PHASE17-BILLING-UX-PLAN.md). | Merged to `main`. |
| **Done** | **Phase 18 (Media URL in notes + MCP image/video resources):** No platform media hosting. (A) MCP Image Resources — `note-image` ResourceTemplate (`knowtation://vault/{+notePath}/image/{index}`), base64 blob for vision models, SSRF-protected `image-fetch.mjs` (HTTPS-only, DNS pre-resolution, private IP blocklist, 10MB cap, 8s timeout); (B) MCP Video Resources — `note-video` ResourceTemplate returning URL as text with typed `video/*` mimeType; (C) Hub inline `<video controls>` renderer — `expandVideoUrls()` post-processor + DOMPurify `ADD_TAGS: video/source`, `FORBID_ATTR: autoplay`; (D) GitHub-commit image upload — `lib/github-commit-image.mjs` (Contents API, triple file validation: extension + Content-Type + magic bytes), `POST /api/v1/notes/:path/upload-image` route (25MB multer, 10/15min rate limit); (E) Hub paste-URL helper — media toolbar with "Insert Media URL" dialog (paste + preview) and "Upload Image" button (visible when GitHub connected). Shared foundation: `lib/media-url-extract.mjs` (`extractImageUrls`, `extractVideoUrls`). 83 new tests (5 test files), 507 total passing. Branch: `feature/phase18-image-resources`. | Ready to merge. |
| **Done** | **Phase 12A (Blockchain frontmatter + agent wallet records)** (PR #94): Optional frontmatter (`network`, `wallet_address`, `tx_hash`, `payment_status`, `amount`, `currency`, `direction`, `confirmed_at`, `block_height`, `air_id`); list-notes + MCP filters; Hub Network + Wallet dropdowns + payment_status Quick chips; hosted facets; keyword search covers `network`, `wallet_address`, `tx_hash`, `payment_status`, `currency`, `direction`, `air_id`. See [PHASE12-BLOCKCHAIN-PLAN.md](./PHASE12-BLOCKCHAIN-PLAN.md). | Merged to `main`. |
| **Done** | **Phase 12B (Blockchain remainder)** (PR #95): (1) Wallet/transaction history CSV import (`wallet-csv` source type — Kraken, Binance, MetaMask, Phantom, Ledger Live normalisers; column mapping, dedup by `tx_hash`, `lib/importers/wallet-csv.mjs`); (2) AIR on-chain backend — ICP attestation canister `dejku-syaaa-aaaaa-qgy3q-cai` deployed (AIR Improvement E, PR #99). See [PHASE12-BLOCKCHAIN-PLAN.md](./PHASE12-BLOCKCHAIN-PLAN.md). | Merged to `main`. |
| **Done** | **AIR Improvements (A–E) — complete:** ✅ (A) Store `air_id` in frontmatter (PR #96). ✅ (B) Gateway AIR for hosted writes (PR #96). ✅ (C) `air.required` hard-fail (PR #96). ✅ (D) Built-in Netlify endpoint (PR #97). ✅ (E) ICP blockchain anchor (PR #99) — canister `dejku-syaaa-aaaaa-qgy3q-cai` deployed and authorized. See [AIR-IMPROVEMENTS-PLAN.md](./AIR-IMPROVEMENTS-PLAN.md). | All merged to `main`. |
| **Done** | **MCP D2/D3, F2–F5 + AWS Gateway deployment** — Hub MCP gateway (D2), OAuth 2.1 (D3), sampling tools (F2–F5). **AWS:** Persistent Node.js gateway deployed on EC2 `18.221.120.124` via PM2 + Nginx reverse proxy; `/.well-known/oauth-authorization-server` and `/mcp` endpoints live; PM2 systemd auto-start configured; all dependencies declared in `package.json`. | `feature/mcp-supercharge` — **ready to merge**. |

Stubs done now mean we don't change JWT shape or add new data files later in a breaking way; Phase 13 implementation only populates `role` from a roles store and enforces permissions.

### Recommended path forward (concise)

**Completed (1–9):**
1. ~~Core loop (hosted)~~ — Done. Index + search verified in production.
2. ~~Hosted import~~ — Done (2026-03). Spec: [HOSTED-IMPORT-DESIGN.md](./HOSTED-IMPORT-DESIGN.md).
3. ~~Hosted metadata bulk~~ — Done (PRs #63, #65).
4. ~~Billing (Phase 16)~~ — Done. Stripe products, webhooks, pack balance, enforcement scaffold.
5. ~~Multi-vault on hosted~~ — Done (PRs #46–#48, #66). Ops: redeploy as needed.
6. ~~Evaluation stage~~ — Done. Full lifecycle: `POST /proposals/:id/evaluation`, evaluator role, triggers, rubric, canister V3.
7. ~~Extended Enrich~~ — Done. LLM `suggested_frontmatter`, canister V5, gateway + Node Hub.
8. ~~Phase 12A+12B (blockchain)~~ — Done (PRs #94, #95). Frontmatter filters, wallet-csv import, wallet UI.
9. ~~Phase 17 (Billing UX)~~ — Done (PR #93). Markdown rendering, tier grid, operation metering, pack equivalents.
10. ~~AIR A–E~~ — Done (PRs #96, #97, #99). Full attestation stack including ICP blockchain anchor.

**Active / next:**
11. ~~**Memory augmentation**~~ — Done (`feature/memory-augmentation`). **Phase 1:** Three-tier provider architecture (file / vector / mem0); JSONL event log + state overlay; 11 event types; CLI 7 subcommands; 5 MCP tools + resources; auto-capture; hosted path; secret detection + privacy controls. **Phase 2:** Retention enforcement (throttled pruning); cross-vault memory (`scope: vault|global`); Mem0 import enrichment; 3 memory-aware MCP prompts (`memory-context`, `memory-informed-search`, `resume-session`); LLM session summaries (`memory summarize` CLI + `memory_summarize` MCP tool); AES-256-GCM encrypted memory at rest (`memory.encrypt: true`); Supabase provider with pgvector + migration SQL + `supabase-memory` import type. 112 tests across 4 test files. See `docs/MEMORY-AUGMENTATION-PLAN.md`.
12. ~~**MCP D2/D3, F2–F5:**~~ ✅ Done (PR #101 merged). Hub MCP gateway (`/mcp` endpoint, session pool, role ACL), OAuth 2.1 (`KnowtationOAuthProvider`), sampling tools (enrich, rerank, prefill, index-enrich). **AWS gateway deployed** on EC2 `18.221.120.124` (PM2 + Nginx, systemd auto-start). See [BACKLOG-MCP-SUPERCHARGE.md](./BACKLOG-MCP-SUPERCHARGE.md).
13. ~~**Phase 18 (Media URL in notes + MCP image/video resources):**~~ ✅ Done (`feature/phase18-image-resources`, hosted parity on `main`). Knowtation does NOT host media. (A) MCP Image Resources — `note-image` ResourceTemplate with SSRF-protected fetcher (`image-fetch.mjs`), base64 blob for vision models; (B) MCP Video Resources — `note-video` ResourceTemplate, URL as text with typed `video/*` mimeType; (C) Hub `<video controls>` inline renderer + DOMPurify hardening; (D) GitHub-commit image upload — `lib/github-commit-image.mjs` + `POST /api/v1/notes/:path/upload-image` with triple file validation; (E) Hub paste-URL helper with preview + upload; (F) Hosted parity — gateway handles upload directly (no binary Lambda hop), image-proxy uses GitHub Contents API `download_url` redirect (no response-size limit), client-side Canvas compression to ≤3 MB before upload, `apiBase`-prefixed fetch URLs so requests from ICP-hosted frontend reach the Netlify gateway. Shared: `lib/media-url-extract.mjs`, `hub/gateway/parse-multipart.mjs`. 515 total tests passing.
14. **Muse thin bridge:** Docs + optional env and small delegation surface; deferred until concrete partner or DAG need.
15. **Ops (ongoing):** Re-verify after deploys — [DEPLOY-HOSTED.md](./DEPLOY-HOSTED.md) §5. ~~Switch Stripe to live keys + `BILLING_ENFORCE=true`~~ — **Done (2026-04-04).** Stripe live keys active, `BILLING_ENFORCE=true` enabled in production.

### Option B (Muse protocol alignment) — do first

**Concrete tasks:**

- [x] **Document the variation protocol** in [HUB-API.md](./HUB-API.md) §3.4 Proposals: add "Variation protocol (Muse-aligned)" — identifiers (`proposal_id`, `base_state_id`), `intent`, optional `external_ref`, lifecycle (propose → review → approve/discard). State alignment with [Muse](https://github.com/cgcardona/muse); no Muse runtime.
- [x] **Canister extensibility:** Add `base_state_id` and `external_ref` (both `Text`, default `""`) to `ProposalRecord` in [hub/icp/src/hub/main.mo](hub/icp/src/hub/main.mo). Parse on POST /proposals; include in GET /proposals and GET /proposals/:id responses.
- [x] **No Muse runtime** — we do not run or depend on Muse; protocol alignment only.

**Upgrade note:** If the canister was deployed before Option B with existing proposals, upgrading adds the new fields; Motoko stable storage may require a migration or re-deploy depending on runtime behavior. For fresh deploys, no migration needed.

### Option C — Muse thin bridge (optional; not a required backend)

**Positioning:** Knowtation **canonical state** stays the vault (and canister on hosted). We do **not** make Muse part of the critical path for login, writes, or search. **Option B** remains the default contract (`base_state_id`, `intent`, `external_ref`).

**What “thin bridge” means:**

- Run **Muse** (or connect to a Muse instance) **optionally** — e.g. bridge sidecar, gateway route, or admin-only tool — when operators want **Git-replayed, structural history** (Muse’s commit/branch/DAG model) for a repo that backs the vault.
- Knowtation exposes **small integration points**: e.g. config `MUSE_URL` / `MUSE_API_KEY`, optional CLI `knowtation muse …` or Hub **Settings → Advanced** “Link Muse” for **read-only** history queries (branch timeline, structural diff pointers) when configured.
- On **approve** (or after merge to canonical), optionally write **`external_ref`** = Muse commit/branch id so proposals link to Muse lineage without Muse owning the vault.

**What we do *not* do in the thin bridge:** Replace the canister, require Muse for proposals, or implement the full **Knowtation domain plugin** (snapshot/diff/merge inside Muse) — that stays **Option A** / deferred until a concrete need. See [MUSE-STYLE-EXTENSION.md](./MUSE-STYLE-EXTENSION.md) §6.2 (full plugin) and §6.3 (thin bridge).

**Tasks (when prioritized):**

- [x] Document thin bridge in [MUSE-STYLE-EXTENSION.md](./MUSE-STYLE-EXTENSION.md) (new subsection): operator setup, security (Muse not on public unauthenticated path), and `external_ref` convention.
- [ ] Optional: one gateway or bridge **proxy route** or CLI subcommand that forwards to Muse **only** when env is set; graceful **no-op** when unset.
- [ ] Optional: MCP tool stub for “history summary” that calls the same delegate (after Muse API shape is stable).

### Option B+ — Proposal evaluation stage (lifecycle extension)

**Problem:** Today the Hub proposal flow is **propose → review → approve / discard**. You may want an **evaluation** step: automated or human **quality / policy / safety** checks before canonical merge.

**Ordering options (pick one product story; document in HUB-API before coding):**

| Pattern | Flow | Fits when |
|--------|------|-----------|
| **Evaluate before review** | propose → **evaluate** (auto or assigned reviewer) → *pending human review* → approve / discard | You want garbage filtered before humans see the queue. |
| **Evaluate after review, before approve** | propose → review (triage) → **evaluate** → approve / discard | Humans skim first; evaluation is a gate on the final button. |
| **Evaluate as part of approve** | propose → review → approve runs evaluation **inside** approve (transactional: approve fails if eval fails) | Minimal UI states; stricter coupling. |

**Interplay with Muse thin bridge:**

- **Independent:** Evaluation is about **whether** a proposal may merge; Muse is about **where** optional structural history lives. Neither requires the other.
- **Complementary:** If Muse is linked, evaluation could **read** structural diff / branch context from Muse (when `external_ref` or vault Git remote is wired) to improve agent or human judgment — still **optional**.
- **Identifiers:** Keep **`base_state_id`** for optimistic concurrency; add an **`evaluation_status`** (or equivalent) in proposal metadata **only after** the lifecycle is specified so the canister and gateway stay in sync.

**Tasks (when prioritized):**

- [ ] Add a short **PROPOSAL-LIFECYCLE.md** (or HUB-API §3.4 appendix): states, allowed transitions, roles (who can run evaluation vs approve).
- [ ] Canister + gateway: extend `ProposalRecord` / API only after the doc is agreed (avoid churn).
- [ ] Hub UI: show evaluation badge and block **Approve** until policy satisfied (if that’s the chosen pattern).

### Recommended next steps — updated (2026-04-03)

1. ~~Indexing + search verification~~ — Done. Production verified.
2. ~~Deploy / re-verify~~ — Done (ops ongoing). [DEPLOY-HOSTED.md](./DEPLOY-HOSTED.md) §5 after each deploy.
3. ~~Memory augmentation~~ — Done (`feature/memory-augmentation`). Phase 1 + Phase 2 (7 enhancements). 112 tests. See `docs/MEMORY-AUGMENTATION-PLAN.md`.
4. ~~Proposal lifecycle~~ — Done. Evaluation stage implemented (canister V3, evaluator role, triggers, rubric).
5. **Muse thin bridge** — Deferred until concrete partner or DAG need.
6. **Suggested prompts for agents** (optional) — Hub section or SUGGESTED-AGENT-PROMPTS.md.
7. ~~**MCP D2/D3, F2–F5**~~ — ✅ Complete + merged (PR #101) + **AWS gateway deployed** (EC2 `18.221.120.124`, PM2 + Nginx, OAuth 2.1 live). [BACKLOG-MCP-SUPERCHARGE.md](./BACKLOG-MCP-SUPERCHARGE.md). **Issue #2** deferred.
8. ~~**Phase 18 (Media URL + MCP image/video resources)**~~ — ✅ Done (`feature/phase18-image-resources`). 5 scope items (A–E), 4 new files, 4 modified, 83 new tests.

### Phase 11.1 and follow-on: order and status

Use this list to see what’s done and what’s not. Update the status when each item is completed.

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | **Hub first screen (login)** | Done | First thing at Hub URL: hero (title, tagline, intent), primary CTA (sign in above), "How to use" secondary. App class `login-screen` when shown; header provider buttons emphasized. |
| 2 | **Phase 13 invite** | Done | Invite by link: admin creates link (role) in Settings → Team; invitee opens link, signs in; added to roles. Pending list and revoke. |
| 3 | **Landing (web/) refresh** | Done | Repo + whitepaper links, tagline, Hub feature card. **Enhancement:** ecosystem graphic (tools → Knowtation → precise fetch), token-savings copy, intent compact/lower, dual CTA (View repo + Try Hub), #hosted section, links to AGENT-INTEGRATION + RETRIEVAL. |
| 4 | **Guided Setup in Hub** | Done | Setup checklist in Settings → Backup: (1) Vault path set, (2) Hub running, (3) Logged in, (4) Backup configured (optional). Steps 2–3 always Done; 1 and 4 derived from /api/v1/settings. "Done" per step with ✓. |
| 5 | **Help in Settings** | Done | "How to use" link in Settings modal header; opens How to use modal with Knowledge & agents tab. |
| 6 | **Hackathon / ecosystem messaging** | In progress | Landing reflects whitepaper (token savings, precise fetch); clear connect instructions (CLI/MCP in AGENT-INTEGRATION, RETRIEVAL; landing links to both). |
| 7 | **Domain connection** | Ready when you are | **Landing now:** Deploy `web/` to Netlify or 4Everland, add custom domain. **Hub later:** Subdomain when hosted Hub exists. See [DOMAIN-AND-DEPLOYMENT.md](./DOMAIN-AND-DEPLOYMENT.md) for step-by-step (Netlify, 4Everland, Cloudflare). |
| 8 | **Landing: add "API" to tagline** | Later | Tagline currently says "agent-ready MCP and CLI"; add "API" in a later phase when we surface a dedicated public/developer API (Hub REST exists but is not yet called out in landing tagline). |
| 9 | **Phase 14 (Two-path launch)** | Done | Landing and Hub: "Use in the cloud (beta)" and "Run it yourself" (Quick start in TWO-PATHS-HOSTED-AND-SELF-HOSTED.md); beta disclaimer. Hosting = beta, permissive usage for research until Phase 16 (paid subscriptions). |
| 10 | **Edit note in Hub detail panel** | Done | Note detail panel: "Edit" button for editor/admin; inline edit (body + frontmatter JSON); Save → POST /api/v1/notes; Cancel restores read-only. Implemented in web/hub/hub.js; works with Node Hub and canister-hosted. |
| 11 | **Hub Export and Import** | Done | Export: POST /api/v1/export (path, format) returns { content, filename }; note detail panel "Export" button (editor/admin). Import: POST /api/v1/import multipart (source_type, file; optional project, tags); ZIP extracted for folder sources; header "Import" button and modal. lib/export.mjs exportNoteToContent(); hub multer + adm-zip. |
| 12 | **Hub bulk delete / rename + folder UX** | Done (self-hosted + hosted gateway + Hub client) | **PR #63** (Node); **gateway** [`metadata-bulk-canister.mjs`](hub/gateway/metadata-bulk-canister.mjs); **PR #65** (Hub calls bulk on hosted). Path-prefix delete: Node or canister proxy; `GET /vault/folders` stub `inbox` on gateway. [HUB-METADATA-BULK-OPS.md](./HUB-METADATA-BULK-OPS.md). |
| 13 | **Delete vault (non-default)** | Done (Node Hub + canister + bridge + gateway + Hub UI) | **PR #66** — `DELETE /api/v1/vaults/:vaultId`; self-hosted: disk under repo root only; hosted: gateway → bridge → canister; vectors + access/scope cleanup. [HUB-API.md](./HUB-API.md) §3.3.2. |
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

**Implemented (Phase 8 session — initial stub):**
- `lib/memory.mjs`: storeMemory(dataDir, key, value), getMemory(dataDir, key); file backend stores in data/memory.json; graceful on error.
- CLI search: after runSearch, if memory.enabled, store last_search (query, paths, count).
- CLI export: after exportNotes, if memory.enabled, store last_export (provenance, exported).
- CLI: `knowtation memory query <key>` — keys: last_search, last_export; requires memory.enabled.
- Config: memory.enabled, memory.provider (file), memory.url; air.enabled, air.endpoint (normalized).
- AIR: already implemented in Phase 4 (lib/air.mjs); calls endpoint or placeholder when unreachable.
- docs/PHASE8-MANUAL-TEST.md.

**Implemented (Phase 8 augmentation — `feature/memory-augmentation`):**
- **Core engine:** `lib/memory-event.mjs` (11 event types, ID gen, validation, secret detection), `lib/memory-provider-file.mjs` (JSONL append-only log + state.json overlay), `lib/memory.mjs` rewritten with `MemoryManager` class + backward-compatible `storeMemory`/`getMemory` wrappers.
- **Three-tier providers:** `file` (default, zero-dependency), `vector` (extends file with embedding-based semantic search via existing vector store), `mem0` (delegates to external Mem0 API).
- **Config expanded:** `memory.retention_days`, `memory.capture` (configurable event types to auto-capture).
- **CLI expanded:** 7 subcommands — `query`, `list`, `store`, `search`, `clear`, `export`, `stats`. Removed hardcoded `validKeys`.
- **MCP expanded:** 5 tools (`memory_query`, `memory_store`, `memory_list`, `memory_search`, `memory_clear`) in new `mcp/tools/memory.mjs`; old `memory_query` removed from `phase-c.mjs`; 2 new resources (`knowtation://memory/`, `knowtation://memory/events`).
- **Auto-capture:** Memory events captured after search, export, write, import, index, propose in both CLI and MCP; honors `memory.capture` config list via `shouldCapture()`.
- **Hosted path:** Gateway `/api/v1/memory/*` proxy routes; bridge memory endpoints with per-user/vault file storage under `DATA_DIR/memory/{userId}/{vaultId}/`.
- **Privacy:** Secret detection rejects data with sensitive key patterns; configurable capture types; retention limits; `memory clear` requires `--confirm`; per-user isolation on hosted.
- **Tests:** 87 tests across 4 files (`test/memory.test.mjs`, `test/memory-cli.test.mjs`, `test/memory-mcp.test.mjs`, `test/memory-hosted.test.mjs`).
- **Docs:** `docs/MEMORY-AUGMENTATION-PLAN.md`, `docs/SPEC.md` §7 updated, `docs/PHASE8-MANUAL-TEST.md` updated, `config/local.example.yaml` updated.

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
- **Issue #1 Phase C (enhanced tools):** `mcp/tools/phase-c.mjs` — relate, backlinks, capture, transcribe, vault_sync, summarize, extract_tasks, cluster, memory_query, tag_suggest; libs under `lib/`. See [BACKLOG-MCP-SUPERCHARGE.md](./BACKLOG-MCP-SUPERCHARGE.md).
- **Issue #1 Phase E (subscriptions + watcher):** `mcp/resource-subscriptions.mjs` — `resources/subscribe` / `unsubscribe`, chokidar on `vault_path`, debounced `notifications/resources/updated` and `list_changed`; `index` tool notifies index/tags/projects/graph URIs when subscribed.
- **Issue #1 Phase H (progress + logging):** `mcp/tool-telemetry.mjs`; `McpServer` with `capabilities.logging`; `index` / `import` use `_meta.progressToken` + `onProgress` in `lib/indexer.mjs` and markdown importer; structured `notifications/message` for index/import/write.
- **Issue #1 Phase B (prompts):** `mcp/prompts/register.mjs` + `helpers.mjs` — ten prompts (daily-brief, search-and-synthesize, project-summary, write-from-capture, temporal-summary, extract-entities, meeting-notes, knowledge-gap, causal-chain, content-plan); `listNotesForCausalChainId` in `mcp/resources/graph.mjs`.
- **Issue #1 Phase D1 (Streamable HTTP):** `mcp/http-server.mjs`, `mcp/create-server.mjs` (shared mount), `mcp/stdio-main.mjs`, `mcp/server.mjs` transport switch; `config.mcp.http_port` / `http_host`; `express` dependency.
- **Issue #1 Phase D2 (Hub MCP gateway):** `hub/gateway/mcp-proxy.mjs` — Express router for `/mcp` with JWT auth, per-user session pool (max 5, 30-min TTL), rate limiting (60 req/min). `hub/gateway/mcp-hosted-server.mjs` — per-session McpServer with canister/bridge-backed tools. `hub/gateway/mcp-tool-acl.mjs` — role-based tool filtering (viewer/editor/admin).
- **Issue #1 Phase D3 (OAuth 2.1):** `hub/gateway/mcp-oauth-provider.mjs` — `KnowtationOAuthProvider` implementing `OAuthServerProvider` from MCP SDK. Dynamic client registration (in-memory), PKCE authorization flow via Hub OAuth, MCP-scoped JWT access tokens. Mounted via `mcpAuthRouter` in gateway. Auth callbacks extended for MCP state passthrough.
- **Issue #1 Phase G (scope / roots alignment):** `mcp/server-instructions.mjs` — initialize `instructions` with plain language + `file://` URIs for vault and data_dir (multi-vault lines when configured); after `initialized`, optional `roots/list` + structured log when the client supports roots.
- **Issue #1 Phase F1–F5 (sampling):** `mcp/sampling.mjs` — generic `trySampling()` and `trySamplingJson()` helpers. F1: `summarize` in `phase-c.mjs` (refactored to use shared helper). F2: `enrich` tool in `mcp/tools/enrich.mjs` (auto-tag, categorize, title via sampling). F3: index enrichment in `mcp/tools/index-enrich.mjs` (opt-in `--enrich` flag). F4: search reranking in `mcp/tools/sampling-rerank.mjs` (post-search LLM rerank). F5: prompt prefill in `mcp/prompts/helpers.mjs` (`maybeAppendSamplingPrefill`).
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

**Goal:** Ship the split explicitly so users can "use in the cloud (beta)" or "run it yourself." During beta, hosted usage is **permissive** (research + shadow metering); **Phase 16** adds **paid card subscriptions** (see Phase 16 and [HOSTED-CREDITS-DESIGN.md](./HOSTED-CREDITS-DESIGN.md)).

**Deliverables:**

1. **Landing / Hub copy** — Two clear CTAs or sections: (1) Use in the cloud (beta) → knowtation.store/hub/, (2) Run it yourself → Quick start (self-hosted) link.
2. **Quick start (self-hosted)** — One short doc or section (e.g. in [TWO-PATHS-HOSTED-AND-SELF-HOSTED.md](./TWO-PATHS-HOSTED-AND-SELF-HOSTED.md) or [GETTING-STARTED.md](./GETTING-STARTED.md)): clone, set `KNOWTATION_VAULT_PATH` and `HUB_JWT_SECRET`, `npm run hub`, open localhost. Optional: OAuth and hub/README link.
3. **Beta disclaimer** — On landing or Hub: hosted is beta; **usage is open** while we **research** real-world patterns; when billing goes live, **card subscriptions** with **monthly indexing token** allowances and **rollover token packs** for overage (see [HOSTED-CREDITS-DESIGN.md](./HOSTED-CREDITS-DESIGN.md)).
4. **Build status / "What we're doing next"** — Update top of IMPLEMENTATION-PLAN and STATUS-HOSTED-AND-PLANS to say "Two-path launch done; hosting = beta, permissive usage for research until Phase 16."

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

**Status (self-hosted — Phase 15 implemented):** Option A (multiple vaults per instance) + Option B (scoped visibility) are implemented. Data: `data/hub_vaults.yaml`, `hub_vault_access.json`, `hub_scope.json`. Config: `vaultList`, `resolveVaultPath`; single-vault default when file absent. Hub server: vault resolution, access check, scope filter; admin routes GET/POST `/api/v1/vaults`, `vault-access`, `scope`; settings returns `vault_list` and `allowed_vault_ids`. UI: vault switcher, Settings → Vaults (admin). Bridge: vector dirs keyed by `(uid, vault_id)` when index/search run against exported vault slices; gateway forwards `X-Vault-Id` when configured.

### Phase 15.1 — Hosted multi-vault parity (canister + gateway + bridge)

**Label:** **Phase 15.1** (extends Phase 15; hosted-only canister/migration work, plus confirming gateway + bridge match self-hosted behavior).

**Goal:** On the **hosted** product, **multiple vault IDs** and **`X-Vault-Id`** behave like self-hosted: notes, proposals, and export are partitioned by `(userId, vault_id)`; Hub vault switcher and settings align with server truth; **Re-index / semantic search** on hosted use bridge storage **per** `(uid, vault_id)` when the export/index path includes `vault_id`.

**Where it is specified:** [MULTI-VAULT-AND-SCOPED-ACCESS.md](./MULTI-VAULT-AND-SCOPED-ACCESS.md) § Hosted (checklist, migration, gateway vault list). **Production state vs repo:** [STATUS-HOSTED-AND-PLANS.md](./STATUS-HOSTED-AND-PLANS.md) §2 — Motoko partition + V1 migration + gateway/bridge wiring **exist in this repository**; **live ICP** may still be an older single-map canister until you **redeploy** `hub/icp` and run preflight/migration verification.

**Status (merged to `main`, 2026-03):** PR **#46** (partition + wiring + docs/smoke); PR **#47** (Hub **Create vault** on hosted); PR **#48** (busy UI during slow requests). **Not in this slice:** per-user **vault allowlist** and **project/folder scope** for teammates on hosted (self-hosted JSON only today) — see MULTI-VAULT §2.1; **Hub Import** on hosted remains **501** until a later phase.

**Sequencing vs hosted indexing:** Verify **hosted semantic search + Re-index** end-to-end for the **`default`** vault first (`BRIDGE_URL`, embeddings, [DEPLOY-HOSTED.md](./DEPLOY-HOSTED.md) §5, [INDEX-SEARCH-VERIFY.md](./INDEX-SEARCH-VERIFY.md)). That confirms retrieval on hosted before you rely on multi-vault behavior. **Then** (or in parallel in development, but for **production operations**: after single-vault index/search is green) redeploy and validate **Phase 15.1** so extra vault IDs and `X-Vault-Id` match self-hosted semantics.

**Regression safety (local):** Prefer fixing broken `npm test` cases and adding **hub/server** tests for vault resolution + `X-Vault-Id` (fixtures under `test/`) so self-hosted multi-vault does not regress while hosted canister work proceeds. Add or extend tests for hosted multi-vault paths as the canister and gateway evolve.

---

## Phase 16 — Hosted billing: subscriptions + indexing token quotas + rollover packs (optional)

**Product sequencing:** Treat **Stripe Checkout, subscription lifecycle, pack purchases, period resets, and token (or cent) enforcement** as **Phase 16 completion** work to ship **after** **hosted `POST /api/v1/import`** replaces **501** ([HOSTED-IMPORT-DESIGN.md](./HOSTED-IMPORT-DESIGN.md), branch **`feature/hosted-import-parity`**). **Indexing-token telemetry**, **`billing/summary`**, and **Settings → Billing** may land on `main` earlier via the billing PR; that does **not** replace the need to finish import parity first for a coherent hosted UX.

**Goal:** **Hosted** billing follows [HOSTED-CREDITS-DESIGN.md](./HOSTED-CREDITS-DESIGN.md): **one public unit** — **indexing embedding tokens per month** (monthly grant **resets**); **packs** add **rollover indexing tokens**; **semantic search** **included** (fair use, still logged). **Netlify-style** consumption order: **monthly grant first**, then **pack balance**. **Beta:** `BILLING_ENFORCE` off by default; **`BILLING_SHADOW_LOG`** for research (extend with **token** fields when bridge reports them). **Future:** usage **history + chart** in Hub. **No crypto** in the first slice.

**Design docs (authoritative for product shape):**

- [HOSTED-CREDITS-DESIGN.md](./HOSTED-CREDITS-DESIGN.md) — tiers (**Free / Plus / Growth / Pro**), illustrative **M tokens**, λ and **f**, pools, transparency, **§4** status table.
- [HOSTED-STORAGE-BILLING-ROADMAP.md](./HOSTED-STORAGE-BILLING-ROADMAP.md) — V1 reserved fields (extend with **token** balances; **cents** may remain legacy until migration).

**Done (scaffold):**

1. Gateway billing store (cents-oriented): `tier`, `period_*`, `monthly_included_cents`, `monthly_used_cents`, `addon_cents`, Stripe ids; file/Blob persistence.
2. Stripe webhook route + idempotent `event.id` handling (packs/subs as configured).
3. `billing-logic.mjs` — deduct monthly then addon (**cents**).
4. `runBillingGate` — fixed **`COST_CENTS`** per search / index **job** / writes when `BILLING_ENFORCE=true`.
5. `GET /api/v1/billing/summary` — pools + **`cost_breakdown`** + policy fields.
6. **`BILLING_SHADOW_LOG`** — JSON lines per billable op.

**Remaining (to match design doc):**

1. ~~**Bridge** — Count **embedding input tokens** per index job; response field **`embedding_input_tokens`**.~~ **Done** (OpenAI usage + Ollama estimate).
2. **Gateway ledger** — **Done:** **`monthly_indexing_tokens_used`** increments after successful index; **`billing/summary`** exposes included/used/pack fields. **Todo:** webhook handlers set **included** from Stripe tier and **pack** from Checkout **`metadata`** (pack balance still always 0 until Checkout wired).
3. **Enforcement** — On **index** only (v1): refuse **`402`** when **tokens used + job estimate** would exceed **monthly + pack**; **search** stays unblocked or soft-limited per policy.
4. **`billing-constants.mjs`** — Align **Stripe** tier names with **$9 / $17 / $25** products when live; optional middle tier env (`STRIPE_PRICE_GROWTH`) when added.
5. **Hub UI** — **Partial:** Settings → **Billing** (read-only summary). **Todo:** **Buy pack** / Customer Portal, richer usage chart; **`cost_breakdown`** may stay for writes until token-only UX ships.
6. **Tests** — Token deduction / **402** when enforcement ships; integration with shadow logs.

**Acceptance:** Webhooks set tier + **included tokens**; packs increase **rollover token** balance; summary and Hub show **same numbers** as enforcement; over-quota **index** returns **402**. Self-hosted unchanged.

**Depends on:** Phase 11, 14; bridge index path instrumented. Canister mirror optional until scaling needs it.

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
| **14** | **11** | **Two-path launch: landing/Hub CTAs (Use in cloud beta / Run it yourself), Quick start (self-hosted), beta disclaimer. Hosting = beta, permissive usage for research until Phase 16 (subscriptions).** |
| **15** | **11** | **Multi-vault (optional): multiple vaults per Hub or scoped visibility. Design in MULTI-VAULT-AND-SCOPED-ACCESS.md; backend + UI vault/scope.** |
| **16** | **11, 14, 15.1 storage** | **Hosted billing: Stripe subs + indexing token quotas + rollover token packs; gateway store + webhooks (`hub/gateway/billing-*.mjs`); bridge token metering. See HOSTED-CREDITS-DESIGN.md + HOSTED-STORAGE-BILLING-ROADMAP.md.** |

**Intention and temporal:** Optional frontmatter and filters (`--since`, `--until`, `--chain`, `--entity`, `--episode`, `--order`) are specified in **docs/INTENTION-AND-TEMPORAL.md** and SPEC §2.3. Implement time-bounded filters in **Phase 3.1 or Phase 4** (search and list-notes); indexer already stores `date` in metadata. **Retrieval evals** (`knowtation eval`, golden sets per SPEC §12) remain optional after search/index baselines are verified. **Hub proposal evaluation** (Option B+ — policy/quality gate before or after review) is a separate lifecycle feature; document states before extending `ProposalRecord`.

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
| **16** | **New session** | Hosted Stripe subscriptions + metering; after beta analysis; separate session(s) when adding billing and top-ups. |

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
- **Two-path launch (Phase 14):** Go live with hosted (beta) + self-hosted; clear CTAs and Quick start (self-hosted). Hosting = beta, permissive usage for research until **Phase 16 (Stripe subscriptions)**. Multi-vault = **Phase 15**; design in [MULTI-VAULT-AND-SCOPED-ACCESS.md](./MULTI-VAULT-AND-SCOPED-ACCESS.md).
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
- **Muse Option A (full domain plugin / Muse as variation backend):** Out of scope unless there is a concrete need (partner, shared DAG, structural merge ownership). See [MUSE-STYLE-EXTENSION.md](./MUSE-STYLE-EXTENSION.md) §6.2.
- **Muse Option C (thin bridge):** In scope as **optional** operator integration — delegated history queries + `external_ref`; **not** required for core Hub. Tracked in **Option C** above.
- **Proposal evaluation stage (Option B+):** In scope as a **documented lifecycle extension** first; implement canister/UI after state machine is fixed. See **Option B+** above.
- **Canister proposal migration:** If the canister was deployed before Option B with existing proposals, upgrade to the new ProposalRecord (base_state_id, external_ref) may require migration or re-deploy; document in deploy notes when we have a procedure.
- **Phase 2 verification:** Use [DEPLOY-HOSTED.md](./DEPLOY-HOSTED.md) §5 and [STATUS-HOSTED-AND-PLANS.md](./STATUS-HOSTED-AND-PLANS.md) for live stack checks (gateway, canister, bridge, env).

You can implement phases in sequence (1 → 2 → … → 11) or parallelize 5, 6, 7 after 4. Phases 11 and 12 are optional. This plan ensures the full product is built with no scope left unspecified; Phase 12 reserves blockchain/wallets/agent payments so we don’t backtrack when agents adopt wallets and on-chain activity.

---

## Follow-up: Canister JSON export backup + daily schedule (post-deploy / pre-launch)

**Goal:** Before risky canister upgrades and ongoing in production, keep retrievable backups of vault data via the canister HTTP export (`GET …/api/v1/export`).

**Environment (same for preflight backup and for a scheduled job):**

- `KNOWTATION_CANISTER_URL` — Base URL, no trailing slash (e.g. `https://<canister-id>.icp0.io` or `.raw.icp0.io` if that is what you use for direct canister HTTP).
- `KNOWTATION_CANISTER_BACKUP_USER_ID` — Value sent as `X-User-Id` for export (the stable user id string the gateway uses for that partition, e.g. `google:…`). Not the same thing as a Hub JWT unless you deliberately align them.
- `KNOWTATION_CANISTER_BACKUP_VAULT_ID` — Optional; defaults to `default` in `scripts/canister-predeploy.sh`.

**Repo behavior:** `npm run canister:preflight` runs `scripts/canister-predeploy.sh`, which loads repo-root `.env` when present and can default `KNOWTATION_CANISTER_URL` from `hub/icp/canister_ids.json` if `KNOWTATION_CANISTER_BACKUP_USER_ID` is set but URL is not (parity with `canister:release-prep`). Backups land in `./backups/canister-export-<UTC-stamp>.json` (gitignored).

**Daily backup (do after deploy, before or right after launch):**

- **Option A — Cron on a trusted host:** `cd` to the repo (or a deploy directory), ensure `.env` exists with the three variables (or export them in the crontab wrapper), run the same export the predeploy script uses (e.g. thin `scripts/canister-export-backup.sh` that only curls export → `backups/`) on a fixed schedule; rotate or archive old files off-machine as policy requires.
- **Option B — Scheduled CI:** GitHub Actions (or similar) on a schedule with repository secrets mirroring the same variable names; workflow runs `curl` or the thin script and uploads artifacts / pushes to encrypted storage — choose based on where secrets should live and retention needs.

**Track:** Implement the dedicated export-only script and wire cron or Actions when operations are ready; credentials are the export headers above, not necessarily the same as other Hub gateway secrets.
