# Memory Augmentation — Phase 8 Implementation

Phase 8 expands Knowtation's memory layer from a minimal 2-key JSON file stub to a multi-tier memory system with timestamped event log, optional vector-backed semantic recall, Mem0 API provider support, full CLI/MCP/hosted surface, and privacy controls.

## Architecture

### Three-Tier Provider System

| Provider | Config value | Storage | Semantic recall | Dependency |
|----------|-------------|---------|-----------------|------------|
| `file` (default) | `memory.provider: file` | `memory/{vault_id}/events.jsonl` + `state.json` | No (key lookup only) | None |
| `vector` | `memory.provider: vector` | Same JSONL + embeddings in existing vector store | Yes — `memory_search` | Existing embedding infra |
| `mem0` | `memory.provider: mem0` | Delegates to Mem0 API at `memory.url` | Yes (Mem0 built-in) | External Mem0 instance |

### Storage Layout

- **Event log** (`events.jsonl`): Append-only JSONL, one event per line. Never silently overwritten.
- **State overlay** (`state.json`): Latest event per type for O(1) lookup.
- **Per-vault isolation**: `{data_dir}/memory/{vault_id}/`
- **Hosted per-user**: `{DATA_DIR}/memory/{sanitizedUserId}/{vaultId}/`

### Event Taxonomy

| Type | Trigger | Auto-captured by default |
|------|---------|------------------------|
| `search` | After search | Yes |
| `export` | After export | Yes |
| `write` | After note write | Yes |
| `import` | After import | Yes |
| `index` | After re-index | Yes |
| `propose` | After proposal | Yes |
| `agent_interaction` | MCP tool call | No (opt-in) |
| `capture` | After inbox capture | No (opt-in) |
| `error` | On failure | No (opt-in) |
| `session_summary` | Explicit/periodic | No (opt-in) |
| `user` | Manual store | Always allowed |

## Configuration

```yaml
memory:
  enabled: true
  provider: file          # file | vector | mem0
  url: null               # for mem0 provider; env KNOWTATION_MEMORY_URL
  retention_days: null     # null = forever; number = auto-prune
  capture:                 # which events to auto-capture (default below)
    - search
    - export
    - write
    - import
    - index
    - propose
```

## CLI Commands

| Command | Description |
|---------|------------|
| `memory query <key>` | Read latest value for event type |
| `memory list` | List recent events. `--type`, `--since`, `--until`, `--limit`, `--json` |
| `memory store <key> <value>` | Store user-defined entry (type=user) |
| `memory search <query>` | Semantic search (vector/mem0 only) |
| `memory clear` | Clear events. `--type`, `--before`, `--confirm` required |
| `memory export` | Export log. `--format jsonl\|mif`, `--since`, `--until`, `--type` |
| `memory stats` | Event counts, storage size, oldest/newest |

## MCP Tools

| Tool | Description |
|------|------------|
| `memory_query` | Read latest value for a key |
| `memory_store` | Store a value (agent write-back) |
| `memory_list` | List events with filters |
| `memory_search` | Semantic search (vector/mem0) |
| `memory_clear` | Clear with confirmation |

## MCP Resources

| URI | Description |
|-----|------------|
| `knowtation://memory/` | Summary: enabled, provider, event counts |
| `knowtation://memory/events` | Recent event log (last 50) |
| `knowtation://memory/last_search` | Latest search memory |
| `knowtation://memory/last_export` | Latest export memory |

## Hosted Path

- **Gateway**: `/api/v1/memory/*` routes proxy to bridge
- **Bridge**: Implements memory with per-user/vault file storage under `DATA_DIR/memory/{userId}/{vaultId}/`
- **Auth**: All routes require JWT; X-Vault-Id header for multi-vault scoping

## Privacy and Security

- Per-user isolation on hosted (sanitized userId + vaultId partitioning)
- Secret detection: `storeMemory` rejects data with common secret key patterns
- Configurable capture types via `memory.capture`
- `memory clear` requires `--confirm`
- Memory entries store metadata, not full note bodies
- Retention limits via `memory.retention_days`

## Files

### Core Library
- `lib/memory-event.mjs` — Event types, ID generation, validation, secret detection
- `lib/memory-provider-file.mjs` — File provider (JSONL + state.json)
- `lib/memory-provider-vector.mjs` — Vector provider (extends file with embeddings)
- `lib/memory-provider-mem0.mjs` — Mem0 API provider
- `lib/memory.mjs` — MemoryManager class + backward-compatible wrappers

### CLI
- `cli/index.mjs` — Expanded `memory` subcommand with 7 actions

### MCP
- `mcp/tools/memory.mjs` — 5 MCP tools
- `mcp/resources/register.mjs` — Memory resources
- `mcp/resources/metadata.mjs` — Resource builders

### Hosted
- `hub/gateway/server.mjs` — Memory proxy routes
- `hub/bridge/server.mjs` — Memory endpoints with per-user storage

### Tests
- `test/memory.test.mjs` — Core engine tests (46 tests)
- `test/memory-cli.test.mjs` — CLI integration tests (14 tests)
- `test/memory-mcp.test.mjs` — MCP resource tests (9 tests)
- `test/memory-hosted.test.mjs` — Hosted isolation tests (11 tests)
