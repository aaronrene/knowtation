# Import roadmap: URL, documents, bulk UX (phased)

**Branch:** `feat/import-url-documents-mcp`  
**Policy:** Do **not** push or open a PR until there is solid, testable work worth review. **Commit after each phase** (or each shippable slice within a phase) on this branch.

This doc splits work so each phase matches how Knowtation already works: **`lib/importers/`** + **`runImport`**, Hub / bridge / gateway HTTP, hosted MCP parity, and tests.

---

## Current behavior (baseline — no new code)

| Path | Folder import | Multiple files at once |
|------|----------------|-------------------------|
| **CLI** (`knowtation import …`) | **Yes** for types that accept a directory (e.g. `markdown` walks a folder of `.md` files; see [`lib/importers/markdown.mjs`](../lib/importers/markdown.mjs)). | Run import multiple times or point at a folder. |
| **Hub (browser)** | **ZIP:** uploads whose name ends in `.zip` are extracted server-side; `runImport` receives the **extracted directory** (see [`hub/server.mjs`](../hub/server.mjs) and bridge). That matches **folder-capable** importers (e.g. **markdown** walks `.md`/`.markdown`; ChatGPT/Claude exports). **pdf** and **docx** importers require a **single file path** and **reject a directory** ([`lib/importers/pdf.mjs`](../lib/importers/pdf.mjs), [`lib/importers/docx.mjs`](../lib/importers/docx.mjs)), so in practice Hub **PDF/DOCX** = upload the document itself, **not** a ZIP. | **No:** the file control is **single file** only (`files[0]` in [`web/hub/hub.js`](../web/hub/hub.js)); no `multiple` or folder-picker attribute today. |
| **Hosted MCP `import`** | One **base64 file** (or ZIP) per tool call. | Agents can call **`import`** repeatedly. |

So: **entire-folder ingest already exists on the CLI** for supported types; **in the Hub, the practical “folder” path is ZIP**. Native **folder picker** or **multi-select** in the Hub is **not** implemented yet.

---

## Phase 1 — URL import (highest adoption leverage)

**Outcome:** Paste an HTTPS URL → one or more vault notes (article text when possible, bookmark fallback).

**Status on branch `feat/import-url-documents-mcp`:** **Shipped** (single implementation commit: core `lib/`, `POST /api/v1/import-url` on Hub + bridge + gateway, Hub modal fields, hosted MCP `import_url`, self-hosted MCP `url_mode`, tests, docs).

**Work (representative):**

- `lib/url-fetch-safe.mjs` — SSRF-safe fetch (HTTPS, DNS, redirects, size, timeout).
- `lib/importers/url.mjs` — fetch + Readability-style extraction + `writeNote` / frontmatter.
- `lib/import-source-types.mjs` + [`lib/import.mjs`](../lib/import.mjs) — register `url`.
- `POST /api/v1/import-url` (JSON) on self-hub + bridge + gateway proxy (multipart import stays file-only).
- Hub UI: URL field + submit; optional copy when extract fails.
- Hosted MCP: **`import_url`** tool → same JSON route.
- Self-hosted MCP: extend **`import`** with `source_type: "url"` and `input` = URL string.
- Tests: unit (safe fetch + importer), bridge/gateway integration, update [`test/import-source-types.test.mjs`](../test/import-source-types.test.mjs) for `url`.
- Docs: [`IMPORT-SOURCES.md`](./IMPORT-SOURCES.md), [`AGENT-INTEGRATION.md`](./AGENT-INTEGRATION.md), [`PARITY-MATRIX-HOSTED.md`](./PARITY-MATRIX-HOSTED.md), [`openapi.yaml`](./openapi.yaml).

**Commit suggestion:** `feat(import): url importer + import-url API + Hub + MCP + tests` (or split into 2 commits: lib first, then HTTP/UI).

---

## Phase 2 — PDF → Markdown notes

**Outcome:** `source_type: pdf`, upload `.pdf` (Hub multipart / MCP base64 / CLI path) → note body with extracted text.

**Status on branch `feat/import-url-documents-mcp`:** **Shipped** (commit `feat(import): pdf source type and importer` — core `lib/importers/pdf.mjs`, `unpdf`, Hub option + copy, hosted MCP enum via `IMPORT_SOURCE_TYPES`, tests, docs).

**Work:**

- `lib/importers/pdf.mjs` + dependency (e.g. `pdf-parse` / `unpdf` — choose in implementation).
- Register in `import.mjs` / `import-source-types.mjs`.
- Hub: allow source type + file; hosted uses existing **`import`** MCP with new `source_type`.
- Fixture PDFs + tests; docs row in IMPORT-SOURCES.

**Commit suggestion:** `feat(import): pdf source type and importer`.

---

## Phase 3 — DOCX → Markdown notes

**Outcome:** `source_type: docx`, upload `.docx` → note(s) via Mammoth (or equivalent).

**Status on branch `feat/import-url-documents-mcp`:** **Shipped** (commit `feat(import): docx source type and importer` — `lib/importers/docx.mjs`, `mammoth`, Hub option + copy, hosted MCP enum via `IMPORT_SOURCE_TYPES`, tests, docs).

**Work:**

- `lib/importers/docx.mjs` + `mammoth` (typical).
- Same registration / Hub / MCP pattern as PDF.
- Tests + docs.

**Commit suggestion:** `feat(import): docx source type and importer`.

---

## Phase 4 (optional) — Bulk UX: folder picker & multi-file

**Goal:** Make “bring my whole pile of documents” as easy in the **Hub** as it already is on the **CLI** (folder) or via **ZIP**.

### 4A — Low cost (recommend first)

**Status on branch `feat/import-url-documents-mcp`:** **Shipped** (Hub Import modal + docs: explain **one multipart upload**; **ZIP** for folder-capable types; **PDF/DOCX** = single file, not ZIP—see [`IMPORT-SOURCES.md`](./IMPORT-SOURCES.md) § “Hub browser: ZIP and bulk”.)

- **Document clearly** in Hub and `IMPORT-SOURCES.md`: ZIP a folder of **Markdown** (or use ZIP for exports that expect a directory); **PDF** and **DOCX** = upload **one `.pdf` / `.docx` per import** (ZIP extracts to a directory; those importers require a file).

**Complexity:** **Low** (copy/docs only). **4A does not go obsolete** when 4A₂ or 4B land: exports still arrive as ZIPs; the copy stays the contract for server-side extraction.

### 4A₂ — Client-side ZIP (JSZip) — optional supplement

**Goal:** User drags a **folder** (or many files) in the browser; the Hub builds **one** `.zip` and POSTs the existing multipart `POST /api/v1/import` once—**no new server route** if the payload is still one `file` field.

- **Hub:** dependency (e.g. **JSZip**), drag-and-drop path, explicit **size / file-count caps**, cancel, and error UX when memory or limits bite.
- **Docs:** bundle size tradeoff, browser memory limits, when to prefer “zip in Finder” vs in-app.
- **Tests:** zip builder with fixtures (unit) or a documented manual checklist if DOM-heavy.

**Complexity:** **Low–medium** (limits and UX matter more than LOC). **Scope:** folder-capable `source_type` values only—not PDF/DOCX (see `lib/importers/pdf.mjs` / `docx.mjs`).

### 4B — Native multi-file / folder picker (`webkitdirectory`)

**Goal:** Users can pick **many files** or a **folder** without pre-zipping, within caps.

- **Hub:** `<input type="file" multiple>` and/or **`webkitdirectory`** → many `File`s; progress and per-file outcomes.
- **Server:** **sequential** `POST /api/v1/import` (N requests; reuses multer + `runImport`) **or** **one batch endpoint** (multipart array + `source_type`; bridge loops `runImport`)—pick one approach and document it.
- **Progress / partial failure:** UX for “3 of 5 succeeded” (name failures).
- **Limits:** max files, max total bytes, gateway/bridge timeouts; surface in UI.
- **Parity:** [`PARITY-MATRIX-HOSTED.md`](./PARITY-MATRIX-HOSTED.md) + MCP docs if caps or routes change.

**Complexity:** **Medium** (sequential client + caps + UX) to **medium–high** (batch API + MCP `import_batch` + stricter semantics).

### Recommended order (next implementation pass)

1. **4A₂ (JSZip)** for folder-capable types: large UX win, one HTTP request, same server contract.
2. **4B** after or alongside: native multi-file/folder picker; keep **PDF/DOCX** as **one file per import** unless importers are explicitly extended.
3. **Optional polish:** accessible batch progress (e.g. `aria-live`), documented limits in [`openapi.yaml`](./openapi.yaml) / [`HUB-API.md`](./HUB-API.md) when finalized.

**Recommendation:** Treat **4A + 4A₂ + 4B** as a stacked story: copy explains behavior; JSZip reduces friction for ZIP-shaped flows; 4B covers users who never zip. None of these replace the others.

---

## MCP summary (after phases land)

| Capability | Hosted MCP | Self-hosted MCP |
|-------------|------------|-------------------|
| URL | **`import_url`** (new) | **`import`** + `source_type: url` |
| PDF / DOCX | **`import`** + `source_type` `pdf` or `docx` + base64 file | **`import`** + path or local workflow |

---

## Adoption note

Ease of import **does** affect adoption. Order of impact:

1. **URL** (paste) — removes “save as Markdown” friction for web content.  
2. **PDF + DOCX** — removes external converter for the two most common office formats (both shipped on this branch).  
3. **Bulk** — ZIP (and later multi-file) removes friction for migrations and “dump folder here.”

---

## Git workflow (recommended)

- **Branch:** Stay on **`feat/import-url-documents-mcp`** for Phase 2 (PDF) and Phase 3 (DOCX). **One PR at the end** is a good default: reviewers see URL + PDF + DOCX together or you can open the PR after Phase 2 if you want PDF reviewed before DOCX.
- **Commits:** Keep **one commit per phase** (or per logical slice). Phase 1 is already committed; add **`feat(import): pdf …`** (and later **`feat(import): docx …`**) on the same branch.
- **Push / merge to `main`:** **Not required** between phases for local or CI testing. Push when you want backup, CI on the remote, or a **draft PR** for early feedback. Merge to `main` when you are ready to **release** (hosted bridge/gateway deploy coordination).

---

## Next session prompt (Phase 4A₂ JSZip + Phase 4B multi-file / folder)

Copy everything in the block below into a new chat if you want a clean context window. Adjust paths if your clone differs.

```text
We are on branch feat/import-url-documents-mcp. Phases 1–3 (URL, PDF, DOCX) and Phase 4A (bulk import docs + Hub copy: ZIP vs single-file, folder-capable types) are shipped — see docs/IMPORT-URL-AND-DOCUMENTS-PHASES.md § Phase 4 and docs/IMPORT-SOURCES.md § “Hub browser: one upload, ZIP extraction, and bulk”.

Implement the strongest Hub bulk UX in one pass, in this order:

**A) Phase 4A₂ — Client-side ZIP (JSZip)**
- Only for source types where a ZIP of a folder is already valid server-side (e.g. markdown, ChatGPT/Claude-style exports — verify against runImport + zip extraction in hub/server.mjs and hub/bridge/server.mjs). Do NOT offer “zip my folder” for PDF/DOCX (single-file importers; see lib/importers/pdf.mjs and docx.mjs).
- Add JSZip (or equivalent) to the Hub bundle; drag folder or multi-select files → build one in-memory ZIP with sensible paths (preserve relative paths for markdown trees) → single existing multipart POST /api/v1/import with field `file`.
- Hard limits: max uncompressed total size, max file count, max zip bytes; clear error UX and cancel where feasible; document tradeoffs (memory, mobile) in IMPORT-SOURCES.md or IMPORT-URL-AND-DOCUMENTS-PHASES.md.
- Tests: zip builder unit tests with small fixtures, or a tight manual checklist in test docs if full E2E is heavy.

**B) Phase 4B — Native multi-file / webkitdirectory**
- Hub: enable folder picker and/or multiple file selection where product policy allows; sequential POST /api/v1/import per file OR one batch multipart (pick one approach, justify in PR); progress and partial-failure summary (“3 of 5 imported; failures: …”).
- Caps: max files, max bytes per file, align with gateway/bridge timeouts; surface limits in UI copy.
- PDF/DOCX: keep one file per import (multiple PDFs = N requests or explicit batch loop), unless you explicitly extend importer scope in this session.
- Docs: update IMPORT-SOURCES.md, IMPORT-URL-AND-DOCUMENTS-PHASES.md (mark 4A₂/4B shipped), PARITY-MATRIX-HOSTED.md if user-visible behavior changes; HUB-API.md + openapi.yaml only if HTTP contract or documented limits change.
- Hosted MCP: only add import_batch or similar if justified; otherwise document that agents still use repeated `import` calls.

**C) Optional polish (if time):** accessibility (live region for batch progress), duplicate-file warnings, telemetry hooks only if the repo already patterns them.

Do not push or open a PR unless I ask; commit on the feature branch in logical slices (e.g. JSZip first, then 4B) with tests passing.
```

---

## Related planning artifact

Cursor plan (implementation checklist): `.cursor/plans/document_and_url_import_4dda68c9.plan.md`
