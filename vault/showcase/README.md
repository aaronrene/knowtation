---
title: Hub showcase vault
project: showcase
tags: [demo, welcome]
date: 2026-03-21
---

# Showcase notes (demo)

This folder ships with the repo so **self-hosted** users see varied paths, projects, tags, and layouts as soon as they open the Hub (point `vault_path` at the repo `vault/`).

**Hosted (canister):** each account starts with an empty vault. Push the same files to your cloud vault once after login:

```bash
cd /path/to/knowtation
KNOWTATION_HUB_URL="https://YOUR-GATEWAY" KNOWTATION_HUB_TOKEN="YOUR_JWT" npm run seed:hosted-showcase
```

Copy the JWT from the browser (localStorage `hub_token` after sign-in) or from the `?token=` query after OAuth redirect.

See [docs/SHOWCASE-VAULT.md](../../docs/SHOWCASE-VAULT.md).
