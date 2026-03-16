# Deploy steps (one page) — domain, 4Everland, Netlify

You have: your domain (e.g. **knowtation.store**), 4Everland account, Netlify account.

---

## Step 1 — Deploy the canister (ICP)

1. **If you don’t have DFX yet:** install it from https://internetcomputer.org/docs/current/developer-docs/setup/install  
   **If you already have DFX** (e.g. you’ve built canisters before): skip install; just run `dfx --version` to confirm, then continue.
2. In a terminal:
   ```bash
   cd hub/icp
   dfx deploy --network ic
   ```
3. Get the canister URL:
   ```bash
   dfx canister id hub
   ```
   Your **CANISTER_URL** = `https://<that-id>.ic0.app`  
   Check: `curl -s "https://<that-id>.ic0.app/health"` → `{"ok":true}`

   **If you see `client_domain_canister_mismatch`:** Try **CANISTER_URL** = `https://<canister-id>.icp0.io` in the gateway (and try `curl` against that URL).

   **If you see `backend_response_verification` / "Certification values not found":** The canister doesn’t implement HTTP response certification yet. Use the **raw** domain so the gateway skips verification: **CANISTER_URL** = `https://<canister-id>.raw.icp0.io` (or `https://<canister-id>.raw.ic0.app`). Check: `curl -s "https://<canister-id>.raw.icp0.io/health"` → `{"ok":true}`. Use this URL in the gateway; server-side calls are fine with raw.

---

## Step 2 — Cloudflare and DNS (so knowtation.store points to 4Everland)

**2A. Onboard knowtation.store to Cloudflare (if it’s not there yet)**

1. In **Cloudflare** (dash.cloudflare.com): **Domains** → **Onboard a domain**.
2. Enter **knowtation.store** and continue. Cloudflare will show **two nameservers** (e.g. `xxx.ns.cloudflare.com` and `yyy.ns.cloudflare.com`). Copy them or keep the page open.
3. In **Namecheap**: **Domain List** → **knowtation.store** → **Domain** tab → **NAMESERVERS**.
4. Change from "Namecheap BasicDNS" to **Custom DNS** and enter the two Cloudflare nameservers. Save.
5. Wait for DNS to propagate (often 5–30 minutes; up to 48 hours). When Cloudflare shows the domain as **Active**, you’ll manage DNS for knowtation.store in Cloudflare.

**2B. Add the record 4Everland gives you (do this after Step 3)**

After you add the custom domain in 4Everland (Step 3), 4Everland will show a **CNAME** (or A) to add:

1. In **Cloudflare** → **knowtation.store** → **DNS** → **Records**.
2. **Add record**: Type **CNAME**, Name **@** (or **knowtation.store**), Target = the value 4Everland showed (e.g. `e9bd0f1502a74805830c.cname.ddnsweb3.com`). **Proxy status**: use **DNS only** (grey cloud) until 4Everland has verified the domain—proxied CNAMEs hide the target and break verification. Add the **TXT** record 4Everland shows as well (Name **@**, Content `dns.verify=...`). Save.
3. Add the **www** CNAME the same way (Name **www**, Target from 4Everland), also **DNS only** for verification.
4. When the records are active, in 4Everland click **Refresh** next to each domain. After the domain shows as valid and **https://knowtation.store** works, you can optionally switch the CNAMEs to **Proxied** in Cloudflare; if the site stops working, set them back to **DNS only**.

---

## Step 3 — Deploy the website (4Everland)

1. Log in to **4Everland**. Create a **new project**.
2. Connect your **Git repo** (or upload the `web/` folder).
   - If from Git: set **root/build directory** so the **site root** is the contents of `web/` (e.g. root dir = `web` so that `index.html` is at the site root).
   - So after deploy: `https://your-site.4everland.app/` shows the landing and `https://your-site.4everland.app/hub/` shows the Hub.
3. Deploy (trigger build/deploy).
4. Add **custom domain**: **knowtation.store**. 4Everland will show you the DNS record to add (if you didn’t in Step 2). Wait until the domain is verified and the site loads at **https://knowtation.store/** and **https://knowtation.store/hub/**.

---

## Step 4 — Set the Hub’s API URL (so the Hub can call the gateway)

1. In the repo, open **web/hub/config.js**.
2. Uncomment the line and set your **gateway URL** (from Step 5), e.g.:
   ```js
   window.HUB_API_BASE_URL = 'https://knowtation-gateway.netlify.app';
   ```
3. Commit and push so 4Everland redeploys (or re-upload `web/` so `config.js` is included).  
   The Hub at **https://knowtation.store/hub/** will use this URL for all API calls.

---

## Step 5 — Deploy the gateway (and bridge) on Netlify

1. The **gateway** is a Node app in **hub/gateway/** (Express). Netlify can run it as a **serverless function** or you deploy the Node app to a service Netlify supports (e.g. “Netlify Functions” with an adapter, or a separate Node host and use Netlify for something else).  
   **Simplest:** Deploy the gateway to a **Node host** (e.g. Railway, Fly.io, or a Netlify serverless setup if you have one). Get the public URL (e.g. **https://knowtation-gateway.netlify.app**).
2. Set **environment variables** on that host:
   - **CANISTER_URL** = from Step 1: `https://<canister-id>.ic0.app`, or if that fails use `https://<canister-id>.raw.icp0.io` (bypasses response verification)
   - **SESSION_SECRET** = a long random string (for JWT signing)
   - **HUB_BASE_URL** = your gateway’s public URL (e.g. `https://knowtation-gateway.netlify.app`)
   - **HUB_UI_ORIGIN** = `https://knowtation.store`
   - **GOOGLE_CLIENT_ID**, **GOOGLE_CLIENT_SECRET** (and **GITHUB_*** if you use GitHub login)
3. Optional: deploy the **bridge** (hub/bridge/) the same way; set **BRIDGE_URL** on the gateway to that URL so the gateway can proxy vault/sync and search.
4. Note the **gateway URL** and use it in **Step 4** for `HUB_API_BASE_URL`.  
   In **Google Cloud Console** (and GitHub OAuth app): set the OAuth **callback URL** to  
   `https://YOUR-GATEWAY-URL/api/v1/auth/callback/google` (and `/callback/github` for GitHub).

---

## Step 6 — CORS (if the Hub and gateway are on different domains)

If the Hub is at **https://knowtation.store** and the gateway is at **https://something.netlify.app**, set on the **gateway** host:

- **HUB_CORS_ORIGIN** = `https://knowtation.store`

So the browser allows the Hub to call the gateway.

---

## Step 7 — Quick check

1. Open **https://knowtation.store/** → landing.  
2. Click “Open Knowtation Hub” → **https://knowtation.store/hub/**.  
3. Sign in with Google or GitHub → you should get a JWT and see the Hub.  
4. If login fails: check OAuth callback URLs and **HUB_BASE_URL** / **HUB_UI_ORIGIN** and **HUB_CORS_ORIGIN**.

---

**Summary order:** Canister (1) → DNS + 4Everland (2, 3) → Gateway on Netlify/Node (5) → Hub config (4) → CORS (6) → Test (7).
