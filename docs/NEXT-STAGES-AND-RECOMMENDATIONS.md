# Next stages and recommendations

This doc summarizes **what was built** in this phase (Setup wizard + Connect GitHub for self-hosted), **what remains** to complete or augment the product, and **recommended next steps**.

---

## What was built in this phase

### B: Setup wizard (self-hosted)

- **Config merge:** `lib/config.mjs` loads `data/hub_setup.yaml` (if present) and merges `vault_path` and `vault.git` over `config/local.yaml`. So the Hub can change vault and Git settings without editing the main config file.
- **API:**  
  - `GET /api/v1/setup` — returns current `vault_path` and `vault_git` (for the form).  
  - `POST /api/v1/setup` — body `{ vault_path?, vault_git?: { enabled, remote } }`; writes to `data/hub_setup.yaml`, then reloads config in memory so no restart is needed.
- **UI:** In **Settings**, a **Setup** section with: Vault path (text), Git backup enabled (checkbox), Git remote URL (text), **Save setup** button. Values load from GET /setup; save runs POST /setup and refreshes the status block.
- **Security:** Same as rest of Hub: only authenticated users (JWT) can call the API. Anyone who can log in can change setup; for stricter control you’d add roles later.

### A (self-hosted): Connect GitHub

- **OAuth flow:**  
  - `GET /api/v1/auth/github-connect` — redirects to GitHub with `scope=repo` and signed `state`.  
  - `GET /api/v1/auth/callback/github-connect` — verifies state, exchanges `code` for `access_token`, saves to `data/github_connection.json`, redirects to Hub with `?github_connected=1` (or `?github_connect_error=...` on failure).
- **Uses same GitHub app as login:** Same `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`; add the callback URL `http(s)://your-hub/api/v1/auth/callback/github-connect` in the GitHub OAuth App settings.
- **Settings UI:** If `GITHUB_CLIENT_ID` is set, Settings shows **Connect GitHub** (link to the connect flow) and status “Connected (token stored for push)” when a token exists. Toasts on return: “GitHub connected…” or the error message.
- **Vault sync uses token:** `lib/vault-git-sync.mjs` reads `data/github_connection.json` when present. For `git push` it temporarily sets `origin` to `https://x-access-token:TOKEN@github.com/...`, pushes, then restores the original URL. So “Back up now” and auto-sync work without the user pasting a token or setting a deploy key.

**Together:** Users can set the repository in two ways: (1) **Setup** form (vault path + Git remote URL), or (2) **Connect GitHub** to store a token so push works without manual credentials. They can use one or both.

---

## What remains to augment or complete

### 1. Full hosted product (Option A — “we run the app”)

- **Multi-tenant backend:** One deployment; each tenant has its own vault (and optional GitHub link). Today we have a single vault per Hub instance.
- **Auth we control:** Sign-up, login, password reset or OAuth we register (no user-configured OAuth). Today self-hosted uses the deployer’s Google/GitHub OAuth.
- **Vault storage we control:** Vault content in our DB or object store (or one Git repo per tenant we create). No user-supplied `vault_path`.
- **Connect GitHub in hosted:** Same OAuth idea, but tenant-scoped: store repo + token per tenant in our DB, push to their repo from our backend. The flow we built (connect callback + token storage) is the pattern; for hosted we’d swap “file in data_dir” for “row in tenants table.”
- **Billing and limits:** Metering (notes, storage, API calls), plans, upgrade path. Not started.

See [HOSTED-PLUG-AND-PLAY.md](./HOSTED-PLUG-AND-PLAY.md) and [NEXT-PHASE-SETUP-OPTIONS.md](./NEXT-PHASE-SETUP-OPTIONS.md).

### 2. Security and hardening

- **Setup / config write:** Today any logged-in user can POST /setup. Optional: restrict to “first user,” “admin” flag, or separate setup token.
- **GitHub token storage:** `data/github_connection.json` is plaintext. Optional: encrypt at rest with a key from env, or use a secrets manager in production.
- **Audit:** We have audit log for approve/discard. Optional: log setup changes and Connect GitHub (success/failure) for compliance.

### 3. UX and polish

- **Responsive Hub:** Layout and touch targets for small screens (see backlog).
- **Loading and empty states:** Consistent “Loading…” and empty copy where still missing.
- **Re-index after setup change:** If user changes vault path in Setup, the indexer still points at the old path until restart or re-index. We could trigger a re-index after setup save when vault_path changes, or show a note “Re-index or restart to update search.”
- **Connect GitHub callback URL in docs:** Document that the GitHub OAuth App must list both the login callback and the connect callback URL.

### 4. Phase 12 (blockchain / agent payments)

- Reserved frontmatter and config are in place; no implementation yet. See SPEC §2.4 and [BLOCKCHAIN-AND-AGENT-PAYMENTS.md](./BLOCKCHAIN-AND-AGENT-PAYMENTS.md).

### 5. Testing and reliability

- **Unit/integration tests:** Hub API (setup, settings, vault sync, Connect callback), config merge, vault-git-sync with and without token. Today coverage is minimal.
- **E2E:** One or two flows (e.g. login → create note → setup → backup) to guard regressions.

### 6. Documentation

- **How to use:** Step 6 and Settings already mention Setup and “Back up now.” Add one sentence: “For push without a deploy key, use **Connect GitHub** in Settings (requires the same GitHub OAuth App with an extra callback URL).”
- **DEPLOYMENT.md:** Add a line about `data/hub_setup.yaml` and `data/github_connection.json` (do not commit; already under data/ in .gitignore).
- **HUB-API.md:** Document GET/POST /api/v1/setup (editable setup) and the Connect GitHub routes (redirect and callback).

---

## Recommended order of next steps

1. ~~**Document and ship:**~~ **Done.** How to use (and optionally HUB-API, DEPLOYMENT) with Setup and Connect GitHub, then treat this phase as done for self-hosted.
2. ~~**Optional hardening:**~~ **Done.** HUB_ALLOW_SETUP_WRITE=false disables POST /api/v1/setup (403). Encrypt GitHub token at rest remains optional.
3. ~~**Re-index note:**~~ **Done.** After Setup save, the UI shows “If you changed the vault path, run Re-index or restart the Hub so search uses the new path.”
4. ~~**Tests:**~~ **Done.** test/config.test.mjs and test/hub-setup.test.mjs cover config merge and hub-setup (read/write, validation, merge).
5. ~~**Responsive and polish:**~~ **Done.** Responsive Hub (breakpoints 768px / 480px, touch targets ≥44px, stacked layout on small screens). Loading states (notes, proposals, activity, search, calendar, dashboard, settings). Empty states (no notes, no proposals suggested/discarded, no activity, no search results).
6. **Hosted:** When ready, implement multi-tenant backend and auth; reuse the Connect GitHub flow with tenant-scoped storage. Then billing and limits.

---

## Quick reference: new and touched files

| Area | Files |
|------|--------|
| Config merge | `lib/config.mjs` (hub_setup.yaml merge) |
| Setup read/write | `lib/hub-setup.mjs` (new) |
| GitHub token | `lib/github-connection.mjs` (new) |
| Vault sync + token | `lib/vault-git-sync.mjs` (readConnection, pushWithOptionalToken) |
| Hub API | `hub/server.mjs` (GET/POST /setup, GET /settings github_*, github-connect routes) |
| Hub UI | `web/hub/index.html` (Setup form, Connect GitHub row), `web/hub/hub.js` (setup load/save, Connect link, toasts), `web/hub/hub.css` (settings form styles) |
