# Connect GitHub fix and “empty Local Storage” — measure three times

> **Note (Phase 3.1):** References to `?token=...` in this doc reflect the original OAuth redirect design. The post-login redirect now delivers the token via a URL fragment (`#token=...`) instead of a query parameter. The Hub reads the token from `location.hash` first, falling back to `location.search` for backward compatibility.

Checklist for fixing the malformed Connect GitHub URL and Unauthorized response. See **[hub/bridge/README.md](../hub/bridge/README.md)** for bridge deploy.

---

## 0. GitHub OAuth App — every callback URL (copy-paste)

GitHub shows **“Be careful! … redirect_uri is not associated with this application”** when the authorize request uses a `redirect_uri` that is **not** listed on the OAuth App. **Login** and **Connect GitHub** (vault push token) use **different paths**. If you use **one** OAuth app for local Hub + hosted bridge, register **all** rows that apply.

| Where you use it | Flow | Add this exact **Authorization callback URL** |
|------------------|------|-----------------------------------------------|
| Self-hosted `npm run hub` (default port **3333**) | Sign in with GitHub | `http://localhost:3333/api/v1/auth/callback/github` |
| Self-hosted `npm run hub` (port **3333**) | **Connect GitHub** in Settings → Backup | `http://localhost:3333/api/v1/auth/callback/github-connect` |
| Hosted **bridge** (Netlify or other) | **Connect GitHub** only | `https://YOUR-BRIDGE-HOST/auth/callback/github-connect` (example: `https://knowtation-bridge.netlify.app/auth/callback/github-connect`) |
| Hosted **gateway** | Sign in with GitHub | `https://YOUR-GATEWAY-HOST/auth/callback/github` (gateway uses `/auth/callback/github`, **not** `/api/v1/...` — see [hub/gateway/README.md](../hub/gateway/README.md)) |

**Self-hosted:** `HUB_BASE_URL` must match the host/port in these URLs (see [hub/README.md](../hub/README.md) § GitHub). **Hosted bridge:** `HUB_BASE_URL` on the bridge site must match the `https://…` origin used in the bridge callback row.

---

## 1. Does empty Local Storage mean we need to redeploy?

**No.** Empty Local Storage does **not** by itself mean you must redeploy.

- The Hub stores the JWT in `localStorage` only when it has a token (from the URL after login or from a previous write). So:
  - If you **cleared** storage while debugging, it will be empty until you log in again (then the OAuth redirect will land you on `/hub/?token=...` and the Hub will write `hub_token`).
  - If you **never** got the post-login redirect with `?token=...` (e.g. wrong `HUB_UI_ORIGIN` on the gateway), the token would never be written.
- **Redeploy is needed for one thing only:** the **code change** in [web/hub/hub.js](../web/hub/hub.js) that adds `?token=...` to the Connect GitHub link so the bridge receives the JWT. That fix is in the repo but will not be live on knowtation.store until the Hub (4Everland or whatever serves it) is redeployed from the repo.

So: **Redeploy = get the updated Hub code live.** It is not “because Local Storage is empty.”

---

## 2. Why the malformed URL (assumption to correct)

If you saw:

`https://knowtation-gateway.netlify.app/api/v1/auth/knowtation-bridge.netlify.app/auth/github-connect`

the gateway builds the redirect as `BRIDGE_URL + '/auth/github-connect' + query`. For that to become the URL above, **BRIDGE_URL** on the **gateway** must have been set to a value that includes a path (e.g. gateway host + path), **not** the bridge origin alone. The bug is **gateway BRIDGE_URL**, not Hub or Local Storage.

---

## 3. What to verify before redeploying (measure three times)

### A. Gateway (Netlify — knowtation-gateway site)

- In Netlify → **knowtation-gateway** → **Site configuration** → **Environment variables**, open **BRIDGE_URL**.
- **Bridge site redirect:** If you see "Cannot GET /auth/github-connect" on knowtation-bridge.netlify.app, the **bridge** site must route traffic to the bridge function with the path preserved. In **knowtation-bridge** → **Build & deploy** → **Build settings**, set **Package directory** to `deploy/bridge` and leave **Base directory** empty (repo root). Netlify uses [deploy/bridge/netlify.toml](../deploy/bridge/netlify.toml), which sets `USE_BRIDGE_FUNCTION=true` for the build so [scripts/netlify-redirects.mjs](../scripts/netlify-redirects.mjs) writes `public/_redirects` for the bridge, and declares `[[redirects]]` to `/.netlify/functions/bridge/:splat`. Then **Trigger deploy** → **Clear cache and deploy site**.
- **It must be exactly:** `https://knowtation-bridge.netlify.app`
  - **Must include the protocol** (`https://`). If you set only `knowtation-bridge.netlify.app`, the redirect is treated as a relative URL and you get the malformed gateway URL.
  - No trailing slash, no path (no `/api/...`, no `.../auth/...`).
- If it currently has a path, fix it to the bridge origin only, save, and trigger a new deploy of the gateway (or wait for the next deploy). No Hub redeploy needed to fix the **redirect URL**.

### B. Hub (4Everland / wherever knowtation.store is built)

- Confirm that the **source** of knowtation.store is this repo (and the branch you care about, e.g. `main` or your feature branch).
- The **only** change that requires a Hub redeploy is the update in [web/hub/hub.js](../web/hub/hub.js) that builds the Connect GitHub link with the token:
  `connectBtn.href = apiBase + '/api/v1/auth/github-connect' + (token ? '?token=' + encodeURIComponent(token) : '');`
  Until that version is deployed, the link will not pass the JWT and the bridge will return Unauthorized even if the redirect URL is correct.
- So: **Redeploy the Hub** when you are ready to get that fix live. You do **not** need to redeploy just because Local Storage is empty.

### C. Local Storage

- Empty Local Storage only means: no stored `hub_token` (and no `hub_api_url` override). After you fix BRIDGE_URL and (optionally) redeploy the Hub:
  - Log in again with Google so the gateway redirects to `https://knowtation.store/hub/?token=...`.
  - When the Hub loads with `?token=...`, it will write `hub_token` to Local Storage. Then Connect GitHub will have a token to add to the link (after Hub redeploy).

---

## 4. Order of operations (cut once)

1. **Fix gateway BRIDGE_URL** (Netlify) to `https://knowtation-bridge.netlify.app` only. Redeploy gateway if needed.
2. **Redeploy the Hub** (4Everland / your host) from the repo that contains the hub.js token-in-URL change so Connect GitHub includes `?token=...`.
3. **Test:** Clear storage or use a private window, go to knowtation.store/hub/, log in with Google, open Settings → Backup, click Connect GitHub. You should be redirected to the gateway, then to the bridge (correct URL), then to GitHub, then back with “Connected.” Local Storage will contain `hub_token` after the login redirect.

No step is “redeploy because Local Storage is empty.” Redeploy is for: (1) gateway if you changed BRIDGE_URL, (2) Hub to ship the link fix.

---

## 5. GitHub OAuth app (bridge)

- **Authorization callback URL** must be exactly: `https://knowtation-bridge.netlify.app/auth/callback/github-connect`. (When typing manually, avoid truncation—e.g. "connect" not "conne"—and copy from GitHub when possible. These are generic precautions, not conclusions about your config.)
- **GITHUB_CLIENT_ID** on the bridge Netlify site must match the GitHub app’s Client ID exactly (e.g. when retyping, watch for letter O vs digit 0). Copy from GitHub → Developer settings → OAuth Apps → your app.

---

## 6. Settings still shows "GitHub: Not connected" after a successful Connect GitHub

If the Connect GitHub flow completes (you see a success message or return to the Hub) but **Settings → Backup** still shows **GitHub: Not connected**:

1. **Gateway and bridge must use the same SESSION_SECRET.** The gateway issues the user JWT; the bridge verifies it for `/api/v1/vault/github-status`. If the bridge has a different `SESSION_SECRET` (or `HUB_JWT_SECRET`), it cannot verify the token and returns 401. The gateway then leaves `github_connected` false.
2. **Check gateway logs.** After the change in [hub/gateway/server.mjs](../hub/gateway/server.mjs), when the bridge returns non-OK you will see:
   - `[gateway] bridge github-status non-ok 401` — bridge could not verify the JWT → fix by setting the **exact same** SESSION_SECRET on both Netlify sites (gateway and bridge).
   - `[gateway] bridge github-status unreachable ...` — bridge not reachable (e.g. wrong BRIDGE_URL or bridge down).

Fix: In the **bridge** Netlify site's environment variables, set **SESSION_SECRET** (or **HUB_JWT_SECRET**) to the **exact same** string as on the **gateway** site. Redeploy the bridge (and gateway if you changed it), then open Settings → Backup again.

3. **Stored token encrypted with an old bridge SESSION_SECRET.** GitHub tokens in Netlify Blobs are encrypted with the bridge’s `SESSION_SECRET` at save time. If you later change that secret, `decrypt` fails and the bridge omits those entries — JWT verification can still succeed (gateway and bridge share the new secret), but **github_connected** stays false. **Fix:** run **Connect GitHub** once more after any bridge `SESSION_SECRET` change. Bridge logs: `[bridge] loadTokens: decrypt failed for N stored GitHub token(s)...`.

4. **Netlify Blobs read-after-write.** The bridge uses **eventual** consistency for `bridge-data` in [netlify/functions/bridge.mjs](../netlify/functions/bridge.mjs). Do **not** use `consistency: 'strong'` on the store or on reads in Netlify Functions unless Netlify provides `uncachedEdgeURL` for that runtime — otherwise blob operations throw `BlobsConsistencyError` and **Connect GitHub crashes** (“This function has crashed”). Mitigation: the Hub retries `GET /api/v1/settings` after `?github_connected=1` when opening Backup. If status lags once, wait a few seconds and reopen Settings.

5. **`github_connect_error=blob_storage` in the URL.** The bridge could not persist the token (e.g. past Blobs misconfiguration). After the eventual-consistency fix, this should be rare; check bridge function logs.
