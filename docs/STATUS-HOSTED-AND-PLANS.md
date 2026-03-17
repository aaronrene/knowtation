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

**Not done yet (deploy and URLs):**

- **Canister:** Run `dfx deploy` (local or `--network ic`) and set `CANISTER_URL` in gateway/bridge. See [CANISTER-AND-SINGLE-URL.md](./CANISTER-AND-SINGLE-URL.md) and [hub/icp/README.md](../hub/icp/README.md).
- **4Everland:** Deploy full `web/` to one project; set custom domain **knowtation.store** (landing at `/`, Hub at `/hub/`). See [DEPLOY-HOSTED.md](./DEPLOY-HOSTED.md).
- **Gateway + bridge:** Deploy to Netlify (or Node host); set env (OAuth, `CANISTER_URL`, `BRIDGE_URL`, `SESSION_SECRET`, etc.). Gateway proxies `/api/*` to canister and (when `BRIDGE_URL` set) to bridge for vault/sync, search, index.
- **Hub UI API base:** When live, set `window.HUB_API_BASE_URL` (e.g. `https://knowtation.store`) in `web/hub/` so the Hub at `/hub/` talks to your gateway.

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
| **Hosted live** | Deploy canister (`dfx deploy`), gateway + bridge (Netlify), web/ to 4Everland, point knowtation.store, set `HUB_API_BASE_URL`. Use [DEPLOY-HOSTED.md](./DEPLOY-HOSTED.md) and [CANISTER-AND-SINGLE-URL.md](./CANISTER-AND-SINGLE-URL.md). Hosting is **beta, free** until Phase 16 (credits). |
| **Phase 15 (multi-vault)** | When needed: implement per [MULTI-VAULT-AND-SCOPED-ACCESS.md](./MULTI-VAULT-AND-SCOPED-ACCESS.md); see Phase 15 in [IMPLEMENTATION-PLAN.md](./IMPLEMENTATION-PLAN.md). |
| **Phase 16 (hosted credits)** | When ready to monetize: balance model, deduction rules, purchase flow, Hub UI; see Phase 16 in IMPLEMENTATION-PLAN. |
| **Phase 12 (blockchain)** | When needed: implement reserved frontmatter, CLI filters, capture/import; see [BLOCKCHAIN-AND-AGENT-PAYMENTS.md](./BLOCKCHAIN-AND-AGENT-PAYMENTS.md). |

See **§4** above for when to consider a separate HTTP canister (Rust) vs keeping HTTP in Motoko.

---

**Last updated:** Phase 14 (two-path launch) done; IMPLEMENTATION-PLAN includes Phases 14, 15 (multi-vault), 16 (hosted credits). Hosting = beta, free until Phase 16.
