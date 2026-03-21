# Exact state — Phase 2 (hosted) — verified, no assumptions

This document records **only what was verified** from the repo and from live checks (curl smoke, file paths). For narrative status, gaps, and “what to build next,” use **[STATUS-HOSTED-AND-PLANS.md](./STATUS-HOSTED-AND-PLANS.md)**.

**Domain:** knowtation.store (landing + Hub). Config and docs use this throughout.

---

## 1. Repo configuration (verified from code)

| Item | Value / location |
|------|-------------------|
| **Canister ID** | `rsovz-byaaa-aaaaa-qgira-cai` — from [hub/icp/canister_ids.json](../hub/icp/canister_ids.json). |
| **Hub API base URL (hosted)** | When host is `knowtation.store` or `www.knowtation.store`, [web/hub/config.js](../web/hub/config.js) sets `window.HUB_API_BASE_URL = 'https://knowtation-gateway.netlify.app'`. |
| **Netlify deploy** | [netlify.toml](../netlify.toml): builds `hub/gateway`, publish dir `public`; all routes go to `/.netlify/functions/gateway`. Static site (web/) is **not** built by Netlify — that is 4Everland. |
| **Gateway entry** | [netlify/functions/gateway.mjs](../netlify/functions/gateway.mjs) imports and wraps `hub/gateway/server.mjs` with serverless-http. |
| **Gateway env (required)** | `CANISTER_URL`, `SESSION_SECRET` (or `HUB_JWT_SECRET`) — [hub/gateway/server.mjs](../hub/gateway/server.mjs) exits with error if missing. |
| **Gateway env (optional)** | `BRIDGE_URL`, `HUB_BASE_URL`, `HUB_UI_ORIGIN`, `HUB_CORS_ORIGIN`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GATEWAY_PORT`, `HUB_JWT_EXPIRY`. |
| **Bridge** | Not in netlify.toml. [hub/bridge/](../hub/bridge/) is a separate Node app; gateway proxies to it only when `BRIDGE_URL` is set. Bridge requires its own deploy and env (see [hub/bridge/README.md](../hub/bridge/README.md)). |

---

## 2. Live checks

**Latest automated run: 2026-03-21** (from development environment; re-run `curl` yourself before relying on stale results).

| Check | Result | Notes |
|-------|--------|--------|
| **Canister health (ic0.app)** | HTTP **400** (historical) | `ic0.app` without certification can return 400; prefer **raw** URL for `CANISTER_URL`. |
| **Canister health (raw.icp0.io)** | HTTP **200** | `curl -s -o /dev/null -w "%{http_code}" "https://rsovz-byaaa-aaaaa-qgira-cai.raw.icp0.io/health"` → **200** (2026-03-21). |
| **Gateway health** | HTTP **200** | `curl -s -o /dev/null -w "%{http_code}" "https://knowtation-gateway.netlify.app/health"` → **200** (2026-03-21). |
| **Hub path (knowtation.store)** | HTTP **301** | `curl -s -o /dev/null -w "%{http_code}" "https://knowtation.store/hub/"` → **301** (2026-03-21); redirect chain expected. |

**Not verified from curl alone:** Netlify env (`CANISTER_URL`, **`BRIDGE_URL`**, OAuth secrets), bridge deploy URL, Connect GitHub / search / backup in the UI — use §3 checklist and operator testing. **Operator:** bridge + notes reported working in production when `BRIDGE_URL` is set.

---

## 3. Phase 2 completion checklist (from DEPLOY-HOSTED §5 + PARITY-PLAN)

Use this for **first launch** or **re-verification** after deploy/env changes. Tick only after **you** have verified.

### 3.1 Canister

- [ ] Canister deployed and healthy. **Verified from here:** health returns 200 on `https://rsovz-byaaa-aaaaa-qgira-cai.raw.icp0.io/health`. If gateway proxies fail, confirm Netlify **CANISTER_URL** uses this raw URL (not ic0.app, which returned 400).
- [ ] Optional: redeploy for Option B fields: `cd hub/icp && dfx deploy --network ic`.

### 3.2 Gateway (Netlify)

- [ ] Gateway env set: **CANISTER_URL** (use raw.icp0.io if ic0.app returns 400), **SESSION_SECRET**, **HUB_BASE_URL**, **HUB_UI_ORIGIN**, **HUB_CORS_ORIGIN** = `https://knowtation.store,https://www.knowtation.store`, OAuth (Google/GitHub) client ID/secret.
- [ ] OAuth callback URLs registered with Google/GitHub for the gateway URL (e.g. `https://knowtation-gateway.netlify.app/auth/callback/google`).
- [ ] Netlify rebuild done so latest gateway code (Phase 1 stubs) is live.

### 3.3 Bridge (required for Connect GitHub, Back up now, search)

- [ ] Bridge deployed (separate host: e.g. second Netlify project, or Railway, or Node server). Bridge is **not** in this repo’s netlify.toml.
- [ ] Bridge env set: CANISTER_URL, SESSION_SECRET, HUB_BASE_URL (bridge’s own URL), GITHUB_CLIENT_ID/SECRET (for Connect GitHub), EMBEDDING_* or OLLAMA_URL, DATA_DIR.
- [ ] **BRIDGE_URL** set in **gateway’s** Netlify env to the bridge’s public URL.
- [ ] GitHub OAuth callback for Connect GitHub registered for the **bridge** callback URL.
- [ ] Verified: Connect GitHub, Back up now, and search work from Hub at knowtation.store/hub/.

### 3.4 Web (4Everland)

- [ ] Full `web/` deployed at knowtation.store (landing `/`, Hub `/hub/`).
- [ ] Custom domain knowtation.store set and verified in 4Everland.
- [ ] `web/hub/config.js` has `HUB_API_BASE_URL = 'https://knowtation-gateway.netlify.app'` when host is knowtation.store (already in repo).
- [ ] 4Everland rebuild done so latest web/ (Muse in How to use, TWO-PATHS link, etc.) is served.

### 3.5 DNS

- [ ] knowtation.store points to 4Everland (CNAME or A as per 4Everland/Cloudflare setup).

### 3.6 Pre-roll (hosted)

- [ ] All items in [DEPLOY-HOSTED.md](./DEPLOY-HOSTED.md) §5 checked: canister healthy, gateway env, **bridge env**, Hub UI URL, landing, no secrets in repo/client.

---

## 4. What is not in scope for “Phase 2 ops” (note for later)

- **Hosted multi-vault (Phase 15.1):** Canister must partition by `vault_id` — see [MULTI-VAULT-AND-SCOPED-ACCESS.md](./MULTI-VAULT-AND-SCOPED-ACCESS.md). Hub vault switcher alone does not isolate notes on the canister today.
- **MCP supercharge (Issues #1, #2):** [BACKLOG-MCP-SUPERCHARGE.md](./BACKLOG-MCP-SUPERCHARGE.md).
- **Self-hosted runtime verification:** `npm run hub` quick start; optional separate doc pass.
- **Import on hosted:** Gateway may return **501**; see [PARITY-PLAN.md](./PARITY-PLAN.md).
- **Roles/invites on hosted:** **Bridge persistence** when **`BRIDGE_URL`** is set ([HOSTED-ROLES-VIA-BRIDGE.md](./HOSTED-ROLES-VIA-BRIDGE.md)); gateway stubs if bridge absent.

---

## 5. Reference

- [DEPLOY-HOSTED.md](./DEPLOY-HOSTED.md) — architecture, env, pre-roll.
- [DEPLOY-STEPS-ONE-PAGE.md](./DEPLOY-STEPS-ONE-PAGE.md) — step-by-step deploy.
- [STATUS-VERIFICATION.md](./STATUS-VERIFICATION.md) — pre-roll definitions, next steps.
- [PARITY-PLAN.md](./PARITY-PLAN.md) — Phase 2 vs Phase 3, bridge required.
