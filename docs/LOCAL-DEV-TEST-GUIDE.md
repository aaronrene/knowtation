# Local dev test guide

Quick checklist to verify Hub and CLI behavior when developing against your own vault. Use your existing setup (e.g. `data/hub_vaults.yaml` with your vault paths). No config changes required.

---

## 1. Notes to add (by hand or CLI)

Add these to your vault to exercise filters, search, and UI layouts. Adjust paths to match your vault root.

| Path | Purpose |
|------|---------|
| `inbox/quick-idea.md` | Inbox capture; shows in folder filter |
| `projects/my-app/overview.md` | Project note; shows project filter |
| `projects/my-app/decisions.md` | Same project, multiple notes |
| `areas/learning/resources.md` | Area-style path; different project tag |

**Example frontmatter** (copy into each file):

```yaml
---
title: Quick idea
project: inbox
tags: [capture, test]
date: 2026-03-21
---
```

```yaml
---
title: My app overview
project: my-app
tags: [planning, test]
date: 2026-03-21
---
```

**Or use the CLI** (set `KNOWTATION_VAULT_PATH` to your vault root first):

```bash
# Example: your default vault path from hub_vaults.yaml
export KNOWTATION_VAULT_PATH="/Users/you/knowtation-vault"

echo "# Quick idea" | node cli/index.mjs write inbox/quick-idea.md --stdin --frontmatter project=inbox tags=capture,test
echo "# Overview" | node cli/index.mjs write projects/my-app/overview.md --stdin --frontmatter project=my-app tags=planning,test
echo "# Decisions" | node cli/index.mjs write projects/my-app/decisions.md --stdin --frontmatter project=my-app tags=adr,test
echo "# Resources" | node cli/index.mjs write areas/learning/resources.md --stdin --frontmatter project=learning tags=media,test
```

---

## 2. Hub UI checks

With `npm run hub` running, open http://localhost:3333 and log in.

| Test | What to do | Expected |
|------|------------|----------|
| **List** | Open Notes tab | Your notes appear with title, tags, date |
| **Folder filter** | All folders → pick `inbox` | Only inbox notes |
| **Project filter** | All projects → pick `my-app` | Only my-app notes |
| **Tag filter** | All tags → pick `test` | Notes with `test` tag |
| **Quick filters** | Click `project:my-app` or `tag:test` | Filtered list |
| **New note** | + New note → fill path, title, body → Save | Note appears in list |
| **Edit** | Click a note → Edit → change body → Save | Changes persist |
| **Export** | Click a note → Export (editor/admin) | Download or copy works |
| **Search** | Search vault → type query → Search | Results if indexed (see §4) |

---

## 3. CLI checks

From repo root. Set `KNOWTATION_VAULT_PATH` to your vault if the CLI uses a different path than the Hub.

```bash
# List all
node cli/index.mjs list-notes --json

# List with filters
node cli/index.mjs list-notes --folder inbox --json
node cli/index.mjs list-notes --project my-app --json
node cli/index.mjs list-notes --tag test --json

# Get one note
node cli/index.mjs get-note inbox/quick-idea.md --json

# Search (requires index first)
node cli/index.mjs search "overview"
```

---

## 4. Index and semantic search

If `config/local.yaml` has `vault_path` pointing at your vault (or `KNOWTATION_VAULT_PATH`), run:

```bash
npm run index
```

This builds the vector store so **Search vault** in the Hub and `node cli/index.mjs search "query"` return semantic results. After adding notes, run **Re-index** in the Hub or `npm run index` again.

**Note:** The indexer uses the vault path from config; the Hub may use a different path from `hub_vaults.yaml`. For search to work on your default Hub vault, ensure the indexed vault matches (e.g. point config at the same path as `default` in hub_vaults).

---

## 5. Proposals (Suggested / Activity)

Proposals appear when you create them via the API (e.g. from an agent or CLI). To test manually:

- Use an agent/CLI that calls `POST /api/v1/proposals` with a JWT, or
- Create a proposal via the UI if that flow exists.

Then check **Suggested** and **Activity** tabs. Approve/discard flows require appropriate role (editor/admin).

---

## 6. Settings and backup

| Test | What to do | Expected |
|------|------------|----------|
| **Settings** | Click Settings | Backup, Team, Agents panels load |
| **Connect GitHub** | If configured, connect and verify | Token stored; Back up now enabled |
| **Back up now** | If GitHub connected, run backup | Repo pushed |

---

## 7. Quick reference

| Action | Command / Location |
|--------|--------------------|
| Start Hub | `npm run hub` |
| Index vault | `npm run index` |
| List notes (CLI) | `node cli/index.mjs list-notes --json` |
| Search (CLI) | `node cli/index.mjs search "query"` |
| Write note (CLI) | `node cli/index.mjs write path/to/note.md --stdin --frontmatter key=val` |
| Get JWT for API | DevTools → Application → Local Storage → `hub_token` |
