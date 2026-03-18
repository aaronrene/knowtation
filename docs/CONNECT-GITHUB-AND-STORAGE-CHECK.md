# Connect GitHub fix and “empty Local Storage” — measure three times

Checklist for fixing the malformed Connect GitHub URL and Unauthorized response. See [BRIDGE-DEPLOY-AND-PREROLL.md](./BRIDGE-DEPLOY-AND-PREROLL.md) for general bridge deploy.

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
- **Bridge site redirect:** If you see "Cannot GET /auth/github-connect" on knowtation-bridge.netlify.app, the **bridge** site is still using the repo default (traffic → gateway). In **knowtation-bridge** → **Environment variables**, add **USE_BRIDGE_FUNCTION** = `true`. Redeploy the bridge site so the build writes `public/_redirects` and traffic goes to the bridge function.
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
