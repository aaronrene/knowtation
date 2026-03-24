# Deploying the hosted product (Phase 5)

This doc covers production deployment: 4Everland for static UI and landing, gateway and bridge (e.g. Netlify or a Node host), and DNS/domains.

**Already live (knowtation.store)?** The stack is **in production** — see [STATUS-HOSTED-AND-PLANS.md](./STATUS-HOSTED-AND-PLANS.md) for current truth and gaps. Use this file as **reference** when changing hosts or env, and use **§5** below as a **re-verification** checklist after deploys (not as proof the site was never shipped).

**Before first-time deploy:** Ensure [Parity Plan Phase 1](./PARITY-PLAN.md) is merged (gateway stubs for roles, invites, setup) so the Hub Settings → Team and Setup work on hosted.

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

**Netlify catch-all → function URL must preserve the path.** The build runs `scripts/netlify-redirects.mjs`, which writes `public/_redirects` (that file is gitignored—each deploy generates it). The gateway line must be `/* /.netlify/functions/gateway/:splat 200` (not `.../gateway 200` without `:splat`). Without `:splat`, every browser request is rewritten to the function root, `proxyToCanister` calls the canister with the wrong path, and the canister returns JSON `{"error":"Not found","code":"NOT_FOUND"}` (404) for `/api/v1/notes` and note creation.

**Monorepo / two Netlify sites:** Do **not** add a catch-all `[[redirects]]` in the **root** `netlify.toml`. Netlify merges root file-based config into **every** site linked to the repository, which would send the **bridge** deploy to the gateway function. Catch-all routing for the gateway site comes **only** from generated `public/_redirects` with `USE_BRIDGE_FUNCTION` **unset**. The **bridge** site uses [deploy/bridge/netlify.toml](../deploy/bridge/netlify.toml) (set **Package directory** to `deploy/bridge`, **Base directory** empty): that file sets `[build.environment] USE_BRIDGE_FUNCTION=true` so the same script writes the bridge line, and it keeps a site-local `[[redirects]]` to `/.netlify/functions/bridge/:splat`. In `deploy/bridge/netlify.toml`, `functions` and `publish` are relative to the **repository root** (Netlify’s default base directory), not to the `deploy/bridge` folder.

The gateway strips `/.netlify/functions/gateway` from `req.url` when present so Express still matches `/api/v1/*` routes.

- **Option A — Same origin (recommended for one URL)**  
  Deploy gateway so it is served from the same origin as the site (e.g. **knowtation.store**). For example: Netlify or 4Everland serves static files from `web/` and rewrites `/api/*` to the gateway. Then `HUB_API_BASE_URL = 'https://knowtation.store'` and all API calls are same-origin.

- **Option B — Separate API host**  
  Gateway on a different host (e.g. Netlify function URL). Set `HUB_API_BASE_URL` to that URL. Configure CORS on the gateway: **`HUB_CORS_ORIGIN`** must include **both** `https://knowtation.store` and `https://www.knowtation.store` if users can open either (see [CORS-WWW-AND-APEX.md](./CORS-WWW-AND-APEX.md)).

**Gateway env (production):**

- `CANISTER_URL` — e.g. `https://<canister-id>.ic0.app`
- `SESSION_SECRET` or `HUB_JWT_SECRET` — strong secret for JWTs
- `HUB_BASE_URL` — public URL of the gateway (e.g. `https://knowtation.store` if same origin)
- `HUB_UI_ORIGIN` — origin of the Hub UI (e.g. `https://knowtation.store`)
- `BRIDGE_URL` — URL of the bridge if separate (e.g. `https://bridge.knowtation.com`); gateway then proxies vault/sync, search, index to bridge
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` — OAuth (callback URLs must match `HUB_BASE_URL` and bridge callback URL)
- `HUB_ADMIN_USER_IDS` (optional) — Comma-separated user IDs (e.g. `google:123,github:456`) who get role **admin** on hosted; everyone else gets **member**. Enables Edit and Team tab for designated admins. See [hub/gateway/README.md](../hub/gateway/README.md).

**Bridge env (production):**

- `CANISTER_URL`, **`SESSION_SECRET`** (must be the **exact same** value as the gateway — if they differ, the bridge cannot verify the user JWT and Settings will show "GitHub: Not connected" even after a successful Connect GitHub), `HUB_BASE_URL`, `HUB_UI_ORIGIN` — same as gateway logic; bridge callback URL must be on `HUB_BASE_URL` of the bridge (e.g. `https://bridge.knowtation.com/auth/callback/github-connect`)
- `HUB_ADMIN_USER_IDS` (optional) — Same comma-separated list as the gateway so bridge role store and Settings role stay in sync. Required for full Team and invite links on hosted. See [hub/bridge/README.md](../hub/bridge/README.md).
- `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` — for Connect GitHub (can be same app as gateway or separate)
- `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`, `OLLAMA_URL` or `OPENAI_API_KEY` — for index/search (see **Bridge: semantic index/search** below)
- `DATA_DIR` — persistent dir for tokens and per-user vector DBs (ensure backup/restore if needed)

### Bridge: semantic index/search (Netlify / serverless)

Hub **Re-index** and **Search** call the gateway, which proxies to the **bridge**. Embeddings and **sqlite-vec** run **inside the bridge** function. Failures may show **`Index failed: …`** or **`Search failed: …`**; a bare **Invalid URL** may be **sqlite-vec** native load on Netlify (see troubleshooting below) or a malformed **`OLLAMA_URL`** when using Ollama.

**Recommended on Netlify:** set on the **bridge** site (not only the gateway):

- `EMBEDDING_PROVIDER=openai`
- `OPENAI_API_KEY` — your secret
- `EMBEDDING_MODEL=text-embedding-3-small` (or another OpenAI embeddings model)

**Ollama instead:** `OLLAMA_URL` must be a full absolute URL including scheme, reachable from the public internet (e.g. `https://embeddings.example.com:11434`). It must **not** be `http://localhost:11434` on Netlify (the function cannot reach your laptop). **`https://ollama.com`** is the marketing site, not the Ollama HTTP API.

**Operator checklist (bridge site env):**

1. `CANISTER_URL` — same working canister base URL as the gateway (e.g. raw `icp0.io` if that is what you use in production).
2. `SESSION_SECRET` — **exact match** with the gateway (JWT verification).
3. Embeddings: **OpenAI** vars above **or** a valid public **`OLLAMA_URL`** with `http://` or `https://`.
4. Redeploy the bridge, then in the Hub run **Re-index** once, then **Search**.

#### Troubleshooting: "Index failed: Invalid URL" or "Search failed: Invalid URL"

**1. sqlite-vec on Netlify (common with OpenAI configured):** If function logs show **`getLoadablePath`**, **`sqlite-vec`**, or **`input: '.'`**, the bridge bundle broke **`import.meta.url`** inside `sqlite-vec`. The repo root **`netlify.toml`** and **`deploy/bridge/netlify.toml`** declare **`[functions].external_node_modules`** for **`sqlite-vec`**, **`better-sqlite3`**, and **`sqlite-vec-*`** platform packages so native files load from real `node_modules`. Redeploy the **bridge** site after pulling that config.

**2. Ollama URL shape:** When `EMBEDDING_PROVIDER=ollama`, a bad **`OLLAMA_URL`** (host without `https://`, whitespace-only) can also surface as Invalid URL. Fix env as above.

If it still fails, open **Netlify → bridge site → Functions → logs**, trigger **Re-index** once, and capture **`Bridge index error`** (full stack).

---

## 4. DNS

- **knowtation.store** → 4Everland (whole site: landing at `/`, Hub at `/hub/`). Optionally same host for gateway (e.g. rewrites for `/api/*`).
- If gateway or bridge are on separate hosts, point those domains (e.g. Netlify-provided) and set env accordingly.

Exact records depend on 4Everland and your Node host (A/CNAME, or their provided targets).

---

## 5. Pre-roll checklist (hosted)

Use this list **before first launch** and **again after** any production env change, bridge/gateway redeploy, or incident. For “what pre-roll is” and **bridge deploy in detail**, see [BRIDGE-DEPLOY-AND-PREROLL.md](./BRIDGE-DEPLOY-AND-PREROLL.md). **Live status and parity gaps:** [STATUS-HOSTED-AND-PLANS.md](./STATUS-HOSTED-AND-PLANS.md). For self-hosted mirror checks, see [STATUS-VERIFICATION.md](./STATUS-VERIFICATION.md) §1 where applicable.

- [ ] Canister deployed and healthy (`GET /health`).
- [ ] Gateway env set; OAuth callback URLs registered with Google/GitHub.
- [ ] Bridge env set; GitHub OAuth callback for Connect GitHub registered.
- [ ] Bridge: **`EMBEDDING_PROVIDER=openai`** + **`OPENAI_API_KEY`** (and model), **or** a reachable **`OLLAMA_URL`** with a full `http://` / `https://` base (not localhost on Netlify).
- [ ] Hub (logged in): **Re-index** completes, then **meaning-search** (green Search) returns results; Network tab shows **no** `ERR_CONTENT_DECODING_FAILED` on `/api/v1/index` or `/api/v1/search` (gateway must strip upstream **Content-Encoding** when proxying decoded bodies — see repo `hub/gateway/upstream-response-headers.mjs`).
- [ ] Hub UI deployed with correct `HUB_API_BASE_URL`.
- [ ] Landing deployed; "Open Knowtation Hub" points to Hub URL.
- [ ] No secrets or credentials in repo or client bundle.

---

## 6. Reference

- [HOSTED-HUB-VERIFY.md](./HOSTED-HUB-VERIFY.md) — Verify static Hub bundle, gateway facets, canister frontmatter (scripts + apex `www` caveat).
- [HOSTED-STORAGE-BILLING-ROADMAP.md](./HOSTED-STORAGE-BILLING-ROADMAP.md) — Single Motoko migration plan: multi-vault + reserved billing fields (Phase 16).
- [HOSTED-CREDITS-DESIGN.md](./HOSTED-CREDITS-DESIGN.md) — **Free** tier + Stripe paid tiers, transparent per-action pricing, **`BILLING_SHADOW_LOG`**, rollover add-ons.
- [CANISTER-AND-SINGLE-URL.md](./CANISTER-AND-SINGLE-URL.md) — How to run the canister; single URL (knowtation.store) and how to view the site locally.
- [CANISTER-AUTH-CONTRACT.md](./CANISTER-AUTH-CONTRACT.md)
- [hub/gateway/README.md](../hub/gateway/README.md)
- [hub/bridge/README.md](../hub/bridge/README.md)
- [hub/icp/README.md](../hub/icp/README.md)
