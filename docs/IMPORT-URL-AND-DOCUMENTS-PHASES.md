# Import roadmap: URL, documents, bulk UX (phased)

**Branch:** `feat/import-url-documents-mcp`  
**Policy:** Do **not** push or open a PR until there is solid, testable work worth review. **Commit after each phase** (or each shippable slice within a phase) on this branch.

This doc splits work so each phase matches how Knowtation already works: **`lib/importers/`** + **`runImport`**, Hub / bridge / gateway HTTP, hosted MCP parity, and tests.

---

## Current behavior (baseline — no new code)

| Path | Folder import | Multiple files at once |
|------|----------------|-------------------------|
| **CLI** (`knowtation import …`) | **Yes** for types that accept a directory (e.g. `markdown` walks a folder of `.md` files; see [`lib/importers/markdown.mjs`](../lib/importers/markdown.mjs)). | Run import multiple times or point at a folder. |
| **Hub (browser)** | **Indirectly:** upload a **ZIP** of a folder; server extracts and passes a directory to `runImport` (same pattern as ChatGPT export). | **No:** the file control is **single file** only (`files[0]` in [`web/hub/hub.js`](../web/hub/hub.js)); no `multiple` or folder-picker attribute today. |
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

**Work:**

- `lib/importers/pdf.mjs` + dependency (e.g. `pdf-parse` / `unpdf` — choose in implementation).
- Register in `import.mjs` / `import-source-types.mjs`.
- Hub: allow source type + file; hosted uses existing **`import`** MCP with new `source_type`.
- Fixture PDFs + tests; docs row in IMPORT-SOURCES.

**Commit suggestion:** `feat(import): pdf source type and importer`.

---

## Phase 3 — DOCX → Markdown notes

**Outcome:** `source_type: docx`, upload `.docx` → note(s) via Mammoth (or equivalent).

**Work:**

- `lib/importers/docx.mjs` + `mammoth` (typical).
- Same registration / Hub / MCP pattern as PDF.
- Tests + docs.

**Commit suggestion:** `feat(import): docx source type and importer`.

---

## Phase 4 (optional) — Bulk UX: folder picker & multi-file

**Goal:** Make “bring my whole pile of documents” as easy in the **Hub** as it already is on the **CLI** (folder) or via **ZIP**.

### 4A — Low cost (recommend first)

- **Document clearly** in Hub: “ZIP a folder of PDFs/Markdown and upload once” per source type rules.
- Optional: small Hub helper text or **client-side ZIP** (e.g. JSZip) so users drag a folder and you upload one ZIP **without** new server APIs — browser builds ZIP, existing import path unchanged.

**Complexity:** **Low–medium** (JSZip adds bundle size and memory caps; still one multipart).

### 4B — Native multi-file / server-side folder

- **Hub:** `<input type="file" multiple>` and/or **`webkitdirectory`** → many `File`s.
- **Server:** either **sequential** `POST /api/v1/import` (N requests; simple, works with current multer) or **one batch endpoint** (multipart array + source_type; bridge loops `runImport` or runs a batch helper).
- **Progress / partial failure:** UX for “3 of 5 succeeded.”
- **Limits:** max files, max total bytes, rate limits.

**Complexity:** **Medium** (sequential reuse of Phase 1–3) to **medium–high** (true batch API + transactional semantics + MCP “import_batch”).

**Recommendation:** Ship **Phase 1–3** first; add **4A** (ZIP + copy) immediately in docs/UI; add **4B** when analytics show users struggling without it.

---

## MCP summary (after phases land)

| Capability | Hosted MCP | Self-hosted MCP |
|-------------|------------|-------------------|
| URL | **`import_url`** (new) | **`import`** + `source_type: url` |
| PDF / DOCX | **`import`** + `source_type` + base64 file | **`import`** + path or local workflow |

---

## Adoption note

Ease of import **does** affect adoption. Order of impact:

1. **URL** (paste) — removes “save as Markdown” friction for web content.  
2. **PDF + DOCX** — removes external converter for the two most common office formats.  
3. **Bulk** — ZIP (and later multi-file) removes friction for migrations and “dump folder here.”

---

## Git workflow (recommended)

- **Branch:** Stay on **`feat/import-url-documents-mcp`** for Phase 2 (PDF) and Phase 3 (DOCX). **One PR at the end** is a good default: reviewers see URL + PDF + DOCX together or you can open the PR after Phase 2 if you want PDF reviewed before DOCX.
- **Commits:** Keep **one commit per phase** (or per logical slice). Phase 1 is already committed; add **`feat(import): pdf …`** (and later **`feat(import): docx …`**) on the same branch.
- **Push / merge to `main`:** **Not required** between phases for local or CI testing. Push when you want backup, CI on the remote, or a **draft PR** for early feedback. Merge to `main` when you are ready to **release** (hosted bridge/gateway deploy coordination).

---

## Next session prompt (Phase 2 — PDF)

Copy everything in the block below into a new chat if you want a clean context window. Adjust paths if your clone differs.

```text
We are on branch feat/import-url-documents-mcp. Phase 1 (URL import) is merged into this branch — see docs/IMPORT-URL-AND-DOCUMENTS-PHASES.md and commit history for feat(import): Phase 1 URL import.

Implement Phase 2: PDF import.
- Add source_type `pdf` in lib/import-source-types.mjs and lib/import.mjs.
- New lib/importers/pdf.mjs using a maintained parser (e.g. pdf-parse or unpdf); output Markdown notes under a sensible inbox path; frontmatter source/source_id/date; match patterns from lib/importers/url.mjs and markdown.mjs.
- Hub import modal: ensure .pdf is accepted; add or select PDF source type in web/hub/index.html + hub.js if needed (multipart POST /api/v1/import already exists on bridge/self-hub).
- Hosted MCP: existing `import` tool with source_type pdf + file_base64 — no new tool unless justified.
- Tests: fixture PDF in test/fixtures/, extend test/import-source-types.test.mjs for pdf bad input (missing file path), hosted-import-integration or unit tests as appropriate.
- Docs: IMPORT-SOURCES.md, HUB-API.md if needed, openapi if we document new source_type enum there.

Do not push or open PR unless I ask; commit on the feature branch when Phase 2 is done and tests pass.
```

---

## Related planning artifact

Cursor plan (implementation checklist): `.cursor/plans/document_and_url_import_4dda68c9.plan.md`
