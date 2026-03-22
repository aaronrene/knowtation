# Session log: hosted Hub parity & saves (March 2026)

Public record of work landed on `main` around hosted Knowtation Hub (gateway + canister + UI), operations, and follow-ups. Commit SHAs refer to this repository at the time of writing.

## Product goals addressed

- **Provenance** on hosted note writes (editor, edited-at, `author_kind`), aligned with self-hosted `hub/server.mjs`.
- **Hosted UI:** Edit/Export visible when Settings shows admin but JWT role was `member`; role synced from `GET /api/v1/settings`.
- **Canister:** Return stored frontmatter on list/single GET (was hardcoded `{}`); stable migration for already-V1 mainnet actors (M0170 identity migration).
- **Gateway:** Merge + stringify `frontmatter` on `POST /api/v1/notes` for the canister’s string-based JSON parser.
- **Saves failing on production:** (1) Create modal `z-index` blocked clicks on the detail panel Save. (2) Netlify/Express left `req.originalUrl` as `/notes` under `app.use('/api/v1')`, so the proxy called the canister at **`/notes`** instead of **`/api/v1/notes`** — fixed via `hub/gateway/request-path.mjs` (`baseUrl` + `path`).

## Commits (chronological, high level)

| Area | Commit | Summary |
|------|--------|---------|
| Hub UI | `6f5547e` | Edit for `member`; sync `__hubUserRole` from settings |
| Hosted | `22da323` | Gateway provenance merge; canister GET frontmatter |
| PR | `2ebb9d2` | Merge PR #29 (feature branch) |
| ICP | `f2fa608` | Stable migration hook V1→V1 identity (`migrateFromV0ToV1` kept for reference) |
| Hub UI | `31a867e` | Close create modal when editing/saving; avoid backdrop blocking Save |
| Web | `0f1cc4c` | Favicon `web/assets/favicon.svg`; landing + Hub `<link rel="icon">` |
| Gateway | `88488b7` | Canonical `/api/v1` path for canister proxy + billing; Hub fetch/save toasts |

## Operations (verified behaviors)

- **Netlify quota:** Gateway returned `503` + `usage_exceeded`; UI showed **Failed to fetch**. Restored after credits; unrelated to app code.
- **Canister URL:** Use **`https://<canister-id>.raw.icp0.io`** for `CANISTER_URL` when non-raw host returns `backend_response_verification` / certification errors. See `docs/DEPLOY-STEPS-ONE-PAGE.md`.
- **Preflight:** `npm run canister:preflight` before `dfx deploy --network ic`. Optional backup env vars documented in `scripts/canister-predeploy.sh`.

## Deploy surfaces (reminder)

- **Netlify `knowtation-gateway`:** Gateway function + env (`CANISTER_URL`, `SESSION_SECRET`, `HUB_CORS_ORIGIN`, …).
- **4Everland (or equivalent):** `web/` static — `hub.js`, `config.js`, `assets/favicon.svg`.

## Follow-up (not done in this batch)

- **Proposal approve** on hosted: same provenance merge as self-hosted `POST /api/v1/proposals/:id/approve` (separate write path).

## Workflow note

Prefer **feature branches** + PRs into `main` for ongoing work so history stays reviewable. This file was added as the **first commit** on branch `docs/hosted-hub-parity-session-log` after pulling latest `main`.
