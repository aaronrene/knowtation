# Deploying the hosted product (Phase 5)

This doc covers production deployment: 4Everland for static UI and landing, gateway and bridge (e.g. Netlify or a Node host), and DNS/domains.

**Already live (knowtation.store)?** The stack is **in production** — see [STATUS-HOSTED-AND-PLANS.md](./STATUS-HOSTED-AND-PLANS.md) for current truth and gaps. Use this file as **reference** when changing hosts or env, and use **§5** below as a **re-verification** checklist after deploys (not as proof the site was never shipped).

**Before first-time deploy:** Ensure [Parity Plan Phase 1](./PARITY-PLAN.md) is merged (gateway stubs for roles, invites, setup) so the Hub Settings → Team and Setup work on hosted.

---

## 1. Architecture (production) — single URL: knowtation.store

- **One domain: knowtation.store** — Deploy the full `web/` folder to 4Everland; set custom domain **knowtation.store**. No separate subdomain for the app.
  - **Landing (main page):** `https://knowtation.store/` → `web/index.html`.
  - **Hub UI:** `https://knowtation.store/hub/` → `web/hub/`. "Open Knowtation Hub" on the landing links to `https://knowtation.store/hub/`.
- **Gateway** — OAuth + proxy to canister. Deploy to Netlify (or same host). Ideally same origin as the site (e.g. `https://knowtation.store` with rewrites so `/api/*` hits the gateway) so CORS and cookies work without extra config.
- **Bridge** — GitHub connect + Back up now + index/search. Same host as gateway or separate; gateway proxies `/api/v1/vault/*`, `/api/v1/search`, `/api/v1/index` to the bridge when `BRIDGE_URL` is set.
- **Canister** — Deployed on ICP (e.g. `dfx deploy --network ic`). Gateway calls canister at `CANISTER_URL` (e.g. `https://<canister-id>.ic0.app`).

---

## 2. 4Everland: one project, one URL (knowtation.store)

1. **Deploy the whole `web/` folder**  
   to a single 4Everland project (root = `web/`). That gives you:
   - `https://knowtation.store/` → landing (`index.html`)
   - `https://knowtation.store/hub/` → Hub UI (`hub/index.html` and assets).
2. **Custom domain**  
   - Point **knowtation.store** to that 4Everland project. No separate subdomain; one URL for the whole site.

3. **Hub API base URL**  
   - So the Hub at `/hub/` can call the gateway: set `window.HUB_API_BASE_URL = 'https://knowtation.store';` (if the gateway is on the same origin) or your Netlify API URL, via a `config.js` loaded before `hub.js` in `web/hub/`, or at deploy time.

4. **Landing CTA**  
   - "Open Knowtation Hub" in `web/index.html` points to `https://knowtation.store/hub/` (same origin).

---

## 3. Gateway + bridge

**Netlify catch-all → function URL must preserve the path.** The build runs `scripts/netlify-redirects.mjs`, which writes `public/_redirects` (that file is gitignored—each deploy generates it). The gateway line must be `/* /.netlify/functions/gateway/:splat 200` (not `.../gateway 200` without `:splat`). Without `:splat`, every browser request is rewritten to the function root, `proxyToCanister` calls the canister with the wrong path, and the canister returns JSON `{"error":"Not found","code":"NOT_FOUND"}` (404) for `/api/v1/notes` and note creation.

**Monorepo / two Netlify sites:** Do **not** add a catch-all `[[redirects]]` in the **root** `netlify.toml`. Netlify merges root file-based config into **every** site linked to the repository, which would send the **bridge** deploy to the gateway function. Catch-all routing for the gateway site comes **only** from generated `public/_redirects` with `USE_BRIDGE_FUNCTION` **unset**. The **bridge** site uses [deploy/bridge/netlify.toml](../deploy/bridge/netlify.toml) (set **Package directory** to `deploy/bridge`, **Base directory** empty): that file sets `[build.environment] USE_BRIDGE_FUNCTION=true` so the same script writes the bridge line, and it keeps a site-local `[[redirects]]` to `/.netlify/functions/bridge/:splat`. In `deploy/bridge/netlify.toml`, `functions` and `publish` are relative to the **repository root** (Netlify’s default base directory), not to the `deploy/bridge` folder.

The gateway strips `/.netlify/functions/gateway` from `req.url` when present so Express still matches `/api/v1/*` routes.

- **Option A — Same origin (recommended for one URL)**  
  Deploy gateway so it is served from the same origin as the site (e.g. **knowtation.store**). For example: Netlify or 4Everland serves static files from `web/` and rewrites `/api/*` to the gateway. Then `HUB_API_BASE_URL = 'https://knowtation.store'` and all API calls are same-origin.

- **Option B — Separate API host**  
  Gateway on a different host (e.g. Netlify function URL). Set `HUB_API_BASE_URL` to that URL. Configure CORS on the gateway: **`HUB_CORS_ORIGIN`** must include **both** `https://knowtation.store` and `https://www.knowtation.store` if users can open either (see [CORS-WWW-AND-APEX.md](./CORS-WWW-AND-APEX.md)).

**Gateway env (production):**

- `CANISTER_URL` — e.g. `https://<canister-id>.ic0.app`
- `SESSION_SECRET` or `HUB_JWT_SECRET` — strong secret for JWTs
- `HUB_BASE_URL` — public URL of the gateway (e.g. `https://knowtation.store` if same origin)
- `HUB_UI_ORIGIN` — origin of the Hub UI (e.g. `https://knowtation.store`)
- `BRIDGE_URL` — URL of the bridge if separate (e.g. `https://bridge.knowtation.com`); gateway then proxies vault/sync, search, index to bridge
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` — OAuth (callback URLs must match `HUB_BASE_URL` and bridge callback URL)
- `HUB_ADMIN_USER_IDS` (optional) — Comma-separated user IDs (e.g. `google:123,github:456`) who get role **admin** on hosted; everyone else gets **member**. Enables Edit and Team tab for designated admins. See [hub/gateway/README.md](../hub/gateway/README.md).
- **Proposal LLM (optional):** `KNOWTATION_HUB_PROPOSAL_REVIEW_HINTS=1` — async review hints after create (gateway → canister). `KNOWTATION_HUB_PROPOSAL_ENRICH=1` — **`POST /api/v1/proposals/:id/enrich`** on the gateway (LLM + canister write). Requires a **reachable** chat API on the gateway host (**`OPENAI_API_KEY`**, or **`ANTHROPIC_API_KEY`**, not localhost Ollama on Netlify). **Deploy the `hub` canister** from this repo **before** enabling hosted Enrich so stable storage includes enrich fields: **V4** added base enrich columns; **V5** adds **`assistant_suggested_frontmatter_json`** for structured suggested metadata. Canisters still on pre–V4 storage must upgrade through a release that runs the **V4** migration first, then **V5** (see [hub/icp/src/hub/Migration.mo](../hub/icp/src/hub/Migration.mo)). See [HUB-PROPOSAL-LLM-FEATURES.md](./HUB-PROPOSAL-LLM-FEATURES.md).
- **AIR attestation (optional):** `ATTESTATION_SECRET` — signing secret for the built-in attestation endpoint (32+ characters, never committed). When set, the gateway auto-configures `KNOWTATION_AIR_ENDPOINT` to its own `POST /api/v1/attest` route. All note writes through the gateway are then attested: each write receives a unique `air_id` backed by an HMAC-SHA256 signed record stored in Netlify Blobs. Verify any attestation via `GET /api/v1/attest/:id`. If `KNOWTATION_AIR_ENDPOINT` is also set explicitly, the explicit value takes precedence (use this to point at an external attestation service instead of the built-in one). See [AIR-IMPROVEMENTS-PLAN.md](./AIR-IMPROVEMENTS-PLAN.md) §D.
- **AIR ICP blockchain anchor (optional, requires Improvement D):** Anchors every attestation record on an immutable ICP canister. Once anchored, records cannot be altered or deleted — even by the operator. Third parties can verify directly on-chain. See [AIR-IMPROVEMENTS-PLAN.md](./AIR-IMPROVEMENTS-PLAN.md) §E.
  - `ICP_ATTESTATION_CANISTER_ID` — the attestation canister Principal on ICP mainnet (deployed separately, see §5.2 below).
  - `ICP_ATTESTATION_KEY` — 32-byte hex seed for the gateway's Secp256k1 identity. Generate: `openssl rand -hex 32`. **Never commit.**
  - When both are set, every `POST /api/v1/attest` call dual-writes to Blobs (fast) and the ICP canister (1–3 s, best-effort with timeout). Verify via `GET /api/v1/attest/:id/verify` which checks both sources and returns a `consensus` field (`match`, `mismatch`, `icp_pending`, etc.).
  - When either is unset, the system operates exactly as Improvement D (Blobs-only). No ICP calls are made.

**Bridge env (production):**

- `CANISTER_URL`, **`SESSION_SECRET`** (must be the **exact same** value as the gateway — if they differ, the bridge cannot verify the user JWT and Settings will show "GitHub: Not connected" even after a successful Connect GitHub), `HUB_BASE_URL`, `HUB_UI_ORIGIN` — same as gateway logic; bridge callback URL must be on `HUB_BASE_URL` of the bridge (e.g. `https://bridge.knowtation.com/auth/callback/github-connect`)
- `HUB_ADMIN_USER_IDS` (optional) — Same comma-separated list as the gateway so bridge role store and Settings role stay in sync. Required for full Team and invite links on hosted. See [hub/bridge/README.md](../hub/bridge/README.md).
- `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` — for Connect GitHub (can be same app as gateway or separate)
- `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`, `OLLAMA_URL` or `OPENAI_API_KEY` — for index/search (see **Bridge: semantic index/search** below)
- `DATA_DIR` — persistent dir for tokens and per-user vector DBs (ensure backup/restore if needed)

### Bridge: semantic index/search (Netlify / serverless)

Hub **Re-index** and **Search** call the gateway, which proxies to the **bridge**. Embeddings and **sqlite-vec** run **inside the bridge** function. Failures may show **`Index failed: …`** or **`Search failed: …`**; a bare **Invalid URL** may be **sqlite-vec** native load on Netlify (see troubleshooting below) or a malformed **`OLLAMA_URL`** when using Ollama.

**Recommended on Netlify:** set on the **bridge** site (not only the gateway):

- `EMBEDDING_PROVIDER=openai`
- `OPENAI_API_KEY` — your secret
- `EMBEDDING_MODEL=text-embedding-3-small` (or another OpenAI embeddings model)

**Ollama instead:** `OLLAMA_URL` must be a full absolute URL including scheme, reachable from the public internet (e.g. `https://embeddings.example.com:11434`). It must **not** be `http://localhost:11434` on Netlify (the function cannot reach your laptop). **`https://ollama.com`** is the marketing site, not the Ollama HTTP API.

**Operator checklist (bridge site env):**

1. `CANISTER_URL` — same working canister base URL as the gateway (e.g. raw `icp0.io` if that is what you use in production).
2. `SESSION_SECRET` — **exact match** with the gateway (JWT verification).
3. Embeddings: **OpenAI** vars above **or** a valid public **`OLLAMA_URL`** with `http://` or `https://`.
4. Redeploy the bridge, then in the Hub run **Re-index** once, then **Search**.

#### Troubleshooting: "Index failed: Invalid URL" or "Search failed: Invalid URL"

**1. sqlite-vec on Netlify (common with OpenAI configured):** If function logs show **`getLoadablePath`**, **`sqlite-vec`**, or **`input: '.'`**, the bridge bundle broke **`import.meta.url`** inside `sqlite-vec`. The repo root **`netlify.toml`** and **`deploy/bridge/netlify.toml`** declare **`[functions].external_node_modules`** for **`sqlite-vec`**, **`better-sqlite3`**, and **`sqlite-vec-*`** platform packages so native files load from real `node_modules`. Redeploy the **bridge** site after pulling that config.

**2. Ollama URL shape:** When `EMBEDDING_PROVIDER=ollama`, a bad **`OLLAMA_URL`** (host without `https://`, whitespace-only) can also surface as Invalid URL. Fix env as above.

If it still fails, open **Netlify → bridge site → Functions → logs**, trigger **Re-index** once, and capture **`Bridge index error`** (full stack).

---

## 4. DNS

- **knowtation.store** → 4Everland (whole site: landing at `/`, Hub at `/hub/`). Optionally same host for gateway (e.g. rewrites for `/api/*`).
- If gateway or bridge are on separate hosts, point those domains (e.g. Netlify-provided) and set env accordingly.

Exact records depend on 4Everland and your Node host (A/CNAME, or their provided targets).

---

## 5. Pre-roll checklist (hosted)

Use this list **before first launch** and **again after** any production env change, bridge/gateway redeploy, or incident. For “what pre-roll is” and **bridge deploy in detail**, see [BRIDGE-DEPLOY-AND-PREROLL.md](./BRIDGE-DEPLOY-AND-PREROLL.md). **Live status and parity gaps:** [STATUS-HOSTED-AND-PLANS.md](./STATUS-HOSTED-AND-PLANS.md). For self-hosted mirror checks, see [STATUS-VERIFICATION.md](./STATUS-VERIFICATION.md) §1 where applicable.

- [ ] Canister deployed and healthy (`GET /health`).
- [ ] Gateway env set; OAuth callback URLs registered with Google/GitHub.
- [ ] Bridge env set; GitHub OAuth callback for Connect GitHub registered.
- [ ] Bridge: **`EMBEDDING_PROVIDER=openai`** + **`OPENAI_API_KEY`** (and model), **or** a reachable **`OLLAMA_URL`** with a full `http://` / `https://` base (not localhost on Netlify).
- [ ] Hub (logged in): **Re-index** completes, then **meaning-search** (green Search) returns results; Network tab shows **no** `ERR_CONTENT_DECODING_FAILED` on `/api/v1/index` or `/api/v1/search` (gateway must strip upstream **Content-Encoding** when proxying decoded bodies — see repo `hub/gateway/upstream-response-headers.mjs`).
- [ ] Hub UI deployed with correct `HUB_API_BASE_URL`.
- [ ] Landing deployed; "Open Knowtation Hub" points to Hub URL.
- [ ] No secrets or credentials in repo or client bundle.
- [ ] **Settings → Backup → project slug:** **Gateway** must include metadata bulk handlers; **static Hub** (`web/hub`) must include **PR #65** so the client does not block `POST /notes/delete-by-project` or `rename-project` on hosted. Then **Delete by project (metadata)** and **Rename project** work (confirm with a test vault; **Re-index** afterward if you rely on semantic search — see [HUB-METADATA-BULK-OPS.md](./HUB-METADATA-BULK-OPS.md)).
- [ ] **AIR attestation (if desired):** `ATTESTATION_SECRET` set on the gateway site (32+ chars). After deploy, verify: `curl -X POST <gateway>/api/v1/attest -H 'Content-Type: application/json' -d '{"action":"write","path":"test/check.md"}'` returns `{ "id": "air-...", "timestamp": "..." }`; then `curl <gateway>/api/v1/attest/<id>` returns `{ "verified": true, ... }`.
- [ ] **AIR ICP anchor (if desired):** attestation canister deployed (§5.2), `ICP_ATTESTATION_CANISTER_ID` + `ICP_ATTESTATION_KEY` set on gateway. After deploy, create an attestation and verify: `curl <gateway>/api/v1/attest/<id>/verify` returns `{ "consensus": "match", ... }`.

### 5.0 Post-merge canister upgrade (auto Netlify + 4Everland on `main`)

If **merging to `main`** triggers **Netlify** (gateway) and **4Everland** (static site) automatically, the **new gateway** may go live **before** you upgrade the **ICP hub canister**. Hosted features that need new Motoko routes or stable fields (for example **extended proposal Enrich** with **`assistant_suggested_frontmatter_json`** after **V5**) will **fail or drop suggested frontmatter** until the canister matches the gateway (deploy **hub** WASM before relying on hosted Enrich end-to-end).

**Operator sequence (recommended):**

1. **Merge the PR** to `main` (triggers Netlify + 4Everland).
2. **Immediately** on the machine that has **`dfx`** and your **mainnet deploy identity**, from a clean tree:
   ```bash
   cd /path/to/knowtation
   npm run release:post-merge-canister -- --sync-main
   ```
   This runs **[scripts/post-merge-hub-canister-release.sh](../scripts/post-merge-hub-canister-release.sh)**, which calls **[scripts/canister-predeploy.sh](../scripts/canister-predeploy.sh)**:
   - migration shape checks (`verify-canister-migration.mjs`)
   - `npm test`
   - `dfx build hub --network ic`
   - optional **`GET /api/v1/export`** backup to `./backups/` when **`KNOWTATION_CANISTER_BACKUP_USER_ID`** is set in `.env` (URL defaults from [hub/icp/canister_ids.json](../hub/icp/canister_ids.json) if omitted)
3. **Deploy the canister** (same terminal session, after preflight passes):
   ```bash
   cd hub/icp && dfx identity use <your-deploy-identity> && dfx deploy hub --network ic
   ```
   Or opt-in from repo root (if you export identity first or set `DFX_DEPLOY_IDENTITY`):
   ```bash
   RUN_DFX_DEPLOY=1 DFX_DEPLOY_IDENTITY=<name> npm run release:post-merge-canister
   ```
4. **Wait** for Netlify + 4Everland production deploys to finish; then **test flight** (read-only snapshot is safe):
   ```bash
   KNOWTATION_HUB_SNAPSHOT_ONLY=1 KNOWTATION_HUB_API=https://<your-gateway-public-origin> npm run verify:hosted-api
   ```
5. Only then enable or confirm **`KNOWTATION_HUB_PROPOSAL_ENRICH=1`** (and chat API keys) on the gateway if you want hosted Enrich live — see [HUB-PROPOSAL-LLM-FEATURES.md](./HUB-PROPOSAL-LLM-FEATURES.md).

**Same as always:** do not commit `.env`; confirm no secrets in the client bundle. For a fuller pre-merge dry run (optional `git pull` on `main`), you can still use `npm run canister:release-prep -- --sync-main` before opening the PR.

### 5.1 Multi-vault (Phase 15.1) — after canister deploy

Run these **after** `hub/icp` is deployed from the current repo (partitioned storage + V1 migration). Use your **gateway** origin for JWT-authenticated calls; for **direct canister** checks in dev only, some setups allow `X-Test-User` — **production** may require the gateway.

**Record** status codes and a short note (pass/fail) for your runbook.

1. **Vault list** — `GET …/api/v1/vaults` with the same identity you use in the Hub. Expect at least `{ "id": "default", … }`. After you **POST** a note with header **`X-Vault-Id: second`** (or another safe id), the list should include that id.
2. **Isolation** — With the same **path** (e.g. `inbox/parity-test.md`), **POST** body A in vault `default` and body B in vault `second`; **GET** each note with the matching **`X-Vault-Id`** and confirm bodies differ.
3. **Export** — `GET …/api/v1/export` with **`X-Vault-Id: default`** must not return notes that exist only in `second` (and vice versa).
4. **Bridge** — With **`BRIDGE_URL`** set: **Back up now** / `POST /api/v1/vault/sync` while the Hub sends **`X-Vault-Id`** for the active vault should export **only** that vault’s notes to GitHub (see [MULTI-VAULT-AND-SCOPED-ACCESS.md](./MULTI-VAULT-AND-SCOPED-ACCESS.md) § Hosted).
5. **Index / search** — **Re-index** then **Search** in the Hub for vault A and vault B; results should not mix content across vaults (bridge vectors are keyed by `(uid, vault_id)`).

**Automation (optional):** `npm run smoke:hosted-multi-vault` with **`CANISTER_URL`** (and **`X_TEST_USER`** or **`HUB_GATEWAY_URL` + `HUB_SMOKE_TOKEN`**) — see [scripts/smoke-hosted-multi-vault.mjs](../scripts/smoke-hosted-multi-vault.mjs).

**Recorded read-only sample (2026-03-24):** `GET https://rsovz-byaaa-aaaaa-qgira-cai.raw.icp0.io/health` → **200**, `{"ok":true}` (same canister id as in [STATUS-HOSTED-AND-PLANS.md](./STATUS-HOSTED-AND-PLANS.md) §1). Mutation checks (§5.1 steps 1–5) must be run by an operator after each relevant deploy; do not point **`smoke:hosted-multi-vault`** at production unless you intend to write test notes.

### 5.2 Attestation canister deploy (AIR Improvement E)

The attestation canister is **separate** from the hub canister — it stores immutable attestation records on-chain. Deploy only when you want ICP-backed tamper-evidence for attestations.

**Prerequisites:** `dfx` installed, mainnet deploy identity available, `ATTESTATION_SECRET` already working on the gateway (Improvement D).

1. **Generate a gateway identity key** (one-time):
   ```bash
   openssl rand -hex 32
   ```
   Save this as `ICP_ATTESTATION_KEY` in your `.env` (never commit) and on the Netlify gateway site.

2. **Get the gateway's ICP Principal:**
   ```bash
   ICP_ATTESTATION_KEY=<your-hex-key> node scripts/icp-attestation-principal.mjs
   ```
   Note the printed principal (e.g. `fhaxy-l6y4l-...`).

3. **Deploy the canister:**
   ```bash
   cd hub/icp
   dfx identity use <your-deploy-identity>
   dfx deploy attestation --network ic
   ```

4. **Record the canister ID:**
   ```bash
   dfx canister id attestation --network ic
   ```
   Add to `hub/icp/canister_ids.json` under `"attestation": { "ic": "<id>" }`.

5. **Authorize the gateway identity:**
   ```bash
   dfx canister call attestation setAuthorizedCallers \
     '(vec { principal "<principal-from-step-2>" })' --network ic
   ```

6. **Set gateway env vars** on Netlify:
   - `ICP_ATTESTATION_CANISTER_ID=<canister-id-from-step-4>`
   - `ICP_ATTESTATION_KEY=<hex-key-from-step-1>`

7. **Verify end-to-end:**
   ```bash
   # Create an attestation
   curl -X POST https://<gateway>/api/v1/attest \
     -H 'Content-Type: application/json' \
     -d '{"action":"write","path":"test/e2e.md"}'
   # → { "id": "air-...", "timestamp": "...", "icp_status": "anchored" }

   # Verify against both sources
   curl https://<gateway>/api/v1/attest/<id>/verify
   # → { "consensus": "match", "sources": { "blobs": {...}, "icp": {...} } }

   # Verify directly on the canister (no gateway needed)
   curl https://<canister-id>.ic0.app/attest/<id>
   # → { "id": "air-...", "seq": 0, "stored_at": "..." }
   ```

**Self-hosted (no Netlify):** The same steps apply. The attestation canister is on ICP regardless of where the gateway runs. Blob storage falls back to a local JSON file (`data/hosted_attestations.json`). The ICP anchor works the same way.

---

## 6. Daily canister export backup (operator)

**Goal:** A **logical** JSON export of one or more vault partitions via **`GET /api/v1/export`** on a fixed schedule **without** your laptop. This complements per-user **Back up now** (GitHub) and preflight exports in [`scripts/canister-predeploy.sh`](../scripts/canister-predeploy.sh).

| Mechanism | What runs |
|-----------|-----------|
| **Script** | [`scripts/canister-export-backup.sh`](../scripts/canister-export-backup.sh) — same env as below; `npm run canister:export-backup` |
| **CI** | [`.github/workflows/canister-export-backup.yml`](../.github/workflows/canister-export-backup.yml) — **07:00 UTC daily** + **workflow_dispatch** |

**GitHub Actions secrets** (repository **Settings → Secrets and variables → Actions**):

| Secret | Required | Purpose |
|--------|----------|---------|
| `KNOWTATION_CANISTER_BACKUP_USER_ID` | **Yes** | Value for **`X-User-Id`** (same stable id the gateway uses for that partition, e.g. `google:…`). **Treat as highly sensitive:** anyone with this value and the public canister URL can read that partition’s exported notes via the canister HTTP API. |
| `KNOWTATION_CANISTER_BACKUP_URL` | No | Base URL, no trailing slash. If unset, the workflow uses **`hub/icp/canister_ids.json`** (`hub.ic` + `https://…icp0.io`) from the checked-out branch. |
| `KNOWTATION_CANISTER_BACKUP_VAULT_IDS` | No | Comma-separated vault ids (e.g. `default,team`). If unset, exports **`default`** only (or set a single id via `KNOWTATION_CANISTER_BACKUP_VAULT_ID` in local `.env`). |

**Artifacts:** Each run uploads **`backups/canister-export-<vault>-<UTC>.json`** with **90-day** retention. GitHub artifact access follows your org/repo permissions; for long-term or compliance storage, copy artifacts to **encrypted** object storage or offline media (e.g. Apricorn) per your runbook.

**Local / VPS cron:** Run `npm run canister:export-backup` from a clone with `.env` containing at least **`KNOWTATION_CANISTER_BACKUP_USER_ID`** (and optional URL / vault vars). Output directory: **`KNOWTATION_CANISTER_BACKUP_DIR`** (default `./backups`, gitignored).

**Scope note:** The current canister export returns **notes** for the requested vault. Full platform DR (proposals-only recovery, bridge vectors, billing blobs) remains in [HOSTED-PLATFORM-BACKUP-ROADMAP.md](./HOSTED-PLATFORM-BACKUP-ROADMAP.md).

---

## 7. Reference

- [HOSTED-HUB-VERIFY.md](./HOSTED-HUB-VERIFY.md) — Verify static Hub bundle, gateway facets, canister frontmatter (scripts + apex `www` caveat).
- [HOSTED-STORAGE-BILLING-ROADMAP.md](./HOSTED-STORAGE-BILLING-ROADMAP.md) — Single Motoko migration plan: multi-vault + reserved billing fields (Phase 16).
- [HOSTED-CREDITS-DESIGN.md](./HOSTED-CREDITS-DESIGN.md) — **Free** + Stripe paid tiers, **indexing token** quotas (target), **`BILLING_SHADOW_LOG`**, **rollover token** packs; gateway may still expose legacy **cent** scaffold until Phase 16 completes.
- [CANISTER-AND-SINGLE-URL.md](./CANISTER-AND-SINGLE-URL.md) — How to run the canister; single URL (knowtation.store) and how to view the site locally.
- [CANISTER-AUTH-CONTRACT.md](./CANISTER-AUTH-CONTRACT.md)
- [hub/gateway/README.md](../hub/gateway/README.md)
- [hub/bridge/README.md](../hub/bridge/README.md)
- [hub/icp/README.md](../hub/icp/README.md)
