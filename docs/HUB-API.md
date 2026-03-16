# Knowtation Hub API

This document defines the **Hub REST API contract** and **auth model** for Phase 11. The same contract is implemented by (a) the self-hosted Node server (Docker) and (b) the ICP canister(s). The Hub UI and CLI talk to either deployment using the same routes and JSON shapes.

**Reference:** [MUSE-STYLE-EXTENSION.md](./MUSE-STYLE-EXTENSION.md) (proposals, review, commit), [SPEC.md](./SPEC.md) §4 (CLI semantics), [IMPLEMENTATION-PLAN.md](./IMPLEMENTATION-PLAN.md) Phase 11.

---

## 1. Authentication

### 1.1 Model

- **Login required.** There is no API-key-only path; all Hub API calls require a **JWT** obtained after login.
- **Self-hosted (Docker):** Login via **OAuth 2.0** (Google and/or GitHub). After successful OAuth callback, the server issues a **JWT** (access token). Optional: refresh token for long-lived sessions.
- **Hosted (ICP):** Login via **Internet Identity** (or, if fronted by a gateway that performs OAuth, a JWT trusted by the canister). The canister validates the JWT or II delegation.

### 1.2 Obtaining a JWT

| Deployment | Flow |
|------------|------|
| Self-hosted | User visits `GET /auth/login` (or equivalent); redirect to OAuth provider; callback at `GET /auth/callback`; server issues JWT, sets cookie or returns token in response body. |
| ICP | User signs in with Internet Identity; front-end receives session; subsequent API calls include the II-derived principal or a JWT issued by an auth canister. |

### 1.3 Using the JWT

- **Header:** `Authorization: Bearer <access_token>`
- All Hub API endpoints (except login/callback and public health) require this header. Missing or invalid token → `401 Unauthorized`.

### 1.4 Token lifetime and refresh

- **Access token:** Short-lived (e.g. 15–60 minutes). Document exact lifetime in deployment config.
- **Refresh token (optional):** If supported, store securely; use to obtain a new access token via `POST /auth/refresh` (body: `{ "refresh_token": "..." }`). Refresh tokens are long-lived until revoked.

### 1.5 Scopes (optional)

JWTs may include scopes to distinguish read vs write vs propose:

- `read` — list notes, get note, search.
- `write` — write note (direct to vault).
- `propose` — create proposal, list own proposals.
- `review` — list all proposals, approve, discard.

If not implemented in v1, all authenticated users have full access. Document scope semantics when added.

---

## 2. Base URL and versioning

- **Base URL:** Self-hosted: `http(s)://<host>:<port>/api` (or no prefix). ICP: `https://<canister-id>.ic0.app/api` (or as deployed).
- **Versioning:** Path prefix `/api/v1` recommended (e.g. `GET /api/v1/notes`). Omit version in this doc for brevity; implementations use a consistent prefix.
- **Vault context (multi-vault / hosted):** Optional header **`X-Vault-Id`** or query param **`vault_id`** to scope requests to a vault. When absent, implementations use a default (e.g. `default` or the single vault). For v1 canister, one user = one vault; vault_id is reserved for future multi-vault. See [CANISTER-AUTH-CONTRACT.md](./CANISTER-AUTH-CONTRACT.md) for gateway/canister auth.

---

## 3. Endpoints (contract)

Same semantics as CLI where applicable. Request/response JSON matches SPEC §4.2 shapes where noted.

### 3.1 Health (no auth)

- **GET /health** — Returns `200` and `{ "ok": true }` if the Hub is up. No JWT required.

- **GET /api/v1/auth/providers** (no auth) — Which OAuth providers are configured. **Response:** `{ "google": boolean, "github": boolean }`. The Rich Hub UI uses this to show **Continue with Google** / **Continue with GitHub** only when env vars are set; if both are `false`, the UI explains how to configure OAuth (no separate sign-up — identity is Google or GitHub only).

### 3.2 Vault read

- **GET /notes/facets** — Returns `{ projects: string[], tags: string[], folders: string[] }` for filter dropdowns. JWT required.

- **GET /notes** — List notes. Query params: `folder`, `project`, `tag`, `since`, `until`, `chain`, `entity`, `episode`, `limit`, `offset`, `order` (`date` \| `date-asc`), `fields` (`path` \| `path+metadata` \| `full`), `count_only`.  
  **Response:** `{ "notes": [ ... ], "total": number }` or `{ "total": number }` if `count_only=true`. Per-note shape per SPEC §4.2 list-notes.

- **GET /notes/:path** — Get one note by vault-relative path. Path must be URL-encoded.  
  **Response:** `{ "path": "...", "frontmatter": { ... }, "body": "..." }` per SPEC §4.2 get-note.  
  **404** if not found.

- **POST /search** — Semantic search. Body: `{ "query": "...", "folder?", "project?", "tag?", "limit?", "since?", "until?", "order?", "fields?" }`.  
  **Response:** `{ "results": [ { "path", "snippet?", "score", "project", "tags" } ], "query": "..." }` per SPEC §4.2 search.  
  **400** if query missing.

### 3.3 Vault write

- **POST /notes** — Write or update a note. Body: `{ "path": "...", "body?", "frontmatter?", "append?" }`. Path vault-relative.  
  **Response:** `{ "path": "...", "written": true }`.  
  **400** if path invalid; **403** if not allowed.

- **POST /index** — Re-run the indexer (vault → chunk → embed → vector store). Use after bulk imports or when search should reflect new or changed notes. JWT required.  
  **Response:** `{ "ok": true, "notesProcessed": number, "chunksIndexed": number }`.  
  **500** on indexer or config failure.

### 3.3.1 Settings and vault backup (JWT required)

- **GET /settings** — Safe config status for the Settings UI. No secrets or full paths.  
  **Response:** `{ "vault_path_display": string, "vault_git": { "enabled": boolean, "has_remote": boolean, "auto_commit": boolean, "auto_push": boolean } }`.

- **POST /vault/sync** — Run manual vault sync (same as `knowtation vault sync`): git add, commit, push. Use for "Back up now" in Settings.  
  **Response:** `{ "ok": true, "message": "Synced" | "Nothing to commit" }`.  
  **400** if vault.git not configured; **500** on git failure.

To **set the repository**: (1) Use **Settings → Setup** in the Hub to write vault path and Git remote to `data/hub_setup.yaml` (applied immediately). (2) Or edit `config/local.yaml` (see PROVENANCE-AND-GIT.md and How to use → Step 6). **Connect GitHub** (Settings): if the Hub has GitHub OAuth configured, users can click "Connect GitHub" to authorize with `scope=repo`; the Hub stores the token in `data/github_connection.json` and uses it for push so no deploy key is needed. Add callback URL `.../api/v1/auth/callback/github-connect` to your GitHub OAuth App.

- **GET /setup** — Editable setup (vault_path, vault_git) for the Setup wizard. Returns current values.  
- **POST /setup** — Body: `{ vault_path?, vault_git?: { enabled?, remote? } }`. Writes to `data/hub_setup.yaml` and reloads config (no restart). **400** if invalid; **500** on write failure.

### 3.4 Proposals

- **POST /proposals** — Create a proposal (variation). Body: `{ "path?", "body?", "frontmatter?", "intent?", "base_state_id?" }`. If path omitted, proposal may be a new note (server assigns path or client sends path).  
  **Response:** `{ "proposal_id": "...", "path": "...", "status": "proposed" }`.  
  **400** if invalid.

- **GET /proposals** — List proposals. Query: `status` (e.g. `proposed`, `approved`, `discarded`), `limit`, `offset`.  
  **Response:** `{ "proposals": [ { "proposal_id", "path", "status", "intent?", "base_state_id?", "created_at?", "updated_at?" } ], "total": number }`.

- **GET /proposals/:id** — Get one proposal (metadata + proposed content).  
  **Response:** `{ "proposal_id", "path", "status", "intent?", "base_state_id?", "body?", "frontmatter?", "created_at?", "updated_at?" }`.  
  **404** if not found.

- **POST /proposals/:id/approve** — Apply proposal to vault. Optional body: `{ "base_state_id?" }` for optimistic concurrency check.  
  **Response:** `{ "proposal_id", "status": "approved" }`.  
  **409** if base_state_id no longer matches (vault changed).

- **POST /proposals/:id/discard** — Discard proposal (do not apply).  
  **Response:** `{ "proposal_id", "status": "discarded" }`.

### 3.5 Capture (webhook, no JWT)

- **POST /api/v1/capture** — Ingest message into vault inbox. Same contract as `scripts/capture-webhook.mjs`.  
  **Body:** `{ "body": string, "source_id?", "source?", "project?", "tags?" }`.  
  **Response:** `{ "ok": true, "path": "inbox/..." }`.  
  **Auth:** If `CAPTURE_WEBHOOK_SECRET` is set, require `X-Webhook-Secret: <secret>` header. Otherwise unauthenticated (local dev).

### 3.6 Errors

- **401** — Missing or invalid JWT.
- **403** — Forbidden (e.g. scope or vault permission).
- **404** — Note or proposal not found.
- **409** — Conflict (e.g. base_state_id mismatch on approve).
- **500** — Server error.

JSON error body: `{ "error": "message", "code": "ERROR_CODE" }` (align with CLI `--json` errors).

---

## 4. Rich Hub UI (contract for UI)

The Hub UI consumes the above API. It must provide:

- **Search bar** — Calls `POST /search` with user query; display results with path, snippet, score.
- **Category / filter picker** — Filter notes by project, tag, or folder using `GET /notes` query params.
- **Quick add** — `POST /notes` from the UI: quick capture (inbox) and full new-note form (path, title, body, project, tags).
- **Browse modes** — **List** (filtered rows), **Calendar** (month grid by note `date`, day drill-down), **Overview** (dashboard cards + charts: by project, tags, month).
- **Filter presets** — Save named filter combos in browser storage; quick filter chips for common project/tag/folder jumps.
- **Task / proposal views:**
  - **Suggested tasks** — Proposals with `status=proposed` (need review).
  - **In progress** — Proposals recently updated or in review.
  - **Problem areas** — Failed/conflicting proposals or notes needing resolution (implementation-defined; e.g. proposals that failed approve due to conflict).
- **State and status** — Every list and detail shows status (draft, proposed, approved, discarded) and, where relevant, base_state_id and intention.
- **Actions** — Approve/discard from proposal detail; open note; edit (if in scope) via write or proposal.

The UI is a single front-end; it is configured with the Hub base URL (self-hosted or ICP) and uses the same endpoints.

---

## 5. ICP-specific notes

- **Internet Identity:** On ICP, the auth canister (or gateway) produces a principal or JWT that the Hub canister(s) trust. Document the exact flow (II login → session/JWT → API calls) in deployment docs.
- **CORS:** Canisters must allow the Hub UI origin; self-hosted Node must set CORS for the UI origin.
- **Storage:** Vault and proposals on ICP are stored in canister state (e.g. Documents/Assets patterns from bornfree-hub). Same API contract; implementation in Motoko (or Rust).

---

## 6. CLI integration

- **knowtation hub status** — Calls `GET /health` (and optionally an authenticated endpoint) to report whether the Hub at configured URL is reachable and the user is logged in (if token available).
- **knowtation propose --hub \<url\>** — Creates a proposal via `POST /proposals`; requires Hub URL and credentials (token from login flow or env). Document in setup how to obtain and store the token for CLI use.

See IMPLEMENTATION-PLAN Phase 11 deliverable 6 and SPEC for CLI behavior.
