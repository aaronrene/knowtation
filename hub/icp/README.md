# Knowtation Hub on ICP

This folder is the placeholder for the **ICP canister(s)** implementation of the Knowtation Hub API. The same contract as the Node server (see [docs/HUB-API.md](../../docs/HUB-API.md)) is implemented here so that the Hub UI and CLI can talk to either self-hosted (Docker) or hosted (ICP) deployment.

## Contract

- **Auth:** Internet Identity (and optionally OAuth via a gateway that issues JWTs trusted by the canister).
- **Endpoints:** Same as Node: `GET /health`, `GET /api/v1/notes`, `GET /api/v1/notes/:path`, `POST /api/v1/search`, `POST /api/v1/notes`, `GET/POST /api/v1/proposals`, `POST /api/v1/proposals/:id/approve`, `POST /api/v1/proposals/:id/discard`.
- **Storage:** Vault and proposals in canister state (e.g. Documents/Assets patterns from [bornfree-hub](https://github.com/aaronrene/bornfree-hub)).

## Implementation status

- **Not yet implemented.** Use the Node Hub (Docker) for self-hosted until the Motoko (or Rust) canisters are added.
- When implementing: reuse patterns from bornfree-hub (Identity canister for auth, Documents/Assets for vault and proposals). Deploy with `dfx`. Document the canister URL and CORS for the Hub UI.

## Reference

- [HUB-API.md](../../docs/HUB-API.md) — full API and auth
- [IMPLEMENTATION-PLAN.md](../../docs/IMPLEMENTATION-PLAN.md) — Phase 11, "Website and decentralized hosting"
