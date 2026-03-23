# Hosted Hub: verify deploy and empty frontmatter

Use this after changing the Hub UI (`web/hub/`), the Netlify **gateway**, or the ICP **canister**.

## 0. CORS (Netlify gateway) — fixes “Could not reach the API”

The Hub calls `https://knowtation-gateway.netlify.app` from `knowtation.store` / `www` (cross-origin). If the gateway misconfigures CORS, the browser reports **`Failed to fetch`** and the UI shows **Could not reach the API**.

1. **Set `HUB_CORS_ORIGIN` on the Netlify gateway site** (comma-separated, both hosts):

   `https://knowtation.store,https://www.knowtation.store`

2. **Redeploy** the gateway after changing env vars.

3. **Check preflight** from your machine:

   ```bash
   npm run check:gateway-cors
   ```

   You should see each origin get a **specific** `Allow-Origin` (not `*`) **with** `Allow-Credentials: true` when `HUB_CORS_ORIGIN` is set. If `HUB_CORS_ORIGIN` is unset, the gateway uses `*` **without** credentials (allowed by browsers); production should still set the env so your Hub origin matches.

See [CORS-WWW-AND-APEX.md](./CORS-WWW-AND-APEX.md).

**If the Network tab shows `304` on note `fetch`:** the browser reused a cached JSON body (often still `{}` for frontmatter after you fixed the server). The Hub uses `fetch(..., { cache: 'no-store' })` for API calls; redeploy static `web/` with that build, or in DevTools enable **Disable cache** and hard-reload to confirm fresh JSON.

## 1. Static UI (4Everland / IPFS)

- Deploy the `web/` folder so `https://www.knowtation.store/hub/hub.js` returns JavaScript (not HTML).
- **Apex redirect:** `https://knowtation.store/hub/...` currently may 301 to `https://www.knowtation.store` **without** preserving `/hub/`. Prefer opening the Hub at **`https://www.knowtation.store/hub/`** until apex rules preserve the path.
- Hub scripts use a **query version** (`hub.js?v=…` in `web/hub/index.html`). Bump that value when you ship Hub JS changes so CDNs do not serve an old bundle.
- **Same-origin API (optional):** If 4Everland (or your CDN) reverse-proxies `/api/*` to the Netlify gateway, set in `web/hub/config.js` **`window.HUB_API_BASE_URL = ''`** so `hub.js` uses `location.origin` and avoids cross-origin CORS. The proxy must forward `/api/v1/*` to the gateway with path preserved.

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

JWT from a file (no shell history): `KNOWTATION_HUB_TOKEN_FILE=/path/to/jwt.txt node scripts/verify-hosted-hub-api.mjs`.

**Full investigation (A1 + auto detail path + write probe):** runs list, facets, GET on `inbox/note-hello-world.md` if present (else first note), POST/GET probe note, then prints a line `__INVESTIGATION_JSON__ {…}` for logs/CI.

```bash
export KNOWTATION_HUB_INVESTIGATE=1
export KNOWTATION_HUB_TOKEN='…'
node scripts/verify-hosted-hub-api.mjs
```

**Deploy snapshot without JWT** (repo `canister_ids.json`, git HEAD, live gateway + raw canister `/health`):

```bash
KNOWTATION_HUB_SNAPSHOT_ONLY=1 node scripts/verify-hosted-hub-api.mjs
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

**Legacy empty rows (only if write probe shows keys on GET after POST):** minimal re-save via gateway merge (adds provenance):

```bash
export KNOWTATION_HUB_TOKEN='…'
node scripts/resave-hosted-empty-frontmatter.mjs --dry-run
node scripts/resave-hosted-empty-frontmatter.mjs --execute
```

npm scripts: `npm run verify:hosted-api`, `npm run report:empty-frontmatter`, `npm run check:gateway-cors`, `npm run investigate:hosted-hub`, `npm run hosted:deploy-snapshot`, `npm run resave:hosted-empty-fm`.

## 6. After CORS works: still `{}` under the note?

Then the API is returning empty stored frontmatter (canister/gateway write path or legacy data). Do **not** iterate on Hub list UI alone.

1. `npm run verify:hosted-api` with `KNOWTATION_HUB_TOKEN` — check `empty_frontmatter_count` and optional `KNOWTATION_HUB_DO_PROBE=1` write probe.
2. **Redeploy** the ICP canister from current `main` if production predates `extractFrontmatterFromPostBody` object support (`hub/icp/src/hub/main.mo`).
3. **Re-save** notes that were written when frontmatter stored as `{}`.
