# Bridge deploy and pre-roll — clarity and steps

This doc clarifies: (1) what **pre-roll** is, (2) how to deploy the **bridge** in detail (including “another Netlify project”), and (3) **PR / branch** strategy for Phase 2.

---

## 1. What pre-roll is (no new site or page)

**Pre-roll is not a new site, new landing page, or new URL.** It is a **checklist** you run through to confirm that your **existing** hosted stack is ready for production.

- **Same site:** knowtation.store (landing + Hub) stays as it is. 4Everland keeps serving it. The gateway stays at knowtation-gateway.netlify.app. Nothing new goes live for “pre-roll.”
- **What you do:** Open [DEPLOY-HOSTED.md](./DEPLOY-HOSTED.md) §5 (Pre-roll checklist) and tick each item **after** you’ve verified it yourself:
  - Canister deployed and healthy (e.g. `curl` the canister `/health`).
  - Gateway env set; OAuth callbacks registered.
  - **Bridge** env set; GitHub OAuth callback for Connect GitHub registered (only relevant once the bridge is deployed).
  - Hub UI deployed with correct `HUB_API_BASE_URL`.
  - Landing deployed; “Open Knowtation Hub” points to the Hub URL.
  - No secrets in repo or client bundle.

When every item is checked, **pre-roll is done** for the hosted stack. No new page, no new site — just verification of what’s already there (plus bridge, once you add it).

---

## 2. Deploying the bridge in detail

The bridge is the Node app in `hub/bridge/`. It provides Connect GitHub, Back up now, and index/search. The **gateway** (knowtation-gateway.netlify.app) does not run this code; it only **proxies** to the bridge when you set **BRIDGE_URL** in the gateway’s env. So you need the bridge running somewhere and its URL in the gateway.

### Option A — Second Netlify project (same repo, mostly variables + one redirect)

Yes: it’s **another Netlify site** from the **same repo**, with **different env variables** and **one different setting** (redirect target).

- **Same repo, same build:** The repo has `netlify/functions/bridge.mjs` (wraps `hub/bridge/server.mjs`) and the root `netlify.toml` build installs both gateway and bridge deps (`cd hub/gateway && npm ci && cd ../bridge && npm ci`). So every build produces **both** functions (gateway and bridge). The first Netlify site sends traffic to the gateway function; the second sends traffic to the bridge function.
- **First Netlify site (gateway):** knowtation-gateway.netlify.app. Uses the repo’s `netlify.toml`: all traffic goes to `/.netlify/functions/gateway`. Env: CANISTER_URL, SESSION_SECRET, HUB_BASE_URL, HUB_UI_ORIGIN, HUB_CORS_ORIGIN, OAuth, and optionally BRIDGE_URL.
- **Second Netlify site (bridge):** Create a **new** site in Netlify, connect the **same** GitHub repo and branch. Use the bridge-specific config so redirects do not depend on `public/_redirects`. The only differences:
  1. **Package directory:** In the **second** site's Netlify dashboard → **Build & deploy** → **Continuous deployment** → **Build settings** → **Configure**, set **Package directory** to `deploy/bridge`. Leave **Base directory** empty. Netlify will use [deploy/bridge/netlify.toml](../deploy/bridge/netlify.toml), which sends all traffic to `/.netlify/functions/bridge/:splat` (path preserved). No `_redirects` file or **USE_BRIDGE_FUNCTION** env var needed for routing.
  2. **Env variables:** In the **second** site’s dashboard, set the **bridge** env vars (see below). Do **not** set BRIDGE_URL here — BRIDGE_URL goes on the **gateway** site and must be the **URL of this second site** (e.g. `https://knowtation-bridge.netlify.app`).

So: **two Netlify sites, one repo, one build; difference = Package directory (bridge uses deploy/bridge) + env (and BRIDGE_URL on the first site pointing to the second).**

**Bridge env on the second Netlify site:**

| Variable | Value |
|----------|--------|
| **CANISTER_URL** | `https://rsovz-byaaa-aaaaa-qgira-cai.raw.icp0.io` (same as gateway; use raw URL) |
| **SESSION_SECRET** or **HUB_JWT_SECRET** | **Must be identical to the gateway.** If they differ, the bridge returns 401 for github-status and Settings will show "GitHub: Not connected" after Connect GitHub. Check gateway logs for `[gateway] bridge github-status non-ok 401` to confirm. |
| **HUB_BASE_URL** | The **bridge** site URL, e.g. `https://knowtation-bridge.netlify.app` (for OAuth callback) |
| **HUB_UI_ORIGIN** | Where to send the user after Connect GitHub. **Must match the host you use:** if you use `https://www.knowtation.store`, set `https://www.knowtation.store`; if you use `https://knowtation.store`, set that. Otherwise the redirect can land on the wrong host and you may see the landing page instead of the Hub. |
| **GITHUB_CLIENT_ID**, **GITHUB_CLIENT_SECRET** | For “Connect GitHub” (can be same app as gateway or a separate GitHub App) |
| **DATA_DIR** | Persistent dir for tokens and per-user vector DBs; on Netlify use a path your function can write to or omit if not persistent (search/index may not persist across invocations unless you add external storage) |
| **EMBEDDING_PROVIDER**, **OPENAI_API_KEY** (or **OLLAMA_URL**) | For index/search; if not set, search/index may fail until configured |

After the second site is live, in the **gateway** site’s env add:

- **BRIDGE_URL** = `https://knowtation-bridge.netlify.app` (or whatever the second site’s URL is). **Must be the bridge origin only:** no trailing slash, no path. If BRIDGE_URL includes a path, the Connect GitHub redirect becomes malformed and returns Unauthorized.

Then the Hub at knowtation.store/hub/ will use Connect GitHub, Back up now, and search via the gateway → bridge.

**GitHub OAuth for Connect GitHub:** In your GitHub App (or OAuth App) add a callback URL for the **bridge**: e.g. `https://knowtation-bridge.netlify.app/auth/callback/github-connect`. That’s the only “new” callback; the gateway’s login callback stays as is.

### Option B — Railway, Render, or other Node host

Deploy `hub/bridge/` as a normal Node server:

- Connect the repo. Set start command to `node hub/bridge/server.mjs` (or `cd hub/bridge && npm install && npm start`) and root to repo root (or set working dir to `hub/bridge`).
- Set the same bridge env vars as in the table above; **HUB_BASE_URL** = the URL this host gives you (e.g. `https://knowtation-bridge.up.railway.app`).
- Set **BRIDGE_URL** on the gateway to that URL.
- Register the bridge’s callback URL in GitHub (e.g. `https://knowtation-bridge.up.railway.app/auth/callback/github-connect`).

No second Netlify site; the bridge is just another service with its own URL and variables.

---

## 3. Pre-roll after the bridge is up

Again: pre-roll is **only** going through the checklist; it doesn’t add a new page.

1. Canister: `curl https://rsovz-byaaa-aaaaa-qgira-cai.raw.icp0.io/health` → `{"ok":true}`.
2. Gateway: env set, OAuth callbacks for **gateway** login working (sign-in at knowtation.store/hub/ works).
3. Bridge: bridge deployed, env set, **BRIDGE_URL** set on gateway, GitHub callback for **bridge** (Connect GitHub) registered. Test: in Hub, Connect GitHub and Back up now (and search if you use it).
4. Hub UI: knowtation.store/hub/ loads and uses `HUB_API_BASE_URL` (already in config.js).
5. Landing: knowtation.store/ has “Open Knowtation Hub” pointing to the Hub.
6. No secrets in repo or client.

When all are verified, pre-roll is complete. Then do a **rebuild** of the gateway (and 4Everland if you want latest web/) if you haven’t already.

---

## 4. PR and branch strategy

- **Stay on the same branch** for Phase 2: e.g. `feature/parity-phase-2-follow-up`. All Phase 2 work (parity, docs, exact state, bridge deploy instructions, and the bridge Netlify function if we add it) belongs to the same “Phase 2” scope.
- **Do the PR now** (or as soon as your current doc/code changes are ready): open a PR from this branch to `main`. The PR should include:
  - Doc updates (EXACT-STATE-PHASE2, DEPLOY-STEPS, IMPLEMENTATION-PLAN, STATUS-*, BRIDGE-DEPLOY-AND-PREROLL, etc.).
  - Any code added for Phase 2 (e.g. `netlify/functions/bridge.mjs` if we add it so the second Netlify site can serve the bridge).
- **After the PR is merged:** Do the **operational** steps: deploy the bridge (second Netlify site or Railway), set env and BRIDGE_URL, run the pre-roll checklist, then trigger gateway (and 4Everland) rebuild if needed.
- You do **not** need a separate branch for “bridge deploy” or “pre-roll” — those are things you do in Netlify/dashboards and with the checklist, not new branches. A separate branch only makes sense if you later do a different feature (e.g. Phase 3 multi-vault).

**Summary:** One branch for Phase 2 → one PR → merge → then deploy bridge and run pre-roll (and rebuilds). No new page for pre-roll; pre-roll is just the checklist.
