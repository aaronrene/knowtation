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

- **GET /vault/folders** — Self-hosted: returns `{ "folders": string[] }` of vault-relative directory prefixes for the active vault (`inbox` first, then other top-level dirs and each `projects/<name>`). Hidden directories (names starting with `.`) are omitted. Used by the Hub **New note** folder picker; includes empty folders. Hosted gateway returns `{ "folders": ["inbox"] }` (no canister filesystem). JWT and vault access required.

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
  The Hub **merges server provenance** into frontmatter: `knowtation_editor` (JWT `sub`), `knowtation_edited_at`, `author_kind: human`. Client-supplied values for those keys (and other reserved `knowtation_*` fields) are **ignored**.  
  **Response:** `{ "path": "...", "written": true }`.  
  **400** if path invalid; **403** if not allowed.

- **POST /notes/batch** — Write many notes in one update (ICP canister: single `saveStable()` after all puts). Body: `{ "notes": [ { "path", "body", "frontmatter?" }, ... ] }`. Prefer **`frontmatter` as a JSON object** (same as gateway `POST /notes`). **Max 100** items per request; hosted bridge chunks larger imports. **Response:** `{ "imported": number, "written": true }`. **400** if JSON invalid or over limit.

- **DELETE /notes/:path** — Remove one note by vault-relative path (URL-encoded, same as GET). **Editor or admin** only (same write gate as `POST /notes`). **Response:** `{ "path": "...", "deleted": true }`. **404** if the note does not exist; **400** if path is invalid. **Hosted semantic search:** the bridge vector index is not updated automatically; after deletes, run **Re-index** so meaning-search does not return stale hits for removed paths (see bridge indexer behavior).

- **POST /notes/delete-by-prefix** — Bulk delete by **note path string** (vault-relative), **not** by Hub filter metadata. A note’s path is the key used in `POST /notes` (e.g. `inbox/capture.md` or `projects/acme/plan.md`). This endpoint deletes every `.md` file whose path **equals** `path_prefix` or starts with `path_prefix/` after trimming slashes. It does **not** look at frontmatter `project:` or `tags:` — notes that only set **Project** in the Hub UI but live under `inbox/...` are **not** matched by a prefix like `projects/my-slug` unless their paths actually sit under that folder. **Editor or admin** only. Body: `{ "path_prefix": "projects/acme" }` (example: delete everything under the `projects/acme/` folder layout). **Response:** `{ "deleted": number, "paths": string[], "proposals_discarded": number }` (self-hosted Hub also discards **proposed** proposals whose `path` equals one of the deleted paths or was already under the prefix). **400** if `path_prefix` is invalid. On **hosted** (ICP), the same path-string rule applies: there is no filesystem, but each note still has a stored path string. **Semantic search:** run **Re-index** after bulk delete so search does not return stale paths.

- **POST /notes/delete-by-project** — Bulk delete every markdown note in the current vault whose **effective project slug** matches the request (same rules as `GET /notes?project=` — frontmatter `project` and path inference under `projects/<slug>/` per [SPEC.md](./SPEC.md)). **Editor or admin** only (hosted: **`viewer`** denied). Body: `{ "project": "my-slug" }` (slug normalized like list-notes). **Response:** `{ "deleted": number, "paths": string[], "proposals_discarded": number }`. **Self-hosted:** Node Hub. **Hosted:** **gateway** orchestrates the canister (not a Motoko route). The **Hub** static bundle must include **PR #65** so Settings on hosted issues these POSTs (see [HUB-METADATA-BULK-OPS.md](./HUB-METADATA-BULK-OPS.md)).

- **POST /notes/rename-project** — Rewrites **frontmatter** `project` from `from` to `to` for every note in the current vault whose effective project slug matches `from` (does not move files on disk / path keys on canister). **Editor or admin** only. Body: `{ "from": "old-slug", "to": "new-slug" }`. **Response:** `{ "updated": number, "paths": string[] }`. **Self-hosted:** Node Hub. **Hosted:** **gateway** orchestrates `POST /notes` per matching path; same **Hub** client requirement as delete-by-project ([HUB-METADATA-BULK-OPS.md](./HUB-METADATA-BULK-OPS.md)).

- **POST /index** — Re-run the indexer (vault → chunk → embed → vector store). Use after bulk imports or when search should reflect new or changed notes. JWT required.  
  **Response:** `{ "ok": true, "notesProcessed": number, "chunksIndexed": number }`.  
  **500** on indexer or config failure.

- **POST /export** — Export one note to downloadable content (editor/admin). Body: `{ "path": string, "format"?: "md" | "html" }`.  
  **Response:** `{ "content": string, "filename": string }`. Client may create a blob and trigger download.  
  **400** if path invalid; **404** if note not found.

- **POST /import** — Import from uploaded file or ZIP (editor/admin). Multipart form: `source_type` (required), `file` (required), `project?`, `output_dir?`, `tags?` (comma-separated). Source types: markdown, chatgpt-export, claude-export, mif, mem0-export, audio, video, notion, jira-export, notebooklm, gdrive, linear-export. If file is a ZIP, it is extracted and the extracted folder is used as input (for folder-based sources like chatgpt-export).  
  After import, the Hub runs a **provenance pass** on each imported path (`author_kind: import`, editor `sub`).  
  **Response:** `{ "imported": [ { "path", "source_id?" } ], "count": number }`.  
  **400** if file or source_type missing/invalid; **500** on import failure.

### 3.3.0 Billing (Phase 16 hosted)

- **GET /billing/summary** — JWT required. Hosted gateway only.  
  **Response:** `{ "tier", "period_start?", "period_end?", "monthly_included_cents", "monthly_included_effective_cents", "monthly_used_cents", "addon_cents", "billing_enforced", "stripe_configured", "credit_policy", "monthly_indexing_tokens_included" (number or **null** for beta = unlimited display), "monthly_indexing_tokens_used", "pack_indexing_tokens_balance", "indexing_tokens_policy", "cost_breakdown": [ … ], "usage_chart_status" }`. **Free** tier: `monthly_included_effective_cents` reflects the $0 tier allowance. **`monthly_indexing_tokens_used`** increments after each successful hosted **Re-index** when the bridge returns **`embedding_input_tokens`**. See [HOSTED-CREDITS-DESIGN.md](./HOSTED-CREDITS-DESIGN.md).

- **POST /billing/webhook** — **Stripe** webhook endpoint; **no JWT**. Expects **raw JSON body** (signature verification). Not used on self-hosted Node Hub unless you expose the same route.

### 3.3.1 Settings and vault backup (JWT required)

- **GET /settings** — Safe config status for the Settings UI. No secrets or full paths.  
  **Response:** `{ "role", "user_id", "vault_id", "vault_list": [ { "id", "label?" } ], "allowed_vault_ids": string[], "vault_path_display", "vault_git": { "enabled", "has_remote", "auto_commit", "auto_push" }, "github_connect_available", "github_connected", "embedding_display" }`. Phase 15: `vault_list` and `allowed_vault_ids` drive the vault switcher; requests use **X-Vault-Id** to scope to a vault.

- **POST /vault/sync** — Run manual vault sync (same as `knowtation vault sync`): git add, commit, push. Use for "Back up now" in Settings.  
  **Response:** `{ "ok": true, "message": "Synced" | "Nothing to commit" }`.  
  **400** if vault.git not configured; **500** on git failure.

To **set the repository**: (1) Use **Settings → Setup** in the Hub to write vault path and Git remote to `data/hub_setup.yaml` (applied immediately). (2) Or edit `config/local.yaml` (see PROVENANCE-AND-GIT.md and How to use → Step 7). **Connect GitHub** (Settings): if the Hub has GitHub OAuth configured, users can click "Connect GitHub" to authorize with `scope=repo`; the Hub stores the token in `data/github_connection.json` and uses it for push so no deploy key is needed. Add callback URL `.../api/v1/auth/callback/github-connect` to your GitHub OAuth App.

- **GET /setup** — Editable setup (vault_path, vault_git) for the Setup wizard. Returns current values.  
- **POST /setup** — Body: `{ vault_path?, vault_git?: { enabled?, remote? } }`. Writes to `data/hub_setup.yaml` and reloads config (no restart). **400** if invalid; **500** on write failure.

### 3.3.2 Multi-vault admin (Phase 15; admin only)

- **GET /vaults** — List vaults (from `data/hub_vaults.yaml` or default single vault). **Response:** `{ "vaults": [ { "id", "path", "label?" } ] }`.
- **POST /vaults** — Body: `{ "vaults": [ { "id", "path", "label?" } ] }`. Writes `data/hub_vaults.yaml`. At least one vault must have id `default`. **400** if invalid.
- **DELETE /vaults/:vaultId** — Permanently remove a **non-default** vault. **Self-hosted (Node Hub):** **admin** only. Deletes the vault directory on disk (must resolve under the project root), removes the entry from `hub_vaults.yaml`, strips `vaultId` from `hub_vault_access.json` and `hub_scope.json`, removes proposals for that vault, and deletes vector-index rows for that `vault_id` (sqlite-vec / Qdrant). **400** if `vaultId` is `default` or unknown, or if two YAML entries share the same path. **403** if the resolved vault path is outside the project root. **Response:** `{ "ok": true, "deleted_vault_id", "proposals_removed", "vectors_purged" }`. **Hosted:** When `BRIDGE_URL` is set, the **gateway** proxies **DELETE** to the **bridge**, which calls the **canister** (Motoko upgrade), then updates team `hub_vault_access` / `hub_scope` and removes the per-user vector blob for that vault. **Editor or admin** (viewer denied); **workspace owner** required when `workspace_owner_id` is set (same as creating a cloud vault). Does **not** delete a linked GitHub repo. **ICP:** Deploy an upgraded canister that implements this route before hosted delete works in production.
- **GET /vault-access** — User → allowed vault IDs. **Response:** `{ "access": { "user_id": [ "vault_id", ... ] } }`.
- **POST /vault-access** — Body: `{ "access": { "user_id": [ "vault_id", ... ] } }`. Writes `data/hub_vault_access.json`.
- **GET /scope** — Per-user per-vault scope (projects/folders). **Response:** `{ "scope": { "user_id": { "vault_id": { "projects": [], "folders": [] } } } }`.
- **POST /scope** — Body: `{ "scope": { ... } }`. Writes `data/hub_scope.json`.

### 3.3.3 Hosted workspace owner and delegation (bridge + gateway)

On **hosted**, vault-access and scope JSON persist in the **bridge** (same shapes as §3.3.2). The gateway proxies these routes when `BRIDGE_URL` is set. **Workspace owner** controls which canister partition is shared with the team:

- **GET /workspace** — Admin. **Response:** `{ "owner_user_id": string | null }`.
- **POST /workspace** — Admin. Body `{ "owner_user_id": string | null }`. **`null`** disables delegation (each user uses only their own canister id).

**GET /hosted-context** — JWT. Returns `{ "actor_sub", "workspace_owner_id", "effective_canister_user_id", "delegating", "allowed_vault_ids", "scope": { "projects", "folders" } | null, "role" }` for the current **`X-Vault-Id`** header (default `default`). Used by the gateway and for debugging.

**Gateway → canister headers:** `X-User-Id` = effective partition owner; **`X-Actor-Id`** = JWT `sub` (human/agent who performed the action). Full semantics: [HOSTED-WORKSPACE-ACCESS.md](./HOSTED-WORKSPACE-ACCESS.md).

### 3.4 Proposals

**Variation protocol (Muse-aligned).** Proposals implement a variation lifecycle compatible with [Muse](https://github.com/cgcardona/muse): **identifiers** — `proposal_id` (variation id), `base_state_id` (optional, for optimistic concurrency); **intent** — human- or agent-readable reason for the change; **lifecycle** — propose → review → approve or discard. Default deployments **do not run Muse**; we align our API and payload so we can interoperate or adopt Muse later. Optional `external_ref` (e.g. future Muse commit id) may be added for cross-system references.

**Optional Muse linkage (operators).** A deployment may configure a **read-only** connection to a Muse instance for **lineage / structural history** queries (e.g. Git-replayed history in Muse’s model). That path is **not** required for JWT login, proposal CRUD, vault writes, or search. See [MUSE-STYLE-EXTENSION.md](./MUSE-STYLE-EXTENSION.md) §6.3.

- **POST /proposals** — Create a proposal (variation). Body: `{ "path?", "body?", "frontmatter?", "intent?", "base_state_id?", "external_ref?" }`. If path omitted, proposal may be a new note (server assigns path or client sends path).  
  **Response:** `{ "proposal_id": "...", "path": "...", "status": "proposed" }`.  
  **400** if invalid.

- **GET /proposals** — List proposals. Query: `status` (e.g. `proposed`, `approved`, `discarded`), `limit`, `offset`.  
  **Response:** `{ "proposals": [ { "proposal_id", "path", "status", "intent?", "base_state_id?", "external_ref?", "created_at?", "updated_at?" } ], "total": number }`.

- **GET /proposals/:id** — Get one proposal (metadata + proposed content).  
  **Response:** `{ "proposal_id", "path", "status", "intent?", "base_state_id?", "external_ref?", "body?", "frontmatter?", "created_at?", "updated_at?" }`.  
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
- **402** — *(Phase 16 hosted, when `BILLING_ENFORCE` is on)* Quota / billing. JSON includes `"code":`:
  - **`QUOTA_EXHAUSTED`** — The operation would exceed **both** the **monthly included** pool and **add-on rollover** credits for this period; user should **buy add-on credits**, **upgrade** tier, or wait for period reset. Primary code for “out of credits.”
  - **`SUBSCRIPTION_TIER_LIMIT`** — *(Optional / legacy)* Tier does not allow this operation or subscription inactive; upgrade or subscribe.
  - **`INSUFFICIENT_CREDITS`** — *(Narrow)* Add-on wallet cannot cover the remainder after monthly pool is exhausted (synonym of exhausted state; prefer **`QUOTA_EXHAUSTED`** for new clients).

See [HOSTED-CREDITS-DESIGN.md](./HOSTED-CREDITS-DESIGN.md). When enforcement is off (beta default), gateway does not return 402 for billing.
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
