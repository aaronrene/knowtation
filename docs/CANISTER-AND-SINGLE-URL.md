# Canister: how to run it · Single URL (knowtation.store)

## 1. Getting the canister running

1. **Install DFX** (Internet Computer SDK, includes Motoko compiler)  
   - https://internetcomputer.org/docs/current/developer-docs/setup/install  
   - Follow the install steps for your OS.

2. **From the repo, go to the canister directory and deploy**
   ```bash
   cd hub/icp
   dfx start          # optional: start local replica (leave running in one terminal)
   dfx deploy         # local; or: dfx deploy --network ic   for mainnet
   ```

3. **Get the canister URL**
   ```bash
   dfx canister id hub
   ```
   - **Local:** `http://localhost:4943/?canisterId=<that-id>`  
   - **IC:** `https://<that-id>.ic0.app`

4. **Use that URL as `CANISTER_URL`** in the gateway and bridge (e.g. in `.env` or Netlify env):
   ```bash
   CANISTER_URL=https://<canister-id>.ic0.app
   ```

5. **Check it works**
   ```bash
   curl -s "https://<canister-id>.ic0.app/health"
   # → {"ok":true}
   ```

After that, the **gateway** (and optionally the **bridge**) need to be running and configured with this `CANISTER_URL` so the Hub UI can talk to the canister through them.

---

## 2. Single URL: knowtation.store (no separate “top” page)

You want **one URL** (one domain) and **no separate page “at the top”** — everything lives under **knowtation.store**.

- **Landing (main page)** = `web/index.html`  
  - **Locally:** open `web/index.html` in a browser, or run a static server and open the root:
    ```bash
    # From repo root
    npx -y serve web -p 8000
    # Then open: http://localhost:8000
    ```
  - **Production:** deploy the whole `web/` folder to 4Everland and point **knowtation.store** at it.  
  - The **root** URL is then: **https://knowtation.store/** (that’s your main page = `index.html`).

- **Hub app** = same domain, under a path: **https://knowtation.store/hub/**  
  - So you only have **one domain** (knowtation.store). There is no separate “app” subdomain; the Hub is just another path on the same site.
  - “Open Knowtation Hub” on the landing should go to **https://knowtation.store/hub** (same origin).

**Deploy layout on 4Everland (one project, one URL):**

- Deploy the **entire `web/`** directory (it already contains both `index.html` at root and the `hub/` folder).
- Set custom domain **knowtation.store** to that project.
- Result:
  - **https://knowtation.store/** → landing (`index.html`)
  - **https://knowtation.store/hub/** → Hub UI  
  So yes: the “site” is the main page at that one URL; the Hub is part of the same site at `/hub`, not a different domain.

---

## 3. Gateway / API on the same URL (optional)

If you want the same domain to also serve the API (OAuth + proxy to canister):

- Use Netlify (or similar) so that **knowtation.store** serves:
  - Static files from `web/` (landing + `web/hub/`),
  - And rewrites like `/api/*` to your gateway/serverless function.
- Then set `window.HUB_API_BASE_URL = 'https://knowtation.store'` in the Hub so all API calls stay on knowtation.store (one URL for site and API).

If the API is on a different host (e.g. Netlify API subdomain), set `HUB_API_BASE_URL` to that API URL instead; the **website** is still just knowtation.store.
