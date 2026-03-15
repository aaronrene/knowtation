# CLI JSON output schema (agent reference)

This document summarizes the **stable JSON shapes** returned by the Knowtation CLI when `--json` is passed. It is intended for agents and tool-definition authors. The canonical source is [SPEC.md](./SPEC.md) §4.2.

---

## Success shapes

### search (--json)

- **Default / `--fields path+snippet`:**  
  `{ "results": [ { "path": string, "snippet": string, "score": number, "project": string | null, "tags": string[] } ], "query": string }`
- **`--fields path`:** Same, but each result has only `path`, `score`, and optionally `project`/`tags`; no `snippet`.
- **`--fields full`:** Each result includes full note (frontmatter + body).
- **`--count-only`:**  
  `{ "count": number, "query": string }` (no `results` or empty).

### get-note (--json)

- **Default:**  
  `{ "path": string, "frontmatter": object, "body": string }`
- **`--body-only`:**  
  `{ "path": string, "body": string }`
- **`--frontmatter-only`:**  
  `{ "path": string, "frontmatter": object }`

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
