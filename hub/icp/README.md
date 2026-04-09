# Knowtation Hub on ICP

This folder contains the **ICP canister** implementation of the Knowtation Hub API. The same contract as the Node server (see [docs/HUB-API.md](../../docs/HUB-API.md)) is implemented here so that the Hub UI and CLI can talk to either self-hosted (Docker) or hosted (ICP) deployment.

## Contract

- **Auth:** For dev, use header `X-Test-User` or `X-User-Id`. In production the gateway sends a proof (e.g. `X-User-Id`) that the canister trusts; see [CANISTER-AUTH-CONTRACT.md](../../docs/CANISTER-AUTH-CONTRACT.md).
- **Endpoints:** `GET /health`, **`GET /api/v1/operator/export`** (paginated user-index for backups; header **`X-Operator-Export-Key`**; secret set by controllers via **`admin_set_operator_export_secret`** — see [OPERATOR-BACKUP.md](../../docs/OPERATOR-BACKUP.md)), `GET /api/v1/notes`, `GET /api/v1/notes/:path`, `DELETE /api/v1/notes/:path`, `POST /api/v1/notes`, `POST /api/v1/notes/batch` (bulk write, single stable save), `POST /api/v1/notes/delete-by-prefix` (bulk delete by vault-relative path prefix), `GET /api/v1/export`, `GET /api/v1/vaults`, `GET/POST /api/v1/proposals`, `GET /api/v1/proposals/:id`, **`POST /api/v1/proposals/:id/evaluation`**, `POST /api/v1/proposals/:id/review-hints`, **`POST /api/v1/proposals/:id/enrich`** (stores LLM enrich fields; gateway runs the model on hosted), `POST /api/v1/proposals/:id/approve`, `POST /api/v1/proposals/:id/discard`. **`POST /api/v1/notes/delete-by-project`** and **`POST /api/v1/notes/rename-project`** are **not** canister routes — on hosted, the **gateway** implements them by calling the endpoints above ([HUB-METADATA-BULK-OPS.md](../../docs/HUB-METADATA-BULK-OPS.md)). Notes and export are scoped by **`X-Vault-Id`** (default `default`). Search and settings are not in the canister (gateway/bridge in hosted mode).
- **Storage:** Vault (path → frontmatter/body) and proposals per user in canister stable memory.
- **Proposal enrich JSON:** `src/hub/JsonValidate.mo` validates `suggested_labels_json` (must be a JSON array) and `assistant_suggested_frontmatter_json` (must be a JSON object) on **POST …/enrich**; invalid payloads coerce to `[]` / `{}`, oversized valid payloads return **400**. **GET …/proposals/:id** normalizes those fragments so the response body is always valid JSON (protects all clients, including backup).

## Pre-deploy safety (recommended)

Before **`dfx deploy --network ic`**, from the **repository root**:

**All-in-one (recommended):** loads `.env` if present, can sync `main`, defaults backup URL from [canister_ids.json](./canister_ids.json) when you set only `KNOWTATION_CANISTER_BACKUP_USER_ID`:

```bash
npm run canister:release-prep
# Include: git checkout main && git pull (requires clean working tree):
npm run canister:release-prep -- --sync-main
```

**Lower-level (same checks, no git / .env / URL defaulting):**

```bash
npm run canister:preflight
# or: bash scripts/canister-predeploy.sh
```

Both run **migration shape checks** (`npm run canister:verify-migration`), **`npm test`**, and **`dfx build hub --network ic`** (matches [canister_ids.json](./canister_ids.json); plain `dfx build hub` targets **local** and fails with “Cannot find canister id” until you run `dfx canister create hub` on a local replica). Override: **`DFX_PREFLIGHT_NETWORK=local`** after local create. Optional JSON backup: set `KNOWTATION_CANISTER_BACKUP_USER_ID` (and optionally `KNOWTATION_CANISTER_URL`; omitted URL is derived from `canister_ids.json`). Preflight delegates to [`scripts/canister-export-backup.mjs`](../../scripts/canister-export-backup.mjs) via **`npm run canister:export-backup`** (notes + proposals for **one** `X-User-Id` partition; optional encrypt + S3 — see [DEPLOY-HOSTED.md](../../docs/DEPLOY-HOSTED.md) §6). Exports land under `backups/` (gitignored). If `dfx` crashes with **ColorOutOfRange**, use **`SKIP_DFX_BUILD=1`** after you have built successfully elsewhere, or upgrade `dfx`.

**Full canister state (hub + attestation):** [ICP-CANISTER-SNAPSHOT-RUNBOOK.md](../../docs/ICP-CANISTER-SNAPSHOT-RUNBOOK.md); **`npm run canister:snapshot-backup`** (controller `dfx`; downtime during `stop`).

## Build and deploy

1. Install [DFX](https://internetcomputer.org/docs/current/developer-docs/setup/install) (includes the Motoko compiler).
2. From this directory:
   ```bash
   dfx start   # optional: local replica
   dfx deploy  # or dfx deploy --network ic
   ```
3. After deploy, the canister is callable at:
   - **Local:** `http://localhost:4943/?canisterId=<canister-id>`
   - **IC:** `https://<canister-id>.ic0.app`
4. **CORS:** The canister sets `Access-Control-Allow-Origin: *` and allows `GET`, `POST`, `OPTIONS` and headers `Authorization`, `Content-Type`, `X-Vault-Id`, `X-User-Id`, `X-Test-User` so the Hub UI (e.g. on 4Everland) can call it when configured with this API base URL.

## Canister ID and URL

- After `dfx deploy`, run `dfx canister id hub` to get the canister ID.
- Use that ID in the URL above. For the Hub UI, set the API base to the gateway URL (which proxies to the canister with auth) or, for local dev, the canister URL with `X-Test-User: default` (or another user id) on requests.

## Stable memory upgrades (mainnet)

If `dfx deploy` fails with **M0170** / “new type of stable variable `storage` is not compatible”, the on-chain stable type no longer matches the migration hook’s **input** type in **`Migration.mo`**. The hub actor uses `(with migration = Migration.migration)`; the hook’s **parameter** type is the **previous** on-chain `StableStorage` shape.

- **Production (mainnet still V1 in 2026-03):** `Migration.migration` maps **`StableStorageV1`** → **`StableStorage`**: first **`migrateFromV1ToV2Eval`** (adds evaluation Text fields on each proposal), then **`v2ToV3`** (adds **`review_queue`**, **`review_severity`**, **`auto_flag_reasons_json`**, **`review_hints`**, **`review_hints_at`**, **`review_hints_model`**). If `dfx deploy` failed with **M0170** and “Unsupported additional field `evaluated_at`”, the hook had wrongly been typed as **`StableStorageV2`** while the canister was still **V1** — fixed in `Migration.mo`.
- **V4 (LLM Enrich):** `Migration.migration` maps **`StableStorageBeforeEnrich`** → **`StableStorage`**, adding per-proposal **`assistant_notes`**, **`assistant_model`**, **`assistant_at`**, **`suggested_labels_json`** (defaults empty / `[]`). Earlier releases used an identity hook on `StableStorage` until enrich fields shipped.
- **Stranded V0 canisters** (pre–Phase 15.1 layout only): deploy an older git revision that still migrated from `StableStorageV0`, or reinstall an empty canister.

**V0** meant one note map per user; **V1** is multi-vault `(userId, vaultId)` + `billingByUser` + `vault_id` on proposals; migrated notes use vault id **`default`**. **V2** adds human **evaluation** fields on each proposal. **V3** adds review-routing and optional hint fields; see [PROPOSAL-LIFECYCLE.md](../../docs/PROPOSAL-LIFECYCLE.md). **V4** adds optional LLM **Enrich** fields (`assistant_*`, `suggested_labels_json`).

Plan any stable change with [HOSTED-STORAGE-BILLING-ROADMAP.md](../../docs/HOSTED-STORAGE-BILLING-ROADMAP.md). After a one-way upgrade has run on mainnet, a **later** release may only simplify migration if Motoko compatibility allows (see [Motoko upgrades](https://internetcomputer.org/docs/motoko/fundamentals/actors/compatibility)).

## ICP HTTP gateway behavior (hosted)

- Every browser request is delivered to the canister’s **`http_request` (query)** first. **POST** mutations are **not** routed directly to `http_request_update`; the gateway only calls `http_request_update` after `http_request` returns **`upgrade = ?true`**. See [Upgrading HTTP calls to update calls](https://internetcomputer.org/docs/building-apps/network-features/using-http/http-certification/upgrading-http-query-calls-to-update-calls) and [HTTPS gateways and incoming requests](https://docs.internetcomputer.org/building-apps/network-features/using-http/gateways).
- The gateway may set `HttpRequest.url` to a **full URL** (e.g. `https://<canister>.icp0.io/api/v1/notes?...`). Routing must normalize to the **path** (e.g. `/api/v1/notes`) before matching; `pathOnly` + `parsePath` in `main.mo` do that.
- Without `upgrade` on POST, the canister’s query handler falls through to the generic **404** body `{"error":"Not found","code":"NOT_FOUND"}` — the same JSON the Hub shows when listing or creating notes.

## Implementation status

- **Implemented:** Motoko canister in `src/hub/main.mo`: vault (notes list/get/write/delete, bulk delete by prefix), proposals (list/get/create/**evaluation**/**review-hints**/**enrich**/approve/discard with evaluation gate + waiver on approve), health, CORS. User from header; stable storage. HTTP `upgrade` for POST and URL path normalization as above. **Hosted gateway** runs the LLM for **Enrich** and POSTs stored fields to the canister; it adds **`evaluation_checklist_json`** from the UI **`checklist`** array before proxying **`POST …/evaluation`** to the canister, and merges **policy + review triggers** on **`POST …/proposals`**.
- **Not in canister:** Search, settings, vault sync — handled by gateway/bridge in the hosted product (see plan phases 2–4). **`POST /api/v1/notes/delete-by-project`** and **`POST /api/v1/notes/rename-project`** (bulk ops by frontmatter/path-inferred project slug) are **Node Hub only** in-repo; see [HUB-METADATA-BULK-OPS.md](../../docs/HUB-METADATA-BULK-OPS.md) for the hosted strategy and parity notes.

## Reference

- [HUB-API.md](../../docs/HUB-API.md) — full API and auth
- [CANISTER-AUTH-CONTRACT.md](../../docs/CANISTER-AUTH-CONTRACT.md) — gateway/canister auth
- [IMPLEMENTATION-PLAN.md](../../docs/IMPLEMENTATION-PLAN.md) — Phase 11, "Website and decentralized hosting"
