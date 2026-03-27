# Hub metadata bulk operations (project slug)

This document records the **product decision** and **API shape** for bulk delete/rename driven by **effective project slug** (frontmatter `project:` and/or path under `projects/<slug>/`), as defined in [SPEC.md](./SPEC.md). It complements [HUB-API.md](./HUB-API.md), which also documents the HTTP routes.

## Path prefix vs project slug

| Mechanism | Matches | Use when |
|-----------|---------|----------|
| `POST /api/v1/notes/delete-by-prefix` | Vault-relative **note path** string (same key as `POST /notes`) | Notes live under a folder layout you want to remove (e.g. `projects/acme/`). |
| `POST /api/v1/notes/delete-by-project` | **Effective project** (same as `GET /notes?project=`) | Notes are tagged with a project in frontmatter or path inference, regardless of folder. |

**Hosted (ICP):** There is no disk, but each note still has a **stored path string**; `delete-by-prefix` semantics match self-hosted. **`delete-by-project` and `rename-project` are not implemented in the Motoko canister** in this repository.

## Product decision (hosted)

**Chosen strategy:** **Bridge/gateway-assisted** execution for metadata bulk ops on hosted until/unless **canister-native** parity is justified.

- **Self-hosted Node Hub:** Implements `delete-by-project` and `rename-project` by scanning the vault ([`lib/hub-bulk-metadata.mjs`](../lib/hub-bulk-metadata.mjs) via `runListNotes` + delete/write).
- **Hosted:** The production gateway forwards unknown note routes to the canister; those two paths are **not** on the canister, so callers get **404** unless a future gateway handler runs the job against storage (e.g. bridge with canister list/write APIs). The Hub UI hides project-slug delete/rename when the vault is canister-backed (see [`web/hub/hub.js`](../web/hub/hub.js)).
- **Alternative (not in-repo):** Implement Motoko iteration + JSON frontmatter parsing for `project` on every note — higher complexity and cycle limits for large vaults.

## API contract (explicit modes)

These are **separate endpoints** (not a single `mode` query parameter) so mis-invocation is obvious and logs stay clear.

### `POST /api/v1/notes/delete-by-project`

- **Auth:** JWT; role **editor** or **admin**.
- **Body:** `{ "project": "my-slug" }` — slug normalized like list-notes (`normalizeSlug`).
- **Response:** `{ "deleted": number, "paths": string[], "proposals_discarded": number }`.
- **Errors:** **400** if `project` missing/invalid after normalization.

### `POST /api/v1/notes/rename-project`

- **Auth:** JWT; role **editor** or **admin**.
- **Body:** `{ "from": "old-slug", "to": "new-slug" }` — both required; normalized; `from === to` is a no-op (`updated: 0`).
- **Response:** `{ "updated": number, "paths": string[] }`.
- **Behavior:** Updates **YAML frontmatter** `project:` only; does **not** rename path keys or move notes between folders. Operators who need path moves should use a separate path-prefix workflow or a dedicated migration tool.

### Confirmations (Hub UI)

The Settings panel requires typing **`DELETE`** to confirm destructive deletes (path prefix and project slug) and **`RENAME`** for rename-project. API clients should implement their own confirmation UX; the server does not require a magic string in the JSON body.

## Vault rename (different feature)

Renaming a **vault id** or adding a **display label** is orthogonal to project slug housekeeping. See [VAULT-RENAME-SPEC.md](./VAULT-RENAME-SPEC.md).

## Related code

- Node routes: [`hub/server.mjs`](../hub/server.mjs)
- Proposal discard helper: [`hub/proposals-store.mjs`](../hub/proposals-store.mjs) (`discardProposalsAtPaths`)
- Tests: [`test/hub-bulk-metadata.test.mjs`](../test/hub-bulk-metadata.test.mjs)
