# Hosted MCP tool expansion playbook

This document is the **diligence gate** for adding tools to [`hub/gateway/mcp-hosted-server.mjs`](../hub/gateway/mcp-hosted-server.mjs). It complements [`docs/NEXT-SESSION-HOSTED-MCP.md`](NEXT-SESSION-HOSTED-MCP.md) and the in-repo guards:

- `npm run check:mcp-hosted-schema` — forbids `z.record(z.unknown())` under `hub/gateway/mcp-hosted*.mjs` (Zod v4 JSON Schema export can fail **`tools/list` entirely**).
- `node --test test/mcp-hosted-tools-list.test.mjs` — golden tool names per role + full `tools/list` round-trip via MCP Client.
- `npm run verify:hosted-mcp-checklist` — runs both, then prints production verification steps.

## Reality check: safeguards vs new tools

The **safeguards session** added **no new `registerTool` blocks** and **no new HTTP wiring**. It added:

- Automated proof that **`tools/list`** succeeds (JSON Schema export) per role.
- A **CI script** that blocks a known-bad Zod pattern in `hub/gateway/mcp-hosted*.mjs`.
- This playbook, checklist script, and small edits to the handoff doc.

The **core seven** hosted tools in [`hub/gateway/mcp-hosted-server.mjs`](../hub/gateway/mcp-hosted-server.mjs) (search, get_note, list_notes, write, index, summarize, enrich) were **already** implemented before the safeguards work: most call **bridge** or **canister** via `upstreamFetch`. An **eighth** tool, **`import`** (admin), posts multipart to the bridge (`POST {bridgeUrl}/api/v1/import`) with the same `Authorization` + `X-Vault-Id` model as the gateway import proxy. A **ninth** tool, **`vault_sync`** (editor/admin), POSTs JSON to `POST {bridgeUrl}/api/v1/vault/sync` via `upstreamFetch` (optional body `{ "repo": "owner/name" }`), matching Hub **Back up now** / gateway proxy to the bridge. A **tenth** tool, **`export`** (admin), GETs **`/api/v1/export`** on the hub canister ([`hub/icp/src/hub/main.mo`](../hub/icp/src/hub/main.mo)) with the same canister headers as other hosted canister tools and an **MCP-only** response size cap (`EXPORT_TOO_LARGE` over the limit; Hub / `vault_sync` are not subject to that cap).

What **is** still unwired: the **remaining names** in [`hub/gateway/mcp-tool-acl.mjs`](../hub/gateway/mcp-tool-acl.mjs) (`relate`, `backlinks`, `extract_tasks`, …) that are **not** yet registered in the hosted server. Those are **future** tools, not partial work from the safeguards session.

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
2. Optional: open the MCP panel / tool list and confirm you see **ten** tools if your Hub role is **admin** (fewer if viewer or editor).
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
| 0 | Server lists tools | `Using only the knowtation-hosted MCP server: list the tool names available to you and confirm there are ten if I am an admin.` |
| 1 | Session + vault context | `Using only knowtation-hosted: read the MCP resource vault-info and show the full JSON (userId, vaultId, role, scope).` |
| 2 | Canister list | `Using only knowtation-hosted: call the list_notes tool with limit 10 and show the returned paths or note list.` |
| 3 | Canister read | `Using only knowtation-hosted: call get_note with path "VAULT_NOTE_PATH" — use exactly one path string copied from the list_notes result (vault-relative, not a browser URL). Show the body or error.` |
| 4 | Bridge search | `Using only knowtation-hosted: call search with query "<a short phrase you know exists in your hosted vault>" and mode semantic (or keyword if you prefer). Show a snippet of the results.` |
| 5 | Canister write (editor/admin) | `Using only knowtation-hosted: call write with path "mcp-smoke/cursor-test.md", body "# MCP smoke\n\nWritten from Cursor chat test.", and no frontmatter unless needed. Then call get_note with path "mcp-smoke/cursor-test.md" (same vault-relative path) to confirm it round-trips.` |
| 6 | Bridge index (admin, costly) | **Skip until read/write pass.** When ready: `Using only knowtation-hosted: call the index tool (no arguments). Report success or the JSON error from the tool.` |
| 6b | Bridge import (admin) | **After a small test file is ready:** `Using only knowtation-hosted: call the import tool with source_type markdown, filename mcp-import-smoke.md, and file_base64 set to the base64 of a short UTF-8 markdown file (e.g. "# smoke\\n"). Report imported paths or error JSON.` Same upstream as Hub: bridge `POST /api/v1/import` (multipart); **no canister Motoko changes** — the bridge already batch-writes to the canister. |
| 6c | Canister export (admin) | **Small vault or expect cap:** `Using only knowtation-hosted: call the export tool with no arguments. Paste the JSON top-level keys and note count, or EXPORT_TOO_LARGE if the vault exceeds the MCP-only size limit.` Same upstream as bridge vault backup: canister `GET /api/v1/export`. |
| 7a | Summarize + sampling | `Using only knowtation-hosted: call summarize with path "VAULT_NOTE_PATH" (from list_notes) and style brief. Paste the tool result.` |
| 7b | Enrich + sampling | `Using only knowtation-hosted: call enrich with path "VAULT_NOTE_PATH" (from list_notes). Paste the tool result.` |
| 8 | Bridge vault backup (editor/admin) | **Only if GitHub is connected** for your user on the bridge (same as Hub **Back up now**): `Using only knowtation-hosted: call vault_sync with no arguments (or with repo "owner/name" if needed). Paste the JSON result or error.` Expect `400` with `GITHUB_NOT_CONNECTED` / `REPO_REQUIRED` when GitHub is not set up — that confirms the tool reaches the bridge. |

**How to interpret results**

- **Steps 0–5** should return real JSON/text from your vault. If `get_note` or `list_notes` fails with upstream errors, the problem is auth, vault id, canister, or deploy—not “tests only in npm.”
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

1. **Upstream first:** Implement or confirm an HTTP path on **bridge** or **canister** (or gateway proxy to bridge) that accepts the same auth model as existing hosted tools: `Authorization: Bearer <JWT>`, `X-Vault-Id`, and canister calls with `X-User-Id` / `X-Gateway-Auth` as in `upstreamFetch` in `mcp-hosted-server.mjs`.
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
| `relate` | viewer | No | Local MCP uses vault graph libs; hosted needs bridge/canister design or HTTP surface — **verify** |
| `backlinks` | viewer | No | Same as `relate` — **verify** |
| `extract_tasks` | viewer | No | Local analysis; hosted needs route or intentional omission |
| `cluster` | viewer | No | Local analysis; hosted needs route or intentional omission |
| `tag_suggest` | viewer | No | Local / sampling; hosted needs route or sampling-only wrapper |
| `capture` | editor | No | Bridge has internal capture hooks from search; **no dedicated MCP-shaped HTTP** at time of writing — design before exposing |
| `transcribe` | editor | No | Typically local CLI / gateway media — **verify** hosted product scope |
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
| **Ten** tools on hosted MCP | Implemented in `mcp-hosted-server.mjs`: bridge/canister `upstreamFetch` for JSON APIs; **`import`** uses multipart `fetch` to the bridge; **`vault_sync`** POSTs JSON to the bridge; **`export`** GETs canister `/api/v1/export` with a byte cap (see inventory table). |
| ACL **name sets** (up to 17 for admin) | Declared in `mcp-tool-acl.mjs` for future RBAC; **not** all exposed as MCP tools. |

### What we do not have yet

| Item | Meaning |
|------|---------|
| Hosted `registerTool` for `relate`, `backlinks`, `extract_tasks`, `cluster`, `tag_suggest`, `capture`, `transcribe` | No Cursor-visible tool until implemented; ACL alone does nothing. |
| Shared “graph” HTTP API for relate/backlinks on hosted | Local MCP uses filesystem/graph libs; hosted needs designed bridge or canister surfaces (or intentional omission). |
| Documented operator smoke for **each** of the ten tools after deploy | You establish this by running [§ How to test hosted MCP](#how-to-test-hosted-mcp-manual-recommended-before-expanding). |

### What connecting “the rest” entails (per future tool)

Each additional hosted tool is a **small product decision** plus code:

1. **Upstream contract** — Exact method/path, request body, auth headers, role middleware on bridge/gateway; proof in code review (link to route in `hub/bridge/server.mjs` or canister/gateway).
2. **`registerTool` in `mcp-hosted-server.mjs`** — Zod `inputSchema` that passes JSON Schema export; handler calls `upstreamFetch` for JSON upstreams, or the same auth/URL pattern for multipart (see **`import`**).
3. **ACL** — Name already in `mcp-tool-acl.mjs` or add with correct minimum role.
4. **Tests** — At minimum extend `mcp-hosted-tools-list.test.mjs` golden sets; add focused test if mapping or auth is non-trivial (pattern: `mcp-hosted-search.test.mjs`).
5. **Deploy** — EC2 `git pull` + `pm2 restart`; manual smoke for that tool only.

**Effort:** One tool per PR/session chunk is safer than batching ten tools at once (fewer places to mis-wire billing or RBAC).

### This session vs next session

| Work | Where |
|------|--------|
| **Manual smoke** of the ten tools on your EC2 MCP URL | After deploy: follow [§ How to test hosted MCP](#how-to-test-hosted-mcp-manual-recommended-before-expanding), including step **6b** for `import`, step **6c** for `export` if you are admin, and step **8** for `vault_sync` when GitHub is connected. |
| **Implementing** the next hosted tool | Pick **one** ACL-listed name that still shows **No** in the inventory table; confirm upstream on bridge or canister, then `registerTool` + golden tests per this doc. |

Phase order for tools is in the session prompt table; pick **one** tool per PR. A ready-made **next-session prompt for `relate`** lives in [NEXT-SESSION-HOSTED-MCP.md](./NEXT-SESSION-HOSTED-MCP.md) under *Next session prompt: hosted MCP `relate`*.
