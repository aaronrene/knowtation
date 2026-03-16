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
   - **HUB_CORS_ORIGIN** = `https://knowtation.store,https://www.knowtation.store` (required for Hub on a different domain; without it the Hub shows “Could not reach the gateway” and no sign-in buttons)
   - **GOOGLE_CLIENT_ID**, **GOOGLE_CLIENT_SECRET** (and **GITHUB_*** if you use GitHub login)
3. Optional: deploy the **bridge** (hub/bridge/) the same way; set **BRIDGE_URL** on the gateway to that URL so the gateway can proxy vault/sync and search.
4. Note the **gateway URL** and use it in **Step 4** for `HUB_API_BASE_URL`.  
   In **Google Cloud Console** (and GitHub OAuth app): set the OAuth **callback URL** to
   `https://YOUR-GATEWAY-URL/auth/callback/google` (and `/auth/callback/github` for GitHub). The gateway uses `/auth/callback/...`, not `/api/v1/auth/callback/...`.
   **Production vs localhost:** If you previously only had localhost callbacks, add the **gateway** URLs above for the live site. **Google:** you can add multiple redirect URIs to the same OAuth client (keep localhost for dev, add the gateway URL)—same client ID/secret. **GitHub:** each app has one callback URL; either change it to the gateway URL for production (localhost login will break until you change it back), or create a second GitHub OAuth App for production with the gateway callback and put that app’s client ID/secret in Netlify so dev and prod use different apps.

---

## Step 6 — CORS (required when Hub and gateway are on different domains)

The Hub (e.g. **https://knowtation.store/hub/**) calls the gateway from the browser. With credentials, the gateway **must** send an explicit `Access-Control-Allow-Origin` (not `*`). If **HUB_CORS_ORIGIN** is not set in Netlify, the Hub will show “Could not reach the gateway” and no Google/GitHub sign-in buttons.

**In Netlify** (Site → Site configuration → Environment variables), add:

- **HUB_CORS_ORIGIN** = `https://knowtation.store,https://www.knowtation.store`

(Use one or both origins depending on how users reach your site. Comma-separated list is supported.)

Then **Save** and **Trigger deploy** (or wait for the next deploy) so the gateway uses the new env.

---

## Step 7 — Quick check

1. Open **https://knowtation.store/** → landing.  
2. Click “Open Knowtation Hub” → **https://knowtation.store/hub/**.  
3. Sign in with Google or GitHub → you should get a JWT and see the Hub.  
4. If login fails: check OAuth callback URLs and **HUB_BASE_URL** / **HUB_UI_ORIGIN** and **HUB_CORS_ORIGIN**.

---

## Password protection (keep site private until launch)

4Everland does **not** offer built-in password protection for static hosting. To restrict access to **knowtation.store** (landing + Hub) until you’re ready to go public, use one of these:

**Option A — Cloudflare Access (recommended)**  
Protects the whole site at the edge; free for up to 50 users.

1. In **Cloudflare** → **Zero Trust** (or **Workers & Pages** → **Access**): open **Access** → **Applications**.
2. **Add an application**: Application type **Self-hosted**; name e.g. `Knowtation`.  
   **Session Duration** e.g. 24 hours.  
   **Application domain**: `knowtation.store` (and add `www.knowtation.store` if you use it).
3. Under **Policies**, add a policy: **Action** = Allow; **Include** = **Emails** and list the email addresses that may access the site (or use **One-time PIN** so users get a PIN by email).
4. Save. Visitors to knowtation.store will see a Cloudflare Access login page; after they pass the policy they can use the landing and **https://knowtation.store/hub/** as usual.

**Option B — Simple shared password (weaker)**  
For a single shared password without Cloudflare: you could use a static-site password tool (e.g. [StatiCrypt](https://github.com/robinmoisson/staticrypt)) at build time to encrypt the HTML, or add a client-side gate (password in sessionStorage). These are not strong security—use only for “soft launch” and switch to Access or remove the gate when you go public.

---

## Hub account setup (the app at knowtation.store/hub/)

The **Hub** is the app at **https://knowtation.store/hub/** (same domain as the landing, path `/hub/`). There is no separate “hub account” product—**your account is created the first time you sign in** with Google or GitHub from that page.

**What you need in place**

1. **Gateway deployed** (Step 5) with env: **CANISTER_URL**, **SESSION_SECRET**, **HUB_BASE_URL**, **HUB_UI_ORIGIN**, **GOOGLE_CLIENT_ID**, **GOOGLE_CLIENT_SECRET** (and **GITHUB_*** if you want GitHub login). **HUB_CORS_ORIGIN** = `https://knowtation.store` (Step 6).
2. **OAuth callback URLs** (in Google Cloud Console and GitHub OAuth app) set to your **gateway** URL, e.g.
   `https://knowtation-gateway.netlify.app/auth/callback/google`
   `https://knowtation-gateway.netlify.app/auth/callback/github`
3. **web/hub/config.js** (Step 4): `window.HUB_API_BASE_URL = 'https://knowtation-gateway.netlify.app';` (or your real gateway URL), committed and deployed so 4Everland serves it.

**How users “set up” their Hub account**

1. Open **https://knowtation.store/** → click **Try Knowtation Hub** (or go directly to **https://knowtation.store/hub/**).
2. Click **Continue with Google** or **Continue with GitHub**.
3. They’re sent to the gateway for OAuth; after approving, they’re redirected back to the Hub with a JWT. **That first sign-in is their account**—no separate sign-up. They can then use the Hub (search, notes, proposals, settings).

If you added Cloudflare Access (password protection), users will see the Access screen first, then the Hub login screen.

---

**Summary order:** Canister (1) → DNS + 4Everland (2, 3) → Gateway on Netlify/Node (5) → Hub config (4) → CORS (6) → Test (7). Optional: Password protection (Cloudflare Access). Hub “account” = first sign-in at knowtation.store/hub/.
