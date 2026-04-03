# Phase 8 — Memory and AIR manual testing

Phase 8 adds a **multi-tier memory layer** (event log, semantic recall, Mem0 API) and ensures **AIR** (attestation before write/export) is correctly wired. Memory captures events across CLI, MCP, and hosted surfaces.

---

## Memory (optional)

**Config:** In `config/local.yaml`:
```yaml
memory:
  enabled: true
  provider: file          # file | vector | mem0
  # retention_days: 90    # null = forever
  # capture:              # default: search, export, write, import, index, propose
  #   - search
  #   - export
  #   - write
  #   - import
  #   - index
  #   - propose
```

When enabled, the CLI auto-captures events after operations (search, export, write, import, index, propose).

### CLI commands

**Query latest event by type:**
```bash
node cli/index.mjs memory query search
node cli/index.mjs memory query export
node cli/index.mjs memory query write --json
```

**List recent events:**
```bash
node cli/index.mjs memory list
node cli/index.mjs memory list --type search --limit 5 --json
node cli/index.mjs memory list --since 2026-01-01 --until 2026-12-31
```

**Store a user-defined memory:**
```bash
node cli/index.mjs memory store my_context '{"note":"important context"}'
node cli/index.mjs memory store my_key '{"data":1}' --json
```

**Memory statistics:**
```bash
node cli/index.mjs memory stats
node cli/index.mjs memory stats --json
```

**Export memory log:**
```bash
node cli/index.mjs memory export --format jsonl > memory-backup.jsonl
node cli/index.mjs memory export --format mif --type search
```

**Clear memory:**
```bash
node cli/index.mjs memory clear --confirm
node cli/index.mjs memory clear --type search --confirm
node cli/index.mjs memory clear --before 2026-01-01 --confirm --json
```

**Semantic search (requires vector or mem0 provider):**
```bash
node cli/index.mjs memory search "blockchain attestation" --limit 5
```

### MCP tools

The following MCP tools are available when memory is enabled:
- `memory_query` — Read latest value for an event type
- `memory_store` — Store a value (agent write-back)
- `memory_list` — List events with filters
- `memory_search` — Semantic search (vector/mem0 only)
- `memory_clear` — Clear with confirmation

### MCP resources

- `knowtation://memory/` — Summary (enabled, provider, counts)
- `knowtation://memory/events` — Recent event log (last 50)
- `knowtation://memory/last_search` — Latest search
- `knowtation://memory/last_export` — Latest export

---

## AIR (optional)

**Config:** In `config/local.yaml`:
```yaml
air:
  enabled: true
  endpoint: http://localhost:3000
```

When enabled:
- **Before write** (non-inbox): Calls `POST {endpoint}` with `{ action: "write", path }`; expects `{ id }` or `{ air_id }`
- **Before export:** Calls `POST {endpoint}` with `{ action: "export", source_notes }`; expects `{ id }` or `{ air_id }`

**Without endpoint or when unreachable:** Logs a warning and uses a placeholder; the operation proceeds (graceful degradation).

---

## Quick smoke test

1. Enable memory:
   ```yaml
   memory:
     enabled: true
     provider: file
   ```
2. Run a search: `node cli/index.mjs search "test"`
3. Query memory: `node cli/index.mjs memory query search --json`
4. Run an export: `node cli/index.mjs export inbox/foo.md ./out/`
5. Query: `node cli/index.mjs memory query export`
6. Write a note: `node cli/index.mjs write test/note.md "Hello world"`
7. Query: `node cli/index.mjs memory query write`
8. List all events: `node cli/index.mjs memory list --json`
9. Check stats: `node cli/index.mjs memory stats`
10. Store custom: `node cli/index.mjs memory store test_key '{"v":1}'`
11. Export log: `node cli/index.mjs memory export --format jsonl`
12. Clear: `node cli/index.mjs memory clear --confirm`
13. Verify empty: `node cli/index.mjs memory stats` (total should be 0)

---

## With services off

- **Memory disabled:** `memory query` returns an error; search, write, export work normally without capturing.
- **AIR disabled:** Write and export work without attestation.
- **AIR enabled, endpoint unreachable:** Operation proceeds with placeholder; warning is logged.

---

## Automated tests

```bash
node --test test/memory.test.mjs           # 46 tests: core engine
node --test test/memory-cli.test.mjs       # 14 tests: CLI integration
node --test test/memory-mcp.test.mjs       # 9 tests: MCP resources
node --test test/memory-hosted.test.mjs    # 11 tests: hosted isolation
```
