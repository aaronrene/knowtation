# Domain and deployment — when and how

When to connect your domain and precise steps for Netlify, 4Everland, and Cloudflare.

---

## When to connect the domain

| What | When | Why |
|------|------|-----|
| **Landing page (static)** | **Now** | You have a complete landing (web/index.html). Deploy it and point your domain so the main marketing URL (e.g. knowtation.com) works. No backend required. |
| **Hosted Hub** | After hosted Hub exists | The Hub is currently self-hosted (npm run hub). When we add a hosted offering, connect a subdomain (e.g. app.knowtation.com or hub.knowtation.com) then. |

**Recommendation:** Connect the domain **now** for the **landing page only**. Build out the next phases (Help in Settings, hosted Hub when ready); add a subdomain for the app when that’s live.

---

## Option A: Netlify (static landing)

### 1. Connect repo

1. Log in at [netlify.com](https://netlify.com).
2. **Add new site** → **Import an existing project** → **GitHub**.
3. Choose **aaronrene/knowtation** (authorize Netlify if prompted).
4. **Branch:** `main`.
5. **Build command:** leave empty (static site).
6. **Publish directory:** `web` (Netlify will serve the contents of the `web` folder as the site root).
7. **Deploy site.** You’ll get a URL like `random-name.netlify.app`.

### 2. Custom domain

1. **Site settings** → **Domain management** → **Add custom domain** / **Add domain**.
2. Enter your domain (e.g. `knowtation.com`).
3. Netlify will show you what to set at your registrar:
   - **A/ALIAS (apex):** Netlify’s load balancer (e.g. `75.2.60.5`) or use their DNS.
   - **CNAME (www):** `random-name.netlify.app` (or your Netlify subdomain).
4. At your domain registrar (or Cloudflare, if DNS is there), add the A record and CNAME as Netlify instructs.
5. In Netlify, **Verify** then **Enable HTTPS** (Netlify provisions a cert).

### 3. If you use Cloudflare in front of Netlify

- Add the domain in Cloudflare (DNS only or full).
- Create a **CNAME** for `www` → your Netlify URL (e.g. `random-name.netlify.app`).
- For apex (`knowtation.com`), either:
  - **CNAME flattening** at Cloudflare: CNAME `@` → `random-name.netlify.app`, or
  - **A record** `@` → Netlify’s IP (Netlify docs list it).
- In Cloudflare, set SSL/TLS to **Full (strict)** if you use HTTPS.
- Netlify will still issue the cert; Cloudflare proxies traffic.

---

## Option B: 4Everland (static landing)

### 1. Connect repo

1. Log in at [4everland.org](https://www.4everland.org).
2. New project → **Import from GitHub** → select **aaronrene/knowtation**.
3. **Branch:** `main`.
4. **Build:** Static (no build command).
5. **Output directory:** `web`.
6. Deploy. You’ll get a 4everland.app URL.

### 2. Custom domain

1. Project → **Settings** → **Domains** → **Add custom domain**.
2. Enter your domain (e.g. `knowtation.com`).
3. 4Everland will show required DNS records (A and/or CNAME). Add them at your registrar or Cloudflare.
4. Verify and enable HTTPS in 4Everland.

### 3. With Cloudflare

Same idea as Netlify: point your domain’s DNS (in Cloudflare) to 4Everland’s target (A or CNAME per 4Everland’s instructions). Use **Full (strict)** SSL if you proxy through Cloudflare.

---

## Checklist (any provider)

- [ ] Repo connected (main branch).
- [ ] Publish directory = **web** (so `web/index.html` is served as `/`).
- [ ] Custom domain added in the provider’s UI.
- [ ] At registrar/Cloudflare: A and/or CNAME set as the provider specifies.
- [ ] DNS verified; HTTPS enabled.
- [ ] Optional: redirect `www` → apex or apex → `www` in provider or Cloudflare.

---

## Later: Hosted Hub subdomain

When the hosted Hub is ready:

1. Deploy the Hub (or its front-end) to a second site (e.g. Netlify or a Node host).
2. Add a subdomain (e.g. `app.knowtation.com` or `hub.knowtation.com`).
3. Point that subdomain’s DNS to the Hub deployment (A/CNAME as required).
4. Update the landing “Try Knowtation Hub” link to that URL when you’re ready.

No need to do this until the hosted product is built and deployed.
