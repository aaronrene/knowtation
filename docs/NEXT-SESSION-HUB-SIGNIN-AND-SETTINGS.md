# Next session: Hub sign-in, Settings, and List/Overview/Calendar

Use this as the starting prompt or context when continuing Hub hosted fixes in a new session.

---

## What was fixed this session (do not redo)

1. **Header display name** — Gateway JWT in `hub/gateway/server.mjs` `issueToken()` now includes `name: user.displayName ?? ''` and `role: 'member'`. The Hub already uses `payload.name || payload.sub` in `web/hub/hub.js`, so the header shows the user's name instead of `google:...`.
2. **Settings Backup** — Gateway now implements `GET /api/v1/settings` and `GET /api/v1/setup` (before the `/api/v1` proxy to canister). Both require JWT and return the JSON shape the Hub expects. Settings no longer show "—" or "Loading…" for role, user ID, vault, Git, GitHub.
3. **Settings on error** — In `web/hub/hub.js`, the settings request `.catch()` now sets role, user_id, and GitHub status to "—" so a failed request does not leave "Loading…" forever.

---

## Sign-in (already working)

- Google/GitHub OAuth and redirect to `/hub/?token=...` work.
- CORS and callback URLs are documented in `docs/DEPLOY-STEPS-ONE-PAGE.md`.

---

## Still to fix: List, Overview, Calendar, facets, sample data

**Observed:** List and Overview don’t work or show "Not found"; Calendar is only partially there; sample data is gone.

**Verified causes:**

1. **Canister does not implement `GET /api/v1/notes/facets`**  
   The UI calls this for filter dropdowns (All projects, All tags, All folders). The canister routes `/api/v1/notes/<path>` as "get one note"; `notes/facets` is treated as a note path and returns 404. Fix: implement `GET /api/v1/notes/facets` on the canister (or have the gateway handle it by fetching notes and computing facets), returning the same shape as the full Hub.

2. **Canister note shape is minimal**  
   Canister returns `{ path, frontmatter: {}, body }` and does not expose `date`, `title`, `project`, `tags`. The Hub UI expects these for:
   - List: title, date, project/tag chips
   - Calendar: `n.date` for grouping by day (`dateSlice(n.date)`)
   - Overview: `n.date` for charts  
   Fix: Either (a) canister parses frontmatter and returns `date`, `title`, `project`, `tags` (and optionally `updated`), or (b) gateway intercepts `GET /api/v1/notes`, calls canister, and enriches each note (requires canister to send raw frontmatter string; gateway parses and adds fields). See full Hub contract in `lib/list-notes.mjs` and `hub/server.mjs`.

3. **Query params ignored by canister**  
   The canister’s `GET /api/v1/notes` ignores `since`, `until`, `folder`, `project`, `tag`. Filtered list and calendar ranges do not narrow results. Fix: implement filtering in the canister or in a gateway layer that applies filters after fetching.

4. **Sample data**  
   The canister vault is per-user (`X-User-Id`). If there was sample/demo data before, it may have been from a different backend or lost on canister upgrade. Confirm whether the hosted canister was ever seeded; if not, seed demo notes or document that new users start with an empty vault.

**Files to inspect:**

- `hub/icp/src/hub/main.mo` — add `notes/facets` route; extend notes response with parsed frontmatter or raw frontmatter for gateway enrichment; optionally apply query params.
- `web/hub/hub.js` — `loadNotes()`, `renderCalendar()`, `fetchNotesForDashboard()`, and any `api('/api/v1/notes/facets')` usage.
- `lib/list-notes.mjs`, `hub/server.mjs` — expected response shape for notes and facets.

---

## Multi-vault

See `docs/MULTI-VAULT-AND-SCOPED-ACCESS.md`. Identity and settings in the gateway are the place to add role/vault mapping when implementing multi-vault later.
