# Status: hosted product, multi-vault, Phase 12

**Roadmap:** [IMPLEMENTATION-PLAN.md](./IMPLEMENTATION-PLAN.md) · **`npm test` is green** in repo. **Production is live** (landing + Hub + gateway + canister); **bridge** works when deployed and **`BRIDGE_URL`** is set on the gateway (reported operational). **Phase 15.1 (repo):** merged to **`main`** (**PR #46** partition + gateway/bridge; **#47** Hub **Create vault**; **#48** busy UI on slow actions). **Hub bulk housekeeping:** **PR #63** (Node) + **gateway** [`metadata-bulk-canister.mjs`](../hub/gateway/metadata-bulk-canister.mjs) — same `POST /notes/delete-by-project` and `POST /notes/rename-project` on hosted (orchestrates canister; not Motoko routes). **PR #65** — Hub client actually **calls** those routes on hosted (no pre-request “Node Hub only” guard). Folder picker, presets; see [HUB-METADATA-BULK-OPS.md](./HUB-METADATA-BULK-OPS.md). **PR #66** — **Delete non-default vault:** `DELETE /api/v1/vaults/:vaultId`; self-hosted removes disk only under repo root + updates `hub_vaults.yaml`, access, scope, proposals, vectors; hosted = gateway → bridge → canister + bridge team/vector cleanup. Hub Settings → Backup danger zone; [HUB-API.md](./HUB-API.md) §3.3.2. **Ops:** redeploy **gateway** and **static Hub** (`web/hub`) for metadata bulk in production; for **vault delete** in production, redeploy **canister**, **bridge**, **gateway**, and **static Hub**; redeploy ICP canister + run §5.1 when the live canister may lag git. **Hub Import** on hosted is **live** when **`BRIDGE_URL`** is set ([HOSTED-IMPORT-DESIGN.md](./HOSTED-IMPORT-DESIGN.md)). **Stripe / billing completion** (Checkout, enforcement) — see IMPLEMENTATION-PLAN strategic sequencing. **Team vault access + scope** are **in repo** ([HOSTED-WORKSPACE-ACCESS.md](./HOSTED-WORKSPACE-ACCESS.md)); redeploy gateway + bridge and smoke **POST /workspace**, vault-access, scope, two-account delegation per §5. **Billing design + telemetry:** **[HOSTED-CREDITS-DESIGN.md](./HOSTED-CREDITS-DESIGN.md)**; **[HOSTED-STORAGE-BILLING-ROADMAP.md](./HOSTED-STORAGE-BILLING-ROADMAP.md)** for V1 fields. **Manual verification:** [DEPLOY-HOSTED.md](./DEPLOY-HOSTED.md) §5 + §2.1 parity table below.

Short reference for **canister/hosted**, **two-path launch**, **multi-vault**, and **Phase 12 (blockchain)**.

**Two-path launch (Phase 14) done.** Landing and Hub offer "Use in the cloud (beta)" and "Run it yourself" (Quick start in [TWO-PATHS-HOSTED-AND-SELF-HOSTED.md](./TWO-PATHS-HOSTED-AND-SELF-HOSTED.md)). Hosting = **beta** with **permissive usage** for research until Phase 16 (**Stripe subscriptions**).

**Priority vs MCP backlog:** **Hosted parity** (this doc, [PARITY-PLAN.md](./PARITY-PLAN.md), bridge + env + verification) comes **before** **Hub MCP gateway (Issue #1 D2/D3)**. MCP supercharge is **on `main`**; local MCP works without hosted MCP. Order: [BACKLOG-MCP-SUPERCHARGE.md](./BACKLOG-MCP-SUPERCHARGE.md) § Strategic sequencing.

**Hosted multi-vault (Phase 15.1):** **In repo and merged:** canister `vault_id` partitioning, V1 migration, gateway vault list, bridge export+index paths, Hub **Create vault** + busy states — [MULTI-VAULT-AND-SCOPED-ACCESS.md](./MULTI-VAULT-AND-SCOPED-ACCESS.md) § Hosted (**PR #46–#48**). **Ops:** redeploy canister when needed, then preflight + migration verify scripts. With **little or no production data**, migration risk stays **minimal**.

**Testing:** Run **`npm test`** regularly; fix known failing tests so CI reflects reality. Add tests alongside hub/canister changes — see [IMPLEMENTATION-PLAN.md](./IMPLEMENTATION-PLAN.md) Phase 15.

---

## 1. Canister and web hosting (hosted product)

**Plan:** The phased canister-based hosted plan (Phase 0 → 5) is implemented in code and docs. Branch strategy: Phase 0 on main; Phases 1–5 were developed on a feature branch and merged.

| Phase | What | Status |
|-------|------|--------|
| **0** | Prep: `vault_id` in API, canister auth contract doc, Hub UI API base URL config | ✅ Done (main) |
| **1** | Canister: vault + proposals API (Motoko), `dfx` deploy, CORS, GET /export | ✅ Done — `hub/icp/` |
| **2** | Gateway: OAuth (Google/GitHub), JWT, proxy to canister with X-User-Id | ✅ Done — `hub/gateway/` |
| **3** | Bridge: Connect GitHub, store token, Back up now (canister → GitHub) | ✅ Done — `hub/bridge/` |
| **4** | Bridge: indexer + search (per-user sqlite-vec) | ✅ Done — bridge POST /api/v1/index, /api/v1/search. **Semantic** = vector store; **keyword** = canister export + text match when `body.mode === "keyword"` (PR **#79**); redeploy bridge for parity. **Production hardening (2026-03):** Netlify **`[functions].external_node_modules`** for **sqlite-vec** + **better-sqlite3** (bundler broke `import.meta.url` → Invalid URL); gateway **must not** forward **Content-Encoding** after `fetch().text()` when proxying to bridge (PRs **#44**, **#45**). Meaning-search + Re-index **smoke-tested OK** on knowtation.store after those deploys. |
| **5** | 4Everland + single URL (knowtation.store), deploy docs, landing CTA | ✅ Done — docs, web/ updated |

**Current deployed state**

- **Automated smoke (2026-03-21):** `GET https://knowtation-gateway.netlify.app/health` → **200**. `GET https://rsovz-byaaa-aaaaa-qgira-cai.raw.icp0.io/health` → **200** (use **raw** `icp0.io` for `CANISTER_URL` if `ic0.app` returns 400). `https://knowtation.store/hub/` → **301** (redirect; site present).
- **Canister:** Deployed on ICP. Gateway uses `CANISTER_URL` in Netlify (must match a URL that returns 200 for `/health`).
- **4Everland:** Full `web/` at **knowtation.store** (landing `/`, Hub `/hub/`). Custom domain set.
- **Netlify gateway:** e.g. **knowtation-gateway.netlify.app**. `web/hub/config.js` sets `HUB_API_BASE_URL` for knowtation.store to that gateway.
- **Bridge:** Separate deploy from `hub/bridge/`. Gateway proxies vault/sync, search, index, and some Team APIs when **`BRIDGE_URL`** is set. **Operator:** you have reported bridge + notes working in production; keep **§5 pre-roll** as the list to re-run after env or deploy changes.
- **Pre-roll / re-verification:** Use [DEPLOY-HOSTED.md](./DEPLOY-HOSTED.md) §5 as a **checklist** (not “site unpublished”).

**What the bridge is:** The root `netlify.toml` **build** installs gateway and bridge dependencies and emits **both** Netlify functions (`gateway` and `bridge`). The **gateway** Netlify site uses that root config, so visitors hit the gateway function. The **bridge** is a **separate Netlify site** with **Package directory** `deploy/bridge` so traffic is routed to the bridge function (see [BRIDGE-DEPLOY-AND-PREROLL.md](./BRIDGE-DEPLOY-AND-PREROLL.md)). It provides Connect GitHub, Back up now, index + search, and bridge-persisted roles/invites when configured. Without **`BRIDGE_URL`** on the gateway, those features are not proxied (stubs or missing on gateway-only paths).

**When gateway + bridge + `BRIDGE_URL` are set:** Index/search, Connect GitHub, Back up now, and **Team (roles/invites)** on hosted follow [HOSTED-ROLES-VIA-BRIDGE.md](./HOSTED-ROLES-VIA-BRIDGE.md) and the parity table below. Embeddings must use a **real** API (e.g. OpenAI on the bridge); `https://ollama.com` is **not** an Ollama API base URL.

**After code changes (ongoing ops, not first-time deploy):**

- **Canister:** Redeploy when Motoko changes (e.g. Option B proposal fields, future Phase 15.1): `cd hub/icp && dfx deploy --network ic`.
- **Gateway / bridge:** Redeploy Netlify (or your host) when `hub/gateway` or `hub/bridge` changes; confirm env vars still set.
- **4Everland:** Rebuild when `web/` changes.

**Docs:** [DEPLOY-HOSTED.md](./DEPLOY-HOSTED.md), [CANISTER-AND-SINGLE-URL.md](./CANISTER-AND-SINGLE-URL.md), [CANISTER-AUTH-CONTRACT.md](./CANISTER-AUTH-CONTRACT.md), [ICP-GITHUB-BRIDGE.md](./ICP-GITHUB-BRIDGE.md), [hub/gateway/README.md](../hub/gateway/README.md), [hub/bridge/README.md](../hub/bridge/README.md).

---

## 2. Multi-vault (split vault)

**Self-hosted (Node Hub): implemented (Phase 15).** `data/hub_vaults.yaml`, `hub_vault_access.json`, optional `hub_scope.json`; vault switcher in the Hub header; `X-Vault-Id` on API calls; `hub/server.mjs` resolves path + access + scope; bridge uses `(uid, vault_id)` directories for sqlite-vec. See [IMPLEMENTATION-PLAN.md](./IMPLEMENTATION-PLAN.md) Phase 15 and [MULTI-VAULT-AND-SCOPED-ACCESS.md](./MULTI-VAULT-AND-SCOPED-ACCESS.md).

**Hosted (canister): Phase 15.1 is implemented in this repo.** Notes and proposals are partitioned by `(userId, vault_id)`; requests use **`X-Vault-Id`** (default vault id `default` when omitted). V0→V1 migration and reserved billing fields are in Motoko per [HOSTED-STORAGE-BILLING-ROADMAP.md](./HOSTED-STORAGE-BILLING-ROADMAP.md). **Production:** until you **redeploy** `hub/icp` to ICP and run checks (`npm run canister:preflight`, `npm run canister:verify-migration` against the deployed canister), the **live** canister may still be the older single-map behavior—treat per-vault isolation as **verified only after** that deploy. Bridge index/search already uses separate vector dirs per `(uid, vault_id)` when configured. Details: [MULTI-VAULT-AND-SCOPED-ACCESS.md](./MULTI-VAULT-AND-SCOPED-ACCESS.md) § Hosted.

---

## 2.1 Parity snapshot (self-hosted vs hosted)

| Area | Self-hosted (Node Hub) | Hosted (gateway + canister + bridge) |
|------|------------------------|--------------------------------------|
| **Notes, proposals, export** | Local vault folder | Canister |
| **OAuth + JWT** | Your `.env` OAuth apps | Gateway OAuth |
| **Semantic search + Re-index** | Local Ollama/OpenAI + `data/knowtation_vectors.db` (sqlite-vec) or Qdrant | Bridge: embeddings + per-user vectors (e.g. Netlify Blobs). Gateway proxies when `BRIDGE_URL` set — **verified working** in prod after gateway header + Netlify native-module config (see §1 Phase 4 row). |
| **Connect GitHub / Back up now** | Local vault git | Bridge |
| **Team: roles + invites** | `data/hub_roles.json`, invites on disk | **Bridge persistence** when `BRIDGE_URL` set; gateway proxies roles/invites to bridge ([HOSTED-ROLES-VIA-BRIDGE.md](./HOSTED-ROLES-VIA-BRIDGE.md), PARITY-PLAN Phase 4 ✅). Without bridge: stubs only |
| **Settings → Setup / POST setup** | Writes `hub_setup.yaml` | Gateway stub (no-op); vault is canister |
| **Import (Hub upload)** | Works | **Live** when gateway **`BRIDGE_URL`** set — bridge → canister batch ([HOSTED-IMPORT-DESIGN.md](./HOSTED-IMPORT-DESIGN.md)) |
| **Bulk delete by project slug / rename project** | Node Hub same routes | **Gateway** implements routes (lists notes, per-note DELETE/POST; proposal discards). **Not** Motoko paths — redeploy gateway ([HUB-METADATA-BULK-OPS.md](./HUB-METADATA-BULK-OPS.md), [PARITY-PLAN.md](./PARITY-PLAN.md)) |
| **Bulk delete by path prefix** | Works | **On canister** — same path-string semantics as Node |
| **`GET /vault/folders` (folder picker)** | Full disk + `projects/*` list | Gateway returns **`{ "folders": ["inbox"] }`** only; facets still supply path prefixes from notes |
| **Facets (filter dropdowns)** | Real data from notes | Gateway aggregates from canister note list per **`X-Vault-Id`** ([hub/gateway/note-facets.mjs](../hub/gateway/note-facets.mjs), [hub/gateway/server.mjs](../hub/gateway/server.mjs) `GET /api/v1/notes/facets`) |
| **Multi-vault + vault switcher** | ✅ `hub_vaults.yaml`, access, scope, `X-Vault-Id`; notes isolated per vault | ✅ **In repo:** canister + gateway + bridge respect `vault_id` / `X-Vault-Id` for notes, proposals, export, and bridge index paths. **Production:** confirm ICP canister is redeployed from current `hub/icp` before relying on isolation (see §2). |
| **Delete vault (non-default)** | ✅ `DELETE /api/v1/vaults/:vaultId` — admin; disk path must resolve inside repo root | ✅ **PR #66:** gateway → bridge → canister + bridge access/scope/vectors; workspace-owner rules on hosted — [HUB-API.md](./HUB-API.md) §3.3.2. **Ops:** full stack deploy for production. |
| **Vault access JSON (admin)** | ✅ | ✅ **Bridge** + gateway proxy when `BRIDGE_URL` set — [HOSTED-WORKSPACE-ACCESS.md](./HOSTED-WORKSPACE-ACCESS.md) |
| **Scope JSON (admin)** | ✅ | ✅ Same — gateway enforces scope on list/get note / facets; bridge on index/search/sync |

**Commits (reference):** Phase 15 multi-vault (self-hosted) merged; `b4002be` and related — hosted roles/invites via bridge; gateway proxies search/index/vault/roles/invites when `BRIDGE_URL` is set.

---

## 3. Phase 12 (blockchain / agent payments)

**Status: reserved, not implemented. Separate phase when needed.**

- **Spec:** [SPEC.md](./SPEC.md) §2.4 and [BLOCKCHAIN-AND-AGENT-PAYMENTS.md](./BLOCKCHAIN-AND-AGENT-PAYMENTS.md) reserve optional frontmatter (`network`, `wallet_address`, `tx_hash`, `payment_status`), CLI filters (`--network`, `--wallet`), and optional capture/import for on-chain events. No collision with existing `--chain` (causal_chain_id).
- **Implementation plan:** [IMPLEMENTATION-PLAN.md](./IMPLEMENTATION-PLAN.md) Phase 12 — optional; implement when you want blockchain/wallets/agent payments. No dependency on canister or hosted; core and Hub work without it.

Do Phase 12 in a **separate** session when you’re ready; no need to tie it to hosted or multi-vault.

---

## 4. HTTP and future canister architecture

**Current:** One Motoko canister (`hub/icp`) handles **both** HTTP and storage. It implements `http_request` / `http_request_update` and serves the Hub API (health, notes, proposals). No separate HTTP canister is required for Knowtation today.

**When you might need a separate HTTP canister (e.g. Rust):**

- **Motoko HTTP limits** — IC message size limits apply; very large responses or streaming are easier in Rust. If we hit response-size or streaming needs, a Rust “HTTP front-door” canister that proxies to the Motoko (or other) backend is a known pattern.
- **Multiple backend canisters** — If we later add more canisters (e.g. search on ICP, attestation, identity), a single **Rust HTTP canister** can be the only one exposed to the boundary: it receives HTTP and calls Motoko (or other) canisters via inter-canister. That matches patterns used in other setups (e.g. bornfree-hub’s multi-canister + Netlify).
- **Motoko HTTP issues in your env** — If in another project you had to use a separate canister for HTTP because Motoko didn’t work there, the same pattern is valid here: keep storage/logic in Motoko (or split across canisters) and put **only** HTTP in a Rust (or other) canister that forwards to them.

**Recommendation:** Stay with the **single Motoko canister (HTTP + storage)** for now. It’s already implemented and sufficient for the current API. If we later need larger responses, streaming, or multiple backend canisters, add a **Rust HTTP canister** that proxies to the existing Motoko canister (and any others); no need to re-implement storage in Rust. Document this so future sessions don’t assume we must do HTTP in Motoko forever.

---

## 5. What to do next

| Priority | What |
|----------|------|
| **Keep CI honest** | Run **`npm test`** on every meaningful change (root of repo). |
| **Hosted re-verify (you)** | After any deploy or env change, walk [DEPLOY-HOSTED.md](./DEPLOY-HOSTED.md) §5 + UI smoke: login, create note, search/re-index, Connect GitHub / Back up now if you use them. Optional demo notes: `npm run seed:hosted-showcase` (see [SHOWCASE-VAULT.md](./SHOWCASE-VAULT.md)); legacy C-themed seed: `scripts/seed-hosted-c-data.mjs`. |
| **Hosted multi-vault (canister) — Phase 15.1** | **Repo:** merged (**#46–#48**) + **workspace / vault-access / scope** ([HOSTED-WORKSPACE-ACCESS.md](./HOSTED-WORKSPACE-ACCESS.md)). **Production:** redeploy gateway + bridge + §5.1 if needed. **Hub Import** is **live** when **`BRIDGE_URL`** is set; remaining gaps vs self-hosted — [PARITY-PLAN.md](./PARITY-PLAN.md) §2.1. |
| **Parity gaps** | Track [PARITY-PLAN.md](./PARITY-PLAN.md) and §2.1 (e.g. bulk **path-prefix** on Node vs canister semantics, `GET /vault/folders` stub on gateway). **Import:** not a **501** when bridge is configured. |
| **Phase 15 self-hosted** | ✅ `hub_vaults.yaml`, access, scope, Hub UI. |
| **MCP hosted (Issue #1)** | D2/D3 etc. after stable hosted baseline — [BACKLOG-MCP-SUPERCHARGE.md](./BACKLOG-MCP-SUPERCHARGE.md). |
| **Phase 16 (hosted billing)** | [HOSTED-CREDITS-DESIGN.md](./HOSTED-CREDITS-DESIGN.md) + [HOSTED-STORAGE-BILLING-ROADMAP.md](./HOSTED-STORAGE-BILLING-ROADMAP.md); Stripe subscriptions + **indexing token** quotas + **rollover token** packs — IMPLEMENTATION-PLAN Phase 16 (**gateway cent scaffold** today; bridge token metering **not** done). |
| **Phase 12 (blockchain notes)** | Agent wallets / on-chain fields in notes — [BLOCKCHAIN-AND-AGENT-PAYMENTS.md](./BLOCKCHAIN-AND-AGENT-PAYMENTS.md); separate from Phase 16 ledger. |

See **§4** above for when to consider a separate HTTP canister (Rust) vs keeping HTTP in Motoko.

---

**Last updated:** 2026-03-28 — **PR #66** delete non-default vault: status blurb + §2.1 parity row; ops note (canister + bridge + gateway + static Hub). Prior: **PR #65** metadata bulk Hub client; import live with **`BRIDGE_URL`**.
