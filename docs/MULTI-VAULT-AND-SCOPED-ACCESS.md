# Multiple vaults and scoped access

*(Also **split vault**: splitting personal vs shared content, or multiple vaults in one place.)*

This doc answers: **What if I invite a teammate but don’t want them to see all my personal notes? How do we differentiate shared vs private content? Do we support multiple vaults, or filters/gates?**

---

## Current behavior (as implemented)

### One Hub instance = one vault

- **Config:** A single `vault_path` (or `KNOWTATION_VAULT_PATH`) per Hub. All config, APIs, and CLI assume one vault root. There is **no multi-vault support** in code.
- **Roles:** Viewer / editor / admin control **what** a user can do (read-only, write, approve, change setup). They do **not** control **which notes** a user can see. Everyone with access to the Hub sees the **same vault**; roles only gate actions (e.g. viewers cannot edit or approve).
- **Filters:** The Hub and API support filtering by **project**, **tag**, **folder**, and date. These are **query filters** (narrow the list for convenience), not **access gates**. Any user who can list or search can omit filters and see the full vault (subject to their role’s actions).

So today: **inviting someone as a team member gives them access to the entire vault** (read-only if viewer, read/write if editor, full if admin). There is no way to “share only project X” or “hide my personal folder” within a single Hub.

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

## Finishing multi-vault in a later session (implementation checklist)

**Status:** Design and current behavior are documented above; **no code yet** for multiple vaults per Hub or scoped visibility.

**When implementing:**

1. Choose direction from "If we add multi-vault later" (e.g. multiple vaults per instance with vault list in config/setup, or one vault with scoped visibility by project/folder).
2. Add a dedicated phase to **IMPLEMENTATION-PLAN.md** (e.g. Phase 13.1 "Multi-vault / split vault") with concrete deliverables.
3. Implement in order: config/setup (vault list or scope rules) → backend scoping (list/search/get by vault or scope) → Hub UI (vault switcher or scope hints). For canister/hosted, extend canister and gateway to honor `vault_id` beyond the current default.
4. Update **STATUS-HOSTED-AND-PLANS.md** and this doc when done.
