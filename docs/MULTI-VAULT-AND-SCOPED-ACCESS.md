# Multiple vaults and scoped access

*(Also **split vault**: splitting personal vs shared content, or multiple vaults in one place.)*

This doc answers: **What if I invite a teammate but don’t want them to see all my personal notes? How do we differentiate shared vs private content? Do we support multiple vaults, or filters/gates?**

---

## Current behavior (as implemented)

### Phase 15: Multi-vault and scoped access (self-hosted)

- **Config:** Self-hosted Hub supports **multiple vaults** via `data/hub_vaults.yaml` (id, path, label per vault; at least one with id `default`). If the file is absent, a single vault `default` from `vault_path` is used (backward compatible).
- **Vault access:** `data/hub_vault_access.json` maps user IDs to allowed vault IDs. Users not listed get `["default"]` only.
- **Scope (Option B):** `data/hub_scope.json` restricts a user to specific **projects** and **folders** within a vault. Omitted or empty = full vault. Projects are inferred from the note’s **path** (e.g. under `vault/projects/Launch/`) or from **frontmatter** (`project: Launch`); both are used for filters and scope. To put a note’s *file* in a project folder, use the Hub **+ New note** → “New note” tab and set Path to e.g. `projects/Launch/note.md`; Quick capture always writes to `inbox/` and can set project/tags in frontmatter only. Full detail: How to use in the Hub, Step 6 — “Notes: project, path, and tags”.
- **API:** All vault-scoped requests accept **`X-Vault-Id`** (or query `vault_id`). The server resolves vault, checks access, applies scope for list/search/facets. Proposals are keyed by `vault_id`.
- **Hub UI:** Vault switcher in the header (when multiple vaults are allowed); Settings → **Vaults** (admin): vault list, vault access, scope (JSON edit).
- **Roles:** Unchanged: viewer / editor / admin control actions. Vault access and scope control **which vault(s)** and **which projects/folders** a user sees.

### Hosted (canister + gateway + bridge) — code-verified (March 2026)

**Important:** **Self-hosted** multi-vault (this doc above) is **fully implemented**. **Hosted** is **not** the same yet.

| Layer | What happens with `X-Vault-Id` today |
|-------|--------------------------------------|
| **Hub UI** | Sends **`X-Vault-Id`** on API calls when the vault switcher is used (same as self-hosted). |
| **Gateway** (`hub/gateway/server.mjs`) | Forwards **`x-vault-id`** to the canister on proxy requests. CORS allows the header. |
| **Canister** (`hub/icp/src/hub/main.mo`) | **Does not read `X-Vault-Id`.** All note reads/writes use `getVault(uid)` — **one** `HashMap` of paths per user. Export returns **every** note for that user regardless of header. |
| **Bridge** (`hub/bridge/server.mjs`) | Index/search use **separate vector DB directories** per `(uid, vault_id)` (`getVectorsDirForUser`). The bridge **does** pass `X-Vault-Id` when calling canister export, but the canister **ignores** it, so each “vault” index is built from the **same full note set** until the canister partitions storage. **GitHub backup** export also omits vault scoping (full export). |

**Conclusion:** Hosted **multi-vault parity** requires **canister work**: partition storage by `(user_id, vault_id)`, thread **`vault_id`** through **export, list, read, write**, and (if you want self-hosted parity) **proposals**. Then re-verify **bridge** index/search and **GitHub backup** per vault (bridge already keys vectors by `vault_id` once export is scoped).

**Migration vs greenfield:** If production hosted has **almost no data** (a few test notes), you do **not** need a complex migration story: **redeploy** a canister with the new layout, or run a **one-shot** “copy all paths into `vault_id = default`” upgrade. Heavy migration matters when real users have large vaults; for early deploys, prefer **clear breaking upgrade + empty redeploy** if acceptable.

**Tracking:** **Phase 15.1 — hosted multi-vault** (after **Phase 2 bridge + `BRIDGE_URL` + pre-roll** are verified). See [STATUS-HOSTED-AND-PLANS.md](./STATUS-HOSTED-AND-PLANS.md) §2.

---

## Hosted multi-vault — what to build (Phase 15.1 checklist)

Order matters: **operational hosted baseline first**, then **canister partition**, then **product polish**.

| # | Work item | Why |
|---|-----------|-----|
| 1 | **Hosted Phase 2** — bridge deployed, gateway **`BRIDGE_URL`**, env + pre-roll, smoke: login, note CRUD, index/search | Stable baseline so you are not debugging multi-vault on a broken pipe. |
| 2 | **Canister — read `X-Vault-Id`** (default `default`), **partition note storage** `(uid, vault_id) → path → note` | Core fix; today header is ignored. |
| 3 | **Canister — export / list / get / post** scoped to `vault_id` | Bridge and UI depend on export semantics. |
| 4 | **Proposals (optional for v1)** — add `vault_id` to proposal records + filter by active vault if you need proposal parity with self-hosted | Can defer if proposals are single-vault on hosted initially. |
| 5 | **GitHub backup** (`hub/bridge` vault/sync) — pass `X-Vault-Id` and export **that** vault only (once canister supports it) | Today backup uses full export. |
| 6 | **Hosted vault list + access** — self-hosted uses `hub_vaults.yaml` + `hub_vault_access.json`. On hosted you need a **source of truth**: e.g. canister-stored vault registry per user, gateway env allowlist, or “create second vault” API. Without this, the UI may show vaults that do not exist server-side. | Prevents misleading switcher. |
| 7 | **Gateway `GET /api/v1/settings`** (hosted) — return **`vault_list`** / **`allowed_vault_ids`** consistent with canister (may be stub → real as registry ships) | Hub UI uses settings for switcher state. |
| 8 | **Tests** — see [IMPLEMENTATION-PLAN.md](./IMPLEMENTATION-PLAN.md) Phase 15 (regression safety); run **`npm test`** on every meaningful change; add canister/replica checks when Motoko changes. | Catch regressions early. |

**Not required for “hosted multi-vault MVP”:** Hosted **scoped folders** (`hub_scope.json` parity) can follow; **MCP D2/D3** can follow per [BACKLOG-MCP-SUPERCHARGE.md](./BACKLOG-MCP-SUPERCHARGE.md).

---

## How to configure multi-vault (Phase 15)

All files below live in the Hub **data directory**, usually `data/` (relative to the project root, or the path set in `config/local.yaml` under `data_dir`). You can edit them with any text editor, or use **Settings → Vaults** in the Hub (admin) to edit vault access and scope as JSON.

### 1. Find your user ID

- Open the Hub → **Settings** → **Backup** tab.
- Under **Your user ID** you’ll see a value like `google:104164334692309763642` or `github:12345678`. That is your **user ID** (format: `provider:id`). Copy it; you’ll use it in the JSON files.

### 2. Vault access — who can see which vaults

**File:** `data/hub_vault_access.json`

- **Purpose:** Maps each user ID to the list of vault IDs they are allowed to use. Users **not** listed get access only to the vault `default`.
- **Format:** A single JSON object. Keys = user IDs (string). Values = arrays of vault IDs (strings).

**Example (you and one teammate, both with access to `default`):**

```json
{
  "google:104164334692309763642": ["default"],
  "github:98765432": ["default"]
}
```

**Example (you have two vaults, teammate only the first):**

```json
{
  "google:104164334692309763642": ["default", "work"],
  "github:98765432": ["default"]
}
```

- **Editing:** Create or edit `data/hub_vault_access.json` with the structure above. Use your real user ID from Settings → Backup. Save the file. The Hub reads it on each request; **no restart needed**.
- **Optional:** You can also edit this via **Settings → Vaults** → **Vault access** (JSON textarea) → **Save vault access**.

### 3. Vault list — which vaults exist (only for multiple vaults)

**File:** `data/hub_vaults.yaml`

- **Purpose:** Defines the set of vaults (id, path, label). If this file is **absent**, the Hub uses a single vault with id `default` and the path from `vault_path` (or `hub_setup.yaml`). Create this file only when you want **more than one** vault.
- **Format:** YAML with a `vaults` array. At least one entry must have `id: default`. Paths can be absolute or relative to the project root.

**Example (two vaults):**

```yaml
vaults:
  - id: default
    path: ./vault
    label: Personal
  - id: work
    path: /Users/me/team-vault
    label: Team
```

- **Editing:** Create or edit `data/hub_vaults.yaml`. Ensure each path exists and is a directory. After changing this file you must **restart the Hub** (or add/edit vaults via **Settings → Vaults** → **Vault list** and Save, which reloads config without restart).

### 4. Scope — limit a user to certain projects/folders (optional)

**File:** `data/hub_scope.json`

- **Purpose:** Restricts a user to specific **projects** and/or **folders** within a vault. If a user has no entry (or an empty one) for a vault, they see the full vault.
- **Format:** A JSON object: keys = user IDs; values = objects whose keys are vault IDs and whose values are `{ "projects": ["p1", "p2"], "folders": ["folder/path"] }`.

**Example (user sees only project `team-project` and folder `inbox` in vault `default`):**

```json
{
  "github:98765432": {
    "default": {
      "projects": ["team-project"],
      "folders": ["inbox"]
    }
  }
}
```

- **Editing:** Create or edit `data/hub_scope.json`. Save the file. The Hub reads it on each request; **no restart needed**. Or use **Settings → Vaults** → **Scope** (JSON textarea) → **Save scope**.

### Quick reference

| File | Purpose | Restart after edit? |
|------|---------|---------------------|
| `data/hub_vault_access.json` | User → allowed vault IDs | No |
| `data/hub_vaults.yaml` | List of vaults (id, path, label) | Yes (or use Settings → Vaults to save) |
| `data/hub_scope.json` | Per-user per-vault projects/folders limit | No |

For **single-vault** setups you don’t need to create any of these: everyone gets vault `default` automatically. Add `hub_vault_access.json` only if you want to **explicitly** list users (e.g. with `["default"]`) or when you introduce a second vault and need to assign who sees which.

---

## User identity (Google vs GitHub) and multiple users

**User ID format:** Every logged-in user has a **user ID** of the form `provider:id` — for example `google:104164334692309763642` (signed in with Google) or `github:12345678` (signed in with GitHub). The Hub does not merge identities: if you sign in with Google in one session and with GitHub in another, you have **two** user IDs and the Hub treats them as two separate users. You see your current user ID in **Settings → Backup** (“Your user ID”).

**Multiple users on the same Hub:** You can have many users (many Gmail accounts, many GitHub accounts, or a mix) using the **same** Hub instance. Each person signs in with their chosen OAuth provider; that gives them one user ID. An admin adds each user ID to `data/hub_roles.json` (viewer/editor/admin) and, for multi-vault, to `data/hub_vault_access.json` (which vault IDs they can use). So the same Hub URL can serve a large number of users, each with their own role and vault access (and optional scope). The only limit is how many users you configure and how many distinct OAuth identities sign in.

**Backup per user:** “Connect GitHub” and “Back up now” are tied to the **currently logged-in user**. Each user can connect their own GitHub account (one token per user). When they click Back up now, the Hub pushes **the currently selected vault’s folder** to that vault’s Git remote. So:

- **Different users → different repos:** Typical case. User A connects GitHub and backs up vault “default” to repo A; user B connects their GitHub and backs up their vault to repo B.
- **Same repo, different branches:** Possible if you configure each vault folder’s Git remote to point to the same repo with a branch (e.g. `origin main` vs `origin user-branch`). The Hub does not manage branches in the UI; you’d set that up in the vault folder’s git config.
- **Same Hub, many vaults:** Each vault is a folder; each folder can be its own Git repo with its own remote. So one user can have access to vaults A and B and, when they switch vault and click Back up now, the Hub pushes that vault’s folder to that folder’s remote.

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
