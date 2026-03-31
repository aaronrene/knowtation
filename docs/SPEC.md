# Knowtation — Specification

This document is the **single source of truth** for data formats, contracts, and CLI behavior. Implementors, plugin authors, and agents should rely on it. Spec version aligns with package `version` (e.g. 0.1.x); CLI output shape and frontmatter schema are stable within the same major version.

---

## 0. Data ownership and vendor independence

- **Vault is user-owned.** All content lives in the user’s vault (Markdown + frontmatter) on their machine or their chosen storage. There is no requirement to send data to a third-party vendor to use the tool.
- **Context, memory, and intention stay with the user.** Import from ChatGPT, Claude, Mem0, or other platforms brings data *into* the vault; the vault remains the source of truth. Users can switch LLMs or memory providers without losing their notation.
- **Modular backends.** Embedding provider, vector store, and optional memory layer are configurable and replaceable. The vault format does not depend on any specific vendor. Knowtation is designed to plug into any LLM or service via CLI or MCP — including OpenClaw, DeerFlow, Cursor, Claude Code, and any other agent runtime that can invoke a CLI or speak MCP.
- **Portability.** The vault directory is the portable backup. Export produces standard Markdown (and optional formats). Users own their data and can move or replicate it without lock-in.

---

## 1. Vault format and layout

- **Format:** Markdown files with optional YAML frontmatter. UTF-8. Line endings: LF preferred; CRLF accepted.
- **Root:** One vault root directory (config: `vault_path` or env `KNOWTATION_VAULT_PATH`).
- **Layout (canonical folders):**
  - `inbox/` — Raw captures from message interfaces. All inbox notes MUST conform to the [Inbox note frontmatter](#2-inbox-note-frontmatter) contract.
  - `captures/` — Processed or moved captures (optional frontmatter).
  - `projects/<project-slug>/` — Per-project notes; may contain `inbox/` for project-specific capture.
  - `areas/` — Evergreen themes.
  - `archive/`, `media/audio/`, `media/video/`, `templates/`, `meta/` — Optional; semantics are user-defined.
- **Project slug and tag normalization:** Lowercase; only `a-z0-9` and hyphen `-`; no leading/trailing hyphen. Examples: `born-free`, `dreambolt-network`. Tags in frontmatter use the same normalization when used for filtering.

---

## 2. Frontmatter schema

### 2.1 Common (any note)

| Field     | Type          | Required | Description |
|----------|----------------|----------|-------------|
| `title`  | string         | No       | Display title. |
| `project`| string         | No       | Project slug (normalized). Inferred from path if note under `vault/projects/<slug>/`. |
| `tags`   | string[] or string | No | Tags (normalized). Can be YAML list or comma-separated string. |
| `date`   | ISO 8601 or YYYY-MM-DD | No | Creation or capture date. |
| `updated`| ISO 8601 or YYYY-MM-DD | No | Last update. |

### 2.2 Inbox note frontmatter (message-interface output)

Notes written by a message-interface plugin into `vault/inbox/` or `vault/projects/<project>/inbox/` MUST include:

| Field      | Type   | Required | Description |
|------------|--------|----------|-------------|
| `source`   | string | Yes      | Identifier of the interface (e.g. `telegram`, `slack`, `jira`). |
| `date`     | string | Yes      | ISO 8601 or YYYY-MM-DD. |
| `source_id`| string | Recommended | External id (e.g. message id, ticket key) for deduplication. If present, plugins may skip or update when the same source_id is seen again. |
| `project`  | string | No       | Project slug when writing to global inbox. |
| `tags`     | string[] or string | No | Tags. |

All other common frontmatter fields are optional for inbox notes.

### 2.3 Optional frontmatter for intention and temporal (see docs/INTENTION-AND-TEMPORAL.md)

For temporal sequence, causation, hierarchical memory, and state compression the following are **optional**; notes are valid without them.

| Field | Type | Description |
|-------|------|-------------|
| `follows` | string or string[] | Vault-relative path(s) of note(s) this one follows (causal or sequential). |
| `causal_chain_id` | string | Id grouping notes in the same causal chain. |
| `entity` | string or string[] | Entity labels (person, project, concept) for relational queries. |
| `episode_id` | string | Id grouping notes into an episode/session (hierarchical memory). |
| `summarizes` | string or string[] | Path(s) of note(s) this note summarizes (state compression). |
| `summarizes_range` | string | e.g. `2025-01/2025-03` — this note summarizes that range. |
| `state_snapshot` | boolean | If true, this note is a state snapshot at its `date`. |

Same slug normalization as project/tag for `causal_chain_id` and `entity`. CLI may support `--since`, `--until`, `--chain`, `--entity`, `--episode`, `--order` when these are present; see INTENTION-AND-TEMPORAL.

### 2.4 Reserved for Phase 12 (blockchain and agent payments)

The following frontmatter fields are **reserved** for a future phase. Notes remain valid without them; parsers and indexers MUST NOT require them. When implemented, they will be optional and used for payment attribution and on-chain provenance.

| Field | Type | Description (when implemented) |
|-------|------|--------------------------------|
| `network` | string | Blockchain or network identifier. |
| `wallet_address` | string | Address used for payment or attribution. |
| `tx_hash` | string | Transaction hash (e.g. payment or attestation). |
| `payment_status` | string | Status of payment (e.g. pending, completed). |

See BLOCKCHAIN-AND-AGENT-PAYMENTS.md for the Phase 12 scope. No CLI or Hub behavior depends on these fields until that phase.

---

## 3. Message-interface (capture plugin) contract

- **Purpose:** Any adapter (Telegram, WhatsApp, Discord, JIRA, Slack, Teams, email, webhooks) that ingests messages or events into the vault.
- **Output location:** One of:
  - `vault/inbox/<filename>.md`
  - `vault/projects/<project-slug>/inbox/<filename>.md`
- **Filename:** Safe for filesystem; recommend date-based or `{source}_{source_id}.md` for dedup. Uniqueness is plugin responsibility.
- **Content:** Valid Markdown; frontmatter MUST satisfy [Inbox note frontmatter](#2-inbox-note-frontmatter). Body = message content or transcript.
- **Idempotency:** If plugin supports dedup, use `source_id` in frontmatter and overwrite or skip when a note with the same `source_id` (and same `source`) already exists. Not required by spec but recommended.
- **Discovery:** No built-in plugin discovery. User runs plugins via cron, scheduler, or manual invocation; config can list which capture scripts or services run. Plugins are standalone scripts or services that write files into the vault per this contract.
- **Webhooks:** Message interfaces may expose HTTP endpoints (e.g. Slack/Discord webhooks) that receive events and write notes; contract is the same.

---

## 4. CLI

All commands support global `--json` for machine-readable output. Paths are vault-relative unless stated otherwise.

### 4.1 Commands and flags

| Command | Description | Flags (command-specific) | Notes |
|--------|-------------|---------------------------|-------|
| `search <query>` | **Semantic** search over the indexed vault (default), or **keyword** search (`--keyword`: case-insensitive match in path, body, and selected frontmatter strings). | `--folder <path>`, `--project <slug>`, `--tag <tag>`, `--limit <n>` (default 10), `--since <date>`, `--until <date>`, `--chain <id>`, `--entity <id>`, `--episode <id>`, `--content-scope all\|notes\|approval_logs`, `--order date\|date-asc`, `--fields path\|path+snippet\|full` (default path+snippet), `--snippet-chars <n>`, `--count-only`, `--keyword`, `--match phrase\|all-terms` (with `--keyword`), `--json` | Semantic returns ranked chunks by embedding similarity; keyword returns substring / all-terms matches. Time, causal, entity, episode, and content-scope filters apply to both where implemented. See docs/INTENTION-AND-TEMPORAL.md; token levers: docs/RETRIEVAL-AND-CLI-REFERENCE.md. |
| `get-note <path>` | Return full content of one note (frontmatter + body), or a subset. | `--body-only`, `--frontmatter-only`, `--json` | Path vault-relative. Omit both body/frontmatter flags for full content. |
| `list-notes` | List notes with optional filters. | `--folder <path>`, `--project <slug>`, `--tag <tag>`, `--limit <n>`, `--offset <n>`, `--since <date>`, `--until <date>`, `--chain <id>`, `--entity <id>`, `--episode <id>`, `--order date\|date-asc`, `--fields path\|path+metadata\|full` (default path+metadata), `--count-only`, `--json` | Order: by date (newest first) or by path; time and causal filters optional. Token levers: see docs/RETRIEVAL-AND-CLI-REFERENCE.md. |
| `index` | Re-run indexer: vault → chunk → embed → vector store. | (none) | Reads vault and config; writes to vector store and optional sidecar (e.g. docid → path map). |
| `write <path> [content]` | Create or overwrite a note. | `--stdin`, `--frontmatter k=v [k2=v2 ...]`, `--append`, `--json` | If `--stdin`, body from stdin. Frontmatter merged with existing or created. Inbox writes allowed; for non-inbox, AIR may be required (see Memory and AIR). |
| `export <path-or-query> <output-dir-or-file>` | Export note(s) to a format (e.g. Markdown, HTML) or directory. | `--format <md|html|...>`, `--project <slug>`, `--json` | Provenance (source_notes) recorded; AIR required when enabled. |
| `import <source-type> <input>` | Ingest from external platform or file into vault. | `--project <slug>`, `--output-dir <path>`, `--tags t1,t2`, `--dry-run`, `--json` | See **docs/IMPORT-SOURCES.md** and **docs/IMPORT-MANUAL-CHECKLIST.md**. Allowed `source_type` strings are defined in **lib/import-source-types.mjs** (CLI, Hub, MCP must stay aligned). |

### 4.2 JSON output shape (stable)

- **search (--json):**
  - Default or `--fields path+snippet`: `{ "results": [ { "path": "...", "snippet": "...", "score": number, "project": "...", "tags": [] } ], "query": "...", "mode": "semantic" | "keyword" }`. Implementations may omit `"mode"` for semantic-only CLIs; Hub and current repo include `mode` for both paths. Snippet length may be capped by `--snippet-chars <n>`.
  - `--fields path`: same but each result has only `path`, `score`, and optionally `project`/`tags`; no `snippet`.
  - `--fields full`: each result includes full note content (frontmatter + body) for that hit.
  - `--count-only`: `{ "count": number, "query": "..." }`; no `results` array (or empty). Implementations may optionally include `"paths": [ ... ]` for first N paths when useful.
- **get-note (--json):**
  - Default: `{ "path": "...", "frontmatter": { ... }, "body": "..." }`.
  - `--body-only`: `{ "path": "...", "body": "..." }` (no frontmatter).
  - `--frontmatter-only`: `{ "path": "...", "frontmatter": { ... } }` (no body).
- **list-notes (--json):**
  - Default or `--fields path+metadata`: `{ "notes": [ { "path": "...", "project": "...", "tags": [], "date": "..." } ], "total": number }`.
  - `--fields path`: notes array has only `path` per entry (and `total`).
  - `--fields full`: each note includes full frontmatter and body.
  - `--count-only`: `{ "total": number }`; no `notes` array (or empty).
- **write (--json):** `{ "path": "...", "written": true }`
- **export (--json):** `{ "exported": [ { "path": "...", "output": "..." } ], "provenance": "..." }`
- **import (--json):** `{ "imported": [ { "path": "...", "source_id": "..." } ], "count": n }`

On error, JSON output (when `--json` was passed): `{ "error": "message", "code": "ERROR_CODE" }`.

### 4.3 Exit codes

| Code | Meaning |
|------|--------|
| 0 | Success. |
| 1 | Usage error (missing args, unknown command, invalid options). |
| 2 | Runtime error (vault not found, vector store unreachable, write failed, etc.). |

When `--json` is used and an error occurs, JSON is written to stdout (or stderr, implementation may choose) and exit code is 1 or 2 as above.

### 4.4 Config and environment

CLI and indexer read, in order: env overrides, then `config/local.yaml`.

| Key / Env | Type | Description |
|-----------|------|-------------|
| `vault_path` / `KNOWTATION_VAULT_PATH` | string | Absolute path to vault root. Required. |
| `qdrant_url` / `QDRANT_URL` | string | Qdrant base URL (e.g. http://localhost:6333). Optional if using sqlite-vec. |
| `vector_store` | `qdrant` \| `sqlite-vec` | Backend. Default implementation-defined. |
| `data_dir` / `KNOWTATION_DATA_DIR` | string | Directory for sqlite-vec DB, sidecar index files. Default: `data/` under project root. |
| `embedding.provider` | string | e.g. `ollama`, `openai`. |
| `embedding.model` | string | Model name. |
| `memory.enabled` | boolean | Enable memory layer. |
| `memory.provider` | string | e.g. `mem0`, `same`. |
| `memory.url` / `KNOWTATION_MEMORY_URL` | string | Optional endpoint for memory service. |
| `air.enabled` | boolean | Require AIR attestation for protected operations. |
| `air.endpoint` / `KNOWTATION_AIR_ENDPOINT` | string | Optional AIR service URL. |

No secrets in config; use env for API keys (e.g. `OPENAI_API_KEY`). Do not commit `config/local.yaml`.

---

## 5. Indexer and chunk metadata

- **Input:** All Markdown under vault root (respecting optional ignore patterns, e.g. `templates/`, `meta/`). **Approval audit notes** written by the Hub on proposal approve live under vault-relative `approvals/` (frontmatter `kind: approval_log`) and are indexed like other notes unless a deployment adds `approvals` to `ignore`.
- **Chunking:** Size and overlap are implementation-defined; typical 256–512 tokens with overlap. Each chunk MUST carry metadata: `path` (vault-relative), `project` (from path or frontmatter), `tags` (array from frontmatter). Optional: `date`, `source`.
- **Embedding:** Per config (`embedding.provider`, `embedding.model`). Vectors stored in Qdrant or sqlite-vec with the same metadata so that `search --project` and `--tag` can filter at retrieval time (metadata filter or post-filter).
- **Idempotency:** Indexer should upsert by stable chunk id (e.g. path + chunk index or content hash) so re-runs do not duplicate points.

---

## 6. MCP server (optional)

When an MCP server is provided, it MUST expose the same operations and semantics as the CLI: search, get-note, list-notes, index, write, export, import. Same filters (folder, project, tag), same JSON shapes, same error behavior. MCP is a transport only; the spec is the CLI.

---

## 7. Memory and AIR integration points

- **Memory:** Optional. If enabled, the CLI (or MCP) may call the memory layer: (1) after search, to store “last query + result set” for cross-session context; (2) after export, to store “provenance: these notes → this export”; (3) on demand via a dedicated subcommand (e.g. `knowtation memory query "last export"`). Implementation chooses when to read/write memory; the spec only requires that when `memory.enabled` is true, a memory backend is configured and used for these purposes.
- **AIR:** Optional. If enabled, the following operations MUST obtain an attestation before proceeding: `write` (when path is outside inbox), `export`. Inbox writes are exempt. The attestation id (AIR id) MUST be logged or stored with the action (e.g. in a log file or in note frontmatter). Implementation may call `air.endpoint` or a local AIR flow.

---

## 8. Backup and portability

- **Vault:** The vault directory is the primary portable backup. Copy or sync the vault folder to backup or move to another machine.
- **Full backup:** Optionally include `data/` (vector store and sidecar files) and a copy of `config/local.yaml` (with secrets redacted if needed). No standard backup command is required; users may use git (recommended for vault) or filesystem backup.
- **Provenance vs Git (clarification):** **Provenance** = recording which notes were used for an export and, when AIR is enabled, which attestation authorized a write (traceability of outputs). **Vault under git** = storing the vault folder in a Git repo so you have version history and audit trail of note changes; the inbox remains a folder inside the vault (file-based), not "Git as the inbox."

---

## 9. Versioning and compatibility

- **Spec version:** Tied to package version (e.g. in `package.json`). This SPEC applies to that version.
- **Stability:** Within a major version, frontmatter schema, CLI command set, and JSON output shapes are stable. New optional fields may be added; required fields are not removed. Minor versions may add optional flags or commands.

---

## 10. Use cases covered by this spec

- Single vault, multiple projects (folders + project/tags); project- and tag-scoped search and list.
- Capture from many message interfaces (Telegram, WhatsApp, Discord, JIRA, Slack, webhooks, etc.) via a single inbox contract.
- Transcription → vault notes; indexer picks them up with metadata.
- Agents (Cursor, Claude Code, Windsurf, GNO, custom) run the CLI or MCP; SKILL.md describes when to use Knowtation.
- **Agent orchestration:** Multi-agent orchestration systems (e.g. [AgentCeption](https://github.com/cgcardona/agentception)) use Knowtation as a knowledge backend: agents read the vault (search, list-notes, get-note) for context and optionally write back plans or summaries. Both CLI (for agents in containers/worktrees) and MCP (for runtimes that speak MCP) are supported. See **docs/AGENT-ORCHESTRATION.md**.
- Sync across devices: vault on cloud drive (Dropbox, iCloud); no change to spec.
- Scheduled capture: user runs capture plugins via cron/scheduler; no built-in scheduler in spec.
- Provenance and governance: export and write (non-inbox) can record source_notes and AIR id; vault under git gives history.
- **Import from other platforms:** ChatGPT, Claude, Mem0, NotebookLM, Google Drive, MIF, generic Markdown, audio/video (see **docs/IMPORT-SOURCES.md**). Any external knowledge base or LLM memory can be brought into the vault and used like native content.
- **Any audio:** Smart glasses, wearables, past blogs/videos, recordings → transcribe and store as vault notes with `source` and `source_id`.

## 11. Import and ingestion from external sources

- **Command:** `knowtation import <source-type> <input> [options]`. All importers write vault notes that satisfy §1–2 (frontmatter, project, tags). Origin is always traceable (`source`, `source_id`, `date`).
- **Source types:** `chatgpt-export`, `claude-export`, `mem0-export`, `notebooklm`, `gdrive`, `mif`, `markdown`, `audio`, `video`. Input is path (file/folder) or URI where applicable. Options: `--project`, `--output-dir`, `--tags`, `--dry-run`, `--json`.
- **Full definitions:** Input formats, output location, and idempotency per source type are in **docs/IMPORT-SOURCES.md**. Audio/video import uses the same transcription pipeline as capture; other LLM and KB imports map platform exports to one or more vault notes.
- **MIF:** Memory Interchange Format (`.memory.md` / `.memory.json`) is Obsidian-native; importer can copy as-is or normalize frontmatter for interop with other memory providers.

---

## 12. Extension points (without breaking the spec)

The following can be added later as new subcommands or config options without changing existing contracts: bulk export or bulk tag; template expansion (e.g. `write` from a vault template); optional auth layer for shared vaults; additional vector-store or embedding providers; new import source types. **Muse-style variation/review/commit:** optional layer where proposed vault changes (variations) are reviewed before being applied to the canonical vault, preserving context and intention. **Intention and temporal:** optional frontmatter and filters for temporal sequence, causation, hierarchical memory, state compression, and evals (§2.3). **Evals:** optional `knowtation eval` command and eval set format (TBD). **Retrieval and token cost:** specified in §4.1–4.2 and documented in **docs/RETRIEVAL-AND-CLI-REFERENCE.md** (`--fields`, `--snippet-chars`, `--count-only`, `--body-only`, `--frontmatter-only`). **Blockchain, wallets, and agent payments:** optional frontmatter (`network`, `wallet_address`, `tx_hash`, `payment_status`), CLI filters (`--network`, `--wallet`), and capture/import for on-chain activity; reserved so agents with wallet access can be supported without backtracking. See **docs/BLOCKCHAIN-AND-AGENT-PAYMENTS.md** and Phase 12 in IMPLEMENTATION-PLAN.
