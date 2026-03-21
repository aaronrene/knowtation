# Why the live Hub behaves differently from local (holistic view)

This doc ties together **recent changes**, **what broke or felt wrong**, and **what fixes what**.

---

## Two different backends (not a bug in “one” app)

| | **Local full Hub** (`npm run hub` → `hub/server.mjs`) | **Live** (`knowtation.store` + gateway + canister) |
|--|------------------------------------------------------|-----------------------------------------------------|
| **Vault** | Folder on disk (`KNOWTATION_VAULT_PATH`) | Per-user data **inside the ICP canister** |
| **Notes list** | Full metadata: `date`, `title`, `project`, `tags` from parsed Markdown | Canister returns minimal shape; no `GET /api/v1/notes/facets` |
| **Settings** | Real `hub_setup`, `hub_roles.json`, Git on disk | Was missing until gateway stubbed `GET /api/v1/settings` / `setup` |
| **JWT** | Includes `name`, `role` from roles file | Gateway now also adds `name`, `role` in the token |
| **OAuth callback** | `/api/v1/auth/callback/google` | `/auth/callback/google` (gateway path) |

Going live did **not** “break” the old app: the **browser is talking to a different server** (Netlify gateway → canister) instead of the Node Hub that reads your local vault. Same UI, different API surface.

---

## Recent changes (last day) and how they relate

1. **Gateway on Netlify + `web/hub/config.js`**  
   Live Hub sets `HUB_API_BASE_URL` to the gateway. All `/api/v1/*` (except what the gateway handles first) goes to the **canister**, not to `hub/server.mjs`.  
   **Effect:** Dashboard features that depend on the **full** Hub API (facets, rich note rows, list-notes filters, Git backup state from disk) were never implemented on the canister — so List / Calendar / Overview look empty or wrong **on live**, even though they worked locally against the full Hub.

2. **Canister work (`hub/icp` Motoko)**  
   Storage was refactored (single stable blob, parser fixes for Motoko base lib).  
   **Effect:** Redeploy can **reset** canister state if upgrade path isn’t preserving stable vars, or **new users** get empty vaults keyed by `google:…` — so “sample data gone” can be **empty canister per user**, not the UI randomly deleting data.

3. **Gateway fixes (CORS, Netlify bundling, redirect to `/hub/?token=`)**  
   **Effect:** Sign-in and redirects work on live; unrelated to List/Calendar.

4. **Gateway stubs: `GET /api/v1/settings`, `GET /api/v1/setup`, JWT `name` + `role`**  
   **Effect:** Header name and Settings Backup panel match expectations **on live** after deploy — without pretending the canister has a filesystem vault or Git.

---

## What the “three fixes” solve vs what’s still structural

| Issue | Cause | Fix |
|-------|--------|-----|
| Header shows `google:…` | Gateway JWT had no `name` | Gateway `issueToken` adds `name`, `role` (commit) |
| Settings: role / user ID / “Loading…” | Canister has no settings; proxy returned 404 | Gateway implements `settings` + `setup` (commit) |
| List / Calendar / Overview / filters | Canister API ≠ full Hub API | **Next:** facets + note metadata on canister or gateway enrichment (see [PARITY-PLAN.md](./PARITY-PLAN.md)) |
| Sample notes gone on live | Canister per-user store; not your local `vault/` folder | Seed canister or accept empty until sync/backup flows populate it |

---

## One-line summary

**Live uses gateway + canister; local full Hub uses disk + rich API.** Recent deploys exposed that gap (name, settings, dashboard). Committed gateway + UI fixes address **identity and Settings**; **dashboard richness** needs a follow-up on the canister (or bridge) API, not more Netlify env flipping.
