# Multiple vaults and scoped access

*(Also **split vault**: splitting personal vs shared content, or multiple vaults in one place.)*

This doc answers: **What if I invite a teammate but don’t want them to see all my personal notes? How do we differentiate shared vs private content? Do we support multiple vaults, or filters/gates?**

---

## Current behavior (as implemented)

### Phase 15: Multi-vault and scoped access (self-hosted)

- **Config:** Self-hosted Hub supports **multiple vaults** via `data/hub_vaults.yaml` (id, path, label per vault; at least one with id `default`). If the file is absent, a single vault `default` from `vault_path` is used (backward compatible).
- **Vault access:** `data/hub_vault_access.json` maps user IDs to allowed vault IDs. Users not listed get `["default"]` only.
- **Scope (Option B):** `data/hub_scope.json` restricts a user to specific **projects** and **folders** within a vault. Omitted or empty = full vault.
- **API:** All vault-scoped requests accept **`X-Vault-Id`** (or query `vault_id`). The server resolves vault, checks access, applies scope for list/search/facets. Proposals are keyed by `vault_id`.
- **Hub UI:** Vault switcher in the header (when multiple vaults are allowed); Settings → **Vaults** (admin): vault list, vault access, scope (JSON edit).
- **Roles:** Unchanged: viewer / editor / admin control actions. Vault access and scope control **which vault(s)** and **which projects/folders** a user sees.

### Hosted (canister)

- The canister currently stores one logical vault per user. **X-Vault-Id** is forwarded by the gateway and bridge; the bridge keys index/search by (uid, vault_id). Canister storage keyed by (uid, vault_id) and migration of existing data to `default` is a follow-up (Phase 15.4).

---

## How to differentiate shared vs private today

### Option 1 — Multiple vaults (separate Hub instances)

**Supported today:** Run more than one Knowtation setup, each with its own vault and (optionally) its own Hub.

| Setup | Vault path | Who uses it |
|-------|------------|-------------|
| **Personal** | e.g. `~/my-vault` | Only you (one user or your own Hub URL). |
| **Team / shared** | e.g. `~/team-vault` or a shared drive | Shared Hub; invite teammates to this Hub only. |

- **How:** Two separate deployments (or two `npm run hub` processes with different `KNOWTATION_VAULT_PATH` and ports). Point the “team” Hub at the shared vault; keep the “personal” Hub (or local-only CLI) on your personal vault. No code changes required.
- **Limitation:** Teammates use one URL (team Hub) and see the whole team vault; you use another (personal) for private notes. There is no single login that shows “only my shared projects” — it’s two different apps/vaults.

### Option 2 — One vault, organize by project/folder (no isolation)

**Supported today:** Put shared work under `vault/projects/team-project/` and personal under `vault/projects/personal/` or `vault/inbox/`. Use **project** and **folder** filters in the Hub UI so that *you* usually browse by project. **This does not hide anything from teammates.** Anyone with access can still open “All projects” or search the whole vault. Filters are for convenience, not access control.

### Option 3 — Scoped access (not implemented)

**Not built:** Per-user or per-role **visibility rules** (e.g. “viewer X can only see project A and B”) or **gates** (e.g. notes under `vault/private/` are hidden from non-admins). Would require:

- A way to define scope (e.g. which projects/folders a role or user can see).
- Every notes list and search (Hub + API) filtering results by that scope.
- Possibly per-note or per-folder “visibility” metadata.

This is a future design; see “What would be needed” below.

---

## Are we set up for multiple vaults?

### Today

- **Multiple vaults = multiple deployments.** The codebase is built for **one vault per process**. To use “multiple vaults” you run multiple Hub instances (and/or multiple CLI environments), each with its own `vault_path`. The app does not support switching vaults in the UI or selecting a vault per request.
- **No vault selector in the Hub.** The Hub has no concept of “choose vault” or “workspace”; it always uses the single vault from config / `hub_setup.yaml`.

### If we add multi-vault later

Possible directions (for a future phase):

1. **Hub: multiple vaults per instance**  
   Config or `hub_setup` lists several vaults (e.g. by path or id). Each user or role is assigned to one vault (or a list). API and UI scope all operations to “the vault(s) this user can see.” Requires: vault list in config/setup, user→vault or role→vault mapping, and scoping every read path (list, search, get-note) by that mapping.

2. **Hub: one vault, scoped visibility**  
   Single vault; per-user or per-role allowlists for **projects** or **folders**. List/search/get-note filter out notes outside the user’s scope. Requires: store scope (e.g. in `hub_roles.json` or a new file), and apply scope in API and Hub UI for notes and search.

3. **CLI / MCP**  
   Today the CLI and MCP use a single `KNOWTATION_VAULT_PATH`. Multi-vault could mean: `--vault <id>` flag, or multiple MCP “resources” (one per vault), or separate CLI configs per vault. Agents would then target a vault explicitly.

None of this is implemented; the codebase is **not** currently set up for (1) or (2) beyond “run another Hub instance.”

---

## What to document for users

- **How to use / FAQ:** State clearly that inviting a teammate gives them access to the **entire** vault for that Hub; there are no in-app filters or gates that hide some notes. If they need to keep personal and shared separate, use **two vaults and two Hub instances** (or one shared Hub + local-only personal vault).
- **Settings / Team:** When we describe “invite” and “roles,” we should mention that roles control actions (viewer/editor/admin), not which part of the vault is visible. Optionally add a short “Sharing and multiple vaults” link to this doc or a How to use section.
- **Implementation plan / roadmap:** Treat “scoped access” or “multi-vault in one Hub” as a future phase; capture in IMPLEMENTATION-PLAN or TEAMS-AND-COLLABORATION as a known gap and design option.

---

## Summary

| Question | Answer |
|----------|--------|
| **How is shared vs private differentiated today?** | It isn’t within one Hub. Everyone with access sees the same vault. You differentiate by using **separate vaults** (and separate Hub instances) for personal vs team. |
| **What are the filters and gates?** | **Filters** (project, tag, folder) are for narrowing the list; they are **not** access gates. There are **no** gates that hide notes from certain users. |
| **Do users have to create multiple vaults?** | If they want true separation (e.g. don’t expose personal docs to teammates), **yes** — use multiple vaults and multiple Hub instances. |
| **Are we set up for multiple vaults?** | **Yes** in the sense that you can run multiple instances (each with its own vault path). **No** in the sense that a single Hub cannot serve or switch between multiple vaults; that would require new design and implementation. |

See **TEAMS-AND-COLLABORATION.md** for roles and invite flow; **SPEC.md** for single vault root; **ARCHITECTURE.md** for “one vault, many projects” and filters.

---

## Implementation status (Phase 15)

**Done (self-hosted):**

1. **Config/data:** `lib/hub-vaults.mjs`, `hub/hub_vault_access.mjs`, `hub/hub_scope.mjs`; `lib/config.mjs` loads vault list and exposes `vaultList` and `resolveVaultPath(vaultId)`. Single-vault default when `hub_vaults.yaml` is absent.
2. **Backend:** Hub server middleware resolves `req.vault_id`, checks vault access, sets `req.vaultPath` and `req.scope`. List, search, facets, proposals, index, export, import, sync are vault-scoped. Admin routes: GET/POST `/api/v1/vaults`, `/api/v1/vault-access`, `/api/v1/scope`. GET `/api/v1/settings` returns `vault_list` and `allowed_vault_ids`.
3. **Hub UI:** Vault switcher (header); Settings → Vaults tab (admin): vault list JSON, vault access JSON, scope JSON with Save.
4. **Bridge:** Index and search keyed by (uid, vault_id); vectors dir and Blob key include vault_id; canister export request sends X-Vault-Id.
5. **Gateway:** Forwards `x-vault-id` to canister.

**Follow-up (hosted canister):** Canister storage keyed by (uid, vault_id) and migration of existing data to vault_id `default` (Phase 15.4 in IMPLEMENTATION-PLAN).
