# Knowtation Hub Gateway

OAuth (Google/GitHub) + proxy for the **hosted** product. Users log in here; the gateway proxies all `/api/v1/*` requests to the ICP canister with an **X-User-Id** header (proof the canister trusts). Trust model: JWT `sub` → **`x-user-id`** on canister requests — see **[docs/HUB-API.md](../../docs/HUB-API.md)** (auth). For **pre-merge** verification of **bridge-backed** `POST /api/v1/import` (including 4C drop) when **`BRIDGE_URL`** is set, see **[docs/IMPORT-URL-AND-DOCUMENTS-PHASES.md](../../docs/IMPORT-URL-AND-DOCUMENTS-PHASES.md)** §4V.

## Routes

- **GET /health**, **GET /api/v1/health** — Health (no auth).
- **GET /api/v1/auth/providers** — Which OAuth providers are configured (no auth). Response includes `google`, `github`, and `apple` booleans (`apple: true` when `APPLE_CLIENT_ID` is set and not offline-locked).
- **GET /api/v1/auth/session** — **C7 Session introspection.** Bearer JWT required. Returns verified identity + API scopes: `{ sub, provider, id, name, role, iat, exp, scopes }`. Safe for cross-origin callers (Scooling, external services). Response is derived from the signed token only — no DB call. Scopes are role-derived (`admin` → `[vault:read, vault:write, admin]`; `member` → `[vault:read, vault:write]`); explicit per-user scope management is C4. Apple sessions from native exchange introspect here unchanged (`provider: "apple"`, `sub: "apple:<sub>"`).
- **POST /api/v1/auth/native-apple-exchange** — **Sign in with Apple** identity-assertion exchange (not Passport Google/GitHub; not `api/v1/auth/native` PKCE). Body: `{ identity_token, nonce?, full_name? }`. Verifies Apple JWKS server-side, mints hosted session JWT (`type: "session"`, `provider: "apple"`). Success: `{ schema_version: 1, token_type: "Bearer", access_token, expires_in }`. No `ktn_refresh` cookie on this route. Fail-closed codes: `BAD_REQUEST`, `APPLE_ASSERTION_INVALID`, `OAUTH_DISABLED`, `NOT_CONFIGURED`, `APPLE_JWKS_UNAVAILABLE`. See `hub/gateway/apple-identity-token.mjs` and `docs/KN-APPLE-NATIVE-HOSTED-EXCHANGE-FREEZE.md`.
- **POST /api/v1/auth/refresh** — Exchange the `ktn_refresh` HttpOnly cookie for a fresh `access_token` Bearer JWT. Rotates the refresh token (reuse detection + family revocation). See `hub/gateway/refresh-token-store.mjs`.
- **POST /api/v1/auth/establish-refresh** — Exchange a valid human `type:session` Bearer JWT for a durable refresh record. **Browser** (request has `Origin`): HttpOnly cookie only; JSON body is `{ schema_version: 1, established: true }` and never includes `refresh_token` (even if `Accept` asks for it). Origin must be on `HUB_CORS_ORIGIN` (or equal `HUB_BASE_URL` origin when that list is empty). **CLI** (no `Origin`): requires `Accept: application/vnd.knowtation.refresh-token+json` else **406**; success returns `{ schema_version: 1, refresh_token, token_type: "refresh" }` and **must not** `Set-Cookie`. Used when OAuth redirect cannot attach `Set-Cookie` (Netlify); Hub UI calls the browser mode after login; `scripts/hub-session-refresh.mjs --save-access-token` uses the CLI media type via `scripts/lib/hub-session-auth.mjs`.
- **POST /api/v1/auth/logout** — Revoke the `ktn_refresh` cookie server-side (burns the token family) and clear the cookie.
- **GET /scooling/note-outline/smoke?path=...** — Local/staging-only Scooling NoteOutline smoke bridge. Disabled unless **`SCOOLING_NOTE_OUTLINE_SMOKE_ENABLED=1`** and **`SCOOLING_NOTE_OUTLINE_SMOKE_ENV=local|staging`**. The gateway owns the upstream bearer token, rejects request credentials from Scooling, validates the upstream body-free `NoteOutline`, and returns only the `knowtation.note_outline/v1` JSON contract.
- **POST /scooling/write-back/smoke** — Staging-only, metadata-only Scooling write-back target smoke check. Disabled unless **`SCOOLING_WRITE_BACK_SMOKE_ENABLED=1`** and **`SCOOLING_WRITE_BACK_SMOKE_ENV=staging`**. It checks canister metadata availability and returns dry-run capability flags only; it never accepts raw credentials or performs live writes.
- **GET /auth/login?provider=google|github** — Redirect to OAuth (plan routes).
- **GET /api/v1/auth/login?provider=...** — Redirects to `/auth/login` for Hub UI compatibility.
- **GET /auth/callback/google**, **GET /auth/callback/github** — OAuth callbacks; on success redirect to `HUB_UI_ORIGIN/?token=<jwt>`.
- **GET /api/v1/billing/summary** — JWT. Hosted billing pools (tier, monthly/add-on cents). See **`hub/gateway/billing-*.mjs`** and **[docs/TOKEN-SAVINGS.md](../../docs/TOKEN-SAVINGS.md)** (billing hooks).
- **POST /api/v1/billing/webhook** — Stripe webhook (**raw JSON body**). No JWT.
- **GET /api/v1/notes/facets** — JWT + **X-Vault-Id**. Aggregates `projects`, `tags`, and `folders` from the canister note list (`hub/gateway/note-facets.mjs`); not proxied as a literal canister path.
- **POST /api/v1/notes/delete-by-project**, **POST /api/v1/notes/rename-project** — JWT + **X-Vault-Id**; **editor/admin/member** (not **viewer**). Gateway orchestrates canister list/delete/write + proposal discards (`hub/gateway/metadata-bulk-canister.mjs`). The **Hub** static bundle must include **PR #65** (`web/hub/hub.js`) so Settings on hosted actually calls these routes. See [HUB-METADATA-BULK-OPS.md](../../docs/HUB-METADATA-BULK-OPS.md).
- **POST /api/v1/notes/copy** — JWT; **editor/admin** (not **viewer**). Copy or **move** one note between vaults (`from_vault_id`, `to_vault_id`, `path`, optional `delete_source`). Gateway-only orchestration (GET → POST → optional DELETE on canister); then bridge **re-index** for affected vaults. Hub UI: note detail **Copy to vault…**. Contract: [HUB-API.md](../../docs/HUB-API.md) §3.3.
- **GET/POST/DELETE /api/v1/*** (other) — Proxied to canister with **X-User-Id** from JWT (e.g. **DELETE /api/v1/notes/:path** removes a note). Returns 401 if no valid token. When **BILLING_ENFORCE** is on, some routes may return **402** (quota).
- **POST /api/v1/roles/evaluator-may-approve** — JWT + **admin** (via `requireAdmin`). Proxied to bridge when **BRIDGE_URL** is set (per-evaluator approve flag); same origin as other Team routes.
- **Proposal approve/discard:** **POST** `/api/v1/proposals/:id/approve` and `…/discard` are checked on the gateway using the **actor** JWT and bridge **role** + **may_approve_proposals** (from **GET /api/v1/role** / **hosted-context**). The canister uses the **effective** workspace user id and does not distinguish actor roles; gateway enforcement is required for correct RBAC. **Discard** requires **admin**. **Approve** requires **admin** or **evaluator** with permission (per-user in Team / bridge blob, else **`HUB_EVALUATOR_MAY_APPROVE=1`** fallback when no per-user entry).
- **LLM proposal helpers:** **Review hints** run on this **gateway** after proposal create when hints are enabled (`KNOWTATION_HUB_PROPOSAL_REVIEW_HINTS` or admin-saved prefs in **`hub/gateway/proposal-llm-store.mjs`** / Netlify Blob; see **`POST /api/v1/settings/proposal-policy`**). **Enrich** runs here when enabled (same pattern; **`POST /api/v1/proposals/:id/enrich`**). Implementation: `proposal-review-hints-async.mjs`, `proposal-enrich-hosted.mjs`. Deploy the **hub** canister from this repo first (stable migration V4 adds enrich fields). See **[docs/HUB-PROPOSAL-LLM-FEATURES.md](../../docs/HUB-PROPOSAL-LLM-FEATURES.md)**.

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
| **APPLE_CLIENT_ID** | No | Sign in with Apple — expected `aud` for `POST /api/v1/auth/native-apple-exchange` (native Bundle ID or Services ID). When set, `GET /api/v1/auth/providers` advertises `apple: true`. Never commit real values. |
| **GITHUB_CLIENT_ID**, **GITHUB_CLIENT_SECRET** | No | GitHub OAuth (enables "Continue with GitHub"). |
| **GATEWAY_PORT** or **PORT** | No | Port (default 3340). |
| **SCOOLING_NOTE_OUTLINE_SMOKE_ENABLED** | No | Set to `1` only for local/staging structural UX smoke validation. |
| **SCOOLING_NOTE_OUTLINE_SMOKE_ENV** | No | Must be `local` or `staging` for `GET /scooling/note-outline/smoke` to answer; any other value returns 404. |
| **SCOOLING_NOTE_OUTLINE_SMOKE_UPSTREAM** | No | Full HTTP(S) URL for the auth-gated upstream `GET /api/v1/note-outline` endpoint. Must not include credentials, query string, or fragment. |
| **SCOOLING_NOTE_OUTLINE_SMOKE_BEARER_TOKEN** | No | Bearer token held only by the gateway bridge for the upstream NoteOutline request. Scooling must not receive, send, store, or log this token. |
| **SCOOLING_WRITE_BACK_SMOKE_ENABLED** | No | Set to `1` only on staging to expose `POST /scooling/write-back/smoke` for Scooling target validation. |
| **SCOOLING_WRITE_BACK_SMOKE_ENV** | No | Must be `staging` for the Scooling smoke endpoint to answer; any other value returns 404. |
| **HUB_CORS_ORIGIN** | **Yes (prod)** if Hub UI is on another origin | Comma-separated origins, e.g. `https://knowtation.store,https://www.knowtation.store`. Required for credentialed CORS responses — see **`hub/gateway/cors-middleware.mjs`**. |
| **HUB_JWT_EXPIRY** | No | JWT expiry for **issued API tokens** (gateway default in code is **`24h`** unless overridden; match `docs/AGENT-INTEGRATION.md`). |
| **HUB_ADMIN_USER_IDS** | No | Comma-separated user IDs (e.g. `google:123,github:456`) who get role **admin** in the JWT and pass **`requireAdmin`** without a bridge call. When **BRIDGE_URL** is set, **Team admins** (bridge **`GET /api/v1/role`** → `role: admin`) also pass **`requireAdmin`** for gateway-only admin routes (e.g. **`POST /api/v1/settings/proposal-policy`**, workspace, vault-access, invites). Bootstrap operators often list at least one id here; further admins can be granted in Team without redeploying env. See **[docs/PARITY-MATRIX-HOSTED.md](../../docs/PARITY-MATRIX-HOSTED.md)** (hosted admin flows). |
| **HUB_EVALUATOR_MAY_APPROVE** | No | Set to **`1`** so **evaluators** may **approve** when they have **no** explicit row in the bridge blob **`hub_evaluator_may_approve`** (per-user overrides still win). Gateway and bridge honor this; **GET /api/v1/settings** exposes effective **hub_evaluator_may_approve** per user. |
| **BILLING_ENFORCE** | No | Set to `true` to deduct credits and return **402** when monthly + add-on pools are exhausted (default off = beta open usage). |
| **BILLING_SHADOW_LOG** | No | Set to `true` or `1` to emit **structured JSON** (`type: knowtation_billing_shadow`) per billable operation for **usage research** (works even when enforcement is off). |
| **STRIPE_SECRET_KEY** | No | Stripe API key for webhooks and (future) Checkout sessions. |
| **STRIPE_WEBHOOK_SECRET** | No | Signing secret for **POST /api/v1/billing/webhook**. |
| **STRIPE_PRICE_STARTER**, **STRIPE_PRICE_PRO**, **STRIPE_PRICE_TEAM** | No | Stripe Price ids for subscription tiers → included credits/month. |
| **STRIPE_PRICE_PACK_10**, **STRIPE_PRICE_PACK_25**, **STRIPE_PRICE_PACK_50** | No | Stripe Price ids for add-on packs (10 / 25 / 50 credits). |

**Hub static UI (`web/hub/config.js`, separate from this server’s env):** The browser bundle may set `window.HUB_MCP_PUBLIC_URL` to the **public URL of a persistent gateway** that serves `POST /mcp` (e.g. `https://mcp.example.com/mcp`), so **Settings → Integrations → Copy Hub URL, token & vault** can emit **`KNOWTATION_MCP_URL`** next to `KNOWTATION_HUB_URL`. The **Netlify** site for the REST API does **not** run stateful MCP; operators who split API (Netlify) and MCP (VPS) document both URLs in that copy block. See **`docs/AGENT-INTEGRATION.md`** §2–3.

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

- **This repo:** Production path is `netlify/functions/gateway.mjs` plus root `netlify.toml`. The build runs `scripts/netlify-redirects.mjs` to generate `public/_redirects` (per-site: gateway vs bridge is controlled by `USE_BRIDGE_FUNCTION` on the bridge site only). Do not add a catch-all `[[redirects]]` in root `netlify.toml` when using a second Netlify site for the bridge — see **`deploy/bridge`** packaging and **`hub/bridge/README.md`** (Netlify Blobs).
- **Local / generic Node:** Build is not required when running `npm start` as a normal server.
- For other hosts, use a Node adapter or deploy the Express app as you would any Node service; set **HUB_BASE_URL** and **HUB_UI_ORIGIN** to production URLs.
- Ensure **CANISTER_URL** points to the deployed canister and **SESSION_SECRET** is set in env (no secrets in repo).

## Post-deploy verification (GitHub backup + CORS)

1. **CORS (Hub UI on knowtation.store / www):** From the repo root, run `npm run check:gateway-cors`. Each listed origin should get a **specific** `Allow-Origin` and `Allow-Credentials: true`. If not, set **`HUB_CORS_ORIGIN`** on this gateway site to both apex and www (`hub/gateway/cors-middleware.mjs`), then redeploy.

   **Hosted “Back up now”:** `POST /api/v1/vault/sync` triggers a CORS **preflight** (`OPTIONS`). The gateway must answer **`OPTIONS` with 204** on that path; it must **not** forward preflight to the bridge (the bridge only implements `POST`). If preflight fails, the Hub shows *Could not reach the API* even when `GET /api/v1/settings` works.

2. **`BRIDGE_URL`:** Must be the bridge **origin only** — full URL with `https://`, no path (e.g. `https://knowtation-bridge.netlify.app`). Wrong values produce malformed redirect URLs; see [docs/CONNECT-GITHUB-AND-STORAGE-CHECK.md](../../docs/CONNECT-GITHUB-AND-STORAGE-CHECK.md) §2–3.

3. **`SESSION_SECRET` / `HUB_JWT_SECRET`:** The **bridge** site (and the persistent **MCP host**) must use the **same primary** secret as this gateway so JWTs verify on `/api/v1/vault/github-status` and Connect GitHub. Mismatch → Settings shows “Not connected” after OAuth; see [docs/CONNECT-GITHUB-AND-STORAGE-CHECK.md](../../docs/CONNECT-GITHUB-AND-STORAGE-CHECK.md) §6.

4. **`SESSION_SECRET_PREVIOUS` (rotation window only):** Verify-only fallback secret used by `hub/lib/session-secret-rotation.mjs` during a zero-downtime `SESSION_SECRET` rotation (SEC-KN-P6-ROTATE runbook, `docs/SEC-KN-P6-ROTATE-FREEZE.md` §6). It is **never used to sign** JWTs, HMACs, or GitHub-token encryption. Set `previous ← OLD` and `primary ← NEW` on **gateway + bridge + MCP host in lockstep**, wait out the drain window (floor: web-session default **`24h`** via `HUB_JWT_EXPIRY` unless a shorter expiry is proven on all three hosts — plus Phase C exchange 900s and MCP OAuth access TTL), then unset `SESSION_SECRET_PREVIOUS` everywhere. After the rotation closes, stored GitHub tokens encrypted under OLD may require a one-time **Connect GitHub** re-connect.

## Reference

- [HUB-API.md](../../docs/HUB-API.md) — API contract (auth, proposals, vault headers)
