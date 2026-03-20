# CORS: `www` vs apex (`knowtation.store`)

The Hub is static on **4Everland**; the API is on **Netlify** (`knowtation-gateway.netlify.app`). The browser sends a cross-origin request with an **`Origin`** header that matches **exactly** the page URL:

| You open | `Origin` header |
|----------|-----------------|
| `https://knowtation.store/hub/` | `https://knowtation.store` |
| `https://www.knowtation.store/hub/` | `https://www.knowtation.store` |

Netlify **gateway** env **`HUB_CORS_ORIGIN`** must list **every** origin users might use. If you only set the apex, opening the site on **`www`** makes `fetch('/api/v1/auth/providers')` fail CORS, and the Hub shows **“Could not reach the gateway”** with no Google/GitHub buttons.

**Set on Netlify (knowtation-gateway):**

```text
HUB_CORS_ORIGIN=https://knowtation.store,https://www.knowtation.store
```

No repo deploy is required for this—only updating Netlify environment variables and redeploying or waiting for env propagation.

**Optional:** In DNS / 4Everland, pick one canonical host (apex or www) and redirect the other so users always hit one `Origin`. You still should list both in `HUB_CORS_ORIGIN` until redirects are guaranteed for every entry path.

See also [DEPLOY-STEPS-ONE-PAGE.md](./DEPLOY-STEPS-ONE-PAGE.md) §6 (CORS).
