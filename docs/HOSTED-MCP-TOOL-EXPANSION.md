# Hosted MCP tool expansion playbook

**Hub (browser) vs MCP (Cursor):** they do **not** auto-sync. For build order, shared APIs, and phased delivery when **both** matter, see [`docs/HOSTED-HUB-MCP-INTERLOCK.md`](HOSTED-HUB-MCP-INTERLOCK.md). For the **next-session handoff** (G0/G1 vs prompts, pasteable prompt), see [`docs/NEXT-SESSION-HOSTED-HUB-MCP.md`](NEXT-SESSION-HOSTED-HUB-MCP.md).

This document is the **diligence gate** for adding tools to [`hub/gateway/mcp-hosted-server.mjs`](../hub/gateway/mcp-hosted-server.mjs). It complements [`docs/NEXT-SESSION-HOSTED-MCP.md`](NEXT-SESSION-HOSTED-MCP.md) (EC2 ops) and the in-repo guards:

- `npm run check:mcp-hosted-schema` — forbids `z.record(z.unknown())` under `hub/gateway/mcp-hosted*.mjs` (Zod v4 JSON Schema export can fail **`tools/list` entirely**).
- `node --test test/mcp-hosted-tools-list.test.mjs` — golden tool names per role + full `tools/list` round-trip via MCP Client.
- `npm run verify:hosted-mcp-checklist` — runs both, then prints production verification steps.

## Reality check: safeguards vs new tools

The **safeguards session** added **no new `registerTool` blocks** and **no new HTTP wiring**. It added:

- Automated proof that **`tools/list`** succeeds (JSON Schema export) per role.
- A **CI script** that blocks a known-bad Zod pattern in `hub/gateway/mcp-hosted*.mjs`.
- This playbook, checklist script, and small edits to the handoff doc.

The **core seven** hosted tools in [`hub/gateway/mcp-hosted-server.mjs`](../hub/gateway/mcp-hosted-server.mjs) (search, get_note, list_notes, write, index, summarize, enrich) were **already** implemented before the safeguards work: most call **bridge** or **canister** via `upstreamFetch`. An **eighth** tool, **`import`** (admin), posts multipart to the bridge (`POST {bridgeUrl}/api/v1/import`) with the same `Authorization` + `X-Vault-Id` model as the gateway import proxy. A **ninth** tool, **`vault_sync`** (editor/admin), POSTs JSON to `POST {bridgeUrl}/api/v1/vault/sync` via `upstreamFetch` (optional body `{ "repo": "owner/name" }`), matching Hub **Back up now** / gateway proxy to the bridge. A **tenth** tool, **`export`** (admin), GETs **`/api/v1/export`** on the hub canister ([`hub/icp/src/hub/main.mo`](../hub/icp/src/hub/main.mo)) with the same canister headers as other hosted canister tools and an **MCP-only** response size cap (`EXPORT_TOO_LARGE` over the limit; Hub / `vault_sync` are not subject to that cap). An **eleventh** tool, **`relate`** (viewer), reads the source note on the canister and runs semantic **`POST /api/v1/search`** on the bridge. A **twelfth** tool, **`backlinks`** (viewer), paginates **`GET /api/v1/notes`** and **`GET …/notes/:path`** to scan bodies for `[[wikilink]]` matches (same key rules as `lib/backlinks.mjs`), capped at **2000** notes examined per call — see [`hub/gateway/mcp-hosted-server.mjs`](../hub/gateway/mcp-hosted-server.mjs) and the inventory table.

A **thirteenth** tool, **`extract_tasks`** (viewer), uses the same canister list pagination pattern plus checkbox parsing from `lib/extract-tasks.mjs` (`extractCheckboxTasksFromBody`), capped at **2000** list rows processed per call — see the inventory table for upstream and parity notes.

A **fourteenth** tool, **`cluster`** (viewer), uses the same canister list/get pattern as **`extract_tasks`** (up to **200** notes embedded, **2000** list rows scanned per call), then calls bridge **`POST /api/v1/embed`** for document vectors and runs **`lib/kmeans.mjs`** in the gateway — see the inventory row for exact bridge auth (`resolveHostedBridgeContext`, same model as **`POST /api/v1/search`**) and embedding parity with **`POST /api/v1/index`**.

A **fifteenth** tool, **`tag_suggest`** (viewer), reads the source note on the canister (or accepts raw **`body`**), runs semantic **`POST /api/v1/search`** on the bridge with a **default neighbor pool of 40** rows (optional MCP arg **`neighbor_limit`**, clamped **5–80**; **`snippetChars` 200**), and aggregates **`tags`** from results (with **`GET …/notes/:path`** fallback per neighbor). Local **`runTagSuggest`** uses the same **40** default for `store.search` — see the inventory row and § *Production verification: fifteenth tool `tag_suggest`*.

A **sixteenth** tool, **`capture`** (editor), builds the same inbox path and frontmatter as local **`buildCaptureInboxWritePayload`** / **`runCaptureInbox`** (`lib/capture-inbox.mjs`) and **`POST`s** **`{canisterUrl}/api/v1/notes`** with the same headers as **`write`** (`X-User-Id` = **`canisterUserId`**). Hub **`POST /api/v1/capture`** remains webhook-only (`X-Webhook-Secret`); hosted MCP does **not** use that route — see the inventory row and § *Production verification: sixteenth tool `capture`*.

A **seventeenth** tool, **`transcribe`** (editor), sends **`POST {bridgeUrl}/api/v1/import`** with **`source_type`** **`audio`** or **`video`** and multipart **`file`** (same contract as Hub import and hosted **`import`**), reusing bridge Whisper (`lib/transcribe.mjs`). Hosted MCP accepts **base64** bytes + **`filename`** (local MCP **`transcribe`** uses an absolute disk path instead) — see the inventory row and § *Production verification: seventeenth tool `transcribe`*.

What **is** still unwired: any **new** tool names you add to [`hub/gateway/mcp-tool-acl.mjs`](../hub/gateway/mcp-tool-acl.mjs) **before** registering them in [`hub/gateway/mcp-hosted-server.mjs`](../hub/gateway/mcp-hosted-server.mjs). As of **2026-04**, every ACL-listed hosted MCP tool name has a **`registerTool`** handler (including **`transcribe`** — see inventory row and § *Production verification: seventeenth tool `transcribe`*).

### Hosted MCP canister **`X-User-Id`** parity with Hub (2026-04)

**Shipped:** `main` (PR **#170**, gateway on EC2 after `git pull` + `npm ci` + `pm2 restart`). MCP session bootstrap in [`hub/gateway/mcp-proxy.mjs`](../hub/gateway/mcp-proxy.mjs) reads **`effective_canister_user_id`** from bridge **`GET /api/v1/hosted-context`** (same bridge payload the Hub gateway uses via `getHostedAccessContext`) and passes it into **`createHostedMcpServer`** as **`canisterUserId`**. All MCP → **canister** `fetch` calls in [`hub/gateway/mcp-hosted-server.mjs`](../hub/gateway/mcp-hosted-server.mjs) use that value as **`X-User-Id`**, matching **`gatewayProxyGetNotesList`** / **`proxyToCanister`**, where the gateway sends **`x-user-id: effective`** and **`x-actor-id: actor`** for browser **`GET /api/v1/notes`**.

**`knowtation://hosted/vault-info`** returns **`userId`** (JWT `sub`, the signed-in **actor**), **`canisterUserId`** (effective canister partition for reads/writes), **`vaultId`**, **`role`**, and **`scope`**. Under workspace delegation **`userId`** and **`canisterUserId`** **differ**; for a solo account the bridge usually returns the same string for both.

**Why it mattered:** Previously MCP always sent JWT `sub` as **`X-User-Id`** to the canister while the Hub listed notes for **`effective_canister_user_id`**, so delegated users could see a **full** vault in the browser but a **small** actor-only partition over MCP (e.g. **`list_notes`** **`total`** far below Hub “Total”).

**Tests:** [`test/mcp-hosted-canister-user-parity.test.mjs`](../test/mcp-hosted-canister-user-parity.test.mjs) — **`list_notes`**, **`get_note`**, **`write`**, **`export`**, and **`vault-info`** shape.

**Operational reminder:** After any gateway deploy that touches MCP, **reconnect** Cursor **`knowtation-hosted`**. See [AGENT-INTEGRATION.md](./AGENT-INTEGRATION.md) § Hosted MCP — *Canister user parity*.

### Production verification: twelfth tool `backlinks` (2026-04)

**Status:** Complete, deployed, and smoke-tested on the **persistent MCP host** (EC2). **`backlinks`** is the **twelfth** registered hosted tool (after **`relate`** as the eleventh).

**What “working” means here:** Cursor **`knowtation-hosted`** lists **thirteen** tools for **admin** today (including **`backlinks`** and **`extract_tasks`**); `vault-info` and `list_notes` succeed; calling **`backlinks`** with a path from `list_notes` returns JSON with `path`, `backlinks`, `backlinks_notes_scanned`, and `backlinks_truncated`. An **empty** `backlinks` array is correct when no note bodies contain inbound **`[[wikilink]]`** markup.

**Operator pitfall (resolved in same window):** PM2’s **`script path`** must point into the repo you **`git pull`** on (often **`/opt/knowtation`**, not only **`~/knowtation`**). Otherwise the live server stays on old code and Cursor stays at eleven tools until that tree is updated and the gateway restarted.

### Production verification: thirteenth tool `extract_tasks` (2026-04)

**Status:** Complete, merged to `main`, and **production smoke-tested** on the **persistent MCP host** (EC2) via Cursor **`knowtation-hosted`** (2026-04). **`extract_tasks`** is the **thirteenth** registered hosted tool.

**What “working” means here:** Cursor lists **thirteen** admin tools including **`extract_tasks`**; **`vault-info`** returns expected `userId` / `vaultId` / `role`; **`list_notes`** succeeds; **`extract_tasks`** returns JSON with `tasks`, `extract_tasks_notes_scanned`, and `extract_tasks_truncated`. Optional **`folder`**, **`project`**, **`tag`**, **`since`**, **`until`** mirror hosted **`list_notes`** query keys on `GET /api/v1/notes`; **client-side** filtering matches local `runExtractTasks` metadata rules because the ICP canister in-repo list handler does not interpret those query parameters (parity gap vs `list_notes` through the Netlify gateway is documented in the inventory row).

**Live smoke (recorded):** `extract_tasks` with `status: "open"` and `folder: "inbox"` on a small vault returned `extract_tasks_notes_scanned` consistent with listed rows, `extract_tasks_truncated: false`, and `tasks: []` — validated against **`get_note`** on a sample path (e.g. `inbox/my-note.md`) whose **body had no** `- [ ]` / `- [x]` lines; empty `tasks` is **correct** in that case. To see non-empty `tasks`, add checkbox lines via **`write`** or **`import`**, then re-run step **4d**.

### Production verification: fourteenth tool `cluster` (2026-04)

**Status:** Complete, merged to `main` (PR **#168**), and **production smoke-tested** on the **persistent MCP host** (EC2) via Cursor **`knowtation-hosted`** (2026-04). **`cluster`** is the **fourteenth** registered hosted tool.

**What “working” means here:** Cursor lists **fourteen** admin tools including **`cluster`**; **`vault-info`** returns expected `userId` / `vaultId` / `role`; **`list_notes`** succeeds; **`cluster`** returns JSON with `clusters`, `notes_sampled`, `max_notes`, `cluster_list_rows_scanned`, and `cluster_truncated`. With **six** notes in the vault and **`n_clusters: 4`**, a recorded smoke run returned **`notes_sampled: 6`**, **`cluster_truncated: false`**, **`cluster_list_rows_scanned: 6`**, and **four** clusters partitioning paths across `inbox/` and `projects/launch/` (no `note` field when `clusters` is non-empty). Empty `clusters` with a **`note`** string remains valid when there are fewer eligible notes than *k* or when too few vectors survive embedding.

**Seventeenth tool:** **`transcribe`** (ACL **editor**) — bridge **`POST /api/v1/import`** with **`audio`** / **`video`** (see § *Production verification: seventeenth tool `transcribe`*). **`capture`** remains the **sixteenth** tool (canister **`POST …/notes`**); **complete** as of **2026-04** — § *Production verification: sixteenth tool `capture`*.

## How to test hosted MCP

### Automated tests (not in chat)

These run in a **terminal** from the repo clone. They do **not** call your live vault or EC2.

| Command | What it proves |
|---------|----------------|
| `npm run verify:hosted-mcp-checklist` | Schema guard + in-memory `tools/list` + golden tool **names** (mock URLs). |
| `npm test` | Full suite, including the above. |

Use them before merge; they are **not** a substitute for live checks below.

### In Cursor chat (live hosted MCP)

Here you **do** use Cursor: enable the **`knowtation-hosted`** MCP server for this chat (or start a new chat with that server enabled). The model invokes MCP **tools** and **resources** on your behalf when you ask clearly.

**Setup**

1. **Cursor → Settings → MCP / Tools & MCP:** confirm **`knowtation-hosted`** is on (green) and points at your **persistent** MCP URL (EC2), not Netlify-only `/mcp`. See [AGENT-INTEGRATION.md](./AGENT-INTEGRATION.md) and [NEXT-SESSION-HOSTED-MCP.md](./NEXT-SESSION-HOSTED-MCP.md).
2. Optional: open the MCP panel / tool list and confirm you see **seventeen** tools if your Hub role is **admin** (fewer if viewer or editor).
3. Start a **new Composer/Agent chat** with hosted MCP enabled so tool calls are unambiguous.

**What “path” means (hosted users — not local, not the Hub URL)**

MCP tools like `get_note`, `write`, `summarize`, and `enrich` use a **vault-relative note path**: the note’s location **inside your hosted vault**, as the Hub/canister store it. Examples: `inbox/quick.md`, `projects/research/ideas.md`. That string is **not**:

- a file path on your laptop (there is no local vault folder for pure hosted users in this flow), or  
- your **browser URL** (e.g. `https://…/hub/…` with the notes list open). The dashboard URL is only for humans in the browser; the MCP API expects the **note identifier** returned by tools or shown as the note’s path in the Hub when you inspect a note.

**How to get a path without guessing:** run **`list_notes`** first (step 2); copy one `path` (or equivalent field) from the JSON. Use that exact string in **`get_note`**, **`summarize`**, and **`enrich`**. For **`write`**, you **choose** a new vault-relative path (still not a browser URL), e.g. `mcp-smoke/cursor-test.md`.

**Copy-paste prompts (in order)**

Use these one at a time. Replace `VAULT_NOTE_PATH` with a path from `list_notes` (step 2).

| Step | What you are proving | Paste into Cursor chat |
|------|----------------------|-------------------------|
| 0 | Server lists tools | `Using only the knowtation-hosted MCP server: list the tool names available to you and confirm there are seventeen tools if I am an admin (including relate, backlinks, extract_tasks, cluster, tag_suggest, capture, and transcribe).` |
| 1 | Session + vault context | `Using only knowtation-hosted: read the MCP resource vault-info and show the full JSON (userId, canisterUserId, vaultId, role, scope).` |
| 2 | Canister list | `Using only knowtation-hosted: call the list_notes tool with limit 10 and show the returned paths or note list.` |
| 3 | Canister read | `Using only knowtation-hosted: call get_note with path "VAULT_NOTE_PATH" — use exactly one path string copied from the list_notes result (vault-relative, not a browser URL). Show the body or error.` |
| 4 | Bridge search | `Using only knowtation-hosted: call search with query "<a short phrase you know exists in your hosted vault>" and mode semantic (or keyword if you prefer). Show a snippet of the results.` |
| 4b | Relate (viewer+) | `Using only knowtation-hosted: call list_notes with limit 10, copy one path, then call relate with that path and limit 5. Report path, related.length, and one related entry if any. Empty related is OK for tiny vaults or weak semantic overlap after canister filtering.` |
| 4c | Backlinks (viewer+) | `Using only knowtation-hosted: call list_notes with limit 10, pick path A for a note that should be linked to, and path B for a note whose body contains [[title-or-stem of A]]. Call backlinks with path A. Report paths, backlinks_notes_scanned, backlinks_truncated, and any inbound path matching B.` |
| 4d | Extract tasks (viewer+) | `Using only knowtation-hosted: call extract_tasks with status open and optional folder from list_notes. Report tasks.length, extract_tasks_notes_scanned, extract_tasks_truncated, and one task object if any.` |
| 4e | Cluster (viewer+) | `Using only knowtation-hosted: call cluster with optional folder/project from list_notes and n_clusters 3–5. Report clusters.length, notes_sampled, max_notes, cluster_truncated, and one cluster’s paths if any. Empty clusters with a note string is OK for tiny vaults or k larger than note count.` |
| 4f | Tag suggest (viewer+) | `Using only knowtation-hosted: call tag_suggest with path "VAULT_NOTE_PATH" from list_notes (vault must be indexed). Report suggested_tags, existing_tags, and lengths. Optional neighbor_limit (5–80) for a larger semantic neighbor pool. Empty suggested_tags is OK if neighbors lack tags or overlap is weak; optionally call tag_suggest with body only on a short pasted paragraph.` |
| 5 | Canister write (editor/admin) | `Using only knowtation-hosted: call write with path "mcp-smoke/cursor-test.md", body "# MCP smoke\n\nWritten from Cursor chat test.", and no frontmatter unless needed. Then call get_note with path "mcp-smoke/cursor-test.md" (same vault-relative path) to confirm it round-trips.` |
| 5b | Fast capture (editor/admin) | `Using only knowtation-hosted: call capture with text "MCP inbox smoke line" and optional source "cursor-smoke". Report the JSON path, then call get_note with that path to confirm body and inbox frontmatter (source, date, inbox).` |
| 6 | Bridge index (admin, costly) | **Skip until read/write pass.** When ready: `Using only knowtation-hosted: call the index tool (no arguments). Report success or the JSON error from the tool.` |
| 6b | Bridge import (admin) | **After a small test file is ready:** `Using only knowtation-hosted: call the import tool with source_type markdown, filename mcp-import-smoke.md, and file_base64 set to the base64 of a short UTF-8 markdown file (e.g. "# smoke\\n"). Report imported paths or error JSON.` Same upstream as Hub: bridge `POST /api/v1/import` (multipart); **no canister Motoko changes** — the bridge already batch-writes to the canister. |
| 6c | Canister export (admin) | **Small vault or expect cap:** `Using only knowtation-hosted: call the export tool with no arguments. Paste the JSON top-level keys and note count, or EXPORT_TOO_LARGE if the vault exceeds the MCP-only size limit.` Same upstream as bridge vault backup: canister `GET /api/v1/export`. |
| 7a | Summarize + sampling | `Using only knowtation-hosted: call summarize with path "VAULT_NOTE_PATH" (from list_notes) and style brief. Paste the tool result.` |
| 7b | Enrich + sampling | `Using only knowtation-hosted: call enrich with path "VAULT_NOTE_PATH" (from list_notes). Paste the tool result.` |
| 8 | Bridge vault backup (editor/admin) | **Only if GitHub is connected** for your user on the bridge (same as Hub **Back up now**): `Using only knowtation-hosted: call vault_sync with no arguments (or with repo "owner/name" if needed). Paste the JSON result or error.` Expect `400` with `GITHUB_NOT_CONNECTED` / `REPO_REQUIRED` when GitHub is not set up — that confirms the tool reaches the bridge. |

**How to interpret results**

- **Steps 0–5** should return real JSON/text from your vault. If `get_note` or `list_notes` fails with upstream errors, the problem is auth, vault id, canister, or deploy—not “tests only in npm.”
- **`relate`:** **Production verified (2026-04)** on EC2 smoke (vault binding + `list_notes` + `get_note` + `relate` + bridge-version). **`related: []`** is valid when the vault has few notes, semantic search returns no other paths after dropping canister 404s, or content is too thin for neighbors; use **Hub Re-index** and a larger vault to stress-test neighbors if needed.
- **`backlinks`:** **Production verified (2026-04)** — twelfth tool; EC2 + Cursor `knowtation-hosted` smoke (`vault-info` → `list_notes` → `backlinks`). Uses canister list + per-note reads (see inventory row). **`backlinks_truncated: true`** means the soft cap (**2000** notes scanned) was hit before the end of the vault. **`backlinks_notes_scanned`** should match vault size when every listed note was examined and the cap was not hit; empty `backlinks` is valid when no bodies use `[[wikilink]]` to the target.
- **`extract_tasks`:** Uses canister **`GET /api/v1/notes`** with the same query keys as hosted **`list_notes`** (`folder`, `project`, `tag`, `since`, `until`, `limit`, `offset`) plus **`extractCheckboxTasksFromBody`** on each row’s body (or **`GET …/notes/:path`** when the list row body is empty). **`extract_tasks_truncated: true`** means the soft cap (**2000** list rows processed) was hit. **`until`** is supported on hosted only (local filesystem `runExtractTasks` has no `until` filter). **Parity gap:** the in-repo ICP canister `GET /api/v1/notes` handler ignores query string filters; hosted **`extract_tasks`** applies folder/project/tag/date filters **client-side** after materializing list `frontmatter`, matching local `runExtractTasks` intent. **Production verified (2026-04):** EC2 + Cursor **`knowtation-hosted`** smoke — thirteen tools, **`extract_tasks`** + **`get_note`** cross-check (empty `tasks` when bodies lack checkbox lines); see § *Production verification: thirteenth tool `extract_tasks`* above.
- **`cluster`:** Canister list + optional per-note **`GET …/notes/:path`** (same pattern as **`extract_tasks`**), **client-side** `folder` / `project` filters via `hostedNotePassesExtractFilters`, up to **200** notes embedded (title + body slice **800** chars, aligned with local `lib/cluster-semantic.mjs`). Bridge **`POST /api/v1/embed`** in [`hub/bridge/server.mjs`](../hub/bridge/server.mjs): JWT + `X-Vault-Id` + `resolveHostedBridgeContext` (same hosted auth path as **`POST /api/v1/search`** — inline `userIdFromJwt`, not `requireBridgeAuth` / `requireBridgeEditorOrAdmin`); `getVectorsDirForUser` + `getBridgeStoreConfig` + `embedWithUsage` with **`voyageInputType: "document"`** (same embedding batching style as **`POST /api/v1/index`**). Gateway **`lib/kmeans.mjs`** on returned vectors. **`cluster_truncated: true`** when the **2000** list-row scan cap is hit. **Production verified (2026-04):** EC2 + Cursor **`knowtation-hosted`** smoke — fourteen tools, **`cluster`** with `n_clusters` less than or equal to eligible note count; see § *Production verification: fourteenth tool `cluster`* above.
- **`tag_suggest`:** Canister **`GET …/notes/:path`** when **`path`** is set, or caller **`body`** only (12k slice). Bridge **`POST /api/v1/search`** semantic — **default `limit` 40** on the search body, optional MCP **`neighbor_limit`** (clamped **5–80**), **`snippetChars` 200** — same auth as **`relate`** (`resolveHostedBridgeContext` on the bridge). Tags from each search row’s **`tags`** field when present; otherwise **`GET …/notes/:path`** for that neighbor (canister **`X-User-Id`** = **`canisterUserId`**). **EC2 smoke:** complete (2026-04); see § *Production verification: fifteenth tool `tag_suggest`* and the inventory row.
- **`capture`:** Editor/admin. **`buildCaptureInboxWritePayload`** then canister **`POST /api/v1/notes`** (same auth headers as **`write`**, **`X-User-Id`** = **`canisterUserId`**). Not Hub webhook **`POST /api/v1/capture`**. After deploy, verify with step **5b**; empty **`text`** is rejected by the MCP schema.
- **`transcribe`:** Editor/admin. Bridge **`POST /api/v1/import`** with **`source_type`** **`audio`** or **`video`** only (Whisper). Same multipart auth as **`import`** (`Authorization`, **`X-Vault-Id`**, optional **`X-User-Id`** on bridge). Uses **base64** + **`filename`** instead of a local disk path. Requires bridge **`OPENAI_API_KEY`** (and ffmpeg for oversized transcode when enabled). Response shape matches bridge import (**`imported`**, **`count`**, errors from upstream).
- **`import`:** admin-only; large uploads may hit timeouts client-side; audio/video/transcription need bridge env (e.g. API keys) as for Hub import. **Production verified (2026-04):** EC2 `knowtation-hosted` smoke — `source_type` `markdown`, tiny `file_base64` → response `{"imported":[{"path":"inbox/mcp-import-smoke.md",...}],"count":1}`; **`list_notes`** showed the same path and expected body.
- **`index`:** slow; uses embeddings; run only after 1–5 succeed.
- **`summarize` / `enrich`:** if Cursor does not support MCP **sampling**, you may see a short fallback or sparse output; canister reads can still succeed. Compare with [AGENT-INTEGRATION.md](./AGENT-INTEGRATION.md) hosted MCP / sampling notes.
- **`vault_sync`:** Wired in repo with unit tests (`test/mcp-hosted-vault-sync.test.mjs`) that mock `fetch` (POST URL, `Authorization`, `X-Vault-Id`, JSON body `{}` or `{ repo }`). **Live** success needs GitHub connected on the bridge; success shape includes `ok`, `message`, `notesCount`, `proposalsCount` from [`hub/bridge/server.mjs`](../hub/bridge/server.mjs) `POST /api/v1/vault/sync`.
- **`export`:** Admin-only; canister `GET /api/v1/export` with unit tests (`test/mcp-hosted-export.test.mjs`). **MCP-only** max response bytes in the gateway; **`EXPORT_TOO_LARGE`** means use Hub / `vault_sync` / non-MCP export for the full payload.

### Troubleshooting: GATEWAY_AUTH_REQUIRED on canister-backed tools only

**Symptom:** `vault-info`, **`search`**, and **`index`** work, but **`list_notes`**, **`get_note`**, **`write`**, and **`enrich`** fail with `GATEWAY_AUTH_REQUIRED` (or JSON containing that code). **`summarize`** may show only the “sampling unavailable” style message because hosted code **swallows canister read errors** when building note text, so you see an empty combined body and the fallback—not a separate bug from gateway auth.

**Cause:** Hosted MCP calls the canister **directly** from the gateway process with headers `Authorization`, `X-Vault-Id`, `X-User-Id`, and **`X-Gateway-Auth`** set from env **`CANISTER_AUTH_SECRET`** ([`hub/gateway/mcp-hosted-server.mjs`](../hub/gateway/mcp-hosted-server.mjs) `upstreamFetch`). Bridge routes use their own server env for canister calls; they do **not** fix a missing secret on the **EC2 MCP** process.

**Fix (operator):**

1. In **Netlify** (your main gateway project), copy the value of **`CANISTER_AUTH_SECRET`** (do not rotate it unless you also update the canister).
2. On the **EC2 MCP host** (PM2, systemd, or `.env` for `hub/gateway/server.mjs`), set **`CANISTER_AUTH_SECRET`** to that **exact** same string. It must match what the canister expects (set via **`admin_set_gateway_auth_secret`** on the hub canister—see [ARCHITECTURE.md](../ARCHITECTURE.md) / canister docs).
3. Restart the gateway so the process environment picks it up, e.g. `pm2 restart knowtation-gateway --update-env` (or your app name).
4. Re-run Cursor chat steps for `list_notes` → `get_note` → `write` → `enrich` (and `summarize` if you want real content before sampling).

**Verify without printing the secret:** On EC2, `pm2 env <id>` or your process manager should show that **`CANISTER_AUTH_SECRET`** is **defined** (compare presence/length to Netlify, not in chat logs). After restart, gateway logs include **`[gateway] MCP endpoint mounted at /mcp`**; if the secret was missing, startup also logs **`[gateway] MCP /mcp: CANISTER_AUTH_SECRET is empty`** until you fix it.

**Dual-host reminder:** [DEPLOY-HOSTED.md § 3.1](./DEPLOY-HOSTED.md#ec2-mcp-gateway-runbook) — `CANISTER_AUTH_SECRET` (and `CANISTER_URL`, `SESSION_SECRET`) must **match** Netlify; only `HUB_BASE_URL` differs per host.

**When to run these chat tests**

- **Before** you invest in new hosted tools: establishes baseline “production MCP matches expectations.”
- **After** every EC2 deploy that touches `mcp-hosted-server.mjs` or gateway MCP stack.

## Rules (every new tool)

1. **Upstream first:** Implement or confirm an HTTP path on **bridge** or **canister** (or gateway proxy to bridge) that accepts the same auth model as existing hosted tools: `Authorization: Bearer <JWT>`, `X-Vault-Id`, and canister calls with `X-User-Id` / `X-Gateway-Auth` as in `upstreamFetch` in `mcp-hosted-server.mjs`. On **hosted** MCP, **`X-User-Id`** for canister-bound `fetch` is **`canisterUserId`** from bridge **`GET /api/v1/hosted-context`** (effective partition), which may differ from JWT **`sub`** under workspace delegation — see § *Hosted MCP canister `X-User-Id` parity*.
2. **ACL:** Tool name must exist in [`hub/gateway/mcp-tool-acl.mjs`](../hub/gateway/mcp-tool-acl.mjs) for the minimum role; register only behind `isToolAllowed(name, role)`.
3. **Schema:** Prefer explicit Zod object shapes. For string-keyed maps use `z.record(z.string(), z.unknown())` or stricter value types. Never introduce the forbidden pattern checked by `check-mcp-hosted-schema` (see script).
4. **One tool per change set** when possible: schema + handler + golden list update in [`test/mcp-hosted-tools-list.test.mjs`](../test/mcp-hosted-tools-list.test.mjs).
5. **Billing / cost:** Cross-check [`hub/gateway/billing-constants.mjs`](../hub/gateway/billing-constants.mjs) and bridge middleware (`requireBridgeEditorOrAdmin`, etc.) so new tools do not bypass intended limits.

## ACL vs hosted registration (current inventory)

Source of truth for names: `mcp-tool-acl.mjs`. Source of truth for **what Cursor sees today**: `createHostedMcpServer` + golden arrays in `mcp-hosted-tools-list.test.mjs`.

| Tool name | ACL minimum role | Registered on hosted MCP | Notes / likely upstream (verify before implementing) |
|-----------|------------------|---------------------------|--------------------------------------------------------|
| `search` | viewer | Yes | `POST {bridgeUrl}/api/v1/search` |
| `get_note` | viewer | Yes | `GET {canisterUrl}/api/v1/notes/:path` |
| `list_notes` | viewer | Yes | `GET {canisterUrl}/api/v1/notes` |
| `summarize` | viewer | Yes | Canister reads + MCP sampling (`mcp/sampling.mjs`) |
| `enrich` | viewer | Yes | Canister reads + MCP sampling |
| `write` | editor | Yes | `POST {canisterUrl}/api/v1/notes` |
| `index` | admin | Yes | `POST {bridgeUrl}/api/v1/index` |
| `relate` | viewer | Yes | Canister `GET …/notes/:path` for source (title+body, 12k slice) + bridge `POST …/search` semantic (`snippetChars` 200, `limit` min(want+15,50)); per-neighbor titles via canister reads. Bridge uses Voyage **query** embedding for the search string; local `lib/relate.mjs` uses **document** — small intentional gap for Voyage. |
| `backlinks` | viewer | Yes | Canister `GET …/notes?limit=&offset=` (pages of 100) + per-candidate `GET …/notes/:path` for full body; `lib/wikilink.mjs` scan; max **2000** notes examined; JSON includes `backlinks_truncated` / `backlinks_notes_scanned`. **Production verified (2026-04)** on EC2 + Cursor smoke (twelfth tool). |
| `extract_tasks` | viewer | Yes | Canister `GET …/notes?folder=&project=&tag=&since=&until=&limit=&offset=` (same keys as hosted `list_notes`) + body scan via `lib/extract-tasks.mjs` `extractCheckboxTasksFromBody`; optional `GET …/notes/:path` when list body empty. Client-side filters for folder/project/tag/since/until mirror local `runExtractTasks` (canister list query is not authoritative for filters — see § *How to interpret results*). Max **2000** list rows per call (`extract_tasks_truncated` / `extract_tasks_notes_scanned`). Hosted adds optional **`until`** (not in local `runExtractTasks`). **Production verified (2026-04)** on EC2 + Cursor smoke (thirteenth tool). |
| `cluster` | viewer | Yes | Canister `GET …/notes?…` + optional `GET …/notes/:path` (same list/get pattern as **`extract_tasks`**); max **200** notes embedded + **2000** list rows scanned (`cluster_truncated` / `cluster_list_rows_scanned`). Bridge **`POST /api/v1/embed`** ([`hub/bridge/server.mjs`](../hub/bridge/server.mjs)): body `{ "texts": string[] }`; auth = JWT `Authorization` + `X-Vault-Id` + `resolveHostedBridgeContext` (same hosted model as **`POST /api/v1/search`**); embeddings = `embedWithUsage` + `getBridgeStoreConfig` + `voyageInputType: "document"` like **`POST /api/v1/index`**. Gateway `lib/kmeans.mjs`. **Production verified (2026-04)** on EC2 + Cursor smoke (fourteenth tool); first deploy required bridge + gateway on the same commit. |
| `tag_suggest` | viewer | Yes | Canister `GET …/notes/:path` when **`path`** is set (**`X-User-Id`** = **`canisterUserId`**, same as other hosted canister tools — see § *Hosted MCP canister `X-User-Id` parity*); optional **`body`** only (12k slice, same cap as `lib/tag-suggest.mjs`). Neighbors: bridge **`POST /api/v1/search`** semantic with **default `limit` 40**, optional MCP **`neighbor_limit`** (clamped **5–80**), **`snippetChars: 200`** — JWT `Authorization` + `X-Vault-Id` + **`resolveHostedBridgeContext`** (same hosted model as **`relate`** / `hub/bridge/server.mjs` `POST /api/v1/search`; bridge embeds **`query`** with **`voyageInputType: "query"`** — intentional gap vs local **document** embedding, documented like **`relate`**). Result rows include **`tags`** when the vector store exposes them; empty **`tags`** → **`GET …/notes/:path`** per neighbor for `tagsFromFm` / frontmatter. Returns **`suggested_tags`** (up to 12, slug frequency) and **`existing_tags`**. **EC2 production smoke:** complete (2026-04) after gateway deploy with canister user parity (PR **#170**). |
| `capture` | editor | Yes | Canister **`POST {canisterUrl}/api/v1/notes`** with **`buildCaptureInboxWritePayload`** (`lib/capture-inbox.mjs`): same path rules as local MCP (`inbox/…` or `projects/{slug}/inbox/…`), frontmatter `source` (default **`mcp-capture`**), **`date`**, **`inbox: true`**, optional **`tags`** / **`project`**. **Not** Hub **`POST /api/v1/capture`** (webhook / **`X-Webhook-Secret`**, disk vault in self-hosted Hub). **Production smoke:** after merge + EC2 deploy, run chat step **5b**; `get_note` on the returned path must show the captured body. |
| `transcribe` | editor | Yes | Bridge **`POST {bridgeUrl}/api/v1/import`** with **`source_type`** **`audio`** or **`video`** and multipart **`file`** (same as Hub import / hosted **`import`**). MCP args: **`file_base64`**, **`filename`**, optional **`project`**, **`output_dir`**, **`tags`**. Bridge runs **`lib/transcribe.mjs`** (Whisper; **`OPENAI_API_KEY`** on bridge; **25 MB** per-file limit and optional ffmpeg transcode per importer docs). **In-repo tests:** [`test/mcp-hosted-transcribe.test.mjs`](../test/mcp-hosted-transcribe.test.mjs). **EC2 smoke:** after deploy, optional tiny audio file under Whisper limit — expect bridge import JSON with **`imported`** paths. |
| `vault_sync` | editor | Yes | `POST {bridgeUrl}/api/v1/vault/sync` — same headers as search/index; optional `{ "repo": "owner/name" }`; gateway `app.all('/api/v1/vault/sync', …)` proxies to bridge when `BRIDGE_URL` is set |
| `export` | admin | Yes | Canister `GET /api/v1/export` (same as bridge vault backup fetch). MCP enforces a **response byte cap**; over cap → `EXPORT_TOO_LARGE` (Hub / `vault_sync` / direct canister export are not limited by this MCP check). |
| `import` | admin | Yes | Bridge `POST {bridgeUrl}/api/v1/import` (multipart: `source_type`, `file`; optional `project`, `output_dir`, `tags`) — same contract as [`hub/bridge/server.mjs`](../hub/bridge/server.mjs) and gateway [`hub/gateway/server.mjs`](../hub/gateway/server.mjs) `POST /api/v1/import` → bridge. MCP builds `FormData` from `file_base64` + `filename`. |

## After changing tool sets

1. Update golden tool name arrays in `test/mcp-hosted-tools-list.test.mjs`.
2. Run `npm run verify:hosted-mcp-checklist`.
3. Run full `npm test`.
4. Deploy to persistent MCP host only (not Netlify-only gateway for `/mcp`); follow [docs/NEXT-SESSION-HOSTED-MCP.md](NEXT-SESSION-HOSTED-MCP.md).

## Roadmap: what we have, what we do not, what is next

### What we have today

| Layer | Status |
|--------|--------|
| Hosted MCP **tools/list** reliability | Guarded in CI + unit test (serialization + golden names). |
| **Seventeen** tools on hosted MCP | Implemented in `mcp-hosted-server.mjs`: bridge/canister `upstreamFetch` for JSON APIs; **`import`** and **`transcribe`** use multipart `fetch` to the bridge (`/api/v1/import`); **`vault_sync`** POSTs JSON to the bridge; **`export`** GETs canister `/api/v1/export` with a byte cap; **`relate`** + bridge semantic search; **`backlinks`** + canister list/get + `lib/wikilink.mjs`; **`extract_tasks`** + canister list + `lib/extract-tasks.mjs`; **`cluster`** + canister list/get + bridge **`POST /api/v1/embed`** + `lib/kmeans.mjs`; **`tag_suggest`** + canister read + bridge **`POST /api/v1/search`** + optional per-neighbor canister reads for tags; **`capture`** + canister **`POST …/notes`** via **`buildCaptureInboxWritePayload`** (see inventory table). |
| ACL **name sets** (17 names for admin today) | Declared in `mcp-tool-acl.mjs`; each name is registered on hosted MCP as of **`transcribe`**. |

### What we do not have yet

| Item | Meaning |
|------|---------|
| *(none from current ACL list)* | New capabilities start with **`mcp-tool-acl.mjs`** + **`registerTool`** + golden tests. |
| Shared “graph” HTTP API for richer graph queries on hosted | Local MCP uses filesystem/graph libs; **`relate`** reuses bridge vector search; **`backlinks`** uses canister pagination + full note bodies (see inventory). |
| Documented operator smoke for **each** of the seventeen tools after deploy | **`backlinks`**, **`extract_tasks`**, **`cluster`**, **`tag_suggest`**, **`capture`**, and **`transcribe`** (when live on EC2) smoke tracked in § *Production verification* subsections. Run the rest by following [§ How to test hosted MCP](#how-to-test-hosted-mcp). |

### What connecting “the rest” entails (per future tool)

Each additional hosted tool is a **small product decision** plus code:

1. **Upstream contract** — Exact method/path, request body, auth headers, role middleware on bridge/gateway; proof in code review (link to route in `hub/bridge/server.mjs` or canister/gateway).
2. **`registerTool` in `mcp-hosted-server.mjs`** — Zod `inputSchema` that passes JSON Schema export; handler calls `upstreamFetch` for JSON upstreams, or the same auth/URL pattern for multipart (see **`import`**).
3. **ACL** — Name already in `mcp-tool-acl.mjs` or add with correct minimum role.
4. **Tests** — At minimum extend `mcp-hosted-tools-list.test.mjs` golden sets; add focused test if mapping or auth is non-trivial (pattern: `mcp-hosted-search.test.mjs`).
5. **Deploy** — EC2 `git pull` + `pm2 restart`; manual smoke for that tool only.

**Effort:** One tool per PR/session chunk is safer than batching ten tools at once (fewer places to mis-wire billing or RBAC).

### Production verification: fifteenth tool `tag_suggest` (2026-04)

**Status:** Complete, merged to `main` (PR **#170** includes **`tag_suggest`** neighbor defaults + **`canisterUserId`** parity for all hosted canister calls). **EC2 production smoke** complete after gateway deploy and Cursor **`knowtation-hosted`** reconnect: **`vault-info`** shows **`userId`** vs **`canisterUserId`** when applicable; **`list_notes`** with a high **`limit`** matches Hub note counts for the same vault.

**What “working” means here:** Cursor lists **fifteen** admin tools including **`tag_suggest`**; with a **`path`** from **`list_notes`**, the tool returns JSON with **`suggested_tags`** and **`existing_tags`** (empty **`suggested_tags`** is valid when the index is thin or neighbors carry no tags). **`body`**-only calls skip the canister source read and use the provided text (trimmed to **12k** chars) as the semantic **`query`**. Optional **`neighbor_limit`** (5–80) widens or narrows the semantic neighbor pool (default **40**).

### Production verification: sixteenth tool `capture` (2026-04)

**Status:** **Complete, tested, and functional.** In-repo: golden **`tools/list`** in [`test/mcp-hosted-tools-list.test.mjs`](../test/mcp-hosted-tools-list.test.mjs); payload contract tests in [`test/capture-inbox-payload.test.mjs`](../test/capture-inbox-payload.test.mjs); canister **`X-User-Id`** parity coverage includes hosted **`capture`** in [`test/mcp-hosted-canister-user-parity.test.mjs`](../test/mcp-hosted-canister-user-parity.test.mjs). **`npm run verify:hosted-mcp-checklist`** passes on the branch that ships **`capture`**.

**Production (EC2 + Cursor `knowtation-hosted`, 2026-04):** Admin session lists **sixteen** tools with **`capture`** present; **`capture`** with body text and **`source`** returns **`path`** + **`written`**; **`get_note`** on that path round-trips the body; frontmatter JSON includes **`source`**, **`date`**, and **`inbox`**; **`list_notes`** with **`folder: "inbox"`** includes the new path.

**What “working” means here:** Cursor lists **sixteen** admin tools including **`capture`**; **`capture`** with **`text`** returns JSON from the canister write (at least a vault-relative **`path`**); **`get_note`** on that path returns the same body and inbox-style frontmatter (**`source`**, **`date`**, **`inbox`**). Optional **`project`** routes under **`projects/{slug}/inbox/`**; optional **`tags`** become a comma-separated **`tags`** string in frontmatter like local capture.

**Operator checklist:** Reconnect **`knowtation-hosted`** after deploy; run chat step **5b** in [§ How to test hosted MCP](#how-to-test-hosted-mcp).

### Production verification: seventeenth tool `transcribe` (2026-04)

**Status:** **Implemented in-repo** on **`feature/hosted-mcp-transcribe`**: **`registerTool('transcribe', …)`** in [`hub/gateway/mcp-hosted-server.mjs`](../hub/gateway/mcp-hosted-server.mjs) (bridge **`POST /api/v1/import`**, **`source_type`** **`audio`** | **`video`** only); golden **`tools/list`** in [`test/mcp-hosted-tools-list.test.mjs`](../test/mcp-hosted-tools-list.test.mjs); multipart contract in [`test/mcp-hosted-transcribe.test.mjs`](../test/mcp-hosted-transcribe.test.mjs). **`npm run verify:hosted-mcp-checklist`** must pass before merge.

**What “working” means here:** Cursor lists **seventeen** admin tools including **`transcribe`**; calling **`transcribe`** with a small media payload under the Whisper byte limit returns the same JSON shape as **`import`** for **`audio`** / **`video`** (e.g. **`imported`** paths); **`get_note`** on a returned path shows transcript text when Whisper succeeds. Upstream errors (missing **`OPENAI_API_KEY`**, oversize file, unsupported format) surface as bridge/MCP **`UPSTREAM_ERROR`** JSON — compare with Hub **Import → Audio**.

**Operator checklist:** EC2 **`git pull`** + **`pm2 restart`** for gateway; reconnect **`knowtation-hosted`**; confirm step **0** lists **seventeen** tools; run a **tiny** audio file under **25 MB** (same limit as [`lib/transcribe.mjs`](../lib/transcribe.mjs) **`WHISPER_MAX_FILE_BYTES`**).

### This session vs next session

| Work | Where |
|------|--------|
| **Manual smoke** of the seventeen tools on your EC2 MCP URL | After deploy: follow [§ How to test hosted MCP](#how-to-test-hosted-mcp), including step **4e** for `cluster`, step **4f** for `tag_suggest`, step **5b** for `capture`, **`transcribe`** with a tiny audio fixture (same bridge limits as import audio), step **6b** for `import`, step **6c** for `export` if you are admin, and step **8** for `vault_sync` when GitHub is connected. |
| **Implementing** the next hosted tool | Add a new name to ACL first, then **`registerTool`** + golden tests. **`transcribe`** is implemented in-repo (bridge import); run EC2 smoke after deploy (§ *Production verification: seventeenth tool `transcribe`*). |

Pick **one** tool per PR. **`capture`** is registered on hosted MCP and verified per § *Production verification: sixteenth tool `capture`*. **`transcribe`** is registered on hosted MCP ( **`feature/hosted-mcp-transcribe`** ); verify with EC2 deploy + § *Production verification: seventeenth tool `transcribe`*.
