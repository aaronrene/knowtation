# Knowtation Hub on ICP

This folder contains the **ICP canister** implementation of the Knowtation Hub API. The same contract as the Node server (see [docs/HUB-API.md](../../docs/HUB-API.md)) is implemented here so that the Hub UI and CLI can talk to either self-hosted (Docker) or hosted (ICP) deployment.

## Contract

- **Auth:** For dev, use header `X-Test-User` or `X-User-Id`. In production the gateway sends a proof (e.g. `X-User-Id`) that the canister trusts; see [CANISTER-AUTH-CONTRACT.md](../../docs/CANISTER-AUTH-CONTRACT.md).
- **Endpoints:** `GET /health`, `GET /api/v1/notes`, `GET /api/v1/notes/:path`, `POST /api/v1/notes`, `GET/POST /api/v1/proposals`, `GET /api/v1/proposals/:id`, `POST /api/v1/proposals/:id/approve`, `POST /api/v1/proposals/:id/discard`. Search and settings are not implemented in the canister (handled by gateway/bridge in hosted mode).
- **Storage:** Vault (path → frontmatter/body) and proposals per user in canister stable memory.

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

If `dfx deploy` fails with **M0170** / “new type of stable variable `storage` is not compatible”, the on-chain `ProposalRecord` shape no longer matches the source (e.g. after adding `base_state_id` / `external_ref`). The project includes **`src/hub/Migration.mo`** and `(with migration = Migration.migration)` on the hub actor so one upgrade maps **V0** proposals (without those two fields) to the current record, filling them with `""`.

After this upgrade has run successfully on mainnet, a **later** release may drop the migration hook and module if you want a minimal actor (see Motoko compatibility docs).

## ICP HTTP gateway behavior (hosted)

- Every browser request is delivered to the canister’s **`http_request` (query)** first. **POST** mutations are **not** routed directly to `http_request_update`; the gateway only calls `http_request_update` after `http_request` returns **`upgrade = ?true`**. See [Upgrading HTTP calls to update calls](https://internetcomputer.org/docs/building-apps/network-features/using-http/http-certification/upgrading-http-query-calls-to-update-calls) and [HTTPS gateways and incoming requests](https://docs.internetcomputer.org/building-apps/network-features/using-http/gateways).
- The gateway may set `HttpRequest.url` to a **full URL** (e.g. `https://<canister>.icp0.io/api/v1/notes?...`). Routing must normalize to the **path** (e.g. `/api/v1/notes`) before matching; `pathOnly` + `parsePath` in `main.mo` do that.
- Without `upgrade` on POST, the canister’s query handler falls through to the generic **404** body `{"error":"Not found","code":"NOT_FOUND"}` — the same JSON the Hub shows when listing or creating notes.

## Implementation status

- **Implemented:** Motoko canister in `src/hub/main.mo`: vault (notes list/get/write), proposals (list/get/create/approve/discard), health, CORS. User from header; stable storage. HTTP `upgrade` for POST and URL path normalization as above.
- **Not in canister:** Search, settings, vault sync — handled by gateway/bridge in the hosted product (see plan phases 2–4).

## Reference

- [HUB-API.md](../../docs/HUB-API.md) — full API and auth
- [CANISTER-AUTH-CONTRACT.md](../../docs/CANISTER-AUTH-CONTRACT.md) — gateway/canister auth
- [IMPLEMENTATION-PLAN.md](../../docs/IMPLEMENTATION-PLAN.md) — Phase 11, "Website and decentralized hosting"
