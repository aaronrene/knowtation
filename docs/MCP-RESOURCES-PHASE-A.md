# MCP Issue #1 — Phase A (Resources) — shipped

**In plain terms:** **Resources** let an MCP client **browse** your vault like a small website: folder listings, individual notes, index stats, tag lists—using stable `knowtation://…` addresses instead of raw filesystem paths in every message.

This documents what Phase A implements and what is intentionally deferred.

## Implemented

- **URI scheme:** `knowtation://…` as specified in [issues/issue-1-supercharge-mcp.md](./issues/issue-1-supercharge-mcp.md) Phase A.
- **Fixed resources:** `knowtation://vault/`, `…/inbox`, `…/captures`, `…/imports`, `…/media/audio`, `…/media/video`, `…/templates` (template path index).
- **Metadata:** `knowtation://index/stats`, `knowtation://tags`, `knowtation://projects`, `knowtation://config` (redacted), `knowtation://memory/last_search`, `knowtation://memory/last_export`, `knowtation://air/log` (placeholder), `knowtation://index/graph`.
- **Templates:** `ResourceTemplate` `knowtation://vault/templates/{+name}` with `resources/list` for template files.
- **Vault path:** `ResourceTemplate` `knowtation://vault/{+path}` — Markdown note if `path` ends with `.md`, else JSON folder listing (same pagination rules as fixed listings).
- **Pagination:** JSON listings cap at **500** items per response; response may include `truncated: true` and `total` where applicable.
- **Code:** [`mcp/resources/`](../mcp/resources/) — registered from [`mcp/create-server.mjs`](../mcp/create-server.mjs) after tools.

## Deferred / follow-ups (by phase)

| Item | Phase / note |
|------|----------------|
| `notifications/resources/updated` on vault changes | **E** — implemented; see [MCP-PHASE-E.md](./MCP-PHASE-E.md) |
| Progress / logging for long resource reads | **H** — tool progress/logging shipped ([MCP-PHASE-H.md](./MCP-PHASE-H.md)); long `resources/read` streams still optional |
| Persist AIR ids to a file for `knowtation://air/log` | **A3 completion** — wire when `lib/air.mjs` / write path logs attestations (optional with Phase 4/8) |
| `last_indexed` for Qdrant-only setups | **A** tweak — today uses sqlite-vec DB mtime when present; Qdrant has no local mtime in-repo |
| SPEC.md §6 normative text for Resources | **Docs** — update when you want the spec to mandate resource URIs (currently MCP §6 is tools-only) |
| `resources/list` for all notes >500 | **E** or pagination cursors — list callback returns first 500 URIs only |
| Hosted / canister: no filesystem — resources N/A unless proxied | **D** / hosted architecture (per parity plan) |

## Review checklist (manual)

1. `npm run mcp` (or `node mcp/server.mjs`) with a valid `config/local.yaml` / `KNOWTATION_VAULT_PATH`.
2. From an MCP client: `resources/list`, `resources/templates/list`, `resources/read` for `knowtation://vault/` and one real note URI `knowtation://vault/inbox/…md`.

After review, commit with a message such as: `feat(mcp): Phase A resources (knowtation:// URIs)`.

## Plan log (Issue #1 cross-phase)

Items noticed during Phase A that belong elsewhere:

- **Phase E:** Emit `resources/list_changed` / per-resource updates when the vault changes (today only `sendResourceListChanged` runs on register; no watcher).
- **Phase B:** Prompts should embed these URIs as `EmbeddedResource` where applicable.
- **Phase C:** Optional tool `mcp_resources` or document-only — clients use `resources/read` natively.
- **AIR:** Append attestation records to `data_dir/air-log.json` (or similar) from `lib/air.mjs` when `air.enabled` so `knowtation://air/log` becomes real data.
- **Qdrant `last_indexed`:** Optional sidecar written at end of `runIndex` for parity with sqlite-vec mtime.
