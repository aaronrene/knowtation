# Hosted parity matrix (Hub browser ↔ gateway ↔ MCP)

**Purpose (G0):** One place to see **which user-visible capability** is implemented in the **Hub** (`web/hub/hub.js` + static shell), which **HTTP surface** owns the behavior (`hub/gateway/server.mjs` proxy, `hub/bridge/server.mjs`, or `hub/icp` canister), and which **`knowtation-hosted` MCP tool** (if any) calls the same upstream. Use this to spot **empty cells** (missing client) and **documented intentional differences** (not silent drift).

**Governance (G1):** For any change that ships **both** Hub and hosted MCP, follow **H0–H4** in [`HOSTED-HUB-MCP-INTERLOCK.md`](./HOSTED-HUB-MCP-INTERLOCK.md) and **add or adjust a row here** in the same PR when the capability list changes.

| Check | Done |
|-------|------|
| **H0** Outcome + exact routes/auth documented | ☐ |
| **H1** Shared core implemented once (canister / bridge / `lib/`) | ☐ |
| **H2** First client shipped | ☐ |
| **H3** Second client calls same H1 paths | ☐ |
| **H4** Docs + smoke Hub + reconnect MCP smoke | ☐ |

**Related:** [`HOSTED-MCP-TOOL-EXPANSION.md`](./HOSTED-MCP-TOOL-EXPANSION.md) (tool inventory, ACL, tests), [`NEXT-SESSION-HOSTED-HUB-MCP.md`](./NEXT-SESSION-HOSTED-HUB-MCP.md) (program order G0–G5, prompts phasing).

---

## Vault read / write / list

| User capability | Hub entry (UI / flow) | Canonical API (first hop) | Hosted MCP tool | Parity notes |
|-----------------|----------------------|---------------------------|-----------------|--------------|
| List notes (browse, filters) | Main list + filters; `GET /api/v1/notes?…` via `api()` | Gateway `gatewayProxyGetNotesList` → canister `GET …/api/v1/notes` | `list_notes` | Gateway applies scope / client-side filters where canister ignores query params; MCP uses same list contract with `canisterUserId` for `X-User-Id` (see playbook § parity). |
| Open / read note | Note drawer; `GET /api/v1/notes/:path` | Same path proxied to canister | `get_note` | Same vault-relative `path` string in Hub and MCP. |
| Create / update note body | Editor save; `POST /api/v1/notes` | Canister `POST …/notes` | `write` | Hub sends JSON body; MCP same. |
| Semantic / keyword search | Search bar + **Search**; `POST /api/v1/search` | Gateway → bridge `POST /api/v1/search` | `search` | Same bridge route; roles enforced per gateway + ACL. |
| Rebuild vector index | **Re-index** control; `POST /api/v1/index` | Gateway → bridge | `index` | Costly; admin on MCP; same upstream intent as Hub. |

---

## Import, media, backup, export

| User capability | Hub entry | Canonical API | Hosted MCP tool | Parity notes |
|-----------------|-----------|-----------------|-----------------|--------------|
| Import files (markdown, etc.) | **Import** modal; `POST /api/v1/import` (multipart) | Gateway `proxyImportToBridge` → bridge `POST /api/v1/import` | `import` | Admin ACL on MCP; gateway runs billing gate when `BRIDGE_URL` set. |
| Transcribe audio / video import | Import flow with audio/video | Bridge import + Whisper (`lib/transcribe.mjs`) | `transcribe` | MCP uses base64 + filename; Hub uses file upload — same bridge importer. |
| Git / GitHub vault backup | Settings → Backup; **Back up now**; `POST /api/v1/vault/sync` | Gateway → bridge `POST /api/v1/vault/sync` | `vault_sync` | Editor+; needs GitHub connected on bridge for success. |
| Export **single open note** | Note drawer **Export**; `POST /api/v1/export` with `{ path, format }` | Gateway handler for scoped export | — | **No MCP row:** hosted MCP `export` is **full-vault** `GET {canister}/api/v1/export` with MCP-only byte cap (`EXPORT_TOO_LARGE`); not the same operation as Hub single-note export. |
| Export **full vault** (admin) | No first-class Hub button in `hub.js` for full JSON dump | Canister `GET /api/v1/export` (also used by bridge backup paths) | `export` | **Intentional product split:** MCP admin convenience vs Hub UX; document when adding Hub “download all”. |

---

## Capture and “inbox” style writes

| User capability | Hub entry | Canonical API | Hosted MCP tool | Parity notes |
|-----------------|-----------|-----------------|-----------------|--------------|
| Quick capture line to vault | Quick-add / new note flows using `POST /api/v1/notes` | Canister write | `capture` | MCP uses `lib/capture-inbox.mjs` payload builder → **same canister POST as `write`**, not Hub webhook `POST /api/v1/capture` (webhook + secret is a different door). |

---

## Derived / agentic operations (no dedicated Hub mirror)

These MCP tools **reuse** the same canister and bridge primitives as rows above; the Hub does not expose a matching named feature—users achieve similar outcomes manually (list, open, search).

| User capability | Hub entry | Canonical API | Hosted MCP tool | Parity notes |
|-----------------|-----------|-----------------|-----------------|--------------|
| Related notes (semantic neighbors) | — | Canister read source + bridge `POST /api/v1/search` | `relate` | Bridge uses query embedding; local `lib/relate.mjs` document embedding — **documented** small gap in playbook. |
| Backlinks (`[[wikilink]]`) | — | Canister list + per-note `GET …/notes/:path` + `lib/wikilink.mjs` | `backlinks` | Soft cap 2000 notes scanned; fields `backlinks_truncated`, `backlinks_notes_scanned`. |
| Checkbox tasks extraction | — | Canister list/get + `lib/extract-tasks.mjs` | `extract_tasks` | Client-side folder/project/tag/date filters; canister list query not authoritative — see playbook. |
| Note clustering (embed + k-means) | — | Canister list/get + bridge `POST /api/v1/embed` + `lib/kmeans.mjs` | `cluster` | Caps documented in playbook. |
| Tag suggestions from neighbors | — | Canister read + bridge search + optional neighbor reads | `tag_suggest` | Default neighbor pool 40; optional `neighbor_limit` 5–80. |

---

## LLM sampling on note text (MCP-first)

| User capability | Hub entry | Canonical API | Hosted MCP tool | Parity notes |
|-----------------|-----------|-----------------|-----------------|--------------|
| Summarize note | — (no Hub control equivalent to MCP sampling) | Canister reads in gateway MCP handler + MCP sampling | `summarize` | Hub users read the note; MCP may use **sampling** — see [`AGENT-INTEGRATION.md`](./AGENT-INTEGRATION.md). |
| Enrich / expand note text | Proposal enrich is **policy/settings** and **proposal pipeline**, not the same as MCP `enrich` on arbitrary path | Canister reads + sampling in MCP | `enrich` | **Different product shape:** Hub “enrich” wording ties to proposals; MCP `enrich` is generic path + sampling. |

---

## Session / identity (MCP resource)

| User capability | Hub entry | Canonical API | Hosted MCP surface | Parity notes |
|-----------------|-----------|-----------------|--------------------|--------------|
| See effective vault actor | Session + vault switcher (implicit via gateway `getHostedAccessContext`) | Bridge `GET /api/v1/hosted-context` (used by gateway and MCP bootstrap) | Resource `knowtation://hosted/vault-info` | Returns `userId` (JWT `sub`) and `canisterUserId` (effective partition); must match Hub list partition — see playbook § **Hosted MCP canister `X-User-Id` parity**. |

---

## Hub-only surfaces (no hosted MCP tool in this matrix)

Capabilities that **correctly** have **no** row in the MCP column today (non-goal or future work):

- Auth, invites, workspace admin: `/api/v1/auth/*`, `/api/v1/invites*`, `/api/v1/workspace`, `/api/v1/vault-access`, `/api/v1/scope`, `/api/v1/roles`
- Billing: `/api/v1/billing/*`
- Proposals CRUD / policy: `/api/v1/proposals*`, `/api/v1/settings/proposal-policy`
- Memory API: `/api/v1/memory*` (hosted MCP memory prompts deferred per [`NEXT-SESSION-HOSTED-HUB-MCP.md`](./NEXT-SESSION-HOSTED-HUB-MCP.md))
- Facets / folders helpers: `GET /api/v1/notes/facets`, `GET /api/v1/vault/folders` (Hub filters; MCP tools use `list_notes` / paths)
- Attestations: `/api/v1/attest*`
- Image upload / proxy: `upload-image`, `image-proxy*`

When a future MCP tool overlaps one of these, add a row and complete **H0–H4**.

---

## How to maintain this file

1. **New MCP tool:** Add a row; cite `hub/gateway/mcp-hosted-server.mjs` handler and upstream URL in the playbook or in PR description.
2. **New Hub feature that reads/writes vault data:** Add a row; confirm MCP either gains a tool or an explicit “—” with rationale.
3. **Refactor that moves HTTP paths:** Update the **Canonical API** column only after reading `hub/gateway/server.mjs` and bridge/canister routes in repo.

Last inventory pass: **2026-04-19** — seventeen hosted tools from `mcp-hosted-server.mjs` and [`HOSTED-MCP-TOOL-EXPANSION.md`](./HOSTED-MCP-TOOL-EXPANSION.md) ACL table.
