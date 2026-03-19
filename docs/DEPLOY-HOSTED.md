# Deploying the hosted product (Phase 5)

This doc covers production deployment: 4Everland for static UI and landing, gateway and bridge (e.g. Netlify or a Node host), and DNS/domains.

**Before deploy:** Ensure [Parity Plan Phase 1](./PARITY-PLAN.md) is merged (gateway stubs for roles, invites, setup) so the Hub Settings → Team and Setup work on hosted.

---

## 1. Architecture (production) — single URL: knowtation.store

- **One domain: knowtation.store** — Deploy the full `web/` folder to 4Everland; set custom domain **knowtation.store**. No separate subdomain for the app.
  - **Landing (main page):** `https://knowtation.store/` → `web/index.html`.
  - **Hub UI:** `https://knowtation.store/hub/` → `web/hub/`. "Open Knowtation Hub" on the landing links to `https://knowtation.store/hub/`.
- **Gateway** — OAuth + proxy to canister. Deploy to Netlify (or same host). Ideally same origin as the site (e.g. `https://knowtation.store` with rewrites so `/api/*` hits the gateway) so CORS and cookies work without extra config.
- **Bridge** — GitHub connect + Back up now + index/search. Same host as gateway or separate; gateway proxies `/api/v1/vault/*`, `/api/v1/search`, `/api/v1/index` to the bridge when `BRIDGE_URL` is set.
- **Canister** — Deployed on ICP (e.g. `dfx deploy --network ic`). Gateway calls canister at `CANISTER_URL` (e.g. `https://<canister-id>.ic0.app`).

---

## 2. 4Everland: one project, one URL (knowtation.store)

1. **Deploy the whole `web/` folder**  
   to a single 4Everland project (root = `web/`). That gives you:
   - `https://knowtation.store/` → landing (`index.html`)
   - `https://knowtation.store/hub/` → Hub UI (`hub/index.html` and assets).
2. **Custom domain**  
   - Point **knowtation.store** to that 4Everland project. No separate subdomain; one URL for the whole site.

3. **Hub API base URL**  
   - So the Hub at `/hub/` can call the gateway: set `window.HUB_API_BASE_URL = 'https://knowtation.store';` (if the gateway is on the same origin) or your Netlify API URL, via a `config.js` loaded before `hub.js` in `web/hub/`, or at deploy time.

4. **Landing CTA**  
   - "Open Knowtation Hub" in `web/index.html` points to `https://knowtation.store/hub/` (same origin).

---

## 3. Gateway + bridge

- **Option A — Same origin (recommended for one URL)**  
  Deploy gateway so it is served from the same origin as the site (e.g. **knowtation.store**). For example: Netlify or 4Everland serves static files from `web/` and rewrites `/api/*` to the gateway. Then `HUB_API_BASE_URL = 'https://knowtation.store'` and all API calls are same-origin.

- **Option B — Separate API host**  
  Gateway on a different host (e.g. Netlify function URL). Set `HUB_API_BASE_URL` to that URL. Configure CORS on the gateway to allow `https://knowtation.store` (set `HUB_CORS_ORIGIN`).

**Gateway env (production):**

- `CANISTER_URL` — e.g. `https://<canister-id>.ic0.app`
- `SESSION_SECRET` or `HUB_JWT_SECRET` — strong secret for JWTs
- `HUB_BASE_URL` — public URL of the gateway (e.g. `https://knowtation.store` if same origin)
- `HUB_UI_ORIGIN` — origin of the Hub UI (e.g. `https://knowtation.store`)
- `BRIDGE_URL` — URL of the bridge if separate (e.g. `https://bridge.knowtation.com`); gateway then proxies vault/sync, search, index to bridge
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` — OAuth (callback URLs must match `HUB_BASE_URL` and bridge callback URL)

**Bridge env (production):**

- `CANISTER_URL`, **`SESSION_SECRET`** (must be the **exact same** value as the gateway — if they differ, the bridge cannot verify the user JWT and Settings will show "GitHub: Not connected" even after a successful Connect GitHub), `HUB_BASE_URL`, `HUB_UI_ORIGIN` — same as gateway logic; bridge callback URL must be on `HUB_BASE_URL` of the bridge (e.g. `https://bridge.knowtation.com/auth/callback/github-connect`)
- `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` — for Connect GitHub (can be same app as gateway or separate)
- `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`, `OLLAMA_URL` or `OPENAI_API_KEY` — for index/search
- `DATA_DIR` — persistent dir for tokens and per-user vector DBs (ensure backup/restore if needed)

---

## 4. DNS

- **knowtation.store** → 4Everland (whole site: landing at `/`, Hub at `/hub/`). Optionally same host for gateway (e.g. rewrites for `/api/*`).
- If gateway or bridge are on separate hosts, point those domains (e.g. Netlify-provided) and set env accordingly.

Exact records depend on 4Everland and your Node host (A/CNAME, or their provided targets).

---

## 5. Pre-roll checklist (hosted)

This checklist is for **hosted** production readiness. It is **not** a new site or new page — you just verify each item below. For the idea that self-hosted users get the same UI/interface as hosted users, see [STATUS-VERIFICATION.md](./STATUS-VERIFICATION.md) §1 (self-hosted pre-roll). For **what pre-roll is**, **bridge deploy in detail** (including second Netlify project), and **PR/branch strategy**, see [BRIDGE-DEPLOY-AND-PREROLL.md](./BRIDGE-DEPLOY-AND-PREROLL.md).

- [ ] Canister deployed and healthy (`GET /health`).
- [ ] Gateway env set; OAuth callback URLs registered with Google/GitHub.
- [ ] Bridge env set; GitHub OAuth callback for Connect GitHub registered.
- [ ] Hub UI deployed with correct `HUB_API_BASE_URL`.
- [ ] Landing deployed; "Open Knowtation Hub" points to Hub URL.
- [ ] No secrets or credentials in repo or client bundle.

---

## 6. Reference

- [CANISTER-AND-SINGLE-URL.md](./CANISTER-AND-SINGLE-URL.md) — How to run the canister; single URL (knowtation.store) and how to view the site locally.
- [CANISTER-AUTH-CONTRACT.md](./CANISTER-AUTH-CONTRACT.md)
- [hub/gateway/README.md](../hub/gateway/README.md)
- [hub/bridge/README.md](../hub/bridge/README.md)
- [hub/icp/README.md](../hub/icp/README.md)
