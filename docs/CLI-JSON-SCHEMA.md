# CLI JSON output schema (agent reference)

This document summarizes the **stable JSON shapes** returned by the Knowtation CLI when `--json` is passed. It is intended for agents and tool-definition authors. The canonical source is [SPEC.md](./SPEC.md) §4.2.

---

## Success shapes

### search (--json)

- **Default / `--fields path+snippet`:**  
  `{ "results": [ { "path": string, "snippet": string, "score": number, "project": string | null, "tags": string[] } ], "query": string, "mode"?: "semantic" | "keyword" }` — `mode` is set by implementations that support **`--keyword`** (keyword) vs default semantic search.
- **`--fields path`:** Same, but each result has only `path`, `score`, and optionally `project`/`tags`; no `snippet`.
- **`--fields full`:** Each result includes full note (frontmatter + body).
- **`--count-only`:**  
  `{ "count": number, "query": string, "mode"?: "semantic" | "keyword" }` (no `results` or empty).

### get-note (--json)

- **Default:**  
  `{ "path": string, "frontmatter": object, "body": string }`
- **`--body-only`:**  
  `{ "path": string, "body": string }`
- **`--frontmatter-only`:**  
  `{ "path": string, "frontmatter": object }`

### get-note-outline (--json)

`{ "schema": "knowtation.note_outline/v1", "path": string, "title": string | null, "headings": [ { "level": number, "text": string, "id": string } ], "truncated": boolean }`

The outline is derived from the current Markdown note and excludes body text, snippets, full frontmatter, absolute filesystem paths, line ranges, byte offsets, summaries, vector scores, and memory events.

### get-document-tree (--json)

`{ "schema": "knowtation.document_tree/v0", "path": string, "title": string | null, "root": { "children": [ { "id": string, "level": number, "text": string, "children": [] } ] }, "truncated": boolean }`

The tree is derived from the current Markdown note and excludes body text, snippets, full frontmatter, absolute filesystem paths, line ranges, byte offsets, summaries, vector scores, labels, metadata facets, and memory events.

### get-metadata-facets (--json)

`{ "schema": "knowtation.metadata_facets/v0", "path": string, "facets": { "project": string | null, "tags": string[], "date": string | null, "updated": string | null, "causal_chain_id": string | null, "entity": string[], "episode_id": string | null }, "inferred": { "folder": string | null, "source_type": null }, "truncated": boolean }`

The facets are derived from current note frontmatter and vault-relative path inference. The response excludes body text, snippets, full frontmatter, absolute filesystem paths, label text, OCR text, PageIndex output, summaries, vectors, media metadata, and memory events.

### list-notes (--json)

- **Default / `--fields path+metadata`:**  
  `{ "notes": [ { "path": string, "title": string | null, "project": string | null, "tags": string[], "date": string | null } ], "total": number }`
- **`--fields path`:**  
  `{ "notes": [ { "path": string } ], "total": number }`
- **`--fields full`:** Each note includes full frontmatter and body.
- **`--count-only`:**  
  `{ "total": number }` (no `notes` or empty).

### write (--json)

`{ "path": string, "written": true }`

### export (--json)

`{ "exported": [ { "path": string, "output": string } ], "provenance": string }`

### import (--json)

`{ "imported": [ { "path": string, "source_id": string } ], "count": number }`

---

## Error shape (when --json and error)

`{ "error": string, "code": string }`

Exit code: 1 (usage) or 2 (runtime).

---

## Hub API alignment

Hub REST API returns the same shapes for list notes, get note, and search. See [HUB-API.md](./HUB-API.md) and [openapi.yaml](./openapi.yaml).
