# Hosted Hub: verify deploy and empty frontmatter

Use this after changing the Hub UI (`web/hub/`), the Netlify **gateway**, or the ICP **canister**.

## 1. Static UI (4Everland / IPFS)

- Deploy the `web/` folder so `https://www.knowtation.store/hub/hub.js` returns JavaScript (not HTML).
- **Apex redirect:** `https://knowtation.store/hub/...` currently may 301 to `https://www.knowtation.store` **without** preserving `/hub/`. Prefer opening the Hub at **`https://www.knowtation.store/hub/`** until apex rules preserve the path.
- Hub scripts use a **query version** (`hub.js?v=…` in `web/hub/index.html`). Bump that value when you ship Hub JS changes so CDNs do not serve an old bundle.

## 2. Gateway (Netlify)

- Redeploy the gateway so routes include a real **`GET /api/v1/notes/facets`** that aggregates from the canister list (see `hub/gateway/server.mjs` and `hub/gateway/note-facets.mjs`).
- `CANISTER_URL` must point at the production canister you intend to use.

## 3. Canister (ICP)

- From repo root, after `main.mo` changes: `dfx deploy hub --network ic` (or your usual ICP flow). Writes use `extractFrontmatterFromPostBody` in `hub/icp/src/hub/main.mo`; if production predates object-shaped `frontmatter` support, POST may persist `{}` until you redeploy.

## 4. API probes (local machine)

With a JWT from the browser (`localStorage.hub_token` on the Hub after login):

```bash
export KNOWTATION_HUB_TOKEN='…'
node scripts/verify-hosted-hub-api.mjs
```

Optional: inspect one note and print frontmatter key summary:

```bash
export KNOWTATION_HUB_NOTE_PATH='inbox/your-note.md'
node scripts/verify-hosted-hub-api.mjs
```

Optional **write probe** (overwrites that path — use a throwaway file):

```bash
export KNOWTATION_HUB_DO_PROBE=1
export KNOWTATION_HUB_PROBE_PATH='inbox/.hub-probe-delete-me.md'
node scripts/verify-hosted-hub-api.mjs
```

List paths whose stored frontmatter parses to `{}`:

```bash
node scripts/report-empty-hosted-frontmatter.mjs
```

**Interpretation**

- If POST (probe) sends a rich `frontmatter` string but GET still shows **no keys**, fix **gateway + canister** deploy alignment, not the Hub UI alone.
- If list shows **empty frontmatter** for every note but probe **succeeds**, older notes may need **re-save** or migration.

npm scripts: `npm run verify:hosted-api` and `npm run report:empty-frontmatter`.
