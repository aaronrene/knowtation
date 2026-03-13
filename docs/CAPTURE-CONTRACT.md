# Capture plugin contract (message-interface)

Plugins that ingest messages or events into the Knowtation vault must follow this contract. It is the same as **SPEC §3** (Message-interface); this document is the plugin-author reference.

---

## Output location

Write notes to one of:

- `vault/inbox/<filename>.md` — global inbox
- `vault/projects/<project-slug>/inbox/<filename>.md` — project-scoped inbox

`<project-slug>` uses the same normalization as the rest of the system: lowercase, `a-z0-9` and hyphen only.

---

## Required frontmatter (inbox notes)

Every note written to inbox **MUST** have:

| Field      | Type   | Required | Description |
|-----------|--------|----------|-------------|
| `source`  | string | Yes      | Identifier of the interface (e.g. `telegram`, `slack`, `file`, `webhook`). |
| `date`    | string | Yes      | ISO 8601 or YYYY-MM-DD (e.g. `2026-03-13` or `2026-03-13T15:30:00Z`). |
| `source_id` | string | Recommended | External id (message id, ticket key, hash) for deduplication. If present, plugins may skip or overwrite when the same `source_id` is seen again. |

Optional: `project`, `tags` (per SPEC §2.2).

---

## Filename

- Safe for the filesystem (no `/`, `\`, `:`, etc.).
- Recommended: `{source}_{source_id}.md` or `{source}_{timestamp}.md` for uniqueness.
- Uniqueness is the plugin’s responsibility.

---

## Idempotency

If your plugin supports deduplication:

1. Include `source_id` in frontmatter.
2. Use a deterministic path (e.g. `inbox/{source}_{source_id}.md`).
3. On re-ingest of the same `source_id`:
   - **Skip:** Do not write if the file already exists.
   - **Update:** Overwrite the existing file (same path).

Either strategy satisfies the contract. Document which you use.

---

## Content

- **Body:** Valid Markdown; line endings LF preferred.
- **Encoding:** UTF-8.

---

## Discovery and execution

- No built-in plugin discovery. The user runs plugins via cron, scheduler, or manual invocation.
- Config can list which capture scripts or services run.
- Plugins are standalone scripts (Node, bash, Python) or HTTP servers; they write files per this contract.

---

## Example: file-based capture

```bash
# Capture from stdin
echo "Meeting notes: discussed Phase 5." | node scripts/capture-file.mjs --source file --source-id meeting-2026-03-13

# Capture from file
node scripts/capture-file.mjs --file /path/to/notes.md --source file --project myproject
```

Output: `vault/inbox/file_meeting-2026-03-13.md` or `vault/projects/myproject/inbox/...` with frontmatter `source`, `date`, `source_id`.

---

## Example: webhook server

```bash
node scripts/capture-webhook.mjs --port 3131
# POST http://localhost:3131/capture
# Body: { "body": "Message", "source_id": "msg-123", "source": "slack", "project": "myproject" }
```

Same contract: `source`, `date`, `source_id` in frontmatter; body from the request.
