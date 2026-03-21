# Status: hosted product, multi-vault, Phase 12

Short reference for where we are on **canister/hosted**, **two-path launch**, **multi-vault**, and **Phase 12 (blockchain)** so you can pick up in another session.

**Two-path launch (Phase 14) done.** Landing and Hub offer "Use in the cloud (beta)" and "Run it yourself" (Quick start in [TWO-PATHS-HOSTED-AND-SELF-HOSTED.md](./TWO-PATHS-HOSTED-AND-SELF-HOSTED.md)). Hosting = **beta, free** until Phase 16 (credits).

**Priority vs MCP backlog:** **Hosted parity** (this doc, [PARITY-PLAN.md](./PARITY-PLAN.md), bridge + env + verification) comes **before** **Hub MCP gateway (Issue #1 D2/D3)**. MCP features already merged for local use are fine to land on `main` first. Order and plain-language rationale: [BACKLOG-MCP-SUPERCHARGE.md](./BACKLOG-MCP-SUPERCHARGE.md) § Strategic sequencing.

---

## 1. Canister and web hosting (hosted product)

**Plan:** The phased canister-based hosted plan (Phase 0 → 5) is implemented in code and docs. Branch strategy: Phase 0 on main; Phases 1–5 were developed on a feature branch and merged.

| Phase | What | Status |
|-------|------|--------|
| **0** | Prep: `vault_id` in API, canister auth contract doc, Hub UI API base URL config | ✅ Done (main) |
| **1** | Canister: vault + proposals API (Motoko), `dfx` deploy, CORS, GET /export | ✅ Done — `hub/icp/` |
| **2** | Gateway: OAuth (Google/GitHub), JWT, proxy to canister with X-User-Id | ✅ Done — `hub/gateway/` |
| **3** | Bridge: Connect GitHub, store token, Back up now (canister → GitHub) | ✅ Done — `hub/bridge/` |
| **4** | Bridge: indexer + search (per-user sqlite-vec) | ✅ Done — bridge POST /api/v1/index, /api/v1/search |
| **5** | 4Everland + single URL (knowtation.store), deploy docs, landing CTA | ✅ Done — docs, web/ updated |

**Current deployed state (verified from repo and live checks; see [EXACT-STATE-PHASE2.md](./EXACT-STATE-PHASE2.md) for details):**

- **Canister:** Deployed on ICP. Gateway uses `CANISTER_URL` (set in Netlify env).
- **4Everland:** Deployed. Full `web/` at **knowtation.store** (landing `/`, Hub `/hub/`). Custom domain set.
- **Netlify:** Gateway deployed (e.g. **knowtation-gateway.netlify.app**). `web/hub/config.js` sets `HUB_API_BASE_URL = 'https://knowtation-gateway.netlify.app'` when host is knowtation.store. Env (CANISTER_URL, SESSION_SECRET, OAuth, HUB_BASE_URL, HUB_UI_ORIGIN, etc.) is set.
- **DNS:** knowtation.store points to 4Everland (and gateway has its own Netlify URL).
- **Pre-roll:** **Not verified.** Pre-roll is the hosted checklist in [DEPLOY-HOSTED.md](./DEPLOY-HOSTED.md) §5; it includes **bridge env**. Do not assume done. See [STATUS-VERIFICATION.md](./STATUS-VERIFICATION.md).

**What the bridge is:** The **bridge** is a **separate** Node app in `hub/bridge/`. It is **not** part of the Netlify gateway deploy (netlify.toml only builds the gateway). The bridge provides: Connect GitHub, Back up now (vault → GitHub), and index + search (per-user vector DB). The **gateway** proxies requests to the bridge only when **BRIDGE_URL** is set in the gateway’s env. If BRIDGE_URL is not set: Connect GitHub, Back up now, and search/index are **not available** on hosted (the gateway does not implement them; it only proxies to canister or to bridge). **“Set ENV” for bridge** means: if you deploy the bridge (e.g. separate Netlify project, or Railway, or same host as gateway), you set that service’s env (CANISTER_URL, SESSION_SECRET, GITHUB_*, EMBEDDING_*, DATA_DIR, etc.) and you set **BRIDGE_URL** in the **gateway’s** Netlify env to the bridge’s public URL. If you do not need GitHub backup or search on hosted, you can leave the bridge undeployed and BRIDGE_URL unset.

**When both Netlify sites are configured (gateway + bridge + `BRIDGE_URL`):** Index/search, Connect GitHub, and **Team (roles/invites)** use the bridge — see parity table below. Embedding must be a **real** API (e.g. `EMBEDDING_PROVIDER=openai` + `OPENAI_API_KEY` on the bridge); `OLLAMA_URL=https://ollama.com` is **not** a valid Ollama API endpoint.

**Remaining (redeploys and bridge — bridge is required, not optional):**

- **Canister redeploy:** The merged parity branch added **Option B** canister changes (`base_state_id`, `external_ref` on proposals). To have those live, run `cd hub/icp && dfx deploy --network ic`. Same canister ID; this is a **redeploy** with new code, not a first-time deploy.
- **Netlify rebuild:** So the **gateway** runs the merged code (Phase 1 stubs: roles, invites, setup, import, facets). If Netlify builds from main, trigger a deploy so the latest gateway code is live.
- **4Everland rebuild:** So the Hub at knowtation.store serves the latest `web/` (e.g. Muse in How to use). Trigger a build if it does not auto-deploy from main.
- **Bridge (required):** Connect GitHub, Back up now, and search on hosted **require** the bridge. Deploy `hub/bridge/` somewhere, set its env, and set **BRIDGE_URL** in the gateway’s Netlify env.

**Docs:** [DEPLOY-HOSTED.md](./DEPLOY-HOSTED.md), [CANISTER-AND-SINGLE-URL.md](./CANISTER-AND-SINGLE-URL.md), [CANISTER-AUTH-CONTRACT.md](./CANISTER-AUTH-CONTRACT.md), [ICP-GITHUB-BRIDGE.md](./ICP-GITHUB-BRIDGE.md), [hub/gateway/README.md](../hub/gateway/README.md), [hub/bridge/README.md](../hub/bridge/README.md).

---

## 2. Multi-vault (split vault)

**Self-hosted (Node Hub): implemented (Phase 15).** `data/hub_vaults.yaml`, `hub_vault_access.json`, optional `hub_scope.json`; vault switcher in the Hub header; `X-Vault-Id` on API calls; bridge supports `(user, vault_id)` for index/search when deployed. See [IMPLEMENTATION-PLAN.md](./IMPLEMENTATION-PLAN.md) Phase 15 and [MULTI-VAULT-AND-SCOPED-ACCESS.md](./MULTI-VAULT-AND-SCOPED-ACCESS.md).

**Hosted (canister):** Still **one logical vault per user** in storage today; multi-vault in the canister is follow-up when you want parity with self-hosted switching on knowtation.store.

---

## 2.1 Parity snapshot (self-hosted vs hosted)

| Area | Self-hosted (Node Hub) | Hosted (gateway + canister + bridge) |
|------|------------------------|--------------------------------------|
| **Notes, proposals, export** | Local vault folder | Canister |
| **OAuth + JWT** | Your `.env` OAuth apps | Gateway OAuth |
| **Semantic search + Re-index** | Local Ollama/OpenAI + `data/knowtation_vectors.db` (sqlite-vec) or Qdrant | Bridge: embeddings + per-user vectors (e.g. Netlify Blobs). Gateway proxies when `BRIDGE_URL` set |
| **Connect GitHub / Back up now** | Local vault git | Bridge |
| **Team: roles + invites** | `data/hub_roles.json`, invites on disk | **Bridge persistence** when `BRIDGE_URL` set; gateway proxies roles/invites to bridge ([HOSTED-ROLES-VIA-BRIDGE.md](./HOSTED-ROLES-VIA-BRIDGE.md), PARITY-PLAN Phase 4 ✅). Without bridge: stubs only |
| **Settings → Setup / POST setup** | Writes `hub_setup.yaml` | Gateway stub (no-op); vault is canister |
| **Import (Hub upload)** | Works | 501 stub on gateway (not yet on hosted) |
| **Facets (filter dropdowns)** | Real data from notes | Gateway stub returns empty unless extended to aggregate from canister |
| **Multi-vault + vault switcher** | ✅ `hub_vaults.yaml`, access, scope, `X-Vault-Id` | ❌ Single vault per user in canister; UI may show switcher only after canister + gateway support multiple vaults |
| **Vault access JSON (admin)** | ✅ | N/A on hosted (no `hub_vault_access.json` on canister path today) |

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
| **Hosted live** | Canister, 4Everland, Netlify gateway, DNS deployed. **Bridge:** deploy `knowtation-bridge`, set `BRIDGE_URL` on gateway, fix embedding env (OpenAI or reachable Ollama API — not `https://ollama.com`). Pre-roll: [STATUS-VERIFICATION.md](./STATUS-VERIFICATION.md), [DEPLOY-HOSTED.md](./DEPLOY-HOSTED.md) §5. |
| **Hosted multi-vault (canister)** | **Not done.** Self-hosted Phase 15 is complete; hosted needs canister (and gateway) changes to store and route by `vault_id`. See PARITY-PLAN Phase 3 and §2.1 table above. |
| **Phase 15 (multi-vault) self-hosted** | ✅ Done in repo — `hub_vaults.yaml`, access, scope, Hub UI. |
| **Phase 16 (hosted credits)** | When ready to monetize: balance model, deduction rules, purchase flow, Hub UI; see Phase 16 in IMPLEMENTATION-PLAN. |
| **Phase 12 (blockchain)** | When needed: implement reserved frontmatter, CLI filters, capture/import; see [BLOCKCHAIN-AND-AGENT-PAYMENTS.md](./BLOCKCHAIN-AND-AGENT-PAYMENTS.md). |

See **§4** above for when to consider a separate HTTP canister (Rust) vs keeping HTTP in Motoko.

---

**Last updated:** 2026-03-20 — Added §2.1 parity snapshot; clarified Phase 15 self-hosted ✅ vs hosted multi-vault ❌; bridge operational notes (embedding URL). Phase 14 (two-path) done; hosting = beta until Phase 16.
