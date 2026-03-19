# Status: hosted product, multi-vault, Phase 12

Short reference for where we are on **canister/hosted**, **two-path launch**, **multi-vault**, and **Phase 12 (blockchain)** so you can pick up in another session.

**Two-path launch (Phase 14) done.** Landing and Hub offer "Use in the cloud (beta)" and "Run it yourself" (Quick start in [TWO-PATHS-HOSTED-AND-SELF-HOSTED.md](./TWO-PATHS-HOSTED-AND-SELF-HOSTED.md)). Hosting = **beta, free** until Phase 16 (credits).

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

**Remaining (redeploys and bridge — bridge is required, not optional):**

- **Canister redeploy:** The merged parity branch added **Option B** canister changes (`base_state_id`, `external_ref` on proposals). To have those live, run `cd hub/icp && dfx deploy --network ic`. Same canister ID; this is a **redeploy** with new code, not a first-time deploy.
- **Netlify rebuild:** So the **gateway** runs the merged code (Phase 1 stubs: roles, invites, setup, import, facets). If Netlify builds from main, trigger a deploy so the latest gateway code is live.
- **4Everland rebuild:** So the Hub at knowtation.store serves the latest `web/` (e.g. Muse in How to use). Trigger a build if it does not auto-deploy from main.
- **Bridge (required):** Connect GitHub, Back up now, and search on hosted **require** the bridge. Deploy `hub/bridge/` somewhere, set its env, and set **BRIDGE_URL** in the gateway’s Netlify env.

**Docs:** [DEPLOY-HOSTED.md](./DEPLOY-HOSTED.md), [CANISTER-AND-SINGLE-URL.md](./CANISTER-AND-SINGLE-URL.md), [CANISTER-AUTH-CONTRACT.md](./CANISTER-AUTH-CONTRACT.md), [ICP-GITHUB-BRIDGE.md](./ICP-GITHUB-BRIDGE.md), [hub/gateway/README.md](../hub/gateway/README.md), [hub/bridge/README.md](../hub/bridge/README.md).

---

## 2. Multi-vault (split vault)

**Status: not implemented.** *Split vault* = same feature (personal vs shared, or multiple vaults in one Hub).

- **Current behavior:** One Hub instance = one vault (`vault_path`). Roles (viewer/editor/admin) control **actions**, not **which notes** are visible. Everyone with access sees the same vault.
- **Design doc:** [MULTI-VAULT-AND-SCOPED-ACCESS.md](./MULTI-VAULT-AND-SCOPED-ACCESS.md) — options (multiple vaults per instance, scoped visibility), what would be needed, and how to use two vaults today (two Hub instances).
- **API:** `vault_id` (and optional `X-Vault-Id` / `vault_id` query) exist in the Node Hub and in the canister auth contract for **future** multi-vault; no UI or backend logic yet to switch or scope by vault.
- **Next:** **Phase 15** in [IMPLEMENTATION-PLAN.md](./IMPLEMENTATION-PLAN.md) — implement per the design in MULTI-VAULT-AND-SCOPED-ACCESS.md (vault list or scoped visibility, backend + Hub UI).

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
| **Hosted live** | Canister, 4Everland, Netlify gateway, DNS are deployed; pre-roll is not confirmed (see [STATUS-VERIFICATION.md](./STATUS-VERIFICATION.md)). Next: **canister redeploy** (Option B fields), **Netlify + 4Everland rebuild** (merged parity code). **bridge deploy and wire** (required for Connect GitHub + Back up now + search). Do not start multi-vault until Phase 2 including bridge is complete. See §1 and STATUS-VERIFICATION “Remaining” for full list. |
| **Phase 15 (multi-vault)** | When needed: implement per [MULTI-VAULT-AND-SCOPED-ACCESS.md](./MULTI-VAULT-AND-SCOPED-ACCESS.md); see Phase 15 in [IMPLEMENTATION-PLAN.md](./IMPLEMENTATION-PLAN.md). |
| **Phase 16 (hosted credits)** | When ready to monetize: balance model, deduction rules, purchase flow, Hub UI; see Phase 16 in IMPLEMENTATION-PLAN. |
| **Phase 12 (blockchain)** | When needed: implement reserved frontmatter, CLI filters, capture/import; see [BLOCKCHAIN-AND-AGENT-PAYMENTS.md](./BLOCKCHAIN-AND-AGENT-PAYMENTS.md). |

See **§4** above for when to consider a separate HTTP canister (Rust) vs keeping HTTP in Motoko.

---

**Last updated:** Phase 14 (two-path launch) done; IMPLEMENTATION-PLAN includes Phases 14, 15 (multi-vault), 16 (hosted credits). Hosting = beta, free until Phase 16.
