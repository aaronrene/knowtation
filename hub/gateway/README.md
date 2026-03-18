# Knowtation Hub Gateway

OAuth (Google/GitHub) + proxy for the **hosted** product. Users log in here; the gateway proxies all `/api/v1/*` requests to the ICP canister with an **X-User-Id** header (proof the canister trusts). See [docs/CANISTER-AUTH-CONTRACT.md](../../docs/CANISTER-AUTH-CONTRACT.md).

## Routes

- **GET /health**, **GET /api/v1/health** — Health (no auth).
- **GET /api/v1/auth/providers** — Which OAuth providers are configured (no auth).
- **GET /auth/login?provider=google|github** — Redirect to OAuth (plan routes).
- **GET /api/v1/auth/login?provider=...** — Redirects to `/auth/login` for Hub UI compatibility.
- **GET /auth/callback/google**, **GET /auth/callback/github** — OAuth callbacks; on success redirect to `HUB_UI_ORIGIN/?token=<jwt>`.
- **GET/POST /api/v1/*** — Proxied to canister with **X-User-Id** from JWT. Returns 401 if no valid token.

## Environment

| Variable | Required | Description |
|----------|----------|-------------|
| **CANISTER_URL** | Yes | Canister HTTP URL (e.g. `https://<canister-id>.ic0.app`). |
| **SESSION_SECRET** or **HUB_JWT_SECRET** | Yes | Secret to sign JWTs. |
| **HUB_BASE_URL** | Yes (prod) | Public URL of this gateway (for OAuth callback). E.g. `https://knowtation.store` if gateway is same origin. |
| **HUB_UI_ORIGIN** | No | Origin of the Hub UI (for post-login redirect). Defaults to HUB_BASE_URL. E.g. `https://knowtation.store`. |
| **BRIDGE_URL** | No | URL of the Hub Bridge (for Connect GitHub + Back up now). **Must be the bridge origin only:** e.g. `https://knowtation-bridge.netlify.app` — no trailing slash, no path (no `/api/...` or `/auth/...`). When set, gateway redirects/proxies `/api/v1/auth/github-connect` and `/api/v1/vault/*` to the bridge so the UI can use one origin. |
| **GOOGLE_CLIENT_ID**, **GOOGLE_CLIENT_SECRET** | No | Google OAuth (enables "Continue with Google"). |
| **GITHUB_CLIENT_ID**, **GITHUB_CLIENT_SECRET** | No | GitHub OAuth (enables "Continue with GitHub"). |
| **GATEWAY_PORT** or **PORT** | No | Port (default 3340). |
| **HUB_CORS_ORIGIN** | No | CORS Allow-Origin (default `*`). Set to Hub UI origin in production. |
| **HUB_JWT_EXPIRY** | No | JWT expiry (default `7d`). |

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

- Build: not required (Node server).
- For Netlify, use a Node server adapter or run the Express app as a serverless function (e.g. split routes into serverless handlers). Alternatively deploy to a small Node host (Railway, Fly, etc.) and set **HUB_BASE_URL** and **HUB_UI_ORIGIN** to production URLs.
- Ensure **CANISTER_URL** points to the deployed canister and **SESSION_SECRET** is set in env (no secrets in repo).

## Reference

- [CANISTER-AUTH-CONTRACT.md](../../docs/CANISTER-AUTH-CONTRACT.md) — gateway/canister proof contract
- [HUB-API.md](../../docs/HUB-API.md) — API contract
