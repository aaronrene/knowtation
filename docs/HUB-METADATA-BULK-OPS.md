# Hub metadata bulk operations (project slug)

This document records the **product decision** and **API shape** for bulk delete/rename driven by **effective project slug** (frontmatter `project:` and/or path under `projects/<slug>/`), as defined in [SPEC.md](./SPEC.md). It complements [HUB-API.md](./HUB-API.md), which also documents the HTTP routes.

**Implementation status:** **Self-hosted (Node Hub)** — shipped on `main` (**PR #63**): `lib/hub-bulk-metadata.mjs`, Hub routes, tests, Settings UI. **Hosted** — the **gateway** implements the same two POST routes in [`hub/gateway/metadata-bulk-canister.mjs`](../hub/gateway/metadata-bulk-canister.mjs) (orchestrates the canister: `GET /notes`, per-path `DELETE` / `POST /notes`, proposal discards). **Motoko** still has no dedicated routes for these ops; behavior matches self-hosted via shared **`effectiveProjectSlug`** in [`lib/vault.mjs`](../lib/vault.mjs). **PR #65:** [`web/hub/hub.js`](../web/hub/hub.js) no longer short-circuits hosted users before `POST /notes/delete-by-project` or `rename-project` — production needs **both** a gateway build with bulk handlers **and** a static Hub deploy with that client. See [PARITY-MATRIX-HOSTED.md](./PARITY-MATRIX-HOSTED.md).

## Path prefix vs project slug

| Mechanism | Matches | Use when |
|-----------|---------|----------|
| `POST /api/v1/notes/delete-by-prefix` | Vault-relative **note path** string (same key as `POST /notes`) | Notes live under a folder layout you want to remove (e.g. `projects/acme/`). |
| `POST /api/v1/notes/delete-by-project` | **Effective project** (same as `GET /notes?project=`) | Notes are tagged with a project in frontmatter or path inference, regardless of folder. |

**Hosted (ICP):** There is no disk, but each note still has a **stored path string**; `delete-by-prefix` is implemented **in Motoko** and proxied from the gateway. **`delete-by-project` and `rename-project` are not Motoko routes**; the **gateway** runs them against the canister using existing list/delete/write/discard APIs (see [`hub/gateway/metadata-bulk-canister.mjs`](../hub/gateway/metadata-bulk-canister.mjs)).

## Product decision (hosted)

**Chosen strategy:** **Gateway-assisted** execution (implemented): the gateway handles the two POST paths **before** the catch-all canister proxy, lists notes with the same auth headers as the rest of the Hub (`X-User-Id` / `X-Actor-Id` / `X-Vault-Id`), matches **effective project slug** (frontmatter + `projects/<slug>/` path inference), applies **team scope** when `hosted-context` provides it, then issues per-note canister calls. **Optional later:** Motoko-native bulk endpoints if instruction limits or payload size require it.

- **Self-hosted Node Hub:** Implements `delete-by-project` and `rename-project` by scanning the vault ([`lib/hub-bulk-metadata.mjs`](../lib/hub-bulk-metadata.mjs) via `runListNotes` + delete/write).
- **Hosted gateway:** Same API contract and responses; [`web/hub/hub.js`](../web/hub/hub.js) uses the same Settings controls for canister-backed vaults.
- **Alternative (not in-repo):** Single Motoko upgrade that iterates stable storage and parses JSON frontmatter in-canister — higher complexity and cycle limits for large vaults.

## API contract (explicit modes)

These are **separate endpoints** (not a single `mode` query parameter) so mis-invocation is obvious and logs stay clear.

### `POST /api/v1/notes/delete-by-project`

- **Auth:** JWT; role **editor** or **admin** (hosted: **`viewer`** denied; **`member`** treated as editor per gateway JWT/bridge role).
- **Body:** `{ "project": "my-slug" }` — slug normalized like list-notes (`normalizeSlug`).
- **Response:** `{ "deleted": number, "paths": string[], "proposals_discarded": number }`.
- **Errors:** **400** if `project` missing/invalid after normalization.

### `POST /api/v1/notes/rename-project`

- **Auth:** JWT; role **editor** or **admin** (hosted: same as delete-by-project).
- **Body:** `{ "from": "old-slug", "to": "new-slug" }` — both required; normalized; `from === to` is a no-op (`updated: 0`).
- **Response:** `{ "updated": number, "paths": string[] }`.
- **Behavior:** Updates **YAML frontmatter** `project:` only; does **not** rename path keys or move notes between folders. Operators who need path moves should use a separate path-prefix workflow or a dedicated migration tool.

### Confirmations (Hub UI)

The Settings panel requires typing **`DELETE`** to confirm destructive deletes (path prefix and project slug) and **`RENAME`** for rename-project. API clients should implement their own confirmation UX; the server does not require a magic string in the JSON body.

## Vault rename (different feature)

Renaming a **vault id** or adding a **display label** is orthogonal to project slug housekeeping. See [VAULT-RENAME-SPEC.md](./VAULT-RENAME-SPEC.md).

## Related code

- Node routes: [`hub/server.mjs`](../hub/server.mjs)
- Hosted gateway: [`hub/gateway/server.mjs`](../hub/gateway/server.mjs) (registers POST handlers before canister proxy), [`hub/gateway/metadata-bulk-canister.mjs`](../hub/gateway/metadata-bulk-canister.mjs)
- Shared slug semantics: [`lib/vault.mjs`](../lib/vault.mjs) (`effectiveProjectSlug`)
- Proposal discard helper (self-hosted): [`hub/proposals-store.mjs`](../hub/proposals-store.mjs) (`discardProposalsAtPaths`); hosted uses canister `POST …/proposals/:id/discard`
- Tests: [`test/hub-bulk-metadata.test.mjs`](../test/hub-bulk-metadata.test.mjs), [`test/gateway-metadata-bulk.test.mjs`](../test/gateway-metadata-bulk.test.mjs)
