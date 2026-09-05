---
frozen: true
step: KN-DOCS-SYNC-a
model: "Thinking (thinking-high)"
date: 2026-08-17
branch: feat/kn-docs-sync-a
status: thinking-freeze-2026-08-17
supersedes: "Freezes Knowtation-owned live Google Drive (then Notion) connectors. Reuses Calendar 1D OAuth primitives (PKCE S256, AES-256-GCM vault, hosted blob strong-consistency). Does not invent a Scooling vault, collect a provider key in Scooling, flip Scooling /connect Drive to Ready, or change the existing Hub folder gdrive importer. This freeze does not authorize KN-DOCS-SYNC-b Auto until freeze-review pass."
evidence: "Scooling PRIMARY 2026-08-16 (ROADMAP F3i-kn; OVERSEER-HANDOVER NEXT). CONNECT-CATALOG-b BV pass sha256:6372219bce3ac96a10fe76db176ecf78cd0ffb6165178bb1d2265796845ef2e9. MEDIA-LIVE-READS smoke PASS. Hub lib/importers/gdrive.mjs is a Markdown-folder importer. Hub lib/importers/notion.mjs reads a Hub-only env name. Calendar 1D is the OAuth pattern."
---

# KN-DOCS-SYNC — Knowtation-owned live Drive (then Notion) connector

**Ground truth** for KN-DOCS-SYNC-b Auto. Downstream Auto may treat this document as ground truth without re-deriving. It does **not** flip Scooling `/connect` Drive or Notion to Ready, collect a provider key in Scooling, invent a second vault, send Hub `source_type` `gdrive` or `notion` from Scooling, flip `SCOOLING_MEDIA_*`, invent Live on Patterns / Models / Studio / threads, open presence or pairing, or work Parentier.org.

```yaml
phase: KN-DOCS-SYNC-a
outputs:
- id: kn-docs-sync
  path: docs/KN-DOCS-SYNC-FREEZE.md
  frozen: true
  notes: Drive readonly OAuth + encrypted refresh-material vault in Knowtation only; list/import as notes through Review-before-write; optional sync_cursor; Notion stays Hub-key. No Scooling Ready flip in this tip.
frozen_inputs:
- id: connect-and-open-range
  path: ~/scooling/docs/CONNECT-AND-OPEN-RANGE.md
  notes: KN-DOCS-SYNC steps; Scooling never collects the key; Drive honestly disabled until this lands
- id: connect-catalog
  path: ~/scooling/docs/reviews/2026-08-16-connect-catalog.md
  notes: Wave 2 freeze; Drive/Notion stay not_wired; denied Hub types include gdrive and notion
- id: connect-catalog-bv
  path: ~/scooling/docs/reviews/2026-08-16-connect-catalog-bv-round1-pass.md
  notes: CONNECT-CATALOG-b BV pass; digest sha256:6372219bce3ac96a10fe76db176ecf78cd0ffb6165178bb1d2265796845ef2e9
- id: bring-in-connect
  path: ~/scooling/docs/reviews/2026-08-16-bring-in-connect.md
  notes: docs_drive_live and docs_notion not_wired; calendar-1D pattern named for KN-DOCS-SYNC
- id: calendar-1d
  path: docs/CALENDAR-OAUTH-CONNECTOR-1D-SPEC.md
  notes: Confidential web client + PKCE S256; encrypted vault; redirect allowlist; Scooling never holds material
- id: gdrive-folder-importer
  path: lib/importers/gdrive.mjs
  notes: Folder of Markdown only — not Drive API. Unchanged by this Auto.
- id: notion-hub-importer
  path: lib/importers/notion.mjs
  notes: Hub-only env name; CLI / POST import path. Live hosted path is new Review-before-write routes.
- id: oauth-pkce
  path: lib/companion-oauth-pkce.mjs
  notes: S256-only; constant-time state; fail-closed. Reuse; do not fork a second PKCE core.
- id: calendar-token-vault
  path: lib/calendar/oauth-token-vault.mjs
  notes: AES-256-GCM + scrypt primitive to copy. Do not write Drive blobs into calendar_oauth.
- id: calendar-blob
  path: hub/bridge/calendar-blob-store.mjs
  notes: Hosted strong-consistency hydrate for pending OAuth state. Copy the pattern into a docs blob store.
- id: proposals-store
  path: hub/proposals-store.mjs
  notes: createProposal is the Review-before-write write path for imported notes.
- id: import-source-types
  path: lib/import-source-types.mjs
  notes: gdrive and notion remain import types. Live Drive does not POST those types from Scooling.
- id: scooling-roadmap-f3i-kn
  path: ~/scooling/docs/ROADMAP.md
  notes: F3i-kn owns this build; CONNECT-DRIVE-READY is a later Scooling Auto
review_stamp:
  reviewed_at: '2026-08-17T11:13:54Z'
  verdict: pass
  reviewer_mode: agent
  reviewer_model: thinking-high
  reviewer_provider: local
  kit_version: 0.1.0
  artifact_digest: sha256:cebd3d9d53f1c7dadcad2a5c7a09fbd280678f957fb66b1d364997622d623d96
downstream:
- id: KN-DOCS-SYNC-b
  model: Auto
  consumes_as_ground_truth: true
  notes: Implement Drive OAuth + vault + list + Review import + optional sync_cursor + Notion Hub-key list/import (inert gates). Starts only after freeze-review pass. Auto does not edit Scooling. Auto does not flip compile-time gates to true.
- id: CONNECT-DRIVE-READY
  model: Auto
  consumes_as_ground_truth: true
  notes: Later Scooling tip. Flip /connect Drive (then Notion) only after this Auto lands and Drive gate is operator-authorized. Not this Knowtation tip.
tier3_gates:
- T1 Muse main or muse-mirror to GitHub main (SD-14) outside SD-21 land hygiene
- T2 Setting DOCS_OAUTH_GOOGLE_AUTHORIZED or DOCS_NOTION_HUB_KEY_AUTHORIZED to the enabled literal in source or live env
- T3 Writing Google Drive client credentials or the docs vault wrapping secret into git
- T4 Pasting a Notion integration value into Scooling, a Scooling env, or a Scooling adapter
- T5 Flipping Scooling /connect docs_drive_live or docs_notion off not_wired (CONNECT-DRIVE-READY)
- T6 Any SCOOLING_MEDIA, SCOOLING_STUDIO, or SCOOLING_TASK_LOOP enabled assign
- T7 Live Google or Notion network from CI
- T8 Feature to GitHub main / non-muse-mirror head
```

Auto must not build until freeze review **pass**. This Thinking tip does **not** implement routes. This Thinking tip does **not** flip any env.

## Review record

| Round | Reviewer | Verdict | Resolution |
| --- | --- | --- | --- |
| 0 | Thinking (this session) | draft | Freeze authored from CONNECT-AND-OPEN-RANGE + CONNECT-CATALOG-b BV pass + Calendar 1D + Hub gdrive/notion importers |
| 1 | Freeze-review loop (thinking) | findings | R1-F1–F5 fixed below. CLI dry-run was already pass. |
| 2 | Freeze-review loop (thinking) + `ok review --freeze` | **pass** | R1 holds. No new cited findings. CLI C checklist clean. Cleared for KN-DOCS-SYNC-b Auto. Auto must not edit Scooling, flip gates, or `writeNote` on live routes. **No human escalation.** |

### Round 1 findings (cited — file+line)

| ID | Sev | Cat | Citation | Finding | Fix |
| --- | --- | --- | --- | --- | --- |
| R1-F1 | MAJOR | completeness | docs/KN-DOCS-SYNC-FREEZE.md:160 (prior D10) | D10 said Hub-key only but did not say the existing env is process-wide. Auto could invent per-vault Notion material. | D10 now locks process-wide env, no per-connector copy, `connected` = env present. |
| R1-F2 | MAJOR | security | docs/KN-DOCS-SYNC-FREEZE.md:191 (prior `q` name-contains) | List `q` was “name contains, ≤ 128” with no charset lock — Drive query injection. | `q` MUST match `^[A-Za-z0-9 ._-]{1,128}$` or 400; no raw `q=` build. Security tier covers it. |
| R1-F3 | MINOR | consistency | docs/KN-DOCS-SYNC-FREEZE.md:227 (prior) | `auto_approvable` is not a `hub/proposals-store.mjs` field (`createProposal` at `:204-215` has no such column). | Omitted. Admission lock is no T5 fingerprint + human approve. |
| R1-F4 | MINOR | completeness | docs/KN-DOCS-SYNC-FREEZE.md:166 (prior D16) | Per-file cap only; CONNECT-CATALOG batch cap `80_000_000` unbound. | D16 adds 80_000_000 bytes per import batch. |
| R1-F5 | MINOR | completeness | docs/KN-DOCS-SYNC-FREEZE.md §12 (prior) | “Hub UI or Scooling” in §4.3 left Hub chrome in Auto scope. | §12 excludes Hub wizard chrome; REST + tests only. |

## Citation discipline

Every freeze-review finding MUST cite **file+line** (OVERSEER-KIT-SPEC §6). Do not
trust uncited review output. HTTP routes in this doc omit the leading slash
(`api/v1/…`) so the freeze mechanical gate does not treat them as absolute machine
paths. Cross-repo paths use `~/scooling/…`. Never leading-slash absolute paths.

---

## 0. Job (lock)

People can already bring downloaded files into Knowtation from Scooling `/connect` after Review. Live Google Drive and Notion are **honestly off** on that page. This freeze writes the Knowtation-owned connector so a later Scooling tip can turn the Drive card on without ever holding a key.

Knowtation owns the Google consent, the stored refresh material, the file list, and the note proposals. Scooling may later start consent and show status only. Scooling never collects the key.

---

## 1. What stays frozen (do not reopen)

| Lock | Source | This Auto |
| --- | --- | --- |
| Knowtation is the only canonical store | CROSS-REPO-COORDINATION; ADAPTER-CONTRACTS | **Unchanged** |
| Review-before-write for durable notes | PROPOSAL-LIFECYCLE; BRING-IN-CONNECT §5.4 | **Holds** — live import creates proposals; apply writes notes |
| Hub folder `gdrive` importer | `lib/importers/gdrive.mjs` | **Unchanged** — still a folder of Markdown, not Drive API |
| Hub `notion` CLI / POST import | `lib/importers/notion.mjs` | **Unchanged** for admin CLI / POST `import`. Live hosted path is new routes |
| Scooling denied Hub types | CONNECT-CATALOG §6.2 | **Holds** — Scooling still never sends `gdrive` or `notion` |
| Scooling `/connect` Drive / Notion cards | BRING-IN-CONNECT §2.3 | **Stay `not_wired`** — CONNECT-DRIVE-READY is a later Scooling Auto |
| Calendar 1D OAuth | `docs/CALENDAR-OAUTH-CONNECTOR-1D-SPEC.md` | **Reuse primitives** — do not share the calendar vault directory or calendar client id |
| Media connector id `gdrive` | MEDIA-WRITE-SURFACES (opaque ref, no fetch) | **Unrelated** — do not reuse media import-consent for this path |
| MEDIA hosted reads | MEDIA-LIVE-READS smoke PASS | **Do not flip** `SCOOLING_MEDIA_*` |
| Sheets / chat inbox / Slack workplace | CONNECT-AND-OPEN-RANGE | **Out of scope** |
| Eight venue words / Home chat | SITE-FINISH / BRING-IN-CONNECT | **Unchanged** |

---

## 2. Hub ground truth (verified this session — do not re-derive)

| Fact | Citation | Consequence |
| --- | --- | --- |
| Hub `gdrive` is a folder of `.md` files | `lib/importers/gdrive.mjs:1-24` | Live Drive is a **new** connector, not an extension of POST `import` `gdrive` |
| Hub `notion` reads a Hub-only env name and writes notes directly | `lib/importers/notion.mjs:20-66` | Live Notion uses the same Hub-only env name and a **new** Review path |
| `IMPORT_SOURCE_TYPES` includes `gdrive` and `notion` | `lib/import-source-types.mjs:7-30` | Those strings stay for folder / CLI import. Scooling still must not send them |
| Calendar OAuth is confidential web + PKCE S256, vault under `calendar_oauth` | `docs/CALENDAR-OAUTH-CONNECTOR-1D-SPEC.md:39-44`; `lib/calendar/oauth-token-vault.mjs:79-83` | Copy the primitive; **new** directory `docs_oauth` |
| Calendar hosted callback needs strong blob consistency | `hub/bridge/calendar-blob-store.mjs:7-11` | Docs OAuth pending state uses the same strong-consistency rule |
| Scooling Drive / Notion cards are `not_wired` | `~/scooling/docs/reviews/2026-08-16-bring-in-connect.md:193-201` | This tip does not flip them |
| CONNECT-CATALOG-b BV pass | `~/scooling/docs/reviews/2026-08-16-connect-catalog-bv-round1-pass.md:13` | Wave 2 file cards are done; live Drive was out of that Auto |
| Scooling never stores a sync cursor | `~/scooling/docs/reviews/2026-08-16-bring-in-connect.md:213` | `sync_cursor` lives in Knowtation only |

---

## 3. Design decisions (frozen)

| # | Decision | Frozen value | Rationale |
| --- | --- | --- | --- |
| D1 | OAuth client type (Drive) | Confidential web application + PKCE S256 | Same as Calendar 1D D1. Client credential stays on the Knowtation server. |
| D2 | Drive scopes | `openid` and `https://www.googleapis.com/auth/drive.readonly` only | Read-only Drive + stable `sub`. No `email` / `profile`. No write scope. No `drive.file` (too narrow for folder list). No Sheets scope. |
| D3 | Refresh-material acquisition | `access_type=offline` and `prompt=consent` | Background list / sync without re-login. |
| D4 | Vault | AES-256-GCM + scrypt, copied from `lib/calendar/oauth-token-vault.mjs`, stored under `data/docs_oauth/{connector_id}.enc` | Do **not** write into `calendar_oauth`. Separate wrapping secret. Access material is in-memory only during a list / import / sync run. |
| D5 | Client registration | Separate Google Cloud client from Calendar | Drive scopes are Restricted; blast radius and verification stay separate. |
| D6 | Note write path | `createProposal` then approve / apply | Review-before-write. Live path MUST NOT call `writeNote` or POST `import`. |
| D7 | Frontmatter source | Live Drive notes use `source: google-drive` and `source_id` = Drive file id | Distinct from folder-import `source: gdrive`. Dedup by (`source`, `source_id`). |
| D8 | Revoke vs notes | Revoke deletes vault blob + Google revoke (best-effort). Vault notes **stay** | Notes are reviewed canonical content. Calendar events were copies in a calendar store; that purge rule does not apply. |
| D9 | Sync cursor | Optional opaque `sync_cursor` on the connector (Drive Changes `startPageToken` / `newStartPageToken`) | Knowtation-only. Sync creates proposals for new or changed allowlisted files; never silent note writes. `410` → full re-list. |
| D10 | Notion auth | Hub-key only (existing **process-wide** env name). **No** Notion OAuth. **No** per-vault or per-connector copy of that value | CONNECT-AND-OPEN-RANGE: Notion stays Hub-key; never pasted into Scooling. Hosted Hub already has one integration value. `connected` means the env is present. List/import sees only pages that integration can access. Per-user Notion login is a later freeze. |
| D11 | Google verification posture | v0 in Google testing mode with allowlisted test users | `drive.readonly` is Restricted. Public launch is a later operator / legal gate. |
| D12 | Compile-time gates | `DOCS_OAUTH_GOOGLE_AUTHORIZED` and `DOCS_NOTION_HUB_KEY_AUTHORIZED` hard-coded **false** in source | Operator Tier 3 to enable. Tests inject `authorizedOverride`. |
| D13 | Scooling role | Initiate + status only (later CONNECT-DRIVE-READY) | Scooling never holds refresh material, never calls Google or Notion, never stores `sync_cursor`. |
| D14 | Auto b DONE bar | Drive connector + Notion Hub-key connector both land **inert** | Drive is the first live flip. Notion code ships gated false so Scooling does not need a second Knowtation freeze. |
| D15 | MIME allowlist (Drive) | Google Docs, `text/markdown`, `text/plain`, `application/pdf`, Word `docx` | Sheets, Slides, folders-as-notes, audio, video, and other MIME → `unsupported_mime`. |
| D16 | Caps | 20 file ids per import; 25_000_000 bytes per file; **80_000_000** bytes per import batch; list page size 50; sync rate-limit 60s per connector | Aligns with CONNECT-CATALOG / BRING-IN-CONNECT file caps. |
| D17 | Hosted persistence | New docs blob store, strong consistency for pending OAuth state | Same failure that calendar fixed (callback on a different lambda). |

---

## 4. WHAT — surfaces

### 4.1 Providers

| `provider` | Auth | This Auto |
| --- | --- | --- |
| `google-drive` | Google OAuth (D1–D5) | Required |
| `notion` | Hub-key (D10) | Required, inert until T2 |

No Microsoft, Slack, Discord, Telegram, WhatsApp, Sheets, or chat-inbox provider.

### 4.2 Routes (self-hosted Hub + hosted gateway → bridge)

All routes except the Google callback sit behind existing JWT + vault access (same middleware class as `api/v1/calendar/...`). Gate off → **501** `{ code: 'NOT_AUTHORIZED' }` and **no** network, **no** vault I/O.

| Method / route | Role | Request | Response (no secrets) |
| --- | --- | --- | --- |
| `POST api/v1/docs/connectors` | editor, admin | `{ provider, display_name?, return_url? }` | Drive: `{ connector_id, authorization_url, expires_at }`. Notion: `{ connector_id, status }` (`connected` if Hub-key present, else `needs_reauth`) |
| `GET api/v1/docs/connectors/callback` | state-authenticated | `code` + `state` query | **302** to allowlisted `return_url`. Failure **302** `return_url` with `connect=error` and `reason` enum only |
| `GET api/v1/docs/connectors` | viewer+ | — | `{ schema: 'knowtation.docs_connectors/v0', connectors:[{ connector_id, provider, display_name, status, last_sync_at, last_sync_error, file_count }] }` |
| `GET api/v1/docs/connectors/:id/files` | viewer+ | `page_token?`, `q?` | `{ files:[{ file_id, name, mime, modified, size, importable }], next_page_token? }` — **no** bodies, **no** emails, **no** owners. `q` MUST match `^[A-Za-z0-9 ._-]{1,128}$` or the route returns **400** `BAD_REQUEST` (no Drive `q=` string built from raw input). |
| `POST api/v1/docs/connectors/:id/import` | editor, admin | `{ file_ids: string[] }` | `{ proposed, skipped, proposal_ids }` — creates proposals only |
| `POST api/v1/docs/connectors/:id/sync` | editor, admin | — | `{ proposed, skipped, last_sync_at }` — optional cursor; rate-limited ≥60s |
| `DELETE api/v1/docs/connectors/:id` | editor, admin | — | `{ revoked: true }` — blob gone; notes kept |

`status` enum: `pending`, `connected`, `needs_reauth`, `revoked`.

`last_sync_error` enum only: `auth_expired`, `rate_limited`, `provider_error`, `network_error`, `none`. **No** provider text.

Notion `POST` ignore `return_url`. Notion has no callback route. Notion `sync` uses Notion `next_cursor` stored as `sync_cursor`.

### 4.3 OAuth flow (Drive only)

```text
Later Scooling (CONNECT-DRIVE-READY) or Hub UI
   POST api/v1/docs/connectors  { provider: 'google-drive', return_url }
   Knowtation: PENDING connector; PKCE S256 + state (CSPRNG, TTL 10m,
   bound to vault_id + connector_id + return_url); persist verifier+state server-side
   → { connector_id, authorization_url, expires_at }
Browser opens authorization_url
Google consent (readonly + offline)
GET api/v1/docs/connectors/callback  (code + state)
   validate state (constant-time, single-use, not expired)
   exchange code + code_verifier + client credential at Google (server TLS)
   encrypt refresh material → oauth_ref; discard plaintext; access material in memory
   store account_sub (OpenID sub, never email)
   302 allowlisted return_url  (no code, no material in the redirect)
```

Redirect URI and `return_url` are **exact-match allowlisted** (env names in §8). Open redirects fail closed.

### 4.4 List → Review import (both providers)

1. List returns metadata only (`importable` true iff MIME / Notion type is allowlisted).
2. Import accepts 1–20 ids. Unknown / not importable / oversize / empty convert → `skipped` with bounded reason (`unsupported_mime`, `too_large`, `not_found`, `already_pending`, `empty_extract`).
3. Server fetches content (Drive export / download, or Notion markdown). Converts to one Markdown note per id.
4. Server calls `createProposal` with `source: import`, `review_queue: docs-sync`, and `intent` a fixed prefix plus the untrusted file name (truncated ≤ 128). Do **not** invent an `auto_approvable` field on the note store (`hub/proposals-store.mjs` has no such column). The admission lock is §4.4 step 9.
5. Path: `imports/google-drive/{safe_id}.md` or `imports/notion/{safe_id}.md`. `safe_id` is the provider id with non `[A-Za-z0-9_-]` stripped, ≤ 64 chars.
6. Frontmatter (Drive): `source: google-drive`, `source_id`, `connector_id`, `imported_at`. Notion: `source: notion`, `source_id` (page id), `connector_id`, `imported_at`.
7. If a live note already exists with the same (`source`, `source_id`), create an **edit** proposal with `base_state_id` — do not mint a second path.
8. Approve / apply uses the **existing** note-proposal apply path (self-hosted `createProposal` + apply; hosted gateway / canister propose + apply-approved). Auto MUST NOT add a new after-approve hook.
9. `docs-sync` proposals are **not** admitted to personal self-apply. Do not add a T5 fingerprint. Human approve only.

File / page **name** and body are **untrusted**. Existing proposal injection labels apply. Never interpret name as a command.

### 4.5 Optional sync

`POST …/sync` is optional. When `sync_cursor` is absent, perform a first page list and store the new cursor. When present, Drive uses Changes list; Notion uses search / database iterate with `next_cursor`. New or changed allowlisted items become proposals (same as import). Unchanged ids are no-ops. Sync never writes notes directly. Concurrent sync on the same connector → **429** `RATE_LIMITED`.

### 4.6 Revoke

1. Drive: decrypt `oauth_ref`; POST Google revoke (best-effort; network failure does not block local purge). Notion: no remote revoke API required.
2. Delete the encrypted blob (Drive) / clear Hub-key handle from the connector record (Notion never copies the Hub env into the record).
3. Set `revoked_at`, `status: revoked`; keep a material-free tombstone.
4. Do **not** delete imported notes.

`invalid_grant` on Drive refresh → `needs_reauth`, `last_sync_error: auth_expired`, stop sync. Notes stay. Hard `DELETE` is required to drop the connector.

---

## 5. HOW — modules and data

### 5.1 New modules (suggested paths)

| Path | Role |
| --- | --- |
| `lib/docs/oauth-token-vault.mjs` | Copy calendar vault primitive; path root `docs_oauth`; connector id `^conn_[A-Za-z0-9_-]{8,64}$` |
| `lib/docs/google-drive-connector.mjs` | PKCE begin, callback, list, export/download, sync, revoke. Injected Google client in tests |
| `lib/docs/google-drive-normalizer.mjs` | Pure MIME → markdown / skip. No network |
| `lib/docs/notion-hub-connector.mjs` | List + fetch using Hub env name; no OAuth |
| `lib/docs/docs-connector-store.mjs` | Connector records (no secrets); `sync_cursor`; tombstones |
| `lib/docs/docs-import-propose.mjs` | Build proposal input; dedup; caps |
| `hub/bridge/docs-blob-store.mjs` | Hosted hydrate/persist; **strong** consistency for pending OAuth |
| `hub/bridge/docs-routes.mjs` | Bridge route registration (mirror calendar) |

Gateway mounts the same path prefixes and proxies to the bridge (mirror `hub/gateway/server.mjs` calendar block). Self-hosted `hub/server.mjs` mounts the same routes.

### 5.2 Connector record (client-visible)

| Field | Client? | Notes |
| --- | --- | --- |
| `connector_id` | yes | `conn_…` |
| `provider` | yes | `google-drive` \| `notion` |
| `display_name` | yes | Untrusted; ≤ 128 |
| `status` | yes | enum §4.2 |
| `account_sub` | no | Drive OpenID `sub` only; never email |
| `oauth_ref` | no | Opaque handle to the enc blob |
| `sync_cursor` | no | Opaque provider cursor |
| `last_sync_at` | yes | ISO8601 or null |
| `last_sync_error` | yes | enum |
| `file_count` | yes | Last successful list count (0 if none) |
| `revoked_at` | yes | ISO8601 or null |

Vault payload (Drive, never returned): refresh material, granted scope string, token type, `obtained_at`, `account_sub`. Client id / client credential are **env only**, never written to the blob.

### 5.3 Drive conversion

| MIME | Action |
| --- | --- |
| `application/vnd.google-apps.document` | `files.export` as `text/markdown`; if empty, `text/plain` |
| `text/markdown` | download bytes as UTF-8 body |
| `text/plain` | download bytes as UTF-8 body |
| `application/pdf` | download bytes; convert with a **new exported** `pdfBytesToMarkdown(buf)` extracted from `lib/importers/pdf.mjs` (unpdf + `normalizeExtractedText`). CLI `importPdf` keeps `writeNote`. Live path MUST NOT call `importPdf` / `writeNote`. Empty or image-only extract → skip `empty_extract` |
| `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | download bytes; convert with a **new exported** `docxBytesToMarkdown(buf)` extracted from `lib/importers/docx.mjs` (mammoth + `normalizeMarkdownBody`). CLI `importDocx` keeps `writeNote`. Live path MUST NOT call `importDocx` / `writeNote`. Empty convert → skip `empty_extract` |
| `application/vnd.google-apps.folder` | list children only; not importable as a note |
| other | `importable: false`, skip `unsupported_mime` |

Google Docs export failure → skip `provider_error` for that id; do not fail the whole batch.

### 5.4 Notion conversion

Reuse the Hub markdown fetch already in `lib/importers/notion.mjs` **as a called helper or extracted function**, but the live route MUST go through `docs-import-propose` (proposals), not `writeNote`. List uses Notion search (pages the integration can see). Databases are listed as containers; import targets **pages**. Skip unsupported block types by omitting them (do not fail the page).

The Hub env name stays server-side. Connector records store **no** copy of that value.

---

## 6. Security invariants (enforced, not documented-only)

- **No secret egress.** Refresh material, client credential, authorization codes, `code_verifier`, `state`, Hub Notion value, and `sync_cursor` never appear in responses, redirects, logs, error messages, provenance, projections, MCP resources, or Scooling adapters.
- **State / CSRF.** `state` is CSPRNG, single-use, TTL 10m, bound to `vault_id` + `connector_id` + `return_url`, compared constant-time via `lib/companion-oauth-pkce.mjs`. Replay, tamper, expiry → deny.
- **PKCE S256 only.** `plain` rejected everywhere.
- **Redirect allowlist.** Exact match; no open redirect.
- **Read-only Drive scopes (D2).** Any write scope is a later freeze.
- **Scooling never collects the key.** No Scooling env, form field, adapter argument, or localStorage for Google or Notion material.
- **Untrusted content.** Names and bodies are untrusted prompt content.
- **Least data.** List omits owners, permissions, emails, sharing ACLs.
- **Server-only provider calls.** Agents never call Google or Notion. MCP may list connector **status** (token-free) but MUST NOT expose file bodies until a note exists via Review.
- **Backoff.** Honor `429` / `Retry-After`. Bounded retries (max 3) then `rate_limited`.
- **Gate off = inert.** False gates → 501, no network, no vault I/O.
- **Namespace isolation.** Docs vault directory ≠ `calendar_oauth`. Docs blob keys ≠ `calendar/oauth/…`.
- **Id injection.** `file_ids` / page ids must match `^[A-Za-z0-9_-]{1,128}$` (Drive) or Notion UUID-with-optional-hyphens ≤ 64. Else 400 `BAD_REQUEST`.

---

## 7. Fail-closed rules

| Code | When |
| --- | --- |
| `NOT_AUTHORIZED` | Gate false |
| `NOT_CONFIGURED` | Drive env incomplete on a begin/callback while gate is true |
| `STATE_INVALID` | Missing / replay / tamper / expiry / vault mismatch |
| `RETURN_URL_DENIED` | `return_url` not exact-allowlisted |
| `PROVIDER_DENIED` | Unknown `provider` |
| `CONNECTOR_NOT_FOUND` | Unknown or revoked id on mutating routes |
| `NEEDS_REAUTH` | Import / sync / list while `needs_reauth` |
| `RATE_LIMITED` | Sync < 60s or provider 429 exhausted |
| `BAD_REQUEST` | Cap exceeded, bad ids, unknown fields |
| `SOURCE_TYPE_DENIED` | Any attempt to treat this path as POST `import` `gdrive` / `notion` from a Scooling adapter in this tip (there is no Scooling adapter in this tip; regression test still asserts Hub does not accept a Scooling-shaped import body on these routes) |

Callback failures redirect with `reason` in `{ state_invalid, denied, provider_error, not_configured }` only.

---

## 8. Environment (never committed)

Names only — values are operator-set, never written in this artifact.

| Name | Purpose |
| --- | --- |
| `DOCS_OAUTH_GOOGLE_AUTHORIZED` | Tier 3 Drive gate; source default false |
| `DOCS_NOTION_HUB_KEY_AUTHORIZED` | Tier 3 Notion gate; source default false |
| `GOOGLE_DRIVE_OAUTH_CLIENT_ID` | Drive OAuth client id (server) |
| `GOOGLE_DRIVE_OAUTH_CLIENT_SECRET` | Drive OAuth client credential (server-only) |
| `KNOWTATION_DOCS_OAUTH_SECRET` | Vault wrapping secret (≥ 32 chars) |
| `DOCS_OAUTH_REDIRECT_URI` | Exact Google-registered callback URL |
| `SCOOLING_RETURN_URL_ALLOWLIST` | Reuse the existing Calendar allowlist (exact URLs) |
| `NOTION_API_KEY` | Existing Hub-only Notion value; never copied to Scooling |

`.gitignore` already excludes `data/`. `.museignore` must keep `data/` excluded. Auto adds `docs_oauth/` to any ignore file that currently names `calendar_oauth/` explicitly; if only `data/` is ignored, no ignore edit is required.

`.env.example` may list the **names** above with empty placeholders. Auto MUST NOT commit a real value.

---

## 9. Scooling consumer contract (not implemented here)

Frozen so CONNECT-DRIVE-READY cannot invent a second design. This Knowtation Auto **must not** edit the Scooling repo.

| Later Scooling may | Later Scooling must not |
| --- | --- |
| POST `api/v1/docs/connectors` with `provider: 'google-drive'` and an allowlisted `return_url` | Collect, store, or log refresh material |
| Open `authorization_url` in the browser | Call Google or Notion |
| GET connector status (token-free) | Send Hub `source_type` `gdrive` or `notion` |
| After Ready flip, let a person pick listed `file_id`s and POST import | Store `sync_cursor` |
| Flip `docs_drive_live` to Ready only after this Auto lands **and** Drive gate is operator-authorized | Flip Ready in the Knowtation tip |

Notion Ready on `/connect` is **after** Drive Ready (CONNECT-AND-OPEN-RANGE “then Notion”). Same rule: no key in Scooling.

---

## 10. Test matrix (seven-tier) — KN-DOCS-SYNC-b consumes this

All provider network is faked via an **injected** Google client and Notion client. No live Google or Notion call in CI. Live smoke is operator-run behind T2.

| Tier | File | Coverage |
| --- | --- | --- |
| unit | `test/docs-oauth-connector-unit.test.mjs` | PKCE/state build+validate; docs vault encrypt/decrypt + tamper fail; MIME allow/deny; id regex; path `safe_id`; gate false short-circuit |
| integration | `test/docs-oauth-connector-integration.test.mjs` | Drive begin → callback → list → import proposals → sync cursor → DELETE. Notion Hub-key list → import proposals. Dedup edit proposal |
| e2e | `test/docs-oauth-connector-e2e.test.mjs` | Hub/bridge route walkthrough with fakes: connect, list metadata only, import creates `docs-sync` proposals, approve apply writes one note, revoke keeps the note |
| stress | `test/docs-oauth-connector-stress.test.mjs` | Paginated list; 20-id cap; concurrent sync 429; Changes `410` full re-list without duplicate proposals |
| data-integrity | `test/docs-oauth-connector-data-integrity.test.mjs` | Dedup by `source`+`source_id`; vault blob survives restart; revoke deletes blob; notes remain; cursor opaque and not in GET connectors |
| performance | `test/docs-oauth-connector-performance.test.mjs` | List 50 + import 20 within local budget; vault decrypt overhead bounded |
| security | `test/docs-oauth-connector-security.test.mjs` | No material in responses/redirects/logs; state replay/tamper/expiry deny; PKCE `plain` rejected; redirect allowlist; gate off → 501 no network; Scooling-shaped POST `import` `gdrive`/`notion` not used; `file_ids` injection fixtures; list `q` reject quotes/operators; Notion value absent from connector JSON; calendar_oauth namespace unused; no T5 fingerprint for `docs-sync` |

Test command: `node --test test/docs-oauth-connector-*.test.mjs`.

Security tier MUST fail against a pre-fix stub that returns refresh material on GET connectors or writes notes from import without a proposal.

---

## 11. Auto file allowlist (KN-DOCS-SYNC-b)

| Path | Why |
| --- | --- |
| `lib/docs/**` | New connector / vault / normalizer / propose |
| `hub/bridge/docs-blob-store.mjs` | Hosted persistence |
| `hub/bridge/docs-routes.mjs` | Bridge routes |
| `hub/bridge/server.mjs` | Register docs routes + blob wrap |
| `hub/gateway/server.mjs` | Proxy the §4.2 prefixes |
| `hub/server.mjs` | Self-hosted mounts |
| `lib/importers/notion.mjs` | Extract fetch helper only; keep CLI `writeNote` behavior |
| `lib/importers/pdf.mjs` | Export `pdfBytesToMarkdown` only; CLI `importPdf` behavior unchanged |
| `lib/importers/docx.mjs` | Export `docxBytesToMarkdown` only; CLI `importDocx` behavior unchanged |
| `docs/HUB-API.md` | Honesty — live routes + “folder gdrive is not Drive OAuth” |
| `docs/openapi.yaml` | Route shapes |
| `docs/PROPOSAL-LIFECYCLE.md` | `docs-sync` queue note |
| `docs/KNOWTATION-ROADMAP.md` | Status |
| `docs/KNOWTATION-OVERSEER-HANDOVER.md` | NEXT |
| `test/docs-oauth-connector-*.test.mjs` | Seven-tier |
| `.env.example` | Names only, if the file exists on the tip |
| `.gitignore` / `.museignore` | Only if `calendar_oauth` is named and `docs_oauth` must join it |

**Forbidden in this Auto**

- Any path under `~/scooling/`
- `lib/importers/gdrive.mjs` behavior change
- `lib/calendar/**` writes (read/reuse only)
- Compile-time gate flipped to true
- `SCOOLING_*` or `MEDIA_*` env assigns
- New Hub `source_type` string
- Sheets / chat-inbox / Slack connectors
- Notion OAuth
- Direct `writeNote` on the live Drive / live Notion routes

---

## 12. Out of scope

- Scooling CONNECT-DRIVE-READY Ready flip
- Google Sheets live (`docs_sheets` stays `not_wired`)
- Chat inbox / Slack / Discord / Telegram / WhatsApp as workplace
- Drive write-back (create/edit Google files)
- Notion OAuth
- Google app public verification
- MCP/CLI parity for the new routes (after Hub REST is proven)
- Deleting vault notes on revoke
- OpenClaw Hub importer
- Hub UI chrome / new Hub wizard (REST + seven-tier only; learner UI is later Scooling CONNECT-DRIVE-READY)
- Presence, pairing, Parentier.org, Home chat

---

## 13. Definition of Done (KN-DOCS-SYNC-b)

- [ ] Freeze-review **pass** before Auto starts
- [ ] D1–D17 implemented; gates hard-coded false
- [ ] Seven-tier `test/docs-oauth-connector-*.test.mjs` green locally
- [ ] Build verification **pass** before ROADMAP → DONE
- [ ] Folder `gdrive` importer unchanged
- [ ] No Scooling file edits
- [ ] No secrets committed
- [ ] Both governance docs updated together
- [ ] Feature-branch hygiene; merge remains Tier 3 (or SD-21 land with no live flip)

### 13.1 Before Auto may start

- This artifact `frozen: true`
- `/freeze-review-loop` or `/freeze-review` verdict **pass**
- `ok review --freeze docs/KN-DOCS-SYNC-FREEZE.md` **pass**

### 13.2 Auto must not

- Flip Scooling Drive / Notion cards
- Collect a key in Scooling
- Enable the compile-time gates
- Call live Google or Notion from CI
- Treat Hub POST `import` `gdrive` as this feature
