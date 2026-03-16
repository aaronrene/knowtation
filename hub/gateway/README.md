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
| **BRIDGE_URL** | No | URL of the Hub Bridge (for Connect GitHub + Back up now). When set, gateway redirects/proxies `/api/v1/auth/github-connect` and `/api/v1/vault/*` to the bridge so the UI can use one origin. |
| **GOOGLE_CLIENT_ID**, **GOOGLE_CLIENT_SECRET** | No | Google OAuth (enables "Continue with Google"). |
| **GITHUB_CLIENT_ID**, **GITHUB_CLIENT_SECRET** | No | GitHub OAuth (enables "Continue with GitHub"). |
| **GATEWAY_PORT** or **PORT** | No | Port (default 3340). |
| **HUB_CORS_ORIGIN** | No | CORS Allow-Origin (default `*`). Set to Hub UI origin in production. |
| **HUB_JWT_EXPIRY** | No | JWT expiry (default `7d`). |

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

Point the Hub UI at `http://localhost:3340` (e.g. `?api=http://localhost:3340` or set `window.HUB_API_BASE_URL`). Login will redirect to Google/GitHub and back; then all API calls go through the gateway to the canister with X-User-Id.

## Deploy (e.g. Netlify)

- Build: not required (Node server).
- For Netlify, use a Node server adapter or run the Express app as a serverless function (e.g. split routes into serverless handlers). Alternatively deploy to a small Node host (Railway, Fly, etc.) and set **HUB_BASE_URL** and **HUB_UI_ORIGIN** to production URLs.
- Ensure **CANISTER_URL** points to the deployed canister and **SESSION_SECRET** is set in env (no secrets in repo).

## Reference

- [CANISTER-AUTH-CONTRACT.md](../../docs/CANISTER-AUTH-CONTRACT.md) — gateway/canister proof contract
- [HUB-API.md](../../docs/HUB-API.md) — API contract
