# Knowtation Hub Gateway

OAuth (Google/GitHub) + proxy for the **hosted** product. Users log in here; the gateway proxies all `/api/v1/*` requests to the ICP canister with an **X-User-Id** header (proof the canister trusts). See [docs/CANISTER-AUTH-CONTRACT.md](../../docs/CANISTER-AUTH-CONTRACT.md).

## Routes

- **GET /health**, **GET /api/v1/health** — Health (no auth).
- **GET /api/v1/auth/providers** — Which OAuth providers are configured (no auth).
- **GET /auth/login?provider=google|github** — Redirect to OAuth (plan routes).
- **GET /api/v1/auth/login?provider=...** — Redirects to `/auth/login` for Hub UI compatibility.
- **GET /auth/callback/google**, **GET /auth/callback/github** — OAuth callbacks; on success redirect to `HUB_UI_ORIGIN/?token=<jwt>`.
- **GET /api/v1/billing/summary** — JWT. Hosted billing pools (tier, monthly/add-on cents). See [HOSTED-CREDITS-DESIGN.md](../../docs/HOSTED-CREDITS-DESIGN.md).
- **POST /api/v1/billing/webhook** — Stripe webhook (**raw JSON body**). No JWT.
- **GET /api/v1/notes/facets** — JWT + **X-Vault-Id**. Aggregates `projects`, `tags`, and `folders` from the canister note list (`hub/gateway/note-facets.mjs`); not proxied as a literal canister path.
- **GET/POST /api/v1/*** (other) — Proxied to canister with **X-User-Id** from JWT. Returns 401 if no valid token. When **BILLING_ENFORCE** is on, some routes may return **402** (quota).

## Canister proxy URL (important)

The canister proxy runs under **`app.use('/api/v1', …)`**. Express sets **`req.baseUrl` + `req.path`** to the full API path (e.g. `/api/v1/notes`); **`req.originalUrl`** alone can be wrong under Netlify/serverless-http. See **`hub/gateway/request-path.mjs`** (`effectiveRequestPath`, `upstreamPathAndQuery`).

When the gateway **re-serializes** the JSON body (e.g. provenance merge), it **removes** the incoming **`Content-Length`**, **`Transfer-Encoding`**, and **`Content-Encoding`** before `fetch` to the canister. Keeping the client’s **`Content-Length`** (from the shorter pre-merge body) can cause Undici to **hang** or mis-handle the write relative to the new body, so create/save appears to do nothing; the canister may also see truncated or invalid JSON.

## Environment

| Variable | Required | Description |
|----------|----------|-------------|
| **CANISTER_URL** | Yes | Canister HTTP URL (e.g. `https://<canister-id>.ic0.app`). |
| **SESSION_SECRET** or **HUB_JWT_SECRET** | Yes | Secret to sign JWTs. |
| **HUB_BASE_URL** | Yes (prod) | Public URL of this gateway (for OAuth callback). E.g. `https://knowtation.store` if gateway is same origin. |
| **HUB_UI_ORIGIN** | No | Origin of the Hub UI (for post-login redirect). Defaults to HUB_BASE_URL. E.g. `https://knowtation.store`. |
| **BRIDGE_URL** | No | URL of the Hub Bridge (for Connect GitHub + Back up now). **Must be a full URL with `http://` or `https://`** and the bridge origin only: e.g. `https://knowtation-bridge.netlify.app` — no trailing slash, no path (no `/api/...` or `/auth/...`). A host-only value (no scheme) fails at gateway startup. When set, gateway redirects/proxies `/api/v1/auth/github-connect` and `/api/v1/vault/*` to the bridge so the UI can use one origin. |
| **GOOGLE_CLIENT_ID**, **GOOGLE_CLIENT_SECRET** | No | Google OAuth (enables "Continue with Google"). |
| **GITHUB_CLIENT_ID**, **GITHUB_CLIENT_SECRET** | No | GitHub OAuth (enables "Continue with GitHub"). |
| **GATEWAY_PORT** or **PORT** | No | Port (default 3340). |
| **HUB_CORS_ORIGIN** | **Yes (prod)** if Hub UI is on another origin | Comma-separated origins, e.g. `https://knowtation.store,https://www.knowtation.store`. Required for credentialed CORS responses; see [CORS-WWW-AND-APEX.md](../../docs/CORS-WWW-AND-APEX.md) and `hub/gateway/cors-middleware.mjs`. |
| **HUB_JWT_EXPIRY** | No | JWT expiry (default `7d`). |
| **HUB_ADMIN_USER_IDS** | No | Comma-separated user IDs (e.g. `google:123,github:456`) who get role **admin** on hosted (bootstrap); everyone else gets **member**. When **BRIDGE_URL** is set, roles and invites are stored in the bridge and proxied; full Team and invite links work. Set the same value on the bridge so Settings shows the correct role. See [PARITY-PLAN.md](../../docs/PARITY-PLAN.md) Phase 4. |
| **BILLING_ENFORCE** | No | Set to `true` to deduct credits and return **402** when monthly + add-on pools are exhausted (default off = beta open usage). |
| **BILLING_SHADOW_LOG** | No | Set to `true` or `1` to emit **structured JSON** (`type: knowtation_billing_shadow`) per billable operation for **usage research** (works even when enforcement is off). |
| **STRIPE_SECRET_KEY** | No | Stripe API key for webhooks and (future) Checkout sessions. |
| **STRIPE_WEBHOOK_SECRET** | No | Signing secret for **POST /api/v1/billing/webhook**. |
| **STRIPE_PRICE_STARTER**, **STRIPE_PRICE_PRO**, **STRIPE_PRICE_TEAM** | No | Stripe Price ids for subscription tiers → included credits/month. |
| **STRIPE_PRICE_PACK_10**, **STRIPE_PRICE_PACK_25**, **STRIPE_PRICE_PACK_50** | No | Stripe Price ids for add-on packs (10 / 25 / 50 credits). |

**Billing storage:** Local file **`data/hosted_billing.json`** (gitignored with `data/`). On **Netlify**, the gateway function uses Blob store **`gateway-billing`** (see `netlify/functions/gateway.mjs`).

**Checkout metadata:** Subscription and pack Checkout Sessions should include **`metadata.user_id`** (Hub JWT `sub`). Pack sessions should include **`metadata.credits_cents`** (e.g. `1000` for $10) or use a mapped **Price** id above.

## Google OAuth — redirect URI (fixes `redirect_uri_mismatch`)

Passport uses **`callbackURL = HUB_BASE_URL + '/auth/callback/google'`** (not `/api/v1/...`). The full Node Hub under `hub/server.mjs` uses `/api/v1/auth/callback/google`; the gateway does **not**.

In **Google Cloud Console** → OAuth client → **Authorized redirect URIs**, add the URI that matches **`HUB_BASE_URL`**:

| If you run gateway on | Set `HUB_BASE_URL` | Add this exact URI in Google |
|----------------------|--------------------|------------------------------|
| Default (3340) | `http://localhost:3340` | `http://localhost:3340/auth/callback/google` |
| 3333 | `http://localhost:3333` | `http://localhost:3333/auth/callback/google` |

Production: `https://YOUR-GATEWAY-URL/auth/callback/google` (no trailing slash).

If Google only has `http://localhost:3333/api/v1/auth/callback/google` (full Hub) and you log in via the **gateway**, the request fails with **Error 400: redirect_uri_mismatch** — add the `/auth/callback/google` URI for the port you use.

## Run locally

```bash
cd hub/gateway
npm install
export CANISTER_URL=https://<canister-id>.ic0.app
export SESSION_SECRET=your-secret
export HUB_BASE_URL=http://localhost:3340
export GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=...
# optional: GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET
npm start
```

Point the Hub UI at the same origin as **`HUB_BASE_URL`** (e.g. `window.HUB_API_BASE_URL = 'http://localhost:3340'`). Login will redirect to Google/GitHub and back; then all API calls go through the gateway to the canister with X-User-Id.

## Deploy (e.g. Netlify)

- **This repo:** Production path is `netlify/functions/gateway.mjs` plus root `netlify.toml`. The build runs `scripts/netlify-redirects.mjs` to generate `public/_redirects` (per-site: gateway vs bridge is controlled by `USE_BRIDGE_FUNCTION` on the bridge site only). Do not add a catch-all `[[redirects]]` in root `netlify.toml` when using a second Netlify site for the bridge—see [docs/DEPLOY-HOSTED.md](../../docs/DEPLOY-HOSTED.md) §3 and [docs/BRIDGE-DEPLOY-AND-PREROLL.md](../../docs/BRIDGE-DEPLOY-AND-PREROLL.md).
- **Local / generic Node:** Build is not required when running `npm start` as a normal server.
- For other hosts, use a Node adapter or deploy the Express app as you would any Node service; set **HUB_BASE_URL** and **HUB_UI_ORIGIN** to production URLs.
- Ensure **CANISTER_URL** points to the deployed canister and **SESSION_SECRET** is set in env (no secrets in repo).

## Post-deploy verification (GitHub backup + CORS)

1. **CORS (Hub UI on knowtation.store / www):** From the repo root, run `npm run check:gateway-cors`. Each listed origin should get a **specific** `Allow-Origin` and `Allow-Credentials: true`. If not, set **`HUB_CORS_ORIGIN`** on this gateway site to both apex and www (see [docs/HOSTED-HUB-VERIFY.md](../../docs/HOSTED-HUB-VERIFY.md) §0 and [docs/CORS-WWW-AND-APEX.md](../../docs/CORS-WWW-AND-APEX.md)), then redeploy.

2. **`BRIDGE_URL`:** Must be the bridge **origin only** — full URL with `https://`, no path (e.g. `https://knowtation-bridge.netlify.app`). Wrong values produce malformed redirect URLs; see [docs/CONNECT-GITHUB-AND-STORAGE-CHECK.md](../../docs/CONNECT-GITHUB-AND-STORAGE-CHECK.md) §2–3.

3. **`SESSION_SECRET` / `HUB_JWT_SECRET`:** The **bridge** site must use the **same** secret as this gateway so JWTs verify on `/api/v1/vault/github-status` and Connect GitHub. Mismatch → Settings shows “Not connected” after OAuth; see [docs/CONNECT-GITHUB-AND-STORAGE-CHECK.md](../../docs/CONNECT-GITHUB-AND-STORAGE-CHECK.md) §6.

## Reference

- [CANISTER-AUTH-CONTRACT.md](../../docs/CANISTER-AUTH-CONTRACT.md) — gateway/canister proof contract
- [HUB-API.md](../../docs/HUB-API.md) — API contract
