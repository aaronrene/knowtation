# Forensic audit: Settings → Backup on hosted (knowtation.store)

This document traces **every moving part** from the UI labels **Git backup**, **GitHub**, and **Back up now** to the gateway, bridge, and Netlify Blobs. Use it when those fields look wrong after Connect GitHub or deploys.

---

## 1. Where the UI text comes from (`web/hub/hub.js`)

| UI element | Source |
|------------|--------|
| **Git backup** (`#settings-git-status`) | Derived from `s.vault_git`: `enabled`, `has_remote`, `auto_*`. Not from a separate “backup API.” |
| **GitHub** (`#settings-github-status`) | `s.github_connected` from `GET /api/v1/settings`. |
| **Back up now** (`#btn-settings-sync`) | Disabled/enabled from `settingsSyncDisabled()` (hosted vs self-hosted rules). |
| **Checklist “Backup configured”** (step 4) | `done = !!(vg.enabled && vg.has_remote)` — same `vault_git` object. |

Hosted mode is detected when `s.vault_path_display` lowercased is **`canister`**.

---

## 2. What the gateway returns (`hub/gateway/server.mjs`)

### Historical bug (fixed in repo)

`GET /api/v1/settings` used to **always** send:

```js
vault_git: { enabled: false, has_remote: false, auto_commit: false, auto_push: false }
```

So **Git backup** was **always** “Not configured” on hosted, even after a successful **Connect GitHub** and even with a stored token. That was **stub data**, not a live read from the bridge.

### Current behavior (intended)

After the fix, the gateway sets `vault_git` from the bridge-backed GitHub state:

- `enabled` ← `github_connected` (from `GET {BRIDGE_URL}/api/v1/vault/github-status` with the same `Authorization` as the client).
- `has_remote` ← whether the bridge reports a saved default `repo` (`owner/name`) for that user.

`github_connected` and `repo` still come from the bridge; if the bridge returns 401 or is unreachable, `github_connected` stays false (see §4).

---

## 3. “Back up now” was impossible for hosted members (fixed)

The Hub used:

```js
syncBtn.disabled = !vg.enabled || !vg.has_remote || !isAdmin;
```

The gateway hosted stub always returned **`role: 'member'`**, so **`isAdmin` was always false** → the button stayed **disabled** for every hosted user even when GitHub was connected and a repo was set.

**Fix:** On hosted with `github_connect_available`, allow sync **without** admin (user pushes to **their** repo with **their** token).

---

## 4. Bridge path for GitHub status and sync

1. Browser → `HUB_API_BASE_URL` + `/api/v1/settings` with `Authorization: Bearer <jwt>`  
   (`web/hub/config.js` sets gateway URL for `knowtation.store`.)

2. Gateway verifies JWT with `SESSION_SECRET`, then **server-side** `fetch(BRIDGE_URL + '/api/v1/vault/github-status', { headers: { Authorization } })`.

3. Bridge verifies the same JWT with **its** `SESSION_SECRET` (must **match** the gateway). Loads `hub_github_tokens` from Netlify Blobs (or local file if not serverless).

If **GitHub** still shows “Not connected,” the bridge response is not OK, `github_connected` in JSON is false, or deploy/env does not match (see `docs/CONNECT-GITHUB-AND-STORAGE-CHECK.md`).

---

## 5. Hosted had no way to send `repo` to sync (fixed)

`POST /api/v1/vault/sync` on the bridge **requires** a GitHub token **and** a repo (`owner/name`), from JSON body or from stored user state.

The Hub previously called:

```js
api('/api/v1/vault/sync', { method: 'POST' });
```

with **no body**. The self-hosted flow uses **Configure backup** (hidden on hosted) for the remote URL; hosted users had **no field** to enter `owner/repo`, so sync could not succeed and the bridge might never persist `repo` for `github-status` to return.

**Fix:** Hosted-only **Backup repo (owner/repo-name)** field + POST body `{ "repo": "owner/name" }`, with optional `localStorage` fallback and normalization of pasted GitHub URLs.

---

## 6. Netlify Blobs consistency

The bridge stores encrypted tokens under the `bridge-data` store with **eventual** consistency (`getStore` in [`netlify/functions/bridge.mjs`](../netlify/functions/bridge.mjs)). **Do not** set `consistency: 'strong'` for this Netlify Function unless Netlify documents that your environment exposes `uncachedEdgeURL`. Without it, reads/writes throw `BlobsConsistencyError` and the OAuth callback **crashes** before saving the token.

Read-after-write lag is mitigated in the Hub by retrying `GET /api/v1/settings` after `?github_connected=1` when opening Settings → Backup ([`web/hub/hub.js`](../web/hub/hub.js)).

---

## 7. Deploy checklist (operator)

| Piece | Must be true |
|-------|----------------|
| Hub static assets | Include latest `hub.js` / `index.html` / `hub.css` (4Everland or CDN). |
| Gateway | Deploy includes `GET /api/v1/settings` that merges bridge `github-status` and derived `vault_git`. `BRIDGE_URL` set. |
| Bridge | Deploy includes blob wrapper + `SESSION_SECRET` **identical** to gateway. |
| User flow (hosted) | Connect GitHub → enter **owner/repo** → **Back up now** → then **Git backup** can show **Configured** once `repo` is stored. |

---

## 8. Summary

| Symptom | Likely cause (verified in code) |
|---------|----------------------------------|
| **Git backup: Not configured** (hosted) | Gateway used to **hardcode** `vault_git` to all false; fixed by deriving from `github_connected` + `repo`. |
| **GitHub: Not connected** | Bridge/token/JWT/Blobs/deploy — not the same as “Git backup” line. |
| **Netlify “function has crashed” on `/auth/callback/github-connect`** | Blobs **strong** consistency without `uncachedEdgeURL` — use **eventual** only (see §6). |
| **Back up now** always disabled (hosted) | **`role === 'admin'`** gate + always **`member`** on gateway. |
| Sync errors / no repo | **No `repo` in POST body** and no hosted UI to set it. |

This file is descriptive of the **repository** behavior after the fixes above; production must be on builds that include those commits.
