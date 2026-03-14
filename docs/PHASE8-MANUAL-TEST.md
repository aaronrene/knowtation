# Phase 8 — Memory and AIR manual testing

Phase 8 adds optional **memory** (store last search, export provenance) and completes **AIR** (attestation before write/export). AIR was already wired in Phase 4; Phase 8 ensures config and graceful behavior are correct.

---

## Memory (optional)

**Config:** In `config/local.yaml`:
```yaml
memory:
  enabled: true
  provider: file
```

When enabled, the CLI stores:
- **last_search** — After each search: query, paths, count
- **last_export** — After each export: provenance, exported list

**Query stored data:**
```bash
node cli/index.mjs memory query last_search
node cli/index.mjs memory query last_export
```

**Expected:** JSON output with the stored value, or `(no value)` if none.

**Graceful:** If memory store fails (e.g. data dir unwritable), the main command still succeeds; an error is logged.

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
3. Query memory: `node cli/index.mjs memory query last_search`
4. Run an export: `node cli/index.mjs export inbox/foo.md ./out/`
5. Query: `node cli/index.mjs memory query last_export`

---

## With services off

- **Memory disabled:** `memory query` returns an error; search and export work normally.
- **AIR disabled:** Write and export work without attestation.
- **AIR enabled, endpoint unreachable:** Operation proceeds with placeholder; warning is logged.
